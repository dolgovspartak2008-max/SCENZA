import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronRight, Film, Focus, Image, Layers3, Maximize, Pause, Play, RotateCcw, Settings2, Type, Volume2 } from 'lucide-react';
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

const sceneImages = ['/assets/scenza-city.webp', '/assets/scenza-roof.webp', '/assets/scenza-phone.webp'];
const formats = ['9:16', '1:1', '16:9'] as const;

export function ProductDemo({ variant = 'wide', copy, onAction, lang = 'ru' }: {
  variant?: 'hero' | 'wide';
  copy: DemoCopy;
  onAction?: () => void;
  lang?: 'ru' | 'en';
}) {
  const ru = lang === 'ru';
  const [position, setPosition] = useState(0);
  const scene = Math.min(2, Math.floor(position / 3));
  const setScene = (index: number) => setPosition(index * 3);
  const [preset, setPreset] = useState(0);
  const [format, setFormat] = useState<(typeof formats)[number]>('9:16');
  const [tab, setTab] = useState('scenes');
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [showCaptions, setShowCaptions] = useState(true);
  const [showShade, setShowShade] = useState(true);
  const [crop, setCrop] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [audioFile, setAudioFile] = useState<{ url: string; name: string } | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLImageElement>(null);
  const caption = (index: number) => captions[`${lang}-${index}`] ?? copy.scenes[index].caption;
  const tabs = [
    { id: 'scenes', label: copy.sceneLabel, icon: Film },
    { id: 'layers', label: ru ? 'Слои' : 'Layers', icon: Layers3 },
    { id: 'subtitles', label: copy.subtitlesLabel, icon: Type },
    { id: 'audio', label: ru ? 'Звук' : 'Audio', icon: Volume2 },
    { id: 'settings', label: ru ? 'Настройки' : 'Settings', icon: Settings2 },
  ];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setPosition(value => Math.min(9, value + .25)), 250);
    return () => window.clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (position >= 9) setPlaying(false); }, [position]);
  useEffect(() => () => { if (audioFile) URL.revokeObjectURL(audioFile.url); }, [audioFile]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen();
    } catch { setNotice(ru ? 'Браузер не разрешил полноэкранный режим.' : 'Fullscreen is unavailable in this browser.'); }
  };
  const reset = () => {
    setPosition(0); setPlaying(false); setPreset(0); setFormat('9:16'); setCrop(50);
    setCaptions({}); setShowCaptions(true); setShowShade(true); setAudioFile(null);
    setNotice(ru ? 'Настройки демо восстановлены.' : 'Demo settings restored.');
  };
  const exportFrame = async () => {
    setExporting(true); setNotice('');
    try {
      const image = source.current;
      const element = frame.current;
      if (!image || !element) throw new Error('Frame unavailable');
      await image.decode();
      await document.fonts.ready;
      const canvas = document.createElement('canvas');
      const [w, h] = format.split(':').map(Number);
      canvas.width = w >= h ? 1080 : Math.round(1080 * w / h);
      canvas.height = h >= w ? 1080 : Math.round(1080 * h / w);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      context.drawImage(image, (canvas.width - image.naturalWidth * scale) * crop / 100, (canvas.height - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
      if (showShade) {
        const gradient = context.createLinearGradient(0, canvas.height * .3, 0, canvas.height);
        gradient.addColorStop(.3, '#06171c00'); gradient.addColorStop(1, '#06171ca6');
        context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const textElement = element.querySelector<HTMLElement>('.pd-caption');
      const textSpan = textElement?.querySelector('span');
      if (showCaptions && textElement && textSpan && caption(scene).trim()) {
        const style = getComputedStyle(textElement);
        const ratio = canvas.width / element.clientWidth;
        const fontSize = parseFloat(style.fontSize) * ratio;
        context.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
        const text = preset === 1 ? caption(scene).toUpperCase() : caption(scene);
        const lines: string[] = [];
        let line = '';
        for (const word of text.trim().split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (context.measureText(candidate).width <= canvas.width * .78) { line = candidate; continue; }
          if (line) lines.push(line);
          line = '';
          for (const character of word) {
            if (line && context.measureText(line + character).width > canvas.width * .78) { lines.push(line); line = ''; }
            line += character;
          }
        }
        if (line) lines.push(line);
        const lineHeight = fontSize * 1.2;
        context.textAlign = 'center'; context.textBaseline = 'middle';
        lines.forEach((textLine, index) => {
          const y = canvas.height * .86 - (lines.length - index - .5) * lineHeight;
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
    } catch { setNotice(ru ? 'Не удалось сохранить кадр. Попробуйте ещё раз после загрузки изображения.' : 'Could not save the frame. Retry once the image has loaded.'); }
    finally { setExporting(false); }
  };

  return (
    <div className={`product-demo product-demo--${variant}`}>
      <div className="pd-disclosure"><span />{copy.labelInterface}</div>
      <div className="pd-window">
        <div className="pd-titlebar">
          <span className="pd-brand"><Focus size={19} strokeWidth={2.2} />SCENZA</span>
          <button className="pd-project" onClick={() => { setTab('settings'); setPlaying(false); }}>{copy.projectTitle}<ChevronRight size={12} /></button>
          <button className="pd-export" onClick={() => { setPlaying(false); setNotice(''); setExportOpen(true); }}><ArrowDownToLine size={13} />{copy.exportLabel}</button>
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
            <div className="pd-viewer-heading"><span><Image size={13} />{ru ? 'Демо · кадры сцен' : 'Demo · scene frames'}</span><span>{format}<button className="pd-icon-button" onClick={() => void fullscreen()} aria-label={ru ? 'Полноэкранный режим' : 'Fullscreen'}><Maximize size={14} /></button></span></div>
            <div className="pd-stage">
              <div ref={frame} className={`pd-frame pd-frame--${format.replace(':', '-')} pd-caption-style-${preset}`}>
                <img ref={source} className="pd-source" style={{ objectPosition: `${crop}% center` }} src={sceneImages[scene]} alt={copy.scenes[scene].title} loading={variant === 'hero' ? 'eager' : 'lazy'} fetchPriority={variant === 'hero' ? 'high' : 'auto'} />
                {showShade && <div className="pd-frame-shade" />}
                <span className="pd-safe-corner pd-safe-corner--tl" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--tr" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--bl" aria-hidden="true" /><span className="pd-safe-corner pd-safe-corner--br" aria-hidden="true" />
                {showCaptions && <p className="pd-caption"><span>{caption(scene)}</span></p>}
              </div>
            </div>
            <div className="pd-viewer-footer"><span>{copy.sceneLabel} <b>{scene + 1}</b> / 3</span><div className="pd-playback"><button className="pd-next-scene" aria-label={playing ? (ru ? 'Остановить просмотр сцен' : 'Pause scene preview') : (ru ? 'Воспроизвести сцены' : 'Play scene preview')} onClick={() => { if (position >= 9) setPosition(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button className="pd-next-scene" onClick={() => setScene((scene + 1) % 3)} aria-label={copy.selectSceneLabel}><ChevronRight size={18} /></button></div><span className="pd-scale">0:{String(Math.floor(position)).padStart(2, '0')} / 0:09</span></div>
          </div>
          <div className="pd-settings">
            {(tab === 'scenes' || tab === 'subtitles') && <>
            <div className="pd-panel-heading"><Settings2 size={13} />{copy.subtitlesLabel}</div>
            <div className="pd-presets" role="group" aria-label={copy.subtitlesLabel}>
              {copy.presets.map((name, index) => <button key={index} className={`pd-preset pd-preset--${index} ${preset === index ? 'is-active' : ''}`} aria-pressed={preset === index} onClick={() => setPreset(index)}><span className="pd-preset-preview">Aa</span><span>{name}</span>{preset === index && <Check size={12} />}</button>)}
            </div>
            {tab === 'subtitles' && <label className="pd-field">{ru ? 'Текст выбранной сцены' : 'Selected scene text'}<textarea value={caption(scene)} maxLength={160} rows={4} onChange={event => setCaptions(value => ({ ...value, [`${lang}-${scene}`]: event.target.value }))} /><small>{caption(scene).length}/160</small></label>}
            </>}
            {tab === 'layers' && <><div className="pd-panel-heading"><Layers3 size={13} />{ru ? 'Слои кадра' : 'Frame layers'}</div><label className="pd-toggle"><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} />{copy.subtitlesLabel}</label><label className="pd-toggle"><input type="checkbox" checked={showShade} onChange={event => setShowShade(event.target.checked)} />{ru ? 'Затемнение фона' : 'Background shade'}</label><p className="pd-tool-note">{ru ? 'Включайте слои и сразу сравнивайте результат в кадре.' : 'Toggle layers and compare the frame instantly.'}</p></>}
            {tab === 'audio' && <><div className="pd-panel-heading"><Volume2 size={13} />{ru ? 'Звуковая дорожка' : 'Audio track'}</div><p className="pd-tool-note">{ru ? 'Демо состоит из трёх кадров без звука. Добавьте свой аудиофайл и прослушайте его здесь.' : 'This demo has three still frames and no sound. Add an audio file to listen to it here.'}</p><label className="pd-field">{ru ? 'Выбрать аудио · до 50 МБ' : 'Choose audio · up to 50 MB'}<input type="file" accept="audio/*" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 50 * 1024 * 1024 || !file.type.startsWith('audio/')) { setNotice(ru ? 'Выберите аудиофайл до 50 МБ.' : 'Choose an audio file under 50 MB.'); return; } setNotice(''); setAudioFile({ url: URL.createObjectURL(file), name: file.name }); event.target.value = ''; }} /></label>{audioFile && <><p className="pd-tool-note">{audioFile.name}</p><audio controls src={audioFile.url} aria-label={ru ? 'Прослушать выбранное аудио' : 'Preview selected audio'} onError={() => setNotice(ru ? 'Этот аудиоформат не поддерживается браузером.' : 'This audio format is not supported by your browser.')} /></>}<p className="pd-tool-note">{ru ? 'Файл остаётся в браузере. Монтаж видео со звуком доступен в студии.' : 'Your file stays in the browser. Edit video with audio in the studio.'}</p></>}
            {tab === 'settings' && <><div className="pd-panel-heading"><Settings2 size={13} />{ru ? 'Настройки кадра' : 'Frame settings'}</div><label className="pd-field">{ru ? 'Кадрирование по горизонтали' : 'Horizontal framing'}<input type="range" min="0" max="100" value={crop} onChange={event => setCrop(Number(event.target.value))} /><small>{crop}%</small></label><button className="pd-tool-button" onClick={reset}><RotateCcw size={14} />{ru ? 'Сбросить демо' : 'Reset demo'}</button></>}
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
              <div className="pd-ruler"><span>01</span><i /><i /><span>02</span><i /><i /><span>03</span></div>
              <div className="pd-filmstrip">{copy.scenes.map((item, index) => <button key={index} aria-label={item.title} aria-pressed={scene === index} onClick={() => setScene(index)}><img src={sceneImages[index]} alt="" loading="lazy" /><img src={sceneImages[index]} alt="" loading="lazy" /></button>)}</div>
              <div className="pd-subtitle-track">{copy.scenes.map((_, index) => <button key={index} onClick={() => { setScene(index); setTab('subtitles'); }}>{caption(index) || (ru ? 'Добавить текст' : 'Add text')}</button>)}</div>
              <button className="pd-audio-track" onClick={() => setTab('audio')}><Volume2 size={12} />{audioFile?.name ?? (ru ? 'Добавить аудио' : 'Add audio')}</button>
              <input className="pd-seek" type="range" aria-label={ru ? 'Позиция просмотра сцен' : 'Scene preview position'} min="0" max="9" step="0.25" value={position} onChange={event => setPosition(Number(event.target.value))} />
              <div className="pd-playhead" aria-hidden="true" style={{ left: `${Math.min(99.7, position / 9 * 100)}%` }}><span /></div>
            </div>
          </div>
        </div>
      </div>
      {notice && !exportOpen && <p className="pd-notice" role="status">{notice}</p>}
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title={ru ? 'Экспорт демо' : 'Export demo'} closeLabel={ru ? 'Закрыть' : 'Close'} className="pd-export-dialog">
        <h2>{ru ? 'Сохраните свой кадр' : 'Save your frame'}</h2>
        <p>{ru ? 'Скачайте PNG выбранной сцены с вашим текстом, стилем и кадрированием. Для монтажа и экспорта MP4 откройте рабочую студию.' : 'Download a PNG of the selected scene with your text, style and framing. Open the working studio to edit and export MP4 video.'}</p>
        <p className="pd-export-detail">{copy.scenes[scene].title} · {format} · PNG</p>
        <button className="pd-export" disabled={exporting} onClick={() => void exportFrame()}><ArrowDownToLine size={16} />{exporting ? (ru ? 'Сохраняем…' : 'Saving…') : (ru ? 'Скачать кадр PNG' : 'Download PNG frame')}</button>
        {onAction && <button className="pd-tool-button" onClick={() => { setExportOpen(false); onAction(); }}>{ru ? 'Перейти в студию' : 'Open studio'}<ChevronRight size={15} /></button>}
        {notice && <p className="pd-notice" role="status">{notice}</p>}
      </Dialog>
    </div>
  );
}
