import type { Job } from './model';

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Не удалось связаться с локальным сервером. Проверьте, что SCENZA запущена.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Сервер вернул ошибку ${response.status}. Попробуйте ещё раз.`);
  if (body === null) throw new Error('Сервер вернул некорректный ответ. Перезапустите локальное приложение.');
  return body as T;
}

export async function waitForJob(id: string, onProgress?: (job: Job) => void, signal?: AbortSignal): Promise<Job> {
  for (;;) {
    signal?.throwIfAborted();
    const { job } = await request<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}`, { signal });
    onProgress?.(job);
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new Error(job.message || 'Обработка не завершилась. Попробуйте другой файл.');
    if (job.status === 'cancelled') throw new DOMException('Операция отменена', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Операция отменена', 'AbortError')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 800);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

export function uploadFile(file: File, onProgress?: (progress: number) => void, signal?: AbortSignal, target = '/api/upload'): Promise<Job> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${target}?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      cleanup();
      try {
        const value = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300) reject(new Error(value.error || `Ошибка загрузки ${xhr.status}`));
        else if (!value.job?.id) reject(new Error('Сервер не создал задачу загрузки.'));
        else resolve(value.job);
      } catch { reject(new Error('Не удалось получить результат загрузки.')); }
    };
    xhr.onerror = () => { cleanup(); reject(new Error('Соединение прервано. Повторите загрузку.')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Загрузка отменена', 'AbortError')); };
    if (signal?.aborted) { reject(new DOMException('Загрузка отменена', 'AbortError')); return; }
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(file);
  });
}
