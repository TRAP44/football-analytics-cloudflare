import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseCallBatcher } from '../src/supabase-call-batcher.js';
import { createGrowthReferralRuntime } from '../src/growth-referral.js';

// Issue #923: фоновые события роста пакетами — чтение атрибуции и вставка.

const cfgA = { supabaseUrl: 'https://a.supabase.test', supabaseKey: 'key-a' };
const cfgB = { supabaseUrl: 'https://b.supabase.test', supabaseKey: 'key-b' };

test('batcher: 250 callers in one window → 3 calls of ≤100, each caller gets its own result', async () => {
  const calls = [];
  const batch = createSupabaseCallBatcher(async (_cfg, items) => { calls.push(items.length); return items.map(item => item * 2); });
  const results = await Promise.all(Array.from({ length: 250 }, (_, i) => batch(cfgA, i)));
  assert.deepEqual(calls, [100, 100, 50]);
  assert.deepEqual(results.slice(0, 3), [0, 2, 4]);
  assert.equal(results[249], 498);
});

test('batcher: different projects/keys never share a batch; unknown identity is individual', async () => {
  const calls = [];
  const batch = createSupabaseCallBatcher(async (cfg, items) => { calls.push([cfg.supabaseUrl || 'none', items.length]); return items; });
  await Promise.all([batch(cfgA, 1), batch(cfgB, 2), batch(cfgA, 3), batch({}, 4), batch({ supabaseUrl: 'x' }, 5)]);
  assert.deepEqual(calls.sort(), [['https://a.supabase.test', 2], ['https://b.supabase.test', 1], ['none', 1], ['x', 1]].sort());
});

test('batcher: a failed batch rejects every caller; the next batch works; wrong result count is a failure', async () => {
  let fail = true;
  const batch = createSupabaseCallBatcher(async (_cfg, items) => { if (fail) throw new Error('db down'); return items; });
  const settled = await Promise.allSettled([batch(cfgA, 1), batch(cfgA, 2)]);
  assert.deepEqual(settled.map(s => s.status), ['rejected', 'rejected']);
  fail = false;
  assert.equal(await batch(cfgA, 3), 3);
  const short = createSupabaseCallBatcher(async () => [1]);
  await assert.rejects(Promise.all([short(cfgA, 1), short(cfgA, 2)]), /result count/);
});

function runtime({ selectMany, upsert, getUserRecord } = {}) {
  const calls = { selectMany: [], upsert: [], getUserRecord: 0 };
  const growth = createGrowthReferralRuntime({
    memory: { users: new Map() },
    hasSupabase: () => true,
    getUserRecord: async id => { calls.getUserRecord += 1; return getUserRecord ? getUserRecord(id) : { telegram_id: id, acquisition_source: 'single' }; },
    supaSelectMany: async (cfg, table, params, options) => { calls.selectMany.push({ table, params, options }); return selectMany(params); },
    supaUpsert: async (cfg, table, rows) => { calls.upsert.push({ table, rows }); if (upsert) return upsert(rows); return null; },
    supaPatch: async () => null,
    supaSelectOne: async () => null,
    supaDelete: async () => null,
    safeOpsMetadata: value => value,
    redactOpsString: value => value,
    normalizeReferralCode: value => value,
    opaqueReferralCode: async () => 'code',
    referralAttributionDecision: () => ({}),
    splitLaunchReferralParts: () => ({}),
  });
  return { growth, calls };
}

test('100 full_ai events → one attribution read and one insert, attribution kept per user', async () => {
  const { growth, calls } = runtime({
    selectMany: params => params.telegram_id.replace(/^in\.\(|\)$/g, '').split(',').map(id => ({
      telegram_id: Number(id), acquisition_source: Number(id) % 2 ? 'channel' : 'ads', acquisition_campaign: `c${id}`,
    })),
  });
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => growth.recordGrowthEvent(cfgA, { userId: 700000 + i, eventName: 'full_ai', channel: 'miniapp', fixtureId: 771 })));
  assert.ok(results.every(Boolean), 'every caller is confirmed');
  assert.equal(calls.selectMany.length, 1);
  assert.equal(calls.selectMany[0].table, 'users');
  assert.equal(calls.selectMany[0].options.select, 'telegram_id,acquisition_source,acquisition_campaign,acquisition_content');
  assert.equal(calls.getUserRecord, 0);
  assert.equal(calls.upsert.length, 1);
  const rows = calls.upsert[0].rows;
  assert.equal(rows.length, 100);
  assert.deepEqual(rows.map(r => r.telegram_id), [...rows.map(r => r.telegram_id)].sort((a, b) => a - b), 'stable order');
  const row = rows.find(r => r.telegram_id === 700001);
  assert.equal(row.source, 'channel');
  assert.equal(row.campaign, 'c700001');
  assert.equal(rows.find(r => r.telegram_id === 700002).source, 'ads');
});

test('a batch the database definitely rejected (HTTP 4xx) falls back to individual read and insert', async () => {
  let insertBatchFailed = false;
  const { growth, calls } = runtime({
    selectMany: () => { throw new Error('read batch down'); },
    upsert: rows => { if (Array.isArray(rows)) { insertBatchFailed = true; throw new Error('Supabase growth_events: HTTP 400 — invalid row'); } return null; },
  });
  const results = await Promise.all([1, 2, 3].map(i => growth.recordGrowthEvent(cfgA, { userId: 700000 + i, eventName: 'full_ai', channel: 'miniapp' })));
  assert.deepEqual(results, [true, true, true]);
  assert.equal(calls.getUserRecord, 3, 'individual attribution reads');
  assert.ok(insertBatchFailed);
  const singles = calls.upsert.filter(c => !Array.isArray(c.rows));
  assert.equal(singles.length, 3, 'individual inserts after the failed batch');
  assert.equal(singles[0].rows.source, 'single');
});

test('events with a dedupe key or explicit attribution keep their own path', async () => {
  const { growth, calls } = runtime({ selectMany: () => [] });
  assert.equal(await growth.recordGrowthEvent(cfgA, { userId: 7, eventName: 'referral_open', eventKey: 'referral_open:7' }), true);
  assert.equal(calls.selectMany.length, 1);
  assert.ok(!Array.isArray(calls.upsert[0].rows), 'dedupe-key event is written individually');
  calls.selectMany.length = 0;
  await growth.recordGrowthEvent(cfgA, { userId: 8, eventName: 'match_open', attribution: { source: 'ads', campaign: 'x' } });
  assert.equal(calls.selectMany.length, 0, 'no attribution read when it is explicit');
});

// Ревью Codex #928: неизвестный исход пакета не повторяется — без дублей событий.
test('COMMIT succeeded but the response was lost: no retry, no duplicate events', async () => {
  for (const lost of ['Response lost after COMMIT', 'Supabase growth_events timeout', 'Supabase growth_events: HTTP 503 — upstream', 'Supabase growth_events: HTTP 408 — timeout']) {
    const stored = [];
    const { growth, calls } = runtime({
      selectMany: () => [],
      upsert: rows => { stored.push(...(Array.isArray(rows) ? rows : [rows])); throw new Error(lost); },
    });
    const results = await Promise.all([1, 2].map(i => growth.recordGrowthEvent(cfgA, { userId: i, eventName: 'full_ai', channel: 'miniapp' })));
    assert.deepEqual(results, [false, false], `${lost}: the outcome is unknown, so it is not confirmed`);
    assert.equal(calls.upsert.length, 1, `${lost}: exactly one write attempt`);
    assert.deepEqual(stored.map(row => row.telegram_id), [1, 2], `${lost}: one row per caller, no duplicates`);
    assert.ok(stored.every(row => row.event_key === null));
  }
});

test('referral/dedupe-key events keep their own conflict handling', async () => {
  const { growth, calls } = runtime({
    selectMany: () => [],
    upsert: () => { throw new Error('Supabase growth_events: HTTP 409 — duplicate key'); },
  });
  // supaSelectOne → null: конфликт не подтверждён, событие не засчитывается, как раньше.
  assert.equal(await growth.recordGrowthEvent(cfgA, { userId: 9, eventName: 'referral_open', eventKey: 'referral_open:9' }), false);
  assert.equal(calls.upsert.length, 1);
  assert.ok(!Array.isArray(calls.upsert[0].rows));
});
