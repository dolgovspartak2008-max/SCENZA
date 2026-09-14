import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

test('admin is owner-only, persists maintenance/support and never invents usage or resends broadcasts', async () => {
  let module;
  try { module = await import('../server/admin.mjs'); } catch {}
  assert.equal(typeof module?.createAdminService, 'function');
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/admin-service-'));
  let current = Date.parse('2026-09-14T12:00:00Z');
  const users = [{ id: 'u1', telegramUserId: '10', name: 'Alice', createdAt: '2026-09-14T01:00:00Z', lastActiveAt: '2026-09-14T11:00:00Z', accessActive: true }, { id: 'u2', telegramUserId: '11', createdAt: '2026-09-01T01:00:00Z', accessActive: false }];
  const auth = { bots: { adminRole: async id => id === 'owner' ? 'owner' : null, adminSnapshot: async () => ({ users, events: [], promos: [], ownerTelegramId: 'owner' }), userByTelegram: async id => users.find(user => user.telegramUserId === id), user: async id => users.find(user => user.id === id) } };
  const getVideoApi = async () => ({ store: { adminSnapshot: async () => ({ projects: [], jobs: [], usage: [] }) } });
  try {
    let admin = await module.createAdminService({ auth, dataDir, getVideoApi, now: () => current, env: {} });
    for (const call of [() => admin.statistics('stranger'), () => admin.setMaintenance('stranger', true), () => admin.support('stranger'), () => admin.broadcastAudience('stranger', 'all'), () => admin.claimAlert('stranger', 'error')]) await assert.rejects(call, { status: 403 });
    const stats = await admin.statistics('owner');
    assert.equal(stats.users.total, 2);
    assert.equal(stats.users.today, 1);
    assert.equal(stats.ai.tokens, null);
    await admin.setMaintenance('owner', true, 'Обновляем сервис');
    assert.throws(() => admin.assertGenerationAllowed(), { status: 503, code: 'MAINTENANCE' });
    admin = await module.createAdminService({ auth, dataDir, getVideoApi, now: () => current, env: {} });
    assert.equal((await admin.maintenance('owner')).enabled, true);
    const ticket = await admin.createSupport('10', 'Помогите с обработкой', 'tg:1');
    assert.equal((await admin.createSupport('10', 'Помогите с обработкой', 'tg:1')).id, ticket.id);
    await assert.rejects(() => admin.createSupport('unknown', 'question', 'tg:2'), { status: 403 });
    await admin.replySupport('owner', ticket.id, 'Уже проверяем');
    assert.equal((await admin.userSupport('u1'))[0].replies[0].text, 'Уже проверяем');
    assert.equal((await admin.userSupport('u2')).length, 0);
    await admin.closeSupport('owner', ticket.id);
    assert.equal((await admin.support('owner', { id: ticket.id })).status, 'closed');
    assert.equal(await admin.claimAlert('owner', 'ai:unavailable'), true);
    assert.equal(await admin.claimAlert('owner', 'ai:unavailable'), false);
    assert.equal(typeof admin.releaseAlert, 'function');
    await admin.releaseAlert('owner', 'ai:unavailable');
    assert.equal(await admin.claimAlert('owner', 'ai:unavailable'), true);
    const alerts = await admin.alerts('owner');
    assert.ok(Array.isArray(alerts));
    assert.equal(alerts.some(alert => alert.key.includes(ticket.id)), false, 'closed tickets do not alert');
    current += 61 * 60000;
    assert.equal(await admin.claimAlert('owner', 'ai:unavailable'), true);
    const draft = await admin.createBroadcast('owner', { audience: 'all', text: 'Новости' }, 'broadcast:1');
    assert.equal((await admin.pendingBroadcast('owner', draft.id)).recipients.length, 2);
    await admin.recordBroadcast('owner', draft.id, '10', 'sending');
    assert.deepEqual((await admin.pendingBroadcast('owner', draft.id)).recipients, ['11']);
    assert.equal((await admin.createBroadcast('owner', { audience: 'all', text: 'Новости' }, 'broadcast:1')).id, draft.id);
    await admin.recordBroadcast('owner', draft.id, '10', 'sent');
    assert.equal((await admin.pendingBroadcast('owner', draft.id)).counts.sent, 1);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
