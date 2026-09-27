export type Language = 'ru' | 'en';
export type BillingPeriod = 'month';
export type PlanId = 'trial' | 'start' | 'pro' | 'business';
export type PlanSelection = { planId: PlanId; period: BillingPeriod };
export type DemoPlan = { id: PlanId; price: number; usd: number; tokens: number; recommended: boolean };

// 1 token = 1 minute of uploaded source video. Payments are not connected yet: paid access is granted by the owner.
export const demoPlans: DemoPlan[] = [
  { id: 'trial', price: 0, usd: 0, tokens: 0, recommended: false },
  { id: 'start', price: 1500, usd: 18, tokens: 75, recommended: false },
  { id: 'pro', price: 3000, usd: 36, tokens: 170, recommended: true },
  { id: 'business', price: 7560, usd: 90, tokens: 500, recommended: false },
];
export const currency = 'RUB';
const baseTokenPrice = 20;
export const planPrice = (plan: DemoPlan, language: Language) => language === 'en' ? plan.usd : plan.price;
export function tokenPrice(plan: DemoPlan, language: Language) {
  return plan.tokens ? planPrice(plan, language) / plan.tokens : 0;
}
export function tokenDiscount(plan: DemoPlan) {
  return plan.tokens ? Math.round((1 - plan.price / plan.tokens / baseTokenPrice) * 100) : 0;
}
export function parseSelection(value: string | null): PlanSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { planId?: string };
    return demoPlans.some(plan => plan.id === parsed.planId) ? { planId: parsed.planId as PlanId, period: 'month' } : null;
  } catch { return null; }
}
