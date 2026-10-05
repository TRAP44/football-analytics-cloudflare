import { bytesToHex, hmacSha256 } from './crypto-utils.js';

const encoder = new TextEncoder();
const REFERRAL_CODE_RE = /^[a-f0-9]{16}$/;
const MAX_SECRET_LENGTH = 512;

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function hasRawValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function validSecret(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SECRET_LENGTH
    && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function normalizeReferralCode(value = '') {
  if (typeof value !== 'string') return '';
  const code = value.trim().toLowerCase();
  return REFERRAL_CODE_RE.test(code) ? code : '';
}

export async function opaqueReferralCode(userId, secret) {
  const id = positiveSafeInteger(userId);
  if (!id || !validSecret(secret)) return '';
  const digest = await hmacSha256(
    encoder.encode(secret),
    `matchradar-referral-v1|${id}`,
  );
  const hex=bytesToHex(digest);
  return typeof hex === 'string' && /^[a-f0-9]{64}$/i.test(hex)
    ? hex.toLowerCase().slice(0,16)
    : '';
}

export function splitLaunchReferralParts(parts = []) {
  const values = (Array.isArray(parts) ? parts : [])
    .slice(0,16)
    .map(value => typeof value === 'string' ? value.trim().toLowerCase() : '');
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
  const referred = positiveSafeInteger(referredUserId);
  const referrer = positiveSafeInteger(referrerUserId);
  const existing = normalizeReferralCode(existingReferralCode);
  const hasExisting=hasRawValue(existingReferralCode);

  if (!code) return { accepted:false, status:'invalid_ref' };
  if (!referred) return { accepted:false, status:'invalid_user' };
  if (!referrer) return { accepted:false, status:'forged_ref' };
  if (referred === referrer) return { accepted:false, status:'self_referral' };
  if (hasExisting) {
    return {
      accepted:false,
      status:'duplicate_attribution',
      ...(existing ? {referralCode:existing} : {}),
    };
  }
  return { accepted:true, status:'accepted', referralCode:code };
}
