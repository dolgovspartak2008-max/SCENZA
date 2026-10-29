// Checks the OpenRouter key from .env: is it accepted, how much limit is left, do both models exist,
// and does one tiny text request really go through. Never prints the key.
// Usage: node scripts/check-ai-key.mjs        (one paid request of a few tokens)
//        node scripts/check-ai-key.mjs --free (only the free key/model checks)
import { existsSync } from 'node:fs';
import { PRIMARY_VIDEO_MODEL, FAST_EDIT_MODEL } from '../server/ai/openai.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.OPENROUTER_API_KEY?.trim() || '';
const primary = process.env.PRIMARY_VIDEO_MODEL || PRIMARY_VIDEO_MODEL;
const fast = process.env.FAST_EDIT_MODEL || FAST_EDIT_MODEL;
const free = process.argv.includes('--free');
const results = [];
const report = (ok, what, detail) => { results.push(ok); console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`); };
const call = (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers } });
const safe = error => String(error?.message || error).replaceAll(key || '\u0000', '[ключ скрыт]').slice(0, 200);

if (!key) {
  report(false, 'OPENROUTER_API_KEY', 'в .env пусто. Впишите ключ после OPENROUTER_API_KEY= и запустите проверку снова.');
  process.exit(1);
}
report(true, 'OPENROUTER_API_KEY', `задан (${key.length} символов, начинается с ${key.slice(0, 6)}…)`);

try {
  const response = await call('https://openrouter.ai/api/v1/key');
  if (response.status === 401 || response.status === 403) report(false, 'Ключ', `OpenRouter отклонил ключ (HTTP ${response.status}). Создайте новый в кабинете OpenRouter.`);
  else if (response.status === 402) report(false, 'Ключ', 'на балансе OpenRouter нет денег (HTTP 402).');
  else if (!response.ok) report(false, 'Ключ', `OpenRouter ответил HTTP ${response.status}.`);
  else {
    const { data } = await response.json();
    const left = data?.limit_remaining;
    report(left === null || left === undefined || left > 0, 'Ключ принят', data?.limit == null ? 'лимит ключа не задан' : `лимит $${data.limit}, осталось $${Number(left).toFixed(2)}`);
  }
} catch (error) { report(false, 'Связь с OpenRouter', safe(error)); }

try {
  const response = await call('https://openrouter.ai/api/v1/models');
  const { data = [] } = response.ok ? await response.json() : {};
  for (const [label, id, needVideo] of [['Модель анализа видео', primary, true], ['Модель правок', fast, false]]) {
    const model = data.find(item => item.id === id);
    if (!model) report(false, label, `${id} не найдена на OpenRouter. Исправьте название в .env.`);
    else if (needVideo && !model.architecture?.input_modalities?.includes('video')) report(false, label, `${id} не принимает видео.`);
    else report(true, label, id);
  }
} catch (error) { report(false, 'Список моделей', safe(error)); }

if (free) console.log('Платный запрос пропущен (--free).');
else {
  try {
    const response = await call('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: fast, max_tokens: 16, messages: [{ role: 'user', content: 'Ответь одним словом: работает' }] }) });
    if (!response.ok) report(false, 'Тестовый запрос', `HTTP ${response.status}`);
    else {
      const body = await response.json();
      const text = String(body.choices?.[0]?.message?.content || '').trim();
      report(!!text, 'Тестовый запрос к модели', `${body.model || fast} ответила «${text.slice(0, 40)}», токенов: ${body.usage?.total_tokens ?? '?'}`);
    }
  } catch (error) { report(false, 'Тестовый запрос', safe(error)); }
}

const ok = results.every(Boolean);
console.log(ok ? '\nКлюч работает: SCENZA может анализировать видео и выполнять правки.' : '\nЕсть проблемы — см. строки FAIL выше.');
process.exitCode = ok ? 0 : 1;
