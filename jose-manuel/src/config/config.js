
const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env')
});

const ROOT = path.resolve(__dirname, '../..');

module.exports = {
  ROOT,
  INPUT_DIR: path.join(ROOT, 'faltan las cartas'),
  OUTPUT_DIR: path.join(ROOT, 'cartas encontradas'),
  RESULTS_DIR: path.join(ROOT, 'resultados'),

  CONCURRENCY: Math.max(1, Number(process.env.CONCURRENCY) || 2),
  REQUEST_TIMEOUT: Number(process.env.REQUEST_TIMEOUT) || 20000,
  MAX_PAGES_PER_SITE: Number(process.env.MAX_PAGES_PER_SITE) || 15,
  MAX_DOWNLOAD_BYTES:
    (Number(process.env.MAX_DOWNLOAD_MB) || 30) * 1024 * 1024,
  DELAY_BETWEEN_REQUESTS:
    Number(process.env.DELAY_BETWEEN_REQUESTS) || 1200,

  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',

  MENU_TERMS: [
    'carta',
    'menu',
    'menú',
    'menus',
    'menús',
    'food',
    'restaurant-menu',
    'menu-restaurante',
    'carta-restaurante',
    'nuestra-carta',
    'la-carta',
    'our-menu',
    'food-menu',
    'gastronomia',
    'gastronomía'
  ],

  IMAGE_EXTENSIONS: [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp'
  ],

  PDF_EXTENSION: '.pdf'
};
