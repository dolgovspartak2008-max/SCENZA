import http from 'node:http';
import https from 'node:https';
import { promises as fs, createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { createAuth } from './auth.mjs';
import { createAdminService } from './admin.mjs';
import { createTelegramMembership } from './telegram-membership.mjs';

export const ffprobePath = ffprobe.path;
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_VIDEO = 2 * 1024 ** 3;
const formats = ['9:16', '1:1', '16:9'];
const videoFormats = 'mov,matroska,avi,mpeg,mpegts,flv,asf,ogg';
const blocked = new BlockList();
for (const [ip, mask] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(ip, mask);
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [ip, mask] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16]]) blockedV6.addSubnet(ip, mask, 'ipv6');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const exists = async file => fs.access(file).then(() => true, () => false);
const mediaUrl = name => `/media/${name}`;
const startsProcessing = (method, route) => method === 'POST' && (
  ['/api/upload', '/api/import', '/api/video/import', '/api/video/projects'].includes(route)
  || /^\/api\/projects\/[^/]+\/(?:analyze|export|banner)$/.test(route)
  || /^\/api\/video\/projects\/[^/]+\/(?:complete|analyze|preview|revise|export|ad-preview|advertisement|music)$/.test(route)
  || /^\/api\/video\/jobs\/[^/]+\/retry$/.test(route)
);
const now = () => new Date().toISOString();
const defaultEditor = (duration, format = '9:16') => ({ sceneId: '', start: 0, end: Math.min(duration, 30), format, cropX: 50, muted: false, subtitleText: '', subtitleStyle: 'classic', banner: null });

export function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) return !blocked.check(address);
  return version === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

export function supportedVideoPage(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)) return (url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '')) || /^\/(?:shorts|embed)\/[\w-]{11}\/?$/.test(url.pathname);
  if (hostname === 'youtu.be') return /^\/[\w-]{11}\/?$/.test(url.pathname);
  if (['vimeo.com', 'www.vimeo.com'].includes(hostname)) return /^\/\d+(?:\/[\w-]+)?\/?$/.test(url.pathname);
  if (hostname === 'player.vimeo.com') return /^\/video\/\d+\/?$/.test(url.pathname);
  if (['rutube.ru', 'www.rutube.ru'].includes(hostname)) return /^\/video\/[a-f0-9]{32}\/?$/.test(url.pathname);
  if (['vk.com', 'www.vk.com', 'vkvideo.ru', 'www.vkvideo.ru'].includes(hostname)) return /^\/video-?\d+_\d+\/?$/.test(url.pathname);
  return false;
}

export async function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('Введите действительную HTTP(S) ссылку на видео.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw fail('Поддерживаются публичные HTTP(S) ссылки без авторизации и нестандартных портов.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true }).catch(() => { throw fail('Не удалось найти сервер по этой ссылке.'); });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw fail('Ссылки на локальные и частные адреса запрещены.');
  return { url, addresses };
}

async function remoteStream(value, signal, redirects = 0) {
  if (redirects > 5) throw fail('Слишком много перенаправлений.');
  const { url, addresses } = await publicUrl(value);
  const selected = addresses.find(item => item.family === 4) || addresses[0];
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal, headers: { 'User-Agent': 'ScenaLocal/1.0', Accept: 'video/*, text/html;q=0.8, */*;q=0.5', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family),
    }, resolve);
    request.setTimeout(30000, () => request.destroy(fail('Сервер слишком долго не отвечает.')));
    request.on('error', reject);
  });
  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    return remoteStream(new URL(response.headers.location, url).href, signal, redirects + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); throw fail(`Сервер источника вернул HTTP ${response.statusCode}.`); }
  return { response, url };
}

async function smallBody(stream, limit = 128 * 1024) {
  const chunks = []; let length = 0;
  for await (const chunk of stream) { length += chunk.length; if (length > limit) throw fail('Запрос слишком большой.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function jsonBody(request) {
  try { const body = JSON.parse(await smallBody(request)); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
  catch (error) { if (error.status) throw error; throw fail('Ожидается корректный JSON объект.'); }
}
async function saveStream(stream, file, limit) {
  if (Number(stream.headers?.['content-length']) > limit) throw fail('Файл превышает допустимый размер.', 413);
  let size = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > limit ? fail('Файл превышает допустимый размер.', 413) : null, chunk); } });
  await pipeline(stream, limiter, createWriteStream(file, { flags: 'wx' }));
  if (!size) throw fail('Файл пустой.');
}
export async function downloadSource(value, file) {
  const { response } = await remoteStream(value, AbortSignal.timeout(3600000));
  if (String(response.headers['content-type']).includes('text/html')) { response.destroy(); throw fail('Не удалось обработать ссылку. Используйте прямую ссылку на видеофайл или загрузите видео с устройства.'); }
  await saveStream(response, file, 20 * 1024 ** 3);
}

// The token ledger lives in the video store; auth reaches it lazily so accounts load without the video pipeline.
const ledger = getVideoApi => ({ grant: async (...args) => (await getVideoApi()).tokens.grant(...args) });

export async function createServer({ dataDir = process.env.SCENA_DATA_DIR || path.join(workspace, '.scena'), seed = true, authOptions = {}, allowLocalStudio = true, allowedOrigins = [], videoLibrary } = {}) {
  dataDir = path.resolve(dataDir);
  const mediaDir = path.join(dataDir, 'media');
  await fs.mkdir(mediaDir, { recursive: true });
  const tokenLedger = ledger(() => getVideoApi());
  const referralBonus = async ({ userId, inviterId, bonus }) => {
    if (!inviterId) return;
    await tokenLedger.grant(userId, bonus, 'referral', `referral-${userId}`, 'Бонус за регистрацию по приглашению');
    await tokenLedger.grant(inviterId, bonus, 'referral', `referral-${userId}-inviter`, 'Бонус за приглашённого друга');
  };
  const auth = authOptions === null ? null : await createAuth({ allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'], telegramMembership: createTelegramMembership({ botToken: authOptions.telegramBotToken || process.env.SCENA_BOT_TOKEN }), tokenLedger, onRegister: referralBonus, ...authOptions, dataDir: path.join(dataDir, 'auth') });
  const accountStudios = new Map();
  let videoApi;
  const getVideoApi = () => videoApi ||= import('./ai/api.mjs').then(({ createVideoApi }) => createVideoApi({ dataDir })).catch(error => { videoApi = null; throw error; });
  const admin = auth ? await createAdminService({ auth, dataDir, getVideoApi }) : null;
  if (auth) auth.bots.panel = admin;
  const handleVideo = async (request, response, ownerId) => {
    if (!request.url?.startsWith('/api/video/')) return false;
    return (await getVideoApi()).handle(request, response, ownerId);
  };
  const aiClips = videoLibrary || { list: async () => (await getVideoApi()).listClips('local'), file: async id => (await getVideoApi()).localClipFile('local', id) };
  const databasePath = path.join(dataDir, 'library.json');
  let state = { projects: [], clips: [], publications: [], jobs: [], settings: { defaultFormat: '9:16', quality: '720p', telegramConnected: false }, banners: {} };
  const allClips = async () => [...state.clips, ...await aiClips.list()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (await exists(databasePath)) state = { ...state, ...JSON.parse(await fs.readFile(databasePath, 'utf8')) };
  for (const job of state.jobs) if (['running', 'queued'].includes(job.status)) Object.assign(job, { status: 'error', message: 'Обработка прервана перезапуском. Запустите её снова.' });
  let saveChain = Promise.resolve();
  const persist = () => {
    const content = JSON.stringify(state, null, 2);
    saveChain = saveChain.catch(() => {}).then(async () => {
      const temporary = `${databasePath}.tmp`;
      await fs.writeFile(temporary, content, { mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, databasePath); break; }
        catch (error) {
          if (attempt >= 5 || !['EPERM', 'EBUSY'].includes(error.code)) throw error;
          await new Promise(resolve => setTimeout(resolve, 30 * 2 ** attempt));
        }
      }
    });
    return saveChain;
  };
  await persist();
  const projectFor = id => { const project = state.projects.find(item => item.id === id); if (!project) throw fail('Проект не найден.', 404); return project; };
  const mediaFile = url => {
    const name = String(url).replace(/^\/media\//, '');
    if (!/^[a-zA-Z0-9_-]+\.(?:mp4|jpg|png|ass|srt)$/.test(name)) throw fail('Недопустимый путь к файлу.', 404);
    return path.join(mediaDir, name);
  };
  const controllers = new Map();
  const processes = new Map();
  const outputs = new Map();
  const trackOutputs = (job, id, kind, extensions) => {
    const entries = outputs.get(job.id) || [];
    entries.push({ id, kind, files: extensions.map(extension => path.join(mediaDir, `${id}.${extension}`)) });
    outputs.set(job.id, entries);
  };
  async function cleanOutputs(job) {
    for (const output of outputs.get(job.id) || []) {
      const registered = (output.kind === 'project' ? state.projects : state.clips).some(item => item.id === output.id);
      if (!registered) for (const file of output.files) await fs.rm(file, { force: true });
    }
    outputs.delete(job.id);
  }
  async function cancelJob(job) {
    if (!['queued', 'running'].includes(job.status)) return;
    Object.assign(job, { status: 'cancelled', message: 'Отменено' });
    processes.get(job.id)?.kill(); controllers.get(job.id)?.abort();
    await persist().catch(() => {});
  }
  function run(binary, args, job, options = {}) {
    return new Promise((resolve, reject) => {
      if (job?.status === 'cancelled') return reject(fail('Обработка отменена.'));
      const child = spawn(binary, args, { windowsHide: true, cwd: mediaDir, stdio: ['ignore', 'pipe', 'pipe'] });
      if (job) processes.set(job.id, child);
      let stdout = '', stderr = '';
      const timeout = setTimeout(() => { child.kill(); }, options.timeout || 30 * 60000);
      child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-1024 * 1024); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-512 * 1024); });
      child.on('error', error => { clearTimeout(timeout); if (job) processes.delete(job.id); reject(error); });
      child.on('close', code => { clearTimeout(timeout); if (job) processes.delete(job.id); if (code !== 0) reject(Object.assign(fail(job?.status === 'cancelled' ? 'Обработка отменена.' : `Не удалось обработать медиа: ${stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(-700)}`, 422), { exitCode: code })); else resolve({ stdout, stderr }); });
    });
  }
  const ff = (args, job, options) => run(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], job, options);
  const probe = async (file, job) => {
    const result = await run(ffprobePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', videoFormats, '-show_streams', '-show_format', '-of', 'json', file], job, { timeout: 30000 });
    const metadata = JSON.parse(result.stdout);
    const video = metadata.streams.find(item => item.codec_type === 'video' && !item.disposition?.attached_pic);
    const duration = Number(metadata.format.duration || video?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 12 * 3600 || video.width > 8192 || video.height > 8192) throw fail('Нужен видеофайл длительностью до 12 часов и размером кадра до 8192 пикселей.');
    return { duration, width: video.width, height: video.height, hasAudio: metadata.streams.some(item => item.codec_type === 'audio') };
  };
  // ponytail: one processing queue keeps local CPU predictable; widen only for measured demand.
  let queue = Promise.resolve();
  let closing = false;
  const enqueue = (type, task, projectId, cleanup) => {
    const job = { id: randomUUID(), type, status: 'queued', progress: 0, message: 'В очереди', ...(projectId ? { projectId } : {}) };
    state.jobs.push(job); void persist().catch(() => {});
    queue = queue.catch(() => {}).then(async () => {
      const markError = error => { if (job.status !== 'cancelled') Object.assign(job, { status: 'error', message: error.message || 'Не удалось обработать файл.' }); };
      try {
        if (job.status === 'cancelled' || closing) { if (closing) Object.assign(job, { status: 'cancelled', message: 'Обработка прервана остановкой сервера.' }); return; }
        Object.assign(job, { status: 'running', progress: 5, message: 'Обработка видео' }); await persist();
        await task(job);
        if (job.status !== 'cancelled') Object.assign(job, { status: 'done', progress: 100, message: 'Готово' });
      } catch (error) { markError(error); }
      finally {
        controllers.delete(job.id);
        try { await cleanup?.(); } catch (error) { markError(error); }
        try { await cleanOutputs(job); } catch (error) { markError(error); }
        await persist().catch(markError);
      }
    });
    return job;
  };
  const update = (job, progress, message) => { Object.assign(job, { progress, message }); };
  async function ingest(input, title, job, extra = {}) {
    const id = extra.id || randomUUID();
    trackOutputs(job, id, 'project', ['mp4', 'jpg']);
    const file = path.join(mediaDir, `${id}.mp4`);
    const metadata = await probe(input, job);
    update(job, 15, 'Подготовка видео для браузера');
    await ff(['-protocol_whitelist', 'file,pipe', '-format_whitelist', videoFormats, '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', file], job);
    const actual = await probe(file, job);
    update(job, 85, 'Создание обложки');
    await ff(['-ss', String(Math.min(metadata.duration / 3, 2)), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', path.join(mediaDir, `${id}.jpg`)], job);
    if (job.status === 'cancelled') throw fail('Обработка отменена.');
    const project = { id, title: title.slice(0, 120), image: mediaUrl(`${id}.jpg`), alt: `Кадр видео «${title}»`, genre: 'Видео', status: 'Загружено', tone: 'draft', action: 'Открыть редактор', video: mediaUrl(`${id}.mp4`), ...actual, createdAt: now(), scenes: [], settings: defaultEditor(actual.duration, state.settings.defaultFormat), ...extra };
    state.projects.unshift(project); job.projectId = id;
    try { await persist(); } catch (error) { state.projects = state.projects.filter(item => item !== project); throw error; }
    return project;
  }
  async function analyze(project, job) {
    const source = mediaFile(project.video);
    update(job, 10, 'Поиск смены кадров');
    const output = await ff(['-i', source, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], job);
    const cuts = [...output.stderr.matchAll(/pts_time:([0-9.]+)/g)].map(match => Number(match[1])).filter(value => value > 0.5 && value < project.duration - 0.5);
    const points = [0];
    for (const cut of cuts) if (cut - points.at(-1) >= 1 && points.length < 48) points.push(cut);
    if (points.length === 1) for (let index = 1; index < Math.min(6, Math.ceil(project.duration / 5)); index++) points.push(project.duration * index / Math.min(6, Math.ceil(project.duration / 5)));
    points.push(project.duration);
    const scenes = [];
    for (let index = 0; index < points.length - 1; index++) {
      const name = `${project.id}-scene-${index}.jpg`;
      await ff(['-ss', String(points[index]), '-i', source, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(mediaDir, name)], job);
      scenes.push({ id: `${project.id}-${index}`, title: `Сцена ${index + 1}`, start: points[index], end: points[index + 1], image: mediaUrl(name) });
      update(job, 30 + Math.round(50 * (index + 1) / (points.length - 1)), 'Создание сцен');
    }
    if (project.hasAudio) {
      const waveform = `${project.id}-waveform.png`;
      await ff(['-i', source, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x100:colors=0x9275ff', '-frames:v', '1', path.join(mediaDir, waveform)], job);
      project.waveform = mediaUrl(waveform);
    }
    if (job.status === 'cancelled') throw fail('Обработка отменена.');
    project.scenes = scenes; project.status = `${scenes.length} сцен`; project.tone = 'ready';
    if (!project.settings && scenes[0]) project.settings = { ...defaultEditor(project.duration, state.settings.defaultFormat), sceneId: scenes[0].id, start: scenes[0].start, end: Math.min(scenes[0].end, scenes[0].start + 30) };
    await persist();
  }
  function validateSettings(input, project) {
    if (!input || typeof input !== 'object') throw fail('Не переданы настройки клипа.');
    const { start, end, cropX, format, muted, subtitleText, subtitleStyle, sceneId } = input;
    if (![start, end, cropX].every(Number.isFinite) || start < 0 || end <= start || end > project.duration + 0.05 || cropX < 0 || cropX > 100) throw fail('Проверьте начало, конец и положение кадра.');
    if (!formats.includes(format) || typeof muted !== 'boolean' || typeof subtitleText !== 'string' || subtitleText.length > 5000 || !['classic', 'accent', 'minimal'].includes(subtitleStyle) || typeof sceneId !== 'string') throw fail('Недопустимые настройки клипа.');
    let banner = null;
    if (input.banner) {
      const asset = state.banners[input.banner.id];
      const { position, width, start: bannerStart, duration } = input.banner;
      if (!asset || asset.projectId !== project.id || !['top', 'bottom'].includes(position) || ![width, bannerStart, duration].every(Number.isFinite) || width < 10 || width > 100 || bannerStart < 0 || duration <= 0 || bannerStart >= end - start || duration > end - start + 0.05) throw fail('Проверьте изображение и интервал баннера.');
      banner = { id: input.banner.id, url: asset.url, position, width, start: bannerStart, duration };
    }
    return { sceneId, start, end, format, cropX, muted, subtitleText, subtitleStyle, banner };
  }
  function subtitleFiles(text, duration, style, width, height) {
    const escapeAss = value => value.replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').replace(/\r?\n/g, '\\N').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
    const lastWord = style === 'accent' ? /(\S+)(\s*)$/.exec(text) : null;
    const assText = lastWord ? `${escapeAss(text.slice(0, lastWord.index))}{\\c&HFFCF72&}${escapeAss(lastWord[1])}{\\c&HFFFFFF&}${escapeAss(lastWord[2])}` : escapeAss(text);
    const stamp = (time, ass = false) => { const hours = Math.floor(time / 3600); const minutes = Math.floor(time / 60) % 60; const seconds = Math.floor(time) % 60; const fraction = ass ? String(Math.floor(time % 1 * 100)).padStart(2, '0') : String(Math.floor(time % 1 * 1000)).padStart(3, '0'); return `${ass ? hours : String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${ass ? '.' : ','}${fraction}`; };
    const fontSize = Math.round(Math.min(width, height) * (style === 'minimal' ? 0.043 : 0.055));
    return {
      ass: `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,${style === 'minimal' ? 0 : -1},0,0,0,100,100,0,0,${style === 'minimal' ? 1 : 3},2,0,2,${Math.round(width * 0.06)},${Math.round(width * 0.06)},${Math.round(height * 0.05)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,${stamp(duration, true)},Default,,0,0,0,,${assText}\n`,
      srt: `1\n00:00:00,000 --> ${stamp(duration)}\n${text}\n`,
    };
  }
  async function exportClip(project, settings, job) {
    const id = randomUUID();
    trackOutputs(job, id, 'clip', ['mp4', 'jpg', 'ass', 'srt']);
    const duration = settings.end - settings.start;
    const scale = state.settings.quality === '1080p' ? 1080 : 720;
    const dimensions = settings.format === '9:16' ? [scale, scale * 16 / 9] : settings.format === '1:1' ? [scale, scale] : [scale * 16 / 9, scale];
    const [width, height] = dimensions.map(value => Math.round(value / 2) * 2);
    const args = ['-ss', String(settings.start), '-i', mediaFile(project.video)];
    if (settings.banner) args.push('-loop', '1', '-i', mediaFile(settings.banner.url));
    let filters = `[0:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${settings.cropX / 100}:(ih-oh)/2,setsar=1[base]`;
    let result = 'base';
    if (settings.banner) {
      const banner = settings.banner;
      filters += `;[1:v]scale=${Math.round(width * banner.width / 100)}:${Math.round(height * 0.3)}:force_original_aspect_ratio=decrease[badge];[base][badge]overlay=(W-w)/2:${banner.position === 'top' ? Math.round(height * 0.05) : `H-h-${Math.round(height * 0.05)}`}:enable='between(t,${banner.start},${banner.start + banner.duration})'[banner]`;
      result = 'banner';
    }
    const subtitle = settings.subtitleText.trim();
    if (subtitle) {
      const files = subtitleFiles(subtitle, duration, settings.subtitleStyle, width, height);
      await fs.writeFile(path.join(mediaDir, `${id}.ass`), files.ass);
      await fs.writeFile(path.join(mediaDir, `${id}.srt`), files.srt);
      filters += `;[${result}]ass=${id}.ass[out]`; result = 'out';
    }
    args.push('-filter_complex', filters, '-map', `[${result}]`);
    if (!settings.muted && project.hasAudio) args.push('-map', '0:a:0?', '-af', 'asetpts=PTS-STARTPTS', '-c:a', 'aac', '-b:a', '160k'); else args.push('-an');
    args.push('-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(mediaDir, `${id}.mp4`));
    update(job, 15, 'Рендер MP4'); await ff(args, job);
    await ff(['-i', path.join(mediaDir, `${id}.mp4`), '-frames:v', '1', '-vf', 'scale=480:-2', path.join(mediaDir, `${id}.jpg`)], job);
    if (job.status === 'cancelled') throw fail('Обработка отменена.');
    const clip = { id, projectId: project.id, title: project.title, url: `/downloads/${id}.mp4`, image: mediaUrl(`${id}.jpg`), duration, createdAt: now(), format: settings.format, ...(subtitle ? { subtitleUrl: mediaUrl(`${id}.srt`) } : {}) };
    state.clips.unshift(clip); job.clipId = id;
    try { await persist(); } catch (error) { state.clips = state.clips.filter(item => item !== clip); throw error; }
    project.status = 'Клип экспортирован';
  }
  async function importVideo(value, job) {
    const controller = new AbortController(); controllers.set(job.id, controller);
    const timer = setTimeout(() => controller.abort(), 15 * 60000);
    const input = path.join(mediaDir, `${job.id}-upload.bin`);
    try {
      if (supportedVideoPage(value)) {
        const downloader = path.join(workspace, '.tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
        if (!await exists(downloader)) throw fail('Импорт с видеоплощадок недоступен: локальный загрузчик не установлен. Загрузите файл или вставьте прямую ссылку на видео.');
        await publicUrl(value);
        update(job, 10, 'Скачивание публичного видео');
        let tooLarge = false;
        const sizeTimer = setInterval(async () => {
          try { if ((await fs.stat(input)).size > MAX_VIDEO) { tooLarge = true; processes.get(job.id)?.kill(); } } catch {}
        }, 1000);
        try {
          await run(downloader, ['--ignore-config', '--no-playlist', '--no-cache-dir', '--no-progress', '--no-warnings', '--no-part', '--max-downloads', '1', '--max-filesize', '2G', '--socket-timeout', '30', '--retries', '1', '--fragment-retries', '1', '--extractor-retries', '1', '--concurrent-fragments', '1', '--fixup', 'never', '--js-runtimes', `node:${process.execPath}`, '-f', 'best[ext=mp4][height<=1080]/best[height<=1080]/best', '-o', input, '--', value], job, { timeout: 15 * 60000 });
        } catch (error) {
          if (error.exitCode !== 101 || !await exists(input)) throw fail(tooLarge ? 'Размер видео превышает 2 ГБ.' : 'Площадка не отдала публичное видео. Проверьте ссылку или загрузите файл; закрытые видео, авторизация и DRM не поддерживаются.');
        } finally { clearInterval(sizeTimer); }
        if (!await exists(input)) throw fail('Загрузчик не создал видеофайл. Попробуйте прямую ссылку или загрузку с диска.');
        if ((await fs.stat(input)).size > MAX_VIDEO) throw fail('Размер видео превышает 2 ГБ.');
        await ingest(input, `Видео · ${new URL(value).hostname}`, job, { sourceUrl: value });
        return;
      }
      let { response, url } = await remoteStream(value, controller.signal);
      if (String(response.headers['content-type']).includes('text/html')) {
        const html = await smallBody(response, 2 * 1024 * 1024);
        let candidate;
        for (const tag of html.match(/<(?:meta|video|source)\b[^>]*>/gi) || []) {
          const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2]]));
          if (/^og:video(?::url|:secure_url)?$/.test(attrs.property || '') && attrs.content) candidate = attrs.content;
          if (/^<(?:video|source)\b/i.test(tag) && attrs.src) candidate ||= attrs.src;
        }
        if (!candidate) throw fail('На странице нет прямой ссылки на видео. Вставьте ссылку на MP4/MOV/WebM или загрузите файл.');
        ({ response, url } = await remoteStream(new URL(candidate.replace(/&amp;/g, '&'), url).href, controller.signal));
      }
      update(job, 10, 'Скачивание видео'); await saveStream(response, input, MAX_VIDEO);
      const title = decodeURIComponent(url.pathname.split('/').pop() || 'Видео по ссылке').replace(/\.[a-z0-9]{2,5}$/i, '') || 'Видео по ссылке';
      await ingest(input, title, job, { sourceUrl: value });
    } finally { clearTimeout(timer); await fs.rm(input, { force: true }); }
  }
  async function publicSettings() {
    let storageBytes = 0;
    for (const name of await fs.readdir(mediaDir)) storageBytes += (await fs.stat(path.join(mediaDir, name))).size;
    return { ...state.settings, storagePath: dataDir, storageBytes };
  }
  async function serveFile(request, response, file, attachment) {
    let stat;
    try { stat = await fs.stat(file); } catch { throw fail('Файл не найден.', 404); }
    const types = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.srt': 'application/x-subrip; charset=utf-8', '.ass': 'text/plain; charset=utf-8' };
    const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' };
    if (attachment) headers['Content-Disposition'] = `attachment; filename="scena-${attachment}.mp4"`;
    let start = 0, end = stat.size - 1, status = 200;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!range || (!range[1] && !range[2])) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1; response.writeHead(status, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    await pipeline(createReadStream(file, { start, end }), response).catch(() => {});
  }
  const server = http.createServer(async (request, response) => {
    let createdJob;
    const abandoned = () => request.aborted || response.destroyed;
    response.once('close', () => {
      if (!response.writableFinished) {
        request.destroy();
        if (createdJob) void cancelJob(createdJob);
      }
    });
    const send = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); };
    try {
      const host = request.headers.host || '';
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) throw fail('Недопустимый локальный адрес.', 403);
      const origin = request.headers.origin;
      if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173', ...allowedOrigins, ...(authOptions?.allowedOrigins || []), `http://${host}`].includes(origin)) throw fail('Доступ разрешён только из локального приложения.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Межсайтовый запрос запрещён.', 403);
      const url = new URL(request.url, `http://${host}`); const route = url.pathname; const method = request.method;
      if (method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      if (method === 'GET' && route === '/api/health/ready') { send({ ok: true }); return; }
      if (auth) {
        if (method === 'GET' && route === '/api/auth/session') { send({ user: auth.session(request), localStudioAllowed: allowLocalStudio }); return; }
        if (await auth.handle(request, response, route)) return;
        const account = auth.session(request);
        if (account) {
          if (route === '/api/support') {
            if (method === 'GET') { send({ tickets: await admin.userSupport(account.id) }); return; }
            if (method === 'POST') {
              const body = await jsonBody(request);
              send({ ticket: await admin.createSupportForUser(account.id, body.text, `web:${randomUUID()}`) }, 201); return;
            }
            throw fail('Метод не поддерживается.', 405);
          }
          const normalizedRoute = route.startsWith('/media/') ? '/media/:file' : route.startsWith('/downloads/') ? '/downloads/:file' : route.replace(/(\/api\/(?:projects|jobs|publications)\/)[^/]+/, '$1:id');
          const activityRoute = /^\/(?:media\/:file|downloads\/:file|api\/(?:health|projects|clips|publications|settings|upload|import|telegram\/send|(?:projects|jobs|publications)\/:id(?:\/(?:analyze|export|banner|cancel))?))$/.test(normalizedRoute) ? normalizedRoute : '/unknown';
          const activityEvent = ['GET', 'HEAD'].includes(method) ? 'studio.read' : route === '/api/upload' ? 'studio.upload' : route === '/api/import' ? 'studio.import' : route.endsWith('/export') ? 'studio.export' : route === '/api/telegram/send' ? 'studio.telegram_send' : 'studio.update';
          response.once('finish', () => {
            if (auth.bots?.recordActivity) void auth.bots.recordActivity(account.id, response.statusCode >= 400 ? 'studio.rejected' : activityEvent, { method, route: activityRoute, status: response.statusCode }).catch(() => console.error('SCENZA: не удалось сохранить событие активности.'));
          });
          if (startsProcessing(method, route)) {
            if (account.blocked) throw fail(`Создание роликов заблокировано. Причина: ${account.blockReason || 'обратитесь в поддержку'}. Вход и ваши данные доступны.`, 403);
            await admin.assertGenerationAllowed();
          }
          if (!account.accessActive && !['GET', 'HEAD'].includes(method)) throw fail('Доступ к обработке не активен. Войдите на сайт, чтобы получить стартовые токены, или обратитесь в поддержку.', 402);
          if (await handleVideo(request, response, account.id)) return;
          if (!accountStudios.has(account.id)) {
            const studio = createServer({ dataDir: path.join(dataDir, 'accounts', account.id), seed: false, authOptions: null, allowedOrigins: [...allowedOrigins, ...(authOptions?.allowedOrigins || [])], videoLibrary: { list: async () => (await getVideoApi()).listClips(account.id), file: async id => (await getVideoApi()).localClipFile(account.id, id) } });
            accountStudios.set(account.id, studio);
            studio.catch(() => accountStudios.delete(account.id));
          }
          (await accountStudios.get(account.id)).emit('request', request, response);
          return;
        }
        if (/(?:^|;\s*)scena_session=/.test(request.headers.cookie || '')) throw fail('Сеанс завершён. Войдите в аккаунт снова.', 401);
        if (!allowLocalStudio) throw fail('Войдите в аккаунт SCENZA.', 401);
      }
      if (admin && startsProcessing(method, route)) await admin.assertGenerationAllowed();
      if (route === '/api/support') throw fail('Войдите в аккаунт SCENZA для обращения в поддержку.', 401);
      if (await handleVideo(request, response, 'local')) return;
      if (method === 'GET' && route === '/api/health') { send({ ok: true, ffmpeg: await exists(ffmpegPath), pendingJobs: state.jobs.filter(job => ['queued', 'running'].includes(job.status)).length }); return; }
      if (method === 'GET' && route === '/api/projects') { send({ projects: state.projects }); return; }
      if (method === 'GET' && route === '/api/clips') { send({ clips: await allClips() }); return; }
      if (method === 'GET' && route === '/api/publications') { send({ publications: state.publications }); return; }
      if (method === 'POST' && route === '/api/publications') {
        const body = await jsonBody(request);
        if (!(await allClips()).some(clip => clip.id === body.clipId) || !['youtube', 'tiktok', 'instagram', 'telegram'].includes(body.platform) || typeof body.caption !== 'string' || body.caption.length > 5000) throw fail('Проверьте клип, площадку и подпись публикации.');
        const publication = { id: randomUUID(), clipId: body.clipId, platform: body.platform, caption: body.caption, status: 'draft', createdAt: now() };
        state.publications.unshift(publication); await persist(); send({ publication }, 201); return;
      }
      const publicationRoute = /^\/api\/publications\/([\w-]+)$/.exec(route);
      if (method === 'PATCH' && publicationRoute) {
        const publication = state.publications.find(item => item.id === publicationRoute[1]); if (!publication) throw fail('Публикация не найдена.', 404);
        const body = await jsonBody(request); if (!['draft', 'published'].includes(body.status)) throw fail('Неизвестный статус публикации.');
        publication.status = body.status; await persist(); send({ publication }); return;
      }
      if (method === 'POST' && route === '/api/telegram/send') {
        const body = await jsonBody(request);
        const clip = (await allClips()).find(item => item.id === body.clipId); if (!clip) throw fail('Клип не найден.', 404);
        const existingPublication = body.publicationId === undefined ? undefined : state.publications.find(item => item.id === body.publicationId);
        if (body.publicationId !== undefined && (!existingPublication || existingPublication.clipId !== clip.id || existingPublication.platform !== 'telegram')) throw fail('Публикация должна относиться к этому клипу и площадке Telegram.');
        if (body.caption !== undefined && (typeof body.caption !== 'string' || body.caption.length > 1024)) throw fail('Подпись Telegram должна содержать не больше 1024 символов.');
        const caption = body.caption ?? existingPublication?.caption ?? clip.title;
        if (caption.length > 1024) throw fail('Подпись Telegram должна содержать не больше 1024 символов.');
        if (!state.settings.telegramConnected || !state.settings.telegramChatId) throw fail('Сначала подключите Telegram бота и укажите Chat ID в настройках.');
        const file = clip.projectUrl ? await aiClips.file(clip.id) : path.join(mediaDir, `${clip.id}.mp4`);
        if ((await fs.stat(file)).size > 50 * 1024 * 1024) throw fail('Telegram Bot API принимает файлы до 50 МБ. Сократите клип или скачайте его для ручной отправки.');
        const secret = JSON.parse(await fs.readFile(path.join(dataDir, 'telegram-secret.json'), 'utf8'));
        const form = new FormData(); form.set('chat_id', state.settings.telegramChatId); form.set('caption', caption); form.set('document', await openAsBlob(file, { type: 'video/mp4' }), `scena-${clip.id}.mp4`);
        let result;
        try { const reply = await fetch(`https://api.telegram.org/bot${secret.token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) }); result = await reply.json(); }
        catch { throw fail('Не удалось подтвердить отправку в Telegram. Проверьте чат перед повторной отправкой.', 502); }
        if (!result.ok) throw fail('Telegram отклонил отправку. Проверьте Chat ID и доступ бота к чату.', 502);
        const publication = existingPublication || { id: randomUUID(), clipId: clip.id, platform: 'telegram', createdAt: now() };
        Object.assign(publication, { caption, status: 'published' });
        if (!existingPublication) state.publications.unshift(publication);
        await persist(); send({ publication, ok: true }); return;
      }
      if (method === 'GET' && route === '/api/settings') { send({ settings: await publicSettings() }); return; }
      if (method === 'PUT' && route === '/api/settings') {
        const body = await jsonBody(request);
        if (body.defaultFormat !== undefined && !formats.includes(body.defaultFormat)) throw fail('Неизвестный формат.');
        if (body.quality !== undefined && !['720p', '1080p'].includes(body.quality)) throw fail('Неизвестное качество.');
        if (body.telegramChatId !== undefined && (typeof body.telegramChatId !== 'string' || !/^(?:-?\d{1,20}|@[a-zA-Z][\w]{4,31}|)$/.test(body.telegramChatId))) throw fail('Проверьте Telegram Chat ID.');
        if (body.telegramToken !== undefined) {
          if (typeof body.telegramToken !== 'string' || (body.telegramToken && !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(body.telegramToken))) throw fail('Проверьте токен Telegram бота.');
          if (body.telegramToken) {
            let result;
            try { const reply = await fetch(`https://api.telegram.org/bot${body.telegramToken}/getMe`, { signal: AbortSignal.timeout(10000) }); result = await reply.json(); } catch { throw fail('Не удалось проверить Telegram бота. Попробуйте позже.'); }
            if (!result.ok) throw fail('Telegram отклонил токен бота.');
            await fs.writeFile(path.join(dataDir, 'telegram-secret.json.tmp'), JSON.stringify({ token: body.telegramToken }), { mode: 0o600 }); await fs.rename(path.join(dataDir, 'telegram-secret.json.tmp'), path.join(dataDir, 'telegram-secret.json'));
            state.settings.telegramConnected = true; state.settings.telegramUsername = result.result.username;
          } else { await fs.rm(path.join(dataDir, 'telegram-secret.json'), { force: true }); state.settings.telegramConnected = false; delete state.settings.telegramUsername; }
        }
        for (const key of ['defaultFormat', 'quality', 'telegramChatId']) if (body[key] !== undefined) state.settings[key] = body[key];
        await persist(); send({ settings: await publicSettings() }); return;
      }
      if (method === 'POST' && route === '/api/upload') {
        const filename = url.searchParams.get('filename') || 'Видео.mp4';
        if (!/\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(filename)) throw fail('Выберите MP4, MOV, WebM, MKV или AVI.');
        const input = path.join(mediaDir, `${randomUUID()}-upload.bin`);
        try { await saveStream(request, input, MAX_VIDEO); } catch (error) { await fs.rm(input, { force: true }); throw error; }
        if (abandoned()) { await fs.rm(input, { force: true }); return; }
        createdJob = enqueue('upload', active => ingest(input, path.basename(filename).replace(/\.[^.]+$/, ''), active), undefined, () => fs.rm(input, { force: true }));
        send({ job: createdJob }, 202); return;
      }
      if (method === 'POST' && route === '/api/import') {
        const body = await jsonBody(request); if (typeof body.url !== 'string' || body.url.length > 8192) throw fail('Введите ссылку на видео.');
        await publicUrl(body.url); if (abandoned()) return;
        createdJob = enqueue('import', active => importVideo(body.url, active)); send({ job: createdJob }, 202); return;
      }
      const jobs = /^\/api\/jobs\/([\w-]+)(\/cancel)?$/.exec(route);
      if (jobs) {
        const job = state.jobs.find(item => item.id === jobs[1]); if (!job) throw fail('Задача не найдена.', 404);
        if (method === 'POST' && jobs[2]) { await cancelJob(job); send({ job }); return; }
        if (method === 'GET' && !jobs[2]) { send({ job }); return; }
      }
      const projects = /^\/api\/projects\/([\w-]+)(?:\/(analyze|export|banner))?$/.exec(route);
      if (projects) {
        const project = projectFor(projects[1]); const action = projects[2];
        if (method === 'GET' && !action) { send({ project }); return; }
        if (method === 'PATCH' && !action) {
          const body = await jsonBody(request);
          const settings = body.settings === undefined ? undefined : validateSettings(body.settings, project);
          if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120)) throw fail('Название должно содержать 1–120 символов.');
          if (body.title !== undefined) project.title = body.title.trim(); if (settings) project.settings = settings; await persist(); send({ project }); return;
        }
        if (method === 'POST' && action === 'analyze') {
          const existing = state.jobs.find(job => job.projectId === project.id && job.type === 'analyze' && ['queued', 'running'].includes(job.status));
          send({ job: existing || enqueue('analyze', active => analyze(project, active), project.id) }, 202); return;
        }
        if (method === 'POST' && action === 'export') { const body = await jsonBody(request); const settings = validateSettings(body.settings, project); send({ job: enqueue('export', active => exportClip(project, settings, active), project.id) }, 202); return; }
        if (method === 'POST' && action === 'banner') {
          const id = randomUUID(); const input = path.join(mediaDir, `${id}-image.bin`); const output = path.join(mediaDir, `${id}.png`);
          try { await saveStream(request, input, 5 * 1024 * 1024); await ff(['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe,bmp_pipe', '-i', input, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-1", output], undefined, { timeout: 30000 }); }
          finally { await fs.rm(input, { force: true }); }
          const banner = { id, url: mediaUrl(`${id}.png`) }; state.banners[id] = { projectId: project.id, url: banner.url }; await persist(); send({ banner }); return;
        }
      }
      if (['GET', 'HEAD'].includes(method) && route.startsWith('/media/')) { await serveFile(request, response, mediaFile(route)); return; }
      const download = /^\/downloads\/([\w-]+)\.mp4$/.exec(route);
      if (['GET', 'HEAD'].includes(method) && download) { if (!state.clips.some(clip => clip.id === download[1])) throw fail('Клип не найден.', 404); await serveFile(request, response, path.join(mediaDir, `${download[1]}.mp4`), download[1]); return; }
      throw fail('Маршрут не найден.', 404);
    } catch (error) { if (!response.headersSent && !response.destroyed) send({ error: error.status ? error.message : 'Внутренняя ошибка. Проверьте доступ к диску и повторите действие.' }, error.status || 500); }
  });
  server.requestTimeout = 30 * 60000;
  server.on('close', () => {
    void videoApi?.then(api => api.close()).catch(() => {});
    closing = true;
    for (const child of processes.values()) child.kill();
    for (const controller of controllers.values()) controller.abort();
    for (const studio of accountStudios.values()) void studio.then(child => child.emit('close')).catch(() => {});
    accountStudios.clear();
  });
  if (seed) {
    const seeds = [['city', 'tihiy-gorod', 'Тихий город'], ['coast', 'za-gorizontom', 'За горизонтом'], ['ship', 'posledniy-reys', 'Последний рейс'], ['dawn', 'do-rassveta', 'До рассвета']];
    let credits = {};
    try { credits = JSON.parse(await fs.readFile(path.join(workspace, 'public/videos/sources.json'), 'utf8')); } catch {}
    for (const [name, id, title] of seeds) {
      const source = path.join(workspace, `public/videos/${name}.mp4`);
      if (!state.projects.some(project => project.id === id) && await exists(source)) enqueue('seed', async job => {
        const credit = Array.isArray(credits) ? credits.find(item => item.id === id || item.name === name || item.file === `${name}.mp4`) : credits[name];
        const project = await ingest(source, title, job, { id, ...(credit ? { sourceCredit: credit.sourceCredit || credit.credit || credit.author || credit.title || 'Демонстрационное видео', sourceUrl: credit.sourceUrl || credit.url || '' } : {}) });
        await analyze(project, job);
      }, id);
    }
  }
  server.auth = auth;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createServer();
  server.listen(5174, '127.0.0.1', () => console.log('СЦЕНА: локальное хранилище доступно на http://127.0.0.1:5174'));
}
