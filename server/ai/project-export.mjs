// Editable project exports: FCP 7 XML (Premiere Pro, DaVinci Resolve), CMX 3600 EDL and SRT captions (CapCut and others).

const timeline = settings => settings.segments || [{ start: settings.start, end: settings.end }];
const escapeXml = value => String(value).replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);

export function frameRate(project) {
  const [top, bottom] = String(project.fps || '30').split('/').map(Number);
  const rate = bottom ? top / bottom : top;
  if (!Number.isFinite(rate) || rate < 10 || rate > 120) return { rate: 30, timebase: 30, ntsc: false };
  const timebase = Math.round(rate);
  return { rate, timebase, ntsc: Math.abs(rate - timebase) > .01 };
}

const timecode = (seconds, timebase) => {
  const frames = Math.max(0, Math.round(seconds * timebase));
  const part = [Math.floor(frames / (timebase * 3600)), Math.floor(frames / (timebase * 60)) % 60, Math.floor(frames / timebase) % 60, frames % timebase];
  return part.map(value => String(value).padStart(2, '0')).join(':');
};
const srtTime = seconds => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export function exportEdl(project, settings) {
  const { timebase } = frameRate(project), source = project.upload?.name || 'source.mp4';
  let record = 0;
  const events = timeline(settings).map((part, index) => {
    const length = part.end - part.start;
    const line = `${String(index + 1).padStart(3, '0')}  AX       B     C        ${timecode(part.start, timebase)} ${timecode(part.end, timebase)} ${timecode(record, timebase)} ${timecode(record + length, timebase)}\n* FROM CLIP NAME: ${source}\n`;
    record += length;
    return line;
  });
  return `TITLE: ${(project.title || 'SCENZA').replace(/[\r\n]/g, ' ').slice(0, 60)}\nFCM: NON-DROP FRAME\n\n${events.join('\n')}`;
}

export function exportXml(project, settings) {
  const { timebase, ntsc } = frameRate(project), source = project.upload?.name || 'source.mp4';
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const frames = seconds => Math.round(seconds * timebase), total = frames(project.duration || 0);
  const file = first => first
    ? `<file id="source">${rate}<name>${escapeXml(source)}</name><pathurl>file://localhost/${encodeURIComponent(source)}</pathurl><duration>${total}</duration><media><video><samplecharacteristics><width>${project.width || 1920}</width><height>${project.height || 1080}</height></samplecharacteristics></video>${project.hasAudio === false ? '' : '<audio><channelcount>2</channelcount></audio>'}</media></file>`
    : '<file id="source"/>';
  let record = 0;
  const items = timeline(settings).map((part, index) => {
    const start = record, end = record + frames(part.end - part.start);
    record = end;
    return { index, start, end, in: frames(part.start), out: frames(part.end) };
  });
  const clip = (item, kind) => `<clipitem id="${kind}-${item.index + 1}"><name>${escapeXml(source)}</name><duration>${total}</duration>${rate}<start>${item.start}</start><end>${item.end}</end><in>${item.in}</in><out>${item.out}</out>${file(kind === 'video' && item.index === 0)}${kind === 'audio' ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}</clipitem>`;
  const [width, height] = settings.format === '9:16' ? [1080, 1920] : settings.format === '1:1' ? [1080, 1080] : [1920, 1080];
  const audio = project.hasAudio === false ? '' : `<audio><track>${items.map(item => clip(item, 'audio')).join('')}</track></audio>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="scenza"><name>${escapeXml(project.title || 'SCENZA')}</name><duration>${record}</duration>${rate}<media><video><format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format><track>${items.map(item => clip(item, 'video')).join('')}</track></video>${audio}</media></sequence></xmeml>\n`;
}

export function exportSrt(project, settings) {
  const cues = [];
  let offset = 0;
  for (const part of timeline(settings)) {
    for (const segment of project.analysis?.segments || []) {
      const start = Math.max(segment.start, part.start), end = Math.min(segment.end, part.end);
      const text = String(segment.text || '').trim();
      if (end - start > .05 && text) cues.push({ start: offset + start - part.start, end: offset + end - part.start, text });
    }
    offset += part.end - part.start;
  }
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}

export const projectExports = {
  xml: { build: exportXml, mime: 'application/xml; charset=utf-8', extension: 'xml' },
  edl: { build: exportEdl, mime: 'text/plain; charset=utf-8', extension: 'edl' },
  srt: { build: exportSrt, mime: 'application/x-subrip; charset=utf-8', extension: 'srt' },
};
