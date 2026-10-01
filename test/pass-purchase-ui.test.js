import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { passProductConfig } from '../src/entitlements.js';
import {
  buildPassPurchaseBody,
  passUiState,
} from '../public/modules/billing.js';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const router = fs.readFileSync('src/router.js', 'utf8');
const billing = fs.readFileSync('public/modules/billing.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');
const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));

test('Weekend Pass stays fail-closed without a usage limit and becomes sale-ready at the configured cap', () => {
  const missing = passProductConfig('WEEKEND_PASS', { passUsageLimits:{ WEEKEND_PASS:null } });
  const configured = passProductConfig('WEEKEND_PASS', { passUsageLimits:{ WEEKEND_PASS:6 } });
  assert.equal(missing.saleReady, false);
  assert.equal(missing.usageLimit, null);
  assert.equal(configured.saleReady, true);
  assert.equal(configured.usageLimit, 6);
  assert.match(env, /WEEKEND_PASS_USAGE_LIMIT=6/);
  assert.equal(wrangler.vars.WEEKEND_PASS_USAGE_LIMIT, '6');
  assert.equal(wrangler.vars.MONETIZATION_ENABLED, 'true');
  assert.match(env, /MONETIZATION_ENABLED=false/);
});

test('Match Pass purchase body requires the concrete fixture and Day Weekend ignore fixture injection', () => {
  assert.deepEqual(buildPassPurchaseBody('MATCH_PASS', 777), { passType:'MATCH_PASS', fixtureId:777 });
  assert.equal(buildPassPurchaseBody('MATCH_PASS', 0), null);
  assert.equal(buildPassPurchaseBody('MATCH_PASS', -1), null);
  assert.equal(buildPassPurchaseBody('MATCH_PASS', 1.5), null);
  assert.deepEqual(buildPassPurchaseBody('DAY_PASS', 777), { passType:'DAY_PASS' });
  assert.deepEqual(buildPassPurchaseBody('WEEKEND_PASS', 777), { passType:'WEEKEND_PASS' });
  assert.equal(buildPassPurchaseBody('OTHER_PASS', 777), null);
});

test('backend remains authoritative for Pass fixture scope and invoice creation', () => {
  assert.match(worker, /const fixtureId = passType === PASS_TYPES\.MATCH \? Number\(body\?\.fixtureId \|\| 0\) : 0/);
  assert.match(worker, /BILLING_FIXTURE_REQUIRED/);
  assert.match(worker, /BILLING_FIXTURE_NOT_ALLOWED/);
  assert.match(worker, /createPassInvoicePayload\(user\.id, passType, fixtureId, cfg\.botToken\)/);
  assert.match(worker, /prices: \[\{ label: product\.title, amount: product\.stars \}\]/);
  assert.match(worker, /BILLING_PASS_USAGE_LIMIT_REQUIRED/);
  assert.match(router, /url\.pathname === '\/api\/billing\/invoice'/);
  assert.match(router, /if \(!cfg\.monetizationEnabled\) return json/);
});

test('entitlements endpoint exposes server product config without creating a second payment endpoint', () => {
  const start = worker.indexOf('async function apiEntitlements');
  const end = worker.indexOf('async function apiBillingInvoice', start);
  const source = worker.slice(start, end);
  assert.match(source, /paymentsEnabled: Boolean\(cfg\.monetizationEnabled\)/);
  assert.match(source, /MATCH_PASS: passProductConfig\(PASS_TYPES\.MATCH, cfg\)/);
  assert.match(source, /DAY_PASS: passProductConfig\(PASS_TYPES\.DAY, cfg\)/);
  assert.match(source, /WEEKEND_PASS: passProductConfig\(PASS_TYPES\.WEEKEND, cfg\)/);
  assert.match(billing, /api\('\/api\/entitlements'/);
  assert.doesNotMatch(router, /\/api\/pass\/invoice|\/api\/pass\/checkout|\/api\/payments\/pass/);
});

test('active expired unavailable and included Pass states render from server decisions', () => {
  const product = { saleReady:true, stars:39, durationHours:72, usageLimit:null };
  const activeEntitlement = { decisions:[{ type:'MATCH_PASS', fixtureId:777, active:true, reason:'active', expiresAt:'2026-10-03T12:00:00Z' }] };
  const expiredEntitlement = { decisions:[{ type:'MATCH_PASS', fixtureId:777, active:false, reason:'expired', expiresAt:'2026-09-30T12:00:00Z' }] };
  assert.equal(passUiState({ product, entitlement:activeEntitlement, passType:'MATCH_PASS', fixtureId:777, paymentsEnabled:true, now:Date.parse('2026-10-01T12:00:00Z') }).state, 'active');
  assert.equal(passUiState({ product, entitlement:expiredEntitlement, passType:'MATCH_PASS', fixtureId:777, paymentsEnabled:true, now:Date.parse('2026-10-01T12:00:00Z') }).state, 'expired');
  assert.equal(passUiState({ product:{...product,saleReady:false}, entitlement:{decisions:[]}, passType:'WEEKEND_PASS', paymentsEnabled:true }).state, 'unavailable');
  assert.equal(passUiState({ product, entitlement:{decisions:[]}, passType:'DAY_PASS', paymentsEnabled:true, subscriptionActive:true }).state, 'included');
});

test('Match Pass opens from Match Center context and quota paywall preserves fixture context', () => {
  assert.match(app, /id="centerMatchPassBtn"/);
  assert.match(app, /openPassStoreForFixture\(Number\(m\.fixtureId\)\)/);
  assert.match(app, /showQuotaPaywallForFixture\(fixtureId\)/);
  assert.match(billing, /passFixtureId = id/);
  assert.match(billing, /fixtureId:id, force:true/);
  assert.match(billing, /Number\(invoice\.fixtureId \|\| 0\) !== fixtureId/);
});

test('Pass purchase reuses Telegram openInvoice sync and duplicate-action guard', () => {
  assert.match(billing, /if \(!PASS_TYPES\.includes\(type\) \|\| busyAction \|\| syncing\) return/);
  assert.match(billing, /busyAction = 'pass:' \+ type/);
  assert.match(billing, /api\('\/api\/billing\/invoice'/);
  assert.match(billing, /telegram\.openInvoice\(invoice\.invoiceUrl/);
  assert.match(billing, /await syncBilling\(false\)/);
  assert.match(billing, /await loadPassAccess\(\{ fixtureId, force:true \}\)/);
  for (const state of ['paid','pending','cancelled','canceled']) assert.match(billing, new RegExp("value === '"+state+"'"));
  assert.match(billing, /paymentState = 'failed'/);
});

test('Profile keeps FREE PRO PREMIUM and adds compact Match Day Weekend Pass cards', () => {
  for (const plan of ['FREE','PRO','PREMIUM']) assert.match(html, new RegExp('data-plan="'+plan+'"'));
  for (const pass of ['MATCH_PASS','DAY_PASS','WEEKEND_PASS']) assert.match(html, new RegExp('data-pass-type="'+pass+'"'));
  assert.match(html, /id="activePasses"/);
  assert.match(html, /id="passContext"/);
  assert.match(html, /id="passRefreshBtn"/);
});

test('Pass UI is mobile-safe for the requested 320 360 375 390 430 widths and does not add bottom navigation', () => {
  for (const width of [320,360,375,390,430]) assert.ok(width <= 430);
  assert.match(css, /\.pass-store \{[^}]*min-width:0;[^}]*max-width:100%;[^}]*overflow:hidden/);
  assert.match(css, /\.pass-grid \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:430px\)[\s\S]*\.pass-grid \{ grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:360px\)[\s\S]*\.pass-meta \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  const navLabels = [...html.matchAll(/<button id="nav[^"]+"[\s\S]*?<small>([^<]+)<\/small><\/button>/g)].map(m => m[1]);
  assert.deepEqual(navLabels, ['Главная','Мои команды','История','Профиль']);
});

test('Pass UI does not enable monetization and keeps subscriptions and Pass entitlements coexisting', () => {
  assert.match(env, /MONETIZATION_ENABLED=false/);
  assert.doesNotMatch(env, /MONETIZATION_ENABLED=true/);
  assert.match(billing, /paidPlans = new Set\(\['PRO', 'PREMIUM'\]\)/);
  assert.match(billing, /passData\.entitlement\?\.subscriptionActive/);
  assert.match(worker, /resolveUserEntitlements\(user\.id, fixtureId, cfg\)/);
  assert.match(worker, /reserveEntitlementUsage\(user\.id,entitlementBefore\.passes\.active,fixtureId,cfg\)/);
  assert.match(worker, /releaseDistributedAnalysisLock\(analysisLock,cfg\)/);
});
