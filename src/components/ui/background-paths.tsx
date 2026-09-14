import { memo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useMotionActivity } from './use-motion-activity';
import './animations.css';

function FloatingPaths({ position }: { position: number }) {
  return (
    <div className="scenza-path-layer">
      <svg className="scenza-floating-paths" viewBox="0 0 696 316" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {Array.from({ length: 36 }, (_, index) => (
          <path
            key={index}
            className="scenza-path-base"
            pathLength="1"
            strokeLinecap="round"
            stroke="currentColor"
            strokeWidth={0.5 + index * 0.03}
            strokeOpacity={0.1 + index * 0.03}
            style={{ '--path-duration': `${20 + index * 7 % 10}s`, '--path-delay': `${-index * .8 - (position < 0 ? 9 : 0)}s` } as CSSProperties}
            d={`M-${380 - index * 5 * position} -${189 + index * 6}C-${380 - index * 5 * position} -${189 + index * 6} -${312 - index * 5 * position} ${216 - index * 6} ${152 - index * 5 * position} ${343 - index * 6}C${616 - index * 5 * position} ${470 - index * 6} ${684 - index * 5 * position} ${875 - index * 6} ${684 - index * 5 * position} ${875 - index * 6}`}
          />
        ))}
      </svg>
    </div>
  );
}

export const BackgroundPaths = memo(function BackgroundPaths({ children, className }: { children?: ReactNode; className?: string }) {
  const { ref, active } = useMotionActivity<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('scenza-background-paths', className)} data-motion-active={active}>
      <div className="scenza-path-decoration" aria-hidden="true">
        <FloatingPaths position={1} />
        <FloatingPaths position={-1} />
      </div>
      {children}
    </div>
  );
});

export const AnimatedHeadline = memo(function AnimatedHeadline({ text, className }: { text: string; className?: string }) {
  const { ref, reduced, visible } = useMotionActivity<HTMLHeadingElement>();
  let letterIndex = 0;
  return (
    <h1 ref={ref} className={cn('scenza-animated-headline', className)} aria-label={text}>
      <span key={text} aria-hidden="true">
        {text.split(' ').map((word, index) => (
          <span key={`${index}-${word}`} className={cn('scenza-headline-word', word.includes('SCENZA') && 'scenza-headline-brand')}>
            {Array.from(word).map((letter, character) => {
              const delay = 0.18 + letterIndex++ * 0.035;
              return <motion.span key={character} className="scenza-headline-letter" initial={reduced ? false : { opacity: 0, y: '75%', rotateX: -85 }} animate={reduced || visible ? { opacity: 1, y: 0, rotateX: 0 } : undefined} transition={reduced ? { duration: 0 } : { duration: 0.85, ease: [0.16, 1, 0.3, 1], delay }}>{letter}</motion.span>;
            })}
            {index < text.split(' ').length - 1 && <span className="scenza-headline-space"> </span>}
          </span>
        ))}
      </span>
    </h1>
  );
});
