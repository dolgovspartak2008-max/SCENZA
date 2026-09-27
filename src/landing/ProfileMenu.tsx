import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, LogOut, UserRound } from 'lucide-react';
import { ShinyButton as Button } from '@/components/ui/shiny-button';
import { authRequest } from './auth';
import type { Account } from './auth';
import type { Language } from './plans';

const HOUR = 3600000;

function remaining(end: string | null | undefined, en: boolean) {
  const left = (Date.parse(end ?? '') || 0) - Date.now();
  if (left <= 0) return null;
  const days = Math.floor(left / (24 * HOUR));
  const hours = Math.floor(left % (24 * HOUR) / HOUR);
  if (en) return days ? `${days} d ${hours} h` : `${Math.max(1, hours)} h`;
  return days ? `${days} дн. ${hours} ч.` : `${Math.max(1, hours)} ч.`;
}

export function ProfileMenu({ account, language, onAccountChange, onPricing }: { account: Account; language: Language; onAccountChange: (account: Account | null) => void; onPricing: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const en = language === 'en';
  const t = (ru: string, english: string) => en ? english : ru;
  const label = account.name || account.email || t('Профиль', 'Profile');
  const end = account.accessUntil || account.trialEndsAt;
  const left = account.accessActive ? remaining(end, en) : null;
  const trial = !account.accessSource || account.accessSource === 'trial';

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  async function logout() {
    setBusy(true);
    try { await authRequest('logout', {}); onAccountChange(null); setOpen(false); }
    catch { /* The session stays as it was; the user can retry. */ }
    finally { setBusy(false); }
  }

  return <div ref={root} className="scenza-profile">
    <Button ref={button} variant="outline" size="sm" className="scenza-account-button" title={label} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}><UserRound size={17} /><span>{label}</span></Button>
    {open && <div id={panelId} className="scenza-profile-panel" role="region" aria-label={t('Профиль', 'Profile')}>
      <div className="scenza-profile-head"><span className="scenza-profile-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span><div><strong>{label}</strong>{account.email && <small>{account.email}</small>}{!account.email && account.telegramUsername && <small>@{account.telegramUsername}</small>}</div></div>
      <div className="scenza-profile-access" data-active={account.accessActive}>
        <span>{account.accessActive ? trial ? t('Пробный доступ', 'Trial access') : t('Подписка активна', 'Subscription active') : t('Доступ не активен', 'No active access')}</span>
        {left ? <strong>{t('Осталось: ', 'Time left: ')}{left}</strong> : <strong>{t('Срок истёк', 'Expired')}</strong>}
        {end && <small>{t('до ', 'until ')}{new Date(end).toLocaleString(en ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</small>}
      </div>
      {account.blocked && <p className="scenza-profile-warning" role="status">{t('Обработка видео заблокирована: ', 'Video processing is blocked: ')}{account.blockReason || t('обратитесь в поддержку.', 'contact support.')}</p>}
      {account.accessActive && <Button asChild size="sm"><a href="/app">{t('Перейти в студию', 'Open the studio')}<ArrowRight size={16} /></a></Button>}
      <Button variant="outline" size="sm" onClick={() => { setOpen(false); onPricing(); }}>{t('Продлить доступ', 'Extend access')}</Button>
      <div className="scenza-profile-links"><a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">{t('Поддержка и промокоды', 'Support and promo codes')}</a><button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={15} />{t('Выйти', 'Log out')}</button></div>
    </div>}
  </div>;
}
