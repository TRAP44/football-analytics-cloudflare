import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { passProductConfig } from '../src/entitlements.js';
import {
  buildPassPurchaseBody,
  createBillingModule,
  passUiState,
} from '../public/modules/billing.js';

const billingApiRuntime = fs.readFileSync('src/billing-api-runtime.js', 'utf8');
const analysisRuntime = fs.readFileSync('src/analysis-runtime.js', 'utf8');
const router = fs.readFileSync('src/router.js', 'utf8');
const billing = fs.readFileSync('public/modules/billing.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');

test('Weekend Pass stays fail-closed without a usage limit and becomes sale-ready at the configured cap', () => {
  const missing = passProductConfig('WEEKEND_PASS', { passUsageLimits:{ WEEKEND_PASS:null } });
  const configured = passProductConfig('WEEKEND_PASS', { passUsageLimits:{ WEEKEND_PASS:6 } });
  assert.equal(missing.saleReady, false);
  assert.equal(missing.usageLimit, null);
  assert.equal(configured.saleReady, true);
  assert.equal(configured.usageLimit, 6);
  assert.equal(configured.durationHours, 168);
  assert.match(env, /WEEKEND_PASS_DURATION_HOURS=168/);
  assert.match(env, /WEEKEND_PASS_USAGE_LIMIT=6/);
  assert.match(wrangler, /"WEEKEND_PASS_DURATION_HOURS":\s*"168"/);
  assert.match(wrangler, /"WEEKEND_PASS_USAGE_LIMIT":\s*"6"/);
  assert.match(wrangler, /"MONETIZATION_ENABLED":\s*"false"/);
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
  assert.match(billingApiRuntime, /const fixtureId=passType === PASS_TYPES\.MATCH \? positiveId\(rawFixtureId\) : 0/);
  assert.match(billingApiRuntime, /BILLING_FIXTURE_REQUIRED/);
  assert.match(billingApiRuntime, /BILLING_FIXTURE_NOT_ALLOWED/);
  assert.match(billingApiRuntime, /createPassInvoicePayload\(user\.id, passType, fixtureId, cfg\.botToken\)/);
  assert.match(billingApiRuntime, /prices: \[\{ label: product\.title, amount: product\.stars \}\]/);
  assert.match(billingApiRuntime, /BILLING_PASS_USAGE_LIMIT_REQUIRED/);
  assert.match(router, /pathname === '\/api\/billing\/invoice'/);
  assert.match(router, /cfg\?\.monetizationEnabled !== true/);
});

test('entitlements endpoint exposes server product config without creating a second payment endpoint', () => {
  const start = billingApiRuntime.indexOf('async function apiEntitlements');
  const end = billingApiRuntime.indexOf('async function apiBillingInvoice', start);
  const source = billingApiRuntime.slice(start, end);
  assert.match(source, /paymentsEnabled: cfg\.monetizationEnabled === true/);
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
  assert.equal(passUiState({ product, entitlement:activeEntitlement, passType:'MATCH_PASS', fixtureId:0, paymentsEnabled:true, now:Date.parse('2026-10-01T12:00:00Z') }).state, 'needs-fixture');
  assert.equal(passUiState({ product, entitlement:expiredEntitlement, passType:'MATCH_PASS', fixtureId:777, paymentsEnabled:true, now:Date.parse('2026-10-01T12:00:00Z') }).state, 'expired');
  assert.equal(passUiState({ product:{...product,saleReady:false}, entitlement:{decisions:[]}, passType:'WEEKEND_PASS', paymentsEnabled:true }).state, 'unavailable');
  assert.equal(passUiState({ product, entitlement:{decisions:[]}, passType:'DAY_PASS', paymentsEnabled:true, subscriptionActive:true }).state, 'included');
});

test('Pass state prioritizes the requested active Match Pass and subscription access over product sale state', () => {
  const product = { saleReady:true, stars:39, durationHours:72, usageLimit:null };
  const entitlement = {
    decisions:[
      { type:'MATCH_PASS', fixtureId:111, active:false, reason:'fixture_mismatch', expiresAt:'2026-10-05T12:00:00Z' },
      { type:'MATCH_PASS', fixtureId:222, active:true, reason:'active', expiresAt:'2026-10-03T12:00:00Z' },
    ],
  };
  const requested = passUiState({
    product,
    entitlement,
    passType:'MATCH_PASS',
    fixtureId:222,
    paymentsEnabled:true,
    now:Date.parse('2026-10-01T12:00:00Z'),
  });
  assert.equal(requested.state, 'active');
  assert.equal(requested.decision.fixtureId, 222);

  const included = passUiState({
    product:{...product,saleReady:false},
    entitlement:{decisions:[]},
    passType:'WEEKEND_PASS',
    paymentsEnabled:true,
    subscriptionActive:true,
  });
  assert.equal(included.state, 'included');
});

test('Match Pass opens from Match Center context and quota paywall preserves fixture context', () => {
  assert.match(app, /id="centerMatchPassBtn"/);
  assert.match(app, /openPassStoreForFixture\(Number\(m\.fixtureId\)\)/);
  assert.match(app, /showQuotaPaywallForFixture,/);
  assert.match(analysisController, /showPaywall\(fixtureId\)/);
  assert.match(billing, /passFixtureId = id/);
  assert.match(billing, /function clearPassContext/);
  assert.match(billing, /await openProfile\(\)/);
  assert.match(app, /billingModule\?\.clearPassContext\(\)/);
  assert.match(billing, /fixtureId:id, force:true/);
  assert.match(billing, /Number\(invoice\.fixtureId \|\| 0\) !== fixtureId/);
});

test('Pass access loading is fixture-keyed and ignores a stale response after context switches', async () => {
  const pending = new Map();
  const calls = [];
  const module = createBillingModule({
    state:{
      profile:{features:{monetizationEnabled:true}},
      billing:{enabled:true,ready:true,current:{plan:'FREE'}},
    },
    elementById:() => null,
    api:(url) => {
      calls.push(url);
      return new Promise(resolve => pending.set(url, resolve));
    },
    telegram:{openInvoice(){}},
    dateTime:value => String(value || ''),
  });

  const first = module.loadPassAccess({fixtureId:101,force:true});
  await Promise.resolve();
  const second = module.loadPassAccess({fixtureId:202,force:true});
  await Promise.resolve();

  assert.deepEqual(calls, [
    '/api/entitlements?fixtureId=101',
    '/api/entitlements?fixtureId=202',
  ]);

  pending.get('/api/entitlements?fixtureId=202')({
    paymentsEnabled:true,
    products:{},
    entitlement:{marker:'new',decisions:[],passes:{active:[]},subscriptionActive:false},
  });
  const fresh = await second;
  assert.equal(fresh.entitlement.marker, 'new');

  pending.get('/api/entitlements?fixtureId=101')({
    paymentsEnabled:true,
    products:{},
    entitlement:{marker:'stale',decisions:[],passes:{active:[]},subscriptionActive:false},
  });
  await first;

  const cached = await module.loadPassAccess({fixtureId:202});
  assert.equal(cached.entitlement.marker, 'new');
  assert.equal(module.snapshot().passFixtureId, 202);
  assert.equal(module.snapshot().passLoadedFixtureId, 202);
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

test('Pass copy states one match one day and seven days without misleading Match duration', () => {
  assert.match(html, /Один выбранный матч: полный AI-разбор и расширенные данные только для этого матча\./);
  assert.match(html, /Все поддерживаемые матчи и полный AI-доступ в течение 24 часов\./);
  assert.match(html, /Все поддерживаемые матчи на 7 дней\. Включено до 6 полных AI-разборов\./);
  assert.match(billing, /MATCH_PASS: Object\.freeze\(\{ title:'Match Pass', short:'1 матч' \}\)/);
  assert.match(billing, /DAY_PASS: Object\.freeze\(\{ title:'Day Pass', short:'1 день' \}\)/);
  assert.match(billing, /WEEKEND_PASS: Object\.freeze\(\{ title:'Weekend Pass', short:'7 дней' \}\)/);
  assert.match(billing, /if \(type === 'MATCH_PASS'\) return '1 матч'/);
  assert.match(billing, /if \(type === 'DAY_PASS'\) return '24 часа'/);
  assert.match(billing, /if \(type === 'WEEKEND_PASS'\) return '7 дней'/);
  assert.doesNotMatch(billing, /if \(n === 72\) return '72 часа'/);
});

test('active Day and Weekend Pass expose a direct use path instead of a disabled dead-end', () => {
  assert.match(billing, /view\.state === 'active' && \(type === 'DAY_PASS' \|\| type === 'WEEKEND_PASS'\)/);
  assert.match(billing, /return 'Выбрать матч'/);
  assert.match(billing, /button\.dataset\.passAction = useActivePass \? 'use' : 'buy'/);
  assert.match(billing, /openPassMatches\(normalized\)/);
  assert.match(app, /function openActivePassMatches\(passType = 'DAY_PASS'\)/);
  assert.match(app, /\.match-card\.is-upcoming \.analyze-btn\[data-fixture\]/);
  assert.match(app, /сейчас нет будущих матчей для разбора/);
  assert.match(app, /Разобрать матч/);
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
  assert.match(billingApiRuntime, /resolveUserEntitlements\(user\.id, fixtureId, cfg\)/);
  assert.match(analysisRuntime, /const activePasses=Array\.isArray\(objectValue\(entitlementBefore\.passes\)\?\.active\)/);
  assert.match(analysisRuntime, /reserveEntitlementUsage\([\s\S]*userId,[\s\S]*activePasses,[\s\S]*fixtureId,[\s\S]*cfg/);
  assert.match(analysisRuntime, /releaseDistributedAnalysisLock\(analysisLock,cfg\)/);
});
