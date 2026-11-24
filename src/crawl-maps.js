import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mapsBrowserExecutable, profileDirectory } from './browser-profile.js';
import { hash, readJson, saveJson, acquireLock, reconcileMissingPhotos } from './storage.js';
import { searchExplanation } from './match-maps.js';
import { isMallorca } from './mallorca.js';
import { photoRoots, prepareResultFolders, saveRestaurantOutcome } from './results.js';
import { findRestaurant } from './find-restaurant.js';
import { collectMenu } from './collect-menu.js';

const root = path.join('data', 'recorrido-maps');
const stateFile = path.join(root, 'progreso.json');
const version = 1;
const matchingVersion = 2;

function compactProgress(state) {
  if (state.version !== version || !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) throw new Error('Progreso no válido: se conserva para revisión.');
  return { version, items: Object.fromEntries(Object.entries(state.items).map(([id, item]) => [id, {
    requestHash: item.requestHash, signature: item.signature, status: item.status,
    ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
  }])) };
}

function selectPending(items, state, { limit, maxPhotos, ids, fromId, toId, repeat, retryErrors, all = false }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error('--limit debe estar entre 1 y 25.');
  if (!Number.isSafeInteger(maxPhotos) || maxPhotos < 1 || maxPhotos > 10) throw new Error('--max-fotos debe estar entre 1 y 10.');
  if (repeat && !ids) throw new Error('--repeat requiere una selección explícita con --ids.');
  if (all && ids) throw new Error('--all no se combina con --ids.');
  if (ids && (!ids.length || ids.length > limit || new Set(ids).size !== ids.length || ids.some(id => !/^[1-9]\d*$/.test(id) || !items.some(item => item.source.id === id)))) throw new Error('--ids debe contener IDs activos distintos, sin superar --limit.');
  let scope = items;
  if (ids) {
    scope = ids.map(id => items.find(item => item.source.id === id));
  } else if (fromId !== undefined || toId !== undefined) {
    scope = items.filter(({ source }) => {
      const id = Number(source.id);
      return id >= (fromId ?? 1) && id <= (toId ?? Infinity);
    }).sort((left, right) => Number(left.source.id) - Number(right.source.id));
  }
  const pending = scope.map(item => ({ ...item, requestHash: hash(JSON.stringify({ version, matchingVersion, item, maxPhotos })) })).filter(item => {
    const previous = state.items[item.source.id];
    return repeat || !previous || previous.requestHash !== item.requestHash || previous.status === 'en_proceso'
      || (retryErrors && ['error', 'acceso_interrumpido', 'interrumpido_por_usuario'].includes(previous.status));
  });
  return { selected: all ? pending : pending.slice(0, limit), pendingCount: pending.length };
}

async function loadItems() {
  const data = await readJson('data/restaurantes-con-ids.json').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return readJson('data/restaurantes-con-ids.geojson');
  });
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('El archivo restaurantes-con-ids debe contener una FeatureCollection GeoJSON.');
  }
  const mapping = await readJson('data/ids.json');
  const assignments = new Map(mapping.assignments.map(entry => [entry.signatura, entry._id]));
  const seen = new Set();
  return data.features.filter(({ properties: p }) =>
    p?.Grup === 'Restaurant' && p.Estat === 'Alta' && isMallorca(p.Municipi)).map(f => {
    const p = f.properties;
    const id = p._id;
    if (!/^[1-9]\d*$/.test(id) || seen.has(id) || assignments.get(p.Signatura) !== id) throw new Error('La fuente y el mapa de IDs no coinciden o contienen duplicados.');
    seen.add(id);
    const source = { id, signature: p.Signatura, name: p['Denominació comercial'], address: p['Direcció'], municipality: p.Municipi, locality: p.Localitat, coordinates: f.geometry?.type === 'Point' ? f.geometry.coordinates : null };
    const query = `${source.name}, ${source.address}, ${source.municipality}`;
    return { source, query, searchUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` };
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    ids: { type: 'string' }, 'desde-id': { type: 'string' }, 'hasta-id': { type: 'string' },
    limit: { type: 'string', default: '5' },
    'max-fotos': { type: 'string', default: '2' }, execute: { type: 'boolean', default: false },
    'retry-errors': { type: 'boolean', default: false }, repeat: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Uso: npm run recorrer -- [--ids 14,23 | --desde-id 3500 --hasta-id 4266] [--all | --limit 5] [--max-fotos 2] [--execute] [--retry-errors] [--repeat]\nSin --execute solo simula. --all recorre todos los pendientes; sin él procesa hasta 25. Los límites de ID son inclusivos. Chrome visible. --repeat requiere IDs explícitos.'); return;
  }
  if (values.all && process.argv.some(arg => arg === '--limit' || arg.startsWith('--limit='))) throw new Error('Elige --all o --limit, no ambos.');
  for (const option of ['desde-id', 'hasta-id']) {
    const value = values[option];
    if (value !== undefined && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      throw new Error(`--${option} debe ser un ID entero positivo.`);
    }
  }
  const fromId = values['desde-id'] === undefined ? undefined : Number(values['desde-id']);
  const toId = values['hasta-id'] === undefined ? undefined : Number(values['hasta-id']);
  if (fromId > toId) throw new Error('--desde-id debe ser menor o igual que --hasta-id.');
  if ((fromId !== undefined || toId !== undefined) && values.ids !== undefined) {
    throw new Error('Elige un intervalo de IDs o --ids, no ambos.');
  }
  const items = await loadItems();
  const options = {
    ids: values.ids?.split(','), fromId, toId,
    limit: Number(values.limit), maxPhotos: Number(values['max-fotos']),
    repeat: values.repeat, retryErrors: values['retry-errors'], all: values.all,
  };
  if (!values.execute) {
    const state = await reconcileMissingPhotos(compactProgress(await readJson(stateFile, { version, items: {} })), photoRoots);
    const selection = selectPending(items, state, options);
    console.log(JSON.stringify({ mode: 'simulacion', total: items.length, pending: selection.pendingCount, selectedCount: selection.selected.length, selected: selection.selected.slice(0,25).map(item => ({ id: item.source.id, name: item.source.name })), maxPhotos: options.maxPhotos }, null, 2));
    return;
  }
  const release = await acquireLock(path.join(root, 'ejecucion.lock'));
  let context;
  let stopped = false;
  const stop = () => { stopped = true; console.log('Interrupción solicitada: se conservará el progreso al terminar la operación actual.'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const state = await reconcileMissingPhotos(compactProgress(await readJson(stateFile, { version, items: {} })), photoRoots);
    const selection = selectPending(items, state, options);
    await prepareResultFolders();
    for (const { source } of items) {
      const previous = state.items[source.id];
      if (previous?.signature === source.signature) await saveRestaurantOutcome(source, previous.status);
    }
    if (!selection.selected.length) { console.log('No hay pendientes en esta selección; no se ha abierto Chrome.'); return; }
    const executablePath = await mapsBrowserExecutable();
    console.log(`Iniciando ${selection.selected.length} restaurantes pendientes; máximo ${options.maxPhotos} fotos por restaurante.`);
    context = await chromium.launchPersistentContext(profileDirectory(), { executablePath, headless: false, locale: 'es-ES', viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
    for (const [position, item] of selection.selected.entries()) {
      if (stopped) break;
      const id = item.source.id;
      if (!state.items[id]) await saveRestaurantOutcome(item.source, 'en_proceso');
      state.items[id] = { requestHash: item.requestHash, signature: item.source.signature, status: 'en_proceso' };
      await saveJson(stateFile, state);
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const result = { status: 'en_proceso' };
      try {
        result.search = await findRestaurant(page, item);
        result.status = result.search.status;
        if (result.status === 'coincidencia_probable' && !stopped) {
          const match = result.search.candidates.find(candidate => candidate.url === result.search.probableUrl);
          result.phone = match?.phone;
          result.menu = await collectMenu(page, item.source, result.search.probableUrl, { maxPhotos: options.maxPhotos, shouldStop: () => stopped });
          result.status = result.menu.status;
        }
        if (stopped) result.status = 'interrumpido_por_usuario';
      } catch (error) {
        result.status = error.interrupted ? 'acceso_interrumpido' : 'error'; result.error = error.message;
        console.error(`ID ${id}: ${error.message}`);
        process.exitCode = 1;
      } finally {
        await page.close();
      }
      const reason = result.status === 'pendiente_revision' && result.menu?.revalidation
        ? 'La ficha no superó la segunda comprobación.'
        : ['pendiente_revision', 'sin_coincidencia_confirmada'].includes(result.status) ? searchExplanation(result.search) : undefined;
      const folder = await saveRestaurantOutcome(item.source, result.status, {
        phone: result.phone, reason, listing: result.search?.probableUrl,
      });
      state.items[id].status = result.status;
      state.items[id].updatedAt = new Date().toISOString();
      await saveJson(stateFile, state);
      console.log(JSON.stringify({ id, name: item.source.name, status: result.status, photos: result.menu?.photos.length ?? 0, newPhotos: result.menu?.photos.filter(p => !p.duplicate).length ?? 0,
        avance: `${position + 1}/${selection.selected.length}`,
        ...(folder ? { carpeta: path.join(folder, id) } : {}),
        ...(reason ? { motivo: reason } : {}) }));
      if (result.status === 'acceso_interrumpido') { process.exitCode = 1; break; }
      if (!stopped && position < selection.selected.length - 1) await new Promise(resolve => setTimeout(resolve, 3000));
    }
    console.log(`Progreso: ${stateFile}`);
  } finally {
    try { await context?.close(); }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await release(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
}
