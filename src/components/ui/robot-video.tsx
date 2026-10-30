import { useEffect, useRef, useState } from 'react';

// When the robot raises its hand in /videos/robot-hello.* (the wave), the greeting starts typing above its head.
const SPEAK_AT = 1.0;
const LETTER_MS = 55;
const PAUSE_AFTER_PUNCTUATION_MS = 380;

// A pre-rendered clip of the former 3D robot: it appears, waves once and stays on the last frame.
export function RobotVideo({ language = 'ru', greeting, start = true, onSettled }: { language?: 'ru' | 'en'; greeting: string; start?: boolean; onSettled?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const [reduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [speaking, setSpeaking] = useState(reduced);
  const [typed, setTyped] = useState(reduced ? Number.MAX_SAFE_INTEGER : 0);

  // Tell the page loader the hero is ready: the poster is a finished frame, so it never waits long for the video itself.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let done = false;
    const settle = () => { if (!done) { done = true; settled.current?.(); } };
    const timer = window.setTimeout(settle, 1200);
    element.addEventListener('loadeddata', settle, { once: true });
    element.addEventListener('error', settle, { once: true });
    if (reduced) settle();
    return () => window.clearTimeout(timer);
  }, [reduced]);

  // Play once, only after the loader has closed and while the robot is on screen; the last frame stays after it ends.
  useEffect(() => {
    const element = video.current;
    if (!element || reduced || !start) return;
    const speak = () => setSpeaking(true);
    const onTime = () => { if (element.currentTime >= SPEAK_AT) speak(); };
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('ended', speak);
    element.addEventListener('error', speak);
    const observer = new IntersectionObserver(([entry]) => {
      if (element.ended) return;
      if (entry.isIntersecting && !document.hidden) void element.play().catch(speak);
      else element.pause();
    }, { threshold: 0.05 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('ended', speak);
      element.removeEventListener('error', speak);
    };
  }, [reduced, start]);

  // Type the greeting letter by letter, with a short breath after "Привет!".
  useEffect(() => {
    if (!speaking || typed >= greeting.length) return;
    const previous = greeting[typed - 1];
    const delay = previous && '!.,?'.includes(previous) ? PAUSE_AFTER_PUNCTUATION_MS : LETTER_MS;
    const timer = window.setTimeout(() => setTyped(count => count + 1), typed === 0 ? 0 : delay);
    return () => window.clearTimeout(timer);
  }, [speaking, typed, greeting]);

  // Switching the language after the greeting has finished shows the new text at once instead of retyping it.
  const previousGreeting = useRef(greeting);
  useEffect(() => {
    if (previousGreeting.current === greeting) return;
    const finished = typed >= previousGreeting.current.length;
    previousGreeting.current = greeting;
    if (finished) setTyped(Number.MAX_SAFE_INTEGER);
  }, [greeting, typed]);

  const visibleText = greeting.slice(0, typed);
  const typing = speaking && typed < greeting.length;

  return <div className="scenza-hero-robot" data-ready="true">
    <div className="scenza-robot-spotlight" aria-hidden="true" />
    <div className="scenza-robot-scene">
      <video ref={video} className="scenza-robot-video" muted playsInline preload="auto" poster={reduced ? '/videos/robot-hello.webp' : '/videos/robot.webp'} aria-label={language === 'ru' ? 'Робот SCENZA машет рукой' : 'SCENZA robot waving'}>
        {!reduced && <>
          <source src="/videos/robot-hello.webm" type="video/webm" />
          <source src="/videos/robot-hello.mp4" type="video/mp4" />
        </>}
      </video>
    </div>
    <div className="scenza-robot-thought" data-visible={speaking} aria-hidden="true">
      <span className="scenza-robot-thought-dot" />
      <span className="scenza-robot-thought-dot" />
      <p className="scenza-robot-thought-bubble">
        {/* The full text keeps the bubble's size fixed while the letters appear inside it. */}
        <span className="scenza-robot-thought-sizer">{greeting}</span>
        <span className="scenza-robot-thought-text">{visibleText}<span className="scenza-robot-thought-caret" data-typing={typing} /></span>
      </p>
    </div>
    <p className="sr-only" aria-live="polite">{speaking ? greeting : ''}</p>
  </div>;
}
