import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBillingApiRuntime } from '../src/billing-api-runtime.js';

function makeHarness(overrides={}) {
  let webhookChecks=0,invoiceCalls=0;
  const fn=async()=>null;
  const deps={
    PASS_TYPES:{MATCH:'MATCH_PASS',DAY:'DAY_PASS',WEEKEND:'WEEKEND_PASS'},
    SUBSCRIPTION_PERIOD_SECONDS:2592000,
    adminForbidden:fn,
    applyRefundedPayment:fn,
    billingPlanConfig:()=>({stars:199}),
    billingWebhookStatus:async()=>{webhookChecks++;return {ready:true};},
    createPassInvoicePayload:fn,
    findRefundableBillingCharge:fn,
    getQuota:fn,
    getUserRecord:fn,
    hasSupabase:()=>true,
    isAdminUser:()=>false,
    json:(body,status=200)=>({body,status}),
    listUserEntitlements:fn,
    makeInvoicePayload:fn,
    memory:{billingPayments:new Map(),users:new Map()},
    passProductConfig:fn,
    recordOpsEvent:fn,
    resolveUserEntitlements:fn,
    supaSelectMany:fn,
    syncBillingFromStars:fn,
    telegramApi:async()=>{invoiceCalls++;return 'https://t.me/$invoice';},
    updateUserSubscription:fn,
    ...overrides,
  };
  return {api:createBillingApiRuntime(deps),getCounts:()=>({webhookChecks,invoiceCalls})};
}

test('direct invoice call fails closed when monetization is paused even if the webhook is available',async()=>{
  const {api,getCounts}=makeHarness();
  const result=await api.apiBillingInvoice(
    {json:async()=>({plan:'PRO'})},
    {monetizationEnabled:false,botToken:'fake'},
    {id:123},
  );
  assert.equal(result.status,503);
  assert.equal(result.body.code,'BILLING_MONETIZATION_DISABLED');
  assert.deepEqual(getCounts(),{webhookChecks:0,invoiceCalls:0});
});

test('payment guard rejects truthy but non-boolean monetization flags',async()=>{
  const {api,getCounts}=makeHarness();
  for(const flag of ['true',1,{},null,undefined]){
    const result=await api.apiBillingInvoice({json:async()=>({plan:'PRO'})},
      {monetizationEnabled:flag},{id:123});
    assert.equal(result.status,503,String(flag));
  }
  assert.deepEqual(getCounts(),{webhookChecks:0,invoiceCalls:0});
});

test('Telegram Stars pre-checkout approves only sale-ready Pass products',()=>{
  const source=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
  assert.match(source,/passCfg\?\.saleReady === true/);
  assert.match(source,/q\.currency === 'XTR'/);
  assert.match(source,/samePositiveInteger\(passCfg\.stars,checkoutAmount\)/);
  assert.match(source,/if \(!cfg\.monetizationEnabled\)/);
});

test('purchase endpoints remain routed behind server-side pause guard',()=>{
  const router=fs.readFileSync('src/router.js','utf8');
  const before=router.indexOf('if (cfg?.monetizationEnabled !== true)');
  const invoice=router.indexOf("pathname === '/api/billing/invoice'");
  assert.ok(before>0 && invoice>before);
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
  assert.match(wrangler,/"MONETIZATION_ENABLED": "true"/);
});

test('Stars pricing catalog remains available without account database reads',async()=>{
  let quotaCalls=0,recordCalls=0;
  const {api,getCounts}=makeHarness({
    getQuota:async()=>{quotaCalls++;throw new Error('database unavailable');},
    getUserRecord:async()=>{recordCalls++;throw new Error('database unavailable');},
    billingPlanConfig:plan=>({
      stars:plan==='PRO'?199:399,
    }),
    passProductConfig:()=>({stars:39,saleReady:true}),
  });
  const cfg={
    monetizationEnabled:true,
    limits:{FREE:3,PRO:20,PREMIUM:100},
  };
  const result=await api.apiBillingPlans(
    new Request('https://example.com/api/billing/plans'),cfg,{id:123},
  );
  assert.equal(result.status,200);
  assert.equal(result.body.enabled,true);
  assert.equal(result.body.ready,true);
  assert.deepEqual(result.body.current,{});
  assert.deepEqual(result.body.plans,{
    FREE:{stars:0,dailyLimit:3},
    PRO:{stars:199,dailyLimit:20},
    PREMIUM:{stars:399,dailyLimit:100},
  });
  assert.deepEqual({quotaCalls,recordCalls},{quotaCalls:0,recordCalls:0});
  assert.deepEqual(getCounts(),{webhookChecks:1,invoiceCalls:0});
});

test('paused checkout keeps prices visible while invoices remain blocked',async()=>{
  const {api}=makeHarness({
    billingPlanConfig:plan=>({stars:plan==='PRO'?199:399}),
    passProductConfig:()=>({stars:39,saleReady:true}),
  });
  const cfg={monetizationEnabled:false,limits:{FREE:3,PRO:20,PREMIUM:100}};
  const catalog=await api.apiBillingPlans(
    new Request('https://example.com/api/billing/plans'),cfg,{id:123},
  );
  assert.equal(catalog.status,200);
  assert.equal(catalog.body.ready,false);
  assert.equal(catalog.body.plans.PRO.stars,199);
  const invoice=await api.apiBillingInvoice(
    {json:async()=>({plan:'PRO'})},cfg,{id:123},
  );
  assert.equal(invoice.status,503);
  assert.equal(invoice.body.code,'BILLING_MONETIZATION_DISABLED');
});
