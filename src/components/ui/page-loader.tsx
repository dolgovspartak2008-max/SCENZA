import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './page-loader.css';

// While the page is still loading, the bar creeps toward this point and never claims to be done.
const LOADING_CEILING = 0.9;
// Once loading has finished, the bar always runs to the very end before the overlay fades away.
const FINISH_MS = 520;
const FADE_MS = 450;
const REDUCED_FADE_MS = 150;

const easeOutCubic = (value: number) => 1 - (1 - value) ** 3;

export function PageLoader({ open, onContinue, language = 'ru' }: { open: boolean; onContinue: () => void; language?: 'ru' | 'en' }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
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

  // Progress is written straight to a CSS variable, so the bar animates without re-rendering React.
  useEffect(() => {
    if (!mounted) return;
    const element = ref.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const paint = (value: number) => {
      progressRef.current = value;
      element?.style.setProperty('--scenza-loader-progress', value.toFixed(4));
    };
    let frame = 0;
    let timer = 0;

    if (open) {
      let previous = 0;
      const creep = (time: number) => {
        const elapsed = previous ? Math.min(time - previous, 64) : 16;
        previous = time;
        const current = progressRef.current;
        paint(current + (LOADING_CEILING - current) * (1 - Math.exp(-elapsed / 1400)));
        frame = requestAnimationFrame(creep);
      };
      if (reduced) paint(0.5);
      else frame = requestAnimationFrame(creep);
      return () => cancelAnimationFrame(frame);
    }

    const fade = () => {
      setClosing(true);
      timer = window.setTimeout(() => setMounted(false), reduced ? REDUCED_FADE_MS : FADE_MS);
    };
    if (reduced) { paint(1); timer = window.setTimeout(fade, 120); }
    else {
      const from = progressRef.current;
      let start = 0;
      const finish = (time: number) => {
        start ||= time;
        const t = Math.min((time - start) / FINISH_MS, 1);
        paint(from + (1 - from) * easeOutCubic(t));
        if (t < 1) frame = requestAnimationFrame(finish);
        else timer = window.setTimeout(fade, 90);
      };
      frame = requestAnimationFrame(finish);
    }
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
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
