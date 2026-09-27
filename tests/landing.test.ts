import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPlans, planPrice, tokenDiscount, tokenPrice, parseSelection } from '../src/landing/plans.ts';
import { authAdapter, authRequest, validateAuth } from '../src/landing/auth.ts';

test('token plans price one minute of source video and reward bigger packs', () => {
  const byId = Object.fromEntries(demoPlans.map(plan => [plan.id, plan]));
  assert.deepEqual(demoPlans.map(plan => [plan.id, plan.tokens, planPrice(plan, 'ru'), planPrice(plan, 'en')]), [['trial', 0, 0, 0], ['start', 75, 1500, 18], ['pro', 170, 3000, 36], ['business', 500, 7560, 90]]);
  assert.equal(tokenPrice(byId.start, 'ru'), 20);
  assert.deepEqual(demoPlans.map(tokenDiscount), [0, 0, 12, 24]);
  assert.ok(tokenPrice(byId.business, 'ru') < tokenPrice(byId.pro, 'ru') && tokenPrice(byId.pro, 'ru') < tokenPrice(byId.start, 'ru'));
});
test('plan restore validates both plan and interval', () => {
  assert.deepEqual(parseSelection('{"planId":"business","period":"year"}'), { planId: 'business', period: 'month' });
  for (const value of ['broken', 'null', '{"planId":"admin","period":"month"}']) assert.equal(parseSelection(value), null);
});
test('auth validates input and sends credentials only to the server', async (t) => {
  assert.deepEqual(validateAuth({ email: 'invalid', password: 'short' }), { email: 'invalidEmail', password: 'shortPassword' });
  assert.deepEqual(validateAuth({ email: 'demo@example.com', password: 'demo-password' }), {});
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ verificationRequired: true, challengeId: 'challenge' }));
  });
  assert.deepEqual(await authAdapter.submit('register', { email: 'demo@example.com', password: 'demo-password' }), { verificationRequired: true, challengeId: 'challenge' });
  assert.equal(sent.url, '/api/auth/email/start');
  assert.equal(sent.init.credentials, 'same-origin');
  assert.equal(JSON.parse(sent.init.body).mode, 'register');
});

test('missing hosted auth reports the unavailable service without a local restart instruction', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('NOT_FOUND', { status: 404 }));
  await assert.rejects(authRequest('config'), error => error.status === 404 && /Сервис входа не подключён/.test(error.message) && !/Перезапустите локальную/.test(error.message));
});
