import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash, createPublicKey, verify } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const DAY = 86400000;
const VERSION = '2026-09-13';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const secret = () => randomBytes(32).toString('base64url');
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

export async function createAuth({ dataDir, telegramClientId = '', emailDelivery, legalReady = false, botRegistrationEnabled = false, ownerTelegramIds = [], secureCookies = false, allowedOrigins = [], now = Date.now, fetch: fetcher = globalThis.fetch }) {
  if (!dataDir) throw new Error('Auth dataDir is required');
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const accountsFile = path.join(dataDir, 'accounts.json');
  let state = { accounts: [], events: [], promos: [], processed: [] };
  try {
    const saved = JSON.parse(await fs.readFile(accountsFile, 'utf8'));
    state = Array.isArray(saved) ? { ...state, accounts: saved } : saved;
    if (!state || !['accounts', 'events', 'promos', 'processed'].every(key => Array.isArray(state[key])) || state.accounts.some(user => !user.id || !['email', 'telegram'].includes(user.provider) || !(user.trialEndsAt === null && user.trialStartedAt === null || Number.isFinite(Date.parse(user.trialEndsAt))))) throw new Error('Invalid auth account store');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let accounts = state.accounts;
  const telegramId = value => /^(?:[1-9]\d{0,15})$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(value) : null;
  const owners = new Set(ownerTelegramIds.map(telegramId).filter(Boolean));
  const sessions = new Map(), challenges = new Map(), telegramChallenges = new Map(), limits = new Map();
  const dummyPassword = await passwordHash(secret());
  const emailEnabled = typeof emailDelivery === 'function';
  const clientId = String(telegramClientId);
  const telegramEnabled = /^\d+$/.test(clientId);
  let writeQueue = Promise.resolve();
  let cachedKeys = null, keysExpiry = 0, keysAttempt = -Infinity, keysRequest;

  // ponytail: one process owns this file; use a transactional database before running multiple workers.
  function mutate(update) {
    const operation = writeQueue.then(async () => {
      const next = structuredClone(state);
      const result = update(next.accounts, next);
      const temporary = `${accountsFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      try { await fs.rename(temporary, accountsFile); }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
      state = next;
      accounts = next.accounts;
      return result;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function cleanup() {
    const current = now();
    for (const map of [sessions, challenges, telegramChallenges, limits]) {
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

  function publicUser(user) {
    const extended = Date.parse(user.accessUntil) || 0;
    const trial = Date.parse(user.trialEndsAt) || 0;
    const until = Math.max(extended, trial);
    return { id: user.id, ...(user.email ? { email: user.email } : {}), ...(user.telegramUserId ? { telegramUserId: user.telegramUserId } : {}), name: user.name, provider: user.provider, role: user.role === 'support' ? 'support' : 'user', blocked: user.blocked === true, trialStartedAt: user.trialStartedAt, trialEndsAt: user.trialEndsAt, accessUntil: until ? new Date(until).toISOString() : null, accessSource: extended >= trial && extended ? user.accessSource || 'grant' : trial ? 'trial' : 'none', accessActive: !user.blocked && now() < until };
  }

  function session(request) {
    const token = cookies(request).scena_session;
    const stored = token && sessions.get(digest(token));
    if (!stored || stored.expiresAt <= now()) { if (token) sessions.delete(digest(token)); return null; }
    const user = accounts.find(account => account.id === stored.userId);
    return user && !user.blocked ? publicUser(user) : null;
  }

  function cookie(response, name, value, seconds) {
    const item = `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}${seconds === undefined ? '' : `; Max-Age=${seconds}`}`;
    const previous = response.getHeader('Set-Cookie');
    response.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), item]);
  }

  async function signIn(request, response, user, remember, expectedPasswordHash) {
    user = await mutate((next, transaction) => {
      const current = next.find(item => item.id === user.id);
      if (!current || current.blocked) throw fail('Доступ к аккаунту заблокирован.', 403);
      if (current.provider === 'email' && current.password?.hash !== expectedPasswordHash) throw fail('Неверный email или пароль.', 401);
      if (current.trialStartedAt === null) {
        if (!legalReady) throw fail('Вход откроется после подготовки сайта.', 503);
        current.trialStartedAt = new Date(now()).toISOString();
        current.trialEndsAt = new Date(now() + 7 * DAY).toISOString();
      }
      audit(transaction, 'login', current.id, current.id, { provider: current.provider });
      return current;
    });
    const previous = cookies(request).scena_session;
    if (previous) sessions.delete(digest(previous));
    if (sessions.size >= 10000) throw fail('Сервис занят. Попробуйте позже.', 503);
    const token = secret();
    sessions.set(digest(token), { userId: user.id, expiresAt: now() + (remember ? 30 : 1) * DAY });
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

  const publicPromo = promo => ({ id: promo.id, maskedCode: promo.maskedCode, days: promo.days, uses: promo.userIds.length, maxUses: promo.maxUses, expiresAt: promo.expiresAt, revoked: promo.revoked, createdAt: promo.createdAt });

  // Only the verified Telegram update worker calls this service; these methods are not HTTP routes.
  const bots = {
    async adminRole(id) {
      const verifiedId = telegramId(id);
      if (owners.has(verifiedId)) return 'owner';
      const user = accounts.find(item => item.telegramUserId === verifiedId);
      return user && !user.blocked && user.role === 'support' ? 'support' : null;
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
    async block(actorId, userId, blocked, eventKey) {
      ownerOnly(actorId);
      if (typeof blocked !== 'boolean') throw fail('Некорректное состояние блокировки.');
      const result = await botMutation(eventKey, 'block', actorId, (next, transaction) => {
        const user = findUser(next, userId);
        user.blocked = blocked;
        audit(transaction, blocked ? 'account.block' : 'account.unblock', actorId, user.id);
        return publicUser(user);
      });
      if (result.blocked) for (const [key, value] of sessions) if (value.userId === result.id) sessions.delete(key);
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
    async createPromo(actorId, days, uses, eventKey) {
      ownerOnly(actorId); daysValue(days);
      if (!Number.isInteger(uses) || uses < 1 || uses > 1000) throw fail('Укажите число активаций от 1 до 1000.');
      return botMutation(eventKey, 'promo.create', actorId, (_, transaction) => {
        const code = randomBytes(10).toString('hex').slice(0, 16).toUpperCase();
        const promo = { id: randomUUID(), hash: digest(code), maskedCode: `••••${code.slice(-4)}`, days, maxUses: uses, userIds: [], createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 30 * DAY).toISOString(), revoked: false };
        transaction.promos.push(promo);
        audit(transaction, 'promo.create', actorId, null, { promoId: promo.id, days, maxUses: uses });
        return { ...publicPromo(promo), code };
      }, false);
    },
    async promos() { return state.promos.slice(-100).reverse().map(publicPromo); },
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
      const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{16}$/.test(normalized)) throw fail('Промокод недействителен или недоступен.');
      return botMutation(eventKey, 'promo.redeem', verifiedId, (next, transaction) => {
        const user = next.find(item => item.telegramUserId === verifiedId);
        if (!user) throw fail('Сначала зарегистрируйтесь.', 403);
        if (user.blocked) throw fail('Доступ к аккаунту заблокирован.', 403);
        const promo = transaction.promos.find(item => item.hash === digest(normalized));
        if (!promo || promo.revoked || Date.parse(promo.expiresAt) <= now() || promo.userIds.length >= promo.maxUses || promo.userIds.includes(user.id)) throw fail('Промокод недействителен или недоступен.');
        promo.userIds.push(user.id);
        extend(user, promo.days, 'promo');
        audit(transaction, 'promo.redeem', verifiedId, user.id, { promoId: promo.id, days: promo.days });
        return publicUser(user);
      });
    },
    async recordActivity(userId, event, detail) {
      if (!['studio.read', 'studio.upload', 'studio.import', 'studio.export', 'studio.update', 'studio.telegram_send', 'studio.rejected'].includes(event)) throw fail('Недопустимое событие.');
      const routes = ['/api/health', '/api/projects', '/api/clips', '/api/publications', '/api/settings', '/api/upload', '/api/import', '/api/telegram/send', '/api/projects/:id', '/api/projects/:id/analyze', '/api/projects/:id/export', '/api/projects/:id/banner', '/api/jobs/:id', '/api/jobs/:id/cancel', '/api/publications/:id', '/media/:file', '/downloads/:file', '/unknown'];
      if (!detail || !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(detail.method) || !routes.includes(detail.route) || !Number.isInteger(detail.status) || detail.status < 100 || detail.status > 599) throw fail('Недопустимые метаданные события.');
      return mutate((next, transaction) => {
        const user = findUser(next, userId);
        audit(transaction, event, user.id, user.id, { method: detail.method, route: detail.route, status: detail.status });
      });
    },
  };

  async function emailStart(request, response, body) {
    if (!emailEnabled) throw fail('Вход по email пока не подключён. Сервис доставки писем не настроен.', 503);
    if (!['register', 'login', 'reset'].includes(body.mode)) throw fail('Выберите вход, регистрацию или восстановление пароля.');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Введите корректный email.');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw fail('Пароль должен содержать от 8 до 128 символов.');
    rate(`email:${digest(email)}`, body.mode === 'login' ? 10 : 5);
    const existing = accounts.find(user => user.email === email && user.provider === 'email');
    if (body.mode === 'login') {
      const credential = existing?.password || dummyPassword;
      const candidate = (await scrypt(body.password, credential.salt, 64)).toString('hex');
      if (!existing || !equal(candidate, credential.hash) || accounts.find(user => user.id === existing.id)?.password.hash !== credential.hash) throw fail('Неверный email или пароль.', 401);
      return signIn(request, response, existing, body.remember === true, credential.hash);
    }
    const accepted = body.mode === 'register' ? consent(body) : null;
    const challengeId = secret();
    if ((body.mode === 'register' && existing) || (body.mode === 'reset' && !existing)) return { verificationRequired: true, challengeId, message: 'Если действие доступно для этого адреса, письмо с кодом будет отправлено.' };
    if (challenges.size >= 1000) throw fail('Сервис занят. Попробуйте позже.', 503);
    const hashedPassword = await passwordHash(body.password);
    const code = String(randomInt(100000, 1000000));
    const pending = { email, password: hashedPassword, purpose: body.mode, userId: existing?.id, consent: accepted, remember: body.remember === true, codeHash: digest(code), expiresAt: now() + 10 * 60000, attempts: 0 };
    challenges.set(digest(challengeId), pending);
    try { await emailDelivery({ email, code, purpose: body.mode }); }
    catch { challenges.delete(digest(challengeId)); throw fail('Не удалось отправить код. Попробуйте позже.', 503); }
    return { verificationRequired: true, challengeId, message: 'Если действие доступно для этого адреса, письмо с кодом будет отправлено.' };
  }

  async function emailVerify(request, response, body) {
    if (typeof body.challengeId !== 'string' || body.challengeId.length > 100 || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw fail('Введите шестизначный код из письма.');
    const key = digest(body.challengeId);
    const pending = challenges.get(key);
    if (!pending || pending.expiresAt <= now()) throw fail('Код истёк или уже использован. Запросите новый.');
    if (++pending.attempts > 5) { challenges.delete(key); throw fail('Слишком много попыток. Запросите новый код.', 429); }
    if (!equal(digest(body.code), pending.codeHash)) throw fail('Неверный код.');
    challenges.delete(key);
    const user = await mutate((next, transaction) => {
      if (pending.purpose === 'register') {
        if (!legalReady) throw fail('Регистрация временно недоступна.', 503);
        if (next.some(item => item.email === pending.email)) throw fail('Адрес уже зарегистрирован. Войдите в аккаунт.', 409);
        const created = account({ provider: 'email', email: pending.email, name: pending.email.split('@')[0], password: pending.password, emailVerifiedAt: new Date(now()).toISOString() }, pending.consent);
        next.push(created);
        audit(transaction, 'register', created.id, created.id, { provider: 'email' });
        return created;
      }
      const existing = next.find(item => item.id === pending.userId && item.email === pending.email && item.provider === 'email');
      if (!existing) throw fail('Запрос восстановления недействителен.');
      if (existing.blocked) throw fail('Доступ к аккаунту заблокирован.', 403);
      existing.password = pending.password;
      audit(transaction, 'password.reset', existing.id, existing.id);
      return existing;
    });
    if (pending.purpose === 'reset') {
      for (const [key, value] of sessions) if (value.userId === user.id) sessions.delete(key);
      for (const [key, value] of challenges) if (value.email === user.email) challenges.delete(key);
    }
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
    const user = await mutate((next, transaction) => {
      const bySubject = next.find(item => item.provider === 'telegram' && item.telegramSubject === claims.sub);
      const byId = verifiedId && next.find(item => item.provider === 'telegram' && item.telegramUserId === verifiedId);
      if (bySubject && byId && bySubject.id !== byId.id || bySubject?.telegramUserId && verifiedId && bySubject.telegramUserId !== verifiedId || byId?.telegramSubject && byId.telegramSubject !== claims.sub) throw fail('Не удалось подтвердить Telegram ID.', 401);
      const existing = bySubject || byId;
      if (existing) {
        if (existing.blocked) throw fail('Доступ к аккаунту заблокирован.', 403);
        existing.telegramSubject = claims.sub;
        if (verifiedId) existing.telegramUserId = verifiedId;
        return existing;
      }
      if (body.mode !== 'register') throw fail('Аккаунт не найден. Перейдите к регистрации.', 404);
      const accepted = consent(body);
      const created = account({ provider: 'telegram', telegramSubject: claims.sub, ...(verifiedId ? { telegramUserId: verifiedId } : {}), name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 100) : 'Пользователь Telegram' }, accepted);
      next.push(created);
      audit(transaction, 'register', created.id, created.id, { provider: 'telegram', source: 'website' });
      return created;
    });
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
      if (request.method === 'GET' && route === '/api/auth/config') result = { emailEnabled, telegramEnabled, telegramClientId: telegramEnabled ? clientId : '', legalReady, botRegistrationEnabled, legalVersion: VERSION };
      else if (request.method === 'GET' && route === '/api/auth/session') result = { user: session(request) };
      else {
        if (request.method !== 'POST') throw fail('Метод не поддерживается.', 405);
        if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Запрос с другого сайта запрещён.', 403);
        if (request.headers.origin) {
          const expected = `${secureCookies ? 'https' : 'http'}://${request.headers.host}`;
          if (request.headers.origin !== expected && !allowedOrigins.includes(request.headers.origin)) throw fail('Запрос с другого сайта запрещён.', 403);
        }
        rate(`ip:${request.socket.remoteAddress || 'unknown'}`, 60);
        const body = await jsonBody(request);
        if (route === '/api/auth/logout') {
          const token = cookies(request).scena_session;
          const current = session(request);
          if (current) await mutate((_, transaction) => audit(transaction, 'logout', current.id, current.id));
          if (token) sessions.delete(digest(token));
          cookie(response, 'scena_session', '', 0);
          result = { ok: true };
        } else if (route === '/api/auth/email/start') result = await emailStart(request, response, body);
        else if (route === '/api/auth/email/verify') result = await emailVerify(request, response, body);
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
