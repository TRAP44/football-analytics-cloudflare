import { bytesToHex, hmacSha256 } from './crypto-utils.js';

const encoder = new TextEncoder();
const REFERRAL_CODE_RE = /^[a-f0-9]{16}$/;

export function normalizeReferralCode(value = '') {
  const code = String(value || '').trim().toLowerCase();
  return REFERRAL_CODE_RE.test(code) ? code : '';
}

export async function opaqueReferralCode(userId, secret) {
  const id = Number(userId || 0);
  const key = String(secret || '');
  if (!Number.isSafeInteger(id) || id <= 0 || !key) return '';
  const digest = await hmacSha256(
    encoder.encode(key),
    `matchradar-referral-v1|${id}`,
  );
  return bytesToHex(digest).slice(0, 16);
}

export function splitLaunchReferralParts(parts = []) {
  const values = (Array.isArray(parts) ? parts : []).map(value => String(value || '').toLowerCase());
  const tail = values.at(-1) || '';
  const match = /^r([a-f0-9]{16})$/.exec(tail);
  if (!match) return { parts: values, referralCode: '' };
  values.pop();
  return { parts: values, referralCode: match[1] };
}

export function referralAttributionDecision({
  referredUserId,
  referrerUserId,
  referralCode,
  existingReferralCode = '',
} = {}) {
  const code = normalizeReferralCode(referralCode);
  const referred = Number(referredUserId || 0);
  const referrer = Number(referrerUserId || 0);
  const existing = normalizeReferralCode(existingReferralCode);
  if (!code) return { accepted: false, status: 'invalid_ref' };
  if (!Number.isSafeInteger(referred) || referred <= 0) return { accepted: false, status: 'invalid_user' };
  if (!Number.isSafeInteger(referrer) || referrer <= 0) return { accepted: false, status: 'forged_ref' };
  if (referred === referrer) return { accepted: false, status: 'self_referral' };
  if (existing) return { accepted: false, status: 'duplicate_attribution', referralCode: existing };
  return { accepted: true, status: 'accepted', referralCode: code };
}
