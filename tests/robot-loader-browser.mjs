import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const runtime = process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = createRequire(import.meta.url)(runtime);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://prod.spline.design/**', () => {});
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.locator('.scenza-landing').waitFor();
  assert.equal(await page.locator('.scenza-page-loader').count(), 1, 'A slow robot must keep the branded loader visible');
  assert.equal(await page.getByText('Загружаем 3D-робота…', { exact: true }).count(), 0);
  await page.waitForTimeout(6500);
  assert.equal(await page.getByRole('button', { name: 'Продолжить без ожидания', exact: true }).count(), 0, 'The loader never offers a skip button');
  await page.keyboard.press('Escape');
  await page.locator('.scenza-page-loader').waitFor({ state: 'detached' });
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'Continue restores scrolling');
  await page.close();

  const timeout = await browser.newPage();
  await timeout.route('https://prod.spline.design/**', () => {});
  await timeout.clock.install();
  await timeout.goto(process.env.TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await timeout.locator('.scenza-page-loader').waitFor();
  await timeout.clock.fastForward(21000);
  await timeout.locator('.scenza-page-loader[data-closing=true]').waitFor({ state: 'attached' });
  await timeout.clock.runFor(500);
  await timeout.locator('.scenza-page-loader').waitFor({ state: 'detached' });
  assert.notEqual(await timeout.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'Deadline restores scrolling');
  await timeout.close();

  const failure = await browser.newPage();
  await failure.route('https://prod.spline.design/**', route => route.abort());
  await failure.goto(process.env.TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await failure.getByText('Не удалось загрузить 3D-робота', { exact: true }).waitFor();
  await failure.locator('.scenza-page-loader').waitFor({ state: 'detached', timeout: 3000 });
  const retry = failure.waitForRequest('https://prod.spline.design/**');
  await failure.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await retry;
  await failure.getByText('Не удалось загрузить 3D-робота', { exact: true }).waitFor();
  await failure.close();

  const account = await browser.newPage();
  await account.route('https://prod.spline.design/**', () => {});
  await account.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}?account`, { waitUntil: 'domcontentloaded' });
  await account.locator('dialog[open]').waitFor();
  assert.equal(await account.locator('.scenza-page-loader').count(), 0, 'A requested account dialog opens directly');
  assert.equal(await account.evaluate(() => document.body.style.overflow), 'hidden');
  await account.locator('dialog[open] .scenza-dialog-close').click();
  assert.notEqual(await account.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'Closing the account dialog restores scrolling');
  await account.close();

  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  await reduced.goto(process.env.TEST_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await reduced.locator('.scenza-landing').waitFor();
  await reduced.locator('.scenza-page-loader').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(await reduced.locator('.scenza-robot-canvas').count(), 0, 'Reduced motion does not wait for disabled 3D');
  console.log('Robot loader: slow network, no skip button, Escape, deadline, load error, retry, account dialog, scroll unlock and reduced motion passed.');
} finally {
  await browser.close();
}
