import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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


test('production deploy configures dedicated invoice secret when available without blocking dormant billing',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  assert.match(workflow,/INVOICE_SIGNING_SECRET: \$\{\{ secrets\.INVOICE_SIGNING_SECRET \}\}/);
  assert.doesNotMatch(workflow,/-z "\$INVOICE_SIGNING_SECRET"/);
  assert.match(workflow,/wrangler secret put INVOICE_SIGNING_SECRET/);
  assert.match(workflow,/env\.INVOICE_SIGNING_SECRET != ''/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required before production deployment/);
});
