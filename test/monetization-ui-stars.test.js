import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { billingUiSnapshot } from '../public/modules/billing.js';

const worker = fs.readFileSync('src/worker.js','utf8');
const telegramUpdate = fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const billingRuntime = fs.readFileSync('src/billing-runtime.js','utf8');
const billingApi = fs.readFileSync('src/billing-api-runtime.js','utf8');
const router = fs.readFileSync('src/router.js', 'utf8');
const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const billingModule = fs.readFileSync('public/modules/billing.js', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');

test('billing snapshot keeps FREE usable while monetization is paused and derives quota from server profile', () => {
  const snapshot = billingUiSnapshot({
    quota: { plan:'FREE', used:2, limit:3, left:1 },
    billing: { plan:'FREE' },
    features: { monetizationEnabled:false },
  }, {
    enabled:false,
    ready:false,
    plans:{ FREE:{ dailyLimit:3 }, PRO:{ stars:199, dailyLimit:20 } },
  }, Date.parse('2026-10-01T10:00:00Z'));
  assert.equal(snapshot.plan, 'FREE');
  assert.equal(snapshot.used, 2);
  assert.equal(snapshot.limit, 3);
  assert.equal(snapshot.left, 1);
  assert.equal(snapshot.monetizationEnabled, false);
  assert.equal(snapshot.ready, false);
});

test('expired subscription renders as FREE without trusting stale client plan state', () => {
  const snapshot = billingUiSnapshot({
    quota:{ plan:'PRO', used:5, limit:20, left:15 },
    billing:{ plan:'PRO', subscriptionUntil:'2026-09-30T00:00:00Z', canceled:true },
    features:{ monetizationEnabled:true },
  }, { enabled:true, ready:true }, Date.parse('2026-10-01T10:00:00Z'));
  assert.equal(snapshot.plan, 'FREE');
  assert.equal(snapshot.expired, true);
  assert.equal(snapshot.canceled, true);
});

test('billing keeps plan previews readable and purchases fail-closed while MONETIZATION_ENABLED is false', () => {
  const gate = router.indexOf("if (cfg?.monetizationEnabled !== true) return json");
  const plans = router.indexOf("pathname === '/api/billing/plans'");
  const invoice = router.indexOf("pathname === '/api/billing/invoice'");
  assert.ok(plans > 0 && gate > plans && invoice > gate);
  assert.match(billingModule, /state\.profile\?\.features\?\.monetizationEnabled === false/);
  assert.match(billingApi, /enabled: cfg\.monetizationEnabled === true/);
  assert.match(billingApi, /ready: Boolean\(cfg\.monetizationEnabled === true && webhook\.ready\)/);
  assert.match(billingApi, /paymentsEnabled: cfg\.monetizationEnabled === true/);
  assert.doesNotMatch(billingApi, /enabled: Boolean\(cfg\.monetizationEnabled\)/);
  assert.doesNotMatch(billingApi, /paymentsEnabled: Boolean\(cfg\.monetizationEnabled\)/);
  assert.match(env, /MONETIZATION_ENABLED=false/);
  assert.doesNotMatch(env, /MONETIZATION_ENABLED=true/);
});

test('subscription and Pass payment truth remains server-side and XTR validated', () => {
  assert.match(billingRuntime, /payment\.currency !== 'XTR'/);
  assert.match(billingRuntime, /amount!==positiveInt\(planCfg\.stars\)/);
  assert.match(billingRuntime, /parseInvoicePayload\(payment\.invoice_payload, cfg\.botToken\)/);
  assert.match(billingRuntime, /parsePassInvoicePayload\(payment\.invoice_payload, cfg\.botToken\)/);
  assert.match(billingRuntime, /activatePassPurchase\(\{/);
  assert.match(billingRuntime, /getStarTransactions/);
  assert.match(billingApi, /editUserStarSubscription/);
  assert.match(billingRuntime, /telegram_payment_charge_id/);
  assert.doesNotMatch(billingModule, /\b199\b|\b399\b/);
});

test('manual Telegram Stars refund requires server admin authorization and verified charge ownership', () => {
  assert.match(router, /pathname === '\/api\/admin\/billing\/refund'/);
  assert.match(router, /if \(!adminAllowed\(\)\) return adminForbidden\(\)/);
  assert.match(billingRuntime, /async function findRefundableBillingCharge/);
  assert.match(billingRuntime, /listUserEntitlements\(uid, cfg\)/);
  assert.match(billingApi, /async function apiBillingRefund\(/);
  assert.match(billingApi, /reason\.length < 3/);
  assert.match(billingApi, /refundStarPayment/);
  assert.match(billingApi, /applyRefundedPayment\(targetUserId, chargeId, cfg\)/);
  assert.match(billingApi, /CHARGE_ALREADY_REFUNDED/);
  assert.match(billingApi, /reconciled:true/);
});

test('Telegram bot exposes payment support without enabling monetization', () => {
  assert.match(telegramUpdate, /paysupport/);
  assert.match(telegramUpdate, /Поддержка по оплате MatchRadar/);
  assert.match(telegramUpdate, /Возврат выполняется только после ручной проверки/);
});

test('Profile contains compact FREE PRO PREMIUM billing UI and four-item bottom navigation stays unchanged', () => {
  assert.match(html, /id="billingPanel"/);
  assert.match(html, /data-plan="FREE"/);
  assert.match(html, /data-plan="PRO"/);
  assert.match(html, /data-plan="PREMIUM"/);
  assert.match(html, /id="billingQuotaUsed"/);
  assert.match(html, /id="billingQuotaLeft"/);
  assert.match(html, /id="subscriptionManageBtn"/);
  const navLabels = [...html.matchAll(/<button id="nav[^"]+"[\s\S]*?<small>([^<]+)<\/small><\/button>/g)].map(m => m[1]);
  assert.deepEqual(navLabels, ['Главная', 'Мои команды', 'История', 'Профиль']);
});

test('AI quota exhaustion is a soft paywall and does not hide football surfaces', () => {
  assert.match(html, /id="analysisQuotaPaywall"/);
  assert.match(html, /Матчи, LIVE, составы и статистика остаются доступны бесплатно/);
  assert.match(analysisController, /const quotaExhausted=status===429/);
  assert.match(analysisController, /safeCall\(showPaywall,id\)/);
  assert.match(analysisController, /retry:\(\)=>analyzeMatch/);
  assert.match(billingModule, /quotaUpgradeBtn/);
  assert.match(billingModule, /openProfile/);
});

test('billing UI covers payment states and guards duplicate actions', () => {
  for (const state of ['opening','syncing','success','pending','failed','cancelled']) {
    assert.match(billingModule, new RegExp("paymentState === '"+state+"'"));
  }
  assert.match(billingModule, /if \(!paidPlans\.has\(normalized\) \|\| busyAction \|\| syncing\) return/);
  assert.match(billingModule, /busyAction = 'purchase:' \+ normalized/);
  assert.match(billingModule, /after\.plan === normalized/);
  assert.match(billingModule, /Сервер ещё синхронизирует доступ/);
});

test('billing layout has explicit narrow-screen safeguards for 320-430 class widths', () => {
  assert.match(css, /billing-panel \* \{ min-width:0/);
  assert.match(css, /@media \(max-width:430px\)[\s\S]*billing-pricing-grid \{ grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:360px\)[\s\S]*billing-panel/);
  assert.match(css, /billing-actions[\s\S]*flex-wrap:wrap/);
});

test('billing composition root delegates to the current modular runtimes', () => {
  assert.match(worker,/createBillingRuntime/);
  assert.match(worker,/createBillingApiRuntime/);
  assert.match(worker,/applySuccessfulPayment/);
  assert.match(worker,/apiBillingRefund/);
});
