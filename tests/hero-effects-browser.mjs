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
  const particles = page.locator('canvas.scenza-particle-background');
  await particles.waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.scenza-landing:not([inert])').waitFor();
  const offset = () => particles.evaluate(element => element.toDataURL());
  const spotlight = page.locator('.scenza-cursor-spotlight');
  assert.ok(!(await spotlight.evaluate(element => getComputedStyle(element).transitionProperty)).includes('transform'), 'No restarting CSS transition delays the cursor');
  await page.mouse.move(300, 350);
  await page.waitForTimeout(500);
  const left = await spotlight.evaluate(element => getComputedStyle(element).transform);
  await page.mouse.move(1100, 550);
  await page.waitForTimeout(500);
  assert.notEqual(await spotlight.evaluate(element => getComputedStyle(element).transform), left);
  assert.equal(await spotlight.evaluate(element => getComputedStyle(element).opacity), '1');
  for (let index = 0; index < 12; index++) {
    await page.mouse.move(700 + index * 35, 450 + index * 8);
    assert.equal(await spotlight.evaluate(element => getComputedStyle(element).opacity), '1', 'Cursor light must not blink while crossing the robot');
  }
  const robot = await page.locator('.scenza-hero-robot').boundingBox();
  const copy = await page.locator('.scenza-hero-copy').boundingBox();
  const hero = await page.locator('.scenza-hero').boundingBox();
  assert.ok(robot.x > copy.x + copy.width, 'Robot stays in the right column');
  assert.ok(robot.y - hero.y < 90, 'Robot is raised without moving sideways');
  assert.ok(Math.abs(robot.y + robot.height - (hero.y + hero.height)) < 3, 'No extra space below the robot');
  assert.equal(await page.locator('.scenza-hero').evaluate(element => getComputedStyle(element, '::after').content), 'none', 'No separate floor strip');
  await page.locator('#pricing').scrollIntoViewIfNeeded();
  assert.equal((await particles.boundingBox()).y, 0, 'Particles cover the page after leaving the hero');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300);
  const still = await offset();
  await page.waitForTimeout(300);
  assert.deepEqual(await offset(), still);
  assert.equal(await spotlight.evaluate(element => getComputedStyle(element).opacity), '0');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await mkdir('tmp/ui-checks', { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    const start = await offset();
    await page.waitForTimeout(600);
    const end = await offset();
    assert.notEqual(end, start, `Particles move at ${width}px`);
    assert.equal(await page.locator('.scenza-hero-buttons .scenza-button').count(), 1, 'Only one hero CTA');
    assert.equal(await page.locator('.scenza-hero-buttons').innerText(), 'Начать бесплатно');
    await page.screenshot({ path: `tmp/ui-checks/hero-flow-${width}.png` });
  }
  await page.locator('.scenza-hero-buttons').getByRole('button', { name: 'Начать бесплатно' }).click();
  await page.getByRole('dialog', { name: 'Регистрация', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS particles, cursor light, reduced motion, desktop/tablet/mobile, single free-start CTA opens registration');
} finally { await browser.close(); }
