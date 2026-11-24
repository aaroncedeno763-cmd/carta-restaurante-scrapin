
const fs = require('fs');
const pdf = require('pdf-parse');

const TERMINOS_CARTA = [
  'menu',
  'menú',
  'carta',
  'entrantes',
  'primeros',
  'segundos',
  'postres',
  'bebidas',
  'alergenos',
  'alérgenos',
  'desayunos',
  'raciones',
  'ensaladas',
  'pescados',
  'carnes',
  'precios',
  'desserts',
  'starters',
  'main courses'
];

async function verificarArchivo(archivo) {
  if (archivo.extension !== '.pdf') {
    return {
      valido: false,
      estado: 'pendiente_revision_visual',
      motivo: 'Imagen candidata: necesita comprobación visual'
    };
  }

  try {
    const buffer = await fs.promises.readFile(archivo.ruta);
    const resultado = await pdf(buffer);

    const texto = resultado.text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const coincidencias = TERMINOS_CARTA.filter(term =>
      texto.includes(
        term.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      )
    );

    if (coincidencias.length >= 2 && texto.length > 100) {
      return {
        valido: true,
        estado: 'carta_verificada_por_texto',
        paginas: resultado.numpages,
        coincidencias
      };
    }

    return {
      valido: false,
      estado: 'pendiente_revision',
      paginas: resultado.numpages,
      motivo: 'No hay suficientes indicios de que sea una carta',
      coincidencias
    };
  } catch (error) {
    return {
      valido: false,
      estado: 'error_lectura',
      motivo: error.message
    };
  }
}

module.exports = {
  verificarArchivo
};
