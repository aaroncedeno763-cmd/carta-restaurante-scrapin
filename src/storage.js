import { readFile, writeFile, mkdir, rename, rm, open, link, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
export async function saveJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}

export async function ensureRestaurantRecord(source, root = 'cartas', { phone } = {}) {
  if (!/^[1-9]\d*$/.test(source.id)) throw new Error('ID de carpeta no válido.');
  const file = path.join(root, source.id, 'restaurante.json');
  const previous = await readJson(file, null);
  if (previous && (previous._id !== source.id || previous.signatura !== source.signature)) throw new Error('La carpeta contiene datos de otro restaurante.');
  await saveJson(file, { _id: source.id, signatura: source.signature, nombre: source.name, direccion: source.address,
    municipio: source.municipality, localidad: source.locality, coordenadas: source.coordinates,
    telefono: phone ?? previous?.telefono ?? null });
}

export async function reconcileMissingPhotos(state, root = 'cartas') {
  for (const [id, item] of Object.entries(state.items)) {
    if (!item.status.startsWith('cartas_recopiladas')) continue;
    if (!/^[1-9]\d*$/.test(id)) throw new Error('ID de progreso no válido.');
    const metadata = await readJson(path.join(root, id, 'procedencia.json'), null);
    let missing = !metadata || metadata._id !== id || metadata.signatura !== item.signature || !metadata.imagenes?.length;
    if (!missing) for (const image of metadata.imagenes) {
      if (!/^carta-[a-f0-9]{64}\.(jpg|png)$/.test(image.archivo)) throw new Error('Nombre de foto guardada no válido.');
      try { await access(path.join(root, id, image.archivo)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; break; }
    }
    if (missing) item.status = 'en_proceso';
  }
  return state;
}
export async function acquireLock(file) {
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      return async () => { await handle.close(); await rm(file, { force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const saved = await readJson(file);
      if (!Number.isSafeInteger(saved.pid) || saved.pid <= 0) throw new Error('El bloqueo del recorrido no es válido; revísalo antes de continuar.');
      try { process.kill(saved.pid, 0); }
      catch (error) {
        if (error.code === 'ESRCH') { await rm(file); continue; }
        if (error.code === 'EPERM') throw new Error('Ya hay un recorrido activo o no se puede comprobar su proceso. Espera a que termine.');
        throw error;
      }
      throw new Error('Ya hay un recorrido activo. Espera a que termine.');
    }
  }
  throw new Error('No se pudo reservar el recorrido.');
}

export function imageInfo(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), extension: 'png', mime: 'image/png' };
  }
  if (bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8 && bytes.readUInt16BE(bytes.length - 2) === 0xffd9) {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), extension: 'jpg', mime: 'image/jpeg' };
      }
      offset += length;
    }
  }
  throw new Error('El recurso no es una imagen JPEG/PNG válida y completa admitida.');
}

export async function storePhoto({ root = 'cartas', source, bytes, provenance }) {
  if (!/^[1-9]\d*$/.test(source.id)) throw new Error('ID de carpeta no válido.');
  const info = imageInfo(bytes);
  if (info.width < 500 || info.height < 300 || bytes.length > 20 * 1024 * 1024) throw new Error('Imagen demasiado pequeña o mayor de 20 MB.');
  const sha256 = hash(bytes);
  const folder = path.join(root, source.id);
  await mkdir(folder, { recursive: true });
  const metadataFile = path.join(folder, 'procedencia.json');
  const metadata = await readJson(metadataFile, { version: 1, _id: source.id, signatura: source.signature, imagenes: [] });
  if (metadata._id !== source.id || metadata.signatura !== source.signature || !Array.isArray(metadata.imagenes)) throw new Error('La procedencia existente pertenece a otro establecimiento o no es válida.');
  const samePhoto = provenance.foto_id_maps && metadata.imagenes.find(image => image.foto_id_maps === provenance.foto_id_maps
    && image.dimensiones?.ancho >= info.width && image.dimensiones?.alto >= info.height);
  if (samePhoto) {
    if (!/^carta-[a-f0-9]{64}\.(jpg|png)$/.test(samePhoto.archivo)) throw new Error('Nombre de imagen existente no válido.');
    const previousFile = path.join(folder, samePhoto.archivo);
    let savedBytes;
    try { savedBytes = await readFile(previousFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (savedBytes) {
      if (hash(savedBytes) !== samePhoto.sha256) throw new Error('La imagen guardada no coincide con su huella; se conserva para revisión.');
      return { file: previousFile, sha256: samePhoto.sha256, duplicate: true, width: samePhoto.dimensiones.ancho, height: samePhoto.dimensiones.alto, mime: samePhoto.tipo };
    }
  }
  const filename = `carta-${sha256}.${info.extension}`;
  const file = path.join(folder, filename);
  const temp = path.join(folder, `.${randomUUID()}.tmp`);
  let fileExisted = false;
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    try { await link(temp, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (hash(await readFile(file)) !== sha256) throw new Error('El archivo existente no coincide con su huella; se conserva para revisión.'); fileExisted = true; }
  } finally { await rm(temp, { force: true }); }
  const existing = metadata.imagenes.find(image => image.sha256 === sha256);
  if (!existing) {
    const smallerVersion = provenance.foto_id_maps && metadata.imagenes.find(image => image.foto_id_maps === provenance.foto_id_maps);
    metadata.imagenes.push({ ...provenance, ...(smallerVersion ? { version_de: smallerVersion.archivo } : {}), archivo: filename, sha256, bytes: bytes.length, dimensiones: { ancho: info.width, alto: info.height }, tipo: info.mime, fecha_descarga: new Date().toISOString(), revision_visual: 'pendiente', vigencia_precios: 'no_confirmada' });
    await saveJson(metadataFile, metadata);
  }
  return { file, sha256, duplicate: Boolean(existing) && fileExisted, ...info };
}
