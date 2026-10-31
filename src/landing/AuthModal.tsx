import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Send } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { authAdapter, authRequest, savedReferral, validateAuth } from './auth';
import type { Account, AuthConfig, AuthFieldErrors, AuthMode, AuthResult } from './auth';
import { content } from './content';
import { Logo } from '../Icon';
import Support from '../Support';
import './auth-legal.css';

export function AuthModal({ open, mode, setMode, close, copy, restoreFocus, account, onAccountChange }: {
  open: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; close: () => void;
  copy: typeof content.ru;
  restoreFocus: HTMLElement | null; account: Account | null; onAccountChange: (account: Account | null) => void;
}) {
  const en = copy === content.en;
  const t = (ru: string, english: string) => en ? english : ru;
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const emailCodeLength = config?.emailCodeLength === 8 ? 8 : 6;
  const [localStudioAllowed, setLocalStudioAllowed] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [method, setMethod] = useState<'email' | 'telegram'>('email');
  const [remember, setRemember] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [reset, setReset] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [telegramVerified, setTelegramVerified] = useState(false);
  const [telegramChallenge, setTelegramChallenge] = useState<{ url: string; expiresAt: number; emailProof?: boolean } | null>(null);
  const accountChangeRef = useRef(onAccountChange);
  accountChangeRef.current = onAccountChange;
  const generation = useRef(0);
  const effectiveMode: AuthMode = reset ? 'reset' : mode;
  useEffect(() => {
    generation.current++;
    let active = true;
    if (!open) { setConfig(null); setName(''); setPassword(''); setCode(''); setChallengeId(''); setError(''); setErrors({}); setBusy(false); setReset(false); setTermsAccepted(false); setDataConsent(false); setTelegramChallenge(null); setTelegramVerified(false); setSupportOpen(false); setLocalStudioAllowed(false); setMethod('email'); return; }
    setConfig(null);
    Promise.all([authRequest<AuthConfig>('config'), authRequest<{ user: Account | null; localStudioAllowed?: boolean }>('session')])
      .then(([next, session]) => { if (active) { setConfig(next); accountChangeRef.current(session.user); setLocalStudioAllowed(session.localStudioAllowed === true); } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; generation.current++; };
  }, [open]);
  function changeMode(next: 'login' | 'register') {
    generation.current++; setMode(next); setReset(false); setChallengeId(''); setCode(''); setName(''); setPassword(''); setError(''); setErrors({}); setTermsAccepted(false); setDataConsent(false); setTelegramChallenge(null); setTelegramVerified(false);
  }
  function accepted() {
    if (effectiveMode === 'register' && (!termsAccepted || !dataConsent)) {
      setError(t('Для регистрации примите условия и отдельно дайте согласие на обработку данных.', 'To register, accept the terms and give separate consent to data processing.')); return false;
    }
    return true;
  }
  async function run(action: () => Promise<AuthResult>) {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const result = await action();
      if (result.user) accountChangeRef.current(result.user);
      if (current !== generation.current) return;
      if (result.user) { setPassword(''); setCode(''); setChallengeId(''); setTelegramChallenge(null); if (result.user.accessActive) location.assign('/app'); }
      else if (result.verificationRequired && result.challengeId) { setChallengeId(result.challengeId); setPassword(''); }
      else if (result.telegramRequired && result.url && result.expiresAt) { setTelegramVerified(false); setTelegramChallenge({ url: result.url, expiresAt: result.expiresAt, emailProof: true }); }
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : t('Не удалось войти.', 'Login failed.')); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function telegram() {
    if (!config?.telegramBotEnabled) return;
    const current = generation.current;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const popup = mobile ? null : window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy(true); setError(''); setTelegramChallenge(null);
    try {
      const challenge = await authRequest<{ url: string; expiresAt: number }>('telegram/bot/start', { mode, remember, termsAccepted, dataConsent, ...(mode === 'register' ? { ref: savedReferral() } : {}) });
      if (current !== generation.current) { popup?.close(); return; }
      setTelegramChallenge(challenge);
      if (mobile) {
        const url = new URL(challenge.url);
        window.open(`tg://resolve?${new URLSearchParams({ domain: url.pathname.slice(1), start: url.searchParams.get('start') || '' })}`, '_self');
      } else if (popup) popup.location.replace(challenge.url);
    } catch (error) {
      popup?.close();
      if (current === generation.current) setError(error instanceof Error ? error.message : t('Telegram недоступен.', 'Telegram is unavailable.'));
    } finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => {
    if (!open || !telegramChallenge) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= telegramChallenge.expiresAt) {
        setError(t('Время подтверждения истекло. Начните вход через Telegram заново.', 'Confirmation expired. Start Telegram login again.'));
        setTelegramChallenge(null); return;
      }
      try {
        const result = await authRequest<AuthResult>('telegram/bot/status', {});
        if (result.user) accountChangeRef.current(result.user);
        if (!active) return;
        setError('');
        if (result.telegramVerified) { setTelegramVerified(true); setTelegramChallenge(null); return; }
        if (result.user) {
          setTelegramChallenge(null);
          if (result.user.accessActive) location.assign('/app');
          return;
        }
      } catch (error) {
        if (!active) return;
        setError(error instanceof Error ? error.message : 'Telegram недоступен.');
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) setTelegramChallenge(null);
        else timer = setTimeout(poll, 5000);
        return;
      }
      if (active) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [open, telegramChallenge]);
  const title = account ? t('Ваш аккаунт SCENZA', 'Your SCENZA account') : !config ? t('Проверяем аккаунт', 'Checking your account') : challengeId ? t('Подтвердите почту', 'Verify your email') : reset ? t('Восстановление доступа', 'Reset your password') : mode === 'login' ? t('С возвращением', 'Welcome back') : t('Создать аккаунт', 'Create account');
  const signupUnavailable = effectiveMode === 'register' && !config?.legalReady;
  const accessEnd = account?.accessSource && account.accessSource !== 'trial' ? account.accessUntil : null;
  const trialAccess = !account?.accessSource || account.accessSource === 'trial';
  const showMethods = !challengeId && !reset;
  const viaTelegram = showMethods && method === 'telegram';
  const consents = mode === 'register' && <div className="scenza-auth-consents"><label><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} /><span>{t('Принимаю ', 'I accept the ')}<a href="/legal/terms" target="_blank" rel="noopener">{t('пользовательское соглашение', 'terms of use')}</a>.</span></label><label><input type="checkbox" checked={dataConsent} onChange={event => setDataConsent(event.target.checked)} /><span>{t('Даю отдельное ', 'I give separate ')}<a href="/legal/consent" target="_blank" rel="noopener">{t('согласие на обработку персональных данных', 'consent to personal data processing')}</a>.</span></label></div>;
  const methodTab = (value: 'email' | 'telegram') => <button type="button" key={value} id={`auth-method-${value}`} role="tab" aria-selected={method === value} aria-controls="scenza-auth-panel" tabIndex={method === value ? 0 : -1} disabled={busy} onClick={() => { setMethod(value); setError(''); }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = method === 'email' ? 'telegram' : 'email'; setMethod(next); document.getElementById(`auth-method-${next}`)?.focus(); } }}>{value === 'email' ? t('Почта', 'Email') : 'Telegram'}</button>;
  return <><Dialog open={open} onClose={close} title={title} closeLabel={copy.close} restoreFocus={restoreFocus} className="scenza-auth-dialog">
    <div className="scenza-auth-brand" aria-hidden="true"><Logo subtitle="" /></div>
    {account ? <div className="scenza-account">
      <h2>{title}</h2><p>{account.name || account.email}</p>
      {account.telegramUserId && <p>Telegram ID: {account.telegramUserId}</p>}
      {account.blocked && <p role="status">{t('Обработка видео заблокирована: ', 'Video processing is blocked: ')}{account.blockReason || t('Обратитесь в поддержку.', 'Contact support.')}</p>}
      <div className="scenza-trial-note"><strong>{account.accessActive ? trialAccess ? t('Вам подарено 10 токенов — это 10 минут видео', 'You got 10 free tokens — 10 minutes of video') : t('Доступ активен', 'Your access is active') : account.trialStartedAt ? t('Срок доступа завершён', 'Your access has ended') : t('10 бесплатных токенов начислятся при первом входе', '10 free tokens are added on your first login')}</strong>{accessEnd && <p>{t('Доступ до: ', 'Access until: ')}{new Date(accessEnd).toLocaleString(en ? 'en-GB' : 'ru-RU')}</p>}<p>{t('Автосписаний нет. Продлить доступ можно промокодом или через администратора.', 'No automatic charges. Extend access with a promo code or contact the administrator.')}</p></div>
      {account.accessActive && <Button asChild className="scenza-auth-submit"><a href="/app">{t('Перейти в студию', 'Open the studio')}<ArrowRight size={20} /></a></Button>}
      <p><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Доступ и промокоды в Telegram-боте', 'Access and promo codes in our Telegram bot')}</a></p>
      <div className="scenza-account-actions"><button type="button" className="scenza-auth-text-button" onClick={() => setSupportOpen(true)}>{t('Поддержка', 'Support')}</button><button type="button" className="scenza-auth-text-button" disabled={busy} onClick={() => void run(async () => { await authRequest('logout', {}); accountChangeRef.current(null); return {}; })}>{t('Выйти из аккаунта', 'Log out')}</button></div>
    </div> : !config ? <div className="scenza-auth-heading"><h2>{title}</h2>{!error && <p role="status">{t('Загружаем данные аккаунта…', 'Loading your account details…')}</p>}</div> : <>
      <div className="scenza-auth-heading"><h2>{title}</h2>{challengeId ? <p>{t(`Если действие доступно для ${email}, вы получите письмо с кодом. Проверьте также папку «Спам».`, `If this action is available for ${email}, you will receive a code. Please also check spam.`)}</p> : reset ? <p>{t('Укажите почту и новый пароль. Изменение нужно подтвердить кодом из письма.', 'Enter your email and new password, then verify the change with an email code.')}</p> : mode === 'register' ? <p><strong>{t('10 токенов в подарок — это 10 минут видео.', '10 free tokens — that is 10 minutes of video.')}</strong> {t('Без карты. Токены не сгорают.', 'No card needed. Tokens never expire.')}</p> : <p>{t('Войдите по почте или через Telegram.', 'Log in with your email or Telegram.')}</p>}</div>
      {localStudioAllowed && <div className="scenza-trial-note"><strong>{t('Студия готова к работе', 'Your local studio is ready')}</strong><p>{t('Откройте рабочее окно, загрузите видео и проверьте монтаж. В локальной версии аккаунт не требуется.', 'Open the workspace, upload a video and try editing. The local version does not require an account.')}</p><Button asChild className="scenza-auth-submit"><a href="/app">{t('Открыть локальную студию', 'Open the local studio')}<ArrowRight size={20} /></a></Button></div>}
      {showMethods && <div className="scenza-auth-methods" role="tablist" aria-label={t('Способ входа', 'Sign-in method')}>{methodTab('email')}{methodTab('telegram')}</div>}
      <div id="scenza-auth-panel" {...(showMethods ? { role: 'tabpanel', 'aria-labelledby': `auth-method-${method}` } : {})}>
      {effectiveMode === 'register' && <p className="scenza-auth-note">{t('Для регистрации нужна подписка на ', 'Registration requires a subscription to ')}<a href="https://t.me/MediaFlowTech" target="_blank" rel="noopener noreferrer">@MediaFlowTech</a>. {t('Подтверждение в Telegram — следующим шагом.', 'Telegram confirmation is the next step.')}</p>}
      {telegramVerified && effectiveMode === 'register' && !challengeId && !viaTelegram && <p className="scenza-auth-note" role="status">{t('Telegram подтверждён. Нажмите «Продолжить», чтобы получить код на почту.', 'Telegram verified. Press Continue to receive your email code.')}</p>}
      {signupUnavailable && <p className="scenza-auth-note" role="status">{t('Регистрация ещё не открыта: завершаем подключение сервиса и юридическое оформление.', 'Registration is not open yet: service setup and legal documents are being finalized.')}</p>}
      {viaTelegram ? <div className="scenza-telegram-auth">
        <p className="scenza-auth-note">{mode === 'register' ? t('Бот SCENZA попросит принять условия и подтвердить регистрацию. Затем вернитесь в эту вкладку — почта не нужна.', 'The SCENZA bot will ask you to accept the terms and confirm sign-up. Then return to this tab — no email needed.') : t('Подтвердите вход в боте SCENZA и вернитесь в эту вкладку. Почта не нужна.', 'Confirm login in the SCENZA bot and return to this tab. No email needed.')}</p>
        <Button className="scenza-auth-submit" disabled={busy || !!telegramChallenge || !config?.telegramBotEnabled || signupUnavailable} onClick={() => void telegram()}>{telegramChallenge ? t('Ожидаем подтверждения…', 'Waiting for confirmation…') : t('Продолжить в Telegram', 'Continue in Telegram')}<Send size={19} /></Button>
        {config?.botRegistrationEnabled && !config?.telegramBotEnabled && <p className="scenza-auth-note"><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Открыть Telegram-бота SCENZA', 'Open the SCENZA Telegram bot')}</a>. {t('Вход через Telegram на сайте пока недоступен.', 'Telegram login on the website is not available yet.')}</p>}
        {!config?.telegramBotEnabled && !config?.botRegistrationEnabled && <p className="scenza-auth-note">{t('Подключение Telegram готовится.', 'Telegram setup is in progress.')}</p>}
      </div> : <form id="scenza-auth-form" noValidate onSubmit={event => {
        event.preventDefault(); if (!accepted()) return; setTelegramChallenge(null);
        if (challengeId) { if (code.length !== emailCodeLength || !/^\d+$/.test(code)) { setError(t(`Введите ${emailCodeLength} цифр из письма.`, `Enter the ${emailCodeLength}-digit email code.`)); return; } void run(() => authRequest<AuthResult>('email/verify', { challengeId, code })); return; }
        const invalid = validateAuth({ email, password, name, requireName: mode === 'register' }); setErrors(invalid); if (Object.keys(invalid).length) { document.getElementById(invalid.name ? 'scenza-name' : invalid.email ? 'scenza-email' : 'scenza-password')?.focus(); return; }
        void run(() => authAdapter.submit(effectiveMode, { email, password, ...(mode === 'register' ? { name: name.trim(), ref: savedReferral() } : {}) }, { remember, termsAccepted, dataConsent }));
      }}>
        {challengeId ? <><label htmlFor="scenza-code">{t('Код из письма', 'Email code')}</label><div className="scenza-auth-input"><input id="scenza-code" inputMode="numeric" autoComplete="one-time-code" maxLength={emailCodeLength} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} autoFocus /></div><button type="button" className="scenza-auth-text-button" onClick={() => { setChallengeId(''); setCode(''); setError(''); }}>{t('Указать другую почту или запросить новый код', 'Change email or request another code')}</button></> : <>
          {mode === 'register' && <><label htmlFor="scenza-name">{t('Имя', 'Name')}</label><div className="scenza-auth-input"><input id="scenza-name" type="text" autoComplete="nickname" maxLength={60} value={name} placeholder={copy.auth.namePlaceholder} onChange={event => setName(event.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} /></div>{errors.name && <p className="scenza-field-error" id="name-error" role="alert">{copy.auth.invalidName}</p>}</>}
          <label htmlFor="scenza-email">{copy.auth.email}</label><div className="scenza-auth-input"><input id="scenza-email" type="email" autoComplete="email" maxLength={254} value={email} placeholder="you@example.com" onChange={event => setEmail(event.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} /></div>{errors.email && <p className="scenza-field-error" id="email-error" role="alert">{copy.auth.invalidEmail}</p>}
          <label htmlFor="scenza-password">{reset ? t('Новый пароль', 'New password') : copy.auth.password}</label><div className="scenza-auth-input"><input id="scenza-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' || reset ? 'new-password' : 'current-password'} maxLength={128} value={password} placeholder={copy.auth.passwordPlaceholder} onChange={event => setPassword(event.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} /><button type="button" aria-label={showPassword ? t('Скрыть пароль', 'Hide password') : t('Показать пароль', 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={22} strokeWidth={1.8} /> : <Eye size={22} strokeWidth={1.8} />}</button></div>{errors.password && <p className="scenza-field-error" id="password-error" role="alert">{t('Пароль должен содержать не менее 8 символов.', 'Use at least 8 characters.')}</p>}
          {mode === 'login' && <div className="scenza-auth-options"><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t('Запомнить меня', 'Remember me')}</label><button type="button" disabled={busy} onClick={() => { generation.current++; setTelegramChallenge(null); setReset(!reset); setPassword(''); setError(''); }}>{reset ? t('Вернуться ко входу', 'Back to login') : t('Забыли пароль?', 'Forgot password?')}</button></div>}
          {consents}
        </>}
        <Button type="submit" disabled={busy || !!telegramChallenge || !config?.emailEnabled || signupUnavailable} className="scenza-auth-submit" aria-busy={busy}>{busy ? t('Подождите…', 'Please wait…') : challengeId ? t('Подтвердить и войти', 'Verify and log in') : reset ? t('Получить код', 'Send verification code') : mode === 'register' ? t('Продолжить', 'Continue') : t('Войти', 'Log in')}{!busy && <ArrowRight size={20} />}</Button>
        {!config?.emailEnabled && <p className="scenza-auth-note">{t('Вход по почте будет доступен после подключения почтового сервиса.', 'Email login will be available after the email service is connected.')}</p>}
      </form>}
      {telegramChallenge && <p className="scenza-auth-note scenza-auth-waiting" role="status"><a href={telegramChallenge.url} target="_blank" rel="noopener noreferrer">{t('Открыть бота SCENZA', 'Open the SCENZA bot')}</a><br />{telegramChallenge.emailProof ? t('Подпишитесь на канал, нажмите «Старт» и подтвердите Telegram в боте. Затем вернитесь сюда для подтверждения почты.', 'Subscribe to the channel, tap Start and confirm Telegram in the bot. Return here to verify your email.') : t('Нажмите «Старт» и подтвердите вход. Студия откроется автоматически.', 'Tap Start and confirm login. The studio will open automatically.')}<br /><button type="button" className="scenza-auth-text-button" onClick={() => setTelegramChallenge(null)}>{t('Отменить ожидание', 'Cancel waiting')}</button></p>}
      </div>
      {showMethods && <p className="scenza-auth-switch">{mode === 'login' ? t('Нет аккаунта? ', 'New here? ') : t('Уже есть аккаунт? ', 'Already registered? ')}<button type="button" disabled={busy} onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('Создать', 'Create one') : t('Войти', 'Log in')}</button></p>}
    </>}
    {error && <p className="scenza-auth-error" role="alert">{error}</p>}
  </Dialog>{supportOpen && <Support onClose={() => setSupportOpen(false)} />}</>;
}
