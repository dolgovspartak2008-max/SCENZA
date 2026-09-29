// Approximate areas covered by app buttons and captions in 9:16 players, in % of the frame.
export type Platform = 'tiktok' | 'reels' | 'shorts';
type Zone = { top: number; bottom: number; side: { width: number; from: number; to: number } };
export const platforms: Record<Platform, { label: string; zone: Zone }> = {
  tiktok: { label: 'TikTok', zone: { top: 8, bottom: 20, side: { width: 14, from: 42, to: 82 } } },
  reels: { label: 'Reels', zone: { top: 12, bottom: 22, side: { width: 12, from: 50, to: 86 } } },
  shorts: { label: 'Shorts', zone: { top: 10, bottom: 18, side: { width: 14, from: 45, to: 84 } } },
};

type Box = { left: string; top: string; width: string; height: string };
const percent = (value: string) => Number.parseFloat(value) || 0;
/** Whether a banner box (in % of the frame) reaches under the platform buttons or captions. */
export function coversInterface(box: Box, platform: Platform) {
  const { zone } = platforms[platform], left = percent(box.left), top = percent(box.top), right = left + percent(box.width), bottom = top + percent(box.height);
  return top < zone.top || bottom > 100 - zone.bottom || right > 100 - zone.side.width && bottom > zone.side.from && top < zone.side.to;
}

export function SafeZones({ platform }: { platform: Platform | '' }) {
  if (!platform) return null;
  const { zone, label } = platforms[platform];
  return <div className="safe-zones" aria-hidden="true">
    <span style={{ top: 0, height: `${zone.top}%`, left: 0, right: 0 }}>{label}: верх интерфейса</span>
    <span style={{ bottom: 0, height: `${zone.bottom}%`, left: 0, right: 0 }}>Подпись и описание</span>
    <span style={{ top: `${zone.side.from}%`, height: `${zone.side.to - zone.side.from}%`, right: 0, width: `${zone.side.width}%` }}>Кнопки</span>
  </div>;
}

export function SafeZonePicker({ value, onChange }: { value: Platform | ''; onChange: (value: Platform | '') => void }) {
  return <label className="safe-zone-picker">Безопасные зоны<select value={value} onChange={event => onChange(event.target.value as Platform | '')}><option value="">Не показывать</option>{(Object.keys(platforms) as Platform[]).map(key => <option key={key} value={key}>{platforms[key].label}</option>)}</select></label>;
}
