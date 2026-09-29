import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createStore } from './store.mjs';
import { createStorage } from './storage.mjs';
import { OpenRouterProvider, PRIMARY_VIDEO_MODEL, FAST_EDIT_MODEL, ANALYSIS_VERSION } from './openai.mjs';
import { analyzeLongVideo } from './analysis.mjs';
import { ff, run, inspect, normalizeSettings, normalizeAd, applyAdPatch, timelineDuration, adTotalDuration, render, fail } from './render.mjs';
import { createTokens } from './tokens.mjs';
import { exportSrt, packXml } from './project-export.mjs';
import { writeZip } from './zip.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const busyStates = ['PREPROCESSING','TRANSCRIBING','ANALYZING','RENDERING','EXPORTING'];
const seconds = value => `${Math.round(value * 10) / 10} сек.`;
// Plain-text guide shipped inside the CapCut pack (CapCut has no public project format to import).
export function capcutGuide({ settings, ad, subtitles, music }) {
  const steps = ['Откройте CapCut и создайте новый проект.', `Импортируйте 1-video.mp4 (формат ${settings.format}) и перетащите его на таймлайн.`];
  if (subtitles) steps.push('Субтитры: Текст → Автосубтитры → «Импорт файла» (или «Импорт субтитров») и выберите 2-subtitles.srt. Текст и стиль можно править прямо в CapCut.');
  if (ad) steps.push(ad.position === 'insert'
    ? `Баннер: поставьте курсор на ${seconds(ad.start)}, нажмите «Разделить», вставьте файл баннера между частями и растяните его на ${seconds(ad.duration)}. Так ролик встанет на паузу и покажет только баннер.`
    : `Баннер: добавьте файл баннера как «Наложение» с ${seconds(ad.position === 'final' ? Math.max(0, timelineDuration(settings) - ad.duration) : ad.start)} на ${seconds(ad.duration)} и настройте масштаб и положение.`);
  if (music) steps.push('Музыка: добавьте файл 4-music на аудиодорожку и уменьшите громкость под речь.');
  steps.push('Экспорт: нажмите «Экспорт» в CapCut и выберите 1080p.');
  const other = ['Распакуйте архив в одну папку, чтобы файлы лежали рядом.', 'Premiere Pro: Файл → Импорт → 5-premiere-davinci.xml. Появится последовательность с роликом и баннером на своих местах. Если Premiere спросит про файлы, укажите 1-video.mp4 и файл баннера из этой папки.', 'DaVinci Resolve: File → Import → Timeline → 5-premiere-davinci.xml, затем укажите эту папку как место с медиафайлами.', 'Субтитры 2-subtitles.srt в Premiere: Файл → Импорт, затем перетащите на дорожку субтитров; в DaVinci — перетащите SRT на таймлайн.'];
  return ['SCENZA → CapCut', '', ...steps.map((step, index) => `${index + 1}. ${step}`), '', 'SCENZA → Premiere Pro и DaVinci Resolve', '', ...other.map((step, index) => `${index + 1}. ${step}`)].join('\r\n') + '\r\n';
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function createWorker({ dataDir = process.env.SCENA_DATA_DIR || path.join(workspace,'.scena'), env = process.env, provider, python } = {}) {
  const root=path.join(dataDir,'ai'), cache=path.join(root,'cache'); await fs.mkdir(cache,{recursive:true});
  let usageJob, usageWarning = false;
  const store=await createStore({dataDir:root,env}), storage=createStorage({dataDir:root,env});
  const usageError=()=>{if(!usageWarning)console.warn('SCENZA: учёт расходов AI временно недоступен. Обработка продолжается; проверьте миграцию usage и соединение с БД.');usageWarning=true;};
  const recordUsage=async record=>{await store.recordAiUsage({sourceSeconds:usageJob.sourceSeconds,...record,ownerId:usageJob.ownerId,projectId:usageJob.projectId,jobId:usageJob.id,operation:usageJob.type});usageWarning=false;};
  const ai=provider||new OpenRouterProvider({apiKey:env.OPENROUTER_API_KEY || '',model:env.PRIMARY_VIDEO_MODEL || PRIMARY_VIDEO_MODEL,editModel:env.FAST_EDIT_MODEL || FAST_EDIT_MODEL,onUsage:recordUsage,onUsageError:usageError});
  const workerId=randomUUID(),tokens=createTokens(store);
  python ||= env.SCENZA_PYTHON || path.join(workspace,'.scena','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  let stopping=false;
  async function processJob(job) {
    usageJob = job;
    const project=await store.getProject(job.ownerId,job.projectId);
    if (!project) { await store.finishJob(job.id,workerId,{error:'Проект не найден.'}); return; }
    usageJob.sourceSeconds=project.duration;
    const folder=path.resolve(cache,`${job.id}-${workerId}`);
    if (!/^[a-f0-9-]{36}$/i.test(job.id) || !folder.startsWith(path.resolve(cache)+path.sep)) throw fail('Некорректная задача.',400);
    await fs.mkdir(folder,{recursive:true});
    let currentStage='Подготовка',progress=null,leaseError;
    const operation=new AbortController();
    const processVideo=(args,options={})=>ff(args,{...options,signal:operation.signal});
    const heartbeat=()=>store.heartbeat(job.id,workerId,{stage:currentStage,progress});
    const timer=setInterval(()=>void heartbeat().catch(error=>{leaseError=error;operation.abort();}),10000);
    const save=async()=>{if(leaseError)throw leaseError;await heartbeat();await store.saveProject(job.ownerId,project);};
    const stage=async(status,label)=>{project.status=status;currentStage=label;progress=null;await save();};
    const put=async(id,file,mime,download=false,filename='')=>{if(leaseError)throw leaseError;await heartbeat();const key=`${project.id}/${id}${path.extname(file)}`;await storage.put(key,file);project.files[id]={key,mime,...(download?{download:true}:{}),...(filename?{filename}:{})};return id;};
    const get=async(id)=>{if(!project.files[id])throw fail('Исходный файл не найден.',404);const target=path.join(folder,`${id}${path.extname(project.files[id].key)}`);await storage.get(project.files[id].key,target);return target;};
    const onProgress=value=>{progress=value;};
    const sourceIdentity=()=>fingerprint([project.sourceFingerprint,project.files.original?.key,project.upload?.size,project.duration]);
    const sourceUsage=async()=>{if(project.analyzedAt)await recordUsage({id:`source-${fingerprint([job.ownerId,project.id,sourceIdentity()])}`,kind:'source',sourceSeconds:project.duration,createdAt:project.analyzedAt}).catch(usageError);};
    const renderCandidates=async()=>{
        const original=await get('original');
        for(let i=0;i<project.candidates.length;i++) {
          const candidate=project.candidates[i];
          if(!candidate.ready || !project.files[candidate.id] || candidate.adFileId !== (project.ad?.fileId||null)) {
            const output=path.join(folder,`${candidate.id}.mp4`);
            const settings=normalizeSettings({start:candidate.start,end:candidate.end,...(candidate.segments?{segments:candidate.segments}:{}),keywords:candidate.keywords||[],subtitleStyle:'Dynamic'},project.duration);
            const insertAd=project.ad?.position==='insert',adDuration=insertAd?project.ad.duration:Math.min(project.ad?.duration||5,timelineDuration(settings));
            const ad=project.ad?{...normalizeAd({...project.ad,start:insertAd?timelineDuration(settings)/2:(timelineDuration(settings)-adDuration)/2,duration:adDuration},timelineDuration(settings)),file:await get(project.ad.fileId)}:null;
            await render({input:original,output,settings,analysis:project.analysis,ad,preview:false,onProgress,signal:operation.signal});
            await put(candidate.id,output,'video/mp4',true);
            candidate.adFileId=project.ad?.fileId||null;candidate.ready=true;candidate.settings=settings;candidate.duration=adTotalDuration(ad,timelineDuration(settings));
            candidate.createdAt=new Date().toISOString();
          }
          progress=Math.round((i+1)/project.candidates.length*100);await save();
        }
    };
    try {
      const completedVersion=[...(project.versions||[]),...(project.exports||[])].find(version=>version.jobId===job.id&&project.files[version.id]);
      const finishedPack=job.payload?.capcut&&Object.values(project.capcutPacks||{}).some(pack=>pack.jobId===job.id&&project.files[pack.fileId]);
      if(finishedPack){project.status=job.payload.previousStatus||'READY';project.error=null;await save();await store.finishJob(job.id,workerId,{result:{projectId:project.id}});return;}
      if(completedVersion||(project.adPreviewJobId===job.id&&project.files[project.adPreview])) {
        project.status=job.type==='export'?'COMPLETED':job.payload.adPreview?'ADDING_AD':'AWAITING_APPROVAL';
        project.error=null;await save();await store.finishJob(job.id,workerId,{result:{projectId:project.id}});return;
      }
      if(job.type==='preprocess') {
        await stage('PREPROCESSING','Подготовка видео');
        const input=path.join(root,'uploads',`${project.id}.original`);
        if (project.sourceUrl && !project.files.original) {
          await fs.rm(input,{force:true});
          const { downloadSource } = await import('../index.mjs'); await downloadSource(project.sourceUrl,input);
          project.upload.size=(await fs.stat(input)).size;project.upload.bytes=project.upload.size;
        } else if (project.files.original) await storage.get(project.files.original.key,input);
        const metadata=await inspect(input);
        Object.assign(project,metadata);
        const sourceHash=createHash('sha256');for await(const chunk of createReadStream(input))sourceHash.update(chunk);
        const previousFingerprint=project.sourceFingerprint;project.sourceFingerprint=sourceHash.digest('hex');
        if(previousFingerprint&&previousFingerprint!==project.sourceFingerprint){project.analysis=null;project.analysisCache=null;project.analysisResult=null;project.analysisWindows=[];project.candidates=[];project.files.proxy=null;}
        if(!project.files.original)await put('original',input,'application/octet-stream');
        if(!project.files.proxy) {
          const proxy=path.join(folder,'proxy.mp4');
          await processVideo(['-protocol_whitelist','file,pipe','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',"scale='min(640,iw)':-2,fps=2",'-c:v','libx264','-preset','veryfast','-crf','29','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart',proxy],{duration:project.duration,onProgress});
          await put('proxy',proxy,'video/mp4');
        }
        const poster=path.join(folder,'poster.jpg'); await processVideo(['-ss',String(Math.min(2,project.duration/3)),'-i',input,'-frames:v','1','-vf','scale=640:-2',poster]); await put('poster',poster,'image/jpeg');
        project.status='READY'; await save();
        // The original is durable in object storage; only the upload copy is temporary.
        await fs.rm(input,{force:true});
      }
      if(job.type==='analyze') {
        const cacheIdentity={source:sourceIdentity(),version:ANALYSIS_VERSION,model:ai.model||env.PRIMARY_VIDEO_MODEL||PRIMARY_VIDEO_MODEL};
        if(project.analysisCache&&fingerprint(project.analysisCache)!==fingerprint(cacheIdentity)) {
          if(project.analysisCache.source!==cacheIdentity.source)project.analysis=null;
          project.analysisResult=null;project.analysisWindows=[];project.candidates=[];project.analyzedAt=null;
        }
        project.analysisCache=cacheIdentity;
        // Charge before any paid AI work; the same source is never charged twice.
        if(!project.analysisResult)await tokens.charge(job.ownerId,project.id,cacheIdentity.source,project.duration);
        if(!project.analysisResult&&project.candidates.length)project.analysisResult={candidates:project.candidates,model:project.analysisModel};
        if(!project.analysisResult && !ai.configured && !provider)throw fail('AI-анализ пока не подключён. Администратору нужно настроить ключ сервиса.',503);
        if(!project.analysis) {
          await stage('TRANSCRIBING','Распознавание речи и подготовка сцен');
          const source=await get('original'), output=path.join(folder,'analysis.json');
          await run(python,[path.join(workspace,'server/ai/media.py'),project.hasAudio?'analyze':'inspect','--input',source,'--output',output],{timeout:12*3600000,signal:operation.signal});
          project.analysis=JSON.parse(await fs.readFile(output,'utf8')); project.analysis.hasAudio=project.hasAudio; project.analysis.segments||=[]; await save();
        }
        if(!project.analysisResult) {
          await stage('ANALYZING','Анализ содержания и выбор законченных историй');
          const proxy=await get('proxy');
            project.analysisWindows||=[];
            const analyzeWindow=async(window,metadata,method,context)=>{
              const file=path.join(folder,`window-${window.start}.mp4`),duration=window.end-window.start;
              if(window.start===0&&duration===project.duration)return ai[method]({filePath:proxy,duration,...metadata,context,signal:operation.signal});
              if(!await fs.stat(file).catch(()=>null)) await processVideo(['-ss',String(window.start),'-protocol_whitelist','file,pipe','-i',proxy,'-t',String(duration),'-map','0:v:0','-map','0:a:0?','-vf','setpts=PTS-STARTPTS',...(project.hasAudio?['-af','asetpts=PTS-STARTPTS']:[]),'-c:v','libx264','-preset','veryfast','-crf','29','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart',file]);
              return ai[method]({filePath:file,duration,...metadata,context,signal:operation.signal});
            };
            const result=await analyzeLongVideo({
              duration:project.duration,analysis:project.analysis,cache:project.analysisWindows,persist:save,
              onProgress:async({phase,completed,total})=>{currentStage=`${phase==='overview'?'Обзор всего видео':'Выбор историй'}: ${completed} из ${total} частей`;progress=Math.round(completed/total*100);await heartbeat();},
              ...(ai.summarizeVideo ? {summarize:(window,metadata)=>analyzeWindow(window,metadata,'summarizeVideo')} : {}),
              ...(ai.selectStories ? {select:input=>ai.selectStories({...input,signal:operation.signal})} : {}),
              analyze:(window,metadata,context)=>analyzeWindow(window,metadata,'analyzeVideo',context),
            });
          project.candidates=result.candidates.sort((a,b)=>b.score-a.score).map(item=>({...item,id:randomUUID()}));project.analysisModel=result.model;
          project.analysisResult=result;
          project.analyzedAt=new Date().toISOString(); await save();
        }
        await sourceUsage();
        if(!project.candidates.length)throw fail('В этом видео не найдено подходящих моментов. Попробуйте другой материал.');
        await stage('ANALYZING','Монтаж готовых вертикальных роликов');
        await renderCandidates();
        project.status='READY';await save();
      }
      if(job.type==='asset') {
        await stage('RENDERING','Подготовка загруженного файла');
        const input=path.join(root,'uploads',path.basename(job.payload.localName)),isAd=job.payload.kind==='ad';
        const videoAd=isAd&&job.payload.adKind==='video';
        const adMetadata=videoAd?await inspect(input):null;
        if(videoAd&&adMetadata.duration>30)throw fail('Рекламное видео должно быть не длиннее 30 секунд.',400);
        const output=path.join(folder,`${job.payload.assetId}.${videoAd?'mp4':isAd?'png':'m4a'}`);
        await processVideo(['-protocol_whitelist','file,pipe','-format_whitelist',videoAd?'mov,matroska,webm':isAd?'image2,png_pipe,jpeg_pipe,webp_pipe':'mp3,wav,mov,ogg','-i',input,...(videoAd?['-map','0:v:0','-an','-vf',"scale='min(1280,iw)':-2",'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart']:isAd?['-frames:v','1','-vf',"scale='min(1920,iw)':-2"]:['-vn','-t','600','-c:a','aac','-b:a','192k']),output]);
        await put(job.payload.assetId,output,videoAd?'video/mp4':isAd?'image/png':'audio/mp4');
        if(isAd) {
          const clipSettings=project.settings||project.candidates[0]?.settings||normalizeSettings(project.candidates[0]||{},project.duration);
          // By default the clip pauses in the middle and only the banner is shown on a solid background.
          const previous=project.ad&&typeof project.ad==='object'?Object.fromEntries(['position','width','height','fit','start','duration','opacity','offsetX','offsetY','fade','background','backgroundColor'].filter(key=>project.ad[key]!==undefined).map(key=>[key,project.ad[key]])):null;
          const clipLength=timelineDuration(clipSettings),defaults={position:'insert',duration:videoAd?Math.min(30,Math.round(adMetadata.duration*10)/10):5};
          let placement;try{placement=normalizeAd(previous?{...previous,...(videoAd&&previous.position==='insert'?{duration:defaults.duration}:{})}:defaults,clipLength);}catch{placement=normalizeAd(defaults,clipLength);}
          project.ad={...placement,fileId:job.payload.assetId,kind:videoAd?'video':'image',...(videoAd?{mediaDuration:adMetadata.duration}:{})};project.adPreview=null;
          await save();
          // Once a clip is being reviewed, the banner is previewed live in the browser; re-rendering every found moment would only waste time.
          if(!project.currentVersion){currentStage='Добавляем баннер в готовые ролики';await renderCandidates();}
          project.status=project.currentVersion?(job.payload.previousStatus==='AWAITING_APPROVAL'?'AWAITING_APPROVAL':'ADDING_AD'):'READY';
        } else {project.music.push({id:job.payload.assetId,name:job.payload.name,mood:'user',bpm:null,genre:'user',energy:null,tags:['Загружен пользователем']});project.status=job.payload.previousStatus;}
        await save();await fs.rm(input,{force:true});
      }
      if(job.type==='export'&&job.payload.capcut) {
        await stage('EXPORTING','Собираем пакет для CapCut');
        const settings=normalizeSettings(job.payload.settings,project.duration),original=await get('original'),packId=`capcut-${randomUUID()}`,clean=path.join(folder,'clean.mp4');
        // A clean render (no burned-in captions or banner) keeps everything editable in CapCut.
        await render({input:original,output:clean,settings:{...settings,subtitles:false,musicId:''},analysis:project.analysis,ad:null,music:null,preview:false,onProgress,signal:operation.signal});
        const entries=[{name:'1-video.mp4',file:clean}],srt=exportSrt(project,settings);
        if(srt.trim())entries.push({name:'2-subtitles.srt',data:srt});
        const banner=project.ad?.fileId&&project.files[project.ad.fileId]?await get(project.ad.fileId):null;
        if(banner)entries.push({name:`3-banner${path.extname(banner)}`,file:banner});
        const music=settings.musicId&&project.files[settings.musicId]?await get(settings.musicId):null;
        if(music)entries.push({name:`4-music${path.extname(music)}`,file:music});
        const bannerName=banner?`3-banner${path.extname(banner)}`:null;
        entries.push({name:'5-premiere-davinci.xml',data:packXml({project,settings,duration:timelineDuration(settings),ad:banner?project.ad:null,banner:banner?{name:bannerName,still:project.ad.kind!=='video'}:null})});
        entries.push({name:'CapCut - instrukciya.txt',data:capcutGuide({settings,ad:banner?project.ad:null,subtitles:!!srt.trim(),music:!!music})});
        const archive=path.join(folder,`${packId}.zip`);await writeZip(archive,entries);
        await put(packId,archive,'application/zip',true,`project-${Number(job.payload.number)||1}-capcut.zip`);
        project.capcutPacks={...(project.capcutPacks||{}),[job.payload.key||'current']:{fileId:packId,jobId:job.id,createdAt:new Date().toISOString()}};
        project.status=job.payload.previousStatus||'READY';project.error=null;await save();
      }
      if(['preview','revise','export'].includes(job.type)&&!job.payload.capcut) {
        await stage(job.type==='export'?'EXPORTING':'RENDERING',job.type==='revise'?'Применяем правки':'Монтируем ролик');
        let settings=normalizeSettings(job.payload.settings||project.settings,project.duration);
        let projectAd=project.ad,adEdited=false;
        if(job.type==='revise') {
          const editIdentity=fingerprint([sourceIdentity(),job.payload.request,settings,project.ad]);
          project.editCache||={};
          let cached=project.editCache[job.id];
          await recordUsage({id:`edit-${job.id}`,kind:'edit'}).catch(usageError);
          if(!cached||cached.key!==editIdentity) {
            const patch=await ai.interpretEditRequest({request:job.payload.request,settings,ad:project.ad,duration:project.duration,transcript:project.analysis?.segments||[],scenes:project.candidates,signal:operation.signal});
            cached={key:editIdentity,patch,createdAt:new Date().toISOString()};project.editCache[job.id]=cached;await save();
          }
          const {ad:adPatch,...patch}=cached.patch;
          if (!Object.keys(patch).length&&!adPatch) throw fail('Не удалось понять правку. Укажите, что изменить: границы ролика, субтитры, музыку или кадрирование.');
          settings=normalizeSettings({...settings,...(('start' in patch||'end' in patch)&&!('segments' in patch)?{segments:undefined}:{}),...patch},project.duration);
          if(adPatch) {
            if(!project.ad)throw fail('Сначала загрузите рекламный файл.',400);
            projectAd={...project.ad,...applyAdPatch(project.ad,adPatch,timelineDuration(settings))};adEdited=true;
          }
        }
        const clipDuration=timelineDuration(settings);
        if(projectAd&&!adEdited&&projectAd.position==='insert'&&projectAd.start>=clipDuration)projectAd={...projectAd,start:clipDuration/2};
        else if(projectAd&&!adEdited&&projectAd.position!=='insert'&&(projectAd.duration>clipDuration||projectAd.start+projectAd.duration>clipDuration)) {
          const duration=Math.min(projectAd.duration,clipDuration);
          projectAd={...projectAd,start:(clipDuration-duration)/2,duration};
        }
        const original=await get('original'),versionId=randomUUID(),output=path.join(folder,`${versionId}.mp4`);
        const ad=projectAd?{...normalizeAd(projectAd,clipDuration),file:await get(projectAd.fileId)}:null;
        const music=settings.musicId?await get(settings.musicId):null;
        await render({input:original,output,settings,analysis:project.analysis,ad,music,preview:job.type!=='export',onProgress,signal:operation.signal});
        await put(versionId,output,'video/mp4',job.type==='export');
        project.settings=settings;project.ad=projectAd;
        if(job.type==='export'){
          project.exports||=project.finalFile?[{id:project.finalFile}]:[];
          project.finalFile=versionId;project.status='COMPLETED';
          project.exports.push({id:versionId,jobId:job.id,createdAt:new Date().toISOString(),format:settings.format,duration:adTotalDuration(ad,timelineDuration(settings))});
        }
        else if(job.payload.adPreview){project.adPreview=versionId;project.adPreviewJobId=job.id;project.status='ADDING_AD';}
        else {project.versions.push({id:versionId,jobId:job.id,number:project.versions.length+1,settings,ad:projectAd?structuredClone(projectAd):null,createdAt:new Date().toISOString(),request:job.payload.request||''});project.currentVersion=versionId;project.adPreview=null;project.status='AWAITING_APPROVAL';}
        await save();
      }
      await store.finishJob(job.id,workerId,{result:{projectId:project.id}});
      if(job.type==='preprocess' && (ai.configured||provider)) {
        await store.enqueue(job.ownerId,project.id,'analyze');
      }
    } catch(error) {
      if(!leaseError){
        const previousVersion=job.type==='revise'&&project.versions?.some(version=>version.id===project.currentVersion);
        const restore=(job.payload?.capcut||job.type==='asset')&&job.payload.previousStatus&&!busyStates.includes(job.payload.previousStatus);
        project.status=restore?job.payload.previousStatus:previousVersion?'AWAITING_APPROVAL':'FAILED';
        project.error=error.status||error.code?.startsWith('AI_')?error.message.replaceAll('Gemini API','сервиса анализа').replaceAll('Gemini','Сервис анализа').replaceAll('GEMINI_API_KEY','ключ сервиса анализа').replaceAll('OPENROUTER_API_KEY','ключ сервиса анализа'):'Обработка прервана. Проверьте настройки сервиса и повторите.';
        if(previousVersion)project.error+=' Предыдущая версия ролика сохранена. Можно подтвердить её или отправить другую правку.';
        await save().catch(()=>{});await store.finishJob(job.id,workerId,{error:project.error}).catch(()=>{});
      }
    } finally {clearInterval(timer);await fs.rm(folder,{recursive:true,force:true});}
  }
  return {
    async once(){const job=await store.claimJob(workerId);if(!job)return false;await processJob(job);return true;},
    async start(){
      let unavailable=false;
      try {
        while(!stopping){
          try {
            const worked=await this.once();
            if(unavailable){console.log('SCENZA: связь с очередью восстановлена.');unavailable=false;}
            if(!worked&&!stopping)await delay(2500);
          } catch(error) {
            if(![408,429,502,503,504].includes(error.status))throw error;
            if(!unavailable)console.warn('SCENZA: очередь временно недоступна. Повторяем подключение.');
            unavailable=true;if(!stopping)await delay(5000);
          }
        }
      }finally{await store.close();}
    },
    stop(){stopping=true;},
    close:()=>store.close(),
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const worker=await createWorker();process.once('SIGINT',()=>worker.stop());process.once('SIGTERM',()=>worker.stop());
  console.log('SCENZA: обработчик видео запущен.');await worker.start();
}
