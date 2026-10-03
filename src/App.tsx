import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, UserRound } from 'lucide-react';
import { Icon, Logo } from './Icon';
import type { IconName } from './Icon';
import type { Project } from './model';
import { request } from './api';
import AiStudio from './AiStudio';
import Support from './Support';
import { NotificationBell } from './Notifications';
import type { ProfileTab } from './Profile';
import './functional.css';

const Editor = lazy(() => import('./Editor'));
const Clips = lazy(() => import('./Library').then(module => ({ default: module.Clips })));
const Publications = lazy(() => import('./Library').then(module => ({ default: module.Publications })));
const Settings = lazy(() => import('./Library').then(module => ({ default: module.Settings })));
const Profile = lazy(() => import('./Profile'));

const navItems: { title: string; icon: IconName; path: string }[] = [
  { title: 'Главная', icon: 'home', path: '/' },
  { title: 'Мои проекты', icon: 'folder', path: '/ai' },
  { title: 'Готовые клипы', icon: 'clip', path: '/clips' },
  { title: 'Публикации', icon: 'send', path: '/publications' },
];
export default function App() {
  const [route, setRoute] = useState(location.pathname + location.search + location.hash);
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const currentPath = new URL(route, location.origin).pathname.replace(/^\/app(?=\/|$)/, '').replace(/\/$/, '') || '/';
  const path = currentPath === '/library' ? '/ai' : currentPath === '/upload/manual' ? '/upload' : currentPath;
  const project = items.find((item) => path.replace(/\/$/, '') === `/projects/${item.id}`);
  const isUpload = path === '/upload';
  const aiProjectId = /^\/ai\/([\w-]+)$/.exec(path)?.[1];
  const aiView = path === '/upload' || path === '/ai' || !!aiProjectId;
  const isSettings = path === '/settings';
  const isProfile = path === '/profile';
  const profileTab = (['referrals', 'notifications'].find(tab => new URL(route, location.origin).searchParams.get('tab') === tab) ?? 'overview') as ProfileTab;
  const needsLegacyProjects = path.startsWith('/projects/');
  const activeNav = aiView || path.startsWith('/projects/') ? 'Мои проекты' : path === '/clips' ? 'Готовые клипы' : path === '/publications' ? 'Публикации' : isSettings ? 'Настройки' : isProfile ? 'Профиль' : 'Главная';
  const nestedPage = isUpload || !!aiProjectId || path.startsWith('/projects/');
  const breadcrumbs = [
    { title: 'Главная', href: '/' },
    { title: 'Локальная студия', href: '/app' },
    ...(nestedPage ? [{ title: 'Мои проекты', href: '/app/ai' }] : []),
    ...(path !== '/' ? [{ title: isUpload ? 'Добавить видео' : project?.title ?? (aiProjectId ? 'Проект' : activeNav), href: `/app${path}` }] : []),
  ];
  const refresh = useCallback(async () => {
    if (!needsLegacyProjects) return;
    try { const result = await request<{ projects: Project[] }>('/api/projects'); setItems(result.projects); setError(''); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить проекты.'); }
    finally { setLoading(false); }
  }, [needsLegacyProjects]);
  const notify = useCallback((message = 'Изменения сохранены') => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  function navigate(next: string) {
    if (next.startsWith('/#')) next = '/ai';
    next = next.startsWith('/app') ? next : `/app${next === '/' ? '' : next}`;
    if (next !== location.pathname + location.search + location.hash) history.pushState(null, '', next);
    setRoute(next); setMenuOpen(false); window.scrollTo({ top: 0 });
    requestAnimationFrame(() => { const target = next.split('#')[1]; if (target) document.getElementById(target)?.scrollIntoView({ block: 'start' }); main.current?.focus({ preventScroll: true }); });
  }
  useEffect(() => {
    const onPopState = () => { setRoute(location.pathname + location.search + location.hash); setMenuOpen(false); };
    const onFocus = () => { void refresh(); };
    const onResize = () => { if (window.innerWidth > 650) setMenuOpen(false); };
    window.addEventListener('popstate', onPopState); window.addEventListener('focus', onFocus); window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('popstate', onPopState); window.removeEventListener('focus', onFocus); window.removeEventListener('resize', onResize); };
  }, [refresh]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (path === currentPath) return;
    const next = `/app${path}`;
    history.replaceState(null, '', next);
    setRoute(next);
  }, [currentPath, path]);
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
  return <div className={`app-shell ${path==='/'||aiView||isProfile?'studio-shell':''}`}>
    {supportOpen && <Support onClose={() => setSupportOpen(false)} />}
    <a className="skip-link" href="#main-content">К содержимому</a>
    {menuOpen && <button className="menu-backdrop" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }} />}
    <aside ref={drawer} className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Боковая панель">
      <div className="sidebar-brand"><a href="/app" className="brand" aria-label="SCENZA — на главную" onClick={(event) => { event.preventDefault(); navigate('/'); }}><Logo /></a><button className="icon-button close-menu" aria-label="Закрыть меню" onClick={() => { setMenuOpen(false); menuButton.current?.focus(); }}><Icon name="close" /></button></div>
      <nav aria-label="Главная навигация">{navItems.map((item) => <a key={item.title} href={item.path === '/' ? '/app' : `/app${item.path}`} className={`nav-item ${activeNav === item.title ? 'active' : ''}`} aria-current={activeNav === item.title ? 'page' : undefined} title={item.title} onClick={(event) => { event.preventDefault(); navigate(item.path); }}><Icon name={item.icon} /><span>{item.title}</span></a>)}</nav>
      <div className="sidebar-bottom"><a className={`nav-item ${isProfile ? 'active' : ''}`} href="/app/profile" title="Профиль" aria-current={isProfile ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate('/profile'); }}><UserRound size={21} aria-hidden="true" /><span>Профиль</span></a><a className="nav-item" href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer"><Icon name="send" /><span>Telegram-бот</span></a><a className={`nav-item ${isSettings ? 'active' : ''}`} href="/app/settings" title="Настройки" onClick={(event) => { event.preventDefault(); navigate('/settings'); }}><Icon name="settings" /><span>Настройки</span></a></div>
    </aside>
    <div className="workspace"><header className="app-header"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon name="menu" /></button><nav className="breadcrumbs" aria-label="Хлебные крошки">{breadcrumbs.map((crumb, index) => <Fragment key={crumb.href}>{index > 0 && <span className="crumb-separator" aria-hidden="true">/</span>}<a href={crumb.href} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined} title={crumb.title} onClick={(event) => { if (crumb.href === '/' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(crumb.href); }}>{crumb.title}</a></Fragment>)}</nav><NotificationBell className="header-notify" onOpen={item => { if (item.action === 'support') setSupportOpen(true); else if (item.link) navigate(item.link.replace(/^\/app/, '') || '/'); }} /><button className="icon-button" title="Поддержка" aria-label="Поддержка" onClick={() => setSupportOpen(true)}><MessageCircle size={20} aria-hidden="true" /></button><button className="avatar" title="Открыть профиль" aria-label="Открыть профиль" onClick={() => navigate('/profile')}><UserRound size={18} aria-hidden="true" /></button></header>
      <main id="main-content" ref={main} tabIndex={-1} className={`main-content ${project ? 'editor-page' : ''}`}>
        <Suspense fallback={<div className="loading-panel" role="status">Открываем раздел…</div>}>
        {aiView && <AiStudio key={path} projectId={aiProjectId} list={path === '/ai'} navigate={navigate} notify={notify} />}
        {needsLegacyProjects && error && <div className="connection-error" role="alert"><Icon name="info" /><span>{error}</span><button className="button outline" onClick={() => void refresh()}>Повторить</button></div>}
        {path === '/' && <AiStudio key="home" navigate={navigate} notify={notify} />}
        {!aiView && path !== '/' && (needsLegacyProjects && loading ? <div className="loading-panel" role="status">Открываем проект…</div> : project ? <Editor key={project.id} project={project} navigate={navigate} notify={notify} onProjectChange={() => void refresh()} /> : path === '/clips' ? <Clips navigate={navigate} notify={notify} /> : path === '/publications' ? <Publications navigate={navigate} notify={notify} /> : isSettings ? <Settings notify={notify} /> : isProfile ? <Profile tab={profileTab} navigate={navigate} notify={notify} /> : <div className="not-found"><Icon name="film" size={46} /><h1>Видео не найдено</h1><p>Откройте мои проекты или добавьте новый файл.</p><button className="button primary" onClick={() => navigate('/ai')}>Мои проекты</button></div>)}
        </Suspense>
      </main>
    </div><div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><Icon name="info" /><span>{toast}</span><button className="icon-button" aria-label="Закрыть уведомление" onClick={() => setToast('')}><Icon name="close" size={18} /></button></>}</div>
  </div>;
}
