import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function validKey(key) {
  if (typeof key !== 'string' || key.length > 1024 || !/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid storage key');
  return key;
}
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const hash = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const partSize = 64 * 1024 ** 2;
const escapeXml = value => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
async function readXml(response) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
  } catch { throw new Error('Invalid object storage response'); }
  const xml = Buffer.concat(chunks).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|<(?:\w+:)?Error(?:\s|>)/i.test(xml)) throw new Error('Object storage multipart request failed');
  return xml;
}
function uploadIdentity(xml) {
  const value = /<(?:\w+:)?UploadId(?:\s[^>]*)?>([^<]+)<\/(?:\w+:)?UploadId>/.exec(xml)?.[1];
  if (!value || value.length > 4096 || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(value)) throw new Error('Invalid object storage upload identity');
  let decoded;
  try {
    decoded = value.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity) => entity[0] === '#' ? String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
  } catch { throw new Error('Invalid object storage upload identity'); }
  if (!decoded || /[\x00-\x1f\x7f]/.test(decoded)) throw new Error('Invalid object storage upload identity');
  return decoded;
}

export function createStorage({ dataDir, env = process.env }) {
  const names = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const remote = names.some(name => Boolean(env[name]));
  let endpoint;
  if (remote) {
    try { endpoint = new URL(env.S3_ENDPOINT); } catch { throw new Error('Incomplete S3 storage configuration'); }
    if (names.some(name => !env[name]) || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET)) throw new Error('Invalid S3 storage configuration');
  }
  const root = path.resolve(dataDir, 'objects');
  const localPath = key => { validKey(key); return remote ? null : path.join(root, ...key.split('/')); };
  const signUrl = (key, { expiresIn = 900, method = 'GET', queryParams = {} } = {}) => {
    validKey(key);
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > 604800) throw new Error('Invalid signed URL expiry');
    if (!['GET', 'PUT', 'POST', 'DELETE'].includes(method)) throw new Error('Invalid signed URL method');
    if (!remote) return null;
    const region = env.S3_REGION || 'auto';
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);
    const scope = `${date}/${region}/s3/aws4_request`;
    const pathname = `/${encode(env.S3_BUCKET)}/${key.split('/').map(encode).join('/')}`;
    const params = {
      ...queryParams,
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${env.S3_ACCESS_KEY_ID}/${scope}`,
      'X-Amz-Date': timestamp, 'X-Amz-Expires': String(expiresIn), 'X-Amz-SignedHeaders': 'host',
    };
    const query = Object.keys(params).sort().map(name => `${encode(name)}=${encode(params[name])}`).join('&');
    const canonical = [method, pathname, query, `host:${endpoint.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.S3_SECRET_ACCESS_KEY}`, date), region), 's3'), 'aws4_request');
    const signature = hmac(signingKey, `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).toString('hex');
    return `${endpoint.origin}${pathname}?${query}&X-Amz-Signature=${signature}`;
  };
  const signedUrl = async (key, options = {}) => {
    if (options.method && !['GET', 'PUT'].includes(options.method)) throw new Error('Invalid signed URL method');
    return signUrl(key, { expiresIn: options.expiresIn ?? 900, method: options.method || 'GET' });
  };
  async function request(key, method, options = {}, queryParams = {}) {
    let response;
    try { response = await fetch(signUrl(key, { method, expiresIn: 3600, queryParams }), { ...options, method, redirect: 'error', signal: AbortSignal.timeout(60 * 60 * 1000) }); }
    catch { throw new Error('Object storage transfer failed'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Object storage request failed (${response.status})`); }
    return response;
  }
  async function multipart(key, localFile, size) {
    if (Math.ceil(size / partSize) > 10000) throw new Error('Object storage multipart file is too large');
    const initialized = await request(key, 'POST', { headers: { 'Content-Type': 'application/octet-stream' } }, { uploads: '' });
    const uploadId = uploadIdentity(await readXml(initialized));
    try {
      const parts = [];
      for (let start = 0, partNumber = 1; start < size; start += partSize, partNumber++) {
        const end = Math.min(size, start + partSize) - 1;
        const stream = createReadStream(localFile, { start, end });
        try {
          const response = await request(key, 'PUT', { body: stream, duplex: 'half', headers: { 'Content-Length': String(end - start + 1) } }, { uploadId, partNumber: String(partNumber) });
          const etag = response.headers.get('etag');
          await response.body?.cancel();
          if (!etag || etag.length > 1024 || /[\x00-\x1f\x7f]/.test(etag)) throw new Error('Invalid object storage part response');
          parts.push(`<Part><PartNumber>${partNumber}</PartNumber><ETag>${escapeXml(etag)}</ETag></Part>`);
        } finally { stream.destroy(); }
      }
      const body = `<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>`;
      const complete = await request(key, 'POST', { body, headers: { 'Content-Type': 'application/xml', 'Content-Length': String(Buffer.byteLength(body)) } }, { uploadId });
      // S3 can send an Error XML body after HTTP 200; read the full completion response.
      const xml = await readXml(complete);
      if (!/<(?:\w+:)?CompleteMultipartUploadResult(?:\s|>)/.test(xml)) throw new Error('Invalid object storage completion response');
    } catch {
      try { const response = await request(key, 'DELETE', {}, { uploadId }); await response.body?.cancel(); }
      catch { throw new Error('Object storage multipart upload failed; incomplete upload cleanup could not be confirmed'); }
      throw new Error('Object storage multipart upload failed');
    }
  }
  return {
    localPath, signedUrl,
    async put(key, localFile) {
      validKey(key);
      const info = await stat(localFile);
      if (!info.isFile()) throw new Error('Upload source is not a file');
      if (remote) {
        if (info.size > partSize) { await multipart(key, localFile, info.size); return { key, size: info.size }; }
        const stream = createReadStream(localFile);
        try {
          const response = await request(key, 'PUT', { body: stream, duplex: 'half', headers: { 'Content-Length': String(info.size), 'Content-Type': 'application/octet-stream' } });
          await response.body?.cancel();
        } finally { stream.destroy(); }
      } else {
        const destination = localPath(key);
        await mkdir(path.dirname(destination), { recursive: true });
        if (path.resolve(localFile) !== destination) {
          const temporary = `${destination}.${randomUUID()}.tmp`;
          try { await copyFile(localFile, temporary); await rename(temporary, destination); }
          finally { await rm(temporary, { force: true }); }
        }
      }
      return { key, size: info.size };
    },
    async get(key, localFile) {
      validKey(key);
      await mkdir(path.dirname(path.resolve(localFile)), { recursive: true });
      if (!remote && localPath(key) === path.resolve(localFile)) return localFile;
      const temporary = `${localFile}.${randomUUID()}.tmp`;
      try {
        if (remote) { const response = await request(key, 'GET'); await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' })); }
        else await copyFile(localPath(key), temporary);
        await rename(temporary, localFile);
      } finally { await rm(temporary, { force: true }); }
      return localFile;
    },
  };
}
