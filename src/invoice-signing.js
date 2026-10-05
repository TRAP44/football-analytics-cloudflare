import { bytesToHex, constantTimeEqual, hmacSha256 } from './crypto-utils.js';

const enc = new TextEncoder();

export async function signInvoiceBase(base, signingSecret) {
  const secret=String(signingSecret || '');
  if (!secret) {
    const error=new Error('INVOICE_SIGNING_SECRET is required.');
    error.code='INVOICE_SIGNING_SECRET_REQUIRED';
    throw error;
  }
  return bytesToHex(await hmacSha256(enc.encode(secret), String(base || ''))).slice(0,24);
}

export async function verifyInvoiceBaseSignature(base, signature, signingSecret, legacySecret = '') {
  const sig=String(signature || '').toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(sig)) return false;
  const candidates=[String(signingSecret || ''),String(legacySecret || '')]
    .filter((value,index,list)=>value && list.indexOf(value)===index);
  let matched=false;
  for (const secret of candidates) {
    const expected=await signInvoiceBase(base,secret);
    matched = constantTimeEqual(expected.toLowerCase(),sig) || matched;
  }
  return matched;
}
