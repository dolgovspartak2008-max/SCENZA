import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './page-loader.css';

export function PageLoader({ open, onContinue, language = 'ru' }: { open: boolean; onContinue: () => void; language?: 'ru' | 'en' }) {
  const [mounted, setMounted] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const continueRef = useRef(onContinue);
  continueRef.current = onContinue;
  const ru = language === 'ru';

  useEffect(() => {
    if (open) {
      setMounted(true);
      const deadline = window.setTimeout(() => continueRef.current(), 20000);
      return () => clearTimeout(deadline);
    }
    const fade = window.setTimeout(() => setMounted(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : 450);
    return () => clearTimeout(fade);
  }, [open]);

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

  if (!open && !mounted) return null;
  return createPortal(<div ref={ref} className="scenza-page-loader" data-closing={!open} role="dialog" aria-modal={open || undefined} aria-label={ru ? 'SCENZA — подготовка' : 'SCENZA — getting ready'} aria-hidden={!open || undefined} tabIndex={-1} onKeyDown={event => {
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
        <div className="scenza-page-loader-timeline"><span /><span /><span /><span /><span /><span /><span /></div>
        <span className="scenza-page-loader-playhead" />
      </div>
      <span className="scenza-page-loader-brand">SCENZA</span>
      <p role="status">{ru ? 'Подготавливаем пространство' : 'Preparing your space'}</p>
    </div>
  </div>, document.body);
}
