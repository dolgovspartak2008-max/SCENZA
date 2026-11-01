import { Bookmark, Clapperboard, Ellipsis, EllipsisVertical, Heart, House, MessageCircle, MessageSquareText, Music2, Plus, Repeat2, Search, Send, Share2, SquarePlus, ThumbsDown, ThumbsUp, Tv, UserRound, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';

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

// Neutral template of each app's screen: real button positions, but no one's avatar, name or counters.
const Action = ({ icon, label }: { icon: ReactNode; label?: string }) => <span className="sz-action">{icon}{label !== undefined && <i className="sz-line" style={{ width: label }} />}</span>;
const Bar = ({ width }: { width: string }) => <i className="sz-line" style={{ width }} />;

function TikTok() {
  return <>
    <div className="sz-top"><Tv /><span className="sz-tabs"><b>Подписки</b><b className="is-active">Для вас</b></span><Search /></div>
    <div className="sz-side">
      <span className="sz-avatar"><UserRound /><em><Plus /></em></span>
      <Action icon={<Heart className="sz-filled" />} label="70%" />
      <Action icon={<MessageCircle className="sz-filled" />} label="60%" />
      <Action icon={<Bookmark className="sz-filled" />} label="55%" />
      <Action icon={<Share2 />} label="60%" />
      <span className="sz-disc"><Music2 /></span>
    </div>
    <div className="sz-bottom"><Bar width="34%" /><Bar width="72%" /><Bar width="52%" /><span className="sz-music"><Music2 /><Bar width="46%" /></span></div>
    <nav className="sz-nav"><House /><UsersRound /><span className="sz-create"><Plus /></span><MessageSquareText /><UserRound /></nav>
  </>;
}

function Shorts() {
  return <>
    <div className="sz-top sz-top-icons"><span className="sz-spacer" /><Search /><EllipsisVertical /></div>
    <div className="sz-side">
      <Action icon={<ThumbsUp className="sz-filled" />} label="70%" />
      <Action icon={<ThumbsDown className="sz-filled" />} label="80%" />
      <Action icon={<MessageSquareText className="sz-filled" />} label="60%" />
      <Action icon={<Share2 />} label="80%" />
      <Action icon={<Repeat2 />} label="70%" />
      <span className="sz-disc sz-square" />
    </div>
    <div className="sz-bottom"><span className="sz-channel"><span className="sz-avatar sz-small"><UserRound /></span><Bar width="34%" /><span className="sz-pill">Подписаться</span></span><Bar width="78%" /><Bar width="46%" /></div>
    <nav className="sz-nav"><House /><span className="sz-shorts-logo" /><span className="sz-create sz-circle"><Plus /></span><Clapperboard /><UserRound /></nav>
  </>;
}

function Reels() {
  return <>
    <div className="sz-top"><b className="sz-title">Reels</b><span className="sz-spacer" /><Search /><Ellipsis /></div>
    <div className="sz-side">
      <Action icon={<Heart />} label="70%" />
      <Action icon={<MessageCircle />} label="60%" />
      <Action icon={<Send />} label="60%" />
      <Action icon={<Ellipsis />} />
      <span className="sz-disc sz-square" />
    </div>
    <div className="sz-bottom"><span className="sz-channel"><span className="sz-avatar sz-small sz-ring"><UserRound /></span><Bar width="30%" /><span className="sz-pill sz-outline">Подписаться</span></span><Bar width="74%" /><span className="sz-music"><Music2 /><Bar width="40%" /></span></div>
    <nav className="sz-nav"><House /><Search /><SquarePlus /><Clapperboard /><UserRound /></nav>
  </>;
}

export function SafeZones({ platform }: { platform: Platform | '' }) {
  if (!platform) return null;
  return <div className={`safe-zones sz-${platform}`} aria-hidden="true">
    <span className="sz-shade sz-shade-top" /><span className="sz-shade sz-shade-bottom" />
    {platform === 'tiktok' ? <TikTok /> : platform === 'shorts' ? <Shorts /> : <Reels />}
  </div>;
}

export function SafeZonePicker({ value, onChange }: { value: Platform | ''; onChange: (value: Platform | '') => void }) {
  const options: [Platform | '', string][] = [['', 'Скрыть'], ...(Object.keys(platforms) as Platform[]).map((key): [Platform, string] => [key, platforms[key].label])];
  return <div className="safe-zone-picker" role="group" aria-label="Безопасные зоны: как ролик выглядит в приложении">
    <span>Интерфейс приложения</span>
    <div>{options.map(([key, label]) => <button key={key || 'none'} type="button" aria-pressed={value === key} className={value === key ? 'is-active' : ''} onClick={() => onChange(key)}>{label}</button>)}</div>
  </div>;
}
