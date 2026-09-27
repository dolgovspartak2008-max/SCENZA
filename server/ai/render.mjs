import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const styles = ['Minimal', 'Classic', 'Dynamic', 'Bold', 'Cinematic'];
const timeline = settings => settings.segments || [{ start: settings.start, end: settings.end }];
export const timelineDuration = settings => timeline(settings).reduce((total, segment) => total + segment.end - segment.start, 0);
// 'insert' pauses the clip at `start`, plays the banner for `duration` seconds, then resumes the clip.
export const MAX_INSERT_SECONDS = 30;
export const adTotalDuration = (ad, clipDuration) => clipDuration + (ad?.position === 'insert' ? ad.duration : 0);
export const AD_POSITIONS = ['auto','strip','top','bottom','center','final','insert','top-left','top-right','bottom-left','bottom-right'];
export const AD_FITS = ['contain','cover','stretch'];
// Placement controls let the client fine-tune the banner without asking AI (and spending requests):
// offsetX/offsetY shift it by % of the frame, fit controls aspect handling, fade softens appearance,
// background decides what fills the screen while the clip is paused ("color" = only the banner is visible).
export function normalizeAd(input, clipDuration) {
  const insert = input.position === 'insert';
  const duration = input.duration ?? Math.min(5, clipDuration);
  const ad = { position: 'auto', width: insert ? 100 : 45, height: insert ? 100 : 25, fill: false, start: Math.max(0, (clipDuration - duration) / 2), duration, opacity: 1, offsetX: 0, offsetY: 0, fade: 0, background: 'color', backgroundColor: '#000000', ...input };
  if (insert && input.start === undefined) ad.start = clipDuration / 2;
  if (ad.fit === undefined) ad.fit = ad.fill ? 'stretch' : 'contain';
  if (!Number.isFinite(clipDuration) || clipDuration <= 0 || !AD_POSITIONS.includes(ad.position)
    || !['width','height','start','duration','opacity','offsetX','offsetY','fade'].every(key => Number.isFinite(ad[key])) || typeof ad.fill !== 'boolean' || ad.width < 10 || ad.width > (insert ? 100 : 80) || ad.height < 10 || ad.height > 100 || ad.start < 0 || ad.start >= clipDuration || ad.duration <= 0
    || (insert ? ad.duration > MAX_INSERT_SECONDS : ad.duration > clipDuration || (ad.position !== 'final' && ad.start + ad.duration > clipDuration + .001)) || ad.opacity < 0 || ad.opacity > 1) throw fail('Проверьте размер, время и прозрачность рекламы: она должна помещаться в ролике.');
  if (Math.abs(ad.offsetX) > 50 || Math.abs(ad.offsetY) > 50 || ad.fade < 0 || ad.fade > 2 || ad.fade * 2 > ad.duration + .001 || !AD_FITS.includes(ad.fit) || !['color','blur'].includes(ad.background) || typeof ad.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(ad.backgroundColor)) throw fail('Проверьте сдвиг, появление и фон баннера.');
  ad.fill = ad.fit === 'stretch';
  return ad;
}
// Switching between a pause insert and an overlay resets geometry the patch does not set, like the editor does.
export function applyAdPatch(ad, patch, clipDuration) {
  const next = { ...ad, ...patch }, insert = next.position === 'insert';
  if ((ad.position === 'insert') !== insert) {
    if (patch.width === undefined) next.width = insert ? 100 : 45;
    if (patch.height === undefined) next.height = insert ? 100 : 25;
    if (patch.offsetX === undefined) next.offsetX = 0;
    if (patch.offsetY === undefined) next.offsetY = 0;
    if (!insert && patch.duration === undefined) next.duration = Math.min(5, clipDuration);
    if (patch.start === undefined) next.start = insert ? clipDuration / 2 : Math.max(0, (clipDuration - Math.min(next.duration, clipDuration)) / 2);
  }
  return normalizeAd(next, clipDuration);
}
export function normalizeSettings(input, duration) {
  const settings = { start: 0, end: Math.min(duration, 30), format: '9:16', cropX: 50, cropMode: 'smart', cropSmoothing: 0.7, muted: false, subtitles: true, subtitleStyle: 'Classic', subtitleSize: 54, subtitleColor: '', subtitlePosition: 'bottom', subtitleReplacements: [], keywords: [], musicId: '', musicVolume: 0.18, ...input };
  if (settings.segments !== undefined) {
    if (!Array.isArray(settings.segments) || !settings.segments.length || settings.segments.length > 12 || settings.segments.some(segment => !segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > duration)) throw fail('Проверьте границы сцен: от 1 до 12 частей в пределах видео.');
    settings.segments = settings.segments.map(({ start, end }) => ({ start, end }));
    settings.start = Math.min(...settings.segments.map(segment => segment.start));
    settings.end = Math.max(...settings.segments.map(segment => segment.end));
  }
  if (![duration, settings.start, settings.end].every(Number.isFinite) || duration <= 0 || settings.start < 0 || settings.end <= settings.start || settings.end > duration || timelineDuration(settings) > 120) throw fail('Выберите отрезок до 2 минут в пределах видео.');
  for (const [key, min, max] of [['cropX', 0, 100], ['cropSmoothing', 0, 1], ['subtitleSize', 24, 96], ['musicVolume', 0, 1]]) if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) throw fail('Проверьте настройки кадра, субтитров и музыки.');
  if (!['9:16', '1:1', '16:9'].includes(settings.format) || !['smart', 'manual'].includes(settings.cropMode) || !styles.includes(settings.subtitleStyle) || !['top', 'center', 'bottom'].includes(settings.subtitlePosition) || typeof settings.subtitles !== 'boolean' || typeof settings.muted !== 'boolean' || typeof settings.musicId !== 'string') throw fail('Некорректные настройки ролика.');
  if (!Array.isArray(settings.subtitleReplacements) || settings.subtitleReplacements.length > 30 || settings.subtitleReplacements.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['from','to'].includes(key)) || !['from','to'].every(key => Object.hasOwn(item,key) && typeof item[key] === 'string' && item[key].trim() && item[key].length <= 100))) throw fail('Проверьте замены субтитров: до 30 пар текста длиной до 100 символов.');
  settings.subtitleReplacements = settings.subtitleReplacements.map(({from,to})=>({from,to}));
  if (!Array.isArray(settings.keywords) || settings.keywords.length > 30 || settings.keywords.some(word => typeof word !== 'string' || !word.trim() || word.length > 100)) throw fail('Выберите до 30 слов или фраз для акцентов в субтитрах.');
  settings.keywords = settings.keywords.map(word => word.trim());
  if (settings.subtitleColor !== '' && (typeof settings.subtitleColor !== 'string' || !/^#[\da-f]{6}$/i.test(settings.subtitleColor))) throw fail('Цвет субтитров должен быть в формате #RRGGBB.');
  return Object.fromEntries(['start','end',...(settings.segments ? ['segments'] : []),'format','cropX','cropMode','cropSmoothing','muted','subtitles','subtitleStyle','subtitleSize','subtitleColor','subtitlePosition','subtitleReplacements','keywords','musicId','musicVolume'].map(key => [key, settings[key]]));
}

export function run(binary, args, { cwd, duration, onProgress, timeout = 3 * 3600000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '', stderr = '', pending = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk).slice(-8 * 1024 * 1024); pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) if (duration && /^out_time_us=\d+/.test(line)) onProgress?.(Math.min(99, Math.round(Number(line.split('=')[1]) / 1e6 / duration * 100)));
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', () => { clearTimeout(timer); reject(fail('Не удалось запустить обработку видео. Проверьте установку серверных программ.', 503)); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve({ stdout, stderr }); else reject(fail('Не удалось обработать видео. Проверьте файл и доступные ресурсы сервера.', 422)); });
  });
}
export const ff = (args, options = {}) => run(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', ...args], options);
export async function inspect(input) {
  const { stdout } = await run(ffprobe.path, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,avi,mpeg,mpegts,flv,asf,ogg', '-show_streams', '-show_format', '-of', 'json', input], { timeout: 30000 });
  const data = JSON.parse(stdout), video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const duration = Number(data.format?.duration || video?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 43200 || video.width > 8192 || video.height > 8192) throw fail('Нужен видеофайл до 12 часов с разрешением до 8192 пикселей.');
  return { duration, width: video.width, height: video.height, codec: video.codec_name, fps: video.avg_frame_rate, hasAudio: data.streams.some(s => s.codec_type === 'audio') };
}
const stamp = time => {
  const centiseconds = Math.max(0, Math.round(time * 100));
  return `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
};
const escapeAss = text => String(text).replaceAll('\\', '＼').replaceAll('{', '｛').replaceAll('}', '｝').replace(/\r?\n/g, '\\N').replace(/[\u0000-\u001f]/g, '');
function subtitleCues(segments, settings, maxChars) {
  const cues = [];
  for (const segment of segments) {
    const start = Math.max(segment.start, settings.start), end = Math.min(segment.end, settings.end);
    if (end <= start) continue;
    if (!segment.words?.length) {
      const text = segment.text.trim();
      if (text.length > maxChars) throw fail('Для длинной реплики нужны тайминги слов. Повторите распознавание речи.', 422);
      if (text) cues.push({ start, end, text });
      continue;
    }
    const words = segment.words.filter(word => word.end > start && word.start < end && word.word.trim()).map(word => ({ ...word, word: word.word.trim() }));
    let group = [], cueStart = start, characters = 0;
    const flush = () => {
      if (!group.length) return;
      const cueEnd = Math.min(end, group.at(-1).end);
      for (let from = cueStart; from < cueEnd; from += 3) {
        const to = Math.min(cueEnd, from + 3), visible = group.filter(word => word.end > from && word.start < to);
        if (visible.length) cues.push({ start: from, end: to, words: visible, text: visible.map(word => word.word).join(' ') });
      }
      group = []; characters = 0;
    };
    for (const word of words) {
      if (group.length && (group.length === 6 || characters + 1 + word.word.length > maxChars || Math.min(end, word.end) - cueStart > 3)) {
        flush(); cueStart = Math.max(start, word.start);
      }
      if (!group.length && Math.min(end, word.end) - cueStart > 3) cueStart = Math.max(start, word.start);
      characters += word.word.length + (group.length ? 1 : 0); group.push(word);
    }
    flush();
  }
  return cues;
}
export function buildSubtitles(segments, settings, width, height) {
  if (settings.segments) {
    let offset = 0;
    segments = settings.segments.flatMap(range => {
      const moved = segments.filter(segment => segment.end > range.start && segment.start < range.end).map(segment => ({
        ...segment, start: Math.max(segment.start, range.start) - range.start + offset, end: Math.min(segment.end, range.end) - range.start + offset,
        ...(segment.words ? { words: segment.words.filter(word => word.end > range.start && word.start < range.end).map(word => ({ ...word, start: Math.max(word.start, range.start) - range.start + offset, end: Math.min(word.end, range.end) - range.start + offset })) } : {}),
      }));
      offset += range.end - range.start;
      return moved;
    });
    settings = { ...settings, start: 0, end: offset, segments: undefined };
  }
  const preset = {
    Minimal: { font: 'Arial', scale: 1, color: '&H00FFFFFF', bold: 0, border: 1, outline: 1, shadow: 0 },
    Classic: { font: 'Arial', scale: 1, color: '&H00FFFFFF', bold: -1, border: 3, outline: 3, shadow: 0 },
    Dynamic: { font: 'Arial', scale: 1, color: '&H00FFFFFF', bold: -1, border: 1, outline: 3, shadow: 1 },
    Bold: { font: 'Arial', scale: 1.12, color: '&H0000DFFF', bold: -1, border: 1, outline: 4, shadow: 2 },
    Cinematic: { font: 'Georgia', scale: 1.05, color: '&H00E4EDFA', bold: 0, border: 1, outline: 2, shadow: 1 },
  }[settings.subtitleStyle];
  if (settings.subtitleColor) preset.color = `&H00${settings.subtitleColor.slice(5,7)}${settings.subtitleColor.slice(3,5)}${settings.subtitleColor.slice(1,3)}`;
  const fontSize = Math.round(settings.subtitleSize * width / 1080 * preset.scale);
  const align = { top: 8, center: 5, bottom: 2 }[settings.subtitlePosition];
  let result = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${preset.font},${fontSize},${preset.color},&H0000DFFF,&H00101010,&H90000000,${preset.bold},0,0,0,100,100,0,0,${preset.border},${preset.outline},${preset.shadow},${align},${Math.round(width * .09)},${Math.round(width * .15)},${Math.round(height * .18)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const maxChars = Math.max(16, Math.min(42, Math.floor(width * .76 / (fontSize * .7)) * 2));
  const replace = value => (settings.subtitleReplacements || []).reduce((text, {from,to})=>{
    const corrected=text.replaceAll(from,()=>to);
    if(corrected.length>10000)throw fail('Замены создают слишком длинную реплику. Сократите текст исправления.',422);
    return corrected;
  },value);
  const tokens = value => value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const phrases = (settings.keywords || []).map(tokens).filter(phrase => phrase.length);
  const accents = values => {
    const stream = values.flatMap((value, index) => tokens(value).map(token => ({ token, index }))), selected = new Set();
    for (const phrase of phrases) for (let i = 0; i <= stream.length - phrase.length; i++) {
      if (phrase.every((token, offset) => token === stream[i + offset].token)) for (let offset = 0; offset < phrase.length; offset++) selected.add(stream[i + offset].index);
    }
    return selected;
  };
  const emphasize = (value, accent) => accent ? `{\\c&H00DFFF&\\b1}${escapeAss(value)}{\\r}` : escapeAss(value);
  const corrected = segments.map(segment => {
    const words = segment.words?.map(word => ({ ...word, word: replace(word.word) }));
    const selected = words ? accents(words.map(word => word.word)) : null;
    return { ...segment, text: replace(segment.text), ...(words ? { words: words.map((word, index) => ({ ...word, accent: selected.has(index) })) } : {}) };
  });
  for (const segment of subtitleCues(corrected, settings, maxChars)) {
    const start = Math.max(segment.start, settings.start), end = Math.min(segment.end, settings.end);
    if (end <= start) continue;
    const words = segment.words?.filter(word => word.end > start && word.start < end);
    const values = words?.length ? words.map(word => word.word.trim()) : segment.text.trim().split(/(\s+)/);
    const selected = words?.length ? new Set(words.flatMap((word, index) => word.accent ? [index] : [])) : accents(values);
    let text = values.map((value, index) => emphasize(value, selected.has(index))).join(words?.length ? ' ' : '');
    if (settings.subtitleStyle === 'Dynamic' && words?.length) {
      const offset = time => Math.round((Math.max(start, Math.min(time, end)) - start) * 100);
      const lead = offset(words[0].start);
      text = (lead ? `{\\k${lead}} ` : '') + words.map((word, index) => {
        const until = words[index + 1]?.start ?? word.end;
        return `{\\k${Math.max(1, offset(until) - offset(word.start))}}${emphasize(word.word.trim(), word.accent)}`;
      }).join(' ');
    }
    result += `Dialogue: 0,${stamp(start - settings.start)},${stamp(end - settings.start)},Default,,0,0,0,,${text}\n`;
  }
  return result;
}
function smoothedCropPoints(tracking, settings) {
  const available = tracking.filter(p => p.time >= settings.start - 1 && p.time <= settings.end && Number.isFinite(p.x));
  const stride = Math.max(1, Math.ceil(available.length / 120));
  const points = available.filter((_, i) => i % stride === 0 || i === available.length - 1);
  if (!points.length) return [];
  let value = Math.max(0, Math.min(1, points[0].x));
  return points.map(p => { value += (Math.max(0, Math.min(1, p.x)) - value) * (1 - settings.cropSmoothing * .85); return { t: Math.max(0, p.time - settings.start), x: Number(value.toFixed(4)) }; });
}
export function cropExpression(tracking, settings) {
  if (settings.cropMode === 'manual') return `(iw-ow)*${settings.cropX / 100}`;
  const smooth=smoothedCropPoints(tracking,settings);
  if (!smooth.length) return `(iw-ow)*${settings.cropX / 100}`;
  // Independent ramps preserve interpolation without exceeding FFmpeg's expression nesting limit.
  let expression = String(smooth[0].x);
  for (let i = 0; i < smooth.length - 1; i++) {
    const a = smooth[i], b = smooth[i + 1];
    expression += `+(${b.x}-${a.x})*clip((t-${a.t})/${Math.max(.01,b.t-a.t)},0,1)`;
  }
  return `clip(iw*(${expression})-ow/2,0,iw-ow)`;
}
function reliableFaceCrop(analysis, settings, width, height) {
  if (!(analysis.width > 0 && analysis.height > 0)) return false;
  const points=(analysis.tracking||[]).filter(point=>point.time>=settings.start&&point.time<settings.end);
  // Sparse frontal-face samples cannot safely guide a crop across undetected shots.
  if(points.length<2||points[0].time-settings.start>.6||settings.end-points.at(-1).time>.6||points.some((point,i)=>i>0&&(point.time<=points[i-1].time||point.time-points[i-1].time>.6)))return false;
  const smooth=smoothedCropPoints(analysis.tracking,settings), ratio=(width/height)/(analysis.width/analysis.height), cropWidth=Math.min(1,ratio), cropHeight=Math.min(1,1/ratio);
  return points.every(point=>{
    if(!Number.isFinite(point.x)||!point.faces?.length)return false;
    const t=point.time-settings.start;
    let center=smooth[0].x;
    for(let i=0;i<smooth.length-1;i++)center+=(smooth[i+1].x-smooth[i].x)*Math.max(0,Math.min(1,(t-smooth[i].t)/Math.max(.01,smooth[i+1].t-smooth[i].t)));
    const left=Math.max(0,Math.min(1-cropWidth,center-cropWidth/2)),top=(1-cropHeight)/2;
    return point.faces.every(face=>['x','y','width','height'].every(key=>Number.isFinite(face[key]))&&face.width>0&&face.height>0&&face.x>=left+.01&&face.x+face.width<=left+cropWidth-.01&&face.y>=top+.01&&face.y+face.height<=top+cropHeight-.01);
  });
}
export function safeAdPosition(tracking, settings) {
  const occupancy = { top: 0, bottom: 0, center: 0 };
  const regions = { top: [.1, .35], bottom: [.53, .78], center: [.375, .625] };
  if (settings.subtitles) occupancy[settings.subtitlePosition] += 1000;
  for (const point of tracking) for (const face of point.faces || []) {
    if (!Number.isFinite(face.y) || !Number.isFinite(face.height)) continue;
    for (const [position, [top, bottom]] of Object.entries(regions)) occupancy[position] += Math.max(0, Math.min(bottom, face.y + face.height) - Math.max(top, face.y));
  }
  return ['top', 'bottom', 'center'].find(position => occupancy[position] === 0) || 'strip';
}
export async function render({ input, output, settings, analysis = {}, ad, music, preview = false, onProgress, signal }) {
  const scale = preview ? 540 : 1080;
  const [width, height] = settings.format === '9:16' ? [scale, Math.round(scale * 16 / 9)] : settings.format === '1:1' ? [scale, scale] : [Math.round(scale * 16 / 9), scale];
  const parts = timeline(settings), duration = timelineDuration(settings), cwd = path.dirname(output), subtitle = `${path.basename(output, '.mp4')}.ass`;
  const args = parts.flatMap(part => ['-ss', String(part.start), '-t', String(part.end - part.start), '-protocol_whitelist', 'file,pipe', '-i', input]);
  let index = parts.length, adIndex, musicIndex;
  if (ad?.file) { adIndex = index++; args.push(...(ad.kind === 'video' ? ['-stream_loop', '-1'] : ['-loop', '1']), '-protocol_whitelist', 'file,pipe', '-i', ad.file); }
  if (music) { musicIndex = index++; args.push('-stream_loop', '-1', '-i', music); }
  // Source-space face bounds cannot prove an overlay safe after cropping, or protect untracked objects.
  const position = ad?.position === 'auto' ? 'strip' : ad?.position;
  const strip = Boolean(ad?.file && position === 'strip');
  const pictureHeight = strip ? Math.floor(height * .75 / 2) * 2 : height;
  const voice = Boolean(analysis.hasAudio && !settings.muted);
  const chains = parts.map((part, i) => {
    const trackedFaces = reliableFaceCrop(analysis, { ...settings, ...part }, width, pictureHeight);
    const preserveFrame = strip || (settings.cropMode === 'smart' && !trackedFaces);
    let chain = preserveFrame
      ? `[${i}:v]setpts=PTS-STARTPTS,split[sharp${i}][soft${i}];[soft${i}]scale=${width}:${pictureHeight}:force_original_aspect_ratio=increase,crop=${width}:${pictureHeight},boxblur=20:2,eq=brightness=-0.12[background${i}];[sharp${i}]scale=${width}:${pictureHeight}:force_original_aspect_ratio=decrease[foreground${i}];[background${i}][foreground${i}]overlay=(W-w)/2:(H-h)/2,setsar=1[v${i}]`
      : `[${i}:v]setpts=PTS-STARTPTS,scale=${width}:${pictureHeight}:force_original_aspect_ratio=increase,crop=${width}:${pictureHeight}:'${cropExpression(analysis.tracking || [], { ...settings, ...part })}':(ih-oh)/2,setsar=1[v${i}]`;
    if (voice) chain += `;[${i}:a]atrim=duration=${part.end - part.start},asetpts=PTS-STARTPTS,apad=whole_dur=${part.end - part.start}[a${i}]`;
    return chain;
  });
  chains.push(`${parts.map((_, i) => `[v${i}]${voice ? `[a${i}]` : ''}`).join('')}concat=n=${parts.length}:v=1:a=${voice ? 1 : 0}[base]${voice ? '[speech]' : ''}`);
  let filters = chains.join(';');
  let video = 'base';
  if (settings.subtitles && analysis.segments?.length) {
    await fs.writeFile(path.join(cwd, subtitle), buildSubtitles(analysis.segments, settings, width, pictureHeight));
    filters += `;[${video}]ass=${subtitle}[captioned]`; video = 'captioned';
  }
  if (strip) { filters += `;[${video}]pad=${width}:${height}:0:0:color=0x101010[reserved]`; video = 'reserved'; }
  const insert = Boolean(ad?.file && position === 'insert');
  const total = insert ? adTotalDuration(ad, duration) : duration;
  const boxWidth = ad?.file ? Math.max(2, Math.round(width * ad.width / 100 / 2) * 2) : 0, boxHeight = ad?.file ? Math.max(2, Math.round(height * (ad.height ?? 25) / 100 / 2) * 2) : 0;
  const fit = ad?.fit || (ad?.fill ? 'stretch' : 'contain');
  const adBox = ad?.file ? (fit === 'stretch' ? `scale=${boxWidth}:${boxHeight}` : fit === 'cover' ? `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=increase,crop=${boxWidth}:${boxHeight}` : `scale=${boxWidth}:${boxHeight}:force_original_aspect_ratio=decrease`) + ',setsar=1' : '';
  const shiftX = ad?.offsetX ? `+W*${(ad.offsetX / 100).toFixed(4)}` : '', shiftY = ad?.offsetY ? `+H*${(ad.offsetY / 100).toFixed(4)}` : '';
  const fades = (from, length) => ad?.fade > 0 ? `,fade=t=in:st=${from}:d=${ad.fade}:alpha=1,fade=t=out:st=${Math.max(from, from + length - ad.fade)}:d=${ad.fade}:alpha=1` : '';
  let speech = 'speech';
  if (insert) {
    // Freeze the paused frame (blurred) behind the banner, then continue the clip from the same moment.
    const at = Math.min(ad.start, duration), gap = ad.duration, lead = at >= .05;
    filters += `;[${video}]split=3[insertpre][insertpost][insertfreeze]`;
    if (lead) filters += `;[insertpre]trim=end=${at},setpts=PTS-STARTPTS[pre]`; else filters += ';[insertpre]nullsink';
    filters += `;[insertpost]trim=start=${at},setpts=PTS-STARTPTS[post]`;
    if (ad.background === 'blur') filters += `;[insertfreeze]trim=start=${Math.max(0, at - .05)}:duration=0.1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${gap},trim=duration=${gap},boxblur=20:2,eq=brightness=-0.25,setpts=PTS-STARTPTS[freeze]`;
    else filters += `;[insertfreeze]nullsink;color=c=0x${(ad.backgroundColor || '#000000').slice(1)}:s=${width}x${height}:r=30:d=${gap},format=yuv420p,setsar=1[freeze]`;
    filters += `;[${adIndex}:v]setpts=PTS-STARTPTS,trim=duration=${gap},setpts=PTS-STARTPTS,${adBox},format=rgba,colorchannelmixer=aa=${ad.opacity}${fades(0, gap)}[insertad]`;
    filters += `;[freeze][insertad]overlay=(W-w)/2${shiftX}:(H-h)/2${shiftY}:eof_action=repeat,trim=duration=${gap},setsar=1[mid]`;
    filters += `;${lead ? '[pre]' : ''}[mid][post]concat=n=${lead ? 3 : 2}:v=1:a=0[inserted]`; video = 'inserted';
    if (voice) {
      const pcm = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
      filters += `;[speech]asplit=2[speechpre][speechpost]`;
      filters += lead ? `;[speechpre]atrim=end=${at},asetpts=PTS-STARTPTS,${pcm}[spre]` : ';[speechpre]anullsink';
      filters += `;[speechpost]atrim=start=${at},asetpts=PTS-STARTPTS,${pcm}[spost];anullsrc=r=48000:cl=stereo,atrim=duration=${gap},${pcm}[sgap]`;
      filters += `;${lead ? '[spre]' : ''}[sgap][spost]concat=n=${lead ? 3 : 2}:v=0:a=1[speechinserted]`; speech = 'speechinserted';
    }
  }
  if (ad?.file && !insert) {
    const y = strip ? `${pictureHeight}+(H-${pictureHeight}-h)/2` : position?.startsWith('top') ? 'H*0.1' : position === 'center' || position === 'final' ? '(H-h)/2' : 'H*0.78-h';
    const x = position?.endsWith('-left') ? 'W*0.02' : position?.endsWith('-right') ? 'W-w-W*0.02' : '(W-w)/2';
    const start = position === 'final' ? Math.max(0, duration-ad.duration) : ad.start;
    filters += `;[${adIndex}:v]setpts=PTS-STARTPTS+${start}/TB,${adBox},format=rgba,colorchannelmixer=aa=${ad.opacity}${fades(start, Math.min(duration, start + ad.duration) - start)}[ad];[${video}][ad]overlay=${x}${shiftX}:${y}${shiftY}:eof_action=pass:enable='gte(t,${start})*lt(t,${Math.min(duration,start+ad.duration)})'[advertised]`; video = 'advertised';
  }
  if (music) {
    filters += `;[${musicIndex}:a]atrim=duration=${total},asetpts=PTS-STARTPTS,volume=${settings.musicVolume}[music]`;
    if (voice) filters += `;[${speech}]asplit[voice][duck];[music][duck]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=700[quiet];[voice][quiet]amix=inputs=2:duration=first:normalize=0[audio]`;
    else filters += ';[music]anull[audio]';
  }
  args.push('-filter_complex', filters, '-map', `[${video}]`);
  if (music) args.push('-map', '[audio]', '-c:a', 'aac', '-b:a', '192k');
  else if (voice) args.push('-map', `[${speech}]`, '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  args.push('-t', String(total), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', preview ? '25' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  try { await ff(args, { cwd, duration: total, onProgress, signal }); }
  finally { await fs.rm(path.join(cwd, subtitle), { force: true }); }
}
