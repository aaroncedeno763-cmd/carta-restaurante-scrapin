import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { profileDirectory } from './browser-profile.js';

try {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Uso: npm run iniciar:maps\nAbre Maps en el perfil de Chrome del proyecto. Inicia sesión y cierra esa ventana antes de ejecutar el recorrido.');
  } else {
    const profile = profileDirectory();
    if (process.platform !== 'win32') throw new Error('Este comando de inicio está preparado para Windows.');
    const relative = 'Google/Chrome/Application/chrome.exe';
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean);
    let executable;
    for (const root of roots) {
      const candidate = path.join(root, relative);
      try { await access(candidate); executable = candidate; break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!executable) throw new Error('No se encontró Google Chrome instalado.');
    await mkdir(profile, { recursive: true });
    const child = spawn(executable, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', 'https://www.google.com/maps'], { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    console.log(`Maps abierto con el perfil local: ${profile}\nInicia sesión con la cuenta del proyecto y cierra esa ventana antes de ejecutar el recorrido.`);
  }
} catch (error) { console.error(`Error: ${error.message}`); process.exitCode = 1; }
