import { memo } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useMotionActivity } from './use-motion-activity';
import './animations.css';

function FloatingPaths({ mirrored, active }: { mirrored?: boolean; active: boolean }) {
  return (
    <svg className={cn('scenza-floating-paths', mirrored && 'scenza-floating-paths-mirrored')} viewBox="0 0 1200 600" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <motion.path
          key={index}
          d={`M ${-150 - index * 20} ${470 + index * 17} C ${190 - index * 7} ${460 - index * 20}, ${140 + index * 8} ${75 - index * 15}, ${545 + index * 22} ${80 + index * 14} S ${1050 + index * 7} ${300 + index * 18}, ${1370 + index * 12} ${35 + index * 11}`}
          stroke="currentColor"
          strokeWidth={0.6 + index * 0.05}
          initial={false}
          animate={active ? { pathLength: [0.35, 0.65, 0.35], pathOffset: [0, 0.8, 0], opacity: [0.09, 0.25, 0.09] } : { pathLength: 0.6, pathOffset: 0, opacity: 0.16 }}
          transition={active ? { duration: 27 + index * 2, repeat: Infinity, ease: 'linear', delay: index * -1.5 } : { duration: 0 }}
        />
      ))}
    </svg>
  );
}

export const BackgroundPaths = memo(function BackgroundPaths({ children, className }: { children?: ReactNode; className?: string }) {
  const { ref, active } = useMotionActivity<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('scenza-background-paths', className)}>
      <div className="scenza-path-decoration" aria-hidden="true">
        <FloatingPaths active={active} />
        <FloatingPaths active={active} mirrored />
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
