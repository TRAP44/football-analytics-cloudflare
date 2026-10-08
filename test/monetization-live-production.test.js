import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { passProductConfig, PASS_TYPES } from '../src/entitlements.js';
import { billingPurchaseVisibility, billingUiSnapshot } from '../public/modules/billing.js';
import { createBillingApiRuntime } from '../src/billing-api-runtime.js';

const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
const source=fs.readFileSync('src/router.js','utf8');
const web=fs.readFileSync('public/index.html','utf8');
const billing=fs.readFileSync('public/modules/billing.js','utf8');

test('production monetization exposes existing products without enabling development billing by default',()=>{
  assert.match(wrangler,/"MONETIZATION_ENABLED":\s*"true"/);
  assert.match(wrangler,/"WEEKEND_PASS_USAGE_LIMIT":\s*"6"/);
  assert.match(fs.readFileSync('.env.example','utf8'),/MONETIZATION_ENABLED=false/);
  assert.match(source,/cfg\?\.monetizationEnabled !== true/);
  assert.match(source,/pathname === '\/api\/billing\/invoice'/);
  assert.match(source,/pathname === '\/api\/billing\/subscription'/);
  assert.match(web,/id="billingPricingGrid"/);
  assert.match(web,/id="passStore"/);
  assert.match(web,/id="billingSyncBtn"/);
  assert.match(web,/id="subscriptionManageBtn"/);
  assert.match(billing,/if \(preview\) preview\.hidden=purchaseUi\.enabled/);
});

test('all three Pass variants, including capped Weekend Pass, are ready for sale',()=>{
  const cfg={
    passPrices:{MATCH_PASS:39,DAY_PASS:89,WEEKEND_PASS:149},
    passDurations:{MATCH_PASS:72,DAY_PASS:24,WEEKEND_PASS:168},
    passUsageLimits:{WEEKEND_PASS:6},
  };
  const prices={MATCH_PASS:39,DAY_PASS:89,WEEKEND_PASS:149};
  for(const [kind,price] of Object.entries(prices)){
    const item=passProductConfig(kind,cfg);
    assert.equal(item.stars,price);
    assert.equal(item.saleReady,true);
  }
  assert.equal(passProductConfig(PASS_TYPES.WEEKEND,cfg).usageLimit,6);
  assert.equal(passProductConfig(PASS_TYPES.WEEKEND,{
    ...cfg,passUsageLimits:{},
  }).saleReady,false);
});

test('enabled product catalogue restores PRO and PREMIUM while retaining FREE',()=>{
  const snapshot=billingUiSnapshot({
    features:{monetizationEnabled:true},
    quota:{plan:'FREE',used:0,left:3,limit:3},
  },{
    enabled:true,ready:true,
    current:{plan:'FREE'},
    plans:{
      FREE:{dailyLimit:3},
      PRO:{stars:199,dailyLimit:20},
      PREMIUM:{stars:399,dailyLimit:100},
    },
  });
  assert.equal(snapshot.monetizationEnabled,true);
  assert.equal(snapshot.ready,true);
  assert.deepEqual(billingPurchaseVisibility(snapshot),{
    enabled:true,pricing:true,passes:true,paymentActions:true,quotaUpgrade:true,
  });
  const paused=billingUiSnapshot({
    features:{monetizationEnabled:false},
    quota:{plan:'FREE',used:0,limit:3},
  },{enabled:true,ready:true});
  assert.equal(paused.monetizationEnabled,false);
  assert.equal(paused.ready,false);
});

function invoiceFixture(webhook) {
  let invoiceCalls=0,webhookCalls=0;
  const fn=async()=>null;
  const deps={
    PASS_TYPES,SUBSCRIPTION_PERIOD_SECONDS:2592000,
    adminForbidden:fn,applyRefundedPayment:fn,billingPlanConfig:()=>({stars:199}),
    billingWebhookStatus:async()=>{webhookCalls++;return webhook;},
    createPassInvoicePayload:fn,findRefundableBillingCharge:fn,
    getQuota:async()=>({plan:'FREE'}),getUserRecord:async()=>null,
    hasSupabase:()=>true,isAdminUser:()=>false,json:(body,status=200)=>({body,status}),
    listUserEntitlements:fn,makeInvoicePayload:fn,
    memory:{billingPayments:new Map(),users:new Map()},
    passProductConfig:()=>null,recordOpsEvent:fn,resolveUserEntitlements:fn,
    supaSelectMany:fn,syncBillingFromStars:fn,
    telegramApi:async()=>{invoiceCalls++;return 'https://t.me/$test';},
    updateUserSubscription:fn,
  };
  return {
    api:createBillingApiRuntime(deps),
    counts:()=>({invoiceCalls,webhookCalls}),
  };
}

test('even when monetization is enabled, a mismatched webhook blocks Stars invoice creation',async()=>{
  const {api,counts}=invoiceFixture({ready:false,reason:'webhook_url_mismatch'});
  const result=await api.apiBillingInvoice({
    json:async()=>({plan:'PRO'}),
  },{monetizationEnabled:true,botToken:'mock-bot'}, {id:111});
  assert.equal(result.status,503);
  assert.match(result.body.error,/Telegram webhook/);
  assert.deepEqual(counts(),{invoiceCalls:0,webhookCalls:1});
});

test('paused monetization still rejects invoices independently of webhook status',async()=>{
  const {api,counts}=invoiceFixture({ready:true});
  const result=await api.apiBillingInvoice({
    json:async()=>({plan:'PREMIUM'}),
  },{monetizationEnabled:false,botToken:'mock-bot'},{id:111});
  assert.equal(result.status,503);
  assert.equal(result.body.code,'BILLING_MONETIZATION_DISABLED');
  assert.deepEqual(counts(),{invoiceCalls:0,webhookCalls:0});
});
