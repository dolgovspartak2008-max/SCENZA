export type AuthInput = { email: string; password: string };
export type AuthFieldErrors = Partial<Record<keyof AuthInput, 'invalidEmail' | 'shortPassword'>>;
export function validateAuth(input: AuthInput): AuthFieldErrors {
  return {
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) ? { email: 'invalidEmail' as const } : {}),
    ...(input.password.length < 8 ? { password: 'shortPassword' as const } : {}),
  };
}
export type AuthMode = 'login' | 'register' | 'reset';
export type Account = { id: string; email?: string; name: string; provider: string; trialStartedAt: string | null; trialEndsAt: string | null; accessUntil?: string | null; accessSource?: string; accessActive: boolean; blocked?: boolean; role?: 'user' | 'support' };
export type AuthConfig = { emailEnabled: boolean; telegramEnabled: boolean; telegramClientId: string; legalReady: boolean; botRegistrationEnabled?: boolean };
export type AuthResult = { user?: Account; verificationRequired?: boolean; challengeId?: string };
export type Consent = { termsAccepted: boolean; dataConsent: boolean; remember: boolean };

export async function authRequest<T>(route: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${route}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('Не удалось связаться с сервером. Повторите попытку.'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Object.assign(new Error(response.status === 404 ? 'Сервер входа ещё не запущен. Перезапустите локальную SCENZA.' : result?.error || 'Сервис входа временно недоступен. Повторите попытку позже.'), { status: response.status });
  return result as T;
}
export const authAdapter = {
  submit: (mode: AuthMode, input: AuthInput, consent?: Consent) => authRequest<AuthResult>('email/start', { mode, ...input, ...consent }),
};

type TelegramLogin = { auth: (options: { client_id: number; scope: string[]; lang: string; nonce: string }, callback: (data: { id_token?: string; error?: string }) => void) => void };
declare global { interface Window { Telegram?: { Login?: TelegramLogin } } }
let telegramScript: Promise<void> | undefined;
export function loadTelegram(): Promise<void> {
  if (window.Telegram?.Login) return Promise.resolve();
  if (!telegramScript) telegramScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://oauth.telegram.org/js/telegram-login.js?6';
    script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error('Telegram не ответил. Попробуйте войти по почте.')); }, 15000);
    script.onload = () => { clearTimeout(timeout); window.Telegram?.Login ? resolve() : reject(new Error('Не удалось загрузить вход Telegram.')); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Не удалось подключиться к Telegram. Попробуйте войти по почте.')); };
    document.head.append(script);
  }).catch(error => { telegramScript = undefined; throw error; });
  return telegramScript;
}
