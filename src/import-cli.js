import { parseArgs } from 'node:util';
import { importCaib } from './import-caib.js';

try {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: 'establecimientos.geojson' },
    output: { type: 'string', default: 'data/restaurantes-con-ids.geojson' },
    mapping: { type: 'string', default: 'data/ids.json' },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Uso: npm run importar -- [--source archivo.geojson] [--output salida.geojson] [--mapping ids.json]\nFiltra Grup=Restaurant y Estat=Alta. Genera _id numéricos persistentes por Signatura.\nConserva el archivo de IDs para mantener la relación en futuras importaciones.');
  } else {
    console.log(JSON.stringify(await importCaib(values), null, 2));
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
