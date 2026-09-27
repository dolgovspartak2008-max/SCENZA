import { useEffect, useRef, useState } from 'react';
import { animate, motion } from 'framer-motion';
import type { Language } from '@/landing/plans';
import './section-navigation.css';

// Wheel and touch scrolling stay native; animated jumps happen only from the navigation, links and arrow keys.
const SECTION_MOVE_MS = 480;

type Section = { id: string; label: string; element: HTMLElement; top: number; height: number };

export function SectionNavigation({ language, disabled = false }: { language: Language; disabled?: boolean }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState(0);
  const [moving, setMoving] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const navigate = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const main = document.getElementById('scenza-main');
    if (!main) return;
    setMoving(false);
    const desktop = matchMedia('(min-width: 1200px) and (hover: hover) and (pointer: fine)');
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let items: Section[] = [];
    let current = 0;
    let locked = false;
    let frame = 0;
    let scrollAnimation: ReturnType<typeof animate> | undefined;
    let reveals: Animation[] = [];
    const headerOffset = () => (document.querySelector('.scenza-header')?.getBoundingClientRect().height ?? 82) + 24;
    const blocked = () => disabled || !!document.querySelector('dialog[open], .scenza-mobile-nav, .scenza-page-loader');
    const measure = () => {
      for (const item of items) {
        const rect = item.element.getBoundingClientRect();
        item.top = rect.top + scrollY;
        item.height = rect.height;
      }
    };
    const sync = () => {
      frame = 0;
      if (locked || !items.length) return;
      const probe = scrollY + headerOffset() + Math.min((innerHeight - headerOffset()) * .22, 160);
      let index = 0;
      items.forEach((item, i) => { if (item.top <= probe) index = i; });
      if (scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 3) index = items.length - 1;
      current = index;
      setActive(index);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const refresh = () => { measure(); onScroll(); };
    const resizeObserver = new ResizeObserver(refresh);
    const discover = () => {
      resizeObserver.disconnect();
      items = Array.from(main.querySelectorAll<HTMLElement>(':scope > section[id]')).map(element => ({
        id: element.id,
        label: element.dataset.sectionLabel || element.querySelector('h2')?.textContent || element.id,
        element, top: 0, height: 0,
      }));
      measure();
      setSections(items);
      items.forEach(item => resizeObserver.observe(item.element));
      sync();
    };
    const cancel = () => {
      scrollAnimation?.stop();
      reveals.forEach(reveal => reveal.cancel());
      reveals = [];
      locked = false;
      setMoving(false);
      refresh();
    };
    const go = (index: number, focus = false, end = false, target?: HTMLElement) => {
      if (blocked() || locked || !items[index]) return;
      measure();
      const item = items[index];
      const offset = headerOffset();
      const position = () => {
        const top = target ? target.getBoundingClientRect().top + scrollY : item.element.getBoundingClientRect().top + scrollY;
        const destination = end && item.height > innerHeight - offset ? top + item.height - innerHeight : top - offset;
        return Math.max(0, Math.min(destination, document.documentElement.scrollHeight - innerHeight));
      };
      const from = scrollY;
      const destination = position();
      const previous = items[current];
      const direction = destination >= from ? 1 : -1;
      const hash = `#${target?.id ?? item.id}`;
      if (focus && location.hash !== hash) history.pushState(history.state, '', hash);
      current = index;
      setActive(index);
      if (focus) {
        const heading = target ?? item.element;
        heading.focus({ preventScroll: true });
      }
      if (preference.matches || Math.abs(destination - from) < 2) {
        window.scrollTo({ top: destination, behavior: 'instant' });
        return;
      }
      locked = true;
      setMoving(true);
      if (previous && previous !== item) {
        reveals.push(previous.element.animate([
          { opacity: 1, translate: '0 0' },
          { opacity: .2, translate: `0 ${-18 * direction}px`, offset: .65 },
          { opacity: 1, translate: '0 0' },
        ], { duration: SECTION_MOVE_MS, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
        reveals.push(item.element.animate([
          { opacity: .3, translate: `0 ${22 * direction}px` },
          { opacity: 1, translate: '0 0' },
        ], { duration: SECTION_MOVE_MS, easing: 'cubic-bezier(.22, 1, .36, 1)' }));
      }
      scrollAnimation = animate(from, destination, {
        duration: SECTION_MOVE_MS / 1000, ease: [.22, 1, .36, 1],
        onUpdate: value => window.scrollTo({ top: value, behavior: 'instant' }),
        onComplete: () => {
          window.scrollTo({ top: position(), behavior: 'instant' });
          locked = false;
          setMoving(false);
          reveals.forEach(reveal => reveal.cancel());
          reveals = [];
          measure();
        },
      });
    };
    navigate.current = index => go(index, true);
    const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), video, audio, [role="slider"], [role="listbox"], [role="tablist"]');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && locked) { cancel(); return; }
      if (event.defaultPrevented || blocked() || interactive(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const index = current + (event.key === 'ArrowDown' ? 1 : -1);
      if (!items[index]) return;
      event.preventDefault();
      if (!event.repeat) go(index, true);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || blocked()) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      if (!anchor || anchor.closest('.scenza-section-nav')) return;
      const target = document.getElementById(anchor.hash.slice(1));
      const index = items.findIndex(item => item.element === target || (target && item.element.contains(target)));
      if (index < 0 || !target) return;
      event.preventDefault();
      go(index, true, false, target);
    };
    const onPreference = () => { setReduced(preference.matches); cancel(); };
    const onPointer = () => { if (locked) cancel(); };
    discover();
    setReduced(preference.matches);
    const mutations = new MutationObserver(records => { if (records.some(record => record.target === main)) discover(); });
    mutations.observe(main, { childList: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', refresh);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('touchstart', onPointer, { passive: true });
    preference.addEventListener('change', onPreference);
    desktop.addEventListener('change', cancel);
    return () => {
      scrollAnimation?.stop();
      reveals.forEach(reveal => reveal.cancel());
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutations.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', refresh);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('touchstart', onPointer);
      preference.removeEventListener('change', onPreference);
      desktop.removeEventListener('change', cancel);
      navigate.current = () => {};
    };
  }, [language, disabled]);

  if (!sections.length) return null;
  const number = (index: number) => String(index + 1).padStart(2, '0');
  return <>
    <nav className="scenza-section-nav" aria-label={language === 'ru' ? 'Разделы страницы' : 'Page sections'} data-transitioning={moving} inert={disabled}>
      <div className="scenza-section-rail" aria-hidden="true">
        <motion.span className="scenza-section-fill" animate={{ scaleY: sections.length > 1 ? active / (sections.length - 1) : 0 }} transition={{ duration: reduced ? 0 : .55, ease: [.22, 1, .36, 1] }} />
        <motion.span className="scenza-section-signal" animate={{ y: active * 68 }} transition={{ duration: reduced ? 0 : .5, ease: [.22, 1, .36, 1] }} />
      </div>
      <ol>{sections.map((section, index) => <li key={section.id}>
        <a href={`#${section.id}`} aria-label={`${number(index)} — ${section.label}`} aria-current={active === index ? 'location' : undefined} onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); navigate.current(index);
        }}>
          <span className="scenza-section-number">{number(index)}</span>
          <span className="scenza-section-name">{section.label}</span>
        </a>
      </li>)}</ol>
    </nav>
    <div className="scenza-section-indicator" aria-label={`${sections[active]?.label ?? ''}, ${number(active)} / ${number(sections.length - 1)}`}>
      <span>{number(active)}</span><span aria-hidden="true">/</span><span>{number(sections.length - 1)}</span>
    </div>
  </>;
}
