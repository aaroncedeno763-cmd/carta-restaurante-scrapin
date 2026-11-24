
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');
const { detectarEnlaces } = require('./detectorCartas');

async function extraerCartas(urlInicial) {
  const visitadas = new Set();
  const pendientes = [urlInicial];
  const archivos = [];

  let dominioInicial;

  try {
    dominioInicial = new URL(urlInicial).hostname
      .replace(/^www\./, '');
  } catch {
    return {
      paginasVisitadas: 0,
      archivos: []
    };
  }

  while (
    pendientes.length > 0 &&
    visitadas.size < config.MAX_PAGES_PER_SITE
  ) {
    const url = pendientes.shift();

    if (visitadas.has(url)) continue;

    visitadas.add(url);

    const encontrados = await detectarEnlaces(url);

    archivos.push(...encontrados);

    try {
      const response = await axios.get(url, {
        timeout: config.REQUEST_TIMEOUT,
        headers: {
          'User-Agent': config.USER_AGENT
        }
      });

      const $ = cheerio.load(response.data);

      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');

        if (!href) return;

        const texto = $(element).text().trim().toLowerCase();

        try {
          const absoluta = new URL(href, url);
          const dominio = absoluta.hostname.replace(/^www\./, '');

          if (dominio !== dominioInicial) return;

          if (!['http:', 'https:'].includes(absoluta.protocol)) return;

          if (visitadas.has(absoluta.href)) return;

          if (
            pendientes.includes(absoluta.href) ||
            pendientes.length >= config.MAX_PAGES_PER_SITE
          ) return;

          const ruta = absoluta.pathname.toLowerCase();

          const relevante =
            config.MENU_TERMS.some(term =>
              `${ruta} ${texto}`.includes(term)
            );

          if (relevante) {
            pendientes.push(absoluta.href);
          }
        } catch {
          // Ignorar enlaces inválidos.
        }
      });
    } catch {
      // La página puede haber dejado de estar disponible.
    }

    await new Promise(resolve =>
      setTimeout(resolve, config.DELAY_BETWEEN_REQUESTS)
    );
  }

  const unicos = new Map();

  for (const archivo of archivos) {
    unicos.set(archivo.url, archivo);
  }

  return {
    paginasVisitadas: visitadas.size,
    archivos: [...unicos.values()]
  };
}

module.exports = {
  extraerCartas
};
