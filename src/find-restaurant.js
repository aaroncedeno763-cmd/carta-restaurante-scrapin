import { navigateMaps, ready, candidateDetails } from './maps-page.js';
import { assessCandidate } from './match-maps.js';

export async function findRestaurant(page, item) {
  const result = { status: 'pendiente_revision', candidates: [] };
  await navigateMaps(page, item.searchUrl);
  await ready(page);
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
    if (candidate.limited) candidate.assessment.status = 'pendiente_revision';
    result.candidates.push(candidate);
  }
  const probable = result.candidates.filter(c => c.assessment.status === 'coincidencia_probable');
  const needsReview = result.candidateLimitReached || result.candidates.some(candidate => {
    const { name, street, locality, coordinates } = candidate.assessment.checks;
    return candidate.limited || (name && (street || locality || coordinates === true));
  });
  result.status = probable.length === 1 && !result.candidateLimitReached ? 'coincidencia_probable'
    : needsReview ? 'pendiente_revision' : 'sin_coincidencia_confirmada';
  if (result.status === 'coincidencia_probable') result.probableUrl = probable[0].url;
  return result;
}
