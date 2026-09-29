import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, Coins, Copy, Gift, LogOut, Send, UserRound } from 'lucide-react';
import { ShinyButton as Button } from '@/components/ui/shiny-button';
import { authRequest } from './auth';
import type { Account } from './auth';
import type { Language } from './plans';

const HOUR = 3600000;
type TokenEntry = { id: string; tokens: number; reason: string; note: string; createdAt: string };
type Usage = { sourceMinutes: number; tokens?: number; tokenHistory?: TokenEntry[] };
type Project = { id: string; title: string; status: string; createdAt: string };

const reasons: Record<string, [string, string]> = {
  trial: ['Стартовые токены', 'Welcome tokens'], purchase: ['Тариф', 'Plan'], grant: ['Начисление', 'Grant'], referral: ['Реферальный бонус', 'Referral bonus'],
  promo: ['Промокод', 'Promo code'], analysis: ['Анализ видео', 'Video analysis'], refund: ['Возврат', 'Refund'], bonus: ['Бонус за публикацию', 'Publication bonus'],
};

function remaining(end: string | null | undefined, en: boolean) {
  const left = (Date.parse(end ?? '') || 0) - Date.now();
  if (left <= 0) return null;
  const days = Math.floor(left / (24 * HOUR));
  const hours = Math.floor(left % (24 * HOUR) / HOUR);
  if (en) return days ? `${days} d ${hours} h` : `${Math.max(1, hours)} h`;
  return days ? `${days} дн. ${hours} ч.` : `${Math.max(1, hours)} ч.`;
}

async function load<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

export function ProfileMenu({ account, language, onLanguageChange, onAccountChange, onPricing }: { account: Account; language: Language; onLanguageChange: (language: Language) => void; onAccountChange: (account: Account | null) => void; onPricing: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [promo, setPromo] = useState('');
  const [promoMessage, setPromoMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const en = language === 'en';
  const t = (ru: string, english: string) => en ? english : ru;
  const label = account.name || account.email || t('Профиль', 'Profile');
  const end = account.accessUntil;
  const left = account.accessActive ? remaining(end, en) : null;
  const trial = !account.accessSource || account.accessSource === 'trial';
  const inviteLink = account.referralCode ? `${location.origin}/?ref=${account.referralCode}` : '';
  const locale = en ? 'en-GB' : 'ru-RU';

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([load<Usage>('/api/video/usage'), load<{ projects: Project[] }>('/api/video/projects')]).then(([nextUsage, list]) => {
      if (!active) return;
      setUsage(nextUsage);
      setProjects(list?.projects?.slice(0, 3) ?? []);
    });
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { active = false; document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  async function logout() {
    setBusy(true);
    try { await authRequest('logout', {}); onAccountChange(null); setOpen(false); }
    catch { /* The session stays as it was; the user can retry. */ }
    finally { setBusy(false); }
  }
  async function redeem() {
    if (!promo.trim()) return;
    setBusy(true); setPromoMessage('');
    try {
      const result = await authRequest<{ user: Account }>('promo', { code: promo.trim() });
      onAccountChange(result.user); setPromo(''); setPromoMessage(t('Промокод активирован.', 'Promo code applied.'));
    } catch (error) { setPromoMessage(error instanceof Error ? error.message : t('Не удалось активировать промокод.', 'Could not apply the promo code.')); }
    finally { setBusy(false); }
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); }
  }

  return <div ref={root} className="scenza-profile">
    <Button ref={button} variant="outline" size="sm" className="scenza-account-button" title={label} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}><UserRound size={17} /><span>{label}</span></Button>
    {open && <div id={panelId} className="scenza-profile-panel" role="region" aria-label={t('Профиль', 'Profile')}>
      <div className="scenza-profile-head"><span className="scenza-profile-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span><div><strong>{label}</strong>{account.email && <small>{account.email}</small>}</div></div>
      <div className="scenza-profile-access" data-active={account.accessActive}>
        <span>{account.accessActive ? trial ? t('Бесплатный старт', 'Free start') : t('Подписка активна', 'Subscription active') : t('Доступ не активен', 'No active access')}</span>
        {account.accessActive && trial ? <strong><Gift size={14} aria-hidden="true" /> {t('10 токенов в подарок', '10 tokens on us')}</strong> : left ? <strong>{t('Осталось: ', 'Time left: ')}{left}</strong> : <strong>{account.accessActive ? t('Без срока', 'No deadline') : t('Срок истёк', 'Expired')}</strong>}
        {!trial && end && <small>{t('до ', 'until ')}{new Date(end).toLocaleString(locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</small>}
      </div>
      <div className="scenza-profile-stats">
        <div><Coins size={16} aria-hidden="true" /><span>{t('Токены', 'Tokens')}</span><strong>{usage?.tokens ?? '—'}</strong></div>
        <div><span>{t('Видео за месяц', 'Video this month')}</span><strong>{usage ? `${Math.round(usage.sourceMinutes)} ${t('мин', 'min')}` : '—'}</strong></div>
      </div>
      <p className="scenza-profile-hint">{t('1 токен = 1 минута исходного видео. Токены не сгорают.', '1 token = 1 minute of source video. Tokens never expire.')}</p>
      {account.blocked && <p className="scenza-profile-warning" role="status">{t('Обработка видео заблокирована: ', 'Video processing is blocked: ')}{account.blockReason || t('обратитесь в поддержку.', 'contact support.')}</p>}
      {account.accessActive && <Button asChild size="sm"><a href="/app">{t('Перейти в студию', 'Open the studio')}<ArrowRight size={16} /></a></Button>}
      <Button variant="outline" size="sm" onClick={() => { setOpen(false); onPricing(); }}>{t('Пополнить токены', 'Top up tokens')}</Button>
      {projects.length > 0 && <section className="scenza-profile-section" aria-label={t('Последние проекты', 'Recent projects')}><h3>{t('Последние проекты', 'Recent projects')}</h3><ul>{projects.map(project => <li key={project.id}><a href={`/app/ai/${project.id}`}>{project.title}</a><small>{new Date(project.createdAt).toLocaleDateString(locale)}</small></li>)}</ul></section>}
      {!!usage?.tokenHistory?.length && <details className="scenza-profile-section"><summary>{t('История токенов', 'Token history')}</summary><ul>{usage.tokenHistory.slice(0, 8).map(entry => <li key={entry.id}><span>{reasons[entry.reason]?.[en ? 1 : 0] ?? entry.reason}<small>{new Date(entry.createdAt).toLocaleDateString(locale)}</small></span><strong data-positive={entry.tokens > 0}>{entry.tokens > 0 ? '+' : ''}{entry.tokens}</strong></li>)}</ul></details>}
      {inviteLink && <section className="scenza-profile-section scenza-profile-invite" aria-label={t('Приведи друга', 'Invite a friend')}><h3><Gift size={15} aria-hidden="true" />{t('Приведи друга', 'Invite a friend')}</h3><p>{t('+20 токенов вам и другу после регистрации и 10% токенов с каждой его покупки.', '+20 tokens for you and your friend after sign-up, plus 10% of tokens from each of their purchases.')}</p><div className="scenza-profile-row"><input readOnly value={inviteLink} aria-label={t('Ваша ссылка', 'Your link')} onFocus={event => event.target.select()} /><button type="button" onClick={() => void copyInvite()} aria-label={t('Скопировать ссылку', 'Copy link')}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><small>{t('Приглашено друзей: ', 'Friends invited: ')}{account.referrals ?? 0}</small></section>}
      <form className="scenza-profile-section" onSubmit={event => { event.preventDefault(); void redeem(); }}><h3>{t('Промокод', 'Promo code')}</h3><div className="scenza-profile-row"><input value={promo} maxLength={32} placeholder="PROMO2026" aria-label={t('Промокод', 'Promo code')} onChange={event => setPromo(event.target.value)} /><button type="submit" disabled={busy || !promo.trim()}>{t('Применить', 'Apply')}</button></div>{promoMessage && <small role="status">{promoMessage}</small>}</form>
      <div className="scenza-profile-section scenza-profile-settings">
        <div className="scenza-profile-language" role="group" aria-label={t('Язык интерфейса', 'Interface language')}><span>{t('Язык', 'Language')}</span><button type="button" aria-pressed={language === 'ru'} onClick={() => onLanguageChange('ru')}>RU</button><button type="button" aria-pressed={language === 'en'} onClick={() => onLanguageChange('en')}>EN</button></div>
        <div className="scenza-profile-telegram"><Send size={15} aria-hidden="true" />{account.telegramUserId ? <span>{t('Telegram привязан', 'Telegram linked')}{account.telegramUsername ? ` · @${account.telegramUsername}` : ''}</span> : <a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Привязать Telegram', 'Link Telegram')}</a>}</div>
      </div>
      <div className="scenza-profile-links"><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Поддержка', 'Support')}</a><button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={15} />{t('Выйти', 'Log out')}</button></div>
    </div>}
  </div>;
}
