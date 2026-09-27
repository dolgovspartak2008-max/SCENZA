import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import NumberFlow from '@number-flow/react';
import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { Button } from './button';
import { useMotionActivity } from './use-motion-activity';
import { demoPlans, planPrice, planSaving, tokenDiscount, tokenPrice } from '@/landing/plans';
import type { Language, PlanId } from '@/landing/plans';
import './animations.css';

export interface PricingCopy {
  demo: string;
  discount: string;
  recommended: string;
  perMonth: string;
  tokens: string;
  saving: string;
  free: string;
  choose: string;
  featuresLabel: string;
  plans: Record<PlanId, { name: string; description: string; features: string[]; cta?: string }>;
}

interface PricingSectionProps {
  language: Language;
  copy: PricingCopy;
  selectedPlan: PlanId | null;
  onPick: (id: PlanId) => void;
  onSelect: (id: PlanId) => void;
}

const particles = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 37 + 9) % 100}%`,
  top: `${(index * 23 + 13) % 96}%`,
  delay: `${-index * 1.3}s`,
  duration: `${8 + index % 6}s`,
}));

export function PricingSection({ language, copy, selectedPlan, onPick, onSelect }: PricingSectionProps) {
  const { ref, active, reduced, finePointer } = useMotionActivity<HTMLDivElement>();
  const geometry = useRef<DOMRect | null>(null);
  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const x = useSpring(cursorX, { stiffness: 65, damping: 24 });
  const y = useSpring(cursorY, { stiffness: 65, damping: 24 });
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: language === 'en' ? 'USD' : 'RUB', minimumFractionDigits: 0, maximumFractionDigits: language === 'en' ? 2 : 1 });

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
    if (!active || !finePointer) {
      cursorX.set(0);
      cursorY.set(0);
      x.jump(0);
      y.jump(0);
    }
  }, [active, finePointer, cursorX, cursorY, x, y]);

  function followPointer(event: PointerEvent<HTMLDivElement>) {
    if (!active || !finePointer || event.pointerType === 'touch' || !geometry.current) return;
    const rect = geometry.current;
    cursorX.set(((event.clientX - rect.left) / rect.width - 0.5) * 18);
    cursorY.set(((event.clientY - rect.top) / rect.height - 0.5) * 14);
  }

  return (
    <div ref={ref} className="scenza-pricing" data-motion-active={active} onPointerEnter={() => { geometry.current = ref.current?.getBoundingClientRect() ?? null; }} onPointerMove={followPointer} onPointerLeave={() => { cursorX.set(0); cursorY.set(0); }}>
      <motion.div className="scenza-pricing-particles" style={{ x, y }} aria-hidden="true">
        {particles.map((particle, index) => <span key={index} style={{ left: particle.left, top: particle.top, animationDelay: particle.delay, animationDuration: particle.duration }} />)}
      </motion.div>
      <p className="scenza-demo-pricing"><Sparkles size={14} aria-hidden="true" />{copy.demo}</p>
      <div className="scenza-pricing-grid">
        {demoPlans.map((plan, index) => {
          const details = copy.plans[plan.id];
          const selected = selectedPlan === plan.id;
          return <motion.article key={plan.id} data-selected={selected} className={`scenza-price-card${selected ? ' scenza-price-card-selected' : ''}`} onClick={() => onPick(plan.id)} initial={reduced ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : index * 0.09 }}>
            <div className="scenza-plan-heading"><h3>{details.name}</h3>{plan.recommended && <span className="scenza-recommended-label"><span />{copy.recommended}</span>}{tokenDiscount(plan) > 0 && <span className="scenza-year-discount">{copy.discount.replace('{discount}', String(tokenDiscount(plan)))}</span>}</div>
            <p className="scenza-plan-description">{details.description}</p>
            <div className="scenza-plan-price" aria-live="polite" aria-atomic="true">
              {language === 'en' && <span className="scenza-price-currency">$</span>}
              <NumberFlow value={planPrice(plan, language)} locales={locale} format={{ maximumFractionDigits: 0 }} animated={active && !reduced} />
              {language !== 'en' && <span className="scenza-price-currency">₽</span>}
              <span className="scenza-price-period">{plan.id === 'trial' ? copy.free : copy.perMonth}</span>
            </div>
            <p className="scenza-annual-total">{plan.tokens ? copy.tokens.replace('{tokens}', String(plan.tokens)).replace('{price}', money.format(tokenPrice(plan, language))) : '\u00a0'}{planSaving(plan, language) > 0 && <strong className="scenza-plan-saving">{copy.saving.replace('{amount}', money.format(planSaving(plan, language)))}</strong>}</p>
            <ul className="scenza-plan-features" aria-label={copy.featuresLabel}>{details.features.map((feature) => <li key={feature}><Check size={15} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
            <Button className="scenza-plan-cta" variant={selected ? 'default' : 'outline'} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onSelect(plan.id); }}>{selected && <Check size={15} aria-hidden="true" />}{details.cta ?? copy.choose}<ArrowUpRight size={15} aria-hidden="true" /></Button>
          </motion.article>;
        })}
      </div>
    </div>
  );
}
