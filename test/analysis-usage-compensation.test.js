import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAnalysisUsageCompensationRuntime,
  durableAnalysisUsageHeaders,
} from '../src/analysis-usage-compensation.js';
import { POST_BASELINE_MIGRATIONS } from '../scripts/prepare-supabase-ci-migrations.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

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

test('analysis usage compensation runtime exposes a frozen finalization surface', () => {
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>false,
    supaRpc:async()=>({}),
  });

  assert.equal(Object.isFrozen(runtime),true);
  assert.deepEqual(
    Object.keys(runtime).sort(),
    ['finalizeAnalysisUsageReservation','reconcileAnalysisUsageReservations'],
  );
});

test('durable usage identifiers reject coercive booleans and symbols safely', () => {
  assert.throws(() => durableAnalysisUsageHeaders(true), /requires a UUID/);
  assert.throws(() => durableAnalysisUsageHeaders(Symbol('operation')), /requires a UUID/);

  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>{ throw new Error('must not call'); },
  });
  return runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:true,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
  }).then(result=>{
    assert.deepEqual(result,{ok:false,pending:false,reason:'invalid_reservation'});
  });
});

test('explicit finalization user must match the durable reservation owner', async () => {
  let calls=0;
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>{ calls+=1; return {}; },
  });
  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
    userId:43,
  });
  assert.deepEqual(result,{ok:false,pending:false,reason:'invalid_reservation'});
  assert.equal(calls,0);
});

test('invalid durable disposition fails before Supabase', async () => {
  let calls=0;
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>{ calls+=1; return {}; },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'cancel',
    cfg:CFG,
  });

  assert.deepEqual(result,{ok:false,pending:false,reason:'invalid_reservation'});
  assert.equal(calls,0);
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

test('confirmed quota commit uses the durable finalizer without refund telemetry', async () => {
  const calls=[];
  const telemetry={};
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async(...args)=>{
      calls.push(args);
      return {ok:true,status:'committed',operationId:QUOTA_OPERATION};
    },
    bumpTelemetry:(key,amount=1)=>{
      telemetry[key]=Number(telemetry[key] || 0)+amount;
    },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'commit',
    cfg:CFG,
  });

  assert.equal(result.ok,true);
  assert.equal(result.pending,false);
  assert.equal(result.status,'committed');
  assert.equal(telemetry.analysisUsageCommits,1);
  assert.equal(telemetry.analysisUsageRefunds,undefined);
  assert.equal(telemetry.quotaRefunds,undefined);
  assert.equal(calls[0][1],'refund_analysis_quota');
  assert.deepEqual(calls[0][2],{p_telegram_id:42,p_usage_date:'2026-10-05'});
  assert.equal(calls[0][4]['x-analysis-usage-action'],'commit');
  assert.equal(calls[0][4]['x-analysis-operation-id'],QUOTA_OPERATION);
});

test('invalid durable reservation fields fail before Supabase and never become pending', async () => {
  let calls = 0;
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => { calls += 1; return {}; },
  });

  for (const reservation of [
    {
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:0,
      date:'2026-10-05',
    },
    {
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-02-31',
    },
    {
      reserved:true,
      durable:true,
      operationId:PASS_OPERATION,
      kind:'pass',
      userId:42,
      entitlementId:0,
    },
  ]) {
    const result=await runtime.finalizeAnalysisUsageReservation({
      reservation,
      disposition:'refund',
      cfg:CFG,
    });
    assert.deepEqual(result,{ok:false,pending:false,reason:'invalid_reservation'});
  }
  assert.equal(calls,0);
});

test('durable finalization requires the RPC response to confirm the same operation id', async () => {
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => ({
      ok:true,
      status:'refunded',
      operationId:'33333333-3333-4333-8333-333333333333',
    }),
    recordOpsEvent: async () => {},
    redactOpsString: value => String(value),
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
  });
  assert.equal(result.ok,false);
  assert.equal(result.pending,true);
  assert.equal(result.operationId,QUOTA_OPERATION);
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

test('observability failures cannot turn a confirmed durable refund into pending', async () => {
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({
      ok:true,
      status:'refunded',
      operationId:QUOTA_OPERATION,
    }),
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
    recordOpsEvent:()=>{ throw new Error('ops down'); },
    redactOpsString:()=>{ throw new Error('redactor down'); },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
    userId:42,
  });

  assert.equal(result.ok,true);
  assert.equal(result.pending,false);
  assert.equal(result.status,'refunded');
});

test('finalization failure remains structured even when observability helpers throw', async () => {
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>{ throw new Error('database unavailable'); },
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
    recordOpsEvent:()=>{ throw new Error('ops down'); },
    redactOpsString:()=>{ throw new Error('redactor down'); },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
  });

  assert.equal(result.ok,false);
  assert.equal(result.pending,true);
  assert.match(result.reason,/database unavailable/);
});

test('duplicate durable confirmation does not inflate successful refund telemetry', async () => {
  const telemetry={};
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({
      ok:true,
      duplicate:true,
      status:'refunded',
      operationId:QUOTA_OPERATION,
    }),
    bumpTelemetry:(key,amount=1)=>{
      telemetry[key]=Number(telemetry[key] || 0)+amount;
    },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
  });

  assert.equal(result.ok,true);
  assert.equal(result.duplicate,true);
  assert.equal(telemetry.analysisUsageFinalizationDuplicates,1);
  assert.equal(telemetry.analysisUsageRefunds,undefined);
  assert.equal(telemetry.quotaRefunds,undefined);
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

test('failed limited Pass analysis refunds only after durable persistence confirmation', async () => {
  const calls=[];
  const telemetry={};
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async(...args)=>{
      calls.push(args);
      return {ok:true,status:'refunded',operationId:PASS_OPERATION};
    },
    bumpTelemetry:(key,amount=1)=>{
      telemetry[key]=Number(telemetry[key] || 0)+amount;
    },
  });

  const result=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:PASS_OPERATION,
      kind:'pass',
      userId:42,
      entitlementId:77,
    },
    disposition:'refund',
    cfg:CFG,
  });

  assert.equal(result.ok,true);
  assert.equal(result.status,'refunded');
  assert.equal(telemetry.analysisUsageRefunds,1);
  assert.equal(telemetry.passUsageRefunds,1);
  assert.equal(telemetry.passUsageRefundFailures,undefined);
  assert.equal(calls[0][1],'refund_pass_entitlement_usage');
  assert.deepEqual(calls[0][2],{p_telegram_id:42,p_entitlement_id:77});
  assert.equal(calls[0][4]['x-analysis-usage-action'],'refund');
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

test('reconciliation fails closed on malformed or impossible counters', async () => {
  const telemetry = {};
  const events = [];
  const runtime = createAnalysisUsageCompensationRuntime({
    hasSupabase: () => true,
    supaRpc: async () => ({
      ok:true,
      reconciliation:true,
      reconciled:'NaN',
      failed:-3,
      pending:1.5,
      cleaned:'2',
    }),
    recordOpsEvent: async (_cfg,event) => events.push(event),
    bumpTelemetry: (key, amount = 1) => { telemetry[key] = Number(telemetry[key] || 0) + amount; },
  });
  const result=await runtime.reconcileAnalysisUsageReservations(CFG);
  assert.equal(result.ok,false);
  assert.equal(result.degraded,true);
  assert.equal(result.reconciled,0);
  assert.equal(result.failed,1);
  assert.match(result.reason,/reconciliation_contract_invalid/);
  assert.equal(telemetry.analysisUsageReconciled,undefined);
  assert.equal(telemetry.analysisUsageReconciliationFailures,1);
  assert.equal(events[0].code,'ANALYSIS_USAGE_RECONCILIATION_FAILED');
});

test('reconciliation rejects contradictory ok and failed counters', async () => {
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({
      ok:false,
      reconciliation:true,
      reconciled:2,
      failed:0,
      pending:0,
      cleaned:0,
    }),
    recordOpsEvent:async()=>{},
  });

  const result=await runtime.reconcileAnalysisUsageReservations(CFG);
  assert.equal(result.ok,false);
  assert.equal(result.degraded,true);
  assert.equal(result.failed,1);
  assert.match(result.reason,/reconciliation_contract_invalid/);
});

test('Supabase detection failures stay fail-soft', async () => {
  const runtime=createAnalysisUsageCompensationRuntime({
    hasSupabase:()=>{ throw new Error('config probe failed'); },
    supaRpc:async()=>{ throw new Error('must not call'); },
  });

  const reconciliation=await runtime.reconcileAnalysisUsageReservations(CFG);
  assert.equal(reconciliation.ok,true);
  assert.equal(reconciliation.skipped,true);

  const finalization=await runtime.finalizeAnalysisUsageReservation({
    reservation:{
      reserved:true,
      durable:true,
      operationId:QUOTA_OPERATION,
      kind:'quota',
      userId:42,
      date:'2026-10-05',
    },
    disposition:'refund',
    cfg:CFG,
  });
  assert.equal(finalization.ok,false);
  assert.equal(finalization.pending,true);
  assert.equal(finalization.persistent,true);
  assert.equal(finalization.reason,'supabase_not_configured');
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

test('analysis orchestration observes structured durable finalization rejection', () => {
  const source=readRepoFile('src/analysis-runtime.js');

  assert.match(
    source,
    /finalization\?\.ok !== true && finalization\?\.pending !== true[\s\S]*?ANALYSIS_QUOTA_FINALIZATION_REJECTED/,
  );
  assert.match(
    source,
    /finalization\?\.ok !== true && finalization\?\.pending !== true[\s\S]*?ANALYSIS_PASS_FINALIZATION_REJECTED/,
  );
  assert.match(source,/ANALYSIS_QUOTA_FINALIZATION_FAILED/);
  assert.match(source,/ANALYSIS_PASS_FINALIZATION_FAILED/);
});

test('v6.28 migration keeps the public contract stable and durable state private', () => {
  const sql = readRepoFile('supabase/migrations/supabase_migration_v6_28.sql');
  const release = JSON.parse(readRepoFile('release-contract.json'));

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
  assert.equal(release.productionSchema, '6.29');
  assert.equal(
    release.latestMigration,
    POST_BASELINE_MIGRATIONS.at(-1),
    'durable usage test must follow the deterministic latest migration chain',
  );
  assert.equal(release.databaseContract.fingerprint, '6a7f0fe444f49a2a52c4603e952ee9ea');
  assert.deepEqual(release.databaseContract.privateContracts?.analysisUsage,{
    version:1,
    readinessField:'schema.privateAnalysisUsage',
    sourceMigration:'supabase/migrations/supabase_migration_v6_28.sql',
  });
});

test('v6.29.7 gates readiness on the private durable usage contract without changing the public fingerprint', () => {
  const sql=readRepoFile('supabase/migrations/supabase_migration_v6_29_7.sql');
  assert.match(sql,/create or replace function public\.backend_readiness_contract_v2/);
  assert.match(sql,/analysis_usage_private_contract/);
  assert.match(sql,/'privateAnalysisUsage'/);
  assert.match(sql,/analysis_usage_reservations/);
  assert.match(sql,/analysis_usage_request_headers/);
  assert.match(sql,/finalize_analysis_usage_reservation/);
  assert.match(sql,/reconcile_analysis_usage_reservations/);
  assert.doesNotMatch(sql,/create or replace function public\.backend_schema_contract_v2/);
});
