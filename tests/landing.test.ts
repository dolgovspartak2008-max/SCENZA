import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPlans, monthlyEquivalent, annualDiscount, parseSelection } from '../src/landing/plans.ts';
import { authAdapter, authRequest, validateAuth } from '../src/landing/auth.ts';

test('annual numbers distinguish monthly equivalent and full payment; trial stays unchanged', () => {
  for (const plan of demoPlans) {
    assert.equal(monthlyEquivalent(plan, 'month'), plan.monthly);
    assert.equal(monthlyEquivalent(plan, 'year') * 12, plan.annual);
    assert.equal(annualDiscount(plan), plan.id === 'trial' ? 0 : 20);
  }
});
test('plan restore validates both plan and interval', () => {
  assert.deepEqual(parseSelection('{"planId":"pro","period":"year"}'), { planId: 'pro', period: 'year' });
  for (const value of ['broken', 'null', '{"planId":"admin","period":"year"}', '{"planId":"pro","period":"forever"}']) assert.equal(parseSelection(value), null);
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
