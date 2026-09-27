import { memo, useEffect, useRef } from 'react';
import { useMotionActivity } from './use-motion-activity';

export const ParticleBackground = memo(function ParticleBackground() {
  const { ref, active, finePointer } = useMotionActivity<HTMLCanvasElement>();
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; radius: number }[]>([]);
  const sizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let frameId = 0;
    let previousTime = 0;
    const particles = particlesRef.current;
    let mouse: { x: number; y: number } | null = null;
    const accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#45f0d6';

    // Lines are grouped into a few opacity buckets so each frame issues a handful of stroke calls instead of hundreds.
    const LINE_BUCKETS = 6;
    const buckets: number[][] = Array.from({ length: LINE_BUCKETS }, () => []);
    const draw = (delta: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = accent;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 0.8;
      const distanceLimit = width < 600 ? 125 : 175;
      const limitSquared = distanceLimit * distanceLimit;

      ctx.globalAlpha = 0.58;
      ctx.beginPath();
      for (const particle of particles) {
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        if (mouse) {
          const dx = particle.x - mouse.x;
          const dy = particle.y - mouse.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < 140) {
            const force = (1 - distance / 140) * 38 * delta;
            particle.x += dx / distance * force;
            particle.y += dy / distance * force;
          }
        }
        if (particle.x < 0 || particle.x > width) {
          particle.vx *= -1;
          particle.x = Math.max(0, Math.min(width, particle.x));
        }
        if (particle.y < 0 || particle.y > height) {
          particle.vy *= -1;
          particle.y = Math.max(0, Math.min(height, particle.y));
        }
        ctx.moveTo(particle.x + particle.radius, particle.y);
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      }
      ctx.fill();

      // Pair scan stays bounded by the 110-particle cap; squared distances avoid a sqrt for far pairs.
      for (const bucket of buckets) bucket.length = 0;
      for (let a = 0; a < particles.length; a++) {
        const first = particles[a];
        for (let b = a + 1; b < particles.length; b++) {
          const second = particles[b];
          const dx = first.x - second.x;
          const dy = first.y - second.y;
          const squared = dx * dx + dy * dy;
          if (squared >= limitSquared) continue;
          const strength = 1 - Math.sqrt(squared) / distanceLimit;
          buckets[Math.min(LINE_BUCKETS - 1, Math.floor(strength * LINE_BUCKETS))].push(a, b);
        }
      }
      buckets.forEach((bucket, index) => {
        if (!bucket.length) return;
        ctx.globalAlpha = (index + 0.5) / LINE_BUCKETS * 0.32;
        ctx.beginPath();
        for (let i = 0; i < bucket.length; i += 2) {
          const first = particles[bucket[i]];
          const second = particles[bucket[i + 1]];
          ctx.moveTo(first.x, first.y);
          ctx.lineTo(second.x, second.y);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      // A soft, full-screen background does not need retina resolution; 1.5x keeps it sharp at far less fill cost.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      if (nextWidth === width && nextHeight === height && canvas.width === Math.round(width * ratio)) return;
      const previousSize = sizeRef.current;
      if (previousSize.width && previousSize.height && previousSize.width !== nextWidth) {
        for (const particle of particles) {
          particle.x *= nextWidth / previousSize.width;
          particle.y *= nextHeight / previousSize.height;
        }
      }
      width = nextWidth;
      height = nextHeight;
      sizeRef.current = { width, height };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(width < 600 ? 44 : 110, Math.max(24, Math.round(width * height / 13000)));
      while (particles.length < count) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 7 + Math.random() * 9;
        particles.push({ x: Math.random() * width, y: Math.random() * height, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 0.8 + Math.random() * 0.7 });
      }
      particles.length = count;
      draw(0);
    };

    const animate = (time: number) => {
      if (previousTime === 0 || time - previousTime >= 1000 / 30) {
        draw(previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0);
        previousTime = time;
      }
      frameId = requestAnimationFrame(animate);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') mouse = { x: event.clientX, y: event.clientY };
    };
    const leave = () => { mouse = null; };
    const out = (event: PointerEvent) => { if (!event.relatedTarget) leave(); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (active) frameId = requestAnimationFrame(animate);
    if (active && finePointer) {
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerout', out);
      window.addEventListener('blur', leave);
    }
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerout', out);
      window.removeEventListener('blur', leave);
    };
  }, [active, finePointer, ref]);

  return <canvas ref={ref} className="scenza-particle-background" aria-hidden="true" data-motion-active={active} />;
});
