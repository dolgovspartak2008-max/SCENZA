import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Film, Focus, Layers3, Maximize, Pause, Play, RotateCcw, Settings2, Type, Volume2, VolumeX } from 'lucide-react';
import { Dialog } from '../components/ui/dialog';
import './product-demo.css';

export interface DemoCopy {
  labelInterface: string;
  projectTitle: string;
  sceneLabel: string;
  scenes: [{ title: string; caption: string }, { title: string; caption: string }, { title: string; caption: string }];
  subtitlesLabel: string;
  presets: [string, string, string];
  formatLabel: string;
  exportLabel: string;
  sourceLabel: string;
  guideLabel: string;
  selectSceneLabel: string;
}

const sceneImages = ['/videos/editor-5958-clean-1.jpg', '/videos/editor-5958-clean-2.jpg', '/videos/editor-5958-clean-3.jpg'];
const subtitles = [
  { start: 5.95, end: 7.35, text: 'Семёнов к Фоме' },
  { start: 7.55, end: 8.35, text: 'Ствол не отдам' },
  { start: 8.5, end: 9.45, text: 'Магазин нам временно' },
  { start: 9.5, end: 9.9, text: 'Отдайте' },
  { start: 10.1, end: 10.95, text: 'Хотя бы так' },
  { start: 11, end: 11.4, text: 'Угу' },
  { start: 11.55, end: 13.9, text: 'Разбежался. Фома, меня' },
  { start: 14, end: 14.55, text: 'Обижают' },
  { start: 18.55, end: 19.3, text: 'Пропустите' },
];
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formats = ['9:16', '1:1', '16:9'] as const;

export function ProductDemo({ variant = 'wide', copy, onAction, lang = 'ru' }: {
  variant?: 'hero' | 'wide';
  copy: DemoCopy;
  onAction?: () => void;
  lang?: 'ru' | 'en';
}) {
  const ru = lang === 'ru';
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(23.348345);
  const sceneDuration = duration / 3;
  const scene = Math.min(2, Math.floor((position + .001) / sceneDuration));
  const seek = (time: number) => {
    if (source.current) source.current.currentTime = time;
    setPosition(time);
  };
  const setScene = (index: number) => seek(index * sceneDuration);
  const [preset, setPreset] = useState(0);
  const [font, setFont] = useState('');
  const [format, setFormat] = useState<(typeof formats)[number]>('1:1');
  const [tab, setTab] = useState('scenes');
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [showCaptions, setShowCaptions] = useState(true);
  const [showShade, setShowShade] = useState(true);
  const [crop, setCrop] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [mediaVisible, setMediaVisible] = useState(false);
  const [muted, setMuted] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [audioFile, setAudioFile] = useState<{ url: string; name: string } | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const caption = (index: number) => captions[index] ?? subtitles[index].text;
  const activeSubtitle = subtitles.findIndex(item => position >= item.start && position < item.end);
  const subtitleIndex = activeSubtitle >= 0 ? activeSubtitle : Math.max(0, subtitles.filter(item => item.start <= position).length - 1);
  const subtitle = subtitles[subtitleIndex];
  const selectSubtitle = (index: number) => { seek(subtitles[index].start); setTab('subtitles'); };
  const phrases = caption(subtitleIndex).trim().replace(/\s+/g, ' ').match(/.{1,32}(?:\s|$)|.{1,32}/gu)?.map(text => text.trim()) ?? [''];
  const phraseIndex = Math.max(0, Math.min(phrases.length - 1, Math.floor((position - subtitle.start) / (subtitle.end - subtitle.start) * phrases.length)));
  const visibleCaption = activeSubtitle >= 0 ? phrases[phraseIndex] : '';
  const tabs = [
    { id: 'scenes', label: copy.sceneLabel, icon: Film },
    { id: 'layers', label: ru ? 'Слои' : 'Layers', icon: Layers3 },
    { id: 'subtitles', label: copy.subtitlesLabel, icon: Type },
    { id: 'audio', label: ru ? 'Звук' : 'Audio', icon: Volume2 },
    { id: 'settings', label: ru ? 'Настройки' : 'Settings', icon: Settings2 },
  ];

  useEffect(() => {
    const element = source.current;
    if (!element) return;
    const pause = () => { if (document.hidden) { element.pause(); audio.current?.pause(); } };
    const pauseOther = (event: Event) => { if (event.target instanceof HTMLVideoElement && event.target !== element) { element.pause(); audio.current?.pause(); } };
    document.addEventListener('visibilitychange', pause);
    document.addEventListener('play', pauseOther, true);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setMediaVisible(true);
      else element.pause();
    });
    observer.observe(element);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', pause); document.removeEventListener('play', pauseOther, true); };
  }, []);
  useEffect(() => () => { if (audioFile) URL.revokeObjectURL(audioFile.url); }, [audioFile]);
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const update = () => {
      const time = source.current?.currentTime ?? 0;
      playhead.current?.style.setProperty('--pd-progress', `${Math.min(99.7, time / duration * 100)}%`);
      frameId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frameId);
  }, [playing, duration]);
  useEffect(() => {
    if (!playing) playhead.current?.style.setProperty('--pd-progress', `${Math.min(99.7, position / duration * 100)}%`);
  }, [playing, position, duration]);

  const syncAudio = () => {
    const track = audio.current;
    const video = source.current;
    if (!track || !video || !Number.isFinite(track.duration)) return;
    track.currentTime = Math.min(video.currentTime, track.duration);
    if (!video.paused && video.currentTime < track.duration) void track.play().catch(() => setNotice(ru ? 'Не удалось воспроизвести аудио.' : 'Audio playback failed.'));
    else track.pause();
  };

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen();
    } catch { setNotice(ru ? 'Браузер не разрешил полноэкранный режим.' : 'Fullscreen is unavailable in this browser.'); }
  };
  const reset = () => {
    source.current?.pause(); seek(0); setPreset(0); setFont(''); setFormat('1:1'); setCrop(50);
    setCaptions({}); setShowCaptions(true); setShowShade(true); setAudioFile(null);
    setNotice(ru ? 'Настройки демо восстановлены.' : 'Demo settings restored.');
  };
  const togglePlayback = async () => {
    const video = source.current;
    if (!video) return;
    if (!video.paused) { video.pause(); return; }
    if (video.error) video.load();
    if (video.currentTime >= duration) seek(0);
    setNotice('');
    try { await video.play(); }
    catch { setNotice(ru ? 'Видео не загрузилось. Проверьте соединение и нажмите воспроизведение ещё раз.' : 'Video could not load. Check your connection and try playback again.'); }
  };
  const exportFrame = async () => {
    setExporting(true); setNotice('');
    try {
      const image = source.current;
      const element = frame.current;
      if (!image || !element) throw new Error('Frame unavailable');
      if (image.readyState < 2 || image.seeking) throw new Error('Video frame unavailable');
      await document.fonts.ready;
      const canvas = document.createElement('canvas');
      const [w, h] = format.split(':').map(Number);
      canvas.width = w >= h ? 1080 : Math.round(1080 * w / h);
      canvas.height = h >= w ? 1080 : Math.round(1080 * h / w);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const scale = Math.max(canvas.width / image.videoWidth, canvas.height / image.videoHeight);
      context.drawImage(image, (canvas.width - image.videoWidth * scale) * crop / 100, (canvas.height - image.videoHeight * scale) / 2, image.videoWidth * scale, image.videoHeight * scale);
      if (showShade) {
        const gradient = context.createLinearGradient(0, canvas.height * .3, 0, canvas.height);
        gradient.addColorStop(.3, '#06171c00'); gradient.addColorStop(1, '#06171ca6');
        context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const textElement = element.querySelector<HTMLElement>('.pd-caption');
      const textSpan = textElement?.querySelector('span');
      if (showCaptions && textElement && textSpan && visibleCaption.trim()) {
        const style = getComputedStyle(textElement);
        const ratio = canvas.width / element.clientWidth;
        const fontSize = parseFloat(style.fontSize) * ratio;
        context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
        const text = preset === 1 ? visibleCaption.toUpperCase() : visibleCaption;
        const lines: string[] = [];
        let line = '';
        for (const word of text.trim().split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (context.measureText(candidate).width <= textElement.clientWidth * ratio) { line = candidate; continue; }
          if (line) lines.push(line);
          line = '';
          for (const character of word) {
            if (line && context.measureText(line + character).width > textElement.clientWidth * ratio) { lines.push(line); line = ''; }
            line += character;
          }
        }
        if (line) lines.push(line);
        const lineHeight = parseFloat(style.lineHeight) * ratio;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        lines.forEach((textLine, index) => {
          const y = canvas.height - parseFloat(style.bottom) * ratio - (lines.length - index - .5) * lineHeight;
          if (preset !== 2) {
            context.fillStyle = getComputedStyle(textSpan).backgroundColor;
            const width = context.measureText(textLine).width + 10 * ratio;
            context.fillRect((canvas.width - width) / 2, y - lineHeight / 2, width, lineHeight);
          }
          context.fillStyle = style.color; context.fillText(textLine, canvas.width / 2, y);
        });
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Export unavailable')), 'image/png'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `scenza-demo-${scene + 1}-${format.replace(':', 'x')}.png`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(ru ? 'PNG-кадр готов. Скачивание началось.' : 'PNG frame ready. Download started.');
    } catch { setNotice(ru ? 'Не удалось сохранить кадр. Попробуйте ещё раз после загрузки видео.' : 'Could not save the frame. Retry once the video has loaded.'); }
    finally { setExporting(false); }
  };

  return (
    <div className={`product-demo product-demo--${variant}`}>
      <div className="pd-disclosure">{copy.labelInterface}</div>
      <p className="pd-demo-note">{ru ? 'Попробуйте инструменты на готовом видео. AI-анализ и экспорт MP4 в этой демонстрации недоступны.' : 'Try the tools with a sample video. AI analysis and MP4 export are unavailable in this demo.'}</p>
      <div className="pd-window">
        <div className="pd-titlebar">
          <span className="pd-brand"><Focus size={19} strokeWidth={2.2} />SCENZA</span>
          <button className="pd-project" onClick={() => { setTab('settings'); source.current?.pause(); }}>{copy.projectTitle}<ChevronRight size={12} /></button>
          <button className="pd-export" onClick={() => { source.current?.pause(); setNotice(''); setExportOpen(true); }}><ArrowDownToLine size={13} />{copy.exportLabel}</button>
        </div>
        <div className="pd-workspace">
          <div className="pd-rail" role="group" aria-label={ru ? 'Инструменты демо' : 'Demo tools'}>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'pd-rail-selected' : ''} aria-label={label} title={label} aria-pressed={tab === id} onClick={() => setTab(id)}><Icon /><span>{label}</span></button>)}</div>
          <div className="pd-scenes">
            <div className="pd-panel-heading"><Layers3 size={13} />{copy.sceneLabel}<span>3</span></div>
            <div className="pd-scene-list" role="group" aria-label={copy.sceneLabel}>
              {copy.scenes.map((item, index) => (
                <button className={`pd-scene ${scene === index ? 'is-active' : ''}`} key={sceneImages[index]} aria-pressed={scene === index} onClick={() => setScene(index)}>
                  <span className="pd-scene-image"><img src={sceneImages[index]} alt="" loading="lazy" /><span>{String(index + 1).padStart(2, '0')}</span>{scene === index && <Check size={13} />}</span>
                  <span className="pd-scene-title">{item.title}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="pd-viewer" ref={viewer}>
            <div className="pd-viewer-heading"><span><Film size={13} />{ru ? 'Видео · 3 фрагмента' : 'Video · 3 segments'}</span><span>{format}<button className="pd-icon-button" onClick={() => void fullscreen()} aria-label={ru ? 'Полноэкранный режим' : 'Fullscreen'}><Maximize size={14} /></button></span></div>
            <div className="pd-stage">
              <div ref={frame} className={`pd-frame pd-frame--${format.replace(':', '-')} pd-caption-style-${preset}`}>
                <video ref={source} className="pd-source" style={{ objectPosition: `${crop}% center` }} src="/videos/editor-5958-clean.mp4" poster={sceneImages[0]} playsInline preload={mediaVisible ? "metadata" : "none"} muted={muted || !!audioFile} aria-label={copy.sourceLabel}
                  onPlay={() => { setPlaying(true); syncAudio(); }} onPause={() => { setPlaying(false); syncAudio(); }} onEnded={() => setPlaying(false)}
                  onTimeUpdate={event => setPosition(Math.min(duration, event.currentTarget.currentTime))}
                  onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) setDuration(event.currentTarget.duration); }}
                  onLoadedData={event => setFrameReady(!event.currentTarget.seeking)} onSeeking={() => setFrameReady(false)}
                  onSeeked={event => { setFrameReady(event.currentTarget.readyState >= 2); syncAudio(); }}
                  onError={() => { setPlaying(false); setFrameReady(false); setNotice(ru ? 'Не удалось загрузить видео. Проверьте соединение и повторите попытку.' : 'Could not load the video. Check your connection and try again.'); }} />
                {showShade && <div className="pd-frame-shade" />}
                <span className="pd-safe-corner pd-safe-corner--tl" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--tr" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--bl" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--br" aria-hidden="true" />
                {showCaptions && visibleCaption && <p className="pd-caption" style={{ fontFamily: font || undefined }}><span>{visibleCaption}</span></p>}
              </div>
            </div>
            <div className="pd-viewer-footer"><span>{copy.sceneLabel} <b>{scene + 1}</b> / 3</span><div className="pd-playback"><button className="pd-next-scene" aria-label={playing ? (ru ? 'Остановить просмотр сцен' : 'Pause scene preview') : (ru ? 'Воспроизвести сцены' : 'Play scene preview')} onClick={() => void togglePlayback()}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button className="pd-next-scene" onClick={() => setScene((scene + 1) % 3)} aria-label={copy.selectSceneLabel}><ChevronRight size={18} /></button><button className="pd-next-scene" aria-label={muted ? (ru ? 'Включить звук' : 'Unmute') : (ru ? 'Выключить звук' : 'Mute')} aria-pressed={!muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button></div><span className="pd-scale">{timeLabel(position)} / {timeLabel(duration)}</span></div>
          </div>
          <div className="pd-settings">
            {(tab === 'scenes' || tab === 'subtitles') && <>
            <div className="pd-panel-heading"><Settings2 size={13} />{copy.subtitlesLabel}</div>
            <div className="pd-presets" role="group" aria-label={copy.subtitlesLabel}>
              {copy.presets.map((name, index) => <button key={index} className={`pd-preset pd-preset--${index} ${preset === index ? 'is-active' : ''}`} aria-pressed={preset === index} onClick={() => setPreset(index)}><span className="pd-preset-preview">Aa</span><span>{name}</span>{preset === index && <Check size={12} />}</button>)}
            </div>
            <label className="pd-field">{ru ? 'Шрифт' : 'Font'}<select aria-label={ru ? 'Шрифт' : 'Font'} value={font} onChange={event => setFont(event.target.value)}><option value="">{ru ? 'Из выбранного стиля' : 'Selected style default'}</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="'Courier New', monospace">Courier New</option></select></label>
            {tab === 'subtitles' && <>
              <label className="pd-field">{ru ? 'Нижние субтитры' : 'Bottom subtitles'}<select aria-label={ru ? 'Нижние субтитры' : 'Bottom subtitles'} value={subtitleIndex} onChange={event => selectSubtitle(Number(event.target.value))}>{subtitles.map((item, index) => <option key={item.start} value={index}>{timeLabel(item.start)} · {caption(index) || (ru ? 'Без текста' : 'No text')}</option>)}</select></label>
              <label className="pd-field">{ru ? 'Текст выбранной фразы' : 'Selected phrase text'}<textarea value={caption(subtitleIndex)} maxLength={160} rows={4} onFocus={() => { source.current?.pause(); if (activeSubtitle < 0) seek(subtitle.start); }} onChange={event => setCaptions(value => ({ ...value, [subtitleIndex]: event.target.value }))} /><small>{caption(subtitleIndex).length}/160 · {ru ? 'Изменения применяются к нижним субтитрам' : 'Changes apply to the bottom subtitles'}</small></label>
            </>}
            </>}
            {tab === 'layers' && <><div className="pd-panel-heading"><Layers3 size={13} />{ru ? 'Слои кадра' : 'Frame layers'}</div><label className="pd-toggle"><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />{copy.subtitlesLabel}</label><label className="pd-toggle"><input type="checkbox" checked={showShade} onChange={event => setShowShade(event.target.checked)} />{ru ? 'Затемнение фона' : 'Background shade'}</label><p className="pd-tool-note">{ru ? 'Включайте слои и сразу сравнивайте результат в кадре.' : 'Toggle layers and compare the frame instantly.'}</p></>}
            {tab === 'audio' && <><div className="pd-panel-heading"><Volume2 size={13} />{ru ? 'Звуковая дорожка' : 'Audio track'}</div><p className="pd-tool-note">{ru ? 'У видео есть оригинальный звук. Добавьте свою дорожку, чтобы заменить его при просмотре.' : 'The video has original sound. Add your own track to replace it during playback.'}</p><label className="pd-field">{ru ? 'Выбрать аудио · до 50 МБ' : 'Choose audio · up to 50 MB'}<input type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 50 * 1024 * 1024 || !file.type.startsWith('audio/')) { setNotice(ru ? 'Выберите аудиофайл до 50 МБ.' : 'Choose an audio file under 50 MB.'); return; } setNotice(''); setAudioFile({ url: URL.createObjectURL(file), name: file.name }); event.target.value = ''; }} /></label>{audioFile && <><p className="pd-tool-note">{audioFile.name}</p></>}<p className="pd-tool-note">{ru ? 'Файл остаётся в браузере. Монтаж видео со звуком доступен в студии.' : 'Your file stays in the browser. Edit video with audio in the studio.'}</p></>}
            {audioFile && <audio hidden={tab !== 'audio'} ref={audio} controls muted={muted} src={audioFile.url} onLoadedMetadata={syncAudio} aria-label={ru ? 'Прослушать выбранное аудио' : 'Preview selected audio'} onError={() => setNotice(ru ? 'Этот аудиоформат не поддерживается браузером.' : 'This audio format is not supported by your browser.')} />}
            {tab === 'settings' && <><div className="pd-panel-heading"><Settings2 size={13} />{ru ? 'Настройки кадра' : 'Frame settings'}</div><label className="pd-field">{ru ? 'Кадрирование по горизонтали' : 'Horizontal framing'}<input type="range" min="0" max="100" disabled={format !== '9:16'} value={crop} onChange={event => setCrop(Number(event.target.value))} /><small>{format === '9:16' ? `${crop}%` : ru ? 'Выберите 9:16 для горизонтального кадрирования' : 'Choose 9:16 for horizontal framing'}</small></label><button className="pd-tool-button" onClick={reset}><RotateCcw size={14} />{ru ? 'Сбросить демо' : 'Reset demo'}</button></>}
            {tab !== 'audio' && <>
            <div className="pd-format-group" role="group" aria-label={copy.formatLabel}>
              <div className="pd-panel-heading">{copy.formatLabel}</div>
              <div className="pd-formats">{formats.map((value) => <button key={value} className={format === value ? 'is-active' : ''} aria-pressed={format === value} onClick={() => setFormat(value)}><span className={`pd-format-shape pd-format-shape--${value.replace(':', '-')}`} aria-hidden="true" />{value}</button>)}</div>
            </div>
            </>}
            <p className="pd-guide"><Focus size={13} />{copy.guideLabel}</p>
            {onAction && <button className="pd-tool-button pd-studio-button" onClick={onAction}>{ru ? 'Открыть студию' : 'Open studio'}<ChevronRight size={14} /></button>}
          </div>
          <div className="pd-timeline">
            <div className="pd-timeline-labels"><button className="pd-icon-button" aria-label={copy.sceneLabel} onClick={() => setTab('scenes')}><Film size={13} /></button><button className="pd-icon-button" aria-label={copy.subtitlesLabel} onClick={() => setTab('subtitles')}><Type size={13} /></button><button className="pd-icon-button" aria-label={ru ? 'Звук' : 'Audio'} onClick={() => setTab('audio')}><Volume2 size={13} /></button></div>
            <div className="pd-tracks">
              <div className="pd-ruler"><span>{timeLabel(0)}</span><i /><i /><span>{timeLabel(sceneDuration)}</span><i /><i /><span>{timeLabel(sceneDuration * 2)}</span></div>
              <div className="pd-filmstrip">{copy.scenes.map((item, index) => <button key={index} aria-label={item.title} aria-pressed={scene === index} onClick={() => setScene(index)}><img src={sceneImages[index]} alt="" loading="lazy" /><img src={sceneImages[index]} alt="" loading="lazy" /></button>)}</div>
              <div className="pd-subtitle-track">{subtitles.map((item, index) => <button key={item.start} style={{ left: `${item.start / duration * 100}%`, width: `${(item.end - item.start) / duration * 100}%` }} title={caption(index) || (ru ? 'Добавить текст' : 'Add text')} aria-pressed={activeSubtitle === index} onClick={() => selectSubtitle(index)}>{caption(index) || (ru ? 'Добавить текст' : 'Add text')}</button>)}</div>
              <button className="pd-audio-track" onClick={() => setTab('audio')}><Volume2 size={12} />{audioFile?.name ?? (ru ? 'Добавить аудио' : 'Add audio')}</button>
              <input className="pd-seek" type="range" aria-label={ru ? 'Позиция просмотра сцен' : 'Scene preview position'} min="0" max={duration} step="0.01" value={position} onChange={event => seek(Number(event.target.value))} />
              <div ref={playhead} className="pd-playhead" aria-hidden="true"><span /></div>
            </div>
          </div>
        </div>
      </div>
      <p className="pd-credit">{ru ? 'Редактируйте нижние субтитры: выберите фразу на дорожке, измените текст, шрифт или стиль. Фразы для этого примера подготовлены заранее.' : 'Edit the bottom subtitles: select a phrase on the track and change its text, font or style. Captions for this sample are prepared in advance.'}</p>
      {notice && !exportOpen && <p className="pd-notice" role="status">{notice}</p>}
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title={ru ? 'Экспорт демо' : 'Export demo'} closeLabel={ru ? 'Закрыть' : 'Close'} className="pd-export-dialog">
        <h2>{ru ? 'Сохраните свой кадр' : 'Save your frame'}</h2>
        <p>{ru ? 'Скачайте PNG выбранной сцены с вашим текстом, стилем и кадрированием. Для монтажа и экспорта MP4 откройте рабочую студию.' : 'Download a PNG of the selected scene with your text, style and framing. Open the working studio to edit and export MP4 video.'}</p>
        <p className="pd-export-detail">{copy.scenes[scene].title} · {format} · PNG</p>
        <button className="pd-export" disabled={exporting || !frameReady} onClick={() => void exportFrame()}><ArrowDownToLine size={16} />{exporting ? (ru ? 'Сохраняем…' : 'Saving…') : (ru ? 'Скачать кадр PNG' : 'Download PNG frame')}</button>
        {!frameReady && <p className="pd-notice" role="status">{ru ? 'Ожидаем загрузки выбранного кадра видео…' : 'Waiting for the selected video frame to load…'}</p>}
        {onAction && <button className="pd-tool-button" onClick={() => { setExportOpen(false); onAction(); }}>{ru ? 'Перейти в студию' : 'Open studio'}<ChevronRight size={15} /></button>}
        {notice && <p className="pd-notice" role="status">{notice}</p>}
      </Dialog>
    </div>
  );
}
