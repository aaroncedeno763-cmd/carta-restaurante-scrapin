export const normalize = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const meaningful = value => normalize(value).split(' ').filter(w => w && !['restaurante', 'restaurant', 'resto', 'bar', 'es', 'el', 'la', 'de', 'del', 'carrer', 'calle', 'passeig', 'paseo', 'avinguda', 'avenida'].includes(w));

export function distanceMeters(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2
    || ![...a, ...b].every(Number.isFinite) || [a, b].some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)) return null;
  const rad = v => v * Math.PI / 180;
  const d = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(Math.max(0, 1 - d))));
}

export function placeCoordinates(url) {
  // @lat,lon es el centro de la cámara y no demuestra la ubicación del negocio.
  const matches = [...String(url).matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)];
  return matches.length ? [Number(matches.at(-1)[2]), Number(matches.at(-1)[1])] : null;
}

export function assessCandidate(source, candidate) {
  const name = meaningful(source.name);
  const candidateName = new Set(meaningful(candidate.name));
  const address = normalize(candidate.address);
  const street = meaningful(source.address.split(',')[0]);
  const number = source.address.match(/,\s*(\d+[a-z]?)(?=\s|[.,]|$)/i)?.[1];
  const addressTokens = address.split(' ');
  const distance = distanceMeters(source.coordinates, candidate.coordinates);
  const locality = [source.municipality, source.locality].map(normalize).filter(x => x && x.length > 3 && !['port el', 'palma mallorca'].includes(x));
  const checks = {
    name: name.length > 0 && name.every(token => candidateName.has(token)),
    street: street.length > 0 && street.every(token => addressTokens.includes(token)),
    number: Boolean(number) && addressTokens.includes(normalize(number)),
    locality: locality.some(value => ` ${address} `.includes(` ${value} `)),
    coordinates: source.coordinates == null ? null : distance !== null && distance <= 100,
    restaurantCategory: /restaurant|restaurante|comida|tapas|pizzeria|asador|cafeteria|bar\b/.test(normalize(candidate.category))
      && !/discoteca|night club|colegio|escuela|banco|hotel/.test(normalize(candidate.category)),
    open: !candidate.permanentlyClosed,
  };
  const addressOnly = source.coordinates == null;
  const addressUncertain = /\bs\s*\/\s*n\b/i.test(source.address);
  const reasons = Object.entries(checks).filter(([, ok]) => ok === false).map(([key]) => key);
  if (addressOnly && addressUncertain) reasons.push('incompleteAddress');
  return { checks, distanceMeters: distance, verificationMethod: addressOnly ? 'nombre_y_direccion' : 'nombre_direccion_y_coordenadas',
    status: reasons.length === 0 ? 'coincidencia_probable' : 'pendiente_revision', reasons };
}

export function searchExplanation(search) {
  if (!search.candidates?.length) return search.status === 'acceso_interrumpido' ? 'Maps ha interrumpido el acceso.' : 'No se encontró una ficha verificable.';
  if (search.candidateLimitReached) return 'Hay varios candidatos; no se puede elegir una ficha con certeza.';
  const labels = { name: 'nombre diferente', street: 'calle diferente', number: 'número ausente o diferente', locality: 'municipio o localidad diferente', coordinates: 'coordenadas ausentes o a más de 100 m', restaurantCategory: 'categoría no compatible', open: 'cierre permanente', incompleteAddress: 'dirección sin número fiable' };
  const best = [...search.candidates].sort((a,b) => a.assessment.reasons.length - b.assessment.reasons.length)[0];
  if (best.blocked) return 'Maps ha interrumpido el acceso.';
  if (best.limited) return 'Maps está mostrando una vista limitada.';
  const reasons = best.assessment.reasons.map(reason => labels[reason] ?? reason);
  return reasons.length ? `Sin descarga: ${reasons.join('; ')}.` : 'Hay más de una coincidencia posible.';
}
