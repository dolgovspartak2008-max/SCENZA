import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Logo } from './Icon';
import type { IconName } from './Icon';
import type { Project } from './model';
import { request } from './api';
import Overview from './Overview';
import Upload from './Upload';
import Editor from './Editor';
import { Clips, Publications, Settings } from './Library';
import './functional.css';

const navItems: { title: string; icon: IconName; path: string }[] = [
  { title: 'Обзор', icon: 'home', path: '/' },
  { title: 'Тренды', icon: 'trend', path: '/#trends' },
  { title: 'Мои проекты', icon: 'folder', path: '/#projects' },
  { title: 'Готовые клипы', icon: 'clip', path: '/clips' },
  { title: 'Публикации', icon: 'send', path: '/publications' },
];
export default function App() {
  const [route, setRoute] = useState(location.pathname + location.search + location.hash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const path = new URL(route, location.origin).pathname.replace(/^\/app(?=\/|$)/, '') || '/';
  const project = items.find((item) => path.replace(/\/$/, '') === `/projects/${item.id}`);
  const isUpload = path === '/upload';
  const isSettings = path === '/settings';
  const activeNav = isUpload || path.startsWith('/projects/') || route.includes('#projects') ? 'Мои проекты' : route.includes('#trends') ? 'Тренды' : path === '/clips' ? 'Готовые клипы' : path === '/publications' ? 'Публикации' : isSettings ? 'Настройки' : 'Обзор';
  const refresh = useCallback(async () => {
    try { const result = await request<{ projects: Project[] }>('/api/projects'); setItems(result.projects); setError(''); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить проекты.'); }
    finally { setLoading(false); }
  }, []);
  const notify = useCallback((message = 'Изменения сохранены') => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  function navigate(next: string) {
    next = next.startsWith('/app') ? next : `/app${next === '/' ? '' : next}`;
    if (next !== location.pathname + location.search + location.hash) history.pushState(null, '', next);
    setRoute(next); setMenuOpen(false); window.scrollTo({ top: 0 });
    requestAnimationFrame(() => { const target = next.split('#')[1]; if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' }); main.current?.focus({ preventScroll: true }); });
  }
  useEffect(() => {
    void refresh();
    const onPopState = () => { setRoute(location.pathname + location.search + location.hash); setMenuOpen(false); };
    const onFocus = () => { void refresh(); };
    const onResize = () => { if (window.innerWidth > 650) setMenuOpen(false); };
    window.addEventListener('popstate', onPopState); window.addEventListener('focus', onFocus); window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('popstate', onPopState); window.removeEventListener('focus', onFocus); window.removeEventListener('resize', onResize); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [refresh]);
  useEffect(() => {
    if (loading || path !== '/') return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [loading, path, refresh]);
  useEffect(() => { void refresh(); }, [path, refresh]);
  useEffect(() => { document.title = `${project?.title ?? (isUpload ? 'Добавить видео' : activeNav)} · SCENZA`; }, [project, isUpload, activeNav]);
  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
      if (event.key === 'Tab') {
        const elements = drawer.current?.querySelectorAll<HTMLElement>('a, button');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [menuOpen]);
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">К содержимому</a>
    {menuOpen && <button className="menu-backdrop" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
    <aside ref={drawer} className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Боковая панель">
      <div className="sidebar-brand"><a href="/app" className="brand" aria-label="SCENZA — на главную" onClick={(event) => { event.preventDefault(); navigate('/'); }}><Logo /></a><button className="icon-button close-menu" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }}><Icon name="close" /></button></div>
      <nav aria-label="Главная навигация">{navItems.map((item) => <a key={item.title} href={item.path === '/' ? '/app' : `/app${item.path}`} className={`nav-item ${activeNav === item.title ? 'active' : ''}`} aria-current={activeNav === item.title ? 'page' : undefined} title={item.title} onClick={(event) => { event.preventDefault(); navigate(item.path); }}><Icon name={item.icon} /><span>{item.title}</span></a>)}</nav>
      <div className="sidebar-bottom"><button className="telegram-link" title="Подключить Telegram-бота" onClick={() => navigate('/settings#telegram')}><Icon name="send" /><span>Telegram-бот<small>Подключение</small></span></button><a className={`nav-item ${isSettings ? 'active' : ''}`} href="/app/settings" title="Настройки" onClick={(event) => { event.preventDefault(); navigate('/settings'); }}><Icon name="settings" /><span>Настройки</span></a></div>
    </aside>
    <div className="workspace"><header className="app-header"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><nav className="breadcrumbs" aria-label="Хлебные крошки"><a href={isUpload || project ? '/app#projects' : '/app'} onClick={(event) => { event.preventDefault(); navigate(isUpload || project ? '/#projects' : '/'); }}>{activeNav}</a><span className="crumb-separator">/</span>{(isUpload || project) && <strong>{isUpload ? 'Добавить видео' : project?.title}</strong>}<span className="demo-label">Локальная студия</span></nav><button className="avatar" title="Открыть настройки" aria-label="Открыть настройки" onClick={() => navigate('/settings')}><img src="/assets/city.png" alt="" /></button></header>
      <main id="main-content" ref={main} tabIndex={-1} className={`main-content ${project ? 'editor-page' : ''}`}>
        {error && <div className="connection-error" role="alert"><Icon name="info" /><span>{error}</span><button className="button outline" onClick={() => void refresh()}>Повторить</button></div>}
        {loading ? <div className="loading-panel" role="status">Открываем локальную библиотеку…</div> : path === '/' ? <Overview navigate={navigate} showAll={route.includes('#projects')} items={items} /> : isUpload ? <Upload navigate={navigate} notify={notify} onProjectChange={() => void refresh()} /> : project ? <Editor key={project.id} project={project} navigate={navigate} notify={notify} onProjectChange={() => void refresh()} /> : path === '/clips' ? <Clips navigate={navigate} notify={notify} /> : path === '/publications' ? <Publications navigate={navigate} notify={notify} /> : isSettings ? <Settings notify={notify} /> : <div className="not-found"><Icon name="film" size={46} /><h1>Видео не найдено</h1><p>Откройте библиотеку или добавьте новый файл.</p><button className="button primary" onClick={() => navigate('/')}>Открыть обзор</button></div>}
      </main>
    </div><div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><Icon name="info" /><span>{toast}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setToast('')}><Icon name="close" size={18} /></button></>}</div>
  </div>;
}
