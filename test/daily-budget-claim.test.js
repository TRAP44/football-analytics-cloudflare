import test from 'node:test';
import assert from 'node:assert/strict';
import { claimDailyBudget, dailyBudgetKey, dailyBudgetUsed } from '../src/daily-budget-claim.js';

// claim_provider_request ограничивает окно часом — суточный потолок собирается из 24 корзин.
const NOW = Date.parse('2026-10-11T12:34:00.000Z');

test('daily usage sums only today\'s hourly buckets of the prefix', () => {
  assert.equal(dailyBudgetKey('jobs', NOW), 'jobs:h12');
  const rows = [
    { bucket_key: 'jobs:h00', window_started_at: '2026-10-11T00:00:00Z', request_count: 3 },
    { bucket_key: 'jobs:h12', window_started_at: '2026-10-11T12:00:00Z', request_count: 2 },
    { bucket_key: 'jobs:h13', window_started_at: '2026-10-10T13:00:00Z', request_count: 9 },
    { bucket_key: 'other:h12', window_started_at: '2026-10-11T12:00:00Z', request_count: 50 },
    { bucket_key: 'jobs:h01', window_started_at: 'bad', request_count: 7 },
    { bucket_key: 'jobs:h02', window_started_at: '2026-10-11T02:00:00Z', request_count: -4 },
  ];
  assert.equal(dailyBudgetUsed(rows, 'jobs', NOW), 5);
});

test('claim reads today\'s usage, stops at the cap and claims the current hour bucket', async () => {
  const calls = [];
  const deps = rows => ({
    cfg: {},
    prefix: 'jobs',
    limit: 6,
    now: NOW,
    supaSelectMany: async (_cfg, table, filters, options) => { calls.push({ table, filters, options }); return rows; },
    supaRpc: async (_cfg, name, params) => { calls.push({ name, params }); return { allowed: true }; },
  });
  const ok = await claimDailyBudget(deps([{ bucket_key: 'jobs:h00', window_started_at: '2026-10-11T00:00:00Z', request_count: 5 }]));
  assert.deepEqual(ok, { allowed: true, used: 6, reason: '' });
  assert.equal(calls[0].table, 'provider_rate_windows');
  assert.equal(calls[0].filters.bucket_key, 'like.jobs:h*');
  // Лимит текущей корзины = суточный лимит − закрытые часы (5) → 1.
  assert.deepEqual(calls[1].params, { p_bucket_key: 'jobs:h12', p_limit: 1, p_window_seconds: 3600 });

  calls.length = 0;
  const full = await claimDailyBudget(deps([{ bucket_key: 'jobs:h00', window_started_at: '2026-10-11T00:00:00Z', request_count: 6 }]));
  assert.deepEqual(full, { allowed: false, used: 6, reason: 'daily_limit' });
  assert.equal(calls.filter(call => call.name).length, 0, 'no claim once the daily cap is reached');
});

test('claim fails closed on storage errors, invalid input or a denied RPC', async () => {
  const base = { cfg: {}, prefix: 'jobs', limit: 5, now: NOW, supaSelectMany: async () => [], supaRpc: async () => ({ allowed: true }) };
  assert.equal((await claimDailyBudget({ ...base, supaSelectMany: async () => { throw new Error('down'); } })).reason, 'budget_unavailable');
  assert.equal((await claimDailyBudget({ ...base, supaSelectMany: async () => ({}) })).reason, 'budget_unavailable');
  assert.equal((await claimDailyBudget({ ...base, supaRpc: async () => { throw new Error('rpc'); } })).reason, 'budget_unavailable');
  assert.equal((await claimDailyBudget({ ...base, supaRpc: async () => ({ allowed: false }) })).reason, 'daily_limit');
  assert.equal((await claimDailyBudget({ ...base, limit: 0 })).reason, 'disabled');
  assert.equal((await claimDailyBudget({ ...base, prefix: 'bad prefix*' })).reason, 'budget_unavailable');
});

test('concurrent claims that read the same state never exceed the daily cap', async () => {
  // Имитация RPC: инкремент текущей корзины сериализован, пока count < p_limit.
  const bucket = { count: 2 };
  const rows = [
    { bucket_key: 'jobs:h03', window_started_at: '2026-10-11T03:00:00Z', request_count: 5 },
    { bucket_key: 'jobs:h12', window_started_at: '2026-10-11T12:00:00Z', request_count: 2 },
  ];
  const deps = {
    cfg: {},
    prefix: 'jobs',
    limit: 10,
    now: NOW,
    supaSelectMany: async () => rows.map(row => ({ ...row })), // все читают одно и то же
    supaRpc: async (_cfg, _name, params) => {
      if (bucket.count < params.p_limit) {
        bucket.count += 1;
        return { allowed: true };
      }
      return { allowed: false };
    },
  };
  const results = await Promise.all(Array.from({ length: 12 }, () => claimDailyBudget(deps)));
  const admitted = results.filter(result => result.allowed).length;
  assert.equal(admitted, 3, '10 − 5 (closed hours) − 2 (already in this hour) = 3');
  assert.equal(5 + bucket.count, 10);
});

test('no claim in the last seconds of an hour (the database window could already have moved)', async () => {
  let rpc = 0;
  const result = await claimDailyBudget({
    cfg: {}, prefix: 'jobs', limit: 5, now: Date.parse('2026-10-11T12:59:57.000Z'),
    supaSelectMany: async () => [], supaRpc: async () => { rpc += 1; return { allowed: true }; },
  });
  assert.equal(result.reason, 'hour_boundary');
  assert.equal(rpc, 0);
});

test('the hour is rechecked right before the claim (a slow read can cross the hour)', async () => {
  const times = [Date.parse('2026-10-11T12:59:50.000Z'), Date.parse('2026-10-11T13:00:01.000Z')];
  let rpc = 0;
  const result = await claimDailyBudget({
    cfg: {}, prefix: 'jobs', limit: 5, now: () => times.shift() ?? Date.parse('2026-10-11T13:00:02.000Z'),
    supaSelectMany: async () => [], supaRpc: async () => { rpc += 1; return { allowed: true }; },
  });
  assert.equal(result.reason, 'hour_boundary');
  assert.equal(rpc, 0);
});
