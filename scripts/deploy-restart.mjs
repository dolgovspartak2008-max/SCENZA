// Restarts only what a release actually changed. Run as root AFTER /srv/scenza/current points to the new release:
//   node scripts/deploy-restart.mjs --previous /srv/scenza/releases/OLD --next /srv/scenza/releases/NEW [--dry-run]
// Replaces `systemctl restart scenza scenza-worker`: frontend/auth/API changes restart only `scenza`; the video worker
// restarts only when its own code, unit file, dependencies or AI environment changed, and then without blocking —
// systemd stops the old worker after it drains the current job (see deploy/scenza-worker.service).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const skipped = new Set(['node_modules', '.git', '.scena', 'tmp', 'outputs']);
const WORKER_ENTRY = 'server/ai/worker.mjs';
const workerEnvKey = /^(OPENROUTER_\w+|PRIMARY_VIDEO_MODEL|FAST_EDIT_MODEL|OPENAI_\w+|SUPABASE_URL|SUPABASE_SECRET_KEY|S3_\w+|SCENA_DATA_DIR|SCENZA_\w+|HF_HOME)$/;

async function files(root, dir = '') {
  const out = new Map();
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (skipped.has(entry.name)) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [key, value] of await files(root, rel)) out.set(key, value);
    else if (entry.isFile()) out.set(rel, createHash('sha256').update(await fs.readFile(path.join(root, rel))).digest('hex'));
  }
  return out;
}

export async function changedPaths(previous, next) {
  const [a, b] = await Promise.all([files(previous), files(next)]);
  return [...new Set([...a.keys(), ...b.keys()])].filter(key => a.get(key) !== b.get(key)).sort();
}

// Static relative imports reachable from the worker entry (e.g. server/net.mjs). The dynamic import of server/index.mjs
// is deliberately excluded: a running worker resolves it inside its own (old) release directory, so it stays consistent.
export async function workerModules(root) {
  const seen = new Set(), queue = [WORKER_ENTRY];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    const source = await fs.readFile(path.join(root, rel), 'utf8').catch(() => null);
    if (source === null) continue;
    seen.add(rel);
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
  }
  return seen;
}

export function isWorkerPath(file, modules = new Set()) {
  return file.startsWith('server/ai/') || modules.has(file) || ['deploy/scenza-worker.service', 'package.json', 'pnpm-lock.yaml'].includes(file);
}

// Hash of the variables the worker reads; values never leave this function.
export function workerEnvFingerprint(texts) {
  const lines = texts.flatMap(text => text.split(/\r?\n/)).map(line => line.trim()).filter(line => {
    const key = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/)?.[1];
    return key && workerEnvKey.test(key);
  }).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function planRestart({ changed, modules, envChanged = false }) {
  const worker = changed.filter(file => isWorkerPath(file, modules));
  const steps = [];
  if (changed.includes('deploy/scenza.service')) steps.push(['install-unit', 'scenza.service']);
  if (changed.includes('deploy/scenza-worker.service')) steps.push(['install-unit', 'scenza-worker.service']);
  if (steps.length) steps.push(['daemon-reload']);
  if (changed.length) steps.push(['restart', 'scenza']);
  if (worker.length || envChanged) steps.push(['graceful-restart', 'scenza-worker']);
  return { steps, workerReasons: [...worker, ...(envChanged ? ['worker environment'] : [])] };
}

export function commands(step, next) {
  const [action, unit] = step;
  if (action === 'install-unit') return [['install', '-m', '0644', path.join(next, 'deploy', unit), `/etc/systemd/system/${unit}`]];
  if (action === 'daemon-reload') return [['systemctl', 'daemon-reload']];
  if (action === 'restart') return [['systemctl', 'restart', unit]];
  // --no-block: the deploy does not wait for the drain; systemd starts the new worker only after the old one exited,
  // and the instance flock in the unit guarantees one worker at a time.
  if (action === 'graceful-restart') return [['systemctl', 'restart', '--no-block', unit]];
  throw new Error(`Unknown step ${action}`);
}

export async function deployRestart({ previous, next, envFiles = [], stateFile, dryRun = false, run = promisify(execFile), log = console.log }) {
  const changed = await changedPaths(previous, next);
  const modules = await workerModules(next);
  const envTexts = await Promise.all(envFiles.map(file => fs.readFile(file, 'utf8').catch(() => '')));
  const fingerprint = workerEnvFingerprint(envTexts);
  const saved = stateFile ? (await fs.readFile(stateFile, 'utf8').catch(() => '')).trim() : '';
  // No saved fingerprint yet: the running worker is assumed to use the current environment; record it, don't restart.
  const envChanged = !!saved && saved !== fingerprint;
  const plan = planRestart({ changed, modules, envChanged });
  log(`SCENZA deploy: изменено файлов ${changed.length}.`);
  log(plan.workerReasons.length ? `SCENZA deploy: worker будет перезапущен мягко (${plan.workerReasons.slice(0, 5).join(', ')}${plan.workerReasons.length > 5 ? ', …' : ''}).` : 'SCENZA deploy: worker не затронут и продолжает работу.');
  for (const step of plan.steps) for (const command of commands(step, next)) {
    log(`${dryRun ? '[dry-run] ' : ''}${command.join(' ')}`);
    if (!dryRun) await run(command[0], command.slice(1));
  }
  if (!dryRun && stateFile) await fs.writeFile(stateFile, `${fingerprint}\n`, { mode: 0o600 });
  return plan;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2), value = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const previous = value('--previous'), next = value('--next');
  if (!previous || !next) { console.error('Укажите --previous <старый релиз> и --next <новый релиз>.'); process.exit(2); }
  deployRestart({
    previous, next, dryRun: args.includes('--dry-run'),
    envFiles: [value('--ai-env') || '/srv/scenza/shared/ai.env', value('--env') || '/srv/scenza/shared/production.env'],
    stateFile: value('--state') || '/srv/scenza/shared/worker-env.sha256',
  }).catch(error => { console.error(`SCENZA deploy: ошибка — ${error.message}`); process.exit(1); });
}
