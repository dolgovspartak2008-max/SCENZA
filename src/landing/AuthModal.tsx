import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Send, ShieldCheck, UserRound, UserRoundPlus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { authAdapter, authRequest, loadTelegram, validateAuth } from './auth';
import type { Account, AuthConfig, AuthFieldErrors, AuthMode, AuthResult } from './auth';
import { demoPlans, monthlyEquivalent } from './plans';
import type { PlanSelection } from './plans';
import { content } from './content';
import './auth-legal.css';

export function AuthModal({ open, mode, setMode, close, copy, selection, onPlanChange, restoreFocus, onDemo }: {
  open: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; close: () => void;
  copy: typeof content.ru; selection: PlanSelection | null; onPlanChange: (plan: PlanSelection) => void;
  restoreFocus: HTMLElement | null; onDemo: () => void;
}) {
  const en = copy === content.en;
  const t = (ru: string, english: string) => en ? english : ru;
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [dataConsent, setDataConsent] = useState(false);
  const [reset, setReset] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<AuthFieldErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [telegramReady, setTelegramReady] = useState(false);
  const nonce = useRef('');
  const generation = useRef(0);
  const effectiveMode: AuthMode = reset ? 'reset' : mode;
  useEffect(() => {
    generation.current++;
    let active = true;
    if (!open) { setPassword(''); setCode(''); setChallengeId(''); setError(''); setErrors({}); setBusy(false); setReset(false); setTermsAccepted(false); setDataConsent(false); setTelegramReady(false); return; }
    Promise.all([authRequest<AuthConfig>('config'), authRequest<{ user: Account | null }>('session')])
      .then(([next, session]) => { if (active) { setConfig(next); setAccount(session.user); } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; generation.current++; };
  }, [open]);
  function changeMode(next: 'login' | 'register') {
    generation.current++; setMode(next); setReset(false); setChallengeId(''); setCode(''); setPassword(''); setError(''); setErrors({}); setTermsAccepted(false); setDataConsent(false); setTelegramReady(false);
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
      if (current !== generation.current) return;
      if (result.user) { setAccount(result.user); setPassword(''); setCode(''); setChallengeId(''); }
      else if (result.verificationRequired && result.challengeId) { setChallengeId(result.challengeId); setPassword(''); }
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : t('Не удалось войти.', 'Login failed.')); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function telegram() {
    if (!accepted()) return;
    if (!config?.telegramEnabled) { setError(t('Вход через Telegram пока не открыт. Подключение бота готовится.', 'Telegram login is not available yet.')); return; }
    if (!telegramReady) {
      const current = generation.current;
      setBusy(true); setError('');
      try {
        const [, challenge] = await Promise.all([loadTelegram(), authRequest<{ nonce: string }>('telegram/challenge', {})]);
        if (current === generation.current) { nonce.current = challenge.nonce; setTelegramReady(true); }
      } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Telegram недоступен.'); }
      finally { if (current === generation.current) setBusy(false); }
      return;
    }
    // Open synchronously from the second click so browsers do not block the popup.
    const current = generation.current;
    window.Telegram?.Login?.auth({ client_id: Number(config.telegramClientId), scope: ['profile', 'write'], lang: en ? 'en' : 'ru', nonce: nonce.current }, data => {
      if (current !== generation.current) return;
      setTelegramReady(false);
      if (!data.id_token) { setError(t('Вход в Telegram отменён или не завершён. Повторите попытку.', 'Telegram login was cancelled or did not finish. Try again.')); return; }
      void run(() => authRequest<AuthResult>('telegram', { idToken: data.id_token, mode, remember, termsAccepted, dataConsent }));
    });
  }
  const title = account ? t('Ваш аккаунт SCENZA', 'Your SCENZA account') : challengeId ? t('Подтвердите почту', 'Verify your email') : reset ? t('Восстановление доступа', 'Reset your password') : mode === 'login' ? t('Вход в систему', 'Log in to SCENZA') : t('Регистрация', 'Create an account');
  const signupUnavailable = effectiveMode === 'register' && !config?.legalReady;
  const accessEnd = account?.accessUntil || account?.trialEndsAt;
  const trialAccess = !account?.accessSource || account.accessSource === 'trial';
  return <Dialog open={open} onClose={close} title={title} closeLabel={copy.close} restoreFocus={restoreFocus} className="scenza-auth-dialog">
    {account ? <div className="scenza-account">
      <ShieldCheck size={32} /><h2>{title}</h2><p>{account.email || account.name}</p>
      <div className="scenza-trial-note"><strong>{account.accessActive ? trialAccess ? t('Пробный доступ активен', 'Your trial is active') : t('Доступ активен', 'Your access is active') : account.trialStartedAt ? t('Срок доступа завершён', 'Your access has ended') : t('Пробный период ещё не начался', 'Your trial has not started yet')}</strong>{accessEnd && <p>{t('Доступ до: ', 'Access until: ')}{new Date(accessEnd).toLocaleString(en ? 'en-GB' : 'ru-RU')}</p>}<p>{t('Автосписаний нет. Продлить доступ можно промокодом или через администратора.', 'No automatic charges. Extend access with a promo code or contact the administrator.')}</p></div>
      {account.accessActive && <Button asChild className="scenza-auth-submit"><a href="/app">{t('Перейти в студию', 'Open the studio')}<ArrowRight size={18} /></a></Button>}
      <p><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Доступ и промокоды в Telegram-боте', 'Access and promo codes in our Telegram bot')}</a></p>
      <button className="scenza-auth-text-button" disabled={busy} onClick={() => void run(async () => { await authRequest('logout', {}); setAccount(null); return {}; })}>{t('Выйти из аккаунта', 'Log out')}</button>
    </div> : <>
      <div className="scenza-auth-tabs" role="tablist" aria-label={t('Способ доступа', 'Account access')}>{(['login', 'register'] as const).map(value => <button type="button" key={value} id={`auth-tab-${value}`} role="tab" aria-selected={mode === value} aria-controls="scenza-auth-form" tabIndex={mode === value ? 0 : -1} disabled={busy} onClick={() => changeMode(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const next = mode === 'login' ? 'register' : 'login'; changeMode(next); document.getElementById(`auth-tab-${next}`)?.focus(); } }}>{value === 'login' ? <UserRound size={19} /> : <UserRoundPlus size={19} />}{value === 'login' ? t('Вход', 'Log in') : t('Регистрация', 'Register')}</button>)}</div>
      <div className="scenza-auth-heading"><h2>{title}</h2><p>{challengeId ? t(`Если действие доступно для ${email}, вы получите письмо с кодом. Проверьте также папку «Спам».`, `If this action is available for ${email}, you will receive a code. Please also check spam.`) : reset ? t('Укажите почту и новый пароль. Изменение нужно подтвердить кодом из письма.', 'Enter your email and new password, then verify the change with an email code.') : t('По электронной почте или через Telegram', 'With your email or Telegram account')}</p></div>
      {mode === 'register' && !challengeId && <div className="scenza-trial-note"><strong>{t('7 дней бесплатно', '7 days free')}</strong><p>{t('Без привязки карты. Затем — оплата выбранного тарифа вручную.', 'No card required. Afterwards, pay for your chosen plan manually.')}</p></div>}
      {signupUnavailable && <p className="scenza-auth-availability" role="status">{t('Регистрация ещё не открыта: завершаем подключение сервиса и юридическое оформление. Пока доступно демо.', 'Registration is not open yet. Service setup and legal documents are being finalized. Explore the demo meanwhile.')}</p>}
      {config?.botRegistrationEnabled && <p className="scenza-auth-availability"><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Создать аккаунт в Telegram-боте SCENZA', 'Create an account in the SCENZA Telegram bot')}</a>. {t('Вход на сайт откроется после его подключения.', 'Website login will be available after setup.')}</p>}
      <form id="scenza-auth-form" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} noValidate onSubmit={event => {
        event.preventDefault(); if (!accepted()) return;
        if (challengeId) { if (!/^\d{6}$/.test(code)) { setError(t('Введите 6 цифр из письма.', 'Enter the 6-digit email code.')); return; } void run(() => authRequest<AuthResult>('email/verify', { challengeId, code })); return; }
        const invalid = validateAuth({ email, password }); setErrors(invalid); if (Object.keys(invalid).length) { document.getElementById(invalid.email ? 'scenza-email' : 'scenza-password')?.focus(); return; }
        void run(() => authAdapter.submit(effectiveMode, { email, password }, { remember, termsAccepted, dataConsent }));
      }}>
        {challengeId ? <><label htmlFor="scenza-code">{t('Код из письма', 'Email code')}</label><input id="scenza-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} autoFocus /><button type="button" className="scenza-auth-text-button" onClick={() => { setChallengeId(''); setCode(''); setError(''); }}>{t('Указать другую почту или запросить новый код', 'Change email or request another code')}</button></> : <>
          <label htmlFor="scenza-email">{copy.auth.email}</label><div className="scenza-auth-input"><Mail size={19} /><input id="scenza-email" type="email" autoComplete="email" maxLength={254} value={email} placeholder="you@example.com" onChange={event => setEmail(event.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} /></div>{errors.email && <p className="scenza-field-error" id="email-error" role="alert">{copy.auth.invalidEmail}</p>}
          <label htmlFor="scenza-password">{reset ? t('Новый пароль', 'New password') : copy.auth.password}</label><div className="scenza-auth-input"><LockKeyhole size={19} /><input id="scenza-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' || reset ? 'new-password' : 'current-password'} maxLength={128} value={password} placeholder={copy.auth.passwordPlaceholder} onChange={event => setPassword(event.target.value)} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} /><button type="button" aria-label={showPassword ? t('Скрыть пароль', 'Hide password') : t('Показать пароль', 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>{errors.password && <p className="scenza-field-error" id="password-error" role="alert">{t('Пароль должен содержать не менее 8 символов.', 'Use at least 8 characters.')}</p>}
          {mode === 'login' && <div className="scenza-auth-options"><label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t('Запомнить меня', 'Remember me')}</label><button type="button" onClick={() => { setReset(!reset); setPassword(''); setError(''); }}>{reset ? t('Вернуться ко входу', 'Back to login') : t('Забыли пароль?', 'Forgot password?')}</button></div>}
          {mode === 'register' && <div className="scenza-auth-consents"><label><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} /><span>{t('Принимаю ', 'I accept the ')}<a href="/legal/terms" target="_blank" rel="noopener">{t('пользовательское соглашение', 'terms of use')}</a>{t(' и условия ', ' and ')}<a href="/legal/offer" target="_blank" rel="noopener">{t('оферты', 'offer')}</a>.</span></label><label><input type="checkbox" checked={dataConsent} onChange={event => setDataConsent(event.target.checked)} /><span>{t('Даю отдельное ', 'I give separate ')}<a href="/legal/consent" target="_blank" rel="noopener">{t('согласие на обработку персональных данных', 'consent to personal data processing')}</a>.</span></label></div>}
        </>}
        <Button type="submit" disabled={busy || !config?.emailEnabled || signupUnavailable} className="scenza-auth-submit" aria-busy={busy}>{busy ? t('Подождите…', 'Please wait…') : challengeId ? t('Подтвердить и войти', 'Verify and log in') : reset ? t('Получить код', 'Send verification code') : mode === 'register' ? t('Создать аккаунт', 'Create account') : t('Войти', 'Log in')}</Button>
        {!config?.emailEnabled && <p className="scenza-auth-availability">{t('Вход по почте будет доступен после подключения почтового сервиса.', 'Email login will be available after the email service is connected.')}</p>}
      </form>
      {!reset && !challengeId && <><p className="scenza-auth-switch">{mode === 'login' ? t('Нет аккаунта? ', 'New here? ') : t('Уже есть аккаунт? ', 'Already registered? ')}<button type="button" disabled={busy} onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? t('Перейти к регистрации', 'Create an account') : t('Войти', 'Log in')}</button></p><div className="scenza-auth-divider"><span>{t('или', 'or')}</span></div><div className="scenza-telegram-auth"><h3>{t('Вход через Telegram', 'Log in with Telegram')}</h3><p>{t('Без привязки электронной почты', 'No email address required')}</p><Button variant="outline" disabled={busy || !config?.telegramEnabled || signupUnavailable} onClick={() => void telegram()}><Send size={21} />{telegramReady ? t('Открыть Telegram', 'Open Telegram') : t('Войти через Telegram', 'Log in with Telegram')}</Button>{!config?.telegramEnabled && <small>{t('Подключение Telegram готовится.', 'Telegram setup is in progress.')}</small>}</div></>}
      {mode === 'register' && !challengeId && <details className="scenza-auth-plan-details"><summary>{t('Тариф после пробного периода', 'Plan after the trial')}: {selection ? copy.pricing.plans[selection.planId].name : copy.pricing.plans.trial.name}</summary><fieldset className="scenza-auth-plans"><legend>{copy.auth.selectedPlan}</legend><div>{demoPlans.map(plan => <label key={plan.id}><input type="radio" name="registration-plan" checked={selection?.planId === plan.id} onChange={() => onPlanChange({ planId: plan.id, period: selection?.period ?? 'month' })} /><span>{copy.pricing.plans[plan.id].name}<small>{monthlyEquivalent(plan, selection?.period ?? 'month').toLocaleString()} ₽</small></span></label>)}</div>{selection && selection.planId !== 'trial' && <label className="scenza-auth-period">{t('Период оплаты', 'Billing period')}<select value={selection.period} onChange={event => onPlanChange({ ...selection, period: event.target.value as 'month' | 'year' })}><option value="month">{copy.pricing.month}</option><option value="year">{copy.pricing.year}</option></select></label>}<p>{t('Цены пока демонстрационные. Выбор не оформляет покупку.', 'Prices are illustrative. Choosing a plan does not make a purchase.')}</p></fieldset></details>}
      <p className="scenza-auth-privacy"><ShieldCheck size={20} /><span>{t('Как используются ваши данные — в ', 'How your data is used: ')}<a href="/legal/privacy" target="_blank" rel="noopener">{t('политике обработки персональных данных', 'privacy policy')}</a>.</span></p><button className="scenza-demo-link" type="button" onClick={onDemo}>{copy.auth.next}<ArrowRight size={15} /></button>
    </>}
    {error && <p className="scenza-auth-error" role="alert">{error}</p>}
  </Dialog>;
}
