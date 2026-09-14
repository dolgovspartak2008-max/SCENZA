const fail = (message, status = 503) => Object.assign(new Error(message), { status });

export function createSupabase({ url, serviceKey, publicKey, fetch: fetcher = globalThis.fetch }) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error('Supabase URL must be an HTTPS origin');
  if (!serviceKey || !publicKey) throw new Error('Supabase server and publishable keys are required');
  let revision;

  async function request(route, { method = 'GET', body, auth = false, prefer } = {}) {
    let response;
    try {
      const key = auth ? publicKey : serviceKey;
      response = await fetcher(`${endpoint.origin}${route}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw fail('Не удалось связаться с Supabase. Попробуйте позже.'); }
    if (!response.ok) {
      if (response.status === 429) throw fail('Слишком много запросов. Попробуйте позже.', 429);
      if (auth && [400, 401, 403, 422].includes(response.status)) throw fail('Не удалось подтвердить почту. Проверьте код и настройки отправки писем.', 400);
      throw fail('Хранилище Supabase временно недоступно.');
    }
    try { return await response.json(); }
    catch { throw fail('Некорректный ответ Supabase.'); }
  }

  function readRow(rows) {
    const row = Array.isArray(rows) && rows.length === 1 && rows[0];
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0 || !row.payload || !['accounts', 'events', 'promos', 'processed'].every(key => Array.isArray(row.payload[key]))) throw fail('Некорректное хранилище аккаунтов Supabase.');
    revision = row.revision;
    return row.payload;
  }

  return {
    // ponytail: one backend owns the account snapshot; normalize into SQL transactions before adding workers.
    accountStore: {
      async load(fallback) {
        let rows = await request('/rest/v1/scenza_state?id=eq.auth&select=revision,payload');
        if (Array.isArray(rows) && rows.length === 0) {
          rows = await request('/rest/v1/scenza_state?on_conflict=id', { method: 'POST', body: { id: 'auth', revision: 0, payload: fallback }, prefer: 'resolution=ignore-duplicates,return=representation' });
          if (Array.isArray(rows) && rows.length === 0) rows = await request('/rest/v1/scenza_state?id=eq.auth&select=revision,payload');
        }
        return readRow(rows);
      },
      async save(payload) {
        if (!Number.isSafeInteger(revision)) throw fail('Хранилище Supabase не загружено.');
        const rows = await request(`/rest/v1/scenza_state?id=eq.auth&revision=eq.${revision}`, { method: 'PATCH', body: { payload, revision: revision + 1 }, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw fail('Хранилище изменено другим процессом. Перезапустите сервис.');
        readRow(rows);
      },
    },
    emailAuth: {
      async send({ email }) {
        await request('/auth/v1/otp', { method: 'POST', auth: true, body: { email, create_user: true } });
      },
      async verify({ email, code }) {
        const result = await request('/auth/v1/verify', { method: 'POST', auth: true, body: { email, token: code, type: 'email' } });
        if (!result.user?.id || result.user.email?.toLowerCase() !== email.toLowerCase() || !result.user.email_confirmed_at) throw fail('Не удалось подтвердить владельца почты.', 400);
      },
    },
  };
}
