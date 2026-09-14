const MAX_PHOTO = 10 * 1024 ** 2;
const failure = code => Object.assign(new Error('Telegram: не удалось передать изображение для рассылки.'), { telegramFailure: true, telegramMethod: 'sendPhoto', ...(Number.isInteger(code) && code >= 400 && code <= 599 ? { telegramCode: code } : {}) });

export function createPhotoSender({ clientToken, adminToken, fetch: fetcher = globalThis.fetch, api }) {
  const uploaded = new Map();
  return async function sendPhoto(chatId, draft, markup = {}) {
    try {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(clientToken || '') || !/^\d+:[A-Za-z0-9_-]+$/.test(adminToken || clientToken || '') || typeof draft?.photo !== 'string' || !draft.photo || draft.photo.length > 500 || typeof draft.text !== 'string' || draft.text.length > 1000) throw failure(400);
      const original = draft.photo;
      const cached = uploaded.get(original);
      if (!adminToken || adminToken === clientToken || cached) return await api('client', 'sendPhoto', { chat_id: chatId, photo: cached || original, caption: draft.text, ...markup });

      const file = await api('admin', 'getFile', { file_id: original });
      if (typeof file?.file_path !== 'string' || file.file_path.length > 500 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(file.file_path) || file.file_path.split('/').some(part => part === '.' || part === '..') || Number(file.file_size) > MAX_PHOTO) throw failure(400);
      const response = await fetcher(`https://api.telegram.org/file/bot${adminToken}/${file.file_path}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_PHOTO) { await response.body?.cancel(); throw failure(400); }
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_PHOTO) { await reader.cancel(); throw failure(413); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (!size) throw failure(400);

      const body = new FormData();
      body.set('chat_id', String(chatId));
      body.set('caption', draft.text);
      body.set('photo', new Blob(chunks, { type: 'image/jpeg' }), 'scenza.jpg');
      if (markup.reply_markup) body.set('reply_markup', JSON.stringify(markup.reply_markup));
      const sent = await fetcher(`https://api.telegram.org/bot${clientToken}/sendPhoto`, { method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(30000) });
      const result = await sent.json();
      if (!sent.ok || result?.ok !== true) throw failure(Number(result?.error_code) || sent.status);
      const fileId = result.result?.photo?.at(-1)?.file_id;
      if (typeof fileId === 'string' && fileId.length <= 500) {
        if (uploaded.size >= 20) uploaded.delete(uploaded.keys().next().value);
        uploaded.set(original, fileId);
      }
      return result.result;
    } catch (error) { throw failure(error?.telegramCode); }
  };
}
