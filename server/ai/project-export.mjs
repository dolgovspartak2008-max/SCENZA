// Editing pack exports: SRT captions and an FCP 7 XML timeline (Premiere Pro, DaVinci Resolve) for the files in the ZIP.

const timeline = settings => settings.segments || [{ start: settings.start, end: settings.end }];
const escapeXml = value => String(value).replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);

export function frameRate(project) {
  const [top, bottom] = String(project.fps || '30').split('/').map(Number);
  const rate = bottom ? top / bottom : top;
  if (!Number.isFinite(rate) || rate < 10 || rate > 120) return { rate: 30, timebase: 30, ntsc: false };
  const timebase = Math.round(rate);
  return { rate, timebase, ntsc: Math.abs(rate - timebase) > .01 };
}

const srtTime = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export function exportSrt(project, settings) {
  const cues = [];
  let offset = 0;
  for (const part of timeline(settings)) {
    for (const segment of project.analysis?.segments || []) {
      const start = Math.max(segment.start, part.start), end = Math.min(segment.end, part.end);
      const text = (settings.subtitleReplacements || []).reduce((value, { from, to }) => value.replaceAll(from, () => to), String(segment.text || '')).trim();
      if (end - start > .05 && text) cues.push({ start: offset + start - part.start, end: offset + end - part.start, text });
    }
    offset += part.end - part.start;
  }
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}


// Timeline for the editing pack: the clean clip (already cut to the story) plus the banner placed as the clip shows it.
// Media paths are relative to the unpacked ZIP, so Premiere Pro and DaVinci Resolve relink them by file name.
export function packXml({ project, settings, duration, ad, banner }) {
  const { timebase, ntsc } = frameRate(project);
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const frames = seconds => Math.max(0, Math.round(seconds * timebase));
  const [width, height] = settings.format === '9:16' ? [1080, 1920] : settings.format === '1:1' ? [1080, 1080] : [1920, 1080];
  const total = frames(duration);
  const media = (id, name, length, still) => `<file id="${id}">${rate}<name>${escapeXml(name)}</name><pathurl>${encodeURIComponent(name)}</pathurl><duration>${length}</duration><media><video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video>${still ? '' : '<audio><channelcount>2</channelcount></audio>'}</media></file>`;
  const seen = new Set();
  const file = (id, name, length, still) => { if (seen.has(id)) return `<file id="${id}"/>`; seen.add(id); return media(id, name, length, still); };
  const clip = (id, name, fileId, length, start, end, from, still = false, audio = false) => `<clipitem id="${id}"><name>${escapeXml(name)}</name><duration>${length}</duration>${rate}<start>${start}</start><end>${end}</end><in>${from}</in><out>${from + end - start}</out>${file(fileId, name, length, still)}${audio ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}</clipitem>`;
  const insert = ad && banner && ad.position === 'insert';
  const at = insert ? Math.min(frames(ad.start), total) : 0, gap = insert ? frames(ad.duration) : 0;
  const bannerLength = banner ? Math.max(gap, frames(ad.duration), 1) : 0;
  const video = [], overlay = [], audio = [];
  if (insert) {
    if (at > 0) video.push(clip('clip-1', '1-video.mp4', 'clip', total, 0, at, 0));
    video.push(clip('banner-1', banner.name, 'banner', bannerLength, at, at + gap, 0, banner.still));
    if (at < total) video.push(clip('clip-2', '1-video.mp4', 'clip', total, at + gap, total + gap, at));
    if (at > 0) audio.push(clip('audio-1', '1-video.mp4', 'clip', total, 0, at, 0, false, true));
    if (at < total) audio.push(clip('audio-2', '1-video.mp4', 'clip', total, at + gap, total + gap, at, false, true));
  } else {
    video.push(clip('clip-1', '1-video.mp4', 'clip', total, 0, total, 0));
    audio.push(clip('audio-1', '1-video.mp4', 'clip', total, 0, total, 0, false, true));
    if (ad && banner) {
      const start = ad.position === 'final' ? Math.max(0, total - frames(ad.duration)) : Math.min(frames(ad.start), total);
      overlay.push(clip('banner-1', banner.name, 'banner', bannerLength, start, Math.min(total, start + frames(ad.duration)), 0, banner.still));
    }
  }
  const tracks = [video, overlay].filter(items => items.length).map(items => `<track>${items.join('')}</track>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="scenza"><name>${escapeXml(project.title || 'SCENZA')}</name><duration>${total + gap}</duration>${rate}<media><video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${tracks}</video>${project.hasAudio === false ? '' : `<audio><track>${audio.join('')}</track></audio>`}</media></sequence></xmeml>\n`;
}
