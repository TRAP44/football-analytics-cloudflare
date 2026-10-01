import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PASS_TYPES,
  createEntitlementService,
  createPassInvoicePayload,
  entitlementDecision,
  parsePassInvoicePayload,
  passProductConfig,
  resolveEntitlementAccess,
} from '../src/entitlements.js';

const BOT_TOKEN = 'unit-test-signing-key';
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

function row(overrides = {}) {
  return {
    id: 1,
    telegram_id: 42,
    entitlement_type: 'MATCH_PASS',
    fixture_id: 777,
    starts_at: '2026-10-01T10:00:00.000Z',
    expires_at: '2026-10-04T10:00:00.000Z',
    usage_limit: null,
    usage_count: 0,
    payment_charge_id: 'charge-1',
    status: 'active',
    ...overrides,
  };
}

function memoryRuntime(user = { telegram_id: 42, plan: 'FREE', subscription_until: null }) {
  const memory = { userEntitlements: new Map() };
  const mutations = [];
  const service = createEntitlementService({
    memory,
    hasSupabase: () => false,
    supaSelectMany: async () => { throw new Error('unexpected supabase select'); },
    supaRpc: async () => { throw new Error('unexpected supabase rpc'); },
    getUserRecord: async userId => Number(userId) === Number(user.telegram_id) ? user : { telegram_id: Number(userId), plan: 'FREE' },
    markWebhookMutation: (_cfg, kind) => mutations.push(kind),
  });
  return { memory, mutations, service };
}

test('Pass prices keep requested defaults and are server-configurable', () => {
  assert.equal(passProductConfig('MATCH_PASS', {}).stars, 39);
  assert.equal(passProductConfig('DAY_PASS', {}).stars, 89);
  assert.equal(passProductConfig('WEEKEND_PASS', {}).stars, 149);
  assert.equal(passProductConfig('DAY_PASS', { passPrices: { DAY_PASS: 99 } }).stars, 99);
  assert.equal(passProductConfig('DAY_PASS', { passDurations: { DAY_PASS: 12 } }).durationHours, 12);
});

test('fa2 Telegram Stars payload signs user, Pass type and fixture and rejects tampering', async () => {
  const payload = await createPassInvoicePayload(42, PASS_TYPES.MATCH, 777, BOT_TOKEN);
  assert.match(payload, /^fa2\|42\|MATCH_PASS\|777\|[0-9a-f]{12}\|[0-9a-f]{24}$/);
  assert.deepEqual(await parsePassInvoicePayload(payload, BOT_TOKEN), {
    userId: 42,
    passType: 'MATCH_PASS',
    fixtureId: 777,
    nonce: payload.split('|')[4],
  });

  const wrongFixture = payload.replace('|777|', '|778|');
  const wrongUser = payload.replace('fa2|42|', 'fa2|43|');
  const wrongType = payload.replace('|MATCH_PASS|', '|DAY_PASS|');
  assert.equal(await parsePassInvoicePayload(wrongFixture, BOT_TOKEN), null);
  assert.equal(await parsePassInvoicePayload(wrongUser, BOT_TOKEN), null);
  assert.equal(await parsePassInvoicePayload(wrongType, BOT_TOKEN), null);
  assert.equal(await parsePassInvoicePayload('fa2|broken', BOT_TOKEN), null);
  assert.equal(await parsePassInvoicePayload(payload, 'wrong-token'), null);

  await assert.rejects(() => createPassInvoicePayload(42, PASS_TYPES.MATCH, 0, BOT_TOKEN), /Некорректные параметры/);
  const day = await createPassInvoicePayload(42, PASS_TYPES.DAY, 0, BOT_TOKEN);
  assert.equal((await parsePassInvoicePayload(day, BOT_TOKEN)).fixtureId, 0);
});

test('active Match Pass grants only its server-bound fixture', () => {
  assert.deepEqual(entitlementDecision(row(), { fixtureId: 777, now: NOW }).active, true);
  assert.deepEqual(entitlementDecision(row(), { fixtureId: 778, now: NOW }), {
    active: false,
    reason: 'fixture_mismatch',
    item: assertEntitlementShape(row()),
  });
});

function assertEntitlementShape(source) {
  return {
    id: source.id,
    telegramId: Number(source.telegram_id),
    type: source.entitlement_type,
    fixtureId: Number(source.fixture_id || 0),
    startsAt: source.starts_at,
    expiresAt: source.expires_at,
    usageLimit: source.usage_limit,
    usageCount: Number(source.usage_count || 0),
    paymentChargeId: source.payment_charge_id,
    status: source.status,
  };
}

test('expired Pass, Day Pass window and usage cap fail closed', () => {
  assert.equal(entitlementDecision(row({ expires_at: '2026-10-01T11:59:59.000Z' }), { fixtureId: 777, now: NOW }).reason, 'expired');

  const day = row({
    entitlement_type: 'DAY_PASS',
    fixture_id: null,
    starts_at: '2026-10-01T11:00:00.000Z',
    expires_at: '2026-10-02T11:00:00.000Z',
  });
  assert.equal(entitlementDecision(day, { fixtureId: 123, now: NOW }).active, true);
  assert.equal(entitlementDecision(day, { fixtureId: 123, now: Date.parse('2026-10-02T11:00:00.000Z') }).reason, 'expired');

  const limited = { ...day, usage_limit: 3, usage_count: 3 };
  assert.equal(entitlementDecision(limited, { fixtureId: 123, now: NOW }).reason, 'usage_exhausted');
});

test('FREE has no entitlement; Pass grants access; PRO/PREMIUM subscription takes precedence', () => {
  const free = resolveEntitlementAccess({ plan: 'FREE', entitlements: [], fixtureId: 777, now: NOW });
  assert.equal(free.source, 'free');
  assert.equal(free.access.expandedAi, false);

  const withPass = resolveEntitlementAccess({ plan: 'FREE', entitlements: [row()], fixtureId: 777, now: NOW });
  assert.equal(withPass.source, 'pass');
  assert.equal(withPass.effectiveTier, 'PASS');
  assert.equal(withPass.passes.match, true);
  assert.equal(withPass.access.postMatchReview, true);

  const pro = resolveEntitlementAccess({
    plan: 'PRO',
    subscriptionUntil: '2026-11-01T00:00:00.000Z',
    entitlements: [row()],
    fixtureId: 777,
    now: NOW,
  });
  assert.equal(pro.source, 'subscription');
  assert.equal(pro.effectiveTier, 'PRO');
  assert.equal(pro.passes.match, true);

  const premium = resolveEntitlementAccess({
    plan: 'PREMIUM',
    subscriptionUntil: '2026-11-01T00:00:00.000Z',
    entitlements: [row()],
    fixtureId: 777,
    now: NOW,
  });
  assert.equal(premium.source, 'subscription');
  assert.equal(premium.effectiveTier, 'PREMIUM');

  const expiredSub = resolveEntitlementAccess({
    plan: 'PRO',
    subscriptionUntil: '2026-09-01T00:00:00.000Z',
    entitlements: [row()],
    fixtureId: 777,
    now: NOW,
  });
  assert.equal(expiredSub.source, 'pass');
  assert.equal(expiredSub.plan, 'FREE');
});

test('duplicate and concurrent payment activation are idempotent and conflicting replay is rejected', async () => {
  const { service, memory } = memoryRuntime();
  const input = {
    telegramId: 42,
    passType: PASS_TYPES.MATCH,
    fixtureId: 777,
    starsAmount: 39,
    paymentChargeId: 'charge-concurrent',
    invoicePayload: 'signed-payload',
    paidAt: '2026-10-01T12:00:00.000Z',
  };

  const [a, b] = await Promise.all([
    service.activatePassPurchase(input, {}),
    service.activatePassPurchase(input, {}),
  ]);
  assert.equal([a, b].filter(result => result.activated).length, 1);
  assert.equal([a, b].filter(result => result.duplicate).length, 1);
  assert.equal(memory.userEntitlements.size, 1);

  const replay = await service.activatePassPurchase({ ...input, telegramId: 43 }, {});
  assert.equal(replay.activated, false);
  assert.equal(replay.duplicate, false);
  assert.equal(replay.reason, 'payment_charge_conflict');
  assert.equal(memory.userEntitlements.size, 1);
});

test('usage consumption is atomic in service semantics and refund revokes Pass access', async () => {
  const { service, memory, mutations } = memoryRuntime();
  const activation = await service.activatePassPurchase({
    telegramId: 42,
    passType: PASS_TYPES.DAY,
    fixtureId: 0,
    starsAmount: 89,
    paymentChargeId: 'charge-limited',
    invoicePayload: 'signed-day',
    paidAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  }, {});
  assert.equal(activation.activated, true);
  const stored = memory.userEntitlements.get('charge-limited');
  stored.usage_limit = 1;

  assert.equal((await service.consumeEntitlement(42, stored.id, 123, {})).allowed, true);
  assert.equal((await service.consumeEntitlement(42, stored.id, 123, {})).reason, 'usage_exhausted');

  assert.equal((await service.refundPassByCharge(42, 'charge-limited', {})).updated, true);
  const resolved = await service.resolveUserEntitlements(42, 123, {}, Date.parse('2026-10-01T13:00:00.000Z'));
  assert.equal(resolved.source, 'free');
  assert.equal(resolved.decisions[0].reason, 'refunded');
  assert.deepEqual(mutations, ['pass_entitlement', 'pass_refund']);
});

test('v6.25 migration is additive, service-role-only and protects duplicate/concurrent activation', () => {
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_25.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.user_entitlements/i);
  assert.match(sql, /payment_charge_id text not null unique/i);
  assert.match(sql, /create or replace function public\.activate_pass_entitlement/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /payment_charge_conflict/i);
  assert.match(sql, /create or replace function public\.consume_pass_entitlement/i);
  assert.match(sql, /usage_count = usage_count \+ 1/i);
  assert.match(sql, /create or replace function public\.refund_pass_entitlement/i);
  assert.match(sql, /alter table public\.user_entitlements enable row level security/i);
  assert.match(sql, /revoke all privileges on table public\.user_entitlements from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.user_entitlements to service_role/i);
  assert.doesNotMatch(sql, /create table if not exists public\.billing_/i);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|schema)\b/i);
});

test('full AI uses Pass entitlement server-side instead of the FREE quota gate for the entitled scope', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const start = worker.indexOf('async function apiAnalyze(');
  const end = worker.indexOf('async function apiHistoryAnalysis', start);
  const source = worker.slice(start, end > start ? end : start + 40000);

  assert.match(source, /resolveUserEntitlements\(user\.id, fixtureId, cfg\)/);
  assert.match(source, /const passAccess = entitlementBefore\.source === 'pass'/);
  assert.match(source, /if \(!freeRecheck && !passAccess && quotaBefore\.left <= 0\)/);
  assert.match(source, /if \(!freeRecheck && !passAccess\) \{\s*usageReservation=await reserveAnalysisQuota/);
  assert.doesNotMatch(source, /users\.plan\s*=\s*['"]PASS['"]/);
});

test('Worker reuses the established billing route/webhook and keeps monetization default-off', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const router = fs.readFileSync('src/router.js', 'utf8');
  const env = fs.readFileSync('.env.example', 'utf8');
  const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

  assert.match(worker, /parsePassInvoicePayload\(q\.invoice_payload, cfg\.botToken\)/);
  assert.match(worker, /activatePassPurchase\(\{/);
  assert.match(worker, /refundPassByCharge\(userId, chargeId, cfg\)/);
  assert.match(worker, /getStarTransactions/);
  assert.match(worker, /passVerified/);
  assert.match(worker, /createInvoiceLink/);
  assert.match(worker, /prices: \[\{ label: product\.title, amount: product\.stars \}\]/);
  assert.match(router, /url\.pathname === '\/api\/entitlements'/);
  assert.match(router, /url\.pathname === '\/api\/billing\/invoice'/);
  assert.match(router, /if \(!cfg\.monetizationEnabled\) return json/);
  assert.match(env, /MONETIZATION_ENABLED=false/);
  assert.doesNotMatch(env, /MONETIZATION_ENABLED=true/);
  assert.equal(release.productionSchema, '6.25');
  assert.equal(release.latestMigration, 'supabase/migrations/supabase_migration_v6_25.sql');
});
