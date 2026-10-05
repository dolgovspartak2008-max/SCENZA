// Read-only Supabase check: `node scripts/check-database.mjs` from the project folder (uses .env).
// It never writes data; it only reads one row per table and the API schema.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = (process.env.SUPABASE_URL || '').trim(), key = (process.env.SUPABASE_SECRET_KEY || '').trim();
const tables = { scenza_video_projects: 'server/ai/migration.sql', scenza_video_jobs: 'server/ai/migration.sql', scenza_ai_usage: 'server/ai/migration.sql', scenza_state: 'server/supabase.sql' };
const functions = ['enqueue', 'claim', 'heartbeat', 'finish', 'retry', 'save_project', 'record_usage', 'admin_job'].map(name => `scenza_video_${name}`);
let problems = 0;
const ok = text => console.log(`OK   ${text}`);
const bad = text => { problems++; console.log(`FAIL ${text}`); };

if (!url && !key) { console.log('SUPABASE_URL и SUPABASE_SECRET_KEY пустые — сервер использует локальную базу SQLite, Supabase не нужен.'); process.exit(0); }
let base;
try { base = new URL(url); } catch { bad('SUPABASE_URL не похож на адрес. Нужен вид https://xxxx.supabase.co'); process.exit(1); }
if (base.protocol !== 'https:' || base.pathname !== '/') bad('SUPABASE_URL должен быть только адресом проекта, без пути: https://xxxx.supabase.co');
if (!key) bad('SUPABASE_SECRET_KEY пустой. Возьмите secret key (или service_role) в Supabase → Project Settings → API Keys.');
else if (key.startsWith('sb_publishable_')) bad('В SUPABASE_SECRET_KEY вставлен publishable key. Нужен secret key (sb_secret_…) или service_role.');
if (!process.env.SUPABASE_PUBLISHABLE_KEY) console.log('NOTE SUPABASE_PUBLISHABLE_KEY пустой — он нужен server/production.mjs для аккаунтов.');
if (problems) process.exit(1);

const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
async function get(path) {
  try { return await fetch(new URL(path, base), { headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch (error) {
    const code = error?.cause?.code || error?.name || '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') bad(`адрес ${base.host} не найден (DNS). Проверьте SUPABASE_URL — у нового проекта другой адрес.`);
    else if (code === 'TimeoutError') bad(`${base.host} не ответил за 20 секунд. Проект на паузе (Supabase → Restore project) или нет интернета.`);
    else bad(`нет связи с ${base.host} (${code || error?.message}). Проверьте интернет на сервере и статус проекта в Supabase.`);
    return null;
  }
}

console.log(`Проверяю ${base.host}…`);
for (const [table, file] of Object.entries(tables)) {
  const response = await get(`/rest/v1/${table}?select=id&limit=1`);
  if (!response) process.exit(1);
  const body = await response.json().catch(() => null);
  if (response.ok) ok(`таблица ${table}`);
  else if ([401, 403].includes(response.status)) { bad(`Supabase отклонил ключ (HTTP ${response.status}). Проверьте SUPABASE_SECRET_KEY — у нового проекта свой ключ.`); process.exit(1); }
  else if (['PGRST205', '42P01'].includes(body?.code)) bad(`нет таблицы ${table}. Выполните ${file} в Supabase → SQL Editor.`);
  else bad(`таблица ${table}: HTTP ${response.status}${body?.code ? ` ${body.code}` : ''}${body?.message ? ` — ${body.message}` : ''}`);
}

const schema = await get('/rest/v1/');
const paths = schema?.ok ? Object.keys((await schema.json().catch(() => ({}))).paths || {}) : null;
if (paths?.length) for (const name of functions) paths.includes(`/rpc/${name}`) ? ok(`функция ${name}`) : bad(`нет функции ${name}. Выполните server/ai/migration.sql в Supabase → SQL Editor.`);
else if (schema) console.log('NOTE список функций Supabase не отдал — функции не проверены (таблицы проверены).');

console.log(problems ? `\nНайдено проблем: ${problems}. После исправления перезапустите сервисы: sudo systemctl restart scenza scenza-worker` : '\nБаза в порядке. Если сервер всё ещё пишет об ошибке, перезапустите сервисы: sudo systemctl restart scenza scenza-worker');
process.exit(problems ? 1 : 0);
