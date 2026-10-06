const CACHE_PREFIX = 'telegram:bot-username:v2:';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const START_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_ID_PATTERN = /^[1-9]\d{4,19}$/;
const MAX_TOKEN_LENGTH = 512;
const MAX_CALLBACK_ID_LENGTH = 120;
const encoder = new TextEncoder();

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokenValue(value) {
  const token=textValue(value);
  if (
    !token
    || token.length>MAX_TOKEN_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(token)
  ) return '';
  return token;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number>0 ? number : null;
}

function nonNegativeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number>=0 ? number : null;
}

function boundedPositiveInteger(value, fallback, max) {
  const number=positiveInteger(value);
  return number !== null && number<=max ? number : fallback;
}

function normalizeUsername(value = '') {
  const username = textValue(value).replace(/^@/, '');
  return USERNAME_PATTERN.test(username) ? username : '';
}

function normalizeCallbackId(value) {
  const id=textValue(value);
  if (
    !id
    || id.length>MAX_CALLBACK_ID_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(id)
  ) return '';
  return id;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function primaryTokenFingerprint(botToken) {
  const token=tokenValue(botToken);
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for primary bot identity.');
  if (!globalThis.crypto?.subtle?.digest) {
    throw new Error('Secure crypto is required for primary bot identity.');
  }
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(token));
  return hex(digest).slice(0,32);
}

export async function primaryTelegramBotIdentityCacheKey(botToken) {
  return `${CACHE_PREFIX}${await primaryTokenFingerprint(botToken)}`;
}

export function primaryTelegramBotStableIdentity(botToken = '') {
  const token=tokenValue(botToken);
  const separator=token.indexOf(':');
  if (separator<=0) return '';
  const botId=token.slice(0,separator);
  const secretPart=token.slice(separator+1);
  if (
    !BOT_ID_PATTERN.test(botId)
    || !secretPart
    || /[\u0000-\u001f\u007f-\u009f]/u.test(secretPart)
  ) return '';
  return `id-${botId}`;
}

export function primaryTelegramUpdateDedupeKey(botToken, update = {}) {
  const identity=primaryTelegramBotStableIdentity(botToken);
  if (!identity) return '';
  const prefix=`b:${identity}`;

  const updateId=nonNegativeInteger(update?.update_id);
  if (updateId !== null) return `${prefix}:u:${updateId}`;

  const callbackId=normalizeCallbackId(update?.callback_query?.id);
  if (callbackId) return `${prefix}:c:${callbackId}`;

  const chatId=integerCandidate(update?.message?.chat?.id);
  const messageId=positiveInteger(update?.message?.message_id);
  return chatId !== null && chatId !== 0 && messageId !== null
    ? `${prefix}:m:${chatId}:${messageId}`
    : '';
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

  const me=await getMe();
  const username=normalizeUsername(me?.username);
  if (!username) throw new Error('Telegram bot username is unavailable.');

  if (typeof setCached === 'function') {
    const payload={
      username,
      botId:positiveInteger(me?.id),
      refreshedAt:new Date().toISOString(),
    };
    const ttl=boundedPositiveInteger(ttlMinutes,1440,10080);
    try {
      await setCached(cacheKey,payload,ttl);
    } catch {}
  }

  return username;
}

export function telegramBotStartUrl(username, startParam) {
  const safeUsername=normalizeUsername(username);
  const safeStart=textValue(startParam);
  if (!safeUsername) throw new Error('Telegram bot username is invalid.');
  if (!START_PATTERN.test(safeStart)) throw new Error('Telegram start parameter is invalid.');
  return `https://t.me/${safeUsername}?start=${encodeURIComponent(safeStart)}`;
}
