import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createStore } from './store.mjs';
import { createStorage } from './storage.mjs';
import { fail, normalizeSettings, normalizeAd, timelineDuration } from './render.mjs';
import { PRIMARY_VIDEO_MODEL, ANALYSIS_VERSION } from './openai.mjs';
import { createTokens, LOCAL_OWNER } from './tokens.mjs';
import { projectExports } from './project-export.mjs';

const MAX_FILE = 20 * 1024 ** 3, CHUNK = 8 * 1024 ** 2;
const projectView = ({analysis,analysisWindows,analysisResult,analysisCache,sourceFingerprint,editCache,adPreviewJobId,...project}) => project;
const readyClips = project => [...(project.exports ?? (project.finalFile ? [{ id: project.finalFile }] : [])), ...(project.candidates || []).filter(candidate => candidate.ready).map(candidate => ({...candidate,format:candidate.settings?.format||'9:16'}))];
const busyStates = ['PREPROCESSING','TRANSCRIBING','ANALYZING','RENDERING','EXPORTING'];
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
  const locks = new Set(), limits = new Map(), tokens = createTokens(store);
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
    if (entry.download) headers['Content-Disposition'] = 'attachment; filename="scenza.mp4"';
    response.writeHead(status, headers);
    if (request.method === 'HEAD') response.end(); else await pipeline(createReadStream(file, { start, end }), response).catch(() => {});
  }
  return {
    store,
    tokens,
    close: () => store.close(),
    async listClips(ownerId) {
      const projects = await store.listProjects(ownerId);
      return projects.flatMap(project => readyClips(project)
        .filter(clip => project.files[clip.id]).map((clip, index) => ({
          id: `ai:${project.id}:${clip.id}`, projectId: project.id, projectUrl: `/ai/${project.id}`,
          title: clip.title || `${project.title} · Клип ${index + 1}`, url: `/api/video/projects/${project.id}/files/${clip.id}`,
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
        send(response, { month, sourceMinutes, sourceCount, editRequests, ...(ledger ? { tokens: ledger.balance, tokenHistory: ledger.history } : {}) }); return true;
      }
      if (route === '/api/video/config' && method === 'GET') { send(response, { aiReady: !!env.OPENROUTER_API_KEY?.trim(), maxFileSize: MAX_FILE, chunkSize: CHUNK }); return true; }
      if (route === '/api/video/projects' && method === 'GET') { send(response, { projects: (await store.listProjects(ownerId)).map(projectView) }); return true; }
      if (route === '/api/video/import' && method === 'POST') {
        const body = await json(request);
        if (typeof body.url !== 'string' || body.url.length > 4000) throw fail('Введите прямую ссылку на видео.');
        const { publicUrl } = await import('../index.mjs'); await publicUrl(body.url);
        const project = { id:randomUUID(), title:'Видео по ссылке', sourceUrl:body.url, createdAt:new Date().toISOString(), status:'UPLOADING', upload:{name:'Видео по ссылке',size:0,bytes:0},files:{},candidates:[],versions:[],music:[],retention:'keep-original' };
        await store.saveProject(ownerId,project); const job = await queue(ownerId,project,'preprocess'); send(response,{project:projectView(project),job},202);return true;
      }
      if (route === '/api/video/projects' && method === 'POST') {
        const body = await json(request);
        if (typeof body.name !== 'string' || !/\.(mp4|mov|mkv|webm|m4v)$/i.test(body.name) || !Number.isSafeInteger(body.size) || body.size < 1 || body.size > MAX_FILE) throw fail('Выберите MP4, MOV, MKV или WebM до 20 ГБ.');
        const project = { id: randomUUID(), title: path.basename(body.name).slice(0,120), createdAt: new Date().toISOString(), status: 'UPLOADING', upload: { name: path.basename(body.name), size: body.size, bytes: 0 }, files: {}, candidates: [], versions: [], music: [], retention: 'keep-original' };
        await store.saveProject(ownerId, project); send(response, { project }, 201); return true;
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
      if (method === 'GET' && !action) { send(response,{project:projectView(project)}); return true; }
      if (method === 'GET' && action === 'project-export') {
        const format = projectExports[url.searchParams.get('format')], candidate = project.candidates.find(item => item.id === url.searchParams.get('candidate'));
        const settings = candidate?.settings || project.settings || project.candidates.find(item => item.ready)?.settings;
        if (!format || !settings) throw fail('Экспорт проекта станет доступен после подготовки роликов.', 409);
        response.writeHead(200, { 'Content-Type': format.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="scenza-${project.id.slice(0, 8)}.${format.extension}"` });
        response.end(format.build(project, settings)); return true;
      }
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
        if (currentCache && project.candidates.length && project.candidates.every(candidate=>candidate.ready&&project.files[candidate.id])) { send(response,{project:projectView(project),cached:true}); return true; }
        if (!project.candidates.length && !env.OPENROUTER_API_KEY?.trim()) throw fail('AI-анализ пока не подключён. Администратору нужно настроить ключ сервиса.',503);
        if (!project.files.original) throw fail('Сначала загрузите и подготовьте видео.',409);
        send(response,{job:await queue(ownerId,project,'analyze')},202); return true;
      }
      if (method === 'POST' && ['preview','revise','export','ad-preview'].includes(action)) {
        const body = await json(request);
        if (!project.candidates.length) throw fail('Сначала завершите анализ видео.',409);
        if (action === 'export' && !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status)) throw fail('Сначала подтвердите ролик.',409);
        if (action === 'ad-preview' && (!project.ad || !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status))) throw fail('Подтвердите ролик и загрузите рекламу.',409);
        if (action === 'export' && project.ad && !project.adPreview) throw fail('Сначала посмотрите предпросмотр рекламы.',409);
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
        project.status='APPROVED'; project.error=null; project.approvedVersion=project.currentVersion; project.adPreview=null; await store.saveProject(ownerId,project); send(response,{project:projectView(project)}); return true;
      }
      if (method === 'POST' && action === 'restore') {
        if (busyStates.includes(project.status)) throw fail('Дождитесь завершения обработки.',409);
        const body=await json(request), version=project.versions.find(item=>item.id===body.versionId);
        if (!version) throw fail('Версия не найдена.',404);
        if (Object.hasOwn(version,'ad')) project.ad=version.ad;
        project.settings=version.settings; project.currentVersion=version.id; project.adPreview=null; project.status='AWAITING_APPROVAL'; project.error=null; await store.saveProject(ownerId,project); send(response,{project:projectView(project)}); return true;
      }
      if (method === 'POST' && ['advertisement','music'].includes(action)) {
        if (busyStates.includes(project.status)) throw fail('Дождитесь завершения обработки.',409);
        const name=url.searchParams.get('filename')||'', isAd=action==='advertisement';
        if (isAd && !(project.status==='READY'&&project.candidates.some(candidate=>candidate.ready)) && (!project.settings || !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status))) throw fail('Сначала подтвердите ролик.',409);
        const videoAd=isAd&&/\.(mp4|mov|webm|m4v)$/i.test(name);
        if (!(isAd ? /\.(png|jpg|jpeg|webp|mp4|mov|webm|m4v)$/i : /\.(mp3|wav|m4a|ogg)$/i).test(name)) throw fail(isAd?'Загрузите PNG, JPG, WEBP или видео MP4, MOV, WebM до 30 секунд.':'Загрузите MP3, WAV, M4A или OGG.');
        const assetId=randomUUID(), local=path.join(root,'uploads',`${assetId}${path.extname(name).toLowerCase()}`);
        await writeUpload(request,local,isAd&&!videoAd?20*1024**2:100*1024**2);
        // Decode in the worker before making any uploaded media available.
        send(response,{job:await queue(ownerId,project,'asset',{assetId,localName:path.basename(local),name:path.basename(name).slice(0,120),kind:isAd?'ad':'music',...(isAd?{adKind:videoAd?'video':'image'}:{}),previousStatus:project.status})},202); return true;
      }
      if (method === 'PUT' && action === 'advertisement') {
        if (!project.ad || !['APPROVED','ADDING_AD','COMPLETED'].includes(project.status)) throw fail('Подтвердите ролик и загрузите рекламу.',409);
        const body=await json(request), duration=timelineDuration(project.settings);
        const options=normalizeAd(Object.fromEntries(['position','width','height','fill','start','duration','opacity'].map(key=>[key,body[key]]).filter(([,value])=>value!==undefined)),duration);
        project.ad={...project.ad,...options}; project.adPreview=null; project.status='ADDING_AD'; await store.saveProject(ownerId,project); send(response,{project:projectView(project)}); return true;
      }
      throw fail('Неизвестный запрос.',404);
    },
  };
}
