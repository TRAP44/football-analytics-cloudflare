import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { billingUiSnapshot } from '../public/modules/billing.js';

const worker = (fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const router = fs.readFileSync('src/router.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
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

test('billing endpoints remain fail-closed while MONETIZATION_ENABLED is false', () => {
  const gate = router.indexOf("if (!cfg.monetizationEnabled) return json");
  const plans = router.indexOf("url.pathname === '/api/billing/plans'");
  const invoice = router.indexOf("url.pathname === '/api/billing/invoice'");
  assert.ok(gate > 0 && plans > gate && invoice > gate);
  assert.match(billingModule, /state\.profile\?\.features\?\.monetizationEnabled === false/);
  assert.match(worker, /enabled: Boolean\(cfg\.monetizationEnabled\)/);
  assert.match(env, /MONETIZATION_ENABLED=false/);
  assert.doesNotMatch(env, /MONETIZATION_ENABLED=true/);
});

test('subscription and Pass payment truth remains server-side and XTR validated', () => {
  assert.match(worker, /payment\.currency !== 'XTR'/);
  assert.match(worker, /Number\(payment\.total_amount\) !== Number\(planCfg\.stars\)/);
  assert.match(worker, /parseInvoicePayload\(payment\.invoice_payload, cfg\.botToken\)/);
  assert.match(worker, /parsePassInvoicePayload\(payment\.invoice_payload, cfg\.botToken\)/);
  assert.match(worker, /activatePassPurchase\(\{/);
  assert.match(worker, /getStarTransactions/);
  assert.match(worker, /editUserStarSubscription/);
  assert.match(worker, /telegram_payment_charge_id/);
  assert.doesNotMatch(billingModule, /\b199\b|\b399\b/);
});

test('manual Telegram Stars refund requires server admin authorization and verified charge ownership', () => {
  assert.match(router, /\/api\/admin\/billing\/refund/);
  assert.match(router, /if \(!isAdminUser\(user, cfg\)\) return adminForbidden\(\)/);
  assert.match(worker, /async function findRefundableBillingCharge/);
  assert.match(worker, /listUserEntitlements\(uid, cfg\)/);
  assert.match(worker, /async function apiBillingRefund/);
  assert.match(worker, /reason\.length < 3/);
  assert.match(worker, /refundStarPayment/);
  assert.match(worker, /applyRefundedPayment\(targetUserId, chargeId, cfg\)/);
  assert.match(worker, /CHARGE_ALREADY_REFUNDED/);
  assert.match(worker, /reconciled:true/);
});

test('Telegram bot exposes payment support without enabling monetization', () => {
  assert.match(worker, /paysupport/);
  assert.match(worker, /Поддержка по оплате MatchRadar/);
  assert.match(worker, /Возврат выполняется только после ручной проверки/);
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
  assert.match(analysisController, /const quotaExhausted = error\?\.status === 429/);
  assert.match(analysisController, /showPaywall\(fixtureId\)/);
  assert.match(analysisController, /retry: \(\) => analyzeMatch/);
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
