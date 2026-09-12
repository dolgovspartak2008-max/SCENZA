import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';

export function useMotionActivity<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { amount: 0.05 });
  const [reduced, setReduced] = useState(() => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(true);
  const [finePointer, setFinePointer] = useState(false);

  useEffect(() => {
    const pointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePointer = () => setFinePointer(pointer.matches);
    const updateMotion = () => setReduced(motionPreference.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    updatePointer();
    updateMotion();
    updateVisibility();
    pointer.addEventListener('change', updatePointer);
    motionPreference.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      pointer.removeEventListener('change', updatePointer);
      motionPreference.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  return { ref, active: inView && visible && !reduced, reduced, finePointer, visible, inView };
}
