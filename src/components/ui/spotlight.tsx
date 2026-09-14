import { useEffect, useRef } from 'react';
import { useMotionActivity } from './use-motion-activity';

export function Spotlight() {
  const { ref, active, finePointer } = useMotionActivity<HTMLDivElement>();
  const light = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = ref.current?.parentElement;
    const element = light.current;
    if (!parent || !element) return;
    element.style.opacity = '0';
    if (!active || !finePointer) return;
    let frame = 0;
    let inside = false;
    let lastTime = 0;
    let x = 0;
    let y = 0;
    let nextX = 0;
    let nextY = 0;
    const paint = (time: number) => {
      const elapsed = lastTime ? Math.min(time - lastTime, 40) : 16;
      lastTime = time;
      const follow = 1 - Math.exp(-elapsed / 35);
      x += (nextX - x) * follow;
      y += (nextY - y) * follow;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.hypot(nextX - x, nextY - y) > 0.1) frame = requestAnimationFrame(paint);
      else { frame = 0; lastTime = 0; }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      nextX = event.clientX;
      nextY = event.clientY;
      if (!inside) {
        inside = true;
        x = nextX;
        y = nextY;
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        element.style.opacity = '1';
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      inside = false;
      element.style.opacity = '0';
    };
    parent.addEventListener('pointermove', move, { passive: true });
    parent.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      parent.removeEventListener('pointermove', move);
      parent.removeEventListener('pointerleave', leave);
    };
  }, [active, finePointer, ref]);

  return <div ref={ref} className="scenza-spotlight-layer" aria-hidden="true">
    <div ref={light} className="scenza-cursor-spotlight" />
  </div>;
}
