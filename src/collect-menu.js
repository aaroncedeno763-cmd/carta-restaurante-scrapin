import { candidateDetails, readPageText } from './maps-page.js';
import { assessCandidate } from './match-maps.js';
import { storePhoto } from './storage.js';

function viewerImage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)(googleusercontent\.com|ggpht\.com)$/.test(parsed.hostname)
      && /\/(grass-cs|gpms-cs-s)\//.test(parsed.pathname) && Number(url.match(/=s(\d+)/)?.[1]) >= 1024;
  } catch { return false; }
}

const imageResourceKey = url => new URL(url).pathname.replace(/=s\d+[^/]*$/, '');

async function bytesFromResponse(response, context) {
  const maxBytes = 20 * 1024 * 1024;
  if (Number(response.headers()['content-length']) > maxBytes) throw new Error('Imagen mayor de 20 MB.');
  try { const body = await response.body(); if (body.length > maxBytes) throw new Error('Imagen mayor de 20 MB.'); return body; }
  catch (error) {
    if (/20 MB/.test(error.message)) throw error;
    // Reintentos limitados solo del recurso observado, nunca de CAPTCHA o denegación.
    for (let attempt = 0; attempt < 3; attempt++) {
      let request;
      try {
        request = await context.request.get(response.url(), { timeout: 20000, maxRedirects: 0, maxRetries: 0 });
        if ([401,403,429].includes(request.status())) throw Object.assign(new Error(`Acceso interrumpido al descargar: HTTP ${request.status()}`), { interrupted: true });
        if (!request.ok()) throw Object.assign(new Error(`Imagen: HTTP ${request.status()}`), { permanent: request.status() < 500 });
        if (!request.headers()['content-type']?.startsWith('image/') || Number(request.headers()['content-length']) > maxBytes) throw Object.assign(new Error('Respuesta de imagen no válida.'), { permanent: true });
        const body = await request.body();
        if (body.length > maxBytes) throw Object.assign(new Error('Imagen mayor de 20 MB.'), { permanent: true });
        return body;
      } catch (error) {
        if (error.interrupted || error.permanent || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      } finally { await request?.dispose(); }
    }
  }
}

export async function collectMenu(page, source, listingUrl, { maxPhotos = 2, shouldStop = () => false } = {}) {
  const candidate = await candidateDetails(page, listingUrl);
  const assessment = assessCandidate(source, candidate);
  if (candidate.blocked) return { status: 'acceso_interrumpido', photos: [] };
  if (candidate.limited || assessment.status !== 'coincidencia_probable') return { status: 'pendiente_revision', photos: [], revalidation: assessment };
  const result = { status: 'sin_fotos_de_menu_en_esta_vista', photos: [], revalidation: assessment, identity: 'coincidencia_probable' };
  const listing = candidate.url;
  for (let index = 1; index <= maxPhotos && !shouldStop(); index++) {
    if (index > 1) { await page.goto(listing, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    const panel = page.getByRole('main');
    const menu = panel.getByRole('tab', { name: /^(Carta|Menú|Menu|Menus|Menús)$/i }).or(panel.getByRole('button', { name: /^(Carta|Menú|Menu|Menus|Menús)$/i })).first();
    try { await menu.waitFor({ state: 'visible', timeout: 7000 }); }
    catch (error) { if (error.name !== 'TimeoutError') throw error; result.status = 'sin_seccion_menu_en_esta_vista'; break; }
    await menu.click();
    const region = panel.getByRole('region', { name: /^(Menú|Menu|Carta)$/i }).first();
    await region.waitFor({ state: 'visible', timeout: 10000 });
    const photo = region.getByRole('button', { name: new RegExp(`^(Foto|Photo) ${index} (de|of) \\d+$`, 'i') }).first();
    try { await photo.waitFor({ state: 'attached', timeout: 3000 }); }
    catch (error) { if (error.name !== 'TimeoutError') throw error; break; }
    result.menuPhotoCount = Number((await photo.getAttribute('aria-label')).match(/(\d+)$/)?.[1]);
    if (index > result.menuPhotoCount) break;
    const responses = [];
    let denied = false;
    const listener = response => {
      if (!viewerImage(response.url())) return;
      if ([401,403,429].includes(response.status())) denied = true;
      if (response.ok() && response.headers()['content-type']?.startsWith('image/')) responses.push(response);
    };
    page.on('response', listener);
    try {
      const firstResponse = page.waitForResponse(response => viewerImage(response.url()) && response.ok(), { timeout: 15000 });
      // Registrar el rechazo inmediatamente, incluso si falla el clic.
      firstResponse.catch(() => {});
      await photo.scrollIntoViewIfNeeded();
      await photo.click();
      const first = await firstResponse;
      const imagePath = imageResourceKey(first.url());
      if (!responses.some(r => imageResourceKey(r.url()) === imagePath && Number(r.url().match(/=s(\d+)/)?.[1]) >= 2048)) {
        await page.waitForResponse(r => viewerImage(r.url()) && imageResourceKey(r.url()) === imagePath && Number(r.url().match(/=s(\d+)/)?.[1]) >= 2048, { timeout: 3000 }).catch(error => { if (error.name !== 'TimeoutError') throw error; });
      }
      const best = responses.filter(r => imageResourceKey(r.url()) === imagePath).sort((a,b) => Number(b.url().match(/=s(\d+)/)?.[1]) - Number(a.url().match(/=s(\d+)/)?.[1]))[0] ?? first;
      const bytes = await bytesFromResponse(best, page.context());
      const text = await readPageText(page);
      const reportLink = await page.locator('a[href*="postId="]').first().getAttribute('href').catch(() => null);
      const photoId = reportLink?.match(/!2s([^!&]+)/)?.[1] ?? null;
      const stored = await storePhoto({ source, bytes, provenance: {
        origen: 'Google Maps', url_ficha: listing, url_foto: page.url(), foto_id_maps: photoId,
        url_imagen: best.url(), fecha_foto_mostrada: text.match(/Foto\s*-\s*([^\n]+)/)?.[1] ?? null,
        metodo: 'Foto abierta desde la sección Carta/Menú; bytes de la respuesta observada del navegador.',
        identidad: 'coincidencia_probable',
      } });
      result.photos.push({ index, photoId, ...stored });
      result.status = 'cartas_recopiladas_pendientes_revision_visual';
      console.log(JSON.stringify({ id: source.id, photo: index, duplicate: stored.duplicate, file: stored.file }));
    } catch (error) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (denied || /tráfico inusual|unusual traffic|no soy un robot|not a robot/i.test(text) || /\/sorry\//.test(page.url())) error.interrupted = true;
      throw error;
    } finally { page.off('response', listener); }
  }
  if (result.menuPhotoCount > result.photos.length) result.partial = true;
  return result;
}
