import { normalize } from './match-maps.js';

// Municipios de Mallorca, según la división municipal de la isla.
const municipalities = new Set([
  'alaro', 'alcudia', 'algaida', 'andratx', 'ariany', 'arta', 'banyalbufar', 'binissalem',
  'buger', 'bunyola', 'calvia', 'campanet', 'campos', 'capdepera', 'consell', 'costitx',
  'deia', 'escorca', 'esporles', 'estellencs', 'felanitx', 'fornalutx', 'inca',
  'lloret de vistalegre', 'lloseta', 'llubi', 'llucmajor', 'manacor', 'mancor de la vall',
  'maria de la salut', 'marratxi', 'montuiri', 'muro', 'palma', 'petra', 'pollenca',
  'porreres', 'puigpunyent', 'sa pobla', 'sant joan', 'sant llorenc des cardassar',
  'santa eugenia', 'santa margalida', 'santa maria del cami', 'santanyi', 'selva',
  'sencelles', 'ses salines', 'sineu', 'soller', 'son servera', 'valldemossa', 'vilafranca de bonany',
]);

export function isMallorca(municipality) {
  return municipalities.has(normalize(municipality));
}
