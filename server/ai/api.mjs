import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createStore } from './store.mjs';
import { createStorage } from './storage.mjs';
import { fail, normalizeSettings, normalizeAd, timelineDuration, SOURCE_LIMITS } from './render.mjs';
const AD_FIELDS = ['position','width','height','fill','fit','start','duration','opacity','offsetX','offsetY','fade','background','backgroundColor'];
import { PRIMARY_VIDEO_MODEL, ANALYSIS_VERSION } from './openai.mjs';
import { createTokens, LOCAL_OWNER } from './tokens.mjs';

const MAX_FILE = SOURCE_LIMITS.maxBytes, CHUNK = 8 * 1024 ** 2;
const SOURCE_NAME = new RegExp(`\\.(${SOURCE_LIMITS.formats.join('|')})$`, 'i');
const formatsText = SOURCE_LIMITS.formats.filter(format => format !== 'm4v').map(format => format === 'webm' ? 'WebM' : format.toUpperCase()).join(', ');
const sourceError = () => fail(`Выберите видео ${formatsText} до ${MAX_FILE / 1024 ** 3} ГБ.`);
// Measured steps of the pipeline; each record is seconds spent per second of source (or of the finished clip).
const PHASES = ['preprocess', 'transcribe', 'analyze', 'clips', 'render', 'revise', 'export', 'package'];
export function estimateRates(timings) {
  const rates = {};
  for (const phase of PHASES) {
    const values = timings.map(entry => entry?.[phase]).filter(entry => entry && entry.seconds > 0 && entry.units > 0).map(entry => entry.seconds / entry.units).sort((a, b) => a - b);
    // Fewer than three real runs give no honest range; the client then says the time is not known yet.
    if (values.length < 3) continue;
    const at = share => values[Math.min(values.length - 1, Math.round(share * (values.length - 1)))];
    rates[phase] = { low: at(.25), high: at(.8), samples: values.length };
  }
  return rates;
}
// Reusable look of a clip. Text, timings, chosen fragments, keywords and uploaded music belong to one video and are never saved.
export const TEMPLATE_KEYS = ['format', 'cropMode', 'cropSmoothing', 'muted', 'subtitles', 'subtitleStyle', 'subtitleSize', 'subtitleColor', 'subtitleFont', 'subtitleColors', 'subtitleColorEvery', 'subtitleAccentColor', 'subtitleY', 'subtitlePosition', 'musicVolume'];
export function templateSettings(input) {
  const settings = {}, skipped = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { settings, skipped };
  for (const key of TEMPLATE_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    try { settings[key] = normalizeSettings({ start: 0, end: 30, [key]: input[key] }, 60)[key]; }
    catch { skipped.push(key); }
  }
  return { settings, skipped };
}
const MAX_TEMPLATES = 20;
const projectView = ({analysis,analysisWindows,analysisResult,analysisCache,sourceFingerprint,editCache,adPreviewJobId,...project}) => project;
const readyClips = project => [...(project.exports ?? (project.finalFile ? [{ id: project.finalFile }] : [])), ...(project.candidates || []).filter(candidate => candidate.ready).map(candidate => ({...candidate,format:candidate.settings?.format||'9:16'}))];
const busyStates = ['PREPROCESSING','TRANSCRIBING','ANALYZING','RENDERING','EXPORTING'];
// Projects are shown as "Project 1, 2, 3…" instead of long file names. New projects store their number;
// older ones are numbered by creation order on the fly.
export function projectNumbers(projects) {
  const numbers = new Map(); let last = 0;
  for (const project of [...projects].sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))) {
    last = Number.isInteger(project.number) && project.number > 0 ? Math.max(last, project.number) : last + 1;
    numbers.set(project.id, Number.isInteger(project.number) && project.number > 0 ? project.number : last);
  }
  return numbers;
}
export const projectTitle = number => `Project ${number}`;
async function json(request) {
  let text = '';
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text) > 128 * 1024) throw fail('Запрос слишком большой.', 413); }
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw fail('Некорректный запрос.'); }
}
async function writeUpload(request, target, max, flags = 'w') {
  let size = 0;
  const limiter = new Transform({ transform(chunk, _encoding, next) { size += chunk.length; next(size > max ? fail('Файл слишком большой.', 413) : null, chunk); } });
  await pipeline(request, limiter, createWriteStream(target, { flags }));
  if (!size) throw fail('Файл пустой.');
  return size;
}
export async function createVideoApi({ dataDir, env = process.env }) {
  const root = path.join(dataDir, 'ai'); await fs.mkdir(path.join(root, 'uploads'), { recursive: true });
  const store = await createStore({ dataDir: root, env }), storage = createStorage({ dataDir: root, env });
  const locks = new Set(), limits = new Map(), tokens = createTokens(store), numberCache = new Map();
  const numbersFor = async ownerId => { const numbers = projectNumbers(await store.listProjects(ownerId)); if (numberCache.size > 5000) numberCache.clear(); numberCache.set(ownerId, numbers); return numbers; };
  const numberOf = async (ownerId, project) => {
    if (Number.isInteger(project.number) && project.number > 0) return project.number;
    const cached = numberCache.get(ownerId);
    return (cached?.has(project.id) ? cached : await numbersFor(ownerId)).get(project.id) || 1;
  };
  let estimates = null;
  // Templates live in one small JSON file per owner next to the video data, so they survive reloads and new sessions.
  const templateFile = ownerId => path.join(root, 'templates', `${createHash('sha256').update(String(ownerId)).digest('hex').slice(0, 32)}.json`);
  const templateWrites = new Map();
  async function readTemplates(ownerId) {
    const value = await fs.readFile(templateFile(ownerId), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw fail('Не удалось прочитать шаблоны.', 500); });
    const items = Array.isArray(value?.items) ? value.items : [];
    return { items, defaultId: items.some(item => item.id === value?.defaultId) ? value.defaultId : null };
  }
  function updateTemplates(ownerId, change) {
    const run = (templateWrites.get(ownerId) || Promise.resolve()).catch(() => {}).then(async () => {
      const list = await readTemplates(ownerId), result = change(list), file = templateFile(ownerId), temporary = `${file}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(list)); await fs.rename(temporary, file);
      return { result, list };
    });
    templateWrites.set(ownerId, run);
    return run;
  }
  const templateName = value => { const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; if (!name || name.length > 60) throw fail('Назовите шаблон: от 1 до 60 символов.'); return name; };
  // `templateId: null` means "no template"; when it is omitted, the owner's default template is used.
  async function chosenTemplate(ownerId, templateId) {
    if (templateId === null) return null;
    const list = await readTemplates(ownerId), id = templateId === undefined ? list.defaultId : templateId;
    if (!id) return null;
    const item = list.items.find(entry => entry.id === id);
    if (!item) { if (templateId === undefined) return null; throw fail('Шаблон не найден. Выберите другой.', 404); }
    return { id: item.id, name: item.name, settings: templateSettings(item.settings).settings };
  }
  const view = async (ownerId, project) => ({ ...projectView(project), title: projectTitle(await numberOf(ownerId, project)) });
  const nextNumber = async ownerId => Math.max(0, ...(await numbersFor(ownerId)).values()) + 1;
  const send = (response, value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
  const queue = async (ownerId, project, type, payload = {}) => {
    if (busyStates.includes(project.status)) throw fail('Дождитесь завершения текущей обработки.', 409);
    const job = await store.enqueue(ownerId, project.id, type, payload);
    project.jobId = job.id; project.status = type === 'preprocess' ? 'PREPROCESSING' : type === 'analyze' ? 'ANALYZING' : type === 'export' ? 'EXPORTING' : 'RENDERING';
    return job;
  };
  async function serveFile(request, response, entry) {
    const remote = await storage.signedUrl(entry.key, { expiresIn: 900 });
    if (remote) { response.writeHead(302, { Location: remote, 'Cache-Control': 'no-store' }); response.end(); return; }
    const file = storage.localPath(entry.key), stat = await fs.stat(file).catch(() => { throw fail('Файл пока недоступен.', 404); });
    let start = 0, end = stat.size - 1, status = 200;
    const headers = { 'Content-Type': entry.mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': entry.download ? 'private, no-cache' : 'private, max-age=60' };
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) throw fail('Некорректный диапазон.', 416);
      if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      else start = Math.max(0, stat.size - Number(match[2]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end-start+1;
    if (entry.download) headers['Content-Disposition'] = `attachment; filename="${/^[\w.-]{1,80}$/.test(entry.filename || '') ? entry.filename : 'scenza.mp4'}"`;
    response.writeHead(status, headers);
    if (request.method === 'HEAD') response.end(); else await pipeline(createReadStream(file, { start, end }), response).catch(() => {});
  }
  return {
    store,
    tokens,
    close: () => store.close(),
    async listClips(ownerId) {
      const projects = await store.listProjects(ownerId), numbers = projectNumbers(projects);
      return projects.flatMap(project => readyClips(project)
        .filter(clip => project.files[clip.id]).map((clip, index) => ({
          id: `ai:${project.id}:${clip.id}`, projectId: project.id, projectUrl: `/ai/${project.id}`,
          title: clip.title || `${projectTitle(numbers.get(project.id) || 1)} · Клип ${index + 1}`, url: `/api/video/projects/${project.id}/files/${clip.id}`,
          image: project.files.poster ? `/api/video/projects/${project.id}/files/poster` : '',
          duration: clip.duration ?? (project.settings ? timelineDuration(project.settings) : 0),
          format: clip.format ?? project.settings?.format ?? '9:16', createdAt: clip.createdAt ?? project.createdAt,
          telegramAvailable: !!storage.localPath(project.files[clip.id].key),
        })));
    },
    async localClipFile(ownerId, clipId) {
      const match = /^ai:([\w-]+):([\w-]+)$/.exec(clipId);
      const project = match && await store.getProject(ownerId, match[1]);
      if (!project || !readyClips(project).some(clip => clip.id === match[2])) throw fail('Клип не найден.', 404);
      const entry = project.files[match[2]], file = entry && storage.localPath(entry.key);
      if (!file) throw fail('Скачайте клип из облачного хранилища для ручной отправки в Telegram.');
      return file;
    },
    async handle(request, response, ownerId) {
      const url = new URL(request.url, 'http://localhost'), route = url.pathname;
      if (!route.startsWith('/api/video/')) return false;
      const method = request.method;
      const key = `${ownerId}:${method === 'GET' ? 'read' : 'write'}`, now = Date.now();
      if (limits.size > 2000) for (const [id, value] of limits) if (value.until < now) limits.delete(id);
      const limit = limits.get(key) || { count: 0, until: now+60000 };
      if (limit.until < now) { limit.count = 0; limit.until = now+60000; }
      limit.count++; limits.set(key,limit); if (limit.count > 600) throw fail('Слишком много запросов. Повторите через минуту.',429);
      if (route === '/api/video/usage' && method === 'GET') {
        const { month, sourceMinutes, sourceCount, editRequests } = await store.ownerMonthlyUsage(ownerId);
        const ledger = ownerId === LOCAL_OWNER ? null : await tokens.summary(ownerId);
        send(response, { month, sourceMinutes, sourceCount, editRequests, ...(ledger ? { tokens: ledger.balance, tokenHistory: ledger.history, publicationBonus: ledger.publicationBonus } : {}) }); return true;
      }
      if (route === '/api/video/bonus/publication' && method === 'POST') {
        if (!(await store.listProjects(ownerId)).some(project => readyClips(project).length)) throw fail('Сначала подготовьте и опубликуйте ролик из SCENZA.', 409);
        send(response, await tokens.publicationBonus(ownerId, (await json(request)).url)); return true;
      }
      if (route === '/api/video/config' && method === 'GET') { send(response, { aiReady: !!env.OPENROUTER_API_KEY?.trim(), maxFileSize: MAX_FILE, chunkSize: CHUNK, limits: SOURCE_LIMITS }); return true; }
      if (route === '/api/video/estimate' && method === 'GET') {
        if (!estimates || estimates.until < Date.now()) estimates = { until: Date.now() + 5 * 60000, rates: estimateRates(await store.recentTimings(300).catch(() => [])) };
        send(response, { rates: estimates.rates }); return true;
      }
      if (route === '/api/video/templates' && method === 'GET') { send(response, await readTemplates(ownerId)); return true; }
      if (route === '/api/video/templates' && method === 'POST') {
        const body = await json(request), name = templateName(body.name), { settings, skipped } = templateSettings(body.settings);
        if (!Object.keys(settings).length) throw fail('В шаблоне нет настроек для сохранения.');
        const saved = await updateTemplates(ownerId, list => {
          if (list.items.length >= MAX_TEMPLATES) throw fail(`Можно сохранить до ${MAX_TEMPLATES} шаблонов. Удалите ненужный.`, 409);
          const now = new Date().toISOString(), item = { id: randomUUID(), name, settings, createdAt: now, updatedAt: now };
          list.items.push(item); if (body.default === true) list.defaultId = item.id;
          return item;
        });
        send(response, { template: saved.result, skipped, ...saved.list }, 201); return true;
      }
      const templateMatch = /^\/api\/video\/templates\/([\w-]+)$/.exec(route);
      if (templateMatch) {
        const body = method === 'DELETE' ? {} : await json(request);
        const saved = await updateTemplates(ownerId, list => {
          const item = list.items.find(entry => entry.id === templateMatch[1]);
          if (!item) throw fail('Шаблон не найден.', 404);
          if (method === 'DELETE') { list.items = list.items.filter(entry => entry !== item); if (list.defaultId === item.id) list.defaultId = null; return null; }
          if (method !== 'PUT') throw fail('Метод не поддерживается.', 405);
          if (body.name !== undefined) item.name = templateName(body.name);
          if (body.settings !== undefined) { const next = templateSettings(body.settings); if (!Object.keys(next.settings).length) throw fail('В шаблоне нет настроек для сохранения.'); item.settings = next.settings; }
          if (body.default === true) list.defaultId = item.id; else if (body.default === false && list.defaultId === item.id) list.defaultId = null;
          item.updatedAt = new Date().toISOString();
          return item;
        });
        send(response, { template: saved.result, ...saved.list }); return true;
      }
      if (route === '/api/video/projects' && method === 'GET') { const projects = await store.listProjects(ownerId), numbers = projectNumbers(projects); send(response, { projects: projects.map(project => ({ ...projectView(project), title: projectTitle(numbers.get(project.id) || 1) })) }); return true; }
      if (route === '/api/video/import' && method === 'POST') {
        const body = await json(request);
        if (typeof body.url !== 'string' || body.url.length > 4000) throw fail('Введите прямую ссылку на видео.');
        const { publicUrl } = await import('../index.mjs'); await publicUrl(body.url);
        const template = await chosenTemplate(ownerId, body.templateId);
        const number = await nextNumber(ownerId), project = { id:randomUUID(), number, title:projectTitle(number), sourceUrl:body.url, createdAt:new Date().toISOString(), status:'UPLOADING', upload:{name:'Видео по ссылке',size:0,bytes:0},files:{},candidates:[],versions:[],music:[],retention:'keep-original',...(template?{template}:{}) };
        await store.saveProject(ownerId,project); const job = await queue(ownerId,project,'preprocess'); send(response,{project:await view(ownerId,project),job},202);return true;
      }
      if (route === '/api/video/projects' && method === 'POST') {
        const body = await json(request);
        if (typeof body.name !== 'string' || !SOURCE_NAME.test(body.name) || !Number.isSafeInteger(body.size) || body.size < 1 || body.size > MAX_FILE) throw sourceError();
        // The browser-reported length only stops an obviously long file early; the worker checks the real length with ffprobe.
        if (Number.isFinite(body.duration) && body.duration > SOURCE_LIMITS.maxSeconds) throw fail(`Видео длиннее ${SOURCE_LIMITS.maxSeconds / 60} минут. Обрежьте его или загрузите более короткий фрагмент.`);
        const template = await chosenTemplate(ownerId, body.templateId);
        const number = await nextNumber(ownerId), project = { id: randomUUID(), number, title: projectTitle(number), createdAt: new Date().toISOString(), status: 'UPLOADING', upload: { name: path.basename(body.name), size: body.size, bytes: 0 }, files: {}, candidates: [], versions: [], music: [], retention: 'keep-original', ...(template ? { template } : {}) };
        await store.saveProject(ownerId, project); numberCache.delete(ownerId); send(response, { project: await view(ownerId, project) }, 201); return true;
      }
      const jobMatch = /^\/api\/video\/jobs\/([\w-]+)(\/retry)?$/.exec(route);
      if (jobMatch) {
        const job = await store.getJob(ownerId,jobMatch[1]); if (!job) throw fail('Задача не найдена.',404);
        if (method === 'GET') { send(response,{job}); return true; }
        if (method === 'POST' && jobMatch[2]) {
          const result = await store.retryJob(ownerId,job.id);
          send(response,{job:result},202); return true;
        }
      }
      const match = /^\/api\/video\/projects\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?$/.exec(route);
      if (!match) throw fail('Неизвестный запрос.',404);
      const [,id,action,fileId] = match, project = await store.getProject(ownerId,id);
      if (!project) throw fail('Проект не найден.',404);
      if (method === 'GET' && !action) { send(response,{project:await view(ownerId,project)}); return true; }
      if (['GET','HEAD'].includes(method) && action === 'files') {
        const entry = project.files[fileId]; if (!entry) throw fail('Файл не найден.',404);
        await serveFile(request,response,entry); return true;
      }
      if (method === 'PUT' && action === 'upload') {
        if (project.status !== 'UPLOADING') throw fail('Загрузка уже завершена.',409);
        if (locks.has(id)) throw fail('Часть файла ещё загружается.',409);
        const offset = Number(request.headers['upload-offset']);
        if (!Number.isSafeInteger(offset) || offset !== project.upload.bytes) { send(response,{error:'Продолжите загрузку с сохранённой позиции.',offset:project.upload.bytes},409); return true; }
        const target = path.join(root,'uploads',`${id}.original`); locks.add(id);
        try {
          if (offset === 0) await fs.writeFile(target,''); else await fs.truncate(target,offset);
          const bytes = await writeUpload(request,target,Math.min(CHUNK,project.upload.size-offset),'a');
          project.upload.bytes += bytes; await store.saveProject(ownerId,project); send(response,{offset:project.upload.bytes});
        } catch(error) { await fs.truncate(target,offset).catch(()=>{}); throw error; }
        finally { locks.delete(id); }
        return true;
      }
      if (method === 'POST' && action === 'complete') {
        if (project.status !== 'UPLOADING' || project.upload.bytes !== project.upload.size) throw fail('Дождитесь полной загрузки видео.',409);
        send(response,{job:await queue(ownerId,project,'preprocess')},202); return true;
      }
      if (method === 'POST' && action === 'analyze') {
        const source=createHash('sha256').update(JSON.stringify([project.sourceFingerprint,project.files.original?.key,project.upload?.size,project.duration])).digest('hex');
        const currentCache=!project.analysisCache||(project.analysisCache.source===source&&project.analysisCache.version===ANALYSIS_VERSION&&project.analysisCache.model===(env.PRIMARY_VIDEO_MODEL||PRIMARY_VIDEO_MODEL));
        if (currentCache && project.candidates.length && project.candidates.every(candidate=>candidate.ready&&project.files[candidate.id])) { send(response,{project:await view(ownerId,project),cached:true}); return true; }
        if (!project.candidates.length && !env.OPENROUTER_API_KEY?.trim()) throw fail('AI-анализ пока не подключён. Администратору нужно настроить ключ сервиса.',503);
        if (!project.files.original) throw fail('Сначала загрузите и подготовьте видео.',409);
        send(response,{job:await queue(ownerId,project,'analyze')},202); return true;
      }
      if (method === 'POST' && ['preview','revise','export','ad-preview'].includes(action)) {
        const body = await json(request);
        if (!project.candidates.length) throw fail('Сначала завершите анализ видео.',409);
        if (action === 'export' && !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status)) throw fail('Сначала подтвердите ролик.',409);
        if (action === 'ad-preview' && (!project.ad || !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status))) throw fail('Подтвердите ролик и загрузите рекламу.',409);
        if (action === 'revise' && (typeof body.request !== 'string' || !body.request.trim() || body.request.length>2000)) throw fail('Опишите правку, до 2000 символов.');
        const candidate = project.candidates.find(item => item.id === body.sceneId);
        if (action === 'preview' && !candidate && !project.settings) throw fail('Выберите найденный момент.');
        const approved = project.versions.find(item => item.id === project.approvedVersion);
        if (['export','ad-preview'].includes(action) && !approved) throw fail('Сначала подтвердите готовую версию ролика.',409);
        const candidateSettings = candidate ? {...candidate.settings,...body.settings,start:candidate.start,end:candidate.end,...(candidate.segments?{segments:candidate.segments}:{}),keywords:candidate.keywords||[]} : body.settings || project.settings;
        const settings = normalizeSettings(['export','ad-preview'].includes(action) ? approved.settings : candidateSettings,project.duration);
        if (settings.musicId && !project.music.some(item => item.id===settings.musicId)) throw fail('Музыкальный трек не найден.');
        send(response,{job:await queue(ownerId,project,action === 'ad-preview' ? 'preview' : action,{settings,request:body.request,sceneId:body.sceneId,adPreview:action==='ad-preview'})},202); return true;
      }
      if (method === 'POST' && action === 'approve') {
        if (project.status !== 'AWAITING_APPROVAL' || !project.versions.length) throw fail('Сначала дождитесь предпросмотра.',409);
        project.status='APPROVED'; project.error=null; project.approvedVersion=project.currentVersion; project.adPreview=null; await store.saveProject(ownerId,project); send(response,{project:await view(ownerId,project)}); return true;
      }
      if (method === 'POST' && action === 'restore') {
        if (busyStates.includes(project.status)) throw fail('Дождитесь завершения обработки.',409);
        const body=await json(request), version=project.versions.find(item=>item.id===body.versionId);
        if (!version) throw fail('Версия не найдена.',404);
        if (Object.hasOwn(version,'ad')) project.ad=version.ad;
        project.settings=version.settings; project.currentVersion=version.id; project.adPreview=null; project.status='AWAITING_APPROVAL'; project.error=null; await store.saveProject(ownerId,project); send(response,{project:await view(ownerId,project)}); return true;
      }
      if (method === 'POST' && ['advertisement','music'].includes(action)) {
        if (busyStates.includes(project.status)) throw fail('Дождитесь завершения обработки.',409);
        const name=url.searchParams.get('filename')||'', isAd=action==='advertisement';
        if (isAd && !(project.status==='READY'&&project.candidates.some(candidate=>candidate.ready)) && (!project.settings || !['AWAITING_APPROVAL','APPROVED','ADDING_AD','COMPLETED'].includes(project.status))) throw fail('Дождитесь готового ролика, затем добавьте баннер.',409);
        const videoAd=isAd&&/\.(mp4|mov|webm|m4v)$/i.test(name);
        if (!(isAd ? /\.(png|jpg|jpeg|webp|mp4|mov|webm|m4v)$/i : /\.(mp3|wav|m4a|ogg)$/i).test(name)) throw fail(isAd?'Загрузите PNG, JPG, WEBP или видео MP4, MOV, WebM до 30 секунд.':'Загрузите MP3, WAV, M4A или OGG.');
        const assetId=randomUUID(), local=path.join(root,'uploads',`${assetId}${path.extname(name).toLowerCase()}`);
        await writeUpload(request,local,isAd&&!videoAd?20*1024**2:100*1024**2);
        // Decode in the worker before making any uploaded media available.
        send(response,{job:await queue(ownerId,project,'asset',{assetId,localName:path.basename(local),name:path.basename(name).slice(0,120),kind:isAd?'ad':'music',...(isAd?{adKind:videoAd?'video':'image'}:{}),previousStatus:project.status})},202); return true;
      }
      if (method === 'PUT' && action === 'advertisement') {
        if (!project.ad || !project.settings || !['AWAITING_APPROVAL','APPROVED','ADDING_AD','COMPLETED'].includes(project.status)) throw fail('Сначала загрузите баннер для готового ролика.',409);
        const body=await json(request), duration=timelineDuration(project.settings);
        if (typeof body.fit === 'string' && body.fill !== undefined) delete body.fill;
        const options=normalizeAd(Object.fromEntries(AD_FIELDS.map(key=>[key,body[key]]).filter(([,value])=>value!==undefined)),duration);
        project.ad={...project.ad,...options}; project.adPreview=null; if (project.status!=='AWAITING_APPROVAL') project.status='ADDING_AD'; await store.saveProject(ownerId,project); send(response,{project:await view(ownerId,project)}); return true;
      }
      if (method === 'DELETE' && action === 'advertisement') {
        if (busyStates.includes(project.status)) throw fail('Дождитесь завершения обработки.',409);
        project.ad=null; project.adPreview=null; await store.saveProject(ownerId,project); send(response,{project:await view(ownerId,project)}); return true;
      }
      if (method === 'POST' && action === 'capcut') {
        const body = await json(request), candidate = typeof body.candidate === 'string' ? project.candidates.find(item => item.id === body.candidate && item.ready) : null;
        if (body.candidate !== undefined && !candidate) throw fail('Ролик не найден.',404);
        const version = project.versions.find(item => item.id === project.currentVersion);
        const source = candidate?.settings || version?.settings || project.settings;
        if (!source) throw fail('Пакет для CapCut станет доступен после подготовки роликов.',409);
        const settings = normalizeSettings(source, project.duration), key = candidate ? candidate.id : 'current', previousStatus = project.status;
        send(response,{job:await queue(ownerId,project,'export',{settings,capcut:true,key,previousStatus,number:await numberOf(ownerId,project)})},202); return true;
      }
      throw fail('Неизвестный запрос.',404);
    },
  };
}
