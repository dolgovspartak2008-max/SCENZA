import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:5173/';
async function ready() {
  try {
    const [page, health, session] = await Promise.all([fetch(url, { signal: AbortSignal.timeout(1000) }), fetch(`${url}api/health`, { signal: AbortSignal.timeout(1000) }), fetch(`${url}api/auth/session`, { signal: AbortSignal.timeout(1000) })]);
    return page.ok && health.ok && session.ok && (await health.json()).ok === true && typeof (await session.json()).localStudioAllowed === 'boolean';
  } catch { return false; }
}
if (!await ready()) {
  if (!existsSync(path.join(root, 'node_modules/vite/bin/vite.js'))) throw new Error('Сначала установите зависимости проекта: pnpm install');
  const child = spawn(process.execPath, ['scripts/dev.mjs', ...(existsSync(path.join(root, 'dist/index.html')) ? ['--preview'] : [])], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
  let failed;
  child.on('error', (error) => { failed = error; });
  child.unref();
  let started = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (failed) throw failed;
    if (await ready()) { started = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!started) throw new Error('Студия не запустилась. Выполните node scripts/dev.mjs, чтобы увидеть причину.');
}
console.log(`SCENZA запущена: ${url}`);
if (!process.argv.includes('--no-open')) {
  const browser = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/c', 'start', '', url], { detached: true, windowsHide: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log(`Откройте в браузере: ${url}`));
  browser.unref();
}
