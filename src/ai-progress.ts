// Processing time is estimated only from measured runs (server/ai/api.mjs estimateRates) and the stage's own measured
// progress; with no data the studio says so instead of showing an invented number or percentage.
export type Phase = 'preprocess' | 'transcribe' | 'analyze' | 'clips' | 'render' | 'revise' | 'export' | 'package';
export type Rates = Partial<Record<Phase, { low: number; high: number; samples: number }>>;
export type Range = { low: number; high: number };

/** Steps that follow an upload: preparation, speech recognition, AI analysis and the first vertical clips. */
export const pipeline: Phase[] = ['preprocess', 'transcribe', 'analyze', 'clips'];
// Clip-level steps are measured per second of the finished clip; pipeline steps per second of the source video.
const perClip = new Set<Phase>(['render', 'revise', 'export', 'package']);
export const phaseNames: Record<Phase, string> = {
  preprocess: 'Подготовка видео', transcribe: 'Распознавание речи', analyze: 'Поиск лучших моментов', clips: 'Монтаж роликов',
  render: 'Монтаж ролика', revise: 'Применение правки', export: 'Экспорт MP4', package: 'Сборка пакета для монтажа',
};
const units = (phase: Phase, sourceSeconds: number, clipSeconds: number) => perClip.has(phase) ? clipSeconds : sourceSeconds;

/** Time for whole phases from the measured history, or null when any phase has no history yet. */
export function phasesTime(rates: Rates, phases: Phase[], sourceSeconds: number, clipSeconds = 0): Range | null {
  let low = 0, high = 0;
  for (const phase of phases) {
    const rate = rates[phase], amount = units(phase, sourceSeconds, clipSeconds);
    if (!rate || !(amount > 0)) return null;
    low += rate.low * amount; high += rate.high * amount;
  }
  return { low, high };
}

export type Remaining = { range: Range | null; delayed: boolean; live: boolean };
/**
 * Time left for the running phase and the phases after it. The running phase uses its own measured progress when the
 * worker reports one; otherwise the history minus the time already spent. `delayed` means the phase runs well past
 * the usual time, so the studio can explain that work continues.
 */
export function remaining({ phase, startedAt, progress, now, rates, sourceSeconds, clipSeconds = 0, next = [] }: { phase: Phase; startedAt?: string | null; progress?: number | null; now: number; rates: Rates; sourceSeconds: number; clipSeconds?: number; next?: Phase[] }): Remaining {
  const elapsed = Math.max(0, (now - (Date.parse(startedAt || '') || now)) / 1000);
  const rate = rates[phase], amount = units(phase, sourceSeconds, clipSeconds);
  const usual = rate && amount > 0 ? { low: rate.low * amount, high: rate.high * amount } : null;
  const measured = typeof progress === 'number' && Number.isFinite(progress) && progress >= 3 && progress < 100 && elapsed >= 10;
  let current: Range | null = null;
  if (measured) { const left = elapsed * (100 - progress) / progress; current = { low: left * .85, high: left * 1.2 }; }
  else if (usual) current = { low: Math.max(0, usual.low - elapsed), high: Math.max(0, usual.high - elapsed) };
  const delayed = !!usual && elapsed > usual.high * 1.3 + 30 && !measured;
  const rest = next.length ? phasesTime(rates, next, sourceSeconds, clipSeconds) : { low: 0, high: 0 };
  return { range: current && rest && !delayed ? { low: current.low + rest.low, high: current.high + rest.high } : null, delayed, live: measured };
}

const minutes = (count: number) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'минута' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'минуты' : 'минут'}`;
/** "меньше минуты", "около 3 минут"-style wording; a wide spread is shown as a range instead of a single number. */
export function formatRange({ low, high }: Range) {
  if (high < 60) return 'меньше минуты';
  const from = Math.max(1, Math.round(low / 60)), to = Math.max(from, Math.ceil(high / 60));
  return from === to ? minutes(from) : `${from}–${minutes(to)}`;
}
