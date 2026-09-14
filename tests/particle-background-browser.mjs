import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5173');
  await page.locator('.scenza-hero').waitFor();
  const canvas = page.locator('canvas.scenza-particle-background');
  assert.equal(await canvas.count(), 1, 'Landing has one particle background');
  await page.keyboard.press('Escape');
  await page.locator('.scenza-landing:not([inert])').waitFor();
  const frame = () => canvas.evaluate(element => element.toDataURL());
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(250);
    const before = await frame();
    await page.waitForTimeout(350);
    assert.notEqual(await frame(), before, `Particles move at ${width}px`);
    const state = await canvas.evaluate(element => {
      const box = element.getBoundingClientRect();
      const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
      let painted = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) painted++;
      return { width: box.width, height: box.height, painted, pointer: getComputedStyle(element).pointerEvents };
    });
    assert.equal(state.width, await page.evaluate(() => document.body.clientWidth));
    assert.equal(state.height, 1000);
    assert.ok(state.painted > 500, 'Canvas contains visible points and connections');
    assert.equal(state.pointer, 'none', 'Background does not intercept controls');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `tmp/ui-checks/particles-${width}.png` });
  }
  await page.locator('#faq').scrollIntoViewIfNeeded();
  assert.equal((await canvas.boundingBox()).y, 0, 'Background stays behind the entire landing');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(250);
  const still = await frame();
  await page.waitForTimeout(350);
  assert.equal(await frame(), still, 'Reduced motion retains a static network');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(250);
  const resumed = await frame();
  await page.waitForTimeout(350);
  assert.notEqual(await frame(), resumed, 'Motion resumes after preference changes');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  const hidden = await frame();
  await page.waitForTimeout(350);
  assert.equal(await frame(), hidden, 'Hidden document stops drawing');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.locator('.scenza-hero-buttons button').click();
  await page.getByRole('dialog', { name: 'Регистрация', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS particles: desktop/tablet/mobile, painted animated canvas, fixed background, reduced motion, registration');
} finally {
  await browser.close();
}
