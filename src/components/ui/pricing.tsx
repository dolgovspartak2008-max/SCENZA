import { useEffect, useId, useRef } from 'react';
import type { PointerEvent } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { Button } from './button';
import { useMotionActivity } from './use-motion-activity';
import { demoPlans, monthlyEquivalent, annualDiscount } from '@/landing/plans';
import type { BillingPeriod, Language, PlanId } from '@/landing/plans';
import './animations.css';

export interface PricingCopy {
  demo: string;
  month: string;
  year: string;
  discount: string;
  recommended: string;
  perMonth: string;
  annualTotal: string;
  free: string;
  choose: string;
  featuresLabel: string;
  plans: Record<PlanId, { name: string; description: string; features: string[]; cta?: string }>;
}

interface PricingSectionProps {
  language: Language;
  copy: PricingCopy;
  period: BillingPeriod;
  selectedPlan: PlanId | null;
  onPick: (id: PlanId, period: BillingPeriod) => void;
  onPeriodChange: (period: BillingPeriod) => void;
  onSelect: (id: PlanId, period: BillingPeriod) => void;
}

const particles = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 37 + 9) % 100}%`,
  top: `${(index * 23 + 13) % 96}%`,
  delay: `${-index * 1.3}s`,
  duration: `${8 + index % 6}s`,
}));

export function PricingSection({ language, copy, period, selectedPlan, onPick, onPeriodChange, onSelect }: PricingSectionProps) {
  const { ref, active, reduced, finePointer } = useMotionActivity<HTMLDivElement>();
  const indicatorId = useId();
  const geometry = useRef<DOMRect | null>(null);
  const confettiCanvas = useRef<HTMLCanvasElement>(null);
  const confettiInstance = useRef<ReturnType<typeof confetti.create> | null>(null);
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const x = useSpring(cursorX, { stiffness: 65, damping: 24 });
  const y = useSpring(cursorY, { stiffness: 65, damping: 24 });
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const annualFormatter = new Intl.NumberFormat(locale, { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
  const discount = Math.min(...demoPlans.filter(plan => plan.monthly > 0).map(annualDiscount));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { geometry.current = element.getBoundingClientRect(); };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);

  useEffect(() => {
    if (confettiCanvas.current) confettiInstance.current = confetti.create(confettiCanvas.current, { resize: true, useWorker: false });
    return () => { confettiInstance.current?.reset(); confettiInstance.current = null; };
  }, []);

  useEffect(() => {
    if (!active || !finePointer) {
      cursorX.set(0);
      cursorY.set(0);
      x.jump(0);
      y.jump(0);
    }
    if (!active) confettiInstance.current?.reset();
  }, [active, finePointer, cursorX, cursorY, x, y]);

  function followPointer(event: PointerEvent<HTMLDivElement>) {
    if (!active || !finePointer || event.pointerType === 'touch' || !geometry.current) return;
    const rect = geometry.current;
    cursorX.set(((event.clientX - rect.left) / rect.width - 0.5) * 18);
    cursorY.set(((event.clientY - rect.top) / rect.height - 0.5) * 14);
  }

  function changePeriod(next: BillingPeriod) {
    if (next === period) return;
    onPeriodChange(next);
    if (next === 'year' && active && !reduced) {
      void confettiInstance.current?.({ particleCount: 34, spread: 46, startVelocity: 18, gravity: 1.05, scalar: 0.7, ticks: 90, colors: ['#45f0d6', '#87ffe7', '#239f91'], origin: { x: 0.5, y: 0.18 }, disableForReducedMotion: true });
    }
  }

  return (
    <div ref={ref} className="scenza-pricing" data-motion-active={active} onPointerEnter={() => { geometry.current = ref.current?.getBoundingClientRect() ?? null; }} onPointerMove={followPointer} onPointerLeave={() => { cursorX.set(0); cursorY.set(0); }}>
      <canvas ref={confettiCanvas} className="scenza-pricing-confetti" aria-hidden="true" />
      <motion.div className="scenza-pricing-particles" style={{ x, y }} aria-hidden="true">
        {particles.map((particle, index) => <span key={index} style={{ left: particle.left, top: particle.top, animationDelay: particle.delay, animationDuration: particle.duration }} />)}
      </motion.div>
      <p className="scenza-demo-pricing"><Sparkles size={14} aria-hidden="true" />{copy.demo}</p>
      <div className="scenza-period-switch" role="group" aria-label={`${copy.month} / ${copy.year}`}>
        {(['month', 'year'] as const).map((option) => <button key={option} type="button" aria-pressed={period === option} onClick={() => changePeriod(option)}>
          {period === option && <motion.span className="scenza-period-indicator" layoutId={`billing-${indicatorId}`} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 330, damping: 32 }} />}
          <span>{copy[option]}</span>{option === 'year' && discount > 0 && <span className="scenza-year-discount">{copy.discount.replace('{discount}', String(discount))}</span>}
        </button>)}
      </div>
      <div className="scenza-pricing-grid">
        {demoPlans.map((plan, index) => {
          const details = copy.plans[plan.id];
          const selected = selectedPlan === plan.id;
          return <motion.article key={plan.id} data-selected={selected} className={`scenza-price-card${selected ? ' scenza-price-card-selected' : ''}`} onClick={() => onPick(plan.id, plan.id === 'trial' ? 'month' : period)} initial={reduced ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : index * 0.09 }}>
            <div className="scenza-plan-heading"><h3>{details.name}</h3>{plan.recommended && <span className="scenza-recommended-label"><span />{copy.recommended}</span>}</div>
            <p className="scenza-plan-description">{details.description}</p>
            <div className="scenza-plan-price" aria-live="polite" aria-atomic="true">
              <NumberFlow value={monthlyEquivalent(plan, period)} locales={locale} format={{ maximumFractionDigits: 0 }} animated={active && !reduced} />
              <span className="scenza-price-currency">₽</span>
              <span className="scenza-price-period">{plan.id === 'trial' ? copy.free : copy.perMonth}</span>
            </div>
            <p className="scenza-annual-total">{plan.id !== 'trial' && period === 'year' ? `${copy.annualTotal}: ${annualFormatter.format(plan.annual)}` : '\u00a0'}</p>
            <ul className="scenza-plan-features" aria-label={copy.featuresLabel}>{details.features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
            <Button className="scenza-plan-cta" variant={selected ? 'default' : 'outline'} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(plan.id, plan.id === 'trial' ? 'month' : period); }}>{selected && <Check size={15} aria-hidden="true" />}{details.cta ?? copy.choose}<ArrowUpRight size={15} aria-hidden="true" /></Button>
          </motion.article>;
        })}
      </div>
    </div>
  );
}
