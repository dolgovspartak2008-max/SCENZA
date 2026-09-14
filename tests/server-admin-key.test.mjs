import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createAdminService } from '../server/admin.mjs';

test('current API key limit is cached, kept distinct from balance, and alerts at low remaining allowance', async () => {
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/admin-key-'));
  let current = Date.now(), calls = 0, status = 200;
  let data = { limit: 10, limit_remaining: 0.5 };
  const auth = { bots: { adminRole: async id => id === 'owner' ? 'owner' : null, adminSnapshot: async () => ({ users: [], events: [{ event: 'account.block', at: new Date(current).toISOString() }] }) } };
  const options = { dataDir, auth, now: () => current, env: { OPENROUTER_API_KEY: 'private-key' }, getVideoApi: async () => ({ store: { adminSnapshot: async () => ({ projects: [], jobs: [], usage: [] }) } }), fetch: async (url, options) => { calls++; assert.equal(url, 'https://openrouter.ai/api/v1/key'); assert.equal(options.headers.Authorization, 'Bearer private-key'); assert.equal(options.redirect, 'error'); return Response.json({ data }, { status }); } };
  try {
    const admin = await createAdminService(options);
    await assert.rejects(() => admin.aiUsage('stranger'), { status: 403 });
    assert.equal(calls, 0);
    const usage = await admin.aiUsage('owner');
    assert.equal(usage.keyRemaining, 0.5);
    assert.equal(usage.keyLimit, 10);
    assert.equal(usage.balance, null);
    assert.ok((await admin.alerts('owner')).some(alert => alert.key === 'ai:key:low'));
    assert.equal(calls, 1);
    current += 300001; data = { limit: null, limit_remaining: null };
    const unlimited = await admin.aiUsage('owner');
    assert.equal(unlimited.keyRemaining, null);
    assert.equal(unlimited.keyStatus, 'unlimited');
    assert.ok(!(await admin.alerts('owner')).some(alert => alert.key === 'ai:key:low'));
    current += 300001; status = 402;
    assert.ok((await admin.alerts('owner')).some(alert => alert.key === 'ai:key:payment_required'));
    current += 300001; status = 403;
    assert.ok((await admin.alerts('owner')).some(alert => alert.key === 'ai:key:disabled'));
    const offline = await createAdminService({ ...options, fetch: async () => { throw new Error('private-key'); } });
    const offlineUsage = await offline.aiUsage('owner');
    assert.equal(offlineUsage.keyStatus, 'unavailable');
    assert.ok(!JSON.stringify(offlineUsage).includes('private-key'));
    const noKey = await createAdminService({ ...options, env: {}, fetch: async () => assert.fail('no real call without key') });
    assert.equal((await noKey.aiUsage('owner')).keyStatus, 'not_configured');
    const noVideo = await createAdminService({ ...options, env: {}, getVideoApi: async () => { throw Error('private-db'); } });
    const journal = await noVideo.journal('owner');
    assert.ok(journal.some(item => item.event === 'account.block'));
    assert.ok(journal.some(item => item.event === 'database.error'));
    assert.ok(!JSON.stringify(journal).includes('private-db'));
    assert.equal((await noVideo.statistics('owner')).generations.total, null);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
