export function createTelegramMembership({ botToken, fetch: fetcher = globalThis.fetch }) {
  let botId;
  async function api(method, body) {
    try {
      if (typeof botToken !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) throw new Error();
      const response = await fetcher(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !result.result) throw new Error();
      return result.result;
    } catch { throw new Error('Telegram membership verification unavailable'); }
  }
  return async id => {
    if (!/^[1-9]\d{0,15}$/.test(String(id)) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid Telegram ID');
    if (!botId) {
      const me = await api('getMe', {});
      if (me.is_bot !== true || !Number.isSafeInteger(me.id) || me.id <= 0) throw new Error('Invalid Telegram bot identity');
      botId = me.id;
    }
    const admin = await api('getChatMember', { chat_id: '-1004499791967', user_id: botId });
    if (admin.user?.id !== botId || !['administrator', 'creator'].includes(admin.status)) throw new Error('Telegram bot must be a channel administrator');
    const member = await api('getChatMember', { chat_id: '-1004499791967', user_id: Number(id) });
    if (member.user?.id !== Number(id)) throw new Error('Telegram membership identity mismatch');
    return ['creator', 'administrator', 'member'].includes(member.status) || member.status === 'restricted' && member.is_member === true;
  };
}
