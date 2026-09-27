import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import zlib from 'node:zlib';

// Minimal ZIP writer (store method, no compression): videos are already compressed, and a plain
// store archive opens everywhere, including Windows Explorer and macOS Finder. Limited to < 4 GiB.
const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buffer, previous = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer, previous);
  let crc = ~previous >>> 0;
  for (let i = 0; i < buffer.length; i++) crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}
function dosTime(date) {
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}
async function fileCrc(file) {
  let crc = 0;
  for await (const chunk of createReadStream(file)) crc = crc32(chunk, crc);
  return crc;
}
const write = (stream, buffer) => new Promise((resolve, reject) => stream.write(buffer, error => error ? reject(error) : resolve()));
const pipeFile = (stream, file) => new Promise((resolve, reject) => {
  const input = createReadStream(file);
  input.on('error', reject); input.on('end', resolve);
  input.pipe(stream, { end: false });
});

/** entries: [{ name, file }] or [{ name, data: string|Buffer }] */
export async function writeZip(target, entries, now = new Date()) {
  const out = createWriteStream(target), central = [], stamp = dosTime(now);
  let offset = 0;
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8');
      const data = entry.file ? null : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
      const size = entry.file ? (await fs.stat(entry.file)).size : data.length;
      if (offset + size > 0xfffffff0) throw new Error('Archive is too large');
      const crc = entry.file ? await fileCrc(entry.file) : crc32(data);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0, 8);
      header.writeUInt16LE(stamp.time, 10); header.writeUInt16LE(stamp.date, 12); header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(size, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28);
      await write(out, header); await write(out, name);
      if (entry.file) await pipeFile(out, entry.file); else await write(out, data);
      central.push({ name, crc, size, offset });
      offset += header.length + name.length + size;
    }
    let centralSize = 0;
    for (const item of central) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10);
      record.writeUInt16LE(stamp.time, 12); record.writeUInt16LE(stamp.date, 14); record.writeUInt32LE(item.crc, 16);
      record.writeUInt32LE(item.size, 20); record.writeUInt32LE(item.size, 24); record.writeUInt16LE(item.name.length, 28);
      record.writeUInt32LE(item.offset, 42);
      await write(out, record); await write(out, item.name);
      centralSize += record.length + item.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
    await write(out, end);
  } finally {
    await new Promise(resolve => out.end(resolve));
  }
}
