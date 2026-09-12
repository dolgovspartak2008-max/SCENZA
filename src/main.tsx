import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './tailwind.css';
import { authRequest } from './landing/auth';
import type { Account } from './landing/auth';
import './landing/auth-legal.css';

const Studio = lazy(() => import('./App'));
const Landing = lazy(() => import('./landing/Landing'));
const LegalPage = lazy(() => import('./landing/Legal'));
function StudioAccess() {
  const [session, setSession] = useState<{ user: Account | null; localStudioAllowed?: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    authRequest<{ user: Account | null; localStudioAllowed?: boolean }>('session').then(result => { if (active) setSession(result); }).catch(error => {
      if (!active) return;
      // A still-running older local server has no accounts endpoint.
      if (error.status === 404) setSession({ user: null });
      else setError(error.message);
    });
    return () => { active = false; };
  }, []);
  if (error) return <div className="scenza-access-message"><h1>Не удалось проверить вход</h1><p role="alert">{error}</p><a href="/">Вернуться на сайт</a><button onClick={() => location.reload()}>Повторить</button></div>;
  if (!session) return <div className="scenza-loading" role="status">Проверяем доступ…</div>;
  if (!session.user && session.localStudioAllowed === false) return <Landing requestAccess />;
  if (session.user && !session.user.accessActive) return <Landing requestAccess />;
  return <>{session.user && <div className="scenza-session-strip"><span>{session.user.email || session.user.name} · Доступ до {new Date(session.user.accessUntil || session.user.trialEndsAt || '').toLocaleDateString('ru-RU')}</span><a href="/?account=1">Аккаунт и выход</a></div>}<Studio /></>;
}
function Site() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const sync = () => setPath(location.pathname); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  return <Suspense fallback={<div className="scenza-loading">SCENZA</div>}>{path.startsWith('/legal/') ? <LegalPage /> : path === '/' ? <Landing requestAccess={new URLSearchParams(location.search).has('account')} /> : local ? <StudioAccess /> : <Landing requestAccess />}</Suspense>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Site /></StrictMode>);
