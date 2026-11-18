import { placeCoordinates } from './match-maps.js';

const accessDenied = /tráfico inusual|unusual traffic|no soy un robot|not a robot|antes de ir|before you continue|captcha/i;

function interrupted(message) {
  return Object.assign(new Error(message), { interrupted: true });
}

export async function navigateMaps(page, url) {
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (error) {
    if (/net::ERR_(TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED)/.test(error.message)) {
      throw interrupted('No se pudo conectar a Maps a través del proxy.');
    }
    if (error.message.includes('net::ERR_BLOCKED_BY_ADMINISTRATOR')) {
      throw interrupted('La política del navegador bloqueó la navegación a Maps.');
    }
    throw error;
  }
  const status = response?.status();
  if ([401, 403, 429].includes(status)) throw interrupted(`Maps interrumpió el acceso: HTTP ${status}.`);
  if (status >= 400) throw new Error(`Error de navegación en Maps: HTTP ${status}.`);
  if (/\/sorry\//.test(page.url())) throw interrupted('Maps mostró una verificación de acceso.');
}

function parsePhone(value) {
  const text = String(value ?? '').replace(/^(Teléfono|Telefono|Phone|Telephone)\s*:\s*/i, '').replace(/^tel:/i, '').trim();
  const phone = text.match(/^\+?[\d\s()./-]+$/)?.[0]?.replace(/\s+/g, ' ');
  const digits = phone?.replace(/\D/g, '').length ?? 0;
  return digits >= 7 && digits <= 15 ? phone : null;
}

export async function readPageText(page) {
  return page.locator('body').innerText();
}

export async function ready(page) {
  const reject = page.getByRole('button', { name: /^(Rechazar todo|Reject all)$/i }).first();
  try { await reject.waitFor({ state: 'visible', timeout: 2000 }); await reject.click(); }
  catch (error) { if (error.name !== 'TimeoutError') throw error; }
  await page.waitForFunction(blockPattern => Boolean(document.querySelector('[role="feed"], h1, [data-item-id="address"]'))
    || /No se han encontrado|No results/i.test(document.body.innerText)
    || new RegExp(blockPattern, 'i').test(document.body.innerText), accessDenied.source, { timeout: 20000 });
  if (accessDenied.test(await readPageText(page))) throw interrupted('Maps mostró un aviso de acceso o de verificación.');
}

export async function candidateDetails(page, url) {
  if (url !== page.url()) { await navigateMaps(page, url); await ready(page); }
  const addressControl = page.locator('[data-item-id="address"]').first();
  await addressControl.waitFor({ state: 'visible', timeout: 7000 }).catch(error => { if (error.name !== 'TimeoutError') throw error; });
  const name = await page.locator('h1').first().innerText();
  const address = await addressControl.getAttribute('aria-label').catch(() => null)
    ?? await addressControl.innerText().catch(() => '');
  const category = await page.locator('button[jsaction*="category"]').first().innerText().catch(() => '');
  const phoneControls = page.getByRole('main').locator('[data-item-id^="phone:tel:"], a[href^="tel:"]');
  let phone = null;
  for (const control of await phoneControls.all()) {
    if (!await control.isVisible()) continue;
    phone = parsePhone(await control.getAttribute('aria-label'))
      ?? parsePhone(await control.innerText())
      ?? parsePhone(await control.getAttribute('href'))
      ?? parsePhone((await control.getAttribute('data-item-id'))?.replace(/^phone:/, ''));
    if (phone) break;
  }
  let shareUrl = null;
  let shareError = null;
  // Una búsqueda resuelta puede mantener /search/ y ocultar las coordenadas.
  // El enlace público de Compartir identifica la ficha, sin inferir el centro del mapa.
  if (!placeCoordinates(page.url())) {
    try {
      await page.getByRole('main').getByRole('button', { name: /^Compartir$|^Share$/i }).first().click();
      await page.waitForFunction(() => /!3d-?\d+(?:\.\d+)?!4d-?\d+/.test(location.href)
        || [...document.querySelectorAll('input')].some(input => /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|www\.google\.[^/]+\/maps)/.test(input.value)), null, { timeout: 7000 });
      if (placeCoordinates(page.url())) {
        shareUrl = page.url();
        await page.keyboard.press('Escape');
      } else {
        shareUrl = await page.locator('input').evaluateAll(inputs => inputs.map(input => input.value).find(value => /^https:\/\/(maps\.app\.goo\.gl|goo\.gl|www\.google\.[^/]+\/maps)/.test(value)));
        await navigateMaps(page, shareUrl);
        await ready(page);
      }
      await page.locator('[data-item-id="address"]').first().waitFor({ state: 'visible', timeout: 7000 });
      if ((await page.locator('h1').first().innerText()) !== name) throw new Error('El enlace compartido abrió otra ficha.');
    } catch (error) {
      if (error.interrupted) throw error;
      shareError = error.message;
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  const text = await readPageText(page);
  const limited = /vista limitada|limited view/i.test(text);
  const blocked = accessDenied.test(text) || /\/sorry\//.test(page.url());
  return { name, address: address.replace(/^(Dirección|Address):\s*/i, ''), category, phone, url: page.url(),
    coordinates: shareError ? null : placeCoordinates(page.url()), permanentlyClosed: /Cerrado permanentemente|Permanently closed/i.test(text), limited, blocked };
}

