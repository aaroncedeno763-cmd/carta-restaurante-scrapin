import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function saveJson(file, value) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function importCaib({
  source = 'establecimientos.geojson',
  output = 'data/restaurantes-con-ids.geojson',
  mapping = 'data/ids.json',
} = {}) {
  if (new Set([source, output, mapping].map((file) => path.resolve(file))).size !== 3) {
    throw new Error('La fuente, la salida y el mapa de IDs deben tener rutas distintas.');
  }
  const data = JSON.parse((await readFile(source, 'utf8')).replace(/^\uFEFF/, ''));
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) {
    throw new Error('La fuente debe ser una FeatureCollection no vacía.');
  }
  const signatures = new Set();
  for (const [index, feature] of data.features.entries()) {
    const signature = feature?.properties?.Signatura;
    if (feature?.type !== 'Feature' || typeof signature !== 'string' || !signature.trim()) {
      throw new Error(`Registro ${index + 1}: falta una Signatura válida.`);
    }
    if (signatures.has(signature)) throw new Error(`Signatura duplicada: ${signature}`);
    signatures.add(signature);
  }
  const restaurants = data.features.filter(({ properties }) =>
    properties.Grup === 'Restaurant' && properties.Estat === 'Alta');
  if (!restaurants.length) throw new Error('No hay restaurantes con Grup=Restaurant y Estat=Alta.');

  let assignments = [];
  try {
    const saved = JSON.parse(await readFile(mapping, 'utf8'));
    if (saved?.version !== 1 || !Array.isArray(saved.assignments)) {
      throw new Error('El mapa de IDs no tiene un formato válido.');
    }
    assignments = saved.assignments;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Falta el mapa de IDs. Recupera data/ids.json del proyecto anterior; no se reasignarán los IDs.');
  }
  const bySignature = new Map();
  const usedIds = new Set();
  let nextId = 1;
  for (const entry of assignments) {
    const id = entry?._id;
    if (typeof entry?.signatura !== 'string' || !entry.signatura.trim()
      || typeof id !== 'string' || !/^[1-9]\d*$/.test(id)
      || !Number.isSafeInteger(Number(id)) || Number(id) >= Number.MAX_SAFE_INTEGER
      || bySignature.has(entry.signatura) || usedIds.has(id)) {
      throw new Error('El mapa de IDs contiene registros inválidos o duplicados; no se sobrescribirá.');
    }
    bySignature.set(entry.signatura, id);
    usedIds.add(id);
    nextId = Math.max(nextId, Number(id) + 1);
  }
  const previousCount = assignments.length;
  const features = restaurants.map((feature) => {
    const signature = feature.properties.Signatura;
    if (!bySignature.has(signature)) {
      if (nextId >= Number.MAX_SAFE_INTEGER) throw new Error('Se ha agotado el rango de IDs numéricos.');
      const id = String(nextId++);
      bySignature.set(signature, id);
      assignments.push({ signatura: signature, _id: id });
    }
    return { ...feature, properties: { ...feature.properties, _id: bySignature.get(signature) } };
  });
  // Guardar antes la relación estable permite reintentar si falla la salida.
  await saveJson(mapping, { version: 1, assignments });
  await saveJson(output, { type: 'FeatureCollection', features });
  return {
    total: data.features.length, restaurants: features.length,
    excluded: data.features.length - features.length,
    newIds: assignments.length - previousCount, output, mapping,
  };
}
