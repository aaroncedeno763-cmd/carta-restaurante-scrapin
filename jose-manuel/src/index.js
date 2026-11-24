
const { procesarTodos } = require('./core/procesador');

async function main() {
  console.log('========================================');
  console.log('  BUSCADOR DE CARTAS DE RESTAURANTES');
  console.log('========================================');

  try {
    await procesarTodos();
  } catch (error) {
    console.error('\nError general:', error.message);
    process.exitCode = 1;
  }
}

main();
