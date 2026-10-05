import test from 'node:test';
import assert from 'node:assert/strict';
import { signInvoiceBase, verifyInvoiceBaseSignature } from '../src/invoice-signing.js';

const PRIMARY='invoice-secret-v2';
const LEGACY='legacy-bot-token';

test('new invoice signatures verify with the dedicated signing secret',async()=>{
  const base='fa1|42|PRO|001122aabbcc';
  const sig=await signInvoiceBase(base,PRIMARY);
  assert.match(sig,/^[0-9a-f]{24}$/);
  assert.equal(await verifyInvoiceBaseSignature(base,sig,PRIMARY,LEGACY),true);
  assert.equal(await verifyInvoiceBaseSignature(base,sig,'wrong',LEGACY),false);
});

test('legacy signatures remain verifiable only through the explicit compatibility key',async()=>{
  const base='fa2|42|MATCH_PASS|777|001122aabbcc';
  const legacySig=await signInvoiceBase(base,LEGACY);
  assert.equal(await verifyInvoiceBaseSignature(base,legacySig,PRIMARY,LEGACY),true);
  assert.equal(await verifyInvoiceBaseSignature(base,legacySig,PRIMARY,''),false);
});

test('invoice signing fails closed without a dedicated secret and rejects tampering',async()=>{
  await assert.rejects(()=>signInvoiceBase('payload',''),error=>error?.code==='INVOICE_SIGNING_SECRET_REQUIRED');
  const sig=await signInvoiceBase('payload',PRIMARY);
  assert.equal(await verifyInvoiceBaseSignature('payload-tampered',sig,PRIMARY,LEGACY),false);
  assert.equal(await verifyInvoiceBaseSignature('payload','not-a-signature',PRIMARY,LEGACY),false);
});
