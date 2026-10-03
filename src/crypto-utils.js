const encoder = new TextEncoder();
export const TELEGRAM_AUTH_FUTURE_SKEW_SECONDS = 30;

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }
  return diff === 0;
}

export async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(String(message ?? '')));
}

export async function validateTelegramInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
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

  const authDate = Number(params.get('auth_date') || 0);
  const ageLimit = Math.max(60, Math.min(24 * 60 * 60, Number(maxAgeSeconds || 0)));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (authDate > nowSeconds + TELEGRAM_AUTH_FUTURE_SKEW_SECONDS) return null;
  if (nowSeconds - authDate > ageLimit) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user?.id ? user : null;
  } catch {
    return null;
  }
}
