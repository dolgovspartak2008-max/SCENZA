import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SafeZonePicker, SafeZones, coversInterface, platforms } from './SafeZones';
import type { Platform } from './SafeZones';

export type Ad = {
  fileId: string; kind?: 'image' | 'video'; mediaDuration?: number; position: string; width: number; height?: number; fill?: boolean;
  fit?: 'contain' | 'cover' | 'stretch'; start: number; duration: number; opacity: number; offsetX?: number; offsetY?: number; fade?: number;
  background?: 'color' | 'blur'; backgroundColor?: string;
};
type Format = '9:16' | '1:1' | '16:9';
const round = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const frameSize = (format: Format) => format === '9:16' ? [1080, 1920] : format === '1:1' ? [1080, 1080] : [1920, 1080];
const positions: [string, string][] = [
  ['auto', 'Полоса под видео'], ['top-left', 'Слева сверху'], ['top', 'Сверху'], ['top-right', 'Справа сверху'], ['center', 'По центру'],
  ['bottom-left', 'Слева снизу'], ['bottom', 'Снизу'], ['bottom-right', 'Справа снизу'],
];

/** Keeps every value inside the limits the server accepts, so saving never fails on a slider edge. */
export function sanitizeAd(ad: Ad, clip: number): Ad {
  const insert = ad.position === 'insert', final = ad.position === 'final';
  const safeClip = Math.max(.2, clip);
  const duration = insert ? clamp(ad.duration, .5, 30) : clamp(ad.duration, .5, safeClip);
  const start = insert ? clamp(ad.start, 0, Math.max(0, safeClip - .1)) : final ? 0 : clamp(ad.start, 0, Math.max(0, safeClip - duration));
  const fade = clamp(ad.fade ?? 0, 0, Math.min(2, duration / 2));
  return {
    ...ad, duration: round(duration), start: round(start), fade: round(fade),
    width: clamp(Math.round(ad.width), 10, insert ? 100 : 80), height: clamp(Math.round(ad.height ?? 25), 10, 100),
    offsetX: clamp(Math.round(ad.offsetX ?? 0), -50, 50), offsetY: clamp(Math.round(ad.offsetY ?? 0), -50, 50),
    opacity: clamp(ad.opacity, 0, 1), fit: ad.fit ?? (ad.fill ? 'stretch' : 'contain'), fill: (ad.fit ?? (ad.fill ? 'stretch' : 'contain')) === 'stretch',
    background: ad.background === 'blur' ? 'blur' : 'color', backgroundColor: /^#[\da-f]{6}$/i.test(ad.backgroundColor ?? '') ? ad.backgroundColor : '#000000',
  };
}

const compared = ['fileId', 'position', 'width', 'height', 'fit', 'start', 'duration', 'opacity', 'offsetX', 'offsetY', 'fade', 'background', 'backgroundColor'] as const;
/** Compares the editable values only, so key order or server-added fields never look like unsaved changes. */
export function sameAd(a: Ad | null | undefined, b: Ad | null | undefined, clip: number) {
  if (!a || !b) return !a && !b;
  const x = sanitizeAd(a, clip), y = sanitizeAd(b, clip);
  return compared.every(key => x[key] === y[key]);
}

/** Same geometry as the FFmpeg overlay in server/ai/render.mjs, expressed in % of the frame. */
export function bannerBox(ad: Ad, format: Format, natural: { width: number; height: number } | null) {
  const [W, H] = frameSize(format), insert = ad.position === 'insert', strip = ad.position === 'auto' || ad.position === 'strip';
  const boxW = W * ad.width / 100, boxH = H * (ad.height ?? 25) / 100, fit = ad.fit ?? (ad.fill ? 'stretch' : 'contain');
  let w = boxW, h = boxH;
  if (fit === 'contain' && natural?.width && natural.height) { const scale = Math.min(boxW / natural.width, boxH / natural.height); w = natural.width * scale; h = natural.height * scale; }
  let x = (W - w) / 2, y = (H - h) / 2;
  if (!insert) {
    if (strip) y = H * .75 + (H * .25 - h) / 2;
    else {
      x = ad.position.endsWith('-left') ? W * .02 : ad.position.endsWith('-right') ? W - w - W * .02 : (W - w) / 2;
      y = ad.position.startsWith('top') ? H * .1 : ad.position === 'center' || ad.position === 'final' ? (H - h) / 2 : H * .78 - h;
    }
  }
  x += W * (ad.offsetX ?? 0) / 100; y += H * (ad.offsetY ?? 0) / 100;
  return { left: `${x / W * 100}%`, top: `${y / H * 100}%`, width: `${w / W * 100}%`, height: `${h / H * 100}%`, strip };
}

type Props = {
  ad: Ad | null; savedAd: Ad | null; needsBuild?: boolean; setAd: (ad: Ad | null) => void; clip: number; format: Format; fileUrl: (id: string) => string; frameSource?: string;
  working: boolean; onUpload: (file: File) => void; onSave: (ad: Ad) => void; onRemove: () => void;
};

export default function BannerEditor({ ad, savedAd, needsBuild = false, setAd, clip, format, fileUrl, frameSource, working, onUpload, onSave, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null), frame = useRef<HTMLCanvasElement>(null), probe = useRef<HTMLVideoElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [replay, setReplay] = useState(0);
  const [platform, setPlatform] = useState<Platform | ''>(format === '9:16' ? 'tiktok' : '');
  const changed = !!ad && !sameAd(ad, savedAd, clip);
  const insert = ad?.position === 'insert';
  const box = useMemo(() => ad ? bannerBox(ad, format, natural) : null, [ad, format, natural]);
  const frameTime = ad ? Math.max(0, insert ? ad.start - .1 : ad.start + Math.min(ad.duration, 1) / 2) : 0;
  useEffect(() => { setNatural(null); }, [ad?.fileId]);
  // Draw the paused frame from the finished clip; nothing is read back, so a cross-origin clip still displays.
  useEffect(() => {
    const video = probe.current;
    if (!video || !frameSource) return;
    const draw = () => { const canvas = frame.current; if (!canvas || !video.videoWidth) return; canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d')?.drawImage(video, 0, 0); };
    const seek = () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(frameTime, Math.max(0, video.duration - .05)); };
    video.addEventListener('seeked', draw); video.addEventListener('loadeddata', seek);
    if (video.readyState >= 2) seek();
    return () => { video.removeEventListener('seeked', draw); video.removeEventListener('loadeddata', seek); };
  }, [frameSource, frameTime]);
  const update = (patch: Partial<Ad>) => { if (ad) setAd(sanitizeAd({ ...ad, ...patch }, clip)); };
  const mode = (next: 'insert' | 'overlay' | 'final') => {
    if (!ad) return;
    if (next === 'insert') setAd(sanitizeAd({ ...ad, position: 'insert', width: 100, height: 100, offsetX: 0, offsetY: 0, start: round(clip / 2), duration: Math.min(30, round(ad.kind === 'video' && ad.mediaDuration ? ad.mediaDuration : 5)), background: ad.background ?? 'color' }, clip));
    else if (next === 'final') setAd(sanitizeAd({ ...ad, position: 'final', width: Math.min(ad.width, 80), height: Math.min(ad.height ?? 40, 60), duration: Math.min(5, clip) }, clip));
    else { const duration = Math.min(5, clip); setAd(sanitizeAd({ ...ad, position: ad.position === 'insert' || ad.position === 'final' ? 'bottom' : ad.position, width: 60, height: 25, offsetX: 0, offsetY: 0, duration, start: Math.max(0, (clip - duration) / 2) }, clip)); }
  };
  const currentMode = insert ? 'insert' : ad?.position === 'final' ? 'final' : 'overlay';
  const total = clip + (insert && ad ? ad.duration : 0);
  const segment = ad ? { left: (currentMode === 'final' ? Math.max(0, clip - ad.duration) : ad.start) / Math.max(.1, total) * 100, width: Math.min(ad.duration, total) / Math.max(.1, total) * 100 } : null;
  const aspect = format === '9:16' ? '9 / 16' : format === '1:1' ? '1 / 1' : '16 / 9';
  const scale = ad ? Math.round((ad.width + (ad.height ?? 25)) / 2) : 0;
  const picker = <input ref={input} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.m4v" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(file); }} />;

  if (!ad) return <section className="ai-banner ai-banner-empty">
    <div><h3>Баннер в ролике</h3><p className="ai-note">Загрузите картинку или короткое видео — в середине ролика видео встанет на паузу, на экране будет только ваш баннер, затем ролик продолжится. Время, размер и положение вы настроите сами, без запросов к AI.</p></div>
    <button type="button" className="button primary" disabled={working} onClick={() => input.current?.click()}>Добавить баннер</button>
    <small>PNG, JPG, WEBP до 20 МБ или видео до 30 сек. / 100 МБ</small>{picker}
  </section>;

  return <section className="ai-banner">
    <div className="ai-section-heading"><h3>Баннер в ролике</h3><div className="ai-banner-file"><button type="button" className="button outline" disabled={working} onClick={() => input.current?.click()}>Заменить файл</button><button type="button" className="text-link" disabled={working} onClick={onRemove}>Убрать баннер</button></div></div>{picker}
    <div className="ai-banner-layout">
      <div className="ai-banner-preview-column">
        <div key={replay} className={`ai-banner-stage ${insert ? `is-insert is-${ad.background}` : ''} ${box?.strip ? 'is-strip' : ''}`} style={{ aspectRatio: aspect, ...(insert && ad.background !== 'blur' ? { background: ad.backgroundColor } : {}), '--banner-fade': `${ad.fade ?? 0}s` } as CSSProperties} aria-label="Живой предпросмотр баннера">
          {!(insert && ad.background !== 'blur') && <canvas ref={frame} className="ai-banner-frame" aria-hidden="true" />}
          {box && (ad.kind === 'video'
            ? <video className="ai-banner-media" src={fileUrl(ad.fileId)} muted loop autoPlay playsInline onLoadedMetadata={event => setNatural({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} style={{ left: box.left, top: box.top, width: box.width, height: box.height, opacity: ad.opacity, objectFit: ad.fit === 'cover' ? 'cover' : 'fill' }} />
            : <img className="ai-banner-media" src={fileUrl(ad.fileId)} alt="Ваш баннер" onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ left: box.left, top: box.top, width: box.width, height: box.height, opacity: ad.opacity, objectFit: ad.fit === 'cover' ? 'cover' : 'fill' }} />)}
          {insert && <span className="ai-banner-badge">Пауза · {ad.duration} сек.</span>}
          {format === '9:16' && <SafeZones platform={platform} />}
        </div>
        {format === '9:16' && <SafeZonePicker value={platform} onChange={setPlatform} />}
        {format === '9:16' && platform && box && !insert && coversInterface(box, platform) && <p className="ai-note ai-banner-warning" role="status">Баннер заходит под кнопки или подпись {platforms[platform].label}. Сдвиньте или уменьшите его.</p>}
        {frameSource && <video ref={probe} className="ai-banner-probe" src={frameSource} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1} />}
        <div className="ai-banner-timeline" role="button" tabIndex={0} aria-label="Шкала ролика: нажмите, чтобы выбрать момент баннера" onClick={event => { if (currentMode === 'final') return; const rect = event.currentTarget.getBoundingClientRect(); const at = (event.clientX - rect.left) / rect.width * total; update({ start: round(insert ? Math.min(at, clip - .1) : at - ad.duration / 2) }); }} onKeyDown={event => { if (event.key === 'ArrowLeft') update({ start: ad.start - .5 }); if (event.key === 'ArrowRight') update({ start: ad.start + .5 }); }}>
          {segment && <span className={insert ? 'is-pause' : ''} style={{ left: `${segment.left}%`, width: `${Math.max(1.5, segment.width)}%` }} />}
        </div>
        <small className="ai-banner-times"><span>0:00</span><span>{insert ? `пауза с ${ad.start} сек.` : `с ${currentMode === 'final' ? round(Math.max(0, clip - ad.duration)) : ad.start} сек.`}</span><span>{round(total)} сек.</span></small>
        <button type="button" className="text-link" onClick={() => setReplay(value => value + 1)}>Показать появление</button>
      </div>
      <div className="ai-banner-controls">
        <fieldset className="ai-banner-modes"><legend>Как показывать</legend>
          {([['insert', 'Пауза: только баннер'], ['overlay', 'Поверх видео'], ['final', 'В конце ролика']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={currentMode === value} className={currentMode === value ? 'is-active' : ''} onClick={() => mode(value)}>{label}</button>)}
        </fieldset>
        {currentMode === 'overlay' && <label>Положение<select value={ad.position} onChange={event => update({ position: event.target.value })}>{positions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {currentMode !== 'final' && <label>{insert ? 'Момент паузы' : 'Начало'} · {ad.start} сек.<span className="ai-banner-row"><input type="range" min={0} max={round(insert ? Math.max(0, clip - .1) : Math.max(0, clip - ad.duration))} step={.1} value={ad.start} onChange={event => update({ start: Number(event.target.value) })} /><button type="button" className="button outline" onClick={() => update({ start: round(insert ? clip / 2 : (clip - ad.duration) / 2) })}>В середину</button></span></label>}
        <label>Длительность · {ad.duration} сек.<input type="range" min={.5} max={round(insert ? 30 : Math.max(.5, clip))} step={.1} value={ad.duration} onChange={event => update({ duration: Number(event.target.value) })} /></label>
        {insert && <div className="ai-banner-pair"><label>Фон во время паузы<select value={ad.background ?? 'color'} onChange={event => update({ background: event.target.value as Ad['background'] })}><option value="color">Сплошной цвет — только баннер</option><option value="blur">Размытый кадр ролика</option></select></label>{ad.background !== 'blur' && <label>Цвет фона<input type="color" value={ad.backgroundColor ?? '#000000'} onChange={event => update({ backgroundColor: event.target.value })} /></label>}</div>}
        <label>Масштаб · {scale}%<input type="range" min={10} max={insert ? 100 : 80} value={Math.min(scale, insert ? 100 : 80)} onChange={event => { const next = Number(event.target.value), delta = next - scale; update({ width: ad.width + delta, height: (ad.height ?? 25) + delta }); }} /></label>
        <div className="ai-banner-pair"><label>Ширина · {ad.width}%<input type="range" min={10} max={insert ? 100 : 80} value={ad.width} onChange={event => update({ width: Number(event.target.value) })} /></label><label>Высота · {ad.height ?? 25}%<input type="range" min={10} max={100} value={ad.height ?? 25} onChange={event => update({ height: Number(event.target.value) })} /></label></div>
        <div className="ai-banner-pair"><label>Сдвиг по горизонтали · {ad.offsetX ?? 0}%<input type="range" min={-50} max={50} value={ad.offsetX ?? 0} onChange={event => update({ offsetX: Number(event.target.value) })} /></label><label>Сдвиг по вертикали · {ad.offsetY ?? 0}%<input type="range" min={-50} max={50} value={ad.offsetY ?? 0} onChange={event => update({ offsetY: Number(event.target.value) })} /></label></div>
        <div className="ai-banner-pair"><label>Вписать в рамку<select value={ad.fit ?? 'contain'} onChange={event => update({ fit: event.target.value as Ad['fit'] })}><option value="contain">Целиком, без обрезки</option><option value="cover">Заполнить, обрезав края</option><option value="stretch">Растянуть</option></select></label><label>Прозрачность · {Math.round(ad.opacity * 100)}%<input type="range" min={0} max={1} step={.05} value={ad.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label></div>
        <label>Плавное появление и исчезание · {ad.fade ?? 0} сек.<input type="range" min={0} max={round(Math.min(2, ad.duration / 2))} step={.1} value={ad.fade ?? 0} onChange={event => update({ fade: Number(event.target.value) })} /></label>
        <div className="ai-banner-quick"><button type="button" className="button outline" onClick={() => update({ offsetX: 0, offsetY: 0 })}>По центру</button><button type="button" className="button outline" onClick={() => mode('insert')}>На весь экран</button>{savedAd && <button type="button" className="text-link" disabled={!changed} onClick={() => setAd(savedAd)}>Отменить изменения</button>}</div>
        {insert && <p className="ai-note">Ролик остановится на {ad.start} сек., {ad.duration} сек. будет виден только баннер, затем видео продолжится с того же места. Итоговая длина — {round(clip + ad.duration)} сек.</p>}
        <button type="button" className="button primary" disabled={working || !(changed || needsBuild)} onClick={() => onSave(sanitizeAd(ad, clip))}>{changed ? 'Сохранить и собрать видео' : needsBuild ? 'Собрать видео с баннером' : 'Видео с баннером готово'}</button>
        <p className="ai-note">Предпросмотр слева обновляется сразу. После сохранения ролик пересобирается с баннером и появляется в плеере выше — его можно посмотреть и скачать. Токены не списываются.</p>
      </div>
    </div>
  </section>;
}
