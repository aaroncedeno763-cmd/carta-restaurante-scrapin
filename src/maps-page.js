import { placeCoordinates } from './match-maps.js';

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
  await page.waitForFunction(() => Boolean(document.querySelector('[role="feed"], h1, [data-item-id="address"]'))
    || /No se han encontrado|No results|tráfico inusual|unusual traffic|Antes de ir|Before you continue|captcha/i.test(document.body.innerText), null, { timeout: 20000 });
}

export async function candidateDetails(page, url) {
  if (url !== page.url()) { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await ready(page); }
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
        await page.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await ready(page);
      }
      await page.locator('[data-item-id="address"]').first().waitFor({ state: 'visible', timeout: 7000 });
      if ((await page.locator('h1').first().innerText()) !== name) throw new Error('El enlace compartido abrió otra ficha.');
    } catch (error) { shareError = error.message; await page.keyboard.press('Escape').catch(() => {}); }
  }
  const text = await readPageText(page);
  const limited = /vista limitada|limited view/i.test(text);
  const blocked = /tráfico inusual|unusual traffic|no soy un robot|not a robot/i.test(text) || /\/sorry\//.test(page.url());
  return { name, address: address.replace(/^(Dirección|Address):\s*/i, ''), category, phone, url: page.url(),
    coordinates: shareError ? null : placeCoordinates(page.url()), permanentlyClosed: /Cerrado permanentemente|Permanently closed/i.test(text), limited, blocked };
}

