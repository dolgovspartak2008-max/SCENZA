import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createPublicKey, verify } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { PLAN_TOKENS, REFERRAL_BONUS, REFERRAL_SHARE } from './ai/tokens.mjs';

const scrypt = promisify(scryptCallback);
const DAY = 86400000;
const VERSION = '2026-09-13-public-1';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const secret = () => randomBytes(32).toString('base64url');
const MAX_REFERRALS = 50;
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
const cookies = request => Object.fromEntries((request.headers.cookie || '').split(';').map(value => value.trim().split('=')).filter(([name, value]) => name && value));

async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: (await scrypt(password, salt, 64)).toString('hex') };
}

async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw fail('Ожидается JSON.', 415);
  if (Number(request.headers['content-length']) > 24000) throw fail('Запрос слишком большой.', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 24000) throw fail('Запрос слишком большой.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw fail('Некорректный запрос.'); }
}

export async function createAuth({ dataDir, telegramClientId = '', telegramBotUsername = '', telegramMembership, emailDelivery, emailAuth, accountStore, legalReady = false, botRegistrationEnabled = false, ownerTelegramIds = [], secureCookies = false, trustProxy = false, allowedOrigins = [], now = Date.now, fetch: fetcher = globalThis.fetch, tokenLedger, onRegister }) {
  if (!dataDir) throw new Error('Auth dataDir is required');
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const accountsFile = path.join(dataDir, 'accounts.json');
  let state = { accounts: [], events: [], promos: [], processed: [], sessions: [] };
  try {
    const saved = JSON.parse(await fs.readFile(accountsFile, 'utf8'));
    state = Array.isArray(saved) ? { ...state, accounts: saved } : saved;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (accountStore) state = await accountStore.load(state);
  if (!state || !['accounts', 'events', 'promos', 'processed'].every(key => Array.isArray(state[key])) || state.accounts.some(user => !user.id || !['email', 'telegram'].includes(user.provider) || !(user.trialEndsAt === null && user.trialStartedAt === null || Number.isFinite(Date.parse(user.trialEndsAt))))) throw new Error('Invalid auth account store');
  if (state.sessions === undefined) state.sessions = [];
  if (!Array.isArray(state.sessions) || state.sessions.some(item => !item || !/^[a-f0-9]{64}$/.test(item.tokenHash) || typeof item.userId !== 'string' || !Number.isFinite(item.expiresAt))) throw new Error('Invalid auth session store');
  state.sessions = state.sessions.filter(item => item.expiresAt > now());
  let accounts = state.accounts;
  const telegramId = value => /^(?:[1-9]\d{0,15})$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(value) : null;
  const owners = new Set(ownerTelegramIds.map(telegramId).filter(Boolean).slice(0, 1));
  const challenges = new Map(), telegramChallenges = new Map(), botChallenges = new Map(), limits = new Map();
  const dummyPassword = await passwordHash(secret());
  if (emailAuth && (typeof emailAuth.send !== 'function' || typeof emailAuth.verify !== 'function')) throw new Error('Invalid email verification provider');
  const emailEnabled = !!emailAuth || typeof emailDelivery === 'function';
  const emailCodeLength = emailAuth ? 8 : 6;
  const clientId = String(telegramClientId);
  const telegramEnabled = /^\d+$/.test(clientId);
  const telegramBotEnabled = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(telegramBotUsername);
  let writeQueue = Promise.resolve();
  let cachedKeys = null, keysExpiry = 0, keysAttempt = -Infinity, keysRequest;

  // ponytail: one backend owns the account snapshot; use SQL transactions before adding workers.
  function mutate(update) {
    const operation = writeQueue.then(async () => {
      const next = structuredClone(state);
      next.sessions = next.sessions.filter(item => item.expiresAt > now());
      const result = update(next.accounts, next);
      if (accountStore) await accountStore.save(next);
      else {
        const temporary = `${accountsFile}.${randomUUID()}.tmp`;
        await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
        try {
          for (let attempt = 0; ; attempt++) {
            try { await fs.rename(temporary, accountsFile); break; }
            catch (error) {
              if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
              await delay(25 * (attempt + 1));
            }
          }
        }
        catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      }
      state = next;
      accounts = next.accounts;
      return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function cleanup() {
    const current = now();
    for (const map of [challenges, telegramChallenges, botChallenges, limits]) {
      for (const [key, value] of map) if (value.expiresAt <= current) map.delete(key);
    }
  }

  function rate(key, maximum, duration = 10 * 60000) {
    const current = now();
    let entry = limits.get(key);
    if (!entry || entry.expiresAt <= current) {
      if (limits.size >= 10000) throw fail('Слишком много запросов. Попробуйте позже.', 429);
      entry = { count: 0, expiresAt: current + duration };
      limits.set(key, entry);
    }
    if (++entry.count > maximum) throw fail('Слишком много попыток. Попробуйте через 10 минут.', 429);
  }

  const referralCode = id => digest(`ref:${id}`).slice(0, 10);
  const referrerId = code => typeof code === 'string' && /^[a-f0-9]{10}$/.test(code) ? accounts.find(user => referralCode(user.id) === code)?.id || null : null;
  // Referral bonuses are granted outside the account snapshot, in the token ledger; failures never block registration.
  function registered(user) {
    if (!onRegister) return;
    const inviter = user.referredBy && accounts.find(item => item.id === user.referredBy);
    const invited = inviter ? accounts.filter(item => item.referredBy === inviter.id).length : 0;
    void Promise.resolve(onRegister({ userId: user.id, inviterId: inviter && invited <= MAX_REFERRALS ? inviter.id : null, bonus: REFERRAL_BONUS })).catch(() => console.error('SCENZA: не удалось начислить реферальный бонус.'));
  }
  function publicUser(user) {
    const extended = Date.parse(user.accessUntil) || 0;
    // The free start is a token grant (see ai/tokens.mjs), not a time limit: once started, access never expires by date.
    const started = !!user.trialStartedAt;
    return { id: user.id, ...(user.email ? { email: user.email } : {}), ...(user.telegramUserId ? { telegramUserId: user.telegramUserId } : {}), name: user.name, provider: user.provider, createdAt: user.createdAt || null, lastActiveAt: user.lastActiveAt || null, telegramUsername: user.telegramUsername || null, blockReason: user.blockReason || null, role: user.role === 'support' ? 'support' : 'user', blocked: user.blocked === true, trialStartedAt: user.trialStartedAt, trialEndsAt: user.trialEndsAt, accessUntil: extended ? new Date(extended).toISOString() : null, accessSource: extended > now() ? user.accessSource || 'grant' : started ? 'trial' : 'none', accessActive: started || now() < extended, referralCode: referralCode(user.id), referrals: accounts.filter(item => item.referredBy === user.id).length };
  }

  function session(request) {
    const token = cookies(request).scena_session;
    const tokenHash = token && digest(token);
    const stored = tokenHash && state.sessions.find(item => item.tokenHash === tokenHash);
    if (!stored || stored.expiresAt <= now()) return null;
    const user = accounts.find(account => account.id === stored.userId);
    return user ? publicUser(user) : null;
  }

  function cookie(response, name, value, seconds) {
    const item = `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}${seconds === undefined ? '' : `; Max-Age=${seconds}`}`;
    const previous = response.getHeader('Set-Cookie');
    response.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), item]);
  }

  async function signIn(request, response, user, remember, expectedPasswordHash) {
    const token = secret();
    const previous = cookies(request).scena_session;
    user = await mutate((next, transaction) => {
      const current = next.find(item => item.id === user.id);
      if (!current) throw fail('Аккаунт не найден.', 404);
      if (expectedPasswordHash !== undefined && current.password?.hash !== expectedPasswordHash) throw fail('Неверный email или пароль.', 401);
      if (current.trialStartedAt === null) {
        if (!legalReady) throw fail('Вход откроется после подготовки сайта.', 503);
        current.trialStartedAt = new Date(now()).toISOString();
        current.trialEndsAt = new Date(now() + 7 * DAY).toISOString();
      }
      if (previous) transaction.sessions = transaction.sessions.filter(item => item.tokenHash !== digest(previous));
      if (transaction.sessions.length >= 10000) throw fail('Сервис занят. Попробуйте позже.', 503);
      transaction.sessions.push({ tokenHash: digest(token), userId: current.id, expiresAt: now() + (remember ? 30 : 1) * DAY });
      current.lastActiveAt = new Date(now()).toISOString();
      audit(transaction, 'login', current.id, current.id, { provider: current.provider });
      return current;
    });
    cookie(response, 'scena_session', token, remember ? 30 * 86400 : undefined);
    return { user: publicUser(user) };
  }

  function consent(body) {
    if (!legalReady) throw fail('Регистрация откроется после публикации реквизитов и юридических документов сервиса.', 503);
    if (body.termsAccepted !== true || body.dataConsent !== true) throw fail('Подтвердите условия использования и отдельно согласие на обработку персональных данных.');
    return { termsVersion: VERSION, dataConsentVersion: VERSION, acceptedAt: new Date(now()).toISOString() };
  }

  function account(fields, accepted) {
    const current = now();
    return { id: randomUUID(), ...fields, consent: accepted, createdAt: new Date(current).toISOString(), trialStartedAt: new Date(current).toISOString(), trialEndsAt: new Date(current + 7 * DAY).toISOString() };
  }

  function audit(transaction, event, actorId, userId, detail = {}) {
    transaction.events.push({ at: new Date(now()).toISOString(), event, actorId: String(actorId), userId: userId || null, detail });
    if (transaction.events.length > 1000) transaction.events.splice(0, transaction.events.length - 1000);
  }

  function ownerOnly(actorId) {
    if (!owners.has(telegramId(actorId))) throw fail('Недостаточно прав.', 403);
  }

  function findUser(list, id) {
    const user = list.find(item => item.id === String(id) || item.telegramUserId === telegramId(id));
    if (!user) throw fail('Пользователь не найден.', 404);
    return user;
  }

  function daysValue(days) {
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw fail('Укажите число дней от 1 до 3650.');
    return days;
  }

  function extend(user, days, source) {
    const current = Math.max(now(), Date.parse(user.accessUntil) || 0, Date.parse(user.trialEndsAt) || 0);
    user.accessUntil = new Date(current + daysValue(days) * DAY).toISOString();
    user.accessSource = source;
  }

  function botMutation(eventKey, action, actorId, update, repeat = true) {
    if (typeof eventKey !== 'string' || !eventKey || eventKey.length > 200) return Promise.reject(fail('Отсутствует идентификатор действия.'));
    const key = digest(eventKey);
    return mutate((next, transaction) => {
      const processed = transaction.processed.find(item => item.key === key);
      if (processed) {
        if (processed.action !== action || processed.actorId !== String(actorId) || !repeat) throw fail('Действие уже обработано.', 409);
        return processed.userId ? publicUser(findUser(next, processed.userId)) : { ok: true, alreadyProcessed: true };
      }
      const result = update(next, transaction);
      transaction.processed.push({ key, action, actorId: String(actorId), userId: result?.provider ? result.id : null });
      if (transaction.processed.length > 10000) transaction.processed.splice(0, transaction.processed.length - 10000);
      return result;
    });
  }

  const publicPromo = promo => ({ id: promo.id, maskedCode: promo.maskedCode, type: 'access_days', days: promo.days, uses: promo.userIds.length, maxUses: promo.maxUses, expiresAt: promo.expiresAt, revoked: promo.revoked, deleted: promo.deleted === true, newUsersOnly: promo.newUsersOnly === true, createdAt: promo.createdAt });

  function botChallenge(token, id) {
    const challenge = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && botChallenges.get(digest(token));
    const actor = telegramId(id);
    if (!challenge || challenge.expiresAt <= now() || !actor || challenge.actor && challenge.actor !== actor) throw fail('Ссылка входа недействительна или истекла. Начните вход на сайте заново.', 410);
    return challenge;
  }

  // Only the verified Telegram update worker calls this service; these methods are not HTTP routes.
  const bots = {
    ownerTelegramId: [...owners][0] || null,
    async beginWebsiteLogin(token, id) {
      const challenge = botChallenge(token, id);
      if (challenge.userId) throw fail('Вход уже подтверждён. Вернитесь во вкладку сайта.', 409);
      const user = accounts.find(item => item.telegramUserId === telegramId(id));
      if (!user && !challenge.verificationOnly && !botRegistrationEnabled) throw fail('Регистрация в боте пока недоступна.', 503);
      challenge.actor = telegramId(id);
      return { registrationRequired: !user && !challenge.verificationOnly, verificationOnly: challenge.verificationOnly === true, ...(challenge.verificationOnly ? { email: challenge.email } : {}), expiresAt: challenge.expiresAt };
    },
    async confirmWebsiteLogin(token, id) {
      const challenge = botChallenge(token, id);
      if (!challenge.actor || challenge.userId) throw fail('Ссылка входа недействительна или уже использована.', 410);
      if (challenge.verificationOnly) {
        await requireMembership(challenge.actor);
        if (challenge.expiresAt <= now() || botChallenges.get(digest(token)) !== challenge) throw fail('Ссылка подтверждения истекла.', 410);
        challenge.confirmed = true;
        return { ok: true, verificationOnly: true };
      }
      const user = accounts.find(item => item.telegramUserId === telegramId(id));
      if (!user) throw fail('Сначала зарегистрируйтесь.');
      challenge.userId = user.id;
      return { ok: true };
    },
    async cancelWebsiteLogin(token, id) {
      botChallenge(token, id);
      botChallenges.delete(digest(token));
    },
    async adminRole(id) {
      const verifiedId = telegramId(id);
      if (owners.has(verifiedId)) return 'owner';
      return null;
    },
    async adminSnapshot(actorId) {
      ownerOnly(actorId);
      const users = accounts.map(publicUser);
      return { accounts: users, users, events: structuredClone(state.events), promos: state.promos.map(publicPromo), ownerTelegramId: [...owners][0] || null };
    },
    async userByTelegram(id) {
      const user = accounts.find(item => item.telegramUserId === telegramId(id));
      return user ? publicUser(user) : null;
    },
    async user(id) { return publicUser(findUser(accounts, id)); },
    async users({ query = '', offset = 0, limit = 10 } = {}) {
      const term = String(query).trim().toLowerCase().slice(0, 100);
      const found = accounts.filter(user => !term || [user.id, user.name, user.email, user.telegramUserId, user.telegramUsername ? `@${user.telegramUsername}` : ''].some(value => value?.toLowerCase().includes(term)));
      const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
      const size = Number.isSafeInteger(limit) ? Math.min(50, Math.max(1, limit)) : 10;
      return { items: found.slice(start, start + size).map(publicUser), total: found.length };
    },
    async registerTelegram(profile, accepted, eventKey) {
      if (!botRegistrationEnabled) throw fail('Регистрация в боте пока недоступна.', 503);
      const id = telegramId(profile?.id);
      if (!id) throw fail('Некорректный Telegram ID.');
      if (accepted?.termsAccepted !== true || accepted?.dataConsent !== true) throw fail('Подтвердите условия и согласие на обработку данных отдельно.');
      if (!accounts.some(user => user.telegramUserId === id)) await requireMembership(id);
      return botMutation(eventKey, 'register', id, (next, transaction) => {
        const existing = next.find(user => user.telegramUserId === id);
        if (existing) return publicUser(existing);
        const user = account({ provider: 'telegram', telegramUserId: id, name: typeof profile.name === 'string' ? profile.name.trim().slice(0, 100) || 'Пользователь Telegram' : 'Пользователь Telegram', role: 'user', blocked: false }, { termsVersion: VERSION, dataConsentVersion: VERSION, acceptedAt: new Date(now()).toISOString(), source: 'telegram_bot' });
        if (typeof profile.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(profile.username)) user.telegramUsername = profile.username;
        user.trialStartedAt = null;
        user.trialEndsAt = null;
        next.push(user);
        audit(transaction, 'register', id, user.id, { provider: 'telegram', source: 'bot' });
        return publicUser(user);
      });
    },
    async logs({ userId, limit = 20 } = {}) {
      const id = userId ? findUser(accounts, userId).id : null;
      const size = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
      return structuredClone(state.events.filter(item => !id || item.userId === id).slice(-size).reverse());
    },
    async grant(actorId, userId, days, eventKey) {
      ownerOnly(actorId); daysValue(days);
      return botMutation(eventKey, 'grant', actorId, (next, transaction) => {
        const user = findUser(next, userId);
        extend(user, days, 'grant');
        audit(transaction, 'access.grant', actorId, user.id, { days });
        return publicUser(user);
      });
    },
    async block(actorId, userId, blocked, eventKey, reason) {
      ownerOnly(actorId);
      if (typeof blocked !== 'boolean') throw fail('Некорректное состояние блокировки.');
      if (blocked && (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500)) throw fail('Укажите причину блокировки (до 500 символов).');
      const result = await botMutation(eventKey, 'block', actorId, (next, transaction) => {
        const user = findUser(next, userId);
        user.blocked = blocked;
        user.blockReason = blocked ? reason.trim() : null;
        audit(transaction, blocked ? 'account.block' : 'account.unblock', actorId, user.id, blocked ? { reason: user.blockReason } : {});
        return publicUser(user);
      });
      return result;
    },
    async role(actorId, userId, role, eventKey) {
      ownerOnly(actorId);
      if (!['user', 'support'].includes(role)) throw fail('Допустимы роли user и support.');
      return botMutation(eventKey, 'role', actorId, (next, transaction) => {
        const user = findUser(next, userId);
        user.role = role;
        audit(transaction, 'account.role', actorId, user.id, { role });
        return publicUser(user);
      });
    },
    async createPromo(actorId, days, uses, eventKey, options = {}) {
      ownerOnly(actorId); daysValue(days);
      if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw fail('Укажите число активаций от 1 до 1000.');
      const code = options.code === undefined ? randomBytes(10).toString('hex').slice(0, 16).toUpperCase() : typeof options.code === 'string' ? options.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9_-]{4,32}$/.test(code)) throw fail('Код: 4–32 латинские буквы, цифры, дефис или подчёркивание.');
      const expires = options.expiresAt === undefined ? now() + 30 * DAY : typeof options.expiresAt === 'string' ? Date.parse(options.expiresAt) : NaN;
      if (!Number.isFinite(expires) || expires <= now()) throw fail('Укажите будущую дату окончания промокода.');
      if (options.newUsersOnly !== undefined && typeof options.newUsersOnly !== 'boolean') throw fail('Некорректное ограничение новых пользователей.');
      return botMutation(eventKey, 'promo.create', actorId, (_, transaction) => {
        if (transaction.promos.some(item => item.hash === digest(code))) throw fail('Этот код уже использовался. Выберите другой.', 409);
        const promo = { id: randomUUID(), hash: digest(code), maskedCode: `••••${code.slice(-4)}`, days, maxUses: uses, userIds: [], createdAt: new Date(now()).toISOString(), expiresAt: new Date(expires).toISOString(), revoked: false, newUsersOnly: options.newUsersOnly === true };
        transaction.promos.push(promo);
        audit(transaction, 'promo.create', actorId, null, { promoId: promo.id, days, maxUses: uses });
        return { ...publicPromo(promo), code };
      }, false);
    },
    async promos() { return state.promos.filter(item => !item.deleted).slice(-100).reverse().map(publicPromo); },
    async deletePromo(actorId, id, eventKey) {
      ownerOnly(actorId);
      return botMutation(eventKey, 'promo.delete', actorId, (_, transaction) => {
        const promo = transaction.promos.find(item => item.id === id);
        if (!promo) throw fail('Промокод не найден.', 404);
        promo.deleted = true;
        promo.revoked = true;
        audit(transaction, 'promo.delete', actorId, null, { promoId: promo.id });
        return publicPromo(promo);
      });
    },
    async revokePromo(actorId, codeOrId, eventKey) {
      ownerOnly(actorId);
      return botMutation(eventKey, 'promo.revoke', actorId, (_, transaction) => {
        const input = String(codeOrId).trim();
        const promo = transaction.promos.find(item => item.id === input || item.hash === digest(input.toUpperCase()));
        if (!promo) throw fail('Промокод не найден.', 404);
        promo.revoked = true;
        audit(transaction, 'promo.revoke', actorId, null, { promoId: promo.id });
        return publicPromo(promo);
      });
    },
    async redeem(id, code, eventKey) {
      const verifiedId = telegramId(id);
      if (!verifiedId) throw fail('Некорректный Telegram ID.');
      cleanup(); rate(`promo:${verifiedId}`, 10);
      return redeemPromo(eventKey, verifiedId, next => next.find(item => item.telegramUserId === verifiedId), code);
    },
    async activatePlan(actorId, userId, planId, eventKey) {
      ownerOnly(actorId);
      const tokens = PLAN_TOKENS[planId];
      if (!tokens) throw fail('Неизвестный тариф.');
      if (!tokenLedger) throw fail('Учёт токенов не подключён.', 503);
      const user = await botMutation(eventKey, 'plan.activate', actorId, (next, transaction) => {
        const target = findUser(next, userId);
        extend(target, 30, 'plan');
        audit(transaction, 'plan.activate', actorId, target.id, { plan: planId, tokens });
        return publicUser(target);
      });
      // Fixed ledger ids make a repeated confirmation grant nothing twice.
      const key = digest(eventKey).slice(0, 24), inviterId = accounts.find(item => item.id === user.id)?.referredBy, share = Math.floor(tokens * REFERRAL_SHARE);
      await tokenLedger.grant(user.id, tokens, 'purchase', `plan-${key}`, `Тариф ${planId}`);
      if (inviterId && share) await tokenLedger.grant(inviterId, share, 'referral', `plan-${key}-inviter`, 'Бонус за покупку друга');
      return user;
    },
  };

  function redeemPromo(eventKey, actorId, pick, code) {
      const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9_-]{4,32}$/.test(normalized)) return Promise.reject(fail('Промокод недействителен или недоступен.'));
      return botMutation(eventKey, 'promo.redeem', actorId, (next, transaction) => {
        const user = pick(next);
        if (!user) throw fail('Сначала зарегистрируйтесь.', 403);
        if (user.blocked) throw fail('Доступ к аккаунту заблокирован.', 403);
        const promo = transaction.promos.find(item => item.hash === digest(normalized));
        if (!promo || promo.revoked || promo.deleted || Date.parse(promo.expiresAt) <= now() || promo.userIds.length >= promo.maxUses || promo.userIds.includes(user.id)) throw fail('Промокод недействителен или недоступен.');
        if (promo.newUsersOnly && (!(Date.parse(user.createdAt) > now() - 7 * DAY) || transaction.promos.some(item => item.userIds.includes(user.id)))) throw fail('Промокод доступен только в первые 7 дней и до первой активации промокода.');
        promo.userIds.push(user.id);
        extend(user, promo.days, 'promo');
        audit(transaction, 'promo.redeem', actorId, user.id, { promoId: promo.id, days: promo.days });
        return publicUser(user);
      });
  }
  Object.assign(bots, {
    async recordActivity(userId, event, detail) {
      if (!['studio.read', 'studio.upload', 'studio.import', 'studio.export', 'studio.update', 'studio.telegram_send', 'studio.rejected'].includes(event)) throw fail('Недопустимое событие.');
      const routes = ['/api/health', '/api/projects', '/api/clips', '/api/publications', '/api/settings', '/api/upload', '/api/import', '/api/telegram/send', '/api/projects/:id', '/api/projects/:id/analyze', '/api/projects/:id/export', '/api/projects/:id/banner', '/api/jobs/:id', '/api/jobs/:id/cancel', '/api/publications/:id', '/media/:file', '/downloads/:file', '/unknown'];
      if (!detail || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(detail.method) || !routes.includes(detail.route) || !Number.isInteger(detail.status) || detail.status < 100 || detail.status > 599) throw fail('Недопустимые метаданные события.');
      const important = detail.status >= 500 || !['studio.read', 'studio.rejected'].includes(event) && !['GET', 'HEAD'].includes(detail.method);
      const current = findUser(accounts, userId);
      if (!important && now() - (Date.parse(current.lastActiveAt) || 0) < 60000) return;
      return mutate((next, transaction) => {
        const user = findUser(next, userId);
        user.lastActiveAt = new Date(now()).toISOString();
        if (important) audit(transaction, event, user.id, user.id, { method: detail.method, route: detail.route, status: detail.status });
      });
    },
  });

  async function requireMembership(id) {
    if (!telegramId(id) || typeof telegramMembership !== 'function') throw fail('Не удалось проверить подписку на @MediaFlowTech. Повторите позже.', 503);
    let member;
    try { member = await telegramMembership(String(id)); }
    catch { throw fail('Не удалось проверить подписку на @MediaFlowTech. Повторите позже.', 503); }
    if (member !== true) throw fail('Для регистрации подпишитесь на @MediaFlowTech и повторите проверку.', 403);
  }

  function browserChallenge(request) {
    const [token, browserToken] = (cookies(request).scena_telegram_bot || '').split('.');
    const challenge = token && botChallenges.get(digest(token));
    return challenge && challenge.expiresAt > now() && browserToken && equal(digest(browserToken), challenge.browserHash) ? challenge : null;
  }

  function startBotChallenge(request, response, body, verificationOnly = false) {
    if (!telegramBotEnabled) throw fail('Подтверждение Telegram пока недоступно. Повторите позже.', 503);
    const previous = browserChallenge(request);
    const old = cookies(request).scena_telegram_bot?.split('.')[0];
    if (previous) botChallenges.delete(digest(old));
    if (botChallenges.size >= 1000) throw fail('Сервис занят. Попробуйте позже.', 503);
    const token = secret(), browserToken = secret(), expiresAt = now() + 5 * 60000;
    botChallenges.set(digest(token), { browserHash: digest(browserToken), expiresAt, remember: body.remember === true, verificationOnly, ...(verificationOnly ? { email: body.email.trim().toLowerCase() } : {}) });
    cookie(response, 'scena_telegram_bot', `${token}.${browserToken}`, 300);
    return { url: `https://t.me/${telegramBotUsername}?start=login_${token}`, expiresAt };
  }

  async function emailStart(request, response, body) {
    if (!emailEnabled) throw fail('Вход по email пока не подключён. Сервис доставки писем не настроен.', 503);
    if (!['register', 'login', 'reset'].includes(body.mode)) throw fail('Выберите вход, регистрацию или восстановление пароля.');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Введите корректный email.');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw fail('Пароль должен содержать от 8 до 128 символов.');
    const name = body.mode === 'register' ? (typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 60) : '') : '';
    if (body.mode === 'register' && !name) throw fail('Введите имя пользователя.');
    rate(`email:${digest(email)}`, body.mode === 'login' ? 10 : 5);
    const existing = accounts.find(user => user.email === email);
    if (body.mode === 'login') {
      const credential = existing?.password || dummyPassword;
      const candidate = (await scrypt(body.password, credential.salt, 64)).toString('hex');
      if (!existing || !equal(candidate, credential.hash) || accounts.find(user => user.id === existing.id)?.password?.hash !== credential.hash) throw fail('Неверный email или пароль.', 401);
      return signIn(request, response, existing, body.remember === true, credential.hash);
    }
    const accepted = body.mode === 'register' ? consent(body) : null;
    const proof = body.mode === 'register' ? browserChallenge(request) : null;
    if (body.mode === 'register' && (!proof?.verificationOnly || !proof.confirmed || proof.email !== email)) return { telegramRequired: true, ...startBotChallenge(request, response, body, true) };
    if (proof) await requireMembership(proof.actor);
    const challengeId = secret();
    if ((body.mode === 'register' && existing) || (body.mode === 'reset' && !existing)) return { verificationRequired: true, challengeId, message: 'Если действие доступно для этого адреса, письмо с кодом будет отправлено.' };
    if (challenges.size >= 1000) throw fail('Сервис занят. Попробуйте позже.', 503);
    const hashedPassword = await passwordHash(body.password);
    const code = emailAuth ? null : String(randomInt(100000, 1000000));
    const pending = { telegramUserId: proof?.actor, browserHash: proof?.browserHash, email, password: hashedPassword, purpose: body.mode, userId: existing?.id, consent: accepted, remember: body.remember === true, codeHash: code ? digest(code) : null, expiresAt: now() + 10 * 60000, attempts: 0, name, referrer: body.mode === 'register' ? referrerId(body.ref) : null };
    if (proof) {
      proof.expiresAt = pending.expiresAt;
      cookie(response, 'scena_telegram_bot', cookies(request).scena_telegram_bot, 600);
    }
    challenges.set(digest(challengeId), pending);
    try { if (emailAuth) await emailAuth.send({ email, purpose: body.mode }); else await emailDelivery({ email, code, purpose: body.mode }); }
    catch { challenges.delete(digest(challengeId)); throw fail('Не удалось отправить код. Попробуйте позже.', 503); }
    return { verificationRequired: true, challengeId, message: 'Если действие доступно для этого адреса, письмо с кодом будет отправлено.' };
  }

  async function emailVerify(request, response, body) {
    if (typeof body.challengeId !== 'string' || body.challengeId.length > 100 || typeof body.code !== 'string' || body.code.length !== emailCodeLength || !/^\d+$/.test(body.code)) throw fail(`Введите ${emailCodeLength} цифр из письма.`);
    const key = digest(body.challengeId);
    const pending = challenges.get(key);
    if (!pending || pending.expiresAt <= now()) throw fail('Код истёк или уже использован. Запросите новый.');
    if (pending.verifying) throw fail('Код уже проверяется. Подождите.', 409);
    if (++pending.attempts > 5) { challenges.delete(key); throw fail('Слишком много попыток. Запросите новый код.', 429); }
    pending.verifying = true;
    try {
      if (pending.purpose === 'register') {
        const proof = browserChallenge(request);
        if (!proof?.confirmed || proof.actor !== pending.telegramUserId || proof.browserHash !== pending.browserHash) throw fail('Подтвердите Telegram в этой вкладке заново.', 403);
        await requireMembership(pending.telegramUserId);
      }
      if (emailAuth) await emailAuth.verify({ email: pending.email, code: body.code });
      else if (!equal(digest(body.code), pending.codeHash)) throw fail('Неверный код.');
      if (challenges.get(key) !== pending || pending.expiresAt <= now()) throw fail('Код истёк или уже использован.');
      if (pending.purpose === 'register' && browserChallenge(request)?.browserHash !== pending.browserHash) throw fail('Подтвердите Telegram в этой вкладке заново.', 403);
    } finally { pending.verifying = false; }
    challenges.delete(key);
    let createdUser = null;
    const user = await mutate((next, transaction) => {
      if (pending.purpose === 'register') {
        if (!legalReady) throw fail('Регистрация временно недоступна.', 503);
        if (next.some(item => item.email === pending.email)) throw fail('Адрес уже зарегистрирован. Войдите в аккаунт.', 409);
        const linked = next.find(item => item.telegramUserId === pending.telegramUserId);
        if (linked?.email && linked.email !== pending.email) throw fail('Этот Telegram уже связан с другим адресом. Войдите в существующий аккаунт.', 409);
        if (linked) {
          Object.assign(linked, { email: pending.email, password: pending.password, emailVerifiedAt: new Date(now()).toISOString() });
          audit(transaction, 'account.email_link', linked.id, linked.id);
          return linked;
        }
        const created = account({ provider: 'email', telegramUserId: pending.telegramUserId, email: pending.email, name: pending.name || pending.email.split('@')[0], password: pending.password, emailVerifiedAt: new Date(now()).toISOString(), ...(pending.referrer ? { referredBy: pending.referrer } : {}) }, pending.consent);
        next.push(created);
        audit(transaction, 'register', created.id, created.id, { provider: 'email', ...(pending.referrer ? { referredBy: pending.referrer } : {}) });
        createdUser = created;
        return created;
      }
      const existing = next.find(item => item.id === pending.userId && item.email === pending.email);
      if (!existing) throw fail('Запрос восстановления недействителен.');
      existing.password = pending.password;
      transaction.sessions = transaction.sessions.filter(item => item.userId !== existing.id);
      audit(transaction, 'password.reset', existing.id, existing.id);
      return existing;
    });
    if (pending.purpose === 'reset') {
      for (const [key, value] of challenges) if (value.email === user.email) challenges.delete(key);
    }
    if (createdUser) registered(createdUser);
    return signIn(request, response, user, pending.remember, pending.password.hash);
  }

  async function telegramKey(kid) {
    let key = cachedKeys?.find(item => item.kid === kid);
    if (!key || keysExpiry <= now()) {
      if (!keysRequest && now() - keysAttempt >= 60000) {
        keysAttempt = now();
        keysRequest = (async () => {
          const response = await fetcher('https://oauth.telegram.org/.well-known/jwks.json', { signal: AbortSignal.timeout(5000), redirect: 'error' });
          if (!response.ok) throw new Error();
          const text = await response.text();
          if (text.length > 64000) throw new Error();
          const result = JSON.parse(text);
          if (!Array.isArray(result.keys) || result.keys.length > 20) throw new Error();
          cachedKeys = result.keys;
          keysExpiry = now() + 3600000;
        })().finally(() => { keysRequest = undefined; });
      }
      if (keysRequest) await keysRequest;
      if (!cachedKeys || keysExpiry <= now()) throw fail('Не удалось проверить Telegram. Повторите вход позже.', 503);
      key = cachedKeys.find(item => item.kid === kid);
    }
    if (!key || key.kty !== 'RSA' || (key.alg && key.alg !== 'RS256') || (key.use && key.use !== 'sig')) throw new Error();
    return createPublicKey({ key, format: 'jwk' });
  }

  async function telegramLogin(request, response, body) {
    const challengeCookie = cookies(request).scena_telegram;
    const key = challengeCookie && digest(challengeCookie);
    const challenge = key && telegramChallenges.get(key);
    if (key) telegramChallenges.delete(key);
    cookie(response, 'scena_telegram', '', 0);
    if (!challenge || challenge.expiresAt <= now()) throw fail('Сеанс Telegram истёк. Начните вход заново.', 401);
    let claims;
    try {
      if (typeof body.idToken !== 'string' || body.idToken.length > 20000) throw new Error();
      const parts = body.idToken.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200 || header.crit || header.jku || header.jwk) throw new Error();
      const timestamp = now() / 1000;
      const audienceValid = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId) && claims.azp === clientId);
      if (claims.iss !== 'https://oauth.telegram.org' || !audienceValid || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 128 || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) || claims.exp <= timestamp || claims.iat > timestamp + 30 || claims.iat < timestamp - 600 || claims.exp <= claims.iat || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > timestamp + 30)) || !equal(claims.nonce, challenge.nonce)) throw new Error();
      if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), await telegramKey(header.kid), Buffer.from(parts[2], 'base64url'))) throw new Error();
    } catch (error) { if (error.status === 503) throw error; throw fail('Не удалось подтвердить вход через Telegram. Начните заново.', 401); }
    if (!['register', 'login'].includes(body.mode)) throw fail('Выберите вход или регистрацию.');
    const verifiedId = Number.isSafeInteger(claims.id) && claims.id > 0 ? String(claims.id) : null;
    if (!verifiedId) throw fail('Не удалось подтвердить Telegram ID.', 401);
    if (!accounts.some(item => item.telegramUserId === verifiedId || item.telegramSubject === claims.sub)) await requireMembership(verifiedId);
    let createdTelegram = null;
    const user = await mutate((next, transaction) => {
      const bySubject = next.find(item => item.telegramSubject === claims.sub);
      const byId = next.find(item => item.telegramUserId === verifiedId);
      if (bySubject && byId && bySubject.id !== byId.id || bySubject?.telegramUserId && bySubject.telegramUserId !== verifiedId || byId?.telegramSubject && byId.telegramSubject !== claims.sub) throw fail('Не удалось подтвердить Telegram ID.', 401);
      const existing = bySubject || byId;
      if (existing) {
        existing.telegramSubject = claims.sub;
        existing.telegramUserId = verifiedId;
        return existing;
      }
      if (body.mode !== 'register') throw fail('Аккаунт не найден. Перейдите к регистрации.', 404);
      const accepted = consent(body);
      const referrer = referrerId(body.ref);
      const created = account({ provider: 'telegram', telegramSubject: claims.sub, telegramUserId: verifiedId, name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 100) : 'Пользователь Telegram', ...(referrer ? { referredBy: referrer } : {}) }, accepted);
      next.push(created);
      audit(transaction, 'register', created.id, created.id, { provider: 'telegram', source: 'website', ...(referrer ? { referredBy: referrer } : {}) });
      createdTelegram = created;
      return created;
    });
    if (createdTelegram) registered(createdTelegram);
    return signIn(request, response, user, body.remember === true);
  }

  async function handle(request, response, route) {
    if (!route.startsWith('/api/auth/')) return false;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    cleanup();
    try {
      let result;
      if (request.method === 'GET' && route === '/api/auth/config') result = { emailEnabled, emailCodeLength, telegramEnabled, telegramBotEnabled, telegramClientId: telegramEnabled ? clientId : '', legalReady, botRegistrationEnabled, legalVersion: VERSION, requiredTelegramChannel: 'https://t.me/MediaFlowTech' };
      else if (request.method === 'GET' && route === '/api/auth/session') result = { user: session(request) };
      else {
        if (request.method !== 'POST') throw fail('Метод не поддерживается.', 405);
        if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Запрос с другого сайта запрещён.', 403);
        if (request.headers.origin) {
          const expected = `${secureCookies ? 'https' : 'http'}://${request.headers.host}`;
          if (request.headers.origin !== expected && !allowedOrigins.includes(request.headers.origin)) throw fail('Запрос с другого сайта запрещён.', 403);
        }
        const remoteAddress = request.socket.remoteAddress || 'unknown';
        const forwarded = request.headers['x-forwarded-for'];
        const loopback = remoteAddress === '::1' || (isIP(remoteAddress) === 4 && remoteAddress.startsWith('127.')) || (isIP(remoteAddress) === 6 && remoteAddress.startsWith('::ffff:127.'));
        const clientAddress = trustProxy === true && loopback && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : remoteAddress;
        const botStatus = route === '/api/auth/telegram/bot/status';
        rate(`${botStatus ? 'bot-status' : 'ip'}:${clientAddress}`, botStatus ? 360 : 60);
        const body = await jsonBody(request);
        if (route === '/api/auth/logout') {
          const token = cookies(request).scena_session;
          const current = session(request);
          if (token) await mutate((_, transaction) => {
            transaction.sessions = transaction.sessions.filter(item => item.tokenHash !== digest(token));
            if (current) audit(transaction, 'logout', current.id, current.id);
          });
          cookie(response, 'scena_session', '', 0);
          result = { ok: true };
        } else if (route === '/api/auth/promo') {
          const current = session(request);
          if (!current) throw fail('Войдите в аккаунт.', 401);
          rate(`promo:web:${current.id}`, 10);
          const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
          result = { user: await redeemPromo(`web-promo:${current.id}:${digest(code)}`, current.id, next => next.find(item => item.id === current.id), code) };
        } else if (route === '/api/auth/email/start') result = await emailStart(request, response, body);
        else if (route === '/api/auth/email/verify') result = await emailVerify(request, response, body);
        else if (route === '/api/auth/telegram/bot/start') {
          if (!telegramBotEnabled) throw fail('Вход через Telegram-бота пока не подключён.', 503);
          if (!legalReady) throw fail('Вход откроется после подготовки сайта.', 503);
          if (!['login', 'register'].includes(body.mode)) throw fail('Выберите вход или регистрацию.');
          result = startBotChallenge(request, response, body);
        } else if (botStatus) {
          const [token, browserToken] = (cookies(request).scena_telegram_bot || '').split('.');
          const challenge = token && botChallenges.get(digest(token));
          if (!challenge || challenge.expiresAt <= now() || !browserToken || !equal(digest(browserToken), challenge.browserHash)) throw fail('Ссылка входа недействительна или истекла. Начните вход заново.', 410);
          if (challenge.verificationOnly && challenge.confirmed) result = { telegramVerified: true };
          else if (!challenge.userId) result = { pending: true };
          else {
            botChallenges.delete(digest(token));
            cookie(response, 'scena_telegram_bot', '', 0);
            const user = accounts.find(item => item.id === challenge.userId);
            if (!user) throw fail('Аккаунт не найден.', 404);
            result = await signIn(request, response, user, challenge.remember);
          }
        }
        else if (route === '/api/auth/telegram/challenge' || route === '/api/auth/telegram') {
          if (!telegramEnabled) throw fail('Вход через Telegram пока не подключён.', 503);
          if (route.endsWith('/challenge')) {
            if (telegramChallenges.size >= 1000) throw fail('Сервис занят. Попробуйте позже.', 503);
            const old = cookies(request).scena_telegram;
            if (old) telegramChallenges.delete(digest(old));
            const browserToken = secret();
            const nonce = secret();
            telegramChallenges.set(digest(browserToken), { nonce, expiresAt: now() + 5 * 60000 });
            cookie(response, 'scena_telegram', browserToken, 300);
            result = { nonce };
          } else result = await telegramLogin(request, response, body);
        } else throw fail('Метод не найден.', 404);
      }
      response.writeHead(200);
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(error.status || 500);
      response.end(JSON.stringify({ error: error.status ? error.message : 'Сервис временно недоступен. Попробуйте позже.' }));
    }
    return true;
  }

  return { handle, session, bots, flush: () => writeQueue };
}
