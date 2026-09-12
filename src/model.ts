export type Project = {
  id: string;
  title: string;
  image: string;
  alt: string;
  genre: string;
  status: string;
  tone: 'review' | 'draft' | 'ready';
  action: string;
  video?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  createdAt?: string;
  sourceCredit?: string;
  sourceUrl?: string;
  scenes?: Scene[];
  settings?: EditorSettings;
  waveform?: string;
};

export type Scene = { id: string; title: string; start: number; end: number; image: string };
export type Banner = { id: string; url: string; position: 'top' | 'bottom'; width: number; start: number; duration: number };
export type EditorSettings = {
  sceneId: string; start: number; end: number; format: '9:16' | '1:1' | '16:9';
  cropX: number; muted: boolean; subtitleText: string; subtitleStyle: 'classic' | 'accent' | 'minimal';
  banner: Banner | null;
};
export type Clip = { id: string; projectId: string; title: string; url: string; image: string; duration: number; createdAt: string; format: string; subtitleUrl?: string };
export type Job = { id: string; type: string; status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'; progress: number; message: string; projectId?: string; clipId?: string };
export type LocalSettings = { defaultFormat: '9:16' | '1:1' | '16:9'; quality: '720p' | '1080p'; telegramConnected: boolean; telegramUsername?: string; telegramChatId?: string; storagePath?: string; storageBytes?: number };

export const projects: Project[] = [
  { id: 'tihiy-gorod', title: 'Тихий город', image: '/assets/city.png', alt: 'Мужчина у освещённого окна в дождливом вечернем городе', genre: 'Драма', status: '3 клипа на проверке', tone: 'review', action: 'Открыть редактор' },
  { id: 'za-gorizontom', title: 'За горизонтом', image: '/assets/coast.png', alt: 'Женщина на берегу моря на фоне скал и вечернего неба', genre: 'Драма', status: 'Черновик', tone: 'draft', action: 'Продолжить' },
  { id: 'posledniy-reys', title: 'Последний рейс', image: '/assets/ship.png', alt: 'Человек на пристани перед большим кораблём в сумерках', genre: 'Триллер', status: 'Готов к экспорту', tone: 'ready', action: 'Открыть' },
  { id: 'do-rassveta', title: 'До рассвета', image: '/assets/dawn.png', alt: 'Девушка на крыше на фоне вечернего города', genre: 'Сериал', status: 'Черновик', tone: 'draft', action: 'Открыть' },
];

export function filterProjects(query: string, items: Project[] = projects) {
  const normalized = query.trim().toLocaleLowerCase('ru');
  return items.filter((project) => project.title.toLocaleLowerCase('ru').includes(normalized));
}

export function resolveProject(path: string) {
  return projects.find((project) => path.replace(/\/$/, '') === `/projects/${project.id}`);
}

export function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function validateVideo(file: { name: string; type: string; size: number }): string | null {
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) return 'Выберите видео в формате MP4, MOV, MKV или WebM.';
  if (file.size === 0) return 'Этот файл пустой. Выберите другое видео.';
  if (file.size > 2 * 1024 ** 3) return 'Размер файла превышает 2 ГБ. Выберите видео поменьше.';
  return null;
}

export type Navigate = (path: string) => void;
export type Notify = (message?: string) => void;
export const demoMessage = 'Функция появится после подключения обработки видео';
