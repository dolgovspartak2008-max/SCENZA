import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import './notifications.css';

export type NotificationItem = { id: string; kind: string; title: string; text: string; createdAt: string; link?: string; action?: string; unread: boolean };
type Feed = { items: NotificationItem[]; unread: number };

const plural = (count: number) => count % 10 === 1 && count % 100 !== 11 ? 'непрочитанное' : 'непрочитанных';
export const notificationDate = (value: string) => new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Shared feed: polls quietly, only while the tab is visible. */
export function useNotifications(enabled = true) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/notifications', { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error || 'Не удалось загрузить уведомления.');
      setFeed(body as Feed); setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить уведомления.'); }
    finally { setLoading(false); }
  }, []);
  const markRead = useCallback(async () => {
    setFeed(current => current && { unread: 0, items: current.items.map(item => ({ ...item, unread: false })) });
    await fetch('/api/notifications/read', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [enabled, load]);
  return { feed, error, loading, load, markRead };
}

export function NotificationList({ items, onOpen }: { items: NotificationItem[]; onOpen?: (item: NotificationItem) => void }) {
  if (!items.length) return <p className="scz-notify-empty">Здесь появятся пополнения токенов, готовые видео, ответы поддержки и действия администратора.</p>;
  return <ul className="scz-notify-list">{items.map(item => {
    const body = <><span className={`scz-notify-dot is-${item.kind}`} data-unread={item.unread} aria-hidden="true" /><span><strong>{item.title}</strong><span>{item.text}</span><time dateTime={item.createdAt}>{notificationDate(item.createdAt)}</time></span></>;
    return <li key={item.id} className={item.unread ? 'is-unread' : ''}>{onOpen && (item.link || item.action) ? <button type="button" onClick={() => onOpen(item)}>{body}</button> : <div>{body}</div>}</li>;
  })}</ul>;
}

export function NotificationBell({ onOpen, className = '' }: { onOpen?: (item: NotificationItem) => void; className?: string }) {
  const { feed, error, loading, load, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const unread = feed?.unread ?? 0;
  useEffect(() => {
    if (!open) return;
    void load();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, load]);
  return <div ref={root} className={`scz-notify ${className}`}>
    <button ref={button} type="button" className="scz-notify-bell" aria-label={unread ? `Уведомления: ${unread} ${plural(unread)}` : 'Уведомления'} title="Уведомления" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      <Bell size={19} aria-hidden="true" />{unread > 0 && <span className="scz-notify-count">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id={panelId} className="scz-notify-panel" aria-label="Уведомления">
      <header><div><h2>Уведомления <span className="scz-notify-live" aria-hidden="true" /></h2><p>{unread ? `${unread} ${plural(unread)}` : 'Нет непрочитанных'}</p></div>
        <div className="scz-notify-tools"><button type="button" aria-label="Обновить" title="Обновить" disabled={loading} onClick={() => void load()}><RefreshCw size={17} className={loading ? 'is-spinning' : ''} /></button><button type="button" aria-label="Отметить все прочитанными" title="Отметить все прочитанными" disabled={!unread} onClick={() => void markRead()}><CheckCheck size={18} /></button></div>
      </header>
      {error && <p className="scz-notify-error" role="alert">{error}</p>}
      {feed ? <NotificationList items={feed.items.slice(0, 20)} onOpen={item => { setOpen(false); onOpen?.(item); }} /> : !error && <p className="scz-notify-empty">Загружаем…</p>}
      <a className="scz-notify-all" href="/app/profile?tab=notifications" onClick={event => { if (!onOpen) return; event.preventDefault(); setOpen(false); onOpen({ id: 'all', kind: 'all', title: '', text: '', createdAt: '', unread: false, link: '/app/profile?tab=notifications' }); }}>Все уведомления</a>
    </section>}
  </div>;
}
