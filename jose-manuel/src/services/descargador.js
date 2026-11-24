
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');

function nombreSeguro(nombre) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 70) || 'archivo';
}

async function descargarArchivo(archivo, carpeta) {
  try {
    const response = await axios.get(archivo.url, {
      responseType: 'arraybuffer',
      timeout: config.REQUEST_TIMEOUT,
      maxRedirects: 5,
      maxContentLength: config.MAX_DOWNLOAD_BYTES,
      headers: {
        'User-Agent': config.USER_AGENT
      }
    });

    const buffer = Buffer.from(response.data);

    if (!buffer.length || buffer.length > config.MAX_DOWNLOAD_BYTES) {
      return null;
    }

    const contentType = String(
      response.headers['content-type'] || ''
    ).toLowerCase();

    let extension = '';

    if (
      contentType.includes('pdf') ||
      archivo.tipo === 'pdf' ||
      new URL(archivo.url).pathname.toLowerCase().endsWith('.pdf')
    ) {
      extension = '.pdf';
    } else if (
      contentType.includes('png') ||
      archivo.url.toLowerCase().includes('.png')
    ) {
      extension = '.png';
    } else if (
      contentType.includes('webp') ||
      archivo.url.toLowerCase().includes('.webp')
    ) {
      extension = '.webp';
    } else if (
      contentType.includes('jpeg') ||
      contentType.includes('jpg') ||
      /\.(jpe?g)(?:$|[?#])/i.test(archivo.url)
    ) {
      extension = '.jpg';
    } else {
      return null;
    }

    if (extension === '.pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') {
      return null;
    }

    if (
      ['.png', '.jpg', '.webp'].includes(extension) &&
      buffer.length < 5000
    ) {
      return null;
    }

    const hash = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');

    await fs.promises.mkdir(carpeta, {
      recursive: true
    });

    const nombre = `${nombreSeguro(archivo.texto || 'carta')}_${hash.slice(0, 10)}${extension}`;
    const destino = path.join(carpeta, nombre);

    await fs.promises.writeFile(destino, buffer, {
      flag: 'wx'
    }).catch(error => {
      if (error.code !== 'EEXIST') throw error;
    });

    return {
      nombre,
      ruta: destino,
      url: archivo.url,
      extension,
      tamano: buffer.length,
      hash
    };
  } catch (error) {
    console.error(
      `Error descargando ${archivo.url}: ${error.message}`
    );

    return null;
  }
}

module.exports = {
  descargarArchivo
};
