import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const runtime = process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(runtime);
const browser = await chromium.launch({ headless: true });
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const user = { id: 'account-test', name: 'Спартак', provider: 'telegram', trialStartedAt: null, trialEndsAt: null, accessActive: false };
const config = { emailEnabled: true, telegramBotEnabled: true, legalReady: true };
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://prod.spline.design/**', route => route.abort());
  let sessionUser = user;
  let pending = Promise.resolve();
  let release;
  await page.route('**/api/auth/*', async route => {
    await pending;
    const endpoint = new URL(route.request().url()).pathname.split('/').at(-1);
    await route.fulfill({ json: endpoint === 'config' ? config : { user: sessionUser } });
  });
  await page.goto(`${base}/?account`);
  const dialog = page.getByRole('dialog');
  const accountHeading = dialog.getByRole('heading', { name: 'Ваш аккаунт SCENZA' });
  await accountHeading.waitFor();
  await page.keyboard.press('Escape');

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    pending = new Promise(resolve => { release = resolve; });
    await page.getByRole('button', { name: 'Спартак', exact: true }).filter({ visible: true }).first().click();
    await dialog.waitFor();
    assert.equal(await accountHeading.count(), 1, 'Known account stays visible while session refresh is pending');
    assert.equal(await dialog.locator('#scenza-auth-form, .scenza-auth-tabs').count(), 0, 'Login and registration never flash for a known account');
    const refreshed = page.waitForResponse('**/api/auth/config');
    release();
    await refreshed;
    await accountHeading.waitFor();
    await page.keyboard.press('Escape');
  }

  await Promise.all([
    page.waitForResponse('**/api/auth/config'),
    page.getByRole('button', { name: 'Спартак', exact: true }).filter({ visible: true }).first().click(),
  ]);
  await dialog.getByRole('button', { name: 'Выйти из аккаунта' }).click();
  await dialog.getByRole('heading', { name: 'Вход в систему' }).waitFor();
  assert.equal(await page.locator('.scenza-account-button').count(), 0, 'Logout clears the shared account');

  pending = new Promise(resolve => { release = resolve; });
  await page.goto(`${base}/?account`);
  await dialog.waitFor();
  assert.equal(await dialog.locator('#scenza-auth-form, .scenza-auth-tabs').count(), 0, 'Unknown session waits before showing guest forms');
  assert.equal(await dialog.getByRole('status').count(), 1);
  sessionUser = null;
  release();
  await dialog.getByRole('heading', { name: 'Вход в систему' }).waitFor();
  assert.equal(await dialog.locator('#scenza-auth-form').count(), 1, 'Confirmed guest can still sign in');
  assert.deepEqual(errors, []);
  console.log('PASS: known account never flashes auth forms at desktop/mobile widths; logout clears account; unknown session waits; confirmed guests can sign in; no page errors');
} finally {
  await browser.close();
}
