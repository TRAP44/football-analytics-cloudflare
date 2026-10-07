const encoder = new TextEncoder();
export const TELEGRAM_AUTH_FUTURE_SKEW_SECONDS = 30;

function byteView(bytes) {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  throw new TypeError('Expected binary data.');
}

function positiveTelegramUserId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const id=Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sanitizedTelegramUser(user, userId) {
  const safe={};
  for (const [key,value] of Object.entries(user)) {
    if (
      key.startsWith('__')
      || key === '__proto__'
      || key === 'prototype'
      || key === 'constructor'
    ) continue;
    safe[key]=value;
  }
  safe.id=userId;
  return safe;
}

export function bytesToHex(bytes) {
  return [...byteView(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    const leftCode = index < a.length ? a.charCodeAt(index) : 0;
    const rightCode = index < b.length ? b.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }
  return diff === 0;
}

export async function hmacSha256(keyBytes, message) {
  if (typeof message !== 'string') throw new TypeError('HMAC message must be a string.');
  const keyMaterial=byteView(keyBytes);
  if (!keyMaterial.byteLength) throw new TypeError('HMAC key must not be empty.');
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

export async function validateTelegramInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (
    typeof initData !== 'string'
    || !initData
    || typeof botToken !== 'string'
    || !botToken
  ) return null;

  const params = new URLSearchParams(initData);
  if (
    params.getAll('hash').length !== 1
    || params.getAll('auth_date').length !== 1
    || params.getAll('user').length !== 1
  ) return null;

  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const calculated = bytesToHex(await hmacSha256(new Uint8Array(secretKey), dataCheckString));
  if (!constantTimeEqual(calculated.toLowerCase(), receivedHash.toLowerCase())) return null;

  if (typeof maxAgeSeconds !== 'number' || !Number.isFinite(maxAgeSeconds)) return null;
  const requestedMaxAge = Math.floor(maxAgeSeconds);
  if (requestedMaxAge < 1) return null;
  const ageLimit = Math.min(24 * 60 * 60, requestedMaxAge);

  const authDateRaw=params.get('auth_date') || '';
  if (!/^\d+$/.test(authDateRaw)) return null;
  const authDate = Number(authDateRaw);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + TELEGRAM_AUTH_FUTURE_SKEW_SECONDS) return null;
  if (nowSeconds - authDate > ageLimit) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
    const userId = positiveTelegramUserId(user.id);
    if (userId === null) return null;
    return sanitizedTelegramUser(user,userId);
  } catch {
    return null;
  }
}
