import { useEffect, useRef } from 'react';

// A pre-rendered loop of the former 3D robot: same look, no WebGPU scene to download and run.
export function RobotVideo({ language = 'ru', onSettled }: { language?: 'ru' | 'en'; onSettled?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let done = false;
    const settle = () => { if (!done) { done = true; settled.current?.(); } };
    // The poster is already a finished frame, so the loader never waits long for the video itself.
    const timer = window.setTimeout(settle, 1200);
    element.addEventListener('loadeddata', settle, { once: true });
    element.addEventListener('error', settle, { once: true });
    if (reduced) { element.removeAttribute('autoplay'); element.pause(); settle(); return () => window.clearTimeout(timer); }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !document.hidden) void element.play().catch(() => undefined);
      else element.pause();
    }, { threshold: 0.05 });
    observer.observe(element);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, []);

  return <div className="scenza-hero-robot" data-ready="true">
    <div className="scenza-robot-spotlight" aria-hidden="true" />
    <div className="scenza-robot-scene">
      <video ref={video} className="scenza-robot-video" autoPlay muted loop playsInline preload="auto" poster="/videos/robot.webp" aria-label={language === 'ru' ? 'Робот SCENZA' : 'SCENZA robot'}>
        <source src="/videos/robot.webm" type="video/webm" />
        <source src="/videos/robot.mp4" type="video/mp4" />
      </video>
    </div>
  </div>;
}
