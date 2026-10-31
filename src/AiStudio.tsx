import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from './api';
import { authRequest } from './landing/auth';
import type { Account } from './landing/auth';
import { Icon } from './Icon';
import { CloudUpload } from 'lucide-react';
import StudioWelcome from './StudioWelcome';
import { SafeZonePicker, SafeZones } from './SafeZones';
import type { Platform } from './SafeZones';
import BannerEditor from './BannerEditor';
import SubtitleEditor from './SubtitleEditor';
import { sameAd } from './BannerEditor';
import type { Ad } from './BannerEditor';
import { formatRange, phaseNames, phasesTime, pipeline, remaining } from './ai-progress';
import type { Phase, Rates } from './ai-progress';
import { TemplatePicker, TemplatesPanel, useTemplates } from './Templates';
import AdminAccess from './AdminAccess';
import { formatTime } from './model';
import type { Navigate, Notify } from './model';
import './ai-studio.css';

type Settings = { segments?:{start:number;end:number}[]; keywords?:string[]; start:number; end:number; format:'9:16'|'1:1'|'16:9'; cropX:number; cropMode:'smart'|'manual'; cropSmoothing:number; muted:boolean; subtitles:boolean; subtitleStyle:string; subtitleSize:number; subtitleColor?:string; subtitleFont?:string; subtitleColors?:string[]; subtitleColorEvery?:number; subtitleAccentColor?:string; subtitleY?:number|null; subtitlePosition:'top'|'center'|'bottom'; musicId:string; musicVolume:number; subtitleReplacements?:{from:string;to:string}[] };
type Candidate = { ready?:boolean; duration?:number; segments?:{start:number;end:number}[]; keywords?:string[]; settings?:Settings; id:string; start:number; end:number; title:string; description:string; category:string; score:number; reason:string; hook:string };
type Version = { id:string; number:number; settings:Settings; createdAt:string; ad?:Ad|null };
type ExportedClip = { id:string; createdAt?:string; format?:Settings['format']; duration?:number };
type VideoProject = { id:string; title:string; createdAt:string; status:string; duration?:number; phase?:Phase; phaseStartedAt?:string; hasAudio?:boolean; template?:{id:string;name:string}; upload:{name:string;size:number;bytes:number}; candidates:Candidate[]; versions:Version[]; exports?:ExportedClip[]; settings?:Settings; currentVersion?:string; approvedVersion?:string; finalFile?:string; files:Record<string,{key:string}>; jobId?:string; error?:string; ad?:Ad; adPreview?:string; capcutPacks?:Record<string,{fileId:string;createdAt:string}>; music:{id:string;name:string}[] };
type Usage = { month:string; sourceMinutes:number; sourceCount:number; editRequests:number; tokens?:number; publicationBonus?:boolean };
function PublishBonus({notify,onDone}:{notify:Notify;onDone:()=>void}) {
  const [url,setUrl]=useState(''),[sending,setSending]=useState(false);
  return <form className="ai-bonus" onSubmit={event=>{event.preventDefault();setSending(true);void request(`${api}/bonus/publication`,{method:'POST',body:JSON.stringify({url:url.trim()})}).then(()=>{notify('+5 токенов начислено. Спасибо за публикацию!');setUrl('');onDone();},error=>notify(error instanceof Error?error.message:'Не удалось начислить бонус.')).finally(()=>setSending(false));}}>
    <strong>+5 токенов за первый опубликованный ролик</strong><span>Опубликуйте ролик из SCENZA в TikTok, Reels или Shorts и вставьте ссылку на пост. Бонус начисляется один раз.</span>
    <div className="ai-bonus-row"><input type="url" required value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://www.tiktok.com/@you/video/…" aria-label="Ссылка на опубликованный ролик"/><button className="button primary" disabled={sending||!url.trim()}>Получить бонус</button></div>
  </form>;
}
const tokenWord=(count:number)=>count%10===1&&count%100!==11?'токен':[2,3,4].includes(count%10)&&![12,13,14].includes(count%100)?'токена':'токенов';
const videoDuration=(file:File)=>new Promise<number|null>(resolve=>{
  const video=document.createElement('video'),url=URL.createObjectURL(file);let settled=false;
  const done=(value:number|null)=>{if(settled)return;settled=true;URL.revokeObjectURL(url);resolve(value);};
  video.preload='metadata';video.onloadedmetadata=()=>done(Number.isFinite(video.duration)&&video.duration>0?video.duration:null);video.onerror=()=>done(null);
  window.setTimeout(()=>done(null),8000);video.src=url;
});
// Post text is assembled from the analysis the clip already has, so it costs no extra AI calls.
const hashtag=(value:string)=>'#'+value.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu,'');
const hashtags=(candidate:Candidate)=>[...new Set([...(candidate.keywords||[]),candidate.category].filter(Boolean).map(hashtag).filter(tag=>tag.length>2))].slice(0,4).concat(['#shorts','#reels','#tiktok']).join(' ');
const postText=(candidate:Candidate)=>[candidate.hook||candidate.title,candidate.description,hashtags(candidate)].filter(Boolean).join('\n\n');
function ClipKit({project,candidate,notify,working,onCapcut}:{project:VideoProject;candidate?:Candidate;notify:Notify;working:boolean;onCapcut:(candidate?:string)=>void}) {
  const text=candidate?postText(candidate):'';
  const pack=project.capcutPacks?.[candidate?candidate.id:'current'];
  return <details className="ai-clip-kit"><summary>{candidate?'Текст поста и экспорт для монтажа':'Экспорт в CapCut, Premiere Pro и DaVinci'}</summary>
    {candidate&&<><label>Текст поста с хэштегами<textarea readOnly rows={5} value={text}/></label><button type="button" className="button outline" onClick={()=>void navigator.clipboard.writeText(text).then(()=>notify('Текст поста скопирован.'),()=>notify('Не удалось скопировать текст.'))}>Скопировать текст</button></>}
    <div className="ai-capcut"><strong>Пакет для монтажа: CapCut, Premiere Pro, DaVinci</strong><p className="ai-note">ZIP-архив: видео без вшитых субтитров, субтитры SRT, ваш баннер, таймлайн XML для Premiere Pro и DaVinci Resolve (ролик и баннер уже на своих местах) и пошаговая инструкция. Токены не списываются.</p>
      <div className="ai-actions">{pack&&project.files[pack.fileId]&&<a className="button primary" href={fileUrl(project,pack.fileId)} download>Скачать пакет</a>}<button type="button" className="button outline" disabled={working} onClick={()=>onCapcut(candidate?.id)}>{pack?'Собрать заново':'Собрать пакет'}</button></div></div>
  </details>;
}
type VideoJob = { id:string; type?:string; status:string; stage:string; progress:number|null; error?:string; stalled?:boolean };
type Limits = { maxBytes:number; maxSeconds:number; maxSide:number; formats:string[]; maxClipSeconds:number; maxClips:number };
type EditorTab = 'video'|'subtitles'|'sound'|'banner'|'ai'|'templates';
const editorTabs:[EditorTab,string][]=[['video','Видео'],['subtitles','Субтитры'],['sound','Звук'],['banner','Баннер'],['ai','AI-правка'],['templates','Мои шаблоны']];
const statusPhase:Record<string,Phase>={PREPROCESSING:'preprocess',TRANSCRIBING:'transcribe',ANALYZING:'analyze',RENDERING:'render',EXPORTING:'export'};
const phasesOf:Record<string,Phase[]>={PREPROCESSING:['preprocess'],TRANSCRIBING:['transcribe'],ANALYZING:['analyze','clips'],RENDERING:['render','revise'],EXPORTING:['export','package']};
const formatList=(limits:Limits)=>limits.formats.map(format=>format==='webm'?'WebM':format.toUpperCase()).join(', ');
const sizeText=(bytes:number)=>bytes>=1024**3?`${Math.round(bytes/1024**3)} ГБ`:`${Math.round(bytes/1024**2)} МБ`;
// Shown next to the upload button before anything is sent; the server checks the same values again.
function UploadLimits({limits}:{limits:Limits}) {
  return <div className="ai-limits" aria-label="Ограничения для видео">
    <ul><li><b>До {limits.maxSeconds/60} минут</b> исходного видео</li><li><b>До {sizeText(limits.maxBytes)}</b> на файл</li><li><b>{formatList(limits)}</b></li><li>Разрешение <b>до {limits.maxSide} px</b> по стороне</li></ul>
    <details><summary>Ещё об ограничениях</summary><ul><li>Из одного видео — до {limits.maxClips} готовых роликов, каждый до {limits.maxClipSeconds/60} минут.</li><li>Видео обрабатываются по очереди: у проекта одновременно идёт одна обработка, остальные ждут в очереди.</li><li>Ограничения одинаковы для всех тарифов — тарифы отличаются количеством токенов.</li></ul></details>
  </div>;
}
/** Says exactly which limit a file breaks, before the upload starts. */
function checkSource(file:File,limits:Limits|null,seconds:number|null) {
  const extension=file.name.split('.').pop()?.toLowerCase()||'';
  if(limits&&!limits.formats.includes(extension))return `Формат .${extension||'?'} не поддерживается. Подойдут: ${formatList(limits)}.`;
  if(!limits&&!/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name))return 'Выберите видео MP4, MOV, MKV или WebM.';
  if(file.size===0)return 'Файл пустой. Выберите другое видео.';
  if(limits&&file.size>limits.maxBytes)return `Файл весит ${sizeText(file.size)} — это больше ${sizeText(limits.maxBytes)}. Сожмите видео или загрузите фрагмент.`;
  if(limits&&seconds!==null&&seconds>limits.maxSeconds)return `Видео длится ${formatTime(seconds)} — это больше ${limits.maxSeconds/60} минут. Обрежьте его или загрузите фрагмент.`;
  return null;
}
const api='/api/video';
const statuses:Record<string,string>={UPLOADING:'Загрузка',PREPROCESSING:'Подготовка видео',TRANSCRIBING:'Распознавание речи',ANALYZING:'Поиск моментов',READY:'Ролики готовы',RENDERING:'Монтаж',AWAITING_APPROVAL:'Ожидает подтверждения',APPROVED:'Ролик подтверждён',ADDING_AD:'Добавление рекламы',EXPORTING:'Экспортируем видео',COMPLETED:'Видео готово',FAILED:'Обработка остановлена'};
const running=['PREPROCESSING','TRANSCRIBING','ANALYZING','RENDERING','EXPORTING'];
const defaults=(start:number,end:number):Settings=>({start,end,format:'9:16',cropX:50,cropMode:'smart',cropSmoothing:.7,muted:false,subtitles:true,subtitleStyle:'Classic',subtitleSize:54,subtitlePosition:'bottom',musicId:'',musicVolume:.18});
const fileUrl=(project:VideoProject,id:string)=>`${api}/projects/${project.id}/files/${id}`;
const exportsFor=(project:VideoProject):ExportedClip[]=>[...(project.exports??(project.finalFile?[{id:project.finalFile}]:[])),...project.candidates.filter(candidate=>candidate.ready)];

export default function AiStudio({ projectId, list=false, navigate, notify }: {projectId?:string;list?:boolean;navigate:Navigate;notify:Notify}) {
  const [project,setProject]=useState<VideoProject|null>(null),[projects,setProjects]=useState<VideoProject[]>([]),[settings,setSettings]=useState<Settings|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[job,setJob]=useState<VideoJob|null>(null),[uploadProgress,setUploadProgress]=useState<number|null>(null);
  const [source,setSource]=useState('');
  const [zones,setZones]=useState<Platform|''>('');
  const [estimate,setEstimate]=useState<{file:File;seconds:number|null;tokens:number|null}|null>(null);
  const [limits,setLimits]=useState<Limits|null>(null),[rates,setRates]=useState<Rates>({}),[now,setNow]=useState(()=>Date.now());
  const [tab,setTab]=useState<EditorTab>('video'),[topUp,setTopUp]=useState(false),[uploadRate,setUploadRate]=useState<number|null>(null);
  const templates=useTemplates(!list);
  // Until the person picks something else, a new video uses their default template.
  const [templateChoice,setTemplateChoice]=useState<string|null|undefined>(undefined);
  const templateId=templateChoice===undefined?templates.list?.defaultId??null:templateChoice;
  const chosenTemplate=templates.list?.items.find(item=>item.id===templateId);
  const [usage,setUsage]=useState<Usage|null>(null);
  // Signed-in users need the owner's permission for AI work; the local studio on the owner's computer has no account.
  const [aiContact,setAiContact]=useState<string|null>(null);
  useEffect(()=>{void authRequest<{user:Account|null;accessContact?:string}>('session').then(value=>setAiContact(value.user&&!value.user.aiAccess?value.accessContact||'SCENZA_BOT':null)).catch(()=>setAiContact(null));},[]);
  const [showCandidates,setShowCandidates]=useState(false);
  const [filter,setFilter]=useState('all'),[revision,setRevision]=useState(''),[ready,setReady]=useState<boolean|null>(null),[ad,setAd]=useState<Ad|null>(null);
  const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
  // Polling returns the same data most of the time; only changed responses reach React, so the studio does not re-render every 2.5 s.
  const snapshot=useRef({projects:'',project:'',job:''});
  const polling=useRef(false);
  const changed=(key:'projects'|'project'|'job',value:unknown)=>{const next=JSON.stringify(value);if(snapshot.current[key]===next)return false;snapshot.current[key]=next;return true;};
  const refresh=useCallback(async()=>{
    if(list){const result=await request<{projects:VideoProject[]}>(`${api}/projects`);if(changed('projects',result.projects))setProjects(result.projects);return;}
    if(!projectId)return;
    const result=await request<{project:VideoProject}>(`${api}/projects/${projectId}`);if(changed('project',result.project))setProject(result.project);
    setSettings(current=>current||result.project.settings||null);setAd(current=>current||result.project.ad||null);
    if(result.project.jobId){const response=await request<{job:VideoJob}>(`${api}/jobs/${result.project.jobId}`);if(changed('job',response.job))setJob(response.job);}
  },[list,projectId]);
  useEffect(()=>{snapshot.current={projects:'',project:'',job:''};setProject(null);setJob(null);setUploadProgress(null);setSettings(null);setAd(null);setShowCandidates(false);setError('');void refresh().catch(e=>setError(e.message));void request<{aiReady:boolean;limits?:Limits}>(`${api}/config`).then(value=>{setReady(value.aiReady);if(value.limits)setLimits(value.limits);}).catch(e=>setError(e.message));},[refresh]);
  useEffect(()=>{const timer=setInterval(()=>{
    // A slow server must not pile up overlapping requests.
    if(document.visibilityState!=='visible'||polling.current)return;
    polling.current=true;void refresh().catch(e=>setError(e.message)).finally(()=>{polling.current=false;});
  },2500);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if(project?.settings)setSettings(project.settings);if(project?.currentVersion){setShowCandidates(false);document.querySelector('.ai-review')?.scrollIntoView({block:'start',behavior:'auto'});}},[project?.currentVersion]);
  useEffect(()=>{setAd(project?.ad||null);},[project?.ad?.fileId,project?.currentVersion]);
  useEffect(()=>{void request<Usage>(`${api}/usage`).then(setUsage).catch(()=>setUsage(null));},[project?.status,list]);
  // Measured durations of earlier runs; refreshed when a stage changes so a finished run improves the next estimate.
  useEffect(()=>{if(!list)void request<{rates:Rates}>(`${api}/estimate`).then(value=>setRates(value.rates)).catch(()=>setRates({}));},[project?.status,list]);
  const active=!!project&&(running.includes(project.status)||project.status==='UPLOADING'&&busy);
  useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[active]);
  async function action(path:string,body:object={},method='POST') {
    setBusy(true);setError('');
    try {await request(path,{method,body:JSON.stringify(body)});await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие.');}
    finally{setBusy(false);}
  }
  // The browser reads the duration locally, so the cost is known before a single byte is uploaded.
  async function choose(file:File) {
    if(busy)return;
    setError('');setEstimate(null);
    if(project?.status==='UPLOADING'){void upload(file);return;}
    const early=checkSource(file,limits,null);if(early){setError(early);return;}
    const seconds=await videoDuration(file),problem=checkSource(file,limits,seconds);
    if(problem){setError(problem);return;}
    setEstimate({file,seconds,tokens:seconds===null?null:Math.max(1,Math.ceil(seconds/60))});
  }
  async function upload(file:File) {
    if(busy)return;
    const invalid=checkSource(file,limits,null);if(invalid){setError(invalid);return;}
    const operation=new AbortController();controller.current=operation;setBusy(true);setError('');
    const fingerprint=`scenza-upload:${file.name}:${file.size}:${file.lastModified}`;
    try {
      let current:VideoProject|undefined=project?.status==='UPLOADING'&&project.upload.name===file.name&&project.upload.size===file.size?project:undefined;
      const previous=localStorage.getItem(fingerprint);
      if(!current&&previous)try{const response=await request<{project:VideoProject}>(`${api}/projects/${previous}`);if(response.project.status==='UPLOADING')current=response.project;}catch{/* Upload belongs to a previous session or account. */}
      if(!current)current=(await request<{project:VideoProject}>(`${api}/projects`,{method:'POST',body:JSON.stringify({name:file.name,size:file.size,templateId,...(estimate?.file===file&&estimate.seconds!==null?{duration:estimate.seconds}:{})}),signal:operation.signal})).project;
      else current=(await request<{project:VideoProject}>(`${api}/projects/${current.id}`,{signal:operation.signal})).project;
      localStorage.setItem(fingerprint,current.id);setProject(current);
      let offset=current.upload.bytes;setUploadProgress(Math.round(offset/file.size*100));setUploadRate(null);
      // The upload speed is measured on this connection, so "time left" for the upload is real, not a guess.
      const started=Date.now(),from=offset;
      while(offset<file.size){const slice=file.slice(offset,offset+8*1024**2);const result=await request<{offset:number}>(`${api}/projects/${current.id}/upload`,{method:'PUT',headers:{'Upload-Offset':String(offset),'Content-Type':'application/octet-stream'},body:slice,signal:operation.signal});offset=result.offset;setUploadProgress(Math.round(offset/file.size*100));const seconds=(Date.now()-started)/1000;if(seconds>=2)setUploadRate((offset-from)/seconds);}
      await request(`${api}/projects/${current.id}/complete`,{method:'POST',signal:operation.signal});localStorage.removeItem(fingerprint);setUploadProgress(null);navigate(`/ai/${current.id}`);
    }catch(e){setError(e instanceof DOMException&&e.name==='AbortError'?'Загрузка приостановлена. Выберите тот же файл, чтобы продолжить.':e instanceof Error?e.message:'Загрузка прервана. Выберите тот же файл для продолжения.');}
    finally{setBusy(false);}
  }
  async function importSource() {
    setBusy(true);setError('');
    try{const result=await request<{project:VideoProject}>(`${api}/import`,{method:'POST',body:JSON.stringify({url:source,templateId})});navigate(`/ai/${result.project.id}`);}catch(e){setError(e instanceof Error?e.message:'Не удалось обработать ссылку. Загрузите видео с устройства.');}finally{setBusy(false);}
  }
  async function uploadAsset(file:File,kind:'advertisement'|'music') {
    if(!project)return;setBusy(true);setError('');
    try {await request(`${api}/projects/${project.id}/${kind}?filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});setAd(null);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить файл.');}finally{setBusy(false);}
  }
  // Saving the banner immediately rebuilds the clip with it, so the client sees the finished video, not just settings.
  async function rebuild(change:()=>Promise<unknown>,message:string) {
    if(!project)return;setBusy(true);setError('');
    try {
      await change();
      const approved=['APPROVED','ADDING_AD','COMPLETED'].includes(project.status),version=project.versions.find(v=>v.id===(approved?project.approvedVersion:project.currentVersion));
      if(version)await request(`${api}/projects/${project.id}/${approved?'export':'preview'}`,{method:'POST',body:JSON.stringify({settings:version.settings})});
      notify(message);await refresh();
      document.querySelector('.ai-review')?.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить баннер.');}finally{setBusy(false);}
  }
  const saveAd=(next:Ad)=>rebuild(()=>request(`${api}/projects/${project?.id}/advertisement`,{method:'PUT',body:JSON.stringify(next)}),'Баннер сохранён. Собираем видео с баннером — оно появится в плеере выше. Токены не списываются.');
  const removeAd=()=>rebuild(()=>request(`${api}/projects/${project?.id}/advertisement`,{method:'DELETE',body:'{}'}),'Баннер убран. Пересобираем видео без него.');
  const capcut=(candidate?:string)=>{if(!project)return;notify('Собираем пакет для CapCut — это займёт немного времени.');void action(`${api}/projects/${project.id}/capcut`,candidate?{candidate}:{});};
  async function previewAd() {
    if(!project||!ad)return;setBusy(true);setError('');
    try{await request(`${api}/projects/${project.id}/advertisement`,{method:'PUT',body:JSON.stringify(ad)});await request(`${api}/projects/${project.id}/ad-preview`,{method:'POST'});await refresh();}catch(e){setError(e instanceof Error?e.message:'Не удалось подготовить рекламу.');}finally{setBusy(false);}
  }
  const working=busy||!!project&&running.includes(project.status),currentVersion=project?.versions.find(v=>v.id===project.currentVersion);

  const settingsChanged=!!settings&&!!currentVersion&&JSON.stringify(settings)!==JSON.stringify(currentVersion.settings);
  const clipDuration=settings?.segments?.reduce((sum,part)=>sum+part.end-part.start,0)??(settings?settings.end-settings.start:0);
  const adSettingsChanged=!!project?.ad&&!sameAd(ad,project.ad,clipDuration);
  const approval=!!project&&['APPROVED','ADDING_AD','COMPLETED'].includes(project.status);
  const categories=[...new Set(project?.candidates.map(c=>c.category)||[])];
  const welcome=!list&&!projectId&&(!project||project.status==='UPLOADING');
  const processingFailed=project?.status==='FAILED'||job?.status==='error'&&!!project?.error;
  const clipSeconds=clipDuration||(project?.candidates[0]?.duration??0);
  const sourceSeconds=project?.duration??estimate?.seconds??0;
  // What the dock says: the real stage, measured progress if the worker reports it, and a time range only from real data.
  const phase:Phase|undefined=project?(project.phase&&phasesOf[project.status]?.includes(project.phase)?project.phase:statusPhase[project.status]):undefined;
  const nextPhases=phase&&pipeline.includes(phase)&&ready!==false?pipeline.slice(pipeline.indexOf(phase)+1):[];
  const left=project&&phase&&job?.status==='running'?remaining({phase,startedAt:project.phaseStartedAt,progress:job.progress,now,rates,sourceSeconds,clipSeconds,next:nextPhases}):null;
  const uploadLeft=project?.status==='UPLOADING'&&uploadRate&&uploadProgress!==null?(project.upload.size*(100-uploadProgress)/100)/uploadRate:null;
  const beforeStart=estimate?.seconds?phasesTime(rates,ready===false?['preprocess']:pipeline,estimate.seconds):null;
  const measuredProgress=project?.status==='UPLOADING'?uploadProgress:running.includes(project?.status||'')&&typeof job?.progress==='number'&&job.status==='running'?job.progress:null;
  return <div className={`ai-studio ${project&&!list?'ai-project-workspace':''}`}>
    {!welcome&&<div className="page-intro ai-heading"><div><h1>{list?'Мои проекты':project?.title||'Открываем проект…'}</h1><p>{list?'Ваши фильмы, найденные моменты и готовые ролики':'Скачайте готовые ролики или настройте выбранный вариант.'}</p></div>{project&&<button className="button outline" onClick={()=>navigate('/ai')}>Мои проекты</button>}</div>}
    {usage?.tokens!==undefined&&<p className="ai-token-balance"><strong>{usage.tokens}</strong> токенов на балансе · 1 токен = 1 минута исходного видео, токены не сгорают.{usage.tokens<1&&<> <button type="button" className="text-link" onClick={()=>setTopUp(true)}>Пополнить</button></>}</p>}
    {usage?.tokens!==undefined&&!usage.publicationBonus&&(project?.finalFile||project?.candidates.some(candidate=>candidate.ready))&&<PublishBonus notify={notify} onDone={()=>void request<Usage>(`${api}/usage`).then(setUsage).catch(()=>{})}/>}
    {usage&&<p className="ai-note">За месяц: обработано {usage.sourceMinutes.toLocaleString('ru-RU',{maximumFractionDigits:1})} мин. исходников · AI-правок: {usage.editRequests}. Предпросмотр и экспорт не списывают минуты повторно.</p>}
    {error&&<p className="field-error" role="alert">{error}</p>}
    {list?<><button className="button primary" onClick={()=>navigate('/upload')}><Icon name="plus"/>Новый проект</button><div className="ai-projects">{projects.map(item=>{
      const clips=exportsFor(item);
      return <article className="ai-project panel" key={item.id}>
        <button className="ai-project-open" onClick={()=>navigate(`/ai/${item.id}`)}>{item.files.poster&&<img src={fileUrl(item,'poster')} alt={`Кадр из ${item.title}`}/>}<h2>{item.title}</h2><p>{statuses[item.status]||item.status}</p><small>{new Date(item.createdAt).toLocaleDateString('ru-RU')} · {item.candidates.length} сцен</small></button>
        {clips.length?<details className="ai-project-exports"><summary>Готовые ролики: {clips.length}</summary><ul>{clips.map((clip,index)=><li key={clip.id}><a href={fileUrl(item,clip.id)} download={`scenza-${index+1}.mp4`}>Скачать клип {index+1}{clip.format&&` · ${clip.format}`}{clip.duration!==undefined&&` · ${formatTime(clip.duration)}`}</a>{clip.createdAt&&<small>{new Date(clip.createdAt).toLocaleDateString('ru-RU')}</small>}</li>)}</ul></details>:<p className="ai-export-count">Готовые ролики: 0</p>}
      </article>;
    })}</div>{!projects.length&&<p className="loading-panel">Здесь появятся ваши проекты. Начните с загрузки видео.</p>}</>:
    <>
      {(welcome||project?.status==='UPLOADING')&&<StudioWelcome>
        {aiContact&&!project?<section className="ai-upload ai-locked" role="status"><h2>ИИ — по разрешению</h2><p>Обработка видео с ИИ открывается вручную. Напишите в Telegram, и мы откроем доступ к вашему аккаунту.</p><a className="button primary" href={`https://t.me/${aiContact}`} target="_blank" rel="noopener noreferrer">Попросить доступ · @{aiContact}</a></section>:<>
        <section className="ai-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void choose(file);}}>
          <CloudUpload size={54} strokeWidth={1.5}/><h2>{project?'Продолжите загрузку':'Перетащите видео сюда'}</h2><p>{project?`Выберите тот же файл: ${project.upload.name}`:'или нажмите кнопку ниже'}</p>
          <input ref={input} type="file" accept="video/*,.mkv,.m4v" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void choose(file);e.target.value='';}}/>
          <button className="button primary" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Загружаем…':'Загрузить видео'}</button>{limits&&<UploadLimits limits={limits}/>}<TemplatePicker list={templates.list} value={templateId} onChange={setTemplateChoice}/>
          {uploadProgress!==null&&busy&&<button className="text-link" onClick={()=>controller.current?.abort()}>Приостановить загрузку</button>}
          {estimate&&(()=>{const short=usage?.tokens!==undefined&&estimate.tokens!==null&&estimate.tokens>usage.tokens;return <div className={`ai-estimate ${short?'is-short':''}`} role="status">
            <strong>{estimate.seconds!==null?`Видео ${formatTime(estimate.seconds)}`:estimate.file.name}{usage?.tokens!==undefined&&estimate.tokens!==null&&` · ${estimate.tokens} ${tokenWord(estimate.tokens)}`}</strong>
            <span>{beforeStart?<>Примерное время обработки: <b>{formatRange(beforeStart)}</b> после загрузки файла. Это оценка по прошлым обработкам на сервере — по ходу работы она уточнится.</>:'Время обработки пока не оценить: на сервере мало завершённых обработок. После запуска покажем текущий этап и сообщим, когда ролики будут готовы.'}</span>
            <span>Шаблон оформления: {chosenTemplate?`«${chosenTemplate.name}»`:'без шаблона'}.</span>
            {usage?.tokens!==undefined&&estimate.tokens!==null&&<span>1 токен — каждая начатая минута исходного видео. На балансе: {usage.tokens}. {short?`Не хватает ${estimate.tokens-usage.tokens}.`:`После анализа останется ${usage.tokens-estimate.tokens}.`}</span>}
            <div className="ai-actions">{short?<button type="button" className="button primary" onClick={()=>setTopUp(true)}>Пополнить токены</button>:<button type="button" className="button primary" onClick={()=>{const file=estimate.file;setEstimate(null);void upload(file);}}>{usage?.tokens!==undefined&&estimate.tokens!==null?`Загрузить и списать ${estimate.tokens}`:'Загрузить и начать обработку'}</button>}<button type="button" className="button outline" onClick={()=>setEstimate(null)}>Выбрать другое видео</button></div></div>;})()}
        </section>
        <details className="studio-import"><summary><Icon name="link" size={16}/>Загрузить по ссылке</summary><form className="ai-url" onSubmit={e=>{e.preventDefault();void importSource();}}><label>Или прямая ссылка на видео<input type="url" value={source} onChange={e=>setSource(e.target.value)} placeholder="https://example.com/video.mp4" required disabled={busy}/></label><button className="button outline" disabled={busy||!source.trim()}>Загрузить по ссылке</button></form><p className="ai-note">Если загрузка прервётся, выберите тот же файл для продолжения.</p></details></>}
      </StudioWelcome>}
      {project&&project.status!=='UPLOADING'&&<>
        <section className={`panel ai-status ${processingFailed?'ai-status-error':''}`}>
          <div className="ai-status-top"><Icon name={processingFailed?'info':running.includes(project.status)?'film':'check'} size={23}/><div><strong>{processingFailed&&job?.type==='revise'?'Не удалось применить правку':project.status==='READY'&&!project.candidates.some(candidate=>candidate.ready)?'Видео подготовлено':statuses[project.status]||project.status}</strong><p>{project.duration?`${formatTime(project.duration)} · `:''}{(project.upload.size/1024**2).toFixed(1)} МБ</p></div>{processingFailed&&project.jobId&&<button className="button outline" disabled={busy} onClick={()=>void action(`${api}/jobs/${project.jobId}/retry`)}>Повторить обработку</button>}</div>
          {running.includes(project.status)&&<><div className="ai-processing-detail">{project.files.poster&&<img src={fileUrl(project,'poster')} alt="Кадр загруженного видео"/>}<div><h2>{job?.status==='queued'?'Видео в очереди':phase?phaseNames[phase]:'Подготовка к обработке'}</h2><p>Можно закрыть страницу. Результат сохранится в «Моих проектах».</p></div></div></>}
          {processingFailed&&<p className="ai-failure-message" role="alert">{job?.error||project.error||'Не удалось завершить обработку.'} Видео сохранено, загружать его заново не нужно.</p>}{processingFailed&&/токенов/.test(job?.error||project.error||'')&&<button type="button" className="button primary" onClick={()=>setTopUp(true)}>Пополнить токены</button>}
        </section>
        {ready===false&&!project.candidates.length&&<p className="ai-note">AI-анализ пока не подключён. Видео сохранится; анализ станет доступен после настройки сервиса.</p>}
        {project.candidates.some(candidate=>!candidate.ready)&&project.status==='READY'&&<button className="button primary" disabled={working} onClick={()=>void action(`${api}/projects/${project.id}/analyze`)}>Смонтировать готовые ролики</button>}{!project.candidates.length&&project.status==='READY'&&<button className="button primary" disabled={working||ready===false} onClick={()=>void action(`${api}/projects/${project.id}/analyze`)}>Найти лучшие моменты</button>}
        {project.status==='READY'&&project.candidates.some(candidate=>candidate.ready)&&!currentVersion&&<section className="panel ai-ad"><h2>Баннер — по желанию</h2><p>В середине каждого ролика видео встанет на паузу и покажет только ваш баннер, затем продолжится. Настроить время, размер и положение можно после выбора ролика. Без загрузки ролики остаются без баннера.</p><label>Изображение до 20 МБ или видео до 30 сек. / 100 МБ<input type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.m4v" disabled={working} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadAsset(file,'advertisement');e.target.value='';}}/></label></section>}
        {!!project.candidates.length&&<section className="ai-moments">{currentVersion&&<button className="button outline" aria-expanded={showCandidates} aria-controls="ai-candidates-panel" onClick={()=>setShowCandidates(value=>!value)}>Выбрать другой момент</button>}{(!currentVersion||showCandidates)&&<div id="ai-candidates-panel"><div className="ai-section-heading"><h2>Готовые ролики</h2><label>Категория<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Все</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div><div className="ai-candidates">{project.candidates.filter(c=>filter==='all'||c.category===filter).map(candidate=><article className="panel ai-candidate" key={candidate.id}><video controls preload="none" playsInline src={project.files[candidate.id]?fileUrl(project,candidate.id):undefined} aria-label={candidate.title}/><div><span className="badge">{candidate.score}/100 · {candidate.category}</span><h3>{candidate.title}</h3><p>{candidate.description}</p><small>{formatTime(candidate.start)} — {formatTime(candidate.end)} · {Math.round(candidate.duration??candidate.end-candidate.start)} сек.</small><p className="ai-note">{candidate.reason}</p><button className="button primary" disabled={working} onClick={()=>{const next={...(candidate.settings||defaults(candidate.start,candidate.end)),...(candidate.segments?{segments:candidate.segments}:{}),keywords:candidate.keywords||[]};setSettings(next);void action(`${api}/projects/${project.id}/preview`,{sceneId:candidate.id,settings:next});}}>{candidate.ready?'Настроить ролик':'Создать ролик'}</button>{candidate.ready&&<a className="button outline" href={fileUrl(project,candidate.id)} download="scenza.mp4">Скачать MP4</a>}{candidate.ready&&<ClipKit project={project} candidate={candidate} notify={notify} working={working} onCapcut={capcut}/>}</div></article>)}</div></div>}</section>}
        {currentVersion&&settings&&<section className="panel ai-review"><div className="ai-section-heading"><h2>{project.status==='COMPLETED'?'Видео готово':'Ваш ролик готов'}</h2><label>Версия<select value={project.currentVersion} disabled={working} onChange={e=>{const version=project.versions.find(v=>v.id===e.target.value);if(version)setSettings(version.settings);void action(`${api}/projects/${project.id}/restore`,{versionId:e.target.value});}}>{project.versions.map(v=><option key={v.id} value={v.id}>Версия {v.number}</option>)}</select></label></div>
          <ol className="ai-flow" aria-label="Этапы работы с роликом"><li className="is-done">Загрузка</li><li className={approval?'is-done':settingsChanged?'is-current':'is-done'}>Редактирование</li><li className={approval?'is-done':settingsChanged?'':'is-current'}>Предпросмотр</li><li className={project.status==='COMPLETED'?'is-done':approval?'is-current':''}>Экспорт</li></ol>
          {currentVersion.settings?.format==='9:16'?<><div className="ai-result-frame"><video className="ai-result" key={project.finalFile&&project.status==='COMPLETED'?project.finalFile:currentVersion.id} controls playsInline preload="metadata" src={fileUrl(project,project.status==='COMPLETED'&&project.finalFile?project.finalFile:currentVersion.id)}/><SafeZones platform={zones}/></div><SafeZonePicker value={zones} onChange={setZones}/></>:<video className="ai-result" key={project.finalFile&&project.status==='COMPLETED'?project.finalFile:currentVersion.id} controls playsInline preload="metadata" src={fileUrl(project,project.status==='COMPLETED'&&project.finalFile?project.finalFile:currentVersion.id)}/>}
          {approval&&<BannerEditor ad={ad} savedAd={project.ad||null} needsBuild={!!project.ad&&(approval?project.status!=='COMPLETED':!sameAd(currentVersion.ad||null,project.ad,clipDuration))} setAd={setAd} clip={clipDuration} format={(approval?currentVersion.settings:settings).format} fileUrl={id=>fileUrl(project,id)} frameSource={fileUrl(project,currentVersion.id)} working={working} onUpload={file=>void uploadAsset(file,'advertisement')} onSave={next=>void saveAd(next)} onRemove={()=>void removeAd()}/>}
          {!approval&&<>
            <div className="ai-tool-tabs" role="tablist" aria-label="Инструменты редактирования">{editorTabs.map(([value,label])=><button key={value} type="button" role="tab" id={`ai-tab-${value}`} aria-selected={tab===value} aria-controls="ai-tool-panel" className={tab===value?'is-active':''} onClick={()=>setTab(value)}>{label}</button>)}</div>
            <div className="ai-tool-panel" id="ai-tool-panel" role="tabpanel" aria-labelledby={`ai-tab-${tab}`}>
              {tab==='video'&&<><p className="ai-note">Формат кадра и кадрирование. Изменение начала или конца заменяет монтаж одним непрерывным фрагментом исходника.</p><div className="ai-controls"><label>Формат кадра<select value={settings.format} onChange={e=>setSettings({...settings,format:e.target.value as Settings['format']})}>{['9:16','1:1','16:9'].map(f=><option key={f}>{f}</option>)}</select></label><label>Кадрирование<select value={settings.cropMode} onChange={e=>setSettings({...settings,cropMode:e.target.value as Settings['cropMode']})}><option value="smart">По положению лица</option><option value="manual">Вручную</option></select></label><label>Положение кадра<input type="range" min={0} max={100} disabled={settings.cropMode!=='manual'} value={settings.cropX} onChange={e=>setSettings({...settings,cropX:Number(e.target.value)})}/></label><label>Начало, сек.<input type="number" min={0} max={project.duration} step="0.1" value={settings.start} onChange={e=>setSettings({...settings,segments:undefined,start:Number(e.target.value)})}/></label><label>Конец, сек.<input type="number" min={0} max={project.duration} step="0.1" value={settings.end} onChange={e=>setSettings({...settings,segments:undefined,end:Number(e.target.value)})}/></label></div></>}
              {tab==='subtitles'&&<SubtitleEditor settings={settings} onChange={setSettings}/>}
              {tab==='sound'&&<><div className="ai-controls"><label className="ai-checkbox"><input type="checkbox" checked={!settings.muted} onChange={e=>setSettings({...settings,muted:!e.target.checked})}/>Звук исходного видео</label><label>Музыка<select value={settings.musicId} onChange={e=>setSettings({...settings,musicId:e.target.value})}><option value="">Без музыки</option>{project.music.map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label><label>Громкость музыки<input type="range" min={0} max={1} step=".01" value={settings.musicVolume} onChange={e=>setSettings({...settings,musicVolume:Number(e.target.value)})}/></label><label>Загрузить свой трек<input type="file" accept=".mp3,.wav,.m4a,.ogg" disabled={working} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadAsset(file,'music');e.target.value='';}}/></label></div><p className="ai-note">Используйте музыку, на которую у вас есть разрешение. Во время речи её громкость автоматически уменьшается.</p></>}
              {tab==='banner'&&<BannerEditor ad={ad} savedAd={project.ad||null} needsBuild={!!project.ad&&(approval?project.status!=='COMPLETED':!sameAd(currentVersion.ad||null,project.ad,clipDuration))} setAd={setAd} clip={clipDuration} format={(approval?currentVersion.settings:settings).format} fileUrl={id=>fileUrl(project,id)} frameSource={fileUrl(project,currentVersion.id)} working={working} onUpload={file=>void uploadAsset(file,'advertisement')} onSave={next=>void saveAd(next)} onRemove={()=>void removeAd()}/>}
              {tab==='ai'&&<form className="ai-revision" onSubmit={e=>{e.preventDefault();void action(`${api}/projects/${project.id}/revise`,{request:revision,settings});}}><label>Что изменить?<textarea maxLength={2000} value={revision} onChange={e=>setRevision(e.target.value)} placeholder="Сделай субтитры побольше и поменяй цвет текста на жёлтый."/></label><p className="ai-note">AI-правка учитывается в месячной статистике правок. Всё, что есть во вкладках, можно изменить вручную бесплатно.</p><button className="button outline" disabled={working||!revision.trim()}>Внести изменения</button></form>}
              {tab==='templates'&&<TemplatesPanel settings={settings} onApply={setSettings} notify={notify} templates={templates}/>}
            </div>
            <div className="ai-apply-bar">{settingsChanged?<p className="ai-note" role="status">Есть изменения, которых ещё нет в ролике выше.</p>:<p className="ai-note">Предпросмотр выше соответствует настройкам.</p>}<div className="ai-actions"><button type="button" className="button outline" disabled={working||!settingsChanged} onClick={()=>void action(`${api}/projects/${project.id}/preview`,{settings})}>Применить к ролику — бесплатно</button><button type="button" className="button primary" disabled={working||settingsChanged} onClick={()=>void action(`${api}/projects/${project.id}/approve`)}>Всё устраивает — подтвердить ролик</button></div></div>
          </>}
          {approval&&<section className="ai-ad"><h2>Экспорт</h2><p className="ai-note">Баннер и его настройки уже учтены — нажмите «Экспортировать MP4». Точный предпросмотр по желанию.</p><details className="ai-format"><summary>Изменить формат</summary><label>Новый формат<select aria-label="Новый формат" value={settings.format} disabled={working} onChange={event=>setSettings({...settings,format:event.target.value as Settings['format']})}>{['9:16','1:1','16:9'].map(format=><option key={format}>{format}</option>)}</select></label><p className="ai-note">После смены формата посмотрите и подтвердите новую версию ролика. Рекламу можно будет проверить ещё раз.</p><button className="button outline" disabled={working||settings.format===currentVersion.settings.format} onClick={()=>void action(`${api}/projects/${project.id}/preview`,{settings:{...currentVersion.settings,format:settings.format}})}>Применить формат</button></details>{project.ad&&<div className="ai-actions"><button className="button outline" disabled={working||adSettingsChanged} onClick={()=>void previewAd()}>Точный предпросмотр MP4 с баннером</button></div>}{project.adPreview&&!adSettingsChanged&&<video className="ai-result" key={project.adPreview} controls playsInline src={fileUrl(project,project.adPreview)} aria-label="Предпросмотр итогового ролика с баннером"/>}{adSettingsChanged&&<p className="ai-note">Сохраните баннер, чтобы экспортировать ролик.</p>}<button className="button primary" disabled={working||settings.format!==currentVersion.settings.format||adSettingsChanged} onClick={()=>void action(`${api}/projects/${project.id}/export`,{settings:currentVersion.settings})}>Экспортировать MP4</button></section>}
          {project.status==='COMPLETED'&&project.finalFile&&<div className="ai-actions"><a className="button primary" href={fileUrl(project,project.finalFile)} download="scenza.mp4">Скачать MP4</a><button className="button outline" onClick={()=>{setShowCandidates(true);document.querySelector('.ai-moments')?.scrollIntoView({block:'start',behavior:'auto'});notify('Выберите другой найденный момент. Повторный анализ не нужен.');}}>Создать ещё ролик из этого фильма</button></div>}
          <ClipKit project={project} notify={notify} working={working} onCapcut={capcut}/>
        </section>}
      </>}
    </>}
    {!list&&project&&(()=>{
      const busyNow=running.includes(project.status)||project.status==='UPLOADING';
      const title=project.status==='UPLOADING'?'Загрузка видео':project.status==='FAILED'?'Обработка остановлена':busyNow?(job?.status==='queued'?'В очереди':phase?phaseNames[phase]:'Подготовка к обработке'):project.status==='READY'?(project.candidates.some(candidate=>candidate.ready)?'Ролики готовы':project.candidates.length?'Анализ завершён':'Видео подготовлено'):project.status==='AWAITING_APPROVAL'?'Ролик готов к проверке':project.status==='COMPLETED'?'Экспорт завершён':'Ролик подтверждён';
      const queuedTotal=job?.status==='queued'&&phase?phasesTime(rates,[phase,...nextPhases],sourceSeconds,clipSeconds):null;
      const detail=busyNow&&job?.status==='running'&&/ из /.test(job.stage)?job.stage:'';
      const text=project.status==='UPLOADING'?(uploadLeft!==null?`Осталось примерно ${formatRange({low:uploadLeft*.9,high:uploadLeft*1.15})} загрузки файла.`:busy?'Измеряем скорость загрузки…':'Загрузка приостановлена — выберите тот же файл, чтобы продолжить.')
        :project.status==='FAILED'?`${job?.error||project.error||'Не удалось завершить обработку.'} Повторить можно в блоке выше.`
        :!busyNow?'Готово.'
        :job?.status==='queued'?`Ждём свободный обработчик: видео обрабатываются по очереди.${queuedTotal?` После старта — примерно ${formatRange(queuedTotal)}.`:''} Страницу можно закрыть.`
        :job?.stalled?'Обработчик давно не отвечает. Задача перезапустится автоматически — ничего делать не нужно.'
        :left?.delayed?'Этот этап идёт дольше обычного. Обработка продолжается — результат сохранится в «Моих проектах».'
        :left?.range?`Осталось примерно ${formatRange(left.range)}${left.live?'':' — по данным прошлых обработок'}.`
        :'Время этого этапа пока не оценить: мало данных о прошлых обработках. Обработка продолжается.';
      return <section className={`ai-progress-dock ${project.status==='FAILED'?'is-failed':''} ${busyNow?'':'is-idle'}`} aria-label="Ход обработки видео">
        <div className="ai-progress-meta"><div aria-live="polite"><strong>{title}</strong><span>{text}</span>{detail&&<small>{detail}</small>}</div>{measuredProgress!==null&&<b title="Измеренный прогресс текущего этапа">{measuredProgress}%</b>}</div>
        {project.status==='FAILED'?<div className="ai-progress-stopped"/>:<progress aria-label={title} value={busyNow?measuredProgress??undefined:100} max={100}/>}
      <ol className="ai-progress-steps"><li className={project.status!=='UPLOADING'?'is-done':'is-current'}><Icon name={project.status!=='UPLOADING'?'check':'upload'} size={14}/>Загрузка</li><li className={['READY','RENDERING','AWAITING_APPROVAL','APPROVED','ADDING_AD','EXPORTING','COMPLETED'].includes(project.status)?'is-done':['PREPROCESSING','TRANSCRIBING','ANALYZING'].includes(project.status)?'is-current':''}><Icon name="film" size={14}/>Анализ</li><li className={currentVersion?'is-done':project.status==='RENDERING'?'is-current':''}><Icon name="clip" size={14}/>Ролик</li><li className={project.status==='COMPLETED'?'is-done':project.status==='EXPORTING'?'is-current':''}><Icon name="download" size={14}/>Экспорт</li></ol>
      </section>;
    })()}
    <AdminAccess open={topUp} onClose={()=>setTopUp(false)}/>
  </div>;
}
