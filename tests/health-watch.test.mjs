import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthWatch } from '../scripts/health-watch.mjs';

const config = { siteUrl: 'https://scenza.example', botToken: `123456:${'a'.repeat(30)}`, ownerTelegramId: '99' };
function fixture() {
  const state = { site: true, backend: true, now: 0, deliver: true, calls: [], alerts: [] };
  const watch = createHealthWatch({ ...config, now: () => state.now, fetch: async (url, init) => {
    state.calls.push({ url, init });
    assert.ok(init.signal instanceof AbortSignal);
    if (url.startsWith('https://api.telegram.org/')) {
      state.alerts.push(JSON.parse(init.body));
      if (!state.deliver) throw new Error(`Network error ${url}`);
      return new Response(JSON.stringify({ ok: true, result: { message_id: state.alerts.length } }));
    }
    if (url.endsWith('/api/health/ready')) return new Response(JSON.stringify({ ok: state.backend }), { status: state.backend ? 200 : 503 });
    return new Response('<!doctype html><title>SCENZA</title>', { status: state.site ? 200 : 502, headers: { 'Content-Type': 'text/html' } });
  } });
  return { state, watch };
}

test('three consecutive failures alert once, a recovery alerts once and a new incident can be detected', async () => {
  const { state, watch } = fixture();
  assert.equal((await watch.check()).ok, true);
  state.backend = false;
  await watch.check(); await watch.check();
  assert.equal(state.alerts.length, 0);
  assert.equal((await watch.check()).notification, 'outage');
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].chat_id, '99');
  assert.match(state.alerts[0].text, /API/);
  for (let i = 0; i < 5; i++) { state.now += 60000; await watch.check(); }
  assert.equal(state.alerts.length, 1);
  state.backend = true;
  assert.equal((await watch.check()).notification, 'recovery');
  await watch.check();
  assert.equal(state.alerts.length, 2);
  state.site = false;
  await watch.check(); await watch.check(); await watch.check();
  assert.equal(state.alerts.length, 3);
  assert.match(state.alerts[2].text, /Сайт/);
});

test('healthy checks reset consecutive failures and both endpoints must respond successfully', async () => {
  const { state, watch } = fixture();
  state.site = false;
  await watch.check(); await watch.check();
  state.site = true;
  await watch.check();
  state.backend = false;
  await watch.check(); await watch.check();
  assert.equal(state.alerts.length, 0);
  const result = await watch.check();
  assert.deepEqual(result.checks, { site: true, backend: false });
  assert.equal(state.alerts.length, 1);
});

test('failed Telegram delivery is sanitized and retried only after cooldown; recovery delivery also retries', async () => {
  const { state, watch } = fixture();
  state.backend = false; state.deliver = false;
  await watch.check(); await watch.check();
  const failed = await watch.check();
  assert.equal(failed.notification, 'failed');
  assert.equal(JSON.stringify(failed).includes(config.botToken), false);
  state.now = 299999;
  await watch.check();
  assert.equal(state.alerts.length, 1);
  state.deliver = true; state.now = 300000;
  assert.equal((await watch.check()).notification, 'outage');
  state.backend = true; state.deliver = false;
  assert.equal((await watch.check()).notification, 'failed');
  state.deliver = true; state.now += 300000;
  assert.equal((await watch.check()).notification, 'recovery');
  assert.equal(state.alerts.length, 4);
});

test('malformed readiness, JSON site fallback and timeouts are failures without leaked errors', async () => {
  for (const mode of ['json-site', 'html-api', 'timeout']) {
    const watch = createHealthWatch({ ...config, fetch: async (url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      if (mode === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      if (url.endsWith('/api/health/ready')) return new Response(mode === 'html-api' ? '<html>fallback</html>' : '{"ok":true}');
      return new Response('{}', { headers: { 'Content-Type': mode === 'json-site' ? 'application/json' : 'text/html' } });
    } });
    assert.equal((await watch.check()).ok, false, mode);
  }
});

test('overlapping ticks share one check and shutdown never reports a false outage', async () => {
  const controller = new AbortController();
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const watch = createHealthWatch({ ...config, signal: controller.signal, fetch: async () => { calls++; await pending; throw new Error('network'); } });
  const first = watch.check(), second = watch.check();
  assert.equal(first, second);
  controller.abort(); release();
  assert.deepEqual(await first, { stopped: true });
  assert.equal(calls, 2);
  assert.deepEqual(await watch.check(), { stopped: true });
});

test('watch configuration rejects insecure origins and invalid credentials without echoing values', () => {
  for (const overrides of [{ siteUrl: 'http://scenza.example' }, { siteUrl: 'https://user:secret@scenza.example' }, { siteUrl: 'https://scenza.example/path' }, { botToken: 'sensitive-invalid-token' }, { ownerTelegramId: 'not-an-id' }]) {
    assert.throws(() => createHealthWatch({ ...config, ...overrides }), error => !/sensitive-invalid-token|user:secret/.test(error.message));
  }
});
