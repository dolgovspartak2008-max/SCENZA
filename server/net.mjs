import { setTimeout as delay } from 'node:timers/promises';

// Network failures are reported by category only: never the URL, headers or the original message (they can contain keys).
const DNS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL']);
const RESET = new Set(['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);
const REFUSED = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN']);
const TIMEOUT = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

export const NETWORK_LABELS = {
  timeout: 'истёк тайм-аут ответа',
  dns: 'не удалось найти адрес (DNS)',
  tls: 'ошибка TLS/сертификата',
  reset: 'соединение сброшено',
  refused: 'отказ в соединении / сеть недоступна',
  network: 'сетевая ошибка без уточнения',
};

export function classifyNetworkError(error) {
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    const code = typeof current.code === 'string' ? current.code : '';
    if (current.name === 'TimeoutError' || TIMEOUT.has(code)) return { kind: 'timeout', code: code || 'TimeoutError' };
    if (DNS.has(code)) return { kind: 'dns', code };
    if (RESET.has(code)) return { kind: 'reset', code };
    if (REFUSED.has(code)) return { kind: 'refused', code };
    if (/^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_)/.test(code)) return { kind: 'tls', code };
  }
  return { kind: 'network', code: 'unknown' };
}

const retryableStatus = status => status >= 500 && status <= 599;

// Up to `attempts` tries with short pauses, so a few seconds of packet loss never becomes an outage.
// 4xx answers (401/402/403/429, missing table) are returned at once: retrying would not change them.
export async function fetchWithRetry(fetcher, url, init = {}, { attempts = 3, timeoutMs = 10000, delays = [2000, 5000], sleep = delay, retry = true, signal } = {}) {
  let lastNetwork;
  const tries = retry ? attempts : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await fetcher(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!retryableStatus(response.status) || attempt >= tries) return Object.assign(response, { attempts: attempt });
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (signal?.aborted) throw error;
      lastNetwork = classifyNetworkError(error);
      if (attempt >= tries) throw Object.assign(new Error(`network ${lastNetwork.kind}`), { network: { ...lastNetwork, attempts: attempt } });
    }
    await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
  }
}
