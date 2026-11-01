import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createAdminService } from '../server/admin.mjs';

test('publication bonus waits for the owner, who approves it from an admin alert', async () => {
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/publication-bonus-'));
  const granted = [];
  const auth = { bots: { adminRole: async id => id === 'owner' ? 'owner' : null, user: async id => ({ id, name: 'Alice', email: 'a@example.com', telegramUserId: '10' }) } };
  const tokens = { summary: async id => ({ publicationBonus: granted.includes(id) }), grantPublication: async id => { granted.push(id); return { granted: true }; } };
  const getVideoApi = async () => ({ tokens, store: { alertSnapshot: async () => ({ jobs: [], usage: [] }) } });
  try {
    const admin = await createAdminService({ auth, dataDir, getVideoApi, env: {}, fetch: async () => { throw new Error('offline'); } });
    await assert.rejects(admin.requestPublicationBonus('u1', 'https://example.com/v'), { status: 400 });
    assert.equal((await admin.requestPublicationBonus('u1', 'https://www.tiktok.com/@a/video/1')).status, 'pending');
    await assert.rejects(admin.requestPublicationBonus('u1', 'https://www.tiktok.com/@a/video/2'), { status: 409 });
    assert.deepEqual(granted, [], 'nothing is granted before the owner checks the post');
    const alert = (await admin.alerts('owner')).find(item => item.key.startsWith('publication:'));
    assert.match(alert.text, /tiktok\.com/);
    const approve = alert.rows.flat().find(button => button.callback_data?.startsWith('adm:pub:ok:'));
    await assert.rejects(admin.reviewPublication('stranger', approve.callback_data.slice(11), true), { status: 403 });
    assert.equal((await admin.reviewPublication('owner', approve.callback_data.slice(11), true)).status, 'approved');
    assert.deepEqual(granted, ['u1']);
    assert.equal((await admin.publicationStatus('u1')).status, 'approved');
    await assert.rejects(admin.requestPublicationBonus('u1', 'https://www.tiktok.com/@a/video/3'), { status: 409 });
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
