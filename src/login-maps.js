import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { mapsBrowserExecutable, profileDirectory } from './browser-profile.js';

try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Uso: npm run iniciar:maps\nAbre Maps en el perfil de Chrome del proyecto. Inicia sesión y cierra esa ventana antes de ejecutar el recorrido.');
  } else {
    const profile = profileDirectory();
    const executable = await mapsBrowserExecutable();
    await mkdir(profile, { recursive: true });
    const child = spawn(executable, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.google.com/maps'], { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    console.log(`Abriendo Maps con el perfil local: ${profile}\nInicia sesión con la cuenta del proyecto y cierra esa ventana antes de ejecutar el recorrido.`);
  }
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
