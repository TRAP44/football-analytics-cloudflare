const CACHE_PREFIX = 'telegram:bot-username:v2:';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const START_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_ID_PATTERN = /^[1-9]\d{4,19}$/;
const encoder = new TextEncoder();

function normalizeUsername(value = '') {
  const username = String(value || '').trim().replace(/^@/, '');
  return USERNAME_PATTERN.test(username) ? username : '';
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function primaryTokenFingerprint(botToken) {
  const token = String(botToken || '').trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for primary bot identity.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return hex(digest).slice(0, 32);
}

export async function primaryTelegramBotIdentityCacheKey(botToken) {
  return `${CACHE_PREFIX}${await primaryTokenFingerprint(botToken)}`;
}

export function primaryTelegramBotStableIdentity(botToken = '') {
  const token = String(botToken || '').trim();
  const separator = token.indexOf(':');
  if (separator <= 0) return '';
  const botId = token.slice(0, separator);
  const secretPart = token.slice(separator + 1);
  if (!BOT_ID_PATTERN.test(botId) || !secretPart) return '';
  return `id-${botId}`;
}

export function primaryTelegramUpdateDedupeKey(botToken, update = {}) {
  const identity = primaryTelegramBotStableIdentity(botToken);
  if (!identity) return '';
  const prefix = `b:${identity}`;

  const updateId = Number(update?.update_id);
  if (Number.isSafeInteger(updateId) && updateId >= 0) return `${prefix}:u:${updateId}`;

  const callbackId = String(update?.callback_query?.id || '');
  if (callbackId) return `${prefix}:c:${callbackId.slice(0, 120)}`;

  const chatId = Number(update?.message?.chat?.id || 0);
  const messageId = Number(update?.message?.message_id || 0);
  return chatId && messageId ? `${prefix}:m:${chatId}:${messageId}` : '';
}

export async function resolvePrimaryTelegramBotUsername({
  botToken,
  getCached,
  setCached,
  getMe,
  ttlMinutes = 1440,
} = {}) {
  if (typeof getMe !== 'function') throw new Error('Primary Telegram getMe resolver is required.');
  const cacheKey = await primaryTelegramBotIdentityCacheKey(botToken);

  if (typeof getCached === 'function') {
    try {
      const cached = await getCached(cacheKey);
      const cachedUsername = normalizeUsername(cached?.username);
      if (cachedUsername) return cachedUsername;
    } catch {}
  }

  const me = await getMe();
  const username = normalizeUsername(me?.username);
  if (!username) throw new Error('Telegram bot username is unavailable.');

  if (typeof setCached === 'function') {
    const payload = {
      username,
      botId: Number.isSafeInteger(Number(me?.id)) ? Number(me.id) : null,
      refreshedAt: new Date().toISOString(),
    };
    try {
      await setCached(cacheKey, payload, Math.max(1, Number(ttlMinutes || 1440)));
    } catch {}
  }

  return username;
}

export function telegramBotStartUrl(username, startParam) {
  const safeUsername = normalizeUsername(username);
  const safeStart = String(startParam || '').trim();
  if (!safeUsername) throw new Error('Telegram bot username is invalid.');
  if (!START_PATTERN.test(safeStart)) throw new Error('Telegram start parameter is invalid.');
  return `https://t.me/${safeUsername}?start=${encodeURIComponent(safeStart)}`;
}
