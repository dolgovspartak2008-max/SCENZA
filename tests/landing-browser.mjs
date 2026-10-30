import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '../server/index.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const allowedOrigins = [new URL(base).origin];
await mkdir('tmp', { recursive: true });
const dataDir = await mkdtemp(path.resolve('tmp/landing-browser-'));
const backend = await createServer({ dataDir, seed: false, allowedOrigins, authOptions: { allowedOrigins } });
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route(/\/api\//, async route => {
  const url = new URL(route.request().url());
  const response = await route.fetch({ url: `http://127.0.0.1:${backend.address().port}${url.pathname}${url.search}` });
  await route.fulfill({ response });
});
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.locator('.scenza-hero-robot').waitFor();
  for (let index = 0; index < 4; index++) {
    const card = page.locator('.scenza-example').nth(index);
    assert.equal(await card.locator('video').count(), 1);
    await card.getByRole('button', { name: /^Смотреть видео:/ }).click();
    await page.waitForFunction(i => document.querySelectorAll('.scenza-example video')[i].currentTime > .2, index);
    assert.ok(await card.locator('video').evaluate(v => v.videoWidth > 0 && v.duration > 0 && !v.error));
    await card.locator('video').evaluate(v => v.pause());
  }
  console.log('PASS all four examples play inline after one click');
  await page.locator('.scenza-example').first().getByRole('button', { name: /^Увеличить видео:/ }).click();
  await page.waitForFunction(() => document.querySelector('.scenza-video-dialog video')?.currentTime > .2);
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
  console.log('PASS expanded video');
  assert.equal(await page.locator('.scenza-footer > div:not(.scenza-legal-footer)').count(), 0);
  assert.ok(await page.locator('.scenza-hero-paths path').count() >= 36);
  await page.evaluate(() => window.scrollTo(0, 0));
  const paths = page.locator('.scenza-hero-paths .scenza-path-base').first();
  const moving = await paths.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await page.waitForFunction(before => getComputedStyle(document.querySelector('.scenza-hero-paths .scenza-path-base')).strokeDashoffset !== before, moving);
  assert.equal(await page.locator('.scenza-path-base').first().getAttribute('pathLength'), '1', 'Line flow keeps the original path geometry');
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scenza-hero-paths .scenza-path-base')).animationPlayState.includes('paused'));
  const pausedPaths = await paths.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await page.waitForTimeout(150);
  assert.equal(await paths.evaluate(element => getComputedStyle(element).strokeDashoffset), pausedPaths);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.scenza-hero-paths .scenza-path-base')).animationName === 'none');
  const before = await paths.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await page.waitForTimeout(400);
  assert.equal(await paths.evaluate(element => getComputedStyle(element).strokeDashoffset), before);
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
    await page.locator('.scenza-hero-robot').waitFor();
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await page.locator('.scenza-price-card').first().waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2000);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: `tmp/ui-checks/landing-video-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS mobile/tablet/desktop, reduced motion, console, removed footer panel');
} finally {
  await browser.close();
  await new Promise(resolve => backend.close(resolve));
  assert.ok(dataDir.startsWith(path.resolve('tmp') + path.sep));
  await rm(dataDir, { recursive: true, force: true });
}
