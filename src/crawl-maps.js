import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { profileDirectory } from './browser-profile.js';
import { hash, readJson, saveJson, acquireLock, ensureRestaurantRecord, reconcileMissingPhotos } from './storage.js';
import { searchExplanation } from './match-maps.js';
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

function selectPending(items, state, { limit, maxPhotos, ids, repeat, retryErrors, all = false }) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error('--limit debe estar entre 1 y 25.');
  if (!Number.isSafeInteger(maxPhotos) || maxPhotos < 1 || maxPhotos > 10) throw new Error('--max-fotos debe estar entre 1 y 10.');
  if (repeat && !ids) throw new Error('--repeat requiere una selección explícita con --ids.');
  if (all && ids) throw new Error('--all no se combina con --ids.');
  if (ids && (!ids.length || ids.length > limit || new Set(ids).size !== ids.length || ids.some(id => !/^[1-9]\d*$/.test(id) || !items.some(item => item.source.id === id)))) throw new Error('--ids debe contener IDs activos distintos, sin superar --limit.');
  const scope = ids ? ids.map(id => items.find(item => item.source.id === id)) : items;
  const pending = scope.map(item => ({ ...item, requestHash: hash(JSON.stringify({ version, matchingVersion, item, maxPhotos })) })).filter(item => {
    const previous = state.items[item.source.id];
    return repeat || !previous || previous.requestHash !== item.requestHash || previous.status === 'en_proceso'
      || (retryErrors && ['error', 'acceso_interrumpido', 'interrumpido_por_usuario'].includes(previous.status));
  });
  return { selected: all ? pending : pending.slice(0, limit), pendingCount: pending.length };
}

async function loadItems() {
  const data = await readJson('data/restaurantes-con-ids.geojson');
  const mapping = await readJson('data/ids.json');
  const assignments = new Map(mapping.assignments.map(entry => [entry.signatura, entry._id]));
  const seen = new Set();
  return data.features.filter(f => f.properties.Grup === 'Restaurant' && f.properties.Estat === 'Alta').map(f => {
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
    ids: { type: 'string' }, limit: { type: 'string', default: '5' },
    'max-fotos': { type: 'string', default: '2' }, execute: { type: 'boolean', default: false },
    'retry-errors': { type: 'boolean', default: false }, repeat: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Uso: npm run recorrer -- [--ids 14,23 | --all] [--limit 5] [--max-fotos 2] [--execute] [--retry-errors] [--repeat]\nSin --execute solo simula. --all recorre todos los pendientes; sin él procesa hasta 25. Chrome visible. --repeat requiere IDs explícitos.'); return;
  }
  const items = await loadItems();
  if (values.all && process.argv.some(arg => arg === '--limit' || arg.startsWith('--limit='))) throw new Error('Elige --all o --limit, no ambos.');
  const options = { ids: values.ids?.split(','), limit: Number(values.limit), maxPhotos: Number(values['max-fotos']), repeat: values.repeat, retryErrors: values['retry-errors'], all: values.all };
  let state = await reconcileMissingPhotos(compactProgress(await readJson(stateFile, { version, items: {} })));
  let selection = selectPending(items, state, options);
  if (!values.execute) { console.log(JSON.stringify({ mode: 'simulacion', total: items.length, pending: selection.pendingCount, selectedCount: selection.selected.length, selected: selection.selected.slice(0,25).map(item => ({ id: item.source.id, name: item.source.name })), maxPhotos: options.maxPhotos }, null, 2)); return; }
  if (!selection.selected.length) { console.log('No hay pendientes en esta selección; no se ha abierto Chrome.'); return; }
  const release = await acquireLock(path.join(root, 'ejecucion.lock'));
  let context;
  let stopped = false;
  const stop = () => { stopped = true; console.log('Interrupción solicitada: se conservará el progreso al terminar la operación actual.'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    state = await reconcileMissingPhotos(compactProgress(await readJson(stateFile, { version, items: {} })));
    selection = selectPending(items, state, options);
    if (!selection.selected.length) { console.log('No hay pendientes en esta selección; no se ha abierto Chrome.'); return; }
    console.log(`Iniciando ${selection.selected.length} restaurantes pendientes; máximo ${options.maxPhotos} fotos por restaurante.`);
    context = await chromium.launchPersistentContext(profileDirectory(), { channel: 'chrome', headless: false, locale: 'es-ES', viewport: { width: 1440, height: 1000 }, acceptDownloads: false });
    for (const [position, item] of selection.selected.entries()) {
      if (stopped) break;
      const id = item.source.id;
      await ensureRestaurantRecord(item.source);
      state.items[id] = { requestHash: item.requestHash, signature: item.source.signature, status: 'en_proceso' };
      await saveJson(stateFile, state);
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      let result = { source: item.source, status: 'en_proceso', date: new Date().toISOString() };
      try {
        result.search = await findRestaurant(page, item);
        result.status = result.search.status;
        if (result.status === 'coincidencia_probable' && !stopped) {
          const match = result.search.candidates.find(candidate => candidate.url === result.search.probableUrl);
          await ensureRestaurantRecord(item.source, 'cartas', { phone: match?.phone });
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
        state.items[id].status = result.status;
        state.items[id].updatedAt = new Date().toISOString();
        await saveJson(stateFile, state);
      }
      console.log(JSON.stringify({ id, name: item.source.name, status: result.status, photos: result.menu?.photos.length ?? 0, newPhotos: result.menu?.photos.filter(p => !p.duplicate).length ?? 0,
        avance: `${position + 1}/${selection.selected.length}`,
        ...(result.status === 'pendiente_revision' ? { motivo: result.menu?.revalidation ? 'La ficha no superó la segunda comprobación.' : searchExplanation(result.search) } : {}) }));
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
