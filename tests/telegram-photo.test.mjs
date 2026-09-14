import test from 'node:test';
import assert from 'node:assert/strict';

test('dual bots transfer photo bytes once and then reuse the client bot file ID', async () => {
  let module; try { module = await import('../server/telegram-photo.mjs'); } catch {}
  assert.equal(typeof module?.createPhotoSender, 'function');
  const calls = [], draft = { photo: 'admin-file', text: 'Caption' }, markup = { reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] } };
  const api = async (type, method, body) => { calls.push({ type, method, body }); if (method === 'getFile') return { file_path: 'photos/photo_1.jpg', file_size: 3 }; return { ok: true }; };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url.includes('/file/')) return new Response(new Uint8Array([1, 2, 3]));
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('chat_id'), '10');
    assert.equal(options.body.get('caption'), 'Caption');
    assert.deepEqual(JSON.parse(options.body.get('reply_markup')), markup.reply_markup);
    assert.equal((await options.body.get('photo').arrayBuffer()).byteLength, 3);
    return Response.json({ ok: true, result: { photo: [{ file_id: 'client-file' }] } });
  };
  const send = module.createPhotoSender({ clientToken: '1:client', adminToken: '2:admin', api, fetch });
  await send('10', draft, markup);
  await send('11', draft, markup);
  assert.equal(calls.filter(call => call.url).length, 2);
  assert.equal(calls.at(-1).type, 'client');
  assert.equal(calls.at(-1).body.photo, 'client-file');
  assert.ok(!calls.some(call => call.type === 'client' && call.body.photo === 'admin-file'));
});

test('single bot reuses the original file ID without downloading', async () => {
  const { createPhotoSender } = await import('../server/telegram-photo.mjs');
  const calls = [];
  const send = createPhotoSender({ clientToken: '1:same', adminToken: '1:same', api: async (...args) => calls.push(args), fetch: async () => assert.fail('must not fetch') });
  await send('10', { photo: 'same-file', text: 'Caption' });
  assert.equal(calls[0][0], 'client');
  assert.equal(calls[0][2].photo, 'same-file');
});

test('unsafe Telegram paths and oversized downloads fail before any client upload', async () => {
  const { createPhotoSender } = await import('../server/telegram-photo.mjs');
  for (const file of [{ file_path: '../secret' }, { file_path: 'https://evil.test/photo' }, { file_path: 'photos/%2e%2e/file.jpg' }, { file_path: 'photos/image.jpg', file_size: 11 * 1024 ** 2 }]) {
    const send = createPhotoSender({ clientToken: '1:private', adminToken: '2:secret', api: async () => file, fetch: async () => assert.fail('must not fetch') });
    await assert.rejects(() => send('10', { photo: 'file', text: 'Caption' }), error => error.telegramFailure && !error.message.includes('secret') && !error.message.includes('private'));
  }
  let uploads = 0;
  const send = createPhotoSender({ clientToken: '1:client', adminToken: '2:admin', api: async () => ({ file_path: 'photos/a.jpg' }), fetch: async url => { if (!url.includes('/file/')) uploads++; return new Response(new Uint8Array(10 * 1024 ** 2 + 1)); } });
  await assert.rejects(() => send('10', { photo: 'file', text: 'Caption' }));
  assert.equal(uploads, 0);
});

test('upload errors are sanitized and preserve Telegram rejection versus uncertain transport', async () => {
  const { createPhotoSender } = await import('../server/telegram-photo.mjs');
  for (const uncertain of [false, true]) {
    const send = createPhotoSender({ clientToken: '1:private', adminToken: '2:secret', api: async () => ({ file_path: 'photos/a.jpg' }), fetch: async url => {
      if (url.includes('/file/')) return new Response('photo');
      if (uncertain) throw new Error('private token secret');
      return Response.json({ ok: false, error_code: 429, description: 'private token secret' }, { status: 429 });
    } });
    await assert.rejects(() => send('10', { photo: 'file', text: 'Caption' }), error => error.telegramFailure === true && (uncertain ? !error.telegramCode : error.telegramCode === 429) && !error.message.includes('private') && !error.message.includes('secret'));
  }
});
