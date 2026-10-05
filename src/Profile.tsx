import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Coins, Copy, Gift, Send, Share2, Trash2, UserRound, Users } from 'lucide-react';
import { request } from './api';
import { authRequest } from './landing/auth';
import type { Account } from './landing/auth';
import { NotificationList, useNotifications } from './Notifications';
import type { NotificationItem } from './Notifications';
import type { Navigate, Notify } from './model';
import './profile.css';

type TokenEntry = { id: string; tokens: number; reason: string; note: string; createdAt: string };
type Usage = { sourceMinutes: number; sourceCount: number; editRequests: number; tokens?: number; tokenHistory?: TokenEntry[] };
type Referrals = { code: string; bonus: number; share: number; limit: number; earned: number; invited: { name: string; joinedAt: string | null; rewarded: boolean }[] };
export type ProfileTab = 'overview' | 'referrals' | 'notifications';

const reasons: Record<string, string> = { trial: 'Стартовые токены', purchase: 'Тариф', grant: 'Начисление', referral: 'Реферальный бонус', promo: 'Промокод', analysis: 'Анализ видео', refund: 'Возврат', bonus: 'Бонус за публикацию' };
const tabs: [ProfileTab, string][] = [['overview', 'Профиль'], ['referrals', 'Рефералы'], ['notifications', 'Уведомления']];
const day = (value?: string | null) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const word = (count: number, one: string, few: string, many: string) => count % 10 === 1 && count % 100 !== 11 ? one : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? few : many;

export default function Profile({ tab, navigate, notify }: { tab: ProfileTab; navigate: Navigate; notify: Notify }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [referrals, setReferrals] = useState<Referrals | null>(null);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [promo, setPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const notifications = useNotifications();
  // The server answers 404 when there is no photo; the image error then falls back to the initial.
  const [avatar, setAvatar] = useState<string | null>('/api/account/avatar');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const session = await request<{ user: Account | null }>('/api/auth/session');
      setAccount(session.user);
      if (!session.user) return;
      const [nextUsage, nextReferrals] = await Promise.all([request<Usage>('/api/video/usage'), request<Referrals>('/api/account/referrals')]);
      setUsage(nextUsage); setReferrals(nextReferrals); setError('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить профиль.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Opening the tab is reading it.
  useEffect(() => { if (tab === 'notifications' && notifications.feed?.unread) void notifications.markRead(); }, [tab, notifications.feed?.unread, notifications.markRead]);

  const link = referrals ? `${location.origin}/?ref=${referrals.code}` : '';
  const open = (item: NotificationItem) => { if (item.action === 'support') document.querySelector<HTMLButtonElement>('button[aria-label="Поддержка"]')?.click(); else if (item.link) navigate(item.link.replace(/^\/app/, '') || '/'); };
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { notify('Не удалось скопировать — выделите ссылку и скопируйте вручную.'); }
  }
  async function share() {
    if (!navigator.share) { void copy(); return; }
    await navigator.share({ title: 'SCENZA', text: `Делаю короткие ролики с AI в SCENZA. По моей ссылке +${referrals?.bonus ?? 20} токенов при регистрации:`, url: link }).catch(() => undefined);
  }
  async function changeAvatar(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 ** 2) { notify('Выберите фото JPG, PNG или WebP до 5 МБ.'); return; }
    setAvatarBusy(true);
    try {
      const result = await request<{ avatar: string }>('/api/account/avatar', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setAvatar(result.avatar); window.dispatchEvent(new CustomEvent('scenza:avatar', { detail: result.avatar })); notify('Фото профиля обновлено.');
    } catch (problem) { notify(problem instanceof Error ? problem.message : 'Не удалось загрузить фото.'); }
    finally { setAvatarBusy(false); }
  }
  async function removeAvatar() {
    setAvatarBusy(true);
    try { await request('/api/account/avatar', { method: 'DELETE' }); setAvatar(null); window.dispatchEvent(new CustomEvent('scenza:avatar', { detail: null })); notify('Фото профиля удалено.'); }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Не удалось удалить фото.'); }
    finally { setAvatarBusy(false); }
  }
  async function redeem() {
    if (!promo.trim()) return;
    setBusy(true);
    try { const result = await authRequest<{ user: Account }>('promo', { code: promo.trim() }); setAccount(result.user); setPromo(''); notify('Промокод активирован.'); void notifications.load(); }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Не удалось активировать промокод.'); }
    finally { setBusy(false); }
  }

  if (!account && !error) return <div className="profile-page"><div className="page-intro"><h1>Профиль</h1></div><p className="loading-panel">{loaded ? <>Войдите в аккаунт, чтобы открыть профиль. <a href="/">На главную</a></> : 'Загружаем профиль…'}</p></div>;
  const invited = referrals?.invited.length ?? 0;
  return <div className="profile-page">
    <div className="page-intro"><h1>Профиль</h1><p>Аккаунт, токены, приглашения друзей и уведомления</p></div>
    {error && <div className="connection-error" role="alert"><span>{error}</span><button className="button outline" onClick={() => void load()}>Повторить</button></div>}
    <div className="profile-tabs" role="tablist" aria-label="Разделы профиля">{tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'is-active' : ''} onClick={() => navigate(value === 'overview' ? '/profile' : `/profile?tab=${value}`)}>{label}{value === 'notifications' && !!notifications.feed?.unread && <span className="profile-tab-badge">{notifications.feed.unread}</span>}</button>)}</div>

    {tab === 'overview' && account && <div className="profile-grid" role="tabpanel">
      <section className="panel profile-card profile-account"><div className="profile-avatar-box"><button type="button" className="profile-avatar" disabled={avatarBusy} aria-label={avatar ? 'Сменить фото профиля' : 'Добавить фото профиля'} onClick={() => avatarInput.current?.click()}>{avatar ? <img src={avatar} alt="" onError={() => setAvatar(null)} /> : <span aria-hidden="true">{(account.name || account.email || 'S').slice(0, 1).toUpperCase()}</span>}<i aria-hidden="true"><Camera size={14} /></i></button>
        <input ref={avatarInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void changeAvatar(file); }} />
        {avatar && <button type="button" className="profile-avatar-remove" disabled={avatarBusy} onClick={() => void removeAvatar()}><Trash2 size={13} aria-hidden="true" />Удалить</button>}</div><div><h2>{account.name || 'Пользователь'}</h2>{account.email && <p>{account.email}</p>}<p className="profile-muted">С нами с {day(account.createdAt)}</p></div>
        <dl><div><dt>Вход</dt><dd>{account.provider === 'telegram' ? 'Telegram' : 'Email'}</dd></div><div><dt>Telegram</dt><dd>{account.telegramUserId ? <><Send size={14} aria-hidden="true" /> привязан{account.telegramUsername ? ` · @${account.telegramUsername}` : ''}</> : <a href="https://t.me/SCENZA_BOT" target="_blank" rel="noopener noreferrer">Привязать</a>}</dd></div><div><dt>Доступ</dt><dd>{account.blocked ? 'Обработка приостановлена' : account.accessActive ? account.accessSource === 'trial' || !account.accessSource ? 'Бесплатный старт' : `Активен${account.accessUntil ? ` до ${day(account.accessUntil)}` : ''}` : 'Не активен'}</dd></div></dl>
        {account.blocked && <p className="profile-warning" role="status">Создание роликов приостановлено: {account.blockReason || 'обратитесь в поддержку.'}</p>}
      </section>
      <section className="panel profile-card profile-balance"><h2><Coins size={18} aria-hidden="true" />Баланс</h2><strong>{usage?.tokens ?? '—'}<small>{usage?.tokens !== undefined ? ` ${word(usage.tokens, 'токен', 'токена', 'токенов')}` : ''}</small></strong><p className="profile-muted">1 токен = 1 минута исходного видео. Токены не сгорают; превью, правки баннера и субтитров вручную — бесплатно.</p>
        <div className="profile-stats"><div><span>Видео за месяц</span><b>{usage ? `${Math.round(usage.sourceMinutes)} мин` : '—'}</b></div><div><span>Загрузок</span><b>{usage?.sourceCount ?? '—'}</b></div><div><span>AI-правок</span><b>{usage?.editRequests ?? '—'}</b></div></div>
        <a className="button primary" href="/#pricing">Пополнить токены</a>
      </section>
      <section className="panel profile-card"><h2>История токенов</h2>{usage?.tokenHistory?.length ? <ul className="profile-history">{usage.tokenHistory.slice(0, 15).map(entry => <li key={entry.id}><span>{reasons[entry.reason] ?? entry.reason}<small>{day(entry.createdAt)}{entry.note && entry.reason !== 'bonus' ? ` · ${entry.note}` : ''}</small></span><b data-positive={entry.tokens > 0}>{entry.tokens > 0 ? '+' : ''}{entry.tokens}</b></li>)}</ul> : <p className="profile-muted">Пока нет операций.</p>}</section>
      <section className="panel profile-card"><h2>Промокод</h2><form className="profile-row" onSubmit={event => { event.preventDefault(); void redeem(); }}><input value={promo} maxLength={32} placeholder="PROMO2026" aria-label="Промокод" onChange={event => setPromo(event.target.value)} /><button className="button outline" disabled={busy || !promo.trim()}>Применить</button></form>
        <button type="button" className="profile-referral-teaser" onClick={() => navigate('/profile?tab=referrals')}><Gift size={18} aria-hidden="true" /><span><b>Приведи друга — +{referrals?.bonus ?? 20} токенов вам обоим</b><small>Ссылка, правила и приглашённые друзья — во вкладке «Рефералы»</small></span></button>
      </section>
    </div>}

    {tab === 'referrals' && <div className="profile-referrals" role="tabpanel">
      <section className="panel profile-card profile-invite"><h2><Gift size={19} aria-hidden="true" />Ваша реферальная ссылка</h2><p>Отправьте ссылку другу. Когда он зарегистрируется по ней, вы оба получите по {referrals?.bonus ?? 20} токенов, а вы — ещё {Math.round((referrals?.share ?? .1) * 100)}% токенов с каждой его покупки.</p>
        <div className="profile-row"><input readOnly value={link || 'Загружаем…'} aria-label="Реферальная ссылка" onFocus={event => event.target.select()} /><button type="button" className="button primary" disabled={!link} onClick={() => void copy()}>{copied ? <><Check size={16} />Скопировано</> : <><Copy size={16} />Скопировать</>}</button><button type="button" className="button outline" disabled={!link} onClick={() => void share()}><Share2 size={16} />Поделиться</button></div>
        {referrals && <p className="profile-muted">Код приглашения: <code>{referrals.code}</code></p>}
      </section>
      <div className="profile-referral-stats"><div className="panel"><Users size={18} aria-hidden="true" /><span>Приглашено друзей</span><b>{invited}</b></div><div className="panel"><Coins size={18} aria-hidden="true" /><span>Заработано токенов</span><b>{referrals?.earned ?? 0}</b></div><div className="panel"><Gift size={18} aria-hidden="true" /><span>Бонус за друга</span><b>+{referrals?.bonus ?? 20}</b></div></div>
      <section className="panel profile-card"><h2>Как это работает</h2><ol className="profile-steps"><li><b>Поделитесь ссылкой</b><span>Скопируйте ссылку выше и отправьте другу в мессенджере или опубликуйте в соцсетях.</span></li><li><b>Друг регистрируется</b><span>Регистрация должна пройти по вашей ссылке — через email или Telegram на сайте.</span></li><li><b>Оба получают токены</b><span>Сразу после регистрации: +{referrals?.bonus ?? 20} токенов вам и +{referrals?.bonus ?? 20} другу. Придёт уведомление.</span></li><li><b>Процент с покупок</b><span>Когда друг покупает тариф, вам начисляется {Math.round((referrals?.share ?? .1) * 100)}% от его токенов.</span></li></ol>
        <p className="profile-muted">Бонус за регистрацию начисляется за первых {referrals?.limit ?? 50} приглашённых. Токены не сгорают. Нельзя приглашать самого себя и создавать фиктивные аккаунты — такие начисления аннулируются.</p></section>
      <section className="panel profile-card"><h2>Приглашённые друзья</h2>{invited ? <ul className="profile-friends">{referrals!.invited.map((friend, index) => <li key={`${friend.joinedAt}-${index}`}><span className="profile-avatar is-small" aria-hidden="true"><UserRound size={15} /></span><span>{friend.name}<small>Зарегистрирован {day(friend.joinedAt)}</small></span><b>{friend.rewarded ? `+${referrals!.bonus}` : 'без бонуса'}</b></li>)}</ul> : <p className="profile-muted">Пока никого. Первый друг принесёт вам {referrals?.bonus ?? 20} токенов — этого хватит на {referrals?.bonus ?? 20} минут исходного видео.</p>}</section>
    </div>}

    {tab === 'notifications' && <section className="panel profile-card profile-notifications" role="tabpanel"><div className="profile-notify-head"><h2>Все уведомления</h2><button type="button" className="button outline" disabled={notifications.loading} onClick={() => void notifications.load()}>Обновить</button></div>
      {notifications.error && <p className="field-error" role="alert">{notifications.error}</p>}
      {notifications.feed ? <NotificationList items={notifications.feed.items} onOpen={open} /> : <p className="profile-muted">Загружаем…</p>}
    </section>}
  </div>;
}
