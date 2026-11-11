import { readPageText, ready, candidateDetails } from './maps-page.js';
import { assessCandidate } from './match-maps.js';

export async function findRestaurant(page, item) {
  const result = { status: 'pendiente_revision', candidates: [] };
  await page.goto(item.searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ready(page);
  const text = await readPageText(page);
  if (/tráfico inusual|unusual traffic|no soy un robot|not a robot|Antes de ir|Before you continue/i.test(text) || /\/sorry\//.test(page.url())) {
    result.status = 'acceso_interrumpido'; return result;
  }
  const feed = page.getByRole('feed').first();
  let urls;
  if (await feed.isVisible()) {
    const all = await feed.locator('a[href*="/maps/place/"]').evaluateAll(links => [...new Set(links.map(a => a.href))]);
    urls = all.slice(0, 3);
    result.candidateLimitReached = all.length > 3;
  } else {
    urls = await page.locator('[data-item-id="address"]').first().isVisible() && await page.locator('h1').count() > 0 ? [page.url()] : [];
  }
  for (const url of urls) {
    const candidate = await candidateDetails(page, url);
    candidate.assessment = assessCandidate(item.source, candidate);
    if (candidate.limited || candidate.blocked) candidate.assessment.status = 'pendiente_revision';
    result.candidates.push(candidate);
    if (candidate.blocked) { result.status = 'acceso_interrumpido'; return result; }
  }
  const probable = result.candidates.filter(c => c.assessment.status === 'coincidencia_probable');
  result.status = probable.length === 1 && !result.candidateLimitReached ? 'coincidencia_probable'
    : !result.candidates.length ? 'sin_coincidencia_confirmada' : 'pendiente_revision';
  if (result.status === 'coincidencia_probable') result.probableUrl = probable[0].url;
  return result;
}
