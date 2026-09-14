import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, title, closeLabel, className, children, restoreFocus }: { open: boolean; onClose: () => void; title: string; closeLabel: string; className?: string; children: ReactNode; restoreFocus?: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    returnFocus.current = restoreFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = overflow; returnFocus.current?.focus({ preventScroll: true }); };
  }, [open]);
  useEffect(() => {
    if (open) ref.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [open, title]);
  return <dialog ref={ref} className={cn('scenza-dialog', className)} aria-label={title} onCancel={(event) => { event.preventDefault(); closeRef.current(); }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, video[controls], [tabindex]')).filter(element => element.tabIndex >= 0 && !element.hasAttribute('disabled') && element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRef.current(); } }}><button type="button" className="scenza-dialog-close" aria-label={closeLabel} onClick={onClose}><X size={21} /></button>{children}</dialog>;
}
