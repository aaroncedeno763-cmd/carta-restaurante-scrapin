
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const { buscarWeb } = require('../services/buscadorWeb');
const { extraerCartas } = require('../services/extractorCartas');
const { descargarArchivo } = require('../services/descargador');
const { verificarArchivo } = require('../services/verificador');

const registro = require('./registro');

async function cargarRestaurantes() {
  const carpetas = await fs.promises.readdir(
    config.INPUT_DIR,
    { withFileTypes: true }
  );

  const restaurantes = [];

  for (const carpeta of carpetas) {
    if (!carpeta.isDirectory()) continue;

    const archivo = path.join(
      config.INPUT_DIR,
      carpeta.name,
      'restaurante.json'
    );

    if (!fs.existsSync(archivo)) continue;

    try {
      const restaurante = JSON.parse(
        await fs.promises.readFile(archivo, 'utf8')
      );

      if (!restaurante._id || !restaurante.nombre) {
        console.warn(`Datos incompletos: ${archivo}`);
        continue;
      }

      restaurantes.push(restaurante);
    } catch (error) {
      console.error(
        `Error leyendo ${archivo}: ${error.message}`
      );
    }
  }

  return restaurantes;
}

async function procesarRestaurante(restaurante) {
  const id = String(restaurante._id);
  const nombre = restaurante.nombre;

  console.log(`\nInvestigando: ${nombre} (${id})`);

  try {
    const resultadosBusqueda = await buscarWeb(restaurante);

    if (!resultadosBusqueda.length) {
      const resultado = {
        id,
        nombre,
        estado: 'web_no_encontrada',
        fecha: new Date().toISOString()
      };

      await registro.registrar('errores', resultado);

      await registro.actualizarProgreso({
        ...resultado,
        estado: 'pendiente_revision'
      });

      console.log(`No se encontró la web: ${nombre}`);
      return;
    }

    const web = resultadosBusqueda[0].url;

    console.log(`Web encontrada: ${web}`);

    const exploracion = await extraerCartas(web);

    const carpeta = path.join(config.OUTPUT_DIR, id);

    const archivosDescargados = [];

    for (const archivo of exploracion.archivos) {
      const descargado = await descargarArchivo(
        archivo,
        carpeta
      );

      if (!descargado) continue;

      const verificacion = await verificarArchivo(descargado);

      archivosDescargados.push({
        ...descargado,
        verificacion
      });
    }

    const verificados = archivosDescargados.filter(
      archivo => archivo.verificacion.valido
    );

    const candidatos = archivosDescargados.filter(
      archivo => !archivo.verificacion.valido
    );

    const tieneCarta = verificados.length > 0;

    if (archivosDescargados.length > 0) {
      await fs.promises.writeFile(
        path.join(carpeta, 'restaurante.json'),
        JSON.stringify({
          ...restaurante,
          web_encontrada: web,
          fecha_investigacion: new Date().toISOString(),
          paginas_visitadas: exploracion.paginasVisitadas,
          archivos: archivosDescargados.map(archivo => ({
            nombre: archivo.nombre,
            url: archivo.url,
            extension: archivo.extension,
            tamano: archivo.tamano,
            verificacion: archivo.verificacion
          }))
        }, null, 2),
        'utf8'
      );
    }

    if (tieneCarta || candidatos.length > 0) {
      const resultado = {
        id,
        nombre,
        web,
        estado: tieneCarta
          ? 'carta_encontrada'
          : 'candidatos_pendientes_revision',
        archivos: archivosDescargados.map(archivo => ({
          nombre: archivo.nombre,
          extension: archivo.extension,
          verificacion: archivo.verificacion
        })),
        fecha: new Date().toISOString()
      };

      await registro.registrar('conCarta', resultado);

      await registro.actualizarProgreso({
        ...resultado,
        estado: tieneCarta
          ? 'con_carta'
          : 'pendiente_revision'
      });
    } else {
      const resultado = {
        id,
        nombre,
        web,
        estado: 'sin_carta_detectada',
        fecha: new Date().toISOString()
      };

      await registro.registrar('sinCarta', resultado);

      await registro.actualizarProgreso({
        ...resultado,
        estado: 'sin_carta'
      });
    }

    console.log(
      `Finalizado: ${nombre}. ` +
      `${verificados.length} verificadas, ` +
      `${candidatos.length} pendientes de revisión.`
    );
  } catch (error) {
    console.error(
      `Error procesando ${nombre}: ${error.message}`
    );

    const resultado = {
      id,
      nombre,
      estado: 'error',
      error: error.message,
      fecha: new Date().toISOString()
    };

    await registro.registrar('errores', resultado);

    await registro.actualizarProgreso({
      ...resultado,
      estado: 'error'
    });
  }
}

async function procesarTodos() {
  await registro.inicializar();

  if (!fs.existsSync(config.INPUT_DIR)) {
    throw new Error(
      `No existe la carpeta de entrada: ${config.INPUT_DIR}`
    );
  }

  const restaurantes = await cargarRestaurantes();

  console.log(
    `Establecimientos encontrados: ${restaurantes.length}`
  );

  const pendientes = [];

  for (const restaurante of restaurantes) {
    const id = String(restaurante._id);

    if (!(await registro.estaProcesado(id))) {
      pendientes.push(restaurante);
    }
  }

  console.log(
    `Pendientes de investigar: ${pendientes.length}`
  );

  let indice = 0;

  async function trabajador() {
    while (indice < pendientes.length) {
      const restaurante = pendientes[indice++];
      await procesarRestaurante(restaurante);
    }
  }

  const trabajadores = Array.from(
    {
      length: Math.min(
        config.CONCURRENCY,
        pendientes.length
      )
    },
    () => trabajador()
  );

  await Promise.all(trabajadores);

  console.log('\nInvestigación terminada.');
}

module.exports = {
  cargarRestaurantes,
  procesarRestaurante,
  procesarTodos
};
