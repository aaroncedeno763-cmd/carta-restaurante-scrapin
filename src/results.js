import { lstat, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { photoAvailability, readJson, saveJson } from './storage.js';

export const photosRoot = 'cartas-obetenidas';
const legacyRoot = 'cartas';
const notFound = 'no encontrado';
const missingMenu = 'faltan las cartas';
const ambiguous = 'ambiguos';
const resultRoots = [photosRoot, notFound, missingMenu, ambiguous];
export const photoRoots = [photosRoot, legacyRoot];
const recordName = 'restaurante.json';

const rootsByStatus = new Map([
  ['sin_coincidencia_confirmada', notFound],
  ['sin_seccion_menu_en_esta_vista', missingMenu],
  ['sin_fotos_de_menu_en_esta_vista', missingMenu],
  ['pendiente_revision', ambiguous],
]);

export async function prepareResultFolders() {
  await Promise.all(resultRoots.map(root => mkdir(root, { recursive: true })));
}

export async function saveRestaurantOutcome(source, status, { phone, reason, listing } = {}) {
  const { id, signature } = source;
  const legacy = path.join(legacyRoot, id);
  const obtained = path.join(photosRoot, id);
  const oldPhotos = await photoAvailability(id, signature, legacyRoot);
  if (oldPhotos.saved > 0) {
    const exists = await lstat(obtained).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!exists) await rename(legacy, obtained);
  }
  const photos = await photoAvailability(id, signature, photosRoot);
  if (oldPhotos.saved > 0 && photos.saved === 0) {
    throw new Error(`No se pueden trasladar las cartas de ${legacy} porque ya existe ${obtained}. Revisa ambas carpetas.`);
  }
  const destination = photos.saved > 0 ? photosRoot : rootsByStatus.get(status);
  if (!destination) return null;

  const roots = [destination, ...resultRoots.filter(root => root !== destination), legacyRoot];
  const records = await Promise.all(roots.map(async root => {
    const folder = path.join(root, id);
    return { folder, record: await readJson(path.join(folder, recordName), null) };
  }));
  const [target, ...otherFolders] = records;
  if (target.record && (target.record._id !== id || target.record.signatura !== signature)) {
    throw new Error(`La carpeta ${target.folder} contiene datos de otro restaurante.`);
  }
  const matching = records.filter(({ record }) => record?._id === id && record.signatura === signature);
  const previous = matching[0]?.record;
  const storedStatus = destination === photosRoot ? 'cartas_recopiladas_pendientes_revision_visual' : status;
  const explanation = storedStatus === status ? reason : undefined;
  const record = {
    ...previous,
    _id: id, signatura: signature, nombre: source.name, direccion: source.address,
    municipio: source.municipality, localidad: source.locality, coordenadas: source.coordinates,
    telefono: phone ?? matching.find(({ record }) => record.telefono)?.record.telefono ?? null,
    estado: storedStatus,
    motivo: explanation ?? (previous?.estado === storedStatus ? previous.motivo : undefined),
    ...(listing || previous?.url_ficha ? { url_ficha: listing || previous.url_ficha } : {}),
  };
  if (JSON.stringify(record) !== JSON.stringify(target.record)) {
    await saveJson(path.join(target.folder, recordName), record);
  }
  for (const entry of otherFolders) {
    if (!matching.includes(entry)) continue;
    const files = await readdir(entry.folder);
    if (files.length !== 1 || files[0] !== recordName) continue;
    await rm(path.join(entry.folder, recordName));
    await rmdir(entry.folder).catch(error => { if (error.code !== 'ENOTEMPTY') throw error; });
  }
  return destination;
}
