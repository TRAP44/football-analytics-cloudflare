import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createAnalysisUsageCompensationRuntime,
  durableAnalysisUsageHeaders,
} from '../src/analysis-usage-compensation.js';

const CFG = { supabaseUrl: 'https://example.supabase.co', supabaseKey: 'secret' };
const QUOTA_OPERATION = '11111111-1111-4111-8111-111111111111';
const PASS_OPERATION = '22222222-2222-4222-8222-222222222222';

test('durable usage headers bind a valid operation id and reject malformed ids', () => {
  assert.deepEqual(durableAnalysisUsageHeaders(QUOTA_OPERATION), {
    'x-analysis-usage-lifecycle': 'durable-v1',
    'x-analysis-operation-id': QUOTA_OPERATION,
  });
  assert.throws(() => durableAnalysisUsageHeaders('not-a-uuid'), /requires a UUID/);
});

test('confirmed quota refund increments success telemetry only after persistence', async () => {
  const calls = [];
  const telemetry = {};
  const events = [];
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async (...args) => {
      calls.push(args);
      return { ok: true, status: 'refunded', operationId: QUOTA_OPERATION };
    },
    recordOpsEvent: async (_cfg, event) => events.push(event),
    bumpTelemetry: (key, amount = 1) => { telemetry[key] = Number(telemetry[key] || 0) + amount; },
  });

  const result = await runtime.finalizeAnalysisUsageReservation({
    reservation: {
      reserved: true,
      durable: true,
      operationId: QUOTA_OPERATION,
      kind: 'quota',
      userId: 42,
      date: '2026-10-05',
    },
    disposition: 'refund',
    cfg: CFG,
    userId: 42,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'refunded');
  assert.equal(telemetry.analysisUsageRefunds, 1);
  assert.equal(telemetry.quotaRefunds, 1);
  assert.equal(telemetry.quotaRefundFailures, undefined);
  assert.deepEqual(events, []);
  assert.equal(calls[0][1], 'refund_analysis_quota');
  assert.deepEqual(calls[0][2], { p_telegram_id: 42, p_usage_date: '2026-10-05' });
  assert.equal(calls[0][4]['x-analysis-usage-action'], 'refund');
  assert.equal(calls[0][4]['x-analysis-operation-id'], QUOTA_OPERATION);
});

test('failed durable quota refund remains pending, emits an ops event and never reports success telemetry', async () => {
  const telemetry = {};
  const events = [];
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => { throw new Error('database unavailable'); },
    recordOpsEvent: async (_cfg, event) => events.push(event),
    bumpTelemetry: (key, amount = 1) => { telemetry[key] = Number(telemetry[key] || 0) + amount; },
    redactOpsString: value => String(value),
  });

  const result = await runtime.finalizeAnalysisUsageReservation({
    reservation: {
      reserved: true,
      durable: true,
      operationId: QUOTA_OPERATION,
      kind: 'quota',
      userId: 42,
      date: '2026-10-05',
    },
    disposition: 'refund',
    cfg: CFG,
    userId: 42,
  });

  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(telemetry.quotaRefunds, undefined);
  assert.equal(telemetry.analysisUsageRefunds, undefined);
  assert.equal(telemetry.quotaRefundFailures, 1);
  assert.equal(telemetry.analysisUsageCompensationFailures, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].code, 'ANALYSIS_USAGE_REFUND_PENDING');
  assert.equal(events[0].meta.operationId, QUOTA_OPERATION);
});

test('successful limited Pass usage is explicitly committed through the existing refund RPC surface', async () => {
  const calls = [];
  const telemetry = {};
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async (...args) => {
      calls.push(args);
      return { ok: true, status: 'committed', operationId: PASS_OPERATION };
    },
    recordOpsEvent: async () => {},
    bumpTelemetry: key => { telemetry[key] = Number(telemetry[key] || 0) + 1; },
  });

  const result = await runtime.finalizeAnalysisUsageReservation({
    reservation: {
      reserved: true,
      durable: true,
      operationId: PASS_OPERATION,
      kind: 'pass',
      userId: 42,
      entitlementId: 77,
    },
    disposition: 'commit',
    cfg: CFG,
    userId: 42,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'committed');
  assert.equal(telemetry.analysisUsageCommits, 1);
  assert.equal(calls[0][1], 'refund_pass_entitlement_usage');
  assert.deepEqual(calls[0][2], { p_telegram_id: 42, p_entitlement_id: 77 });
  assert.equal(calls[0][4]['x-analysis-usage-action'], 'commit');
});

test('legacy or unlimited reservations bypass durable finalization', async () => {
  let calls = 0;
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => { calls += 1; return {}; },
  });

  const result = await runtime.finalizeAnalysisUsageReservation({
    reservation: { reserved: false, durable: false },
    disposition: 'refund',
    cfg: CFG,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(calls, 0);
});

test('reconciliation reuses the stable quota RPC and reports recovered reservations', async () => {
  const calls = [];
  const telemetry = {};
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async (...args) => {
      calls.push(args);
      return { ok: true, reconciliation: true, reconciled: 3, failed: 0, pending: 1, cleaned: 2 };
    },
    recordOpsEvent: async () => {},
    bumpTelemetry: (key, amount = 1) => { telemetry[key] = Number(telemetry[key] || 0) + amount; },
  });

  const result = await runtime.reconcileAnalysisUsageReservations(CFG);
  assert.deepEqual(result, {
    ok: true,
    degraded: false,
    reconciled: 3,
    failed: 0,
    pending: 1,
    cleaned: 2,
  });
  assert.equal(telemetry.analysisUsageReconciled, 3);
  assert.equal(calls[0][1], 'refund_analysis_quota');
  assert.equal(calls[0][2].p_telegram_id, 0);
  assert.equal(calls[0][4]['x-analysis-usage-action'], 'reconcile');
});

test('partial reconciliation remains observable while preserving successful recovery counts', async () => {
  const telemetry = {};
  const events = [];
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => ({
      ok: false,
      reconciliation: true,
      reconciled: 2,
      failed: 1,
      pending: 1,
      cleaned: 0,
    }),
    recordOpsEvent: async (_cfg, event) => events.push(event),
    bumpTelemetry: (key, amount = 1) => { telemetry[key] = Number(telemetry[key] || 0) + amount; },
  });

  const result = await runtime.reconcileAnalysisUsageReservations(CFG);
  assert.equal(result.ok, false);
  assert.equal(result.degraded, true);
  assert.equal(result.reconciled, 2);
  assert.equal(result.failed, 1);
  assert.equal(telemetry.analysisUsageReconciled, 2);
  assert.equal(telemetry.analysisUsageReconciliationFailures, 1);
  assert.equal(events[0].code, 'ANALYSIS_USAGE_RECONCILIATION_PARTIAL');
});

test('v6.28 migration keeps the public contract stable and durable state private', () => {
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_28.sql', 'utf8');
  const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

  assert.match(sql, /create schema if not exists private/i);
  assert.match(sql, /create table if not exists private\.analysis_usage_reservations/i);
  assert.match(sql, /alter table private\.analysis_usage_reservations enable row level security/i);
  assert.match(sql, /revoke all privileges on table private\.analysis_usage_reservations[\s\S]*?public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select, insert, update, delete on table private\.analysis_usage_reservations[\s\S]*?to service_role/i);
  assert.match(sql, /x-analysis-usage-lifecycle/i);
  assert.match(sql, /x-analysis-operation-id/i);
  assert.match(sql, /x-analysis-usage-action/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /create or replace function public\.consume_analysis_quota\(\s*p_telegram_id bigint,\s*p_usage_date date,\s*p_limit integer/i);
  assert.match(sql, /create or replace function public\.refund_analysis_quota\(\s*p_telegram_id bigint,\s*p_usage_date date/i);
  assert.match(sql, /create or replace function public\.consume_pass_entitlement\(\s*p_telegram_id bigint,\s*p_entitlement_id bigint,\s*p_fixture_id bigint default null/i);
  assert.match(sql, /create or replace function public\.refund_pass_entitlement_usage\(\s*p_telegram_id bigint,\s*p_entitlement_id bigint/i);
  assert.doesNotMatch(sql, /create or replace function public\.finalize_analysis_usage_reservation/i);
  assert.doesNotMatch(sql, /create or replace function public\.reconcile_analysis_usage_reservations/i);
  assert.doesNotMatch(sql, /create or replace function public\.backend_schema_contract_v2/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.equal(release.productionSchema, '6.29.1');
  assert.equal(release.latestMigration, 'supabase/migrations/supabase_migration_v6_29_1.sql');
  assert.equal(release.databaseContract.fingerprint, '6a7f0fe444f49a2a52c4603e952ee9ea');
});
