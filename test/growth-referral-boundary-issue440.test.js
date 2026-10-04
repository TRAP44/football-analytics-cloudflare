import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGrowthReferralRuntime } from '../src/growth-referral.js';
import {
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
} from '../src/referral-attribution.js';

function runtime(overrides = {}) {
  const memory = {
    users: new Map(),
    growthEventKeys: new Set(),
    referralCodeOwners: new Map(),
    referralAttributions: new Map(),
  };
  let nowMs = 1_700_000_000_000;
  const deleted = [];
  const api = createGrowthReferralRuntime({
    memory,
    getUserRecord: overrides.getUserRecord || (async id => memory.users.get(Number(id)) || null),
    hasSupabase: overrides.hasSupabase || (() => false),
    supaPatch: overrides.supaPatch || (async () => null),
    supaUpsert: overrides.supaUpsert || (async () => null),
    supaSelectOne: overrides.supaSelectOne || (async () => null),
    supaDelete: overrides.supaDelete || (async (_cfg, table, filters) => { deleted.push({ table, filters }); }),
    safeOpsMetadata: value => value && typeof value === 'object' ? value : {},
    redactOpsString: value => String(value || '').slice(0, 180),
    normalizeReferralCode,
    opaqueReferralCode,
    referralAttributionDecision,
    splitLaunchReferralParts,
    clock: () => nowMs,
  });
  return {
    api,
    memory,
    deleted,
    setNow(value) { nowMs = value; },
  };
}

test('growth/referral domain parses fixture attribution and referral payloads unchanged', () => {
  const { api } = runtime();
  const code = 'a1b2c3d4e5f60708';
  const parsed = api.parseLaunchStartParam(`fx123__social__match_share__miniapp__r${code}`);

  assert.equal(parsed.fixtureId, 123);
  assert.equal(parsed.action, 'fixture');
  assert.equal(parsed.source, 'social');
  assert.equal(parsed.campaign, 'match_share');
  assert.equal(parsed.content, 'miniapp');
  assert.equal(parsed.referralCode, code);
});

test('growth/referral domain preserves first-touch acquisition in memory', async () => {
  const { api, memory, setNow } = runtime();
  setNow(Date.parse('2026-10-04T12:00:00.000Z'));

  const first = await api.ensureLaunchAttribution(42, 'media_social_launch_card', {});
  assert.equal(first.source, 'social');
  assert.equal(first.campaign, 'launch');
  assert.equal(first.content, 'card');
  assert.equal(first.firstTouchAt, '2026-10-04T12:00:00.000Z');

  setNow(Date.parse('2026-10-05T12:00:00.000Z'));
  const second = await api.ensureLaunchAttribution(42, 'partner_partner_later_other', {});
  assert.equal(second.source, first.source);
  assert.equal(second.campaign, first.campaign);
  assert.equal(second.content, first.content);
  assert.equal(second.firstTouchAt, first.firstTouchAt);
  assert.equal(memory.users.get(42).acquisition_first_touch_at, first.firstTouchAt);
});

test('growth events keep idempotent in-memory keys and sanitized metadata boundary', async () => {
  const { api, memory } = runtime();
  memory.users.set(7, {
    telegram_id: 7,
    acquisition_source: 'telegram',
    acquisition_campaign: 'direct',
  });

  assert.equal(await api.recordGrowthEvent({}, {
    userId: 7,
    eventName: 'share_created',
    eventKey: 'share_created:7:123',
    metadata: { fixtureId:123 },
  }), true);
  assert.equal(await api.recordGrowthEvent({}, {
    userId: 7,
    eventName: 'share_created',
    eventKey: 'share_created:7:123',
    metadata: { fixtureId:123 },
  }), true);
  assert.equal(memory.growthEventKeys.size, 1);
});

test('referral lifecycle stays bounded, blocks duplicates and records referred payment idempotency', async () => {
  const { api, memory } = runtime();
  const cfg = { botToken:'test-bot-secret' };

  const code = await api.ensureReferralCode(100, cfg);
  assert.match(code, /^[a-f0-9]{16}$/);
  assert.equal(await api.lookupReferralCodeOwner(code, cfg), 100);

  const accepted = await api.applyReferralAttribution(200, {
    referralCode: code,
    source: 'social',
    campaign: 'match_share',
    content: 'share',
    fixtureId: 55,
  }, cfg);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.referralCode, code);
  assert.equal((await api.referralAttributionForUser(200, cfg)).referralCode, code);

  const duplicate = await api.applyReferralAttribution(200, { referralCode: code }, cfg);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.status, 'duplicate_attribution');

  const payment = {
    telegram_payment_charge_id:'charge-1',
    total_amount:199,
    is_recurring:false,
  };
  assert.equal(await api.recordReferredPayment(200, payment, 'PRO', cfg), true);
  assert.equal(memory.growthEventKeys.has('referred_payment:charge-1'), true);
});

test('growth retention cleanup uses injected clock and preserves table/query contract', async () => {
  const { api, deleted, setNow } = runtime({ hasSupabase: () => true });
  setNow(Date.parse('2026-10-04T12:00:00.000Z'));

  const result = await api.cleanupGrowthEvents({ growthRetentionDays: 90 });
  assert.equal(result.ok, true);
  assert.equal(result.retentionDays, 90);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].table, 'growth_events');
  assert.match(deleted[0].filters.created_at, /^lt\./);
});

test('worker composition root wires growth/referral domain instead of owning its implementation', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const growth = fs.readFileSync('src/growth-referral.js', 'utf8');
  const lines = worker.split('\n').length;

  assert.match(worker, /import \{ createGrowthReferralRuntime \} from '\.\/growth-referral\.js';/);
  assert.match(worker, /= createGrowthReferralRuntime\(\{/);
  assert.doesNotMatch(worker, /^function cleanLaunchPart\(/m);
  assert.doesNotMatch(worker, /^function parseLaunchStartParam\(/m);
  assert.doesNotMatch(worker, /^async function recordGrowthEvent\(/m);
  assert.doesNotMatch(worker, /^async function applyReferralAttribution\(/m);
  assert.match(growth, /async function recordGrowthEventTask/);
  assert.match(growth, /async function applyReferralAttribution/);
  assert.ok(lines < 25150, `expected worker.js below 25,150 lines after second extraction, got ${lines}`);
});
