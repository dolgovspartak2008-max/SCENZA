import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildNotifications, createNotificationState } from '../server/notifications.mjs';
import { normalizeSettings, buildSubtitles } from '../server/ai/render.mjs';

test('notifications come from tokens, finished videos, admin actions and support replies, newest first', () => {
  const items = buildNotifications({
    tokens: [
      { id: 'trial-u', tokens: 10, reason: 'trial', createdAt: '2026-10-01T10:00:00.000Z' },
      { id: 'analysis-p', tokens: -3, reason: 'analysis', note: '170 сек. видео', projectId: 'p', createdAt: '2026-10-01T11:00:00.000Z' },
    ],
    projects: [{ id: 'p', status: 'COMPLETED', candidates: [{ id: 'c', ready: true, createdAt: '2026-10-01T12:00:00.000Z' }], versions: [{ id: 'v', number: 1, ad: { fileId: 'a' }, createdAt: '2026-10-01T13:00:00.000Z' }], exports: [{ id: 'e', createdAt: '2026-10-01T14:00:00.000Z' }] }],
    events: [{ event: 'account.block', at: '2026-10-01T15:00:00.000Z', detail: { reason: 'спам' } }, { event: 'studio.read', at: '2026-10-01T15:30:00.000Z' }],
    support: [{ replies: [{ id: 'r', text: 'Готово, проверьте баланс.', createdAt: '2026-10-01T16:00:00.000Z' }] }],
    title: () => 'Project 1',
  });
  assert.deepEqual(items.map(item => item.title), ['Ответ поддержки', 'Создание роликов приостановлено', 'Итоговое видео готово', 'Видео смонтировано', 'Ролики готовы', 'Списание токенов', 'Стартовые токены']);
  assert.match(items.find(item => item.id === 'version:v').text, /с вашим баннером/);
  assert.equal(items.find(item => item.id === 'export:e').link, '/app/ai/p');
  assert.match(items.at(-1).text, /\+10 токенов/);
});

test('read state is stored per account', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scenza-notify-'));
  try {
    const state = createNotificationState(dir);
    assert.equal(await state.readAt('u'), null);
    await state.markRead('u', '2026-10-01T00:00:00.000Z');
    assert.equal(await createNotificationState(dir).readAt('u'), '2026-10-01T00:00:00.000Z');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('subtitle font, multicolour words and custom height are validated and rendered without AI', () => {
  const settings = normalizeSettings({ start: 0, end: 4, subtitleFont: 'unbounded', subtitleColors: ['#ffffff', '#ff0000'], subtitleColorEvery: 2, subtitleY: 40 }, 10);
  const words = ['раз', 'два', 'три', 'четыре'].map((word, index) => ({ word, start: index, end: index + .9 }));
  const ass = buildSubtitles([{ start: 0, end: 4, text: 'раз два три четыре', words }], settings, 1080, 1920);
  assert.match(ass, /Style: Default,SCENZA Unbounded Bold,/);
  assert.match(ass, /,2,97,97,1152,1\n/);
  assert.match(ass, /\{\\c&HFFFFFF&\}раз\{\\r\} \{\\c&HFFFFFF&\}два\{\\r\} \{\\c&H0000FF&\}три/);
  assert.throws(() => normalizeSettings({ start: 0, end: 4, subtitleFont: 'comic' }, 10), /шрифт/);
  assert.throws(() => normalizeSettings({ start: 0, end: 4, subtitleY: 3 }, 10), /Высота/);
});
