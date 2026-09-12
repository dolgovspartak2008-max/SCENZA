export type Language = 'ru' | 'en';
export type BillingPeriod = 'month' | 'year';
export type PlanId = 'trial' | 'start' | 'pro';
export type PlanSelection = { planId: PlanId; period: BillingPeriod };
export type DemoPlan = { id: PlanId; monthly: number; annual: number; recommended: boolean };

// Illustrative prices from the supplied mockup; these are not commercial terms.
export const demoPlans: DemoPlan[] = [
  { id: 'trial', monthly: 0, annual: 0, recommended: false },
  { id: 'start', monthly: 990, annual: 9504, recommended: true },
  { id: 'pro', monthly: 2490, annual: 23904, recommended: false },
];
export const currency = 'RUB';
export function monthlyEquivalent(plan: DemoPlan, period: BillingPeriod) {
  return period === 'year' && plan.id !== 'trial' ? plan.annual / 12 : plan.monthly;
}
export function annualDiscount(plan: DemoPlan) {
  return plan.monthly > 0 ? Math.round((1 - plan.annual / (plan.monthly * 12)) * 100) : 0;
}
export function parseSelection(value: string | null): PlanSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PlanSelection>;
    return ['trial', 'start', 'pro'].includes(parsed.planId ?? '') && ['month', 'year'].includes(parsed.period ?? '') ? { planId: parsed.planId!, period: parsed.period! } : null;
  } catch { return null; }
}
