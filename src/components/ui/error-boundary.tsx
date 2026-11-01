import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

// After a new deploy the browser may still hold the old page, whose code chunks no longer exist on the server.
// Such a failure is fixed by loading the page again; the timestamp stops a reload loop if the server is really broken.
const RELOAD_KEY = 'scenza.chunk-reload';
const isChunkError = (error: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|ChunkLoadError|MIME type/i.test(String((error as Error)?.message ?? error));
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* Without storage a single reload is still safe. */ }
  location.reload();
  return true;
}

type Props = { children: ReactNode; fallback?: (retry: () => void) => ReactNode };

/** Keeps one failed part from blanking the whole page: shows a message with "retry" instead of a black screen. */
export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkError(error) && reloadForNewVersion()) return;
    console.error('SCENZA: ошибка интерфейса', error, info.componentStack);
  }
  retry = () => { this.setState({ error: null }); };
  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return <div className="scenza-access-message" role="alert">
      <h1>Страница не загрузилась</h1>
      <p>Возможно, сайт только что обновился или прервалось соединение. Обновите страницу — всё сохранено.</p>
      <button type="button" onClick={() => location.reload()}>Обновить страницу</button>
      <a href="/">На главную</a>
    </div>;
  }
}
