import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createStore } from '../server/ai/store.mjs';
import { createTokens, tokenCost, TRIAL_TOKENS } from '../server/ai/tokens.mjs';
import { exportEdl, exportSrt, exportXml, frameRate } from '../server/ai/project-export.mjs';

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
});

test('project exports keep the edit decision list for Premiere, DaVinci and CapCut', () => {
  const project = { id: 'p', title: 'Интервью & <live>', upload: { name: 'source video.mp4' }, fps: '30000/1001', width: 1920, height: 1080, duration: 120, hasAudio: true,
    analysis: { segments: [{ start: 9, end: 12, text: 'Первый ответ' }, { start: 40, end: 43, text: 'Второй' }, { start: 70, end: 72, text: 'Вне ролика' }] } };
  const settings = { format: '9:16', segments: [{ start: 10, end: 20 }, { start: 40, end: 45 }] };
  assert.deepEqual(frameRate(project), { rate: 30000 / 1001, timebase: 30, ntsc: true });
  const edl = exportEdl(project, settings);
  assert.match(edl, /^TITLE: Интервью/);
  assert.match(edl, /001 {2}AX {7}B {5}C {8}00:00:10:00 00:00:20:00 00:00:00:00 00:00:10:00/);
  assert.match(edl, /002 {2}AX {7}B {5}C {8}00:00:40:00 00:00:45:00 00:00:10:00 00:00:15:00/);
  const xml = exportXml(project, settings);
  assert.match(xml, /<xmeml version="5">/);
  assert.match(xml, /Интервью &amp; &lt;live&gt;/);
  assert.equal((xml.match(/<clipitem id="video-/g) || []).length, 2);
  assert.match(xml, /<in>300<\/in><out>600<\/out>/);
  assert.match(xml, /<width>1080<\/width><height>1920<\/height>/);
  const srt = exportSrt(project, settings);
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:02,000\nПервый ответ\n\n2\n00:00:10,000 --> 00:00:13,000\nВторой\n');
});
