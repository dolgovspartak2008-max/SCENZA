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
const baseTokenPrice = 20, baseTokenUsd = 0.24;
export const planPrice = (plan: DemoPlan, language: Language) => language === 'en' ? plan.usd : plan.price;
export function tokenPrice(plan: DemoPlan, language: Language) {
  return plan.tokens ? planPrice(plan, language) / plan.tokens : 0;
}
// Savings against buying the same minutes at the Start price.
export function planSaving(plan: DemoPlan, language: Language) {
  return plan.tokens ? Math.max(0, Math.round((plan.tokens * (language === 'en' ? baseTokenUsd : baseTokenPrice) - planPrice(plan, language)) * 100) / 100) : 0;
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
// The one message about paid access: used by the pricing section, the profile and the studio, so all say the same thing.
export const adminContactUrl = 'https://t.me/SCENZA_BOT';
export function adminAccessCopy(language: Language, plan?: { name: string; tokens?: number }) {
  const ru = language === 'ru';
  return {
    title: plan ? (ru ? `Тариф «${plan.name}»` : `${plan.name} plan`) : ru ? 'Пополнение токенов' : 'Top up tokens',
    text: plan
      ? ru ? `Онлайн-оплата пока не подключена. Напишите нам в Telegram: администратор подключит тариф (${plan.tokens} токенов) после оплаты. Без подтверждения администратора тариф не активируется.` : `Online payment is not connected yet. Message us on Telegram and the administrator will activate the plan (${plan.tokens} tokens) after payment. A plan is never activated without the administrator.`
      : ru ? 'Онлайн-оплата пока не подключена. Напишите нам в Telegram: администратор пополнит токены после оплаты. Без подтверждения администратора токены не начисляются.' : 'Online payment is not connected yet. Message us on Telegram and the administrator will add tokens after payment. Tokens are never added without the administrator.',
    action: ru ? 'Написать в Telegram' : 'Message us on Telegram',
  };
}
