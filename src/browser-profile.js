import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export function profileDirectory() {
  return path.resolve('browser-profile', 'chrome');
}

export async function mapsBrowserExecutable() {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('Maps requiere un navegador visible. Ejecuta el comando desde un escritorio Linux con pantalla disponible.');
  }
  const override = process.env.MAPS_BROWSER_EXECUTABLE;
  if (override) {
    const executable = path.resolve(override);
    await access(executable, constants.X_OK).catch(() => {
      throw new Error(`MAPS_BROWSER_EXECUTABLE no apunta a un navegador ejecutable: ${executable}`);
    });
    return executable;
  }
  const windowsRoots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = {
    win32: windowsRoots.map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
  for (const executable of candidates[process.platform] ?? []) {
    try {
      await access(executable, constants.X_OK);
      return executable;
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error('Instala Google Chrome o indica la ruta a Chrome o Chromium con MAPS_BROWSER_EXECUTABLE.');
}
