
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');

function contieneTermino(texto) {
  const normalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return config.MENU_TERMS.some(term =>
    normalizado.includes(
      term.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    )
  );
}

function obtenerExtension(url) {
  try {
    return new URL(url).pathname.toLowerCase().split('.').pop();
  } catch {
    return '';
  }
}

async function detectarEnlaces(url) {
  try {
    const response = await axios.get(url, {
      timeout: config.REQUEST_TIMEOUT,
      maxRedirects: 5,
      headers: {
        'User-Agent': config.USER_AGENT
      }
    });

    const $ = cheerio.load(response.data);
    const resultados = [];

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const texto = [
        $(element).text(),
        $(element).attr('title'),
        $(element).attr('aria-label'),
        href
      ].filter(Boolean).join(' ');

      if (!href) return;

      let absoluta;

      try {
        absoluta = new URL(href, url).href;
      } catch {
        return;
      }

      if (!['http:', 'https:'].includes(new URL(absoluta).protocol)) {
        return;
      }

      const extension = obtenerExtension(absoluta);

      const esPdf = extension === 'pdf';

      if (esPdf || contieneTermino(texto)) {
        resultados.push({
          url: absoluta,
          texto: texto.trim(),
          tipo: esPdf ? 'pdf' : 'pagina'
        });
      }
    });

    $('img').each((_, element) => {
      const src = $(element).attr('src') ||
        $(element).attr('data-src');

      if (!src) return;

      const texto = [
        $(element).attr('alt'),
        $(element).attr('title'),
        src
      ].filter(Boolean).join(' ');

      if (!contieneTermino(texto)) return;

      try {
        resultados.push({
          url: new URL(src, url).href,
          texto,
          tipo: 'imagen'
        });
      } catch {
        // URL no válida.
      }
    });

    return resultados;
  } catch (error) {
    console.error(
      `Error detectando cartas en ${url}: ${error.message}`
    );

    return [];
  }
}

module.exports = {
  detectarEnlaces,
  contieneTermino
};
