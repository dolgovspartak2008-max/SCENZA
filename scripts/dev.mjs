import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// API and worker read .env themselves and restart when it changes, so a new key applies without rebooting.
const baseEnv = { ...process.env };
const hasEnv = existsSync('.env');
if (hasEnv) process.loadEnvFile('.env');
const nodeArgs = ['--watch', '--watch-path=server', ...(hasEnv ? ['--env-file=.env', '--watch-path=.env'] : [])];

const children = [
  spawn(process.execPath, [...nodeArgs, 'server/ai/worker.mjs'], { stdio: 'inherit', windowsHide: true, env: baseEnv }),
  spawn(process.execPath, [...nodeArgs, 'server/index.mjs'], { stdio: 'inherit', windowsHide: true, env: baseEnv }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(process.argv.includes('--preview') ? ['preview'] : [])], { stdio: 'inherit', windowsHide: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
