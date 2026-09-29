import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../server/ai/store.mjs';
import { createTokens, publicationUrl, tokenCost, TRIAL_TOKENS } from '../server/ai/tokens.mjs';
import { exportSrt, frameRate, packXml } from '../server/ai/project-export.mjs';

test('token ledger starts with trial tokens, charges each source once and refuses an empty balance', async t => {
  await mkdir('tmp', { recursive: true });
  const dir = await mkdtemp(path.resolve('tmp/tokens-'));
  const store = await createStore({ dataDir: dir, env: {} });
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const tokens = createTokens(store), owner = '11111111-1111-4111-8111-111111111111';
  assert.equal(tokenCost(61), 2);
  assert.equal(tokenCost(0), 1);
  assert.equal((await tokens.summary(owner)).balance, TRIAL_TOKENS);
  assert.equal((await tokens.summary(owner)).balance, TRIAL_TOKENS, 'trial is granted once');
  assert.deepEqual(await tokens.charge(owner, 'project-1', 'source-a', 5 * 60 + 1), { charged: 6 });
  assert.deepEqual(await tokens.charge(owner, 'project-1', 'source-a', 5 * 60 + 1), { charged: 0 }, 'retry is free');
  await assert.rejects(tokens.charge(owner, 'project-2', 'source-b', 10 * 60), error => error.status === 402 && /нужно 10, на балансе 4/.test(error.message));
  await tokens.grant(owner, 170, 'purchase', 'plan-1', 'Тариф pro');
  await tokens.grant(owner, 170, 'purchase', 'plan-1', 'Тариф pro');
  const summary = await tokens.summary(owner);
  assert.equal(summary.balance, 174);
  assert.deepEqual(summary.history.map(item => [item.reason, item.tokens]), [['purchase', 170], ['analysis', -6], ['trial', 10]]);
  assert.equal((await store.ownerMonthlyUsage(owner)).calls, 0, 'ledger entries are not counted as AI calls');
  assert.deepEqual(await tokens.charge('local', 'project-3', 'source-c', 3600), { charged: 0 }, 'the local studio is free');
  await assert.rejects(tokens.grant(owner, 1.5, 'purchase', 'bad'), /Invalid token entry/);
  assert.equal(publicationUrl('http://tiktok.com/@a/video/1'), null, 'only https');
  assert.equal(publicationUrl('https://evil.example/tiktok.com'), null);
  assert.equal(publicationUrl('https://vm.tiktok.com/ZM123/'), 'https://vm.tiktok.com/ZM123/');
  await assert.rejects(tokens.publicationBonus(owner, 'https://example.com/video'), error => error.status === 400);
  assert.deepEqual(await tokens.publicationBonus(owner, 'https://www.youtube.com/shorts/abc123'), { balance: 179 });
  await assert.rejects(tokens.publicationBonus(owner, 'https://www.instagram.com/reel/xyz/'), error => error.status === 409, 'the bonus is granted once');
  assert.equal((await tokens.summary(owner)).publicationBonus, true);
});

test('project captions follow the cut timeline', () => {
  const project = { fps: '30000/1001', analysis: { segments: [{ start: 9, end: 12, text: 'Первый ответ' }, { start: 40, end: 43, text: 'Второй' }, { start: 70, end: 72, text: 'Вне ролика' }] } };
  const settings = { format: '9:16', segments: [{ start: 10, end: 20 }, { start: 40, end: 45 }] };
  assert.deepEqual(frameRate(project), { rate: 30000 / 1001, timebase: 30, ntsc: true });
  assert.equal(exportSrt(project, settings), '1\n00:00:00,000 --> 00:00:02,000\nПервый ответ\n\n2\n00:00:10,000 --> 00:00:13,000\nВторой\n');
});

test('editing pack timeline keeps an overlay banner on its own track', () => {
  const xml = packXml({ project: { title: 'Pack', fps: '25/1', hasAudio: true }, settings: { format: '1:1' }, duration: 10, ad: { position: 'final', start: 0, duration: 2 }, banner: { name: '3-banner.mp4', still: false } });
  assert.equal((xml.match(/<track>/g) || []).length, 3, 'video, banner overlay and audio tracks');
  assert.match(xml, /<clipitem id="banner-1"><name>3-banner.mp4<\/name><duration>50<\/duration><rate><timebase>25<\/timebase><ntsc>FALSE<\/ntsc><\/rate><start>200<\/start><end>250<\/end>/);
  assert.match(xml, /<width>1080<\/width><height>1080<\/height>/);
});
