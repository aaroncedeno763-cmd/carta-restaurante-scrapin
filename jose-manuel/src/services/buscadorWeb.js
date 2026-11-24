
const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config/config');

const DOMINIOS_EXCLUIDOS = [
  'google.com',
  'google.es',
  'facebook.com',
  'instagram.com',
  'tripadvisor.',
  'booking.com',
  'duckduckgo.com',
  'bing.com',
  'youtube.com',
  'wikipedia.org'
];

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizarUrl(url) {
  try {
    const parsed = new URL(url);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = '';

    return parsed.href;
  } catch {
    return null;
  }
}

function dominioExcluido(url) {
  const host = new URL(url).hostname.toLowerCase();

  return DOMINIOS_EXCLUIDOS.some(dominio =>
    host === dominio ||
    host.endsWith(`.${dominio}`) ||
    host.includes(dominio)
  );
}

function puntuarResultado(resultado, nombre, localidad) {
  const nombreNormalizado = normalizarTexto(nombre);
  const titulo = normalizarTexto(resultado.title);
  const url = normalizarTexto(resultado.url);
  const localidadNormalizada = normalizarTexto(localidad);

  const palabras = nombreNormalizado
    .split(' ')
    .filter(palabra => palabra.length > 1);

  let puntuacion = 0;

  for (const palabra of palabras) {
    if (titulo.includes(palabra)) puntuacion += 3;
    if (url.includes(palabra)) puntuacion += 1;
  }

  if (
    localidadNormalizada &&
    titulo.includes(localidadNormalizada)
  ) {
    puntuacion += 3;
  }

  if (
    localidadNormalizada &&
    url.includes(localidadNormalizada)
  ) {
    puntuacion += 1;
  }

  return puntuacion;
}

function agregarResultado(resultados, url, title) {
  url = normalizarUrl(url);

  if (!url || dominioExcluido(url)) return;

  const existente = resultados.find(item => item.url === url);

  if (!existente) {
    resultados.push({
      url,
      title: String(title || '').trim()
    });
  }
}

function extraerDuckDuckGo(html) {
  const $ = cheerio.load(html);
  const resultados = [];

  const selectores = [
    '.result__a',
    'a[data-testid="result-title-a"]',
    '.result a.result__url'
  ];

  for (const selector of selectores) {
    $(selector).each((_, element) => {
      let href = $(element).attr('href');
      const title = $(element).text().trim();

      if (!href) return;

      try {
        const parsed = new URL(href, 'https://duckduckgo.com');

        if (parsed.searchParams.has('uddg')) {
          href = parsed.searchParams.get('uddg');
        }
      } catch {
        return;
      }

      agregarResultado(resultados, href, title);
    });

    if (resultados.length) break;
  }

  return resultados;
}

function extraerBing(html) {
  const $ = cheerio.load(html, { xmlMode: true });
  const resultados = [];

  $('item').each((_, element) => {
    const url = $(element).find('link').first().text().trim();
    const title = $(element).find('title').first().text().trim();

    agregarResultado(resultados, url, title);
  });

  return resultados;
}

async function consultarDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await axios.get(url, {
    timeout: config.REQUEST_TIMEOUT,
    maxContentLength: 2 * 1024 * 1024,
    headers: {
      'User-Agent': config.USER_AGENT,
      'Accept': 'text/html'
    }
  });

  return extraerDuckDuckGo(response.data);
}

async function consultarBing(query) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;

  const response = await axios.get(url, {
    timeout: config.REQUEST_TIMEOUT,
    maxContentLength: 2 * 1024 * 1024,
    headers: {
      'User-Agent': config.USER_AGENT,
      'Accept': 'application/rss+xml, application/xml, text/xml'
    }
  });

  return extraerBing(response.data);
}

async function buscarWeb(restaurante) {
  const nombre = restaurante.nombre || '';
  const localidad = restaurante.localidad || restaurante.municipio || '';

  const consultas = [
    `"${nombre}" restaurante ${localidad} Mallorca`,
    `${nombre} restaurante ${localidad}`,
    `"${nombre}" ${localidad} carta restaurante`
  ];

  const resultados = [];
  const buscadores = [
    {
      nombre: 'DuckDuckGo',
      buscar: consultarDuckDuckGo
    },
    {
      nombre: 'Bing',
      buscar: consultarBing
    }
  ];

  for (const consulta of consultas) {
    for (const buscador of buscadores) {
      try {
        const encontrados = await buscador.buscar(consulta);

        for (const resultado of encontrados) {
          agregarResultado(
            resultados,
            resultado.url,
            resultado.title
          );
        }
      } catch (error) {
        console.error(
          `${buscador.nombre} no disponible para ${nombre}: ${error.message}`
        );
      }
    }
  }

  return resultados
    .map(resultado => ({
      ...resultado,
      puntuacion: puntuarResultado(resultado, nombre, localidad)
    }))
    .filter(resultado => resultado.puntuacion > 0)
    .sort((a, b) => b.puntuacion - a.puntuacion);
}

module.exports = {
  buscarWeb
};
