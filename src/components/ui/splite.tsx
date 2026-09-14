import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Application } from '@splinetool/runtime';
import { RotateCcw } from 'lucide-react';
import { useMotionActivity } from './use-motion-activity';

const Spline = lazy(() => import('@splinetool/react-spline'));
const robotScene = 'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode';

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function RobotCanvas({ active, onReady }: { active: boolean; onReady: () => void }) {
  const [app, setApp] = useState<Application | null>(null);
  const onLoad = useCallback((application: Application) => {
    // React StrictMode can finish loading an already disposed Spline instance.
    if (!application.findObjectByName('Bot')) return;
    application.setBackgroundColor('transparent');
    application.setGlobalEvents(true);
    const light = application.findObjectByName('Point Light');
    if (light) light.color = '#b7f5e5';
    setApp(application);
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (!app) return;
    if (active) app.play();
    else app.stop();
  }, [active, app]);

  return <Spline scene={robotScene} onLoad={onLoad} className="scenza-robot-canvas" />;
}
export function SplineScene({ language = 'ru', onSettled }: { language?: 'ru' | 'en'; onSettled?: () => void }) {
  const { ref, active, reduced, inView, visible } = useMotionActivity<HTMLDivElement>();
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  const onError = useCallback(() => setFailed(true), []);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const ru = language === 'ru';
  const canLoad = !reduced || enabled;
  const retry = () => { setReady(false); setFailed(false); setAttempt(value => value + 1); };

  useEffect(() => {
    if (!ready && canLoad && !failed) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => settled.current?.());
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, canLoad, failed]);

  return <div ref={ref} className="scenza-hero-robot" data-ready={ready}>
    <div className="scenza-robot-spotlight" aria-hidden="true" />
    {canLoad ? <SceneBoundary key={attempt} onError={onError} fallback={
      <div className="scenza-robot-status" role="status">
        <p>{ru ? 'Не удалось загрузить 3D-робота' : 'Could not load the 3D robot'}</p>
        <button type="button" className="scenza-robot-control" onClick={retry}><RotateCcw size={16} />{ru ? 'Попробовать снова' : 'Try again'}</button>
      </div>
    }>
      {!ready && <div className="scenza-robot-status" role="status" aria-label={ru ? 'Подготовка сцены' : 'Preparing the scene'}><span className="scenza-robot-loader" aria-hidden="true" /></div>}
      <div className="scenza-robot-scene" role="img" aria-label={ru ? 'Интерактивный 3D-робот, который следит за курсором' : 'Interactive 3D robot that follows your cursor'}>
        <Suspense fallback={null}><RobotCanvas active={active || (enabled && inView && visible)} onReady={onReady} /></Suspense>
      </div>
    </SceneBoundary> : <div className="scenza-robot-status">
      <button type="button" className="scenza-robot-control" onClick={() => setEnabled(true)}>{ru ? 'Включить 3D-робота' : 'Enable the 3D robot'}</button>
      <p>{ru ? 'Анимация отключена по настройкам устройства' : 'Animation is off in your device settings'}</p>
    </div>}
  </div>;
}
