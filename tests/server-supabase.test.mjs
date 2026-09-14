import test from 'node:test';
import assert from 'node:assert/strict';

test('Supabase store persists atomically and rejects a stale writer', async () => {
  const { createSupabase } = await import('../server/supabase.mjs');
  let row;
  const initial = { accounts: [], events: [], promos: [], processed: [] };
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, ...options });
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.redirect, 'error');
    if (options.method === 'GET') return Response.json(row ? [row] : []);
    const body = JSON.parse(options.body);
    if (options.method === 'POST') { row = structuredClone(body); return Response.json([row], { status: 201 }); }
    if (new URL(url).searchParams.get('revision') !== `eq.${row.revision}`) return Response.json([]);
    row = { ...row, ...body };
    return Response.json([row]);
  };
  const config = { url: 'https://example.supabase.co', serviceKey: 'sb_secret_test', publicKey: 'sb_publishable_test', fetch: fetcher };
  const first = createSupabase(config).accountStore;
  assert.deepEqual(await first.load(initial), initial);
  const stale = createSupabase(config).accountStore;
  await stale.load(initial);
  const next = { ...initial, events: [{ event: 'test' }] };
  await first.save(next);
  await assert.rejects(stale.save(initial), /изменено другим процессом/);
  assert.deepEqual(row.payload, next);
  assert.equal(row.revision, 1);
  assert.ok(requests.every(request => !request.url.includes('sb_secret')));
});

test('Supabase email OTP verifies the matching confirmed address and never sends the server key', async () => {
  const { createSupabase } = await import('../server/supabase.mjs');
  const calls = [];
  let verifiedEmail = 'owner@example.com';
  const { emailAuth } = createSupabase({ url: 'https://example.supabase.co', serviceKey: 'sb_secret_private', publicKey: 'sb_publishable_test', fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.apikey, 'sb_publishable_test');
    assert.equal(JSON.stringify(options).includes('sb_secret_private'), false);
    return Response.json(url.endsWith('/otp') ? {} : { user: { id: 'verified-user', email: verifiedEmail, email_confirmed_at: '2026-09-13T00:00:00Z' } });
  } });
  await emailAuth.send({ email: 'owner@example.com', purpose: 'register' });
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'owner@example.com', create_user: true });
  await emailAuth.verify({ email: 'owner@example.com', code: '123456' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: 'owner@example.com', token: '123456', type: 'email' });
  verifiedEmail = 'someone-else@example.com';
  await assert.rejects(emailAuth.verify({ email: 'owner@example.com', code: '123456' }), /подтвердить/);
});

test('Supabase errors fail closed without exposing upstream credentials or using local fallback', async () => {
  const { createSupabase } = await import('../server/supabase.mjs');
  assert.throws(() => createSupabase({ url: 'http://example.com', serviceKey: 'secret', publicKey: 'public' }), /HTTPS/);
  const service = createSupabase({ url: 'https://example.supabase.co', serviceKey: 'private-key', publicKey: 'public-key', fetch: async () => new Response('private-key internal database failure', { status: 500 }) });
  await assert.rejects(service.accountStore.load({ accounts: [] }), error => error.status === 503 && !error.message.includes('private-key'));
  await assert.rejects(service.emailAuth.send({ email: 'a@example.com' }), error => error.status === 503 && !error.message.includes('private-key'));
});
