import path from 'node:path';

export function profileDirectory() {
  return path.resolve('browser-profile', 'chrome');
}
