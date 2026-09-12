import type { CSSProperties } from 'react';

const paths = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  trend: 'M4 20v-5m5 5V9m5 11V5m5 15V2',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 2h18',
  clip: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm6 4 6 4-6 4Z',
  send: 'm22 2-7 20-4-9-9-4Zm0 0L11 13',
  settings: 'm10 2 4 0 1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Zm2 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm6 9 6 6 6-6',
  link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  play: 'm8 4 12 8-12 8Z',
  pause: 'M8 4v16M16 4v16',
  volume: 'm11 4-6 5H2v6h3l6 5Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  mute: 'm11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6',
  fullscreen: 'M3 8V3h5m8 0h5v5M3 16v5h5m13-5v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm5 12 5 5L20 7',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  film: 'M3 3h18v18H3ZM7 3v18M17 3v18M3 8h4m-4 8h4M17 8h4m-4 8h4M7 12h10',
  wave: 'M2 10v4m4-7v10m4-15v20m4-17v14m4-11v8m4-5v2',
  text: 'M4 6V3h16v3M12 3v18m-4 0h8',
  image: 'M3 3h18v18H3Zm0 14 6-6 5 5 3-3 4 4M15 7h.01',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 21, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}

export function Logo({ subtitle = 'Студия коротких видео' }: { subtitle?: string }) {
  return <><svg className="logo-mark" width="46" height="46" viewBox="0 0 48 48" aria-hidden="true"><path d="M4 15V5h11M33 5h11v10M44 33v10H33M15 43H4V33" stroke="currentColor" strokeWidth="3.5" fill="none"/><path d="m19 15 15 9-15 9z" fill="currentColor"/></svg><span className="logo-word">SCENZA<small>{subtitle}</small></span></>;
}
