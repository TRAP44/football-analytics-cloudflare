const CACHE_PREFIX = 'telegram:bot-username:v2:';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const START_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_ID_PATTERN = /^[1-9]\d{4,19}$/;
const MAX_TOKEN_LENGTH = 512;
const MAX_CALLBACK_ID_LENGTH = 120;
const MAX_USERNAME_INPUT_LENGTH = 64;
const MAX_INTEGER_TEXT_LENGTH = 24;
const MAX_START_INPUT_LENGTH = 128;
const encoder = new TextEncoder();

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function tokenValue(value) {
  if (typeof value !== 'string' || value.length > MAX_TOKEN_LENGTH) return '';
  const token=value.trim();
  if (
    !token
    || /[\u0000-\u001f\u007f-\u009f]/u.test(token)
  ) return '';
  return token;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || value.length > MAX_INTEGER_TEXT_LENGTH) return null;
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
  if (typeof value !== 'string' || value.length > MAX_USERNAME_INPUT_LENGTH) return '';
  const username=value.trim().replace(/^@/, '');
  return USERNAME_PATTERN.test(username) ? username : '';
}

function normalizeCallbackId(value) {
  if (typeof value !== 'string' || value.length > MAX_CALLBACK_ID_LENGTH) return '';
  const id=value.trim();
  if (
    !id
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
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('Secure crypto is required for primary bot identity.');
  }
  const digest=await globalThis.crypto.subtle.digest('SHA-256',encoder.encode(token));
  const fingerprint=hex(digest);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error('Primary Telegram bot identity fingerprint is invalid.');
  }
  return fingerprint.slice(0,32);
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
  if (!plainObject(update)) return '';
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

export async function resolvePrimaryTelegramBotUsername(options = {}) {
  const source=plainObject(options);
  if (!source) throw new TypeError('Primary Telegram bot identity options are required.');
  const {
    botToken,
    getCached,
    setCached,
    getMe,
    ttlMinutes = 1440,
  } = source;
  if (typeof getMe !== 'function') throw new Error('Primary Telegram getMe resolver is required.');
  const token=tokenValue(botToken);
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required for primary bot identity.');
  const cacheKey = await primaryTelegramBotIdentityCacheKey(token);
  const stableIdentity=primaryTelegramBotStableIdentity(token);
  const expectedBotId=stableIdentity ? positiveInteger(stableIdentity.slice(3)) : null;

  if (typeof getCached === 'function') {
    try {
      const cached=plainObject(await getCached(cacheKey));
      const cachedUsername=normalizeUsername(cached?.username);
      const cachedBotId=positiveInteger(cached?.botId);
      const cacheIdentityValid=expectedBotId === null || cachedBotId === expectedBotId;
      if (cachedUsername && cacheIdentityValid) return cachedUsername;
    } catch {}
  }

  const me=plainObject(await getMe());
  const username=normalizeUsername(me?.username);
  const resolvedBotId=positiveInteger(me?.id);
  if (!username) throw new Error('Telegram bot username is unavailable.');
  if (expectedBotId !== null && resolvedBotId !== expectedBotId) {
    throw new Error('Telegram bot identity does not match TELEGRAM_BOT_TOKEN.');
  }

  if (typeof setCached === 'function') {
    const payload={
      username,
      botId:resolvedBotId,
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
  const safeStart=typeof startParam === 'string' && startParam.length <= MAX_START_INPUT_LENGTH
    ? startParam.trim()
    : '';
  if (!safeUsername) throw new Error('Telegram bot username is invalid.');
  if (!START_PATTERN.test(safeStart)) throw new Error('Telegram start parameter is invalid.');
  return `https://t.me/${safeUsername}?start=${encodeURIComponent(safeStart)}`;
}
