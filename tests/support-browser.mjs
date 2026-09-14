import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const runtime = process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(runtime);
const browser = await chromium.launch({ headless: true });
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
try {
  await mkdir('tmp/ui-checks', { recursive: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let tickets = [], failSend = true;
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/support') {
      if (route.request().method() === 'POST') {
        if (failSend) return route.fulfill({ status: 503, json: { error: 'Поддержка временно недоступна.' } });
        const ticket = { id: 'ticket-1', text: route.request().postDataJSON().text, createdAt: new Date().toISOString(), status: 'new' };
        tickets = [ticket];
        return route.fulfill({ json: { ticket } });
      }
      return route.fulfill({ json: { tickets } });
    }
    return route.fulfill({ json: pathname === '/api/auth/session' ? { user: { id: 'support-user', accessActive: true } } : { projects: [], aiReady: true } });
  });
  for (const width of [1440, 390]) {
    tickets = []; failSend = true;
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/app`);
    const trigger = page.getByRole('button', { name: 'Поддержка', exact: true });
    await trigger.click({ timeout: 5000 });
    const dialog = page.getByRole('dialog', { name: 'Поддержка SCENZA' });
    await dialog.getByText('У вас пока нет обращений.').waitFor();
    const input = dialog.getByRole('textbox', { name: 'Ваше сообщение' });
    const submit = dialog.getByRole('button', { name: 'Отправить' });
    assert.equal(await submit.isDisabled(), true);
    await input.fill('   ');
    assert.equal(await submit.isDisabled(), true);
    await input.fill('Не получается загрузить видео.');
    await submit.click();
    await dialog.getByRole('alert').getByText('Поддержка временно недоступна.').waitFor();
    assert.equal(await input.inputValue(), 'Не получается загрузить видео.');
    failSend = false;
    await submit.click();
    await dialog.getByText('Обращение отправлено.').waitFor();
    assert.equal(await input.inputValue(), '');
    await dialog.getByText('Не получается загрузить видео.', { exact: true }).waitFor();
    await dialog.getByText('Новое обращение', { exact: true }).waitFor();
    tickets[0] = { ...tickets[0], status: 'answered', replies: [{ text: 'Попробуйте файл MP4.', createdAt: new Date().toISOString() }, { text: 'Если ошибка останется, сообщите размер файла.', createdAt: new Date().toISOString() }] };
    await dialog.getByRole('button', { name: 'Обновить' }).click();
    await dialog.getByText('Попробуйте файл MP4.', { exact: true }).waitFor();
    await dialog.getByText('Если ошибка останется, сообщите размер файла.', { exact: true }).waitFor();
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.screenshot({ path: `tmp/ui-checks/support-${width}.png` });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: support desktop/mobile, blank input, send failure preserves text, successful send, replies, no overflow, Escape and focus restore');
} finally { await browser.close(); }
