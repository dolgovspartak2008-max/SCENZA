// 1 token = 1 started minute of uploaded source video. Tokens never expire; the ledger is append-only.
export const TRIAL_TOKENS = 10;
export const REFERRAL_BONUS = 20;
export const REFERRAL_SHARE = 0.1;
export const PLAN_TOKENS = { start: 75, pro: 170, business: 500 };
export const LOCAL_OWNER = 'local';

export const tokenCost = seconds => Math.max(1, Math.ceil((Number(seconds) || 0) / 60));
const sum = entries => entries.reduce((total, entry) => total + entry.tokens, 0);

export function createTokens(store) {
  const grant = (ownerId, tokens, reason, id, note = '') => store.recordAiUsage({ id, ownerId, projectId: '-', jobId: '-', kind: 'token', tokens, reason, note });
  // Every account starts with trial tokens; the fixed id keeps the grant single even under retries.
  const entries = async ownerId => {
    const list = await store.ownerTokens(ownerId);
    if (list.some(entry => entry.reason === 'trial')) return list;
    await grant(ownerId, TRIAL_TOKENS, 'trial', `trial-${ownerId}`, 'Стартовые токены');
    return store.ownerTokens(ownerId);
  };
  return {
    grant,
    async summary(ownerId) {
      const list = await entries(ownerId);
      return { balance: sum(list), history: list.slice(-30).reverse().map(({ id, tokens, reason, note, createdAt, projectId }) => ({ id, tokens, reason, note, createdAt, projectId: projectId && projectId !== '-' ? projectId : null })) };
    },
    // Charges once per project source; a retry or re-analysis of the same source is free.
    async charge(ownerId, projectId, sourceKey, seconds) {
      if (ownerId === LOCAL_OWNER) return { charged: 0 };
      const id = `analysis-${projectId}-${sourceKey}`.slice(0, 200);
      const list = await entries(ownerId);
      if (list.some(entry => entry.id === id)) return { charged: 0 };
      const cost = tokenCost(seconds), balance = sum(list);
      if (balance < cost) throw Object.assign(new Error(`Недостаточно токенов: нужно ${cost}, на балансе ${balance}. 1 токен = 1 минута исходного видео. Пополните баланс в профиле.`), { status: 402, code: 'TOKENS_EXHAUSTED' });
      await store.recordAiUsage({ id, ownerId, projectId, jobId: '-', kind: 'token', tokens: -cost, reason: 'analysis', note: `${Math.round(seconds)} сек. видео` });
      return { charged: cost };
    },
  };
}
