import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Send, ShieldCheck, UserRound, UserRoundPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { authAdapter, authRequest, savedReferral, validateAuth } from './auth';
import type { Account, AuthConfig, AuthFieldErrors, AuthMode, AuthResult } from './auth';
import { demoPlans, planPrice } from './plans';
import type { PlanSelection } from './plans';
import { content } from './content';
import Support from '../Support';
import './auth-legal.css';

export function AuthModal({ open, mode, setMode, close, copy, selection, onPlanChange, restoreFocus, onDemo, account, onAccountChange }: {
  open: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; close: () => void;
  copy: typeof content.ru; selection: PlanSelection | null; onPlanChange: (plan: PlanSelection) => void;
  restoreFocus: HTMLElement | null; onDemo: () => void; account: Account | null; onAccountChange: (account: Account | null) => void;
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
    if (!open) { setConfig(null); setName(''); setPassword(''); setCode(''); setChallengeId(''); setError(''); setErrors({}); setBusy(false); setReset(false); setTermsAccepted(false); setDataConsent(false); setTelegramChallenge(null); setTelegramVerified(false); setSupportOpen(false); setLocalStudioAllowed(false); return; }
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
      const challenge = await authRequest<{ url: string; expiresAt: number }>('telegram/bot/start', { mode, remember, termsAccepted, dataConsent });
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
  const title = account ? t('Ваш аккаунт SCENZA', 'Your SCENZA account') : !config ? t('Проверяем аккаунт', 'Checking your account') : challengeId ? t('Подтвердите почту', 'Verify your email') : reset ? t('Восстановление доступа', 'Reset your password') : mode === 'login' ? t('Вход в систему', 'Log in to SCENZA') : t('Регистрация', 'Create an account');
  const signupUnavailable = effectiveMode === 'register' && !config?.legalReady;
  const accessEnd = account?.accessSource && account.accessSource !== 'trial' ? account.accessUntil : null;
  const trialAccess = !account?.accessSource || account.accessSource === 'trial';
  return <><Dialog open={open} onClose={close} title={title} closeLabel={copy.close} restoreFocus={restoreFocus} className="scenza-auth-dialog">
    {account ? <div className="scenza-account">
      <ShieldCheck size={32} /><h2>{title}</h2><p>{account.name || account.email}</p>
      {account.telegramUserId && <p>Telegram ID: {account.telegramUserId}</p>}
      {account.blocked && <p role="status">{t('Обработка видео заблокирована: ', 'Video processing is blocked: ')}{account.blockReason || t('Обратитесь в поддержку.', 'Contact support.')}</p>}
      <button type="button" className="scenza-auth-text-button" onClick={() => setSupportOpen(true)}>{t('Поддержка', 'Support')}</button>
      <div className="scenza-trial-note"><strong>{account.accessActive ? trialAccess ? t('Вам подарено 10 токенов — это 10 минут видео', 'You got 10 free tokens — 10 minutes of video') : t('Доступ активен', 'Your access is active') : account.trialStartedAt ? t('Срок доступа завершён', 'Your access has ended') : t('10 бесплатных токенов начислятся при первом входе', '10 free tokens are added on your first login')}</strong>{accessEnd && <p>{t('Доступ до: ', 'Access until: ')}{new Date(accessEnd).toLocaleString(en ? 'en-GB' : 'ru-RU')}</p>}<p>{t('Автосписаний нет. Продлить доступ можно промокодом или через администратора.', 'No automatic charges. Extend access with a promo code or contact the administrator.')}</p></div>
      {account.accessActive && <Button asChild className="scenza-auth-submit"><a href="/app">{t('Перейти в студию', 'Open the studio')}<ArrowRight size={18} /></a></Button>}
      <p><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Доступ и промокоды в Telegram-боте', 'Access and promo codes in our Telegram bot')}</a></p>
      <button className="scenza-auth-text-button" disabled={busy} onClick={() => void run(async () => { await authRequest('logout', {}); accountChangeRef.current(null); return {}; })}>{t('Выйти из аккаунта', 'Log out')}</button>
    </div> : !config ? <div className="scenza-auth-heading"><h2>{title}</h2>{!error && <p role="status">{t('Загружаем данные аккаунта…', 'Loading your account details…')}</p>}</div> : <>
      <div className="scenza-auth-tabs" role="tablist" aria-label={t('Способ доступа', 'Account access')}>{(['login', 'register'] as const).map(value => <button type="button" key={value} id={`auth-tab-${value}`} role="tab" aria-selected={mode === value} aria-controls="scenza-auth-form" tabIndex={mode === value ? 0 : -1} disabled={busy} onClick={() => changeMode(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = mode === 'login' ? 'register' : 'login'; changeMode(next); document.getElementById(`auth-tab-${next}`)?.focus(); } }}>{value === 'login' ? <UserRound size={19} /> : <UserRoundPlus size={19} />}{value === 'login' ? t('Вход', 'Log in') : t('Регистрация', 'Register')}</button>)}</div>
      <div className="scenza-auth-heading"><h2>{title}</h2><p>{challengeId ? t(`Если действие доступно для ${email}, вы получите письмо с кодом. Проверьте также папку «Спам».`, `If this action is available for ${email}, you will receive a code. Please also check spam.`) : reset ? t('Укажите почту и новый пароль. Изменение нужно подтвердить кодом из письма.', 'Enter your email and new password, then verify the change with an email code.') : t('По электронной почте или через Telegram', 'With your email or Telegram account')}</p></div>
      {localStudioAllowed && <div className="scenza-trial-note"><strong>{t('Студия готова к работе', 'Your local studio is ready')}</strong><p>{t('Откройте рабочее окно, загрузите видео и проверьте монтаж. В локальной версии аккаунт не требуется.', 'Open the workspace, upload a video and try editing. The local version does not require an account.')}</p><Button asChild className="scenza-auth-submit"><a href="/app">{t('Открыть локальную студию', 'Open the local studio')}<ArrowRight size={18} /></a></Button></div>}
      {mode === 'register' && !challengeId && <div className="scenza-trial-note"><strong>{t('🎁 Дарим 10 токенов сразу после регистрации', '🎁 Get 10 free tokens right after sign-up')}</strong><p>{t('Это 10 минут видео — хватит на несколько готовых роликов. Без карты и без срока: токены не сгорают.', 'That is 10 minutes of video — enough for several finished clips. No card and no deadline: tokens never expire.')}</p></div>}
      {effectiveMode === 'register' && <p className="scenza-auth-availability">{t('Для регистрации обязательна подписка на ', 'Registration requires subscribing to ')}<a href="https://t.me/MediaFlowTech" target="_blank" rel="noopener noreferrer">@MediaFlowTech</a>. {t('Бот проверит подписку и подтвердит ваш Telegram, в том числе при регистрации по почте.', 'Our bot verifies your subscription and Telegram identity, including email registration.')}</p>}
      {telegramVerified && effectiveMode === 'register' && !challengeId && <p role="status">{t('Telegram подтверждён. Нажмите кнопку регистрации, чтобы получить код на почту.', 'Telegram verified. Submit registration to receive your email code.')}</p>}
      {signupUnavailable && <p className="scenza-auth-availability" role="status">{t('Регистрация ещё не открыта: завершаем подключение сервиса и юридическое оформление. Пока доступно демо.', 'Registration is not open yet. Service setup and legal documents are being finalized. Explore the demo meanwhile.')}</p>}
      {config?.botRegistrationEnabled && !config?.telegramBotEnabled && <p className="scenza-auth-availability"><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Открыть Telegram-бота SCENZA', 'Open the SCENZA Telegram bot')}</a>. {t('Вход через Telegram на сайте пока недоступен.', 'Telegram login on the website is not available yet.')}</p>}
      <form id="scenza-auth-form" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} noValidate onSubmit={event => {
        event.preventDefault(); if (!accepted()) return; setTelegramChallenge(null);
        if (challengeId) { if (code.length !== emailCodeLength || !/^\d+$/.test(code)) { setError(t(`Введите ${emailCodeLength} цифр из письма.`, `Enter the ${emailCodeLength}-digit email code.`)); return; } void run(() => authRequest<AuthResult>('email/verify', { challengeId, code })); return; }
        const invalid = validateAuth({ email, password, name, requireName: mode === 'register' }); setErrors(invalid); if (Object.keys(invalid).length) { document.getElementById(invalid.name ? 'scenza-name' : invalid.email ? 'scenza-email' : 'scenza-password')?.focus(); return; }
        void run(() => authAdapter.submit(effectiveMode, { email, password, ...(mode === 'register' ? { name: name.trim(), ref: savedReferral() } : {}) }, { remember, termsAccepted, dataConsent }));
      }}>
        {challengeId ? <><label htmlFor="scenza-code">{t('Код из письма', 'Email code')}</label><input id="scenza-code" inputMode="numeric" autoComplete="one-time-code" maxLength={emailCodeLength} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} autoFocus /><button type="button" className="scenza-auth-text-button" onClick={() => { setChallengeId(''); setCode(''); setError(''); }}>{t('Указать другую почту или запросить новый код', 'Change email or request another code')}</button></> : <>
          {mode === 'register' && <><label htmlFor="scenza-name">{copy.auth.name}</label><div className="scenza-auth-input"><UserRound size={19} /><input id="scenza-name" type="text" autoComplete="nickname" maxLength={60} value={name} placeholder={copy.auth.namePlaceholder} onChange={event => setName(event.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} /></div>{errors.name && <p className="scenza-field-error" id="name-error" role="alert">{copy.auth.invalidName}</p>}</>}
          <label htmlFor="scenza-email">{copy.auth.email}</label><div className="scenza-auth-input"><Mail size={19} /><input id="scenza-email" type="email" autoComplete="email" maxLength={254} value={email} placeholder="you@example.com" onChange={event => setEmail(event.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} /></div>{errors.email && <p className="scenza-field-error" id="email-error" role="alert">{copy.auth.invalidEmail}</p>}
          <label htmlFor="scenza-password">{reset ? t('Новый пароль', 'New password') : copy.auth.password}</label><div className="scenza-auth-input"><LockKeyhole size={19} /><input id="scenza-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' || reset ? 'new-password' : 'current-password'} maxLength={128} value={password} placeholder={copy.auth.passwordPlaceholder} onChange={event => setPassword(event.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} /><button type="button" aria-label={showPassword ? t('Скрыть пароль', 'Hide password') : t('Показать пароль', 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>{errors.password && <p className="scenza-field-error" id="password-error" role="alert">{t('Пароль должен содержать не менее 8 символов.', 'Use at least 8 characters.')}</p>}
          {mode === 'login' && <div className="scenza-auth-options"><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t('Запомнить меня', 'Remember me')}</label><button type="button" disabled={busy} onClick={() => { generation.current++; setTelegramChallenge(null); setReset(!reset); setPassword(''); setError(''); }}>{reset ? t('Вернуться ко входу', 'Back to login') : t('Забыли пароль?', 'Forgot password?')}</button></div>}
          {mode === 'register' && <div className="scenza-auth-consents"><label><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} /><span>{t('Принимаю ', 'I accept the ')}<a href="/legal/terms" target="_blank" rel="noopener">{t('пользовательское соглашение', 'terms of use')}</a>.</span></label><label><input type="checkbox" checked={dataConsent} onChange={event => setDataConsent(event.target.checked)} /><span>{t('Даю отдельное ', 'I give separate ')}<a href="/legal/consent" target="_blank" rel="noopener">{t('согласие на обработку персональных данных', 'consent to personal data processing')}</a>.</span></label></div>}
        </>}
        <Button type="submit" disabled={busy || !!telegramChallenge || !config?.emailEnabled || signupUnavailable} className="scenza-auth-submit" aria-busy={busy}>{busy ? t('Подождите…', 'Please wait…') : challengeId ? t('Подтвердить и войти', 'Verify and log in') : reset ? t('Получить код', 'Send verification code') : mode === 'register' ? t('Создать аккаунт', 'Create account') : t('Войти', 'Log in')}</Button>
        {!config?.emailEnabled && <p className="scenza-auth-availability">{t('Вход по почте будет доступен после подключения почтового сервиса.', 'Email login will be available after the email service is connected.')}</p>}
      </form>
      {!reset && !challengeId && <><p className="scenza-auth-switch">{mode === 'login' ? t('Нет аккаунта? ', 'New here? ') : t('Уже есть аккаунт? ', 'Already registered? ')}<button type="button" disabled={busy} onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('Перейти к регистрации', 'Create an account') : t('Войти', 'Log in')}</button></p><div className="scenza-auth-divider"><span>{t('или', 'or')}</span></div><div className="scenza-telegram-auth"><h3>{t('Вход через Telegram', 'Log in with Telegram')}</h3><p>{t('Подтвердите вход в боте и вернитесь в эту вкладку. Почта не нужна.', 'Confirm login in the bot, then return to this tab. No email required.')}</p><Button variant="outline" disabled={busy || !!telegramChallenge || !config?.telegramBotEnabled} onClick={() => void telegram()}><Send size={21} />{telegramChallenge ? t('Ожидаем подтверждения…', 'Waiting for confirmation…') : t('Войти через Telegram', 'Log in with Telegram')}</Button>{telegramChallenge && <p role="status"><a href={telegramChallenge.url} target="_blank" rel="noopener noreferrer">{t('Открыть бота SCENZA', 'Open the SCENZA bot')}</a><br />{telegramChallenge.emailProof ? t('Подпишитесь на канал, нажмите «Старт» и подтвердите Telegram в боте. Затем вернитесь сюда для подтверждения почты.', 'Subscribe to the channel, tap Start and confirm Telegram in the bot. Return here to verify your email.') : t('Нажмите «Старт» и подтвердите вход. Студия откроется автоматически.', 'Tap Start and confirm login. The studio will open automatically.')}<br /><button type="button" className="scenza-auth-text-button" onClick={() => setTelegramChallenge(null)}>{t('Отменить ожидание', 'Cancel waiting')}</button></p>}{!config?.telegramBotEnabled && <small>{t('Подключение Telegram готовится.', 'Telegram setup is in progress.')}</small>}</div></>}
      {mode === 'register' && !challengeId && <details className="scenza-auth-plan-details"><summary>{t('Тариф, когда закончатся подарочные токены', 'Plan after your free tokens')}: {selection ? copy.pricing.plans[selection.planId].name : copy.pricing.plans.trial.name}</summary><fieldset className="scenza-auth-plans"><legend>{copy.auth.selectedPlan}</legend><div>{demoPlans.map(plan => <label key={plan.id}><input type="radio" name="registration-plan" checked={selection?.planId === plan.id} onChange={() => onPlanChange({ planId: plan.id, period: 'month' })} /><span>{copy.pricing.plans[plan.id].name}<small>{en ? '$' : ''}{planPrice(plan, en ? 'en' : 'ru').toLocaleString(en ? 'en-US' : 'ru-RU')}{en ? '' : ' ₽'}</small></span></label>)}</div><p>{t('Онлайн-оплата пока не подключена. Выбор тарифа не оформляет покупку: тариф подключает администратор.', 'Online payment is not connected yet. Choosing a plan does not make a purchase: the administrator activates plans.')}</p></fieldset></details>}
      <p className="scenza-auth-privacy"><ShieldCheck size={20} /><span>{t('Как используются ваши данные — в ', 'How your data is used: ')}<a href="/legal/privacy" target="_blank" rel="noopener">{t('политике обработки персональных данных', 'privacy policy')}</a>.</span></p><button className="scenza-demo-link" type="button" onClick={onDemo}>{copy.auth.next}<ArrowRight size={15} /></button>
    </>}
    {error && <p className="scenza-auth-error" role="alert">{error}</p>}
  </Dialog>{supportOpen && <Support onClose={() => setSupportOpen(false)} />}</>;
}
