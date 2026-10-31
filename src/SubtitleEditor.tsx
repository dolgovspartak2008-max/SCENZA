import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export type SubtitleSettings = {
  format: '9:16' | '1:1' | '16:9'; subtitles: boolean; subtitleStyle: string; subtitleSize: number; subtitleColor?: string; subtitlePosition: 'top' | 'center' | 'bottom';
  subtitleFont?: string; subtitleColors?: string[]; subtitleColorEvery?: number; subtitleAccentColor?: string; subtitleY?: number | null; keywords?: string[];
};

// Same fonts and presets as server/ai/render.mjs, so the live preview matches the rendered MP4.
export const subtitleFonts: { id: string; family: string; label: string }[] = [
  { id: 'montserrat', family: 'SCENZA Montserrat Black', label: 'Montserrat' },
  { id: 'rubik', family: 'SCENZA Rubik ExtraBold', label: 'Rubik' },
  { id: 'unbounded', family: 'SCENZA Unbounded Bold', label: 'Unbounded' },
  { id: 'manrope', family: 'SCENZA Manrope ExtraBold', label: 'Manrope' },
  { id: 'inter', family: 'SCENZA Inter ExtraBold', label: 'Inter' },
  { id: 'nunito', family: 'SCENZA Nunito Black', label: 'Nunito' },
  { id: 'oswald', family: 'SCENZA Oswald Bold', label: 'Oswald' },
];
// outline and shadow are the libass sizes at 1080 px width; `upcoming` is the karaoke colour of words not yet spoken.
const presets: Record<string, { font: string; scale: number; color: string; outline: number; shadow: number; upcoming?: string; label: string }> = {
  Classic: { font: 'montserrat', scale: 1, color: '#ffffff', outline: 4, shadow: 0, label: 'Классика' },
  Bold: { font: 'rubik', scale: 1.12, color: '#ffdf00', outline: 5, shadow: 2, label: 'TikTok' },
  Dynamic: { font: 'montserrat', scale: 1, color: '#ffffff', outline: 4, shadow: 1, upcoming: '#ffdf00', label: 'Караоке' },
  Minimal: { font: 'manrope', scale: .95, color: '#ffffff', outline: 2, shadow: 1, label: 'Минимал' },
  Cinematic: { font: 'oswald', scale: 1.05, color: '#faede4', outline: 2, shadow: 1, label: 'Кино' },
};
// One neutral backdrop and one sentence for every style, so styles are compared with each other and not with a busy frame.
const demoText = 'Так будут выглядеть субтитры в вашем ролике';
const demoAccent = 'субтитры';
const backdrops = { dark: { label: 'Тёмный фон', src: '/assets/subtitle-preview-dark.webp' }, light: { label: 'Светлый фон', src: '/assets/subtitle-preview-light.webp' } } as const;
const palettes = [['#ffffff', '#ffdf00'], ['#ffffff', '#35ead0'], ['#ffdf00', '#ff4d6d'], ['#ffffff', '#ff8a00', '#3fd0ff'], ['#b8ff3c', '#ffffff']];
const presetY = { top: 24, center: 55, bottom: 82 } as const;
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded || typeof FontFace === 'undefined') return;
  fontsLoaded = true;
  for (const font of subtitleFonts) {
    const face = new FontFace(font.family, `url(/fonts/subtitles/${font.id}.ttf)`, { display: 'swap' });
    void face.load().then(loaded => document.fonts.add(loaded)).catch(() => undefined);
  }
}
const tokens = (value: string) => value.toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) || [];

type Props<T extends SubtitleSettings> = { settings: T; onChange: (next: T) => void };

export default function SubtitleEditor<T extends SubtitleSettings>({ settings, onChange }: Props<T>) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [backdrop, setBackdrop] = useState<keyof typeof backdrops>('dark');
  const [spoken, setSpoken] = useState(3);
  useEffect(loadFonts, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const set = (patch: Partial<SubtitleSettings>) => onChange({ ...settings, ...patch });
  const preset = presets[settings.subtitleStyle] ?? presets.Classic;
  const font = subtitleFonts.find(item => item.id === (settings.subtitleFont || preset.font)) ?? subtitleFonts[0];
  const colors = settings.subtitleColors ?? [];
  const multi = colors.length > 1;
  const every = settings.subtitleColorEvery ?? 1;
  const accent = settings.subtitleAccentColor || '#ffdf00';
  const mainColor = settings.subtitleColor || preset.color;
  const y = settings.subtitleY ?? null;
  // The server sizes text as subtitleSize/1080 of the frame width for every format.
  const fontSize = settings.subtitleSize * preset.scale * width / 1080;
  const words = useMemo(() => demoText.split(' '), []);
  const karaoke = settings.subtitleStyle === 'Dynamic';
  // Karaoke words light up one by one, as \\k does in the rendered video; reduced motion keeps a still frame.
  useEffect(() => {
    if (!karaoke || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setSpoken(value => value >= words.length ? 0 : value + 1), 450);
    return () => window.clearInterval(timer);
  }, [karaoke, words.length]);
  let counted = 0;
  const painted = words.map((word, index) => {
    const color = tokens(word)[0] === demoAccent ? accent : karaoke && index >= spoken ? preset.upcoming : multi ? colors[Math.floor(counted / every) % colors.length] : mainColor;
    if (/[\p{L}\p{N}]/u.test(word)) counted++;
    return <span key={index} style={{ color }}>{word} </span>;
  });
  // The renderer shrinks a caption whose longest word would not fit between the side margins; the preview does the same.
  const longest = Math.max(...words.map(word => word.length));
  const shown = Math.min(fontSize, width * .82 / Math.max(1, longest * .68));
  const outline = Math.max(1, preset.outline * width / 1080), shadow = preset.shadow * width / 1080;
  const position: CSSProperties = y !== null ? { bottom: `${100 - y}%` } : settings.subtitlePosition === 'top' ? { top: '18%' } : settings.subtitlePosition === 'center' ? { top: '50%', transform: 'translateY(-50%)' } : { bottom: '18%' };
  const aspect = settings.format === '9:16' ? '9 / 16' : settings.format === '1:1' ? '1 / 1' : '16 / 9';

  return <section className="panel ai-subtitles" aria-labelledby="ai-subtitles-title">
    <div className="ai-section-heading"><h2 id="ai-subtitles-title">Субтитры</h2><label className="ai-checkbox"><input type="checkbox" checked={settings.subtitles} onChange={event => set({ subtitles: event.target.checked })} />Показывать субтитры</label></div>
    <p className="ai-note">Шрифт, цвета и высота меняются вручную — без запросов к AI и без списания токенов. Предпросмотр обновляется сразу.</p>
    <div className="ai-subtitles-layout">
      <div className="ai-subtitles-controls" aria-disabled={!settings.subtitles}>
        <fieldset className="ai-subtitle-styles"><legend>Стиль</legend>{Object.entries(presets).map(([value, item]) => <button key={value} type="button" aria-pressed={settings.subtitleStyle === value} onClick={() => set({ subtitleStyle: value })}>{item.label}</button>)}</fieldset>
        <fieldset className="ai-subtitle-fonts"><legend>Шрифт</legend>{subtitleFonts.map(item => <button key={item.id} type="button" aria-pressed={font.id === item.id} style={{ fontFamily: `'${item.family}', Manrope, sans-serif` }} onClick={() => set({ subtitleFont: item.id })}>{item.label}<small>Аа Бб 123</small></button>)}</fieldset>
        <label>Размер · {settings.subtitleSize}<input type="range" min={24} max={96} value={settings.subtitleSize} onChange={event => set({ subtitleSize: Number(event.target.value) })} /></label>
        <fieldset className="ai-subtitle-colors"><legend>Цвет</legend>
          <div className="ai-subtitle-mode" role="group" aria-label="Режим цвета"><button type="button" aria-pressed={!multi} onClick={() => set({ subtitleColors: [] })}>Один цвет</button><button type="button" aria-pressed={multi} onClick={() => set({ subtitleColors: multi ? colors : [mainColor, mainColor.toLowerCase() === '#ffdf00' ? '#ffffff' : '#ffdf00'] })}>Разноцветные</button></div>
          {!multi ? <div className="ai-subtitle-row"><label>Цвет текста<input type="color" value={mainColor} onChange={event => set({ subtitleColor: event.target.value })} /></label>{settings.subtitleColor && <button type="button" className="text-link" onClick={() => set({ subtitleColor: '' })}>Цвет стиля</button>}</div>
            : <><div className="ai-subtitle-row">{colors.map((color, index) => <label key={index} className="ai-subtitle-swatch">Цвет {index + 1}<input type="color" value={color} onChange={event => set({ subtitleColors: colors.map((item, at) => at === index ? event.target.value : item) })} />{colors.length > 2 && <button type="button" aria-label={`Убрать цвет ${index + 1}`} onClick={() => set({ subtitleColors: colors.filter((_, at) => at !== index) })}>×</button>}</label>)}{colors.length < 4 && <button type="button" className="button outline" onClick={() => set({ subtitleColors: [...colors, '#ff4d6d'] })}>+ цвет</button>}</div>
              <div className="ai-subtitle-palettes" aria-label="Готовые сочетания">{palettes.map(palette => <button key={palette.join()} type="button" aria-label={`Сочетание ${palette.join(', ')}`} onClick={() => set({ subtitleColors: palette })}>{palette.map(color => <i key={color} style={{ background: color }} />)}</button>)}</div>
              <label>Менять цвет каждые {every} {every === 1 ? 'слово' : 'слова'}<input type="range" min={1} max={4} value={every} onChange={event => set({ subtitleColorEvery: Number(event.target.value) })} /></label></>}
          <div className="ai-subtitle-row"><label>Ключевые слова<input type="color" value={accent} onChange={event => set({ subtitleAccentColor: event.target.value })} /></label><span className="ai-note">Слова-акценты, которые выбрал AI{settings.keywords?.length ? `: ${settings.keywords.slice(0, 4).join(', ')}` : ''}.</span></div>
        </fieldset>
        <fieldset className="ai-subtitle-height"><legend>Высота</legend>
          <div className="ai-subtitle-mode" role="group" aria-label="Быстрое положение">{(['top', 'center', 'bottom'] as const).map(value => <button key={value} type="button" aria-pressed={y === null && settings.subtitlePosition === value} onClick={() => set({ subtitlePosition: value, subtitleY: null })}>{value === 'top' ? 'Сверху' : value === 'center' ? 'По центру' : 'Снизу'}</button>)}</div>
          <label>Точная высота · {y === null ? 'по кнопке выше' : `${Math.round(y)}% от верха`}<input type="range" min={8} max={95} value={y ?? presetY[settings.subtitlePosition]} onChange={event => set({ subtitleY: Number(event.target.value) })} /></label>
        </fieldset>
      </div>
      <div className="ai-subtitles-preview">
        <div ref={stage} className="ai-subtitle-stage" style={{ aspectRatio: aspect }} aria-label="Предпросмотр субтитров">
          <img src={backdrops[backdrop].src} alt="" aria-hidden="true" />
          {settings.subtitles && <p style={{ ...position, fontFamily: `'${font.family}', Manrope, sans-serif`, fontSize: `${Math.max(9, shown)}px`, WebkitTextStroke: `${outline * 2}px #101010`, textShadow: shadow ? `${shadow}px ${shadow}px 0 #00000070` : 'none' }}>{painted}</p>}
          {settings.format === '9:16' && <span className="ai-subtitle-guide" style={{ bottom: 0 }} aria-hidden="true" />}
        </div>
        <div className="ai-subtitle-mode" role="group" aria-label="Фон предпросмотра">{(Object.keys(backdrops) as (keyof typeof backdrops)[]).map(key => <button key={key} type="button" aria-pressed={backdrop === key} onClick={() => setBackdrop(key)}>{backdrops[key].label}</button>)}</div>
        <small className="ai-note">Демонстрационный фон и текст одинаковы для всех стилей. Слово «{demoAccent}» показывает цвет ключевых слов. Пунктир — зона, где TikTok и Reels показывают подпись и кнопки. Ваше видео не меняется.</small>
      </div>
    </div>
  </section>;
}
