import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { request } from './api';
import { formatTime } from './model';
import type { Clip, LocalSettings, Navigate, Notify } from './model';

type LibraryClip = Clip & { projectUrl?: string; telegramAvailable?: boolean };
type Publication = { id: string; clipId: string; platform: string; caption: string; status: 'draft' | 'published'; createdAt: string };
const platforms = { youtube: { title: 'YouTube Shorts', url: 'https://studio.youtube.com/' }, tiktok: { title: 'TikTok', url: 'https://www.tiktok.com/tiktokstudio/upload' }, instagram: { title: 'Instagram Reels', url: 'https://www.instagram.com/' }, telegram: { title: 'Telegram', url: 'https://web.telegram.org/' } };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие.';

export function Clips({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { try { const result = await request<{ clips: LibraryClip[] }>('/api/clips'); setClips(result.clips); setError(''); } catch (problem) { setError(errorMessage(problem)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <><div className="page-intro library-heading"><div><h1>Готовые клипы</h1><p>Ваши экспортированные видео, готовые к публикации</p></div><button className="button outline" onClick={() => void load()}>Обновить</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}{loading ? <p className="loading-panel" role="status">Загружаем клипы…</p> : clips.length ? <div className="clips-grid">{clips.map((clip) => <article key={clip.id} className="clip-card panel"><video src={clip.url} poster={clip.image} controls playsInline preload="none" aria-label={`Готовый клип ${clip.title}`} /><div className="clip-info"><h2>{clip.title}</h2><p>{formatTime(clip.duration)} · {clip.format} · {new Date(clip.createdAt).toLocaleDateString('ru')}</p><div className="clip-actions"><a className="button primary" href={clip.url} download><Icon name="download" size={18} />Скачать MP4</a><button className="button outline" onClick={() => navigate(`/publications?clip=${encodeURIComponent(clip.id)}`)}>Публикация</button></div><div className="clip-secondary"><button className="text-link" onClick={() => navigate(clip.projectUrl ?? `/projects/${clip.projectId}`)}>Открыть исходник</button>{clip.subtitleUrl && <a className="text-link" href={clip.subtitleUrl} download onClick={() => notify('Файл субтитров SRT подготовлен')}>Субтитры SRT</a>}</div></div></article>)}</div> : <div className="empty-state"><Icon name="clip" size={38} /><h2>Первый клип впереди</h2><p>Откройте видео, выберите фрагмент и нажмите «Экспортировать».</p><button className="button primary" onClick={() => navigate('/ai')}>Открыть проекты</button></div>}</>;
}

export function Publications({ navigate, notify }: { navigate: Navigate; notify: Notify }) {
  const [clips, setClips] = useState<LibraryClip[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('clip') ?? '');
  const [platform, setPlatform] = useState<keyof typeof platforms>('youtube');
  const [caption, setCaption] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [clipResult, publicationResult, settingsResult] = await Promise.all([request<{ clips: LibraryClip[] }>('/api/clips'), request<{ publications: Publication[] }>('/api/publications'), request<{ settings: LocalSettings }>('/api/settings')]);
      setClips(clipResult.clips); setPublications(publicationResult.publications); setSelected((value) => value || clipResult.clips[0]?.id || ''); setConnected(settingsResult.settings.telegramConnected && !!settingsResult.settings.telegramChatId); setError('');
    } catch (problem) { setError(errorMessage(problem)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function prepare() {
    setBusy(true); setError('');
    try { await request('/api/publications', { method: 'POST', body: JSON.stringify({ clipId: selected, platform, caption }) }); await load(); notify('Публикация подготовлена. Клип и подпись сохранены.'); }
    catch (problem) { setError(errorMessage(problem)); } finally { setBusy(false); }
  }
  async function markPublished(id: string, status: Publication['status']) {
    setBusy(true);
    try { await request(`/api/publications/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await load(); notify(status === 'published' ? 'Вы отметили публикацию как размещённую' : 'Публикация возвращена в подготовленные'); }
    catch (problem) { setError(errorMessage(problem)); } finally { setBusy(false); }
  }
  async function sendTelegram(item: Publication) {
    setBusy(true); setError('');
    try { await request('/api/telegram/send', { method: 'POST', body: JSON.stringify({ publicationId: item.id, clipId: item.clipId, caption: item.caption }) }); await load(); notify('Видео отправлено в указанный Telegram-чат'); }
    catch (problem) { setError(errorMessage(problem)); } finally { setBusy(false); }
  }
  return <><div className="page-intro"><h1>Публикации</h1><p>Подготовьте клип и подпись для выбранной площадки</p></div>{error && <p className="field-error" role="alert">{error}</p>}{loading ? <p className="loading-panel">Загружаем публикации…</p> : !clips.length ? <div className="empty-state"><Icon name="send" size={36} /><h2>Сначала создайте клип</h2><p>После экспорта здесь можно подготовить публикацию или отправить видео в Telegram.</p><button className="button primary" onClick={() => navigate('/ai')}>Открыть проекты</button></div> : <>
    <form className="publication-form panel" onSubmit={(event) => { event.preventDefault(); void prepare(); }}><label>Клип<select value={selected} onChange={(event) => setSelected(event.target.value)} required>{clips.map((clip) => <option value={clip.id} key={clip.id}>{clip.title} · {formatTime(clip.duration)} · {clip.format}</option>)}</select></label><label>Площадка<select value={platform} onChange={(event) => setPlatform(event.target.value as keyof typeof platforms)}>{Object.entries(platforms).map(([id, item]) => <option key={id} value={id}>{item.title}</option>)}</select></label><label className="caption-label">Подпись<textarea rows={3} maxLength={platform === 'telegram' ? 1024 : 2200} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="О чём этот клип?" /></label><p className="publication-mode">{platform === 'telegram' ? connected && clips.find(clip => clip.id === selected)?.telegramAvailable !== false ? 'Бот подключён. Отправка запускается отдельной кнопкой у подготовленной публикации.' : 'Скачайте MP4 и откройте Telegram для ручной публикации.' : 'Ручная публикация: скачайте MP4, скопируйте подпись и загрузите видео на площадку. Автопубликация через аккаунт не подключена.'}</p><button className="button primary" disabled={busy || !selected}>{busy ? 'Сохраняем…' : 'Подготовить публикацию'}</button></form>
    <section className="publication-list"><h2>Подготовленные публикации</h2>{!publications.length && <p>Пока нет подготовленных публикаций.</p>}{publications.map((item) => {
      const clip = clips.find((value) => value.id === item.clipId); const target = platforms[item.platform as keyof typeof platforms];
      return <article className="publication-item panel" key={item.id}><div className="publication-item-header"><h3>{clip?.title ?? 'Клип'} <span>· {target?.title ?? item.platform}</span></h3><span className={`badge ${item.status === 'published' ? 'published-badge' : ''}`}>{item.status === 'published' ? 'Опубликовано' : 'Подготовлено'}</span></div><p className="publication-caption">{item.caption || 'Без подписи'}</p><div className="publication-actions">{clip && <a className="button outline" href={clip.url} download>Скачать MP4</a>}<button className="button outline" disabled={!item.caption} onClick={async () => { try { await navigator.clipboard.writeText(item.caption); notify('Подпись скопирована'); } catch { notify('Браузер не разрешил копирование. Выделите подпись и скопируйте вручную.'); } }}>Копировать подпись</button>{item.platform === 'telegram' ? connected && clip?.telegramAvailable !== false ? <button className="button primary" disabled={busy} onClick={() => void sendTelegram(item)}>Отправить в Telegram</button> : <a className="button primary" href="https://web.telegram.org/" target="_blank" rel="noreferrer">Открыть Telegram</a> : target && <a className="button primary" href={target.url} target="_blank" rel="noreferrer">Открыть {target.title}<Icon name="arrow" size={17} /></a>}<button className="text-link" disabled={busy} onClick={() => void markPublished(item.id, item.status === 'published' ? 'draft' : 'published')}>{item.status === 'published' ? 'Вернуть в подготовленные' : 'Отметить опубликованным'}</button></div></article>;
    })}</section></>}</>;
}

export function Settings({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { const result = await request<{ settings: LocalSettings }>('/api/settings'); setSettings(result.settings); setError(''); } catch (problem) { setError(errorMessage(problem)); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function save(body: object) {
    setBusy(true); setError('');
    try { const result = await request<{ settings: LocalSettings }>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }); setSettings(result.settings); notify('Настройки сохранены на этом компьютере'); }
    catch (problem) { setError(errorMessage(problem)); } finally { setBusy(false); }
  }
  return <><div className="page-intro"><h1>Настройки</h1><p>Локальная студия и подключения</p></div>{error && <div className="connection-error" role="alert"><span>{error}</span><button className="button outline" onClick={() => void load()}>Обновить</button></div>}{settings ? <div className="settings-layout"><section className="settings-panel panel"><h2>Экспорт в ручном редакторе</h2><form onSubmit={(event) => { event.preventDefault(); void save({ defaultFormat: settings.defaultFormat, quality: settings.quality }); }}><label>Формат нового клипа<select value={settings.defaultFormat} onChange={(event) => setSettings({ ...settings, defaultFormat: event.target.value as LocalSettings['defaultFormat'] })}><option>9:16</option><option>1:1</option><option>16:9</option></select></label><label>Разрешение<select value={settings.quality} onChange={(event) => setSettings({ ...settings, quality: event.target.value as LocalSettings['quality'] })}><option value="720p">720p · быстрее</option><option value="1080p">1080p · больше деталей</option></select></label><p>Эти параметры применяются к ручному редактору. В AI-студии формат выбирается у ролика, экспорт — 1080p. MP4 · H.264 · звук AAC.</p><button className="button primary" disabled={busy}>Сохранить параметры</button></form><div className="storage-info"><h3>Хранилище на компьютере</h3><p>{settings.storagePath}</p><span>{((settings.storageBytes ?? 0) / 1024 ** 2).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ занято</span></div></section>
    </div> : !error && <p className="loading-panel">Загружаем настройки…</p>}</>;
}
