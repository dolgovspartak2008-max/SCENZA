import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { formatTime } from './model';
import type { Banner, Clip, EditorSettings, Job, Navigate, Notify, Project, Scene } from './model';
import { request, waitForJob } from './api';
import Steps from './Steps';
import './editor-functional.css';

type EditorProps = { project: Project; navigate: Navigate; notify: Notify; onProjectChange?: () => void };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function initialSettings(project: Project): EditorSettings {
  return project.settings ?? { sceneId: '', start: 0, end: Math.min(project.duration ?? 0, 30), format: '9:16', cropX: 50, muted: false, subtitleText: '', subtitleStyle: 'accent', banner: null };
}

function Timeline({ project, settings, time, seek }: { project: Project; settings: EditorSettings; time: number; seek: (value: number) => void }) {
  const [zoom, setZoom] = useState(1);
  const duration = project.duration || 1;
  const scenes = project.scenes ?? [];
  return <section className="timeline panel" aria-label="Монтажная дорожка">
    <div className="timeline-heading"><h2>Монтажная дорожка</h2><div><button className="icon-button small" aria-label="Уменьшить масштаб таймлайна" disabled={zoom === 1} onClick={() => setZoom(zoom - .5)}><Icon name="minus" size={15} /></button><button className="icon-button small" aria-label="Увеличить масштаб таймлайна" disabled={zoom === 3} onClick={() => setZoom(zoom + .5)}><Icon name="plus" size={15} /></button></div></div>
    <div className="timeline-body"><div className="track-icons"><Icon name="film" size={18} /><Icon name="wave" size={20} /><Icon name="text" size={20} /></div><div className="timeline-scroll"><div className="tracks" style={{ width: `${zoom * 100}%` }}>
      <div className="ruler" /><div className="frame-track">{scenes.length ? scenes.map((scene) => <img key={scene.id} src={scene.image} alt="" style={{ width: `${(scene.end - scene.start) / duration * 100}%` }} />) : project.image ? <img src={project.image} alt="Кадр исходного видео" style={{ width: '100%', objectFit: 'contain' }} /> : <span className="track-empty">Кадры появятся после анализа</span>}<div className="selected-range" style={{ left: `${settings.start / duration * 100}%`, right: `${(1 - settings.end / duration) * 100}%` }}><i /><i /></div></div>
      <div className="audio-track">{project.waveform ? <img src={project.waveform} alt="Звуковая волна исходного видео" /> : <span className="track-empty">{project.hasAudio ? 'Звуковая дорожка' : 'Без звука'}</span>}</div><div className="subtitle-track">{settings.subtitleText ? <span>{settings.subtitleText}</span> : <small>Субтитры не добавлены</small>}</div>
      <div className="ruler bottom-ruler" /><div className="time-labels">{[0, .25, .5, .75, 1].map((tick) => <span key={tick} style={{ left: `${tick * 100}%`, transform: tick === 0 ? 'none' : tick === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{formatTime(tick * duration)}</span>)}</div><div className="playhead" style={{ left: `${time / duration * 100}%` }} /><input className="timeline-seek" type="range" min="0" max={duration} step="0.01" value={time} onChange={(event) => seek(Number(event.target.value))} aria-label="Позиция на монтажной дорожке" />
    </div></div></div>
  </section>;
}

function Subtitle({ text, style, ratio }: { text: string; style: EditorSettings['subtitleStyle']; ratio: number }) {
  if (!text.trim()) return null;
  const value = text.trim();
  const lastWord = value.match(/\S+$/)?.[0] ?? '';
  return <div className={`preview-subtitle ${style}`} style={{ fontSize: `${Math.min(1, 1 / ratio) * (style === 'minimal' ? 4.3 : 5.5)}cqw` }}><span>{value.slice(0, value.length - lastWord.length)}<em>{lastWord}</em></span></div>;
}

function BannerSettings({ projectId, banner, setBanner, duration }: { projectId: string; banner: Banner | null; setBanner: (banner: Banner | null) => void; duration: number }) {
  const [draft, setDraft] = useState<Banner>(banner ?? { id: '', url: '', position: 'top', width: 80, start: 0, duration: Math.min(5, duration) });
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (banner) setDraft(banner); }, [banner]);
  async function upload(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 ** 2 || file.size === 0) { setError('Выберите JPG, PNG или WebP до 5 МБ.'); return; }
    setUploading(true); setError('');
    try {
      const result = await request<{ banner: { id: string; url: string } }>(`/api/projects/${encodeURIComponent(projectId)}/banner?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setDraft((current) => ({ ...current, ...result.banner }));
    } catch (error) { setError(errorText(error)); } finally { setUploading(false); }
  }
  return <details className="banner-settings"><summary><Icon name="image" size={18} /><span>Баннер</span><Icon name="chevron" size={17} /></summary><div className="banner-content">
    <div className="banner-upload">{draft.url ? <img src={draft.url} alt="Выбранный баннер" /> : <div className="banner-placeholder"><Icon name="image" size={22} /><span>Ваш баннер в кадре</span></div>}<button className="button outline" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Загрузка…' : draft.url ? 'Заменить баннер' : 'Добавить баннер'}</button><input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} /></div>
    <label className="setting-row">Положение<select value={draft.position} onChange={(event) => setDraft({ ...draft, position: event.target.value as Banner['position'] })}><option value="top">Сверху</option><option value="bottom">Снизу</option></select></label>
    <label className="setting-row">Размер<span className="range-value"><input aria-label="Ширина баннера" type="range" min="30" max="100" step="5" value={draft.width} onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })} />{draft.width}%</span></label>
    <label className="setting-row">Начало, сек.<input type="number" step="0.1" min="0" max={Math.max(0, duration - .1)} value={draft.start} onChange={(event) => setDraft({ ...draft, start: Number(event.target.value) })} /></label><label className="setting-row">Длительность<input type="number" step="0.1" min="0.1" max={duration} value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} /></label>
    {error && <p className="field-error" role="alert">{error}</p>}<button className="button outline" disabled={!draft.id || uploading} onClick={() => { if (!Number.isFinite(draft.start) || !Number.isFinite(draft.duration) || draft.start < 0 || draft.duration < .1 || draft.start + draft.duration > duration + .001) { setError(`Интервал баннера должен быть внутри клипа (${duration.toFixed(1)} сек.).`); return; } setError(''); setBanner(draft); }}>Применить</button>{banner && <button className="text-link" onClick={() => setBanner(null)}>Убрать из кадра</button>}<small>Время от начала выбранного клипа</small>
  </div></details>;
}

export default function Editor(props: EditorProps) {
  return <EditorSession key={props.project.id} {...props} />;
}

function EditorSession({ project, navigate, notify, onProjectChange }: EditorProps) {
  const [source, setSource] = useState(project);
  const [settings, setSettings] = useState(() => initialSettings(project));
  const settingsRef = useRef(settings);
  const [time, setTime] = useState(settings.start);
  const [playing, setPlaying] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const savedSignature = useRef(JSON.stringify(settings));
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const jobController = useRef<AbortController | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobError, setJobError] = useState('');
  const [result, setResult] = useState<{ clip: Clip; signature: string } | null>(null);
  const [draftText, setDraftText] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const textDialog = useRef<HTMLDialogElement>(null);
  const apiPath = `/api/projects/${encodeURIComponent(project.id)}`;
  const duration = source.duration ?? 0;
  const clipLength = Math.max(0, settings.end - settings.start);
  const aspect = settings.format.replace(':', ' / ');
  const ratio = Number(settings.format.split(':')[0]) / Number(settings.format.split(':')[1]);
  const sourceRatio = (source.width || 16) / (source.height || 9);
  const cropWidth = Math.min(1, ratio / sourceRatio);
  const cropHeight = Math.min(1, sourceRatio / ratio);
  const selectedClip = result?.signature === JSON.stringify(settings) ? result.clip : null;
  const minimumLength = Math.min(.1, duration);

  useEffect(() => { setSource(project); }, [project]);

  function update(patch: Partial<EditorSettings>) {
    const next = { ...settingsRef.current, ...patch };
    const length = next.end - next.start;
    if (next.banner && next.banner.start + next.banner.duration > length) {
      next.banner = { ...next.banner, start: clamp(next.banner.start, 0, Math.max(0, length - .1)), duration: Math.min(next.banner.duration, length) };
      next.banner.duration = Math.min(next.banner.duration, length - next.banner.start);
    }
    settingsRef.current = next;
    setSettings(next);
  }

  function persist() {
    const snapshot = settingsRef.current;
    const signature = JSON.stringify(snapshot);
    const operation = saveQueue.current.catch(() => {}).then(async () => {
      if (signature === savedSignature.current) return;
      if (mounted.current) { setSaved('saving'); setSaveError(''); }
      try {
        await request<{ project: Project }>(apiPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: snapshot }) });
        savedSignature.current = signature;
        if (JSON.stringify(settingsRef.current) === signature) {
          if (mounted.current) setSaved('saved');
          onProjectChange?.();
        }
      } catch (error) {
        if (mounted.current) { setSaved('error'); setSaveError(errorText(error)); }
        throw error;
      }
    });
    saveQueue.current = operation;
    return operation;
  }
  const flush = useRef(persist);
  flush.current = persist;
  useEffect(() => {
    if (JSON.stringify(settings) === savedSignature.current) return;
    setSaved('saving');
    const timer = window.setTimeout(() => { void flush.current().catch(() => {}); }, 500);
    return () => window.clearTimeout(timer);
  }, [settings]);
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (JSON.stringify(settingsRef.current) !== savedSignature.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { mounted.current = false; jobController.current?.abort(); window.removeEventListener('beforeunload', beforeUnload); void flush.current().catch(() => {}); };
  }, []);

  function drawPreview() {
    const media = video.current;
    const target = canvas.current;
    if (!media || !target || media.readyState < 2 || !media.videoWidth) return;
    const [w, h] = settingsRef.current.format.split(':').map(Number);
    const outputRatio = w / h;
    const width = Math.min(media.videoWidth, media.videoHeight * outputRatio);
    const height = Math.min(media.videoHeight, media.videoWidth / outputRatio);
    const context = target.getContext('2d');
    context?.drawImage(media, (media.videoWidth - width) * settingsRef.current.cropX / 100, (media.videoHeight - height) / 2, width, height, 0, 0, target.width, target.height);
  }
  useEffect(() => { drawPreview(); }, [time, settings.format, settings.cropX, mediaReady]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const draw = () => {
      const media = video.current;
      if (media && !media.paused && media.currentTime >= settingsRef.current.end) {
        media.pause(); media.currentTime = settingsRef.current.end; setTime(media.currentTime);
      }
      drawPreview(); frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const media = video.current;
    if (media && (media.currentTime < settings.start || media.currentTime >= settings.end)) {
      media.pause(); media.currentTime = settings.start; setTime(settings.start);
    }
  }, [settings.start, settings.end]);

  function seek(value: number) {
    const media = video.current;
    if (!media || !mediaReady) return;
    media.currentTime = clamp(value, 0, duration);
    setTime(media.currentTime);
  }
  async function togglePlayback() {
    const media = video.current;
    if (!media) return;
    if (!media.paused) { media.pause(); return; }
    if (media.currentTime >= settings.end - .02 || media.currentTime < settings.start) seek(settings.start);
    try { await media.play(); } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMediaError(`Воспроизведение недоступно: ${errorText(error)}`);
    }
  }
  function chooseScene(scene: Scene) {
    video.current?.pause();
    update({ sceneId: scene.id, start: scene.start, end: scene.end });
    seek(scene.start);
  }
  async function runJob(type: 'analyze' | 'export') {
    if (busy) return;
    setBusy(true); setJobError(''); setJob(null);
    const controller = new AbortController();
    jobController.current = controller;
    try {
      await persist();
      const exportSettings = settingsRef.current;
      const { job: started } = await request<{ job: Job }>(`${apiPath}/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(type === 'export' ? { settings: exportSettings } : {}) });
      setJob(started);
      const finished = await waitForJob(started.id, setJob, controller.signal);
      setJob(finished);
      if (finished.status === 'cancelled') return;
      if (finished.status !== 'done') throw new Error(finished.message || 'Обработка не завершена.');
      if (type === 'analyze') {
        const { project: refreshed } = await request<{ project: Project }>(apiPath);
        setSource(refreshed); onProjectChange?.(); notify('Сцены найдены по смене кадров.');
      } else {
        const { clips } = await request<{ clips: Clip[] }>('/api/clips');
        const clip = clips.find((item) => item.id === finished.clipId);
        if (!clip) throw new Error('Готовый файл не найден. Откройте «Мои клипы».');
        setResult({ clip, signature: JSON.stringify(exportSettings) }); onProjectChange?.(); notify('MP4 готов. Можно скачать файл.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setJobError(errorText(error));
    } finally { setBusy(false); }
  }
  async function cancelJob() {
    if (!job) return;
    try { const result = await request<{ job: Job }>(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' }); setJob(result.job); }
    catch (error) { setJobError(errorText(error)); }
  }
  async function go(path: string) {
    try { await persist(); navigate(path); } catch { notify('Изменения не сохранены. Повторите сохранение перед переходом.'); }
  }

  return <>
    <div className="editor-intro"><div className="page-intro"><h1>{project.title}</h1><p className="connected-status"><i className={`status-dot ${mediaError || !project.video ? 'draft' : 'ready'}`} />{mediaError ? 'Ошибка видео' : project.video ? 'Локальное видео' : 'Источник не подключён'}<span>·</span>{source.scenes?.length ? `Сцен: ${source.scenes.length}` : 'Анализ доступен'}</p></div><div className="editor-actions"><a className="button outline" href="/app/upload" onClick={(event) => { event.preventDefault(); void go('/upload'); }}>Добавить видео</a><button className="button primary" disabled={busy || !mediaReady || !!mediaError || !clipLength} onClick={() => void runJob('export')}>{busy && job?.type === 'export' ? 'Экспорт…' : 'Экспортировать'}</button></div></div>
    <Steps labels={['Источник', 'Сцены', 'Субтитры', 'Экспорт']} active={2} />
    {(busy || job || jobError) && <section className="editor-job panel" aria-live="polite"><div><strong>{busy ? job?.message || 'Подготовка…' : jobError ? 'Не удалось завершить обработку' : job?.status === 'cancelled' ? 'Обработка отменена' : 'Обработка завершена'}</strong>{busy && <span>{Math.round(job?.progress ?? 0)}%</span>}</div>{busy && <progress max="100" value={job?.progress ?? 0} />}{busy && job && <button className="button outline" onClick={() => void cancelJob()}>Отменить</button>}{jobError && <p className="field-error" role="alert">{jobError}</p>}{selectedClip && <div className="editor-downloads"><a className="button primary" href={selectedClip.url} download>Скачать MP4</a>{selectedClip.subtitleUrl && <a className="button outline" href={selectedClip.subtitleUrl} download>Скачать SRT</a>}</div>}</section>}
    <div className="editor-grid">
      <aside className="scenes-column"><section className="scene-list panel"><h2>Найденные сцены</h2><p>Выберите отрезок для клипа</p><div className="scene-options">{source.scenes?.map((scene, index) => <button key={scene.id} className={`scene-option ${settings.sceneId === scene.id ? 'selected' : ''}`} aria-pressed={settings.sceneId === scene.id} onClick={() => chooseScene(scene)}>{scene.image && <img src={scene.image} alt={`Кадр сцены ${index + 1}`} />}<span><strong>Сцена {index + 1}</strong><small>{formatTime(scene.start)}–{formatTime(scene.end)}</small></span></button>)}</div>{!source.scenes?.length && <p className="editor-note">Найдите границы сцен по смене кадров или задайте отрезок вручную.</p>}<button className="button outline analyze-button" disabled={busy || !project.video} onClick={() => void runJob('analyze')}>{source.scenes?.length ? 'Повторить анализ' : 'Найти сцены'}</button></section><section className="editor-trends editor-source panel"><h2>Исходное видео</h2><p className="editor-note">{duration ? `${formatTime(duration)} · ${source.width ?? '—'} × ${source.height ?? '—'}` : 'Ожидание метаданных'}</p><p className="editor-note">{source.hasAudio ? 'Со звуковой дорожкой' : 'Без звуковой дорожки'}</p>{source.sourceCredit && <p className="editor-source-credit">{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceCredit}</a> : source.sourceCredit}</p>}<a className="text-link" href="/app/clips" onClick={(event) => { event.preventDefault(); void go('/clips'); }}>Мои клипы<Icon name="arrow" size={17} /></a></section></aside>
      <div className="player-column"><div ref={player} className="video-player panel"><div className="source-frame real-source" style={{ aspectRatio: sourceRatio }}>{project.video ? <video ref={video} src={project.video} poster={project.image || undefined} preload="metadata" playsInline muted={settings.muted} onLoadedMetadata={(event) => { const media = event.currentTarget; const realDuration = Number.isFinite(media.duration) ? media.duration : duration; setSource((value) => ({ ...value, duration: realDuration, width: media.videoWidth, height: media.videoHeight })); setMediaReady(true); setMediaError(''); if (!settingsRef.current.end) update({ end: Math.min(realDuration, 30) }); media.currentTime = settingsRef.current.start; }} onLoadedData={drawPreview} onSeeked={drawPreview} onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); drawPreview(); }} onEnded={() => setPlaying(false)} onError={() => { setMediaReady(false); setPlaying(false); setMediaError('Браузер не смог открыть видео. Проверьте локальный сервер и файл источника.'); }} onTimeUpdate={(event) => { const media = event.currentTarget; if (!media.paused && media.currentTime >= settingsRef.current.end) { media.pause(); media.currentTime = settingsRef.current.end; } setTime(media.currentTime); }} /> : <div className="missing-media">Добавьте видео, чтобы открыть редактор.</div>}<span className="source-badge">Исходное видео</span>{mediaReady && <div className="crop-frame real-crop" style={{ width: `${cropWidth * 100}%`, height: `${cropHeight * 100}%`, left: `${(1 - cropWidth) * settings.cropX}%`, top: `${(1 - cropHeight) * 50}%` }}><span>{settings.format}</span></div>}</div><div className="player-controls"><button className="icon-button play-button" disabled={!mediaReady} aria-label={playing ? 'Приостановить видео' : 'Воспроизвести видео'} onClick={() => void togglePlayback()}><Icon name={playing ? 'pause' : 'play'} size={22} /></button><span className="player-time">{formatTime(clamp(time - settings.start, 0, clipLength))} / {formatTime(clipLength)}</span><input type="range" aria-label="Позиция воспроизведения" disabled={!mediaReady} min={settings.start} max={Math.max(settings.end, settings.start)} step="0.01" value={clamp(time, settings.start, settings.end)} style={{ '--progress': `${clipLength ? clamp((time - settings.start) / clipLength * 100, 0, 100) : 0}%` } as CSSProperties} onChange={(event) => seek(Number(event.target.value))} /><button className="icon-button" disabled={!source.hasAudio} aria-label={settings.muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={settings.muted} onClick={() => update({ muted: !settings.muted })}><Icon name={settings.muted || !source.hasAudio ? 'mute' : 'volume'} size={20} /></button><button className="icon-button" aria-label="Полноэкранный режим" onClick={async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await player.current?.requestFullscreen(); } catch { notify('Полноэкранный режим недоступен в этом браузере.'); } }}><Icon name="fullscreen" size={19} /></button></div></div>{mediaError && <p className="field-error" role="alert">{mediaError}</p>}
        <section className="trim-settings panel" aria-label="Границы клипа"><div className="trim-heading"><h2>Отрезок клипа</h2><span>{clipLength.toFixed(1)} сек.</span></div><label>Начало, сек.<input type="number" min="0" max={Math.max(0, settings.end - minimumLength)} step="0.1" value={Number(settings.start.toFixed(2))} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) update({ sceneId: '', start: clamp(value, 0, settings.end - minimumLength) }); }} /></label><label>Конец, сек.<input type="number" min={settings.start + minimumLength} max={duration} step="0.1" value={Number(settings.end.toFixed(2))} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) update({ sceneId: '', end: clamp(value, settings.start + minimumLength, duration) }); }} /></label></section>
        <Timeline project={source} settings={settings} time={time} seek={seek} />
      </div>
      <aside className="preview-panel panel"><h2>Предпросмотр <span>· {settings.format}</span></h2><div className={`portrait-preview format-${settings.format.replace(':', '-')}`} style={{ aspectRatio: aspect }}><canvas ref={canvas} className="preview-image real-preview" width={Math.round(360 * Math.min(ratio, 1))} height={Math.round(360 / Math.max(ratio, 1))} aria-label="Предпросмотр кадрирования видео" /><Subtitle text={settings.subtitleText} style={settings.subtitleStyle} ratio={ratio} />{settings.banner && time - settings.start >= settings.banner.start && time - settings.start < settings.banner.start + settings.banner.duration && <img className={`preview-banner ${settings.banner.position}`} style={{ width: `${settings.banner.width}%` }} src={settings.banner.url} alt="Баннер в кадре" />}</div>
        <section className="subtitle-settings"><h2>Субтитры</h2><div className="subtitle-presets" role="group" aria-label="Стиль субтитров">{([{ id: 'classic', title: 'Классика' }, { id: 'accent', title: 'Акцент' }, { id: 'minimal', title: 'Минимал' }] as const).map((preset) => <button key={preset.id} className={`subtitle-preset ${preset.id} ${settings.subtitleStyle === preset.id ? 'selected' : ''}`} aria-pressed={settings.subtitleStyle === preset.id} onClick={() => update({ subtitleStyle: preset.id })}><span>Аа</span><small>{preset.title}</small></button>)}</div><div className="subtitle-fields"><label className="setting-row">Формат:<select value={settings.format} onChange={(event) => update({ format: event.target.value as EditorSettings['format'] })}><option>9:16</option><option>1:1</option><option>16:9</option></select></label><label className="setting-row">Кадр по X:<span className="range-value"><input aria-label="Положение кадра по горизонтали" type="range" min="0" max="100" value={settings.cropX} disabled={cropWidth === 1} onChange={(event) => update({ cropX: Number(event.target.value) })} />{settings.cropX}%</span></label><label className="setting-row">Длина, сек.<input type="number" step="0.1" min={minimumLength} max={duration - settings.start} value={Number(clipLength.toFixed(2))} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) update({ sceneId: '', end: settings.start + clamp(value, minimumLength, duration - settings.start) }); }} /></label></div><button className="button outline edit-text-button" onClick={() => { setDraftText(settings.subtitleText); textDialog.current?.showModal(); }}>{settings.subtitleText ? 'Править текст' : 'Добавить текст'}</button><p className="editor-note">Текст вручную, на весь клип.</p></section>
        <BannerSettings projectId={project.id} banner={settings.banner} setBanner={(banner) => update({ banner })} duration={clipLength} />
      </aside>
    </div>
    <footer className="editor-footer"><span className={`saved-state save-${saved}`} role="status">{saved === 'saved' && <i><Icon name="check" size={18} /></i>}{saved === 'saved' ? 'Настройки сохранены' : saved === 'saving' ? 'Сохранение…' : 'Не сохранено'}</span>{saved === 'error' && <button className="text-link" onClick={() => void persist().catch(() => {})}>Повторить</button>}<span className="editor-footnote">Обработка на этом компьютере</span>{selectedClip ? <a className="button primary" href={selectedClip.url} download><Icon name="download" size={21} />Скачать MP4</a> : <button className="button primary" disabled={busy || !mediaReady || !!mediaError || !clipLength} onClick={() => void runJob('export')}><Icon name="download" size={21} />Создать MP4</button>}</footer>{saveError && <p className="field-error" role="alert">{saveError}</p>}
    <dialog ref={textDialog} className="text-dialog" aria-labelledby="subtitle-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) textDialog.current?.close(); }}><form onSubmit={(event) => { event.preventDefault(); update({ subtitleText: draftText.trim() }); textDialog.current?.close(); }}><div className="dialog-heading"><h2 id="subtitle-dialog-title">Текст субтитров</h2><button type="button" className="icon-button" aria-label="Закрыть редактор текста" onClick={() => textDialog.current?.close()}><Icon name="close" /></button></div><label htmlFor="subtitle-text">Текст на весь выбранный клип</label><textarea id="subtitle-text" value={draftText} maxLength={160} rows={4} autoFocus onChange={(event) => setDraftText(event.target.value)} /><div className="dialog-note"><span>Пустое поле убирает субтитры</span><span>{draftText.length}/160</span></div><div className="dialog-actions"><button type="button" className="button outline" onClick={() => textDialog.current?.close()}>Отмена</button><button type="submit" className="button primary">Сохранить текст</button></div></form></dialog>
  </>;
}
