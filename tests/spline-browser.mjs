import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null } }));
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
await mkdir('tmp/ui-checks', { recursive: true });

try {
  await page.goto(base);
  await page.locator('.scenza-hero-robot[data-ready=true]').waitFor({ timeout: 90000 });
  assert.equal(await page.locator('.product-demo--hero').count(), 0);
  assert.equal(await page.locator('.product-demo--wide').count(), 1);
  assert.ok(await page.locator('.scenza-robot-canvas canvas').evaluate(canvas => canvas.width > 0 && canvas.height > 0));
  await page.waitForTimeout(7000);
  await page.mouse.move(250, 330);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'tmp/ui-checks/robot-desktop-left.png' });
  const left = await page.locator('.scenza-robot-scene').screenshot();
  await page.mouse.move(1300, 450);
  await page.waitForTimeout(1000);
  const right = await page.locator('.scenza-robot-scene').screenshot();
  assert.notDeepEqual(left, right, 'Scene must render different poses after cursor movement');
  await page.screenshot({ path: 'tmp/ui-checks/robot-desktop-right.png' });
  console.log('PASS original Spline scene loads, renders and responds; lower demo preserved');

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(1000);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: no horizontal overflow`);
    await page.screenshot({ path: `tmp/ui-checks/robot-${width}.png` });
  }
  await page.locator('.scenza-hero-buttons a').click();
  assert.equal(new URL(page.url()).hash, '#demo');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Включить 3D-робота', exact: true }).waitFor();
  assert.equal(await page.locator('.scenza-robot-canvas canvas').count(), 0);
  await page.getByRole('button', { name: 'Включить 3D-робота', exact: true }).click();
  await page.locator('.scenza-robot-canvas canvas').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS tablet/mobile overflow, demo link, reduced motion and manual activation; no page errors');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/scene.splinecode', route => route.abort());
  await page.reload();
  await page.getByText('Не удалось загрузить 3D-робота', { exact: true }).waitFor({ timeout: 30000 });
  await page.unroute('**/scene.splinecode');
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await page.locator('.scenza-hero-robot[data-ready=true]').waitFor({ timeout: 90000 });
  console.log('PASS network failure displays recovery and retry loads the robot');
} finally {
  await browser.close();
}
