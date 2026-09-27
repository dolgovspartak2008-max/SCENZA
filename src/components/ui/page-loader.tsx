import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './page-loader.css';

// While the page loads, the bar eases toward this point; it only reaches the end once loading has finished.
const LOADING_CEILING = 0.9;
const LOADING_MS = 9000;
const FINISH_MS = 520;
const FADE_MS = 450;
const REDUCED_FADE_MS = 150;

export function PageLoader({ open, onContinue, language = 'ru' }: { open: boolean; onContinue: () => void; language?: 'ru' | 'en' }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;
  const ru = language === 'ru';

  // A hard deadline so a stuck 3D scene can never keep people out of the site.
  useEffect(() => {
    if (!open) return;
    setMounted(true);
    setClosing(false);
    const deadline = window.setTimeout(() => continueRef.current(), 20000);
    return () => clearTimeout(deadline);
  }, [open]);

  // Transform animations run on the compositor, so the bar stays smooth even while the 3D scene loads on the main thread.
  useEffect(() => {
    if (!mounted) return;
    const fill = ref.current?.querySelector<HTMLElement>('.scenza-page-loader-fill');
    const playhead = ref.current?.querySelector<HTMLElement>('.scenza-page-loader-playhead');
    if (!fill || !playhead) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frames = (from: number, to: number) => [
      [{ transform: `scaleX(${from})` }, { transform: `scaleX(${to})` }],
      [{ transform: `translateX(${from * 100}%)` }, { transform: `translateX(${to * 100}%)` }],
    ] as const;
    const run = (from: number, to: number, options: KeyframeAnimationOptions) => {
      const [fillFrames, headFrames] = frames(from, to);
      return [fill.animate([...fillFrames], { fill: 'forwards', ...options }), playhead.animate([...headFrames], { fill: 'forwards', ...options })];
    };
    let timer = 0;

    if (open) {
      const animations = reduced ? run(0.5, 0.5, { duration: 0 }) : run(0, LOADING_CEILING, { duration: LOADING_MS, easing: 'cubic-bezier(.12, .72, .24, 1)' });
      return () => animations.forEach(animation => animation.pause());
    }

    const current = new DOMMatrixReadOnly(getComputedStyle(fill).transform).a;
    fill.getAnimations().forEach(animation => animation.cancel());
    playhead.getAnimations().forEach(animation => animation.cancel());
    const fade = () => {
      setClosing(true);
      timer = window.setTimeout(() => setMounted(false), reduced ? REDUCED_FADE_MS : FADE_MS);
    };
    const [finishing] = run(Number.isFinite(current) ? current : 0, 1, { duration: reduced ? 0 : FINISH_MS, easing: 'cubic-bezier(.22, .61, .36, 1)' });
    finishing.onfinish = () => { timer = window.setTimeout(fade, reduced ? 120 : 90); };
    return () => { finishing.onfinish = null; clearTimeout(timer); };
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = ref.current;
    const focusLoader = () => {
      if (!document.querySelector('dialog:modal') && !overlay?.contains(document.activeElement)) overlay?.focus({ preventScroll: true });
    };
    focusLoader();
    document.addEventListener('focusin', focusLoader);
    return () => {
      document.removeEventListener('focusin', focusLoader);
      if (overlay?.contains(document.activeElement) && !document.querySelector('dialog:modal')) previous?.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(<div ref={ref} className="scenza-page-loader" data-closing={closing} data-finishing={!open} role="dialog" aria-modal={open || undefined} aria-label={ru ? 'SCENZA — подготовка' : 'SCENZA — getting ready'} aria-hidden={!open || undefined} aria-busy={open} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); continueRef.current(); }
    if (event.key === 'Tab') {
      event.preventDefault();
      ref.current?.focus();
    }
  }}>
    <div className="scenza-page-loader-content">
      <div className="scenza-page-loader-edit" aria-hidden="true">
        <div className="scenza-page-loader-frames">
          <span className="scenza-page-loader-frame"><i /><i /><i /></span>
          <span className="scenza-page-loader-frame scenza-page-loader-frame-main"><svg viewBox="0 0 48 48" fill="none"><path d="m19 14 16 10-16 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg></span>
          <span className="scenza-page-loader-frame"><i /><i /><i /></span>
        </div>
        <div className="scenza-page-loader-timeline"><span /><span /><span /><span /><span /><span /><span /><b className="scenza-page-loader-fill" /></div>
        <span className="scenza-page-loader-playhead" />
      </div>
      <span className="scenza-page-loader-brand">SCENZA</span>
      <p role="status">{open ? (ru ? 'Подготавливаем пространство' : 'Preparing your space') : (ru ? 'Готово' : 'Ready')}</p>
    </div>
  </div>, document.body);
}
