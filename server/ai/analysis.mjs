import { candidateOverlap, validateCandidates } from './gemini.mjs';

export const analysisWindowSeconds = 1800;
function validateWindow(window) {
  if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end <= window.start || window.end - window.start > analysisWindowSeconds) throw new Error('Invalid analysis window');
}
export function analysisWindows(duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 43200) throw new Error('Invalid analysis duration');
  const windows = [];
  for (let start = 0; start < duration; start += analysisWindowSeconds - 120) {
    const end = Math.min(duration, start + analysisWindowSeconds);
    windows.push({ start, end });
    if (end === duration) break;
  }
  return windows;
}

export function windowMetadata(analysis, window) {
  validateWindow(window);
  const clip = entries => (entries || []).filter(entry => Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start && entry.end > window.start && entry.start < window.end)
    .map(entry => ({ ...entry, start: Math.max(entry.start, window.start) - window.start, end: Math.min(entry.end, window.end) - window.start }));
  return {
    transcript: clip(analysis.segments).map(segment => {
      if (!Array.isArray(segment.words)) return segment;
      const words = clip(segment.words);
      return { ...segment, words, text: words.length ? words.map(word => word.word).join(' ').trim() : segment.text };
    }),
    scenes: clip(analysis.scenes),
  };
}

export function mergeWindowCandidates(windows) {
  const candidates = windows.flatMap(window => {
    validateWindow(window);
    return validateCandidates({ candidates: window.candidates }, window.end - window.start)
      .map(candidate => ({ ...candidate, start: candidate.start + window.start, end: candidate.end + window.start, ...(candidate.segments ? { segments: candidate.segments.map(segment => ({ start: segment.start + window.start, end: segment.end + window.start })) } : {}) }));
  });
  const result = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.start - b.start)) {
    const duplicate = result.some(kept => {
      const overlap = candidateOverlap(kept, candidate);
      return overlap / (kept.duration + candidate.duration - overlap) >= 0.7;
    });
    if (!duplicate) result.push(candidate);
    if (result.length === 20) break;
  }
  return result;
}

export async function analyzeLongVideo({ duration, analysis, cache, analyze, summarize, select, persist, onProgress }) {
  const windows = analysisWindows(duration), results = [];
  const final = cache.find(entry => entry.kind === 'final' && entry.duration === duration && entry.version === 3);
  if (final) return { ...final.result, candidates: validateCandidates(final.result, duration) };
  const overview = [];
  if (summarize) for (const window of windows) {
    await onProgress?.({ phase: 'overview', completed: overview.length, total: windows.length });
    let saved = cache.find(entry => entry.start === window.start && entry.end === window.end && entry.overview && entry.version === 3);
    if (!saved) {
      const result = await summarize(window, windowMetadata(analysis, window));
      saved = { ...window, overview: result.overview, model: result.model, version: 3, ...(Array.isArray(result.candidates) ? { candidates: validateCandidates(result, window.end - window.start, { requireStory: true }) } : {}) };
      cache.push(saved);
      try { await persist(); } catch (error) { cache.pop(); throw error; }
    }
    overview.push({ ...window, summary: saved.overview.summary, events: saved.overview.events.map(event => ({ ...event, start: event.start + window.start, end: event.end + window.start })) });
  }
  for (const window of windows) {
    await onProgress?.({ completed: results.length, total: windows.length });
    let saved = cache.find(entry => entry.start === window.start && entry.end === window.end && Array.isArray(entry.candidates) && (!summarize || entry.version === 3));
    if (!saved) {
      const result = await analyze(window, windowMetadata(analysis, window), { sourceDuration: duration, windowStart: window.start, overview });
      saved = { ...window, candidates: validateCandidates(result, window.end - window.start, { requireStory: !!summarize }), model: result.model, ...(summarize ? { version: 3 } : {}) };
      cache.push(saved);
      try { await persist(); }
      catch (error) { cache.pop(); throw error; }
    } else validateCandidates(saved, window.end - window.start);
    results.push(saved);
  }
  await onProgress?.({ completed: results.length, total: windows.length });
  if (select) {
    const result = await select({ duration, candidates: mergeWindowCandidates(results), overview, transcript: analysis.segments || [] });
    validateCandidates(result, duration);
    cache.push({ kind: 'final', duration, version: 3, result });
    try { await persist(); } catch (error) { cache.pop(); throw error; }
    return result;
  }
  return { candidates: mergeWindowCandidates(results), model: [...new Set(results.map(result => result.model))].join(' / ') };
}
