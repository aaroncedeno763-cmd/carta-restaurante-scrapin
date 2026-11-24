
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const ARCHIVOS = {
  conCarta: 'con-carta.json',
  sinCarta: 'sin-carta.json',
  errores: 'errores.json',
  progreso: 'progreso.json'
};

let colaEscrituras = Promise.resolve();

async function inicializar() {
  await fs.promises.mkdir(config.RESULTS_DIR, {
    recursive: true
  });

  await fs.promises.mkdir(config.OUTPUT_DIR, {
    recursive: true
  });

  for (const archivo of Object.values(ARCHIVOS)) {
    const destino = path.join(config.RESULTS_DIR, archivo);

    if (!fs.existsSync(destino)) {
      await fs.promises.writeFile(destino, '[]', 'utf8');
    }
  }
}

async function leer(nombre) {
  if (!ARCHIVOS[nombre]) {
    throw new Error(`Registro desconocido: ${nombre}`);
  }

  const destino = path.join(
    config.RESULTS_DIR,
    ARCHIVOS[nombre]
  );

  try {
    return JSON.parse(
      await fs.promises.readFile(destino, 'utf8')
    );
  } catch (error) {
    if (error.code === 'ENOENT') return [];

    throw new Error(
      `No se pudo leer ${ARCHIVOS[nombre]}: ${error.message}`
    );
  }
}

async function guardar(nombre, datos) {
  if (!ARCHIVOS[nombre]) {
    throw new Error(`Registro desconocido: ${nombre}`);
  }

  const destino = path.join(
    config.RESULTS_DIR,
    ARCHIVOS[nombre]
  );

  const temporal = `${destino}.tmp`;

  await fs.promises.writeFile(
    temporal,
    JSON.stringify(datos, null, 2),
    'utf8'
  );

  await fs.promises.rename(temporal, destino);
}

function registrar(nombre, registro) {
  const operacion = colaEscrituras.then(async () => {
    const datos = await leer(nombre);

    const indice = datos.findIndex(
      item => String(item.id) === String(registro.id)
    );

    if (indice >= 0) {
      datos[indice] = registro;
    } else {
      datos.push(registro);
    }

    await guardar(nombre, datos);
  });

  colaEscrituras = operacion.catch(error => {
    console.error(
      'Error guardando resultados:',
      error.message
    );
  });

  return operacion;
}

async function estaProcesado(id) {
  const datos = await leer('progreso');

  return datos.some(
    item =>
      String(item.id) === String(id) &&
      ['con_carta', 'sin_carta'].includes(item.estado)
  );
}

async function actualizarProgreso(registro) {
  return registrar('progreso', {
    id: registro.id,
    nombre: registro.nombre,
    estado: registro.estado,
    fecha: new Date().toISOString()
  });
}

module.exports = {
  inicializar,
  leer,
  guardar,
  registrar,
  estaProcesado,
  actualizarProgreso
};
