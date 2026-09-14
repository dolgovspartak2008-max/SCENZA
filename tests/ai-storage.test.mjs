import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('durable jobs isolate owners, claim atomically and retry failures', async () => {
  let module;
  try { module = await import('../server/ai/store.mjs'); } catch {}
  assert.equal(typeof module?.createStore, 'function', 'durable store must exist');
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/ai-store-'));
  let first, second;
  try {
    first = await module.createStore({ dataDir, env: {} });
    await first.saveProject('alice', { id: 'p1', status: 'uploaded', createdAt: '2026-01-01', nested: { value: 3 } });
    assert.equal(await first.getProject('bob', 'p1'), null);
    await assert.rejects(() => first.saveProject('bob', { id: 'p1' }), /owner|access/i);
    await assert.rejects(() => first.enqueue('bob', 'p1', 'analyze'), /project|access/i);
    const a = await first.enqueue('alice', 'p1', 'analyze');
    const queuedProject = await first.getProject('alice', 'p1');
    assert.equal(queuedProject.jobId, a.id, 'job and project publish atomically');
    assert.equal(queuedProject.status, 'ANALYZING');
    assert.deepEqual(queuedProject.nested, { value: 3 });
    await assert.rejects(() => first.enqueue('alice', 'p1', 'preview'), error => error.status === 409);
    assert.equal(await first.getJob('bob', a.id), null);
    await first.close();
    first = await module.createStore({ dataDir, env: {} });
    second = await module.createStore({ dataDir, env: {} });
    assert.equal((await first.listProjects('alice'))[0].nested.value, 3);
    const claims = await Promise.all([first.claimJob('one'), second.claimJob('two')]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean);
    assert.equal(claimed.id, a.id);
    const worker = claims[0] ? 'one' : 'two';
    await assert.rejects(() => second.heartbeat(a.id, 'wrong', { stage: 'x', progress: 2 }), /lease/i);
    await first.heartbeat(a.id, worker, { stage: 'analyzing', progress: 40 });
    assert.equal((await second.getJob('alice', a.id)).progress, 40);
    assert.deepEqual(await second.claimJob(worker), await first.getJob('alice', a.id), 'ambiguous claim recovery must preserve progress, attempts and timestamps');
    assert.equal(await second.claimJob('unrelated-worker'), null, 'another worker cannot recover a live lease');
    await first.saveProject('alice', { id: 'p2', status: 'READY' });
    const other = await first.enqueue('alice', 'p2', 'analyze');
    assert.equal((await first.claimJob(worker)).id, a.id, 'recover the current job before taking another project');
    assert.equal((await second.claimJob('unrelated-worker')).id, other.id);
    await second.finishJob(other.id, 'unrelated-worker', { result: {} });
    await first.finishJob(a.id, worker, { error: 'model unavailable' });
    assert.equal((await first.getJob('alice', a.id)).status, 'error');
    const b = await first.enqueue('alice', 'p1', 'preview');
    assert.equal((await second.claimJob('next')).id, b.id);
    await second.finishJob(b.id, 'next', { result: { video: 'out.mp4' } });
    await assert.rejects(() => first.retryJob('bob', a.id), /job|access/i);
    await first.retryJob('alice', a.id);
    assert.equal((await second.getProject('alice', 'p1')).jobId, a.id);
    assert.equal((await second.getProject('alice', 'p1')).status, 'ANALYZING');
    assert.equal((await first.claimJob('retry')).attempts, 2);
    await first.finishJob(a.id, 'retry', { result: { ok: true } });
    assert.deepEqual((await first.getJob('alice', a.id)).result, { ok: true });
    assert.equal(await first.claimJob('idle'), null);
    const abandoned = await first.enqueue('alice', 'p1', 'analyze');
    await first.claimJob('crashed');
    const raw = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
    raw.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(abandoned.id);
    raw.close();
    assert.equal((await second.claimJob('recovery')).id, abandoned.id);
    await assert.rejects(() => first.finishJob(abandoned.id, 'crashed', { result: {} }), /lease/i);
    await second.finishJob(abandoned.id, 'recovery', { result: {} });
    const exhausted = await first.enqueue('alice', 'p1', 'asset');
    for (let count = 0; count < 3; count++) {
      await first.claimJob(`crash-${count}`);
      const raw = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
      raw.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(exhausted.id);
      raw.close();
    }
    assert.equal(await second.claimJob('after-crashes'), null);
    const exhaustedJob = await first.getJob('alice', exhausted.id);
    assert.equal(exhaustedJob.status, 'error');
    assert.equal((await first.getProject('alice', 'p1')).status, 'FAILED');
    assert.equal((await first.getProject('alice', 'p1')).error, exhaustedJob.error);
    const stale = await first.enqueue('alice', 'p1', 'asset');
    await first.claimJob('obsolete');
    await first.saveProject('alice', { ...(await first.getProject('alice', 'p1')), status: 'READY', jobId: 'newer-job', error: null });
    const expiredDb = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
    expiredDb.prepare('UPDATE jobs SET lease_until=0,attempts=3 WHERE id=?').run(stale.id);
    expiredDb.close();
    assert.equal(await second.claimJob('next-worker'), null);
    assert.equal((await first.getJob('alice', stale.id)).status, 'error');
    assert.equal((await first.getProject('alice', 'p1')).status, 'READY', 'an obsolete job must not overwrite the current project state');
    assert.equal((await first.getProject('alice', 'p1')).error, null);
    const expiredSame = await first.enqueue('alice', 'p1', 'asset');
    await first.claimJob('same-expired-worker');
    const expiredSameDb = new DatabaseSync(path.join(dataDir, 'video-jobs.sqlite'));
    expiredSameDb.prepare('UPDATE jobs SET lease_until=0 WHERE id=?').run(expiredSame.id);
    expiredSameDb.close();
    assert.equal((await second.claimJob('same-expired-worker')).attempts, 2, 'expired leases still use the normal retry attempt');
    await second.finishJob(expiredSame.id, 'same-expired-worker', { result: {} });
  } finally {
    await first?.close(); await second?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('Supabase failures preserve retry status while keeping authentication fatal and credentials private', async t => {
  const { createStore } = await import('../server/ai/store.mjs');
  const store = await createStore({ dataDir: 'unused', env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_private-test-value' } });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network leaked sb_secret_private-test-value'); });
  await assert.rejects(() => store.claimJob('worker'), error => error.status === 503 && error.code === 'VIDEO_DATABASE_UNAVAILABLE' && !JSON.stringify(error).includes('private-test-value') && !error.message.includes('private-test-value'));
  for (const status of [504, 503, 429, 403, 401]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('upstream sb_secret_private-test-value', { status }));
    await assert.rejects(() => store.claimJob('worker'), error => error.status === status && !error.message.includes('private-test-value') && !JSON.stringify(error).includes('private-test-value') && (status >= 500 || error.code !== 'VIDEO_DATABASE_UNAVAILABLE'));
  }
});

test('Supabase secret keys use API-key authorization without leaking remote responses', async t => {
  const { createStore } = await import('../server/ai/store.mjs');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('[]', { status: 200 });
  });
  const store = await createStore({ dataDir: 'unused', env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_not-a-jwt' } });
  assert.deepEqual(await store.listProjects('alice'), []);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  t.mock.method(globalThis, 'fetch', async () => new Response('secret-response-contents', { status: 200 }));
  await assert.rejects(() => store.listProjects('alice'), error => !error.message.includes('secret-response-contents') && /database/i.test(error.message));
});

test('private storage persists files and rejects traversal; S3 signatures have bounded expiry', async () => {
  let module;
  try { module = await import('../server/ai/storage.mjs'); } catch {}
  assert.equal(typeof module?.createStorage, 'function', 'private storage must exist');
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/ai-files-'));
  try {
    const storage = module.createStorage({ dataDir, env: {} });
    const input = path.join(dataDir, 'input.mp4');
    await writeFile(input, 'private content');
    assert.deepEqual(await storage.put('project/source.mp4', input), { key: 'project/source.mp4', size: 15 });
    const output = path.join(dataDir, 'copy.mp4');
    await storage.get('project/source.mp4', output);
    assert.equal(await readFile(output, 'utf8'), 'private content');
    assert.equal(await storage.signedUrl('project/source.mp4'), null);
    for (const key of ['../secret', '/secret', 'p/../../secret', 'p\\secret', 'p/%2e%2e/secret', 'p//secret', 'p/./secret']) {
      assert.throws(() => storage.localPath(key), /key/i);
    }
    const remote = module.createStorage({ dataDir, env: { S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com', S3_BUCKET: 'videos', S3_ACCESS_KEY_ID: 'public-id', S3_SECRET_ACCESS_KEY: 'secret-key' } });
    const url = new URL(await remote.signedUrl('project/source.mp4', { expiresIn: 900 }));
    assert.equal(url.pathname, '/videos/project/source.mp4');
    assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
    assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
    assert.match(url.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
    assert.equal(url.href.includes('secret-key'), false);
    assert.equal(remote.localPath('project/source.mp4'), null);
    await assert.rejects(() => remote.signedUrl('project/source.mp4', { expiresIn: 604801 }), /expiry/i);
    assert.throws(() => module.createStorage({ dataDir, env: { S3_BUCKET: 'only-one' } }), /configuration/i);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('S3 transfer streams upload/download bytes and sanitizes provider errors', async t => {
  const { createStorage } = await import('../server/ai/storage.mjs');
  await mkdir('tmp', { recursive: true });
  const dataDir = await mkdtemp(path.resolve('tmp/ai-s3-'));
  const data = Buffer.alloc(128 * 1024, 73);
  const storage = createStorage({ dataDir, env: { S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'videos', S3_ACCESS_KEY_ID: 'public-id', S3_SECRET_ACCESS_KEY: 'secret-key' } });
  try {
    const input = path.join(dataDir, 'source.mp4');
    await writeFile(input, data);
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.match(String(url), /X-Amz-Signature=/);
      if (options.method === 'PUT') {
        assert.equal(typeof options.body[Symbol.asyncIterator], 'function');
        assert.equal(options.headers['Content-Length'], String(data.length));
        const chunks = [];
        for await (const chunk of options.body) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), data);
        return new Response('', { status: 200 });
      }
      return new Response(data, { status: 200 });
    });
    assert.equal((await storage.put('p/source.mp4', input)).size, data.length);
    const output = path.join(dataDir, 'download.mp4');
    await storage.get('p/source.mp4', output);
    assert.deepEqual(await readFile(output), data);
    t.mock.method(globalThis, 'fetch', async () => new Response('secret-key-provider-response', { status: 403 }));
    await assert.rejects(() => storage.get('p/source.mp4', output), error => error.message === 'Object storage request failed (403)');
    assert.deepEqual(await readFile(output), data, 'failed download must preserve the previous complete file');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('large S3 uploads stream multipart ranges, finalize escaped ETags and abort failed transfers', async t => {
  const { createStorage } = await import('../server/ai/storage.mjs');
  const temporaryRoot = path.resolve('.scena/test-ai');
  await mkdir(temporaryRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(temporaryRoot, 'multipart-'));
  const input = path.join(dataDir, 'large.mp4'), partSize = 64 * 1024 ** 2, size = partSize + 1024 ** 2;
  const file = await open(input, 'w');
  await file.truncate(size); await file.close();
  const storage = createStorage({ dataDir, env: { S3_ENDPOINT: 'https://objects.example.com', S3_BUCKET: 'videos', S3_ACCESS_KEY_ID: 'public-id', S3_SECRET_ACCESS_KEY: 'secret-key' } });
  let scenario = 'success', aborts = 0, completed = 0, parts = [];
  try {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      const parsed = new URL(url), query = parsed.searchParams;
      assert.equal(options.redirect, 'error');
      assert.match(query.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
      if (options.method === 'POST' && query.has('uploads')) return new Response(scenario === 'invalid-xml' ? '<!DOCTYPE root [<!ENTITY key SYSTEM "file:///private">]><UploadId>&key;</UploadId>' : '<InitiateMultipartUploadResult><UploadId>upload+a/b&amp;c</UploadId></InitiateMultipartUploadResult>');
      assert.equal(query.get('uploadId'), 'upload+a/b&c');
      if (options.method === 'DELETE') { aborts++; return new Response(null, { status: 204 }); }
      if (options.method === 'PUT') {
        const number = Number(query.get('partNumber'));
        if (scenario === 'part-error' && number === 2) return new Response('private-provider-error', { status: 503 });
        let bytes = 0;
        for await (const chunk of options.body) bytes += chunk.length;
        assert.equal(bytes, Number(options.headers['Content-Length']));
        assert.equal(bytes, number === 1 ? partSize : size - partSize);
        parts.push({ number, bytes });
        return new Response(null, { status: 200, headers: { ETag: `"part-${number}&value"` } });
      }
      assert.equal(options.method, 'POST');
      completed++;
      assert.match(options.body, /<PartNumber>1<\/PartNumber><ETag>&quot;part-1&amp;value&quot;<\/ETag>/);
      assert.match(options.body, /<PartNumber>2<\/PartNumber><ETag>&quot;part-2&amp;value&quot;<\/ETag>/);
      assert.equal(Number(options.headers['Content-Length']), Buffer.byteLength(options.body));
      return new Response(scenario === 'complete-error' ? '<Error><Code>InternalError</Code><Message>private-error</Message></Error>' : '<CompleteMultipartUploadResult><ETag>complete</ETag></CompleteMultipartUploadResult>', { status: 200 });
    });
    assert.deepEqual(await storage.put('p/large.mp4', input), { key: 'p/large.mp4', size });
    assert.deepEqual(parts.map(part => part.number), [1, 2]);
    assert.equal(completed, 1); assert.equal(aborts, 0);
    scenario = 'part-error'; parts = [];
    await assert.rejects(() => storage.put('p/large.mp4', input), error => /storage/i.test(error.message) && !error.message.includes('private'));
    assert.equal(aborts, 1); assert.equal(completed, 1);
    scenario = 'complete-error'; parts = [];
    await assert.rejects(() => storage.put('p/large.mp4', input), error => /storage/i.test(error.message) && !error.message.includes('private'));
    assert.equal(aborts, 2); assert.equal(completed, 2);
    scenario = 'invalid-xml';
    await assert.rejects(() => storage.put('p/large.mp4', input), error => /storage/i.test(error.message) && !error.message.includes('private'));
    assert.equal(aborts, 2, 'untrusted XML must not be expanded or used as an upload identity');
    await assert.rejects(() => storage.signedUrl('p/large.mp4', { method: 'POST' }), /method/i);
  } finally {
    assert.ok(path.resolve(dataDir).startsWith(`${temporaryRoot}${path.sep}`));
    await rm(dataDir, { recursive: true, force: true });
  }
});
