import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderSloRuntime } from '../src/provider-slo-runtime.js';

const worker = fs.readFileSync('src/worker.js','utf8');
const providerSlo = fs.readFileSync('src/provider-slo-runtime.js','utf8');
const providerWiring = fs.readFileSync('src/provider-readiness-wiring-runtime.js','utf8');
const productionMonitor = fs.readFileSync('src/production-monitor-runtime.js','utf8');
const router = fs.readFileSync('src/router.js','utf8');
const gateway = fs.readFileSync('src/api-football-gateway.js','utf8');
const secondary = fs.readFileSync('src/providers/provider-request.js','utf8');
const admin = fs.readFileSync('public/modules/admin-provider.js','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const html = fs.readFileSync('public/admin.html','utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js','utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_26_2.sql','utf8');
const stableReadHotfix = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_3.sql','utf8');
const stableReadiness = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_10.sql','utf8');

test('provider observability is wired to both primary and secondary football transports', () => {
  assert.match(worker, /createProviderObservabilityRuntime/);
  assert.match(providerWiring, /createApiFootballGateway\(\{[\s\S]*?observeProviderRequest/);
  assert.match(worker, /createProviderRequestBoundary\(\{[\s\S]*?observeProviderRequest/);
  assert.match(gateway, /await observe\(cfg,\{/);
  assert.match(secondary, /await observe\(cfg,\{/);
  assert.match(providerSlo, /record_provider_slo_observation/);
  assert.match(providerSlo, /read_provider_slo_buckets/);
});

test('provider SLO persists distributed 15-minute aggregate windows through production monitoring', () => {
  assert.match(providerSlo, /async function flushProviderSloWindow/);
  assert.match(migration, /create table if not exists public\.provider_slo_buckets/);
  assert.match(migration, /on conflict \(bucket_started_at,provider,operation\) do update/);
  assert.match(migration, /attempts=public\.provider_slo_buckets\.attempts\+excluded\.attempts/);
  assert.match(migration, /floor\(extract\(minute from v_now\) \/ 15\)/);
  assert.match(providerSlo, /providerSloWindowsFromBuckets/);
  assert.match(productionMonitor, /includeCurrent:!providerSloSource\.distributed/);
  assert.match(providerSlo, /includeCurrent:!source\.distributed/);
  assert.match(providerSlo, /code: 'PROVIDER_SLO_WINDOW'/);
  assert.match(providerSlo, /event_type: 'slo_window'/);
  assert.match(productionMonitor, /const providerSloFlush = options\.record !== false/);
  assert.match(providerSlo, /restoreProviderObservabilityWindow\(localSnapshot\)/);
  assert.match(providerSlo, /providerSloPersistenceErrors/);
});

test('admin provider endpoint and diagnostics expose 24 hour provider SLO', () => {
  assert.match(router, /providerObservability: await providerSloReport\(cfg, 24\)/);
  assert.match(providerSlo, /async function providerSloReport\(cfg, hours = 24\)/);
  assert.match(providerSlo, /incident:buildProviderSloIncidentTimeline\(incidentSource\.items\)/);
  assert.match(app, /providerObservability: null/);
  assert.match(admin, /state\.providerObservability/);
});

test('admin UI renders SLO state, success, retry and latency without changing public match UI', () => {
  for (const id of ['providerSloState','providerSloSuccess','providerSloRetry','providerSloLatency','providerSloNote']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(admin, /SLO · 24 часа|sloLabels/);
  assert.match(admin, /successRatePct/);
  assert.match(admin, /retryRatePct/);
  assert.match(admin, /avgAttemptLatencyMs/);
});

test('provider SLO remains wired into the current release runtime', () => {
  assert.match(worker,/createProviderSloRuntime\(\{/);
  assert.match(worker,/const providerSloReport = \(\.\.\.args\) => getProviderSloRuntime\(\)\.providerSloReport\(\.\.\.args\)/);
  assert.match(providerSlo,/function providerSloSelfTest\(\)/);
  assert.match(productionMonitor,/providerSloState: providerSloIncident\.state/);
});

test('provider SLO remains observational and does not add automatic rollback controls', () => {
  const start = providerSlo.indexOf('async function flushProviderSloWindow');
  const end = providerSlo.indexOf('async function readProviderSloWindows', start);
  assert.ok(start >= 0 && end > start);
  const block = providerSlo.slice(start, end);
  assert.doesNotMatch(block, /rollback|runtimeControls|apiFootball\(/i);
});


test('v6.26.2 provider SLO aggregation is backend-only and service-role scoped', () => {
  assert.match(migration,/alter table public\.provider_slo_buckets enable row level security/);
  assert.match(migration,/revoke all privileges on table public\.provider_slo_buckets[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration,/grant select, insert, update, delete on table public\.provider_slo_buckets[\s\S]*to service_role/);
  assert.match(migration,/revoke execute on function public\.record_provider_slo_observation[\s\S]*from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.record_provider_slo_observation[\s\S]*to service_role/);
  assert.match(migration,/security invoker/g);
});

test('provider SLO reader keeps a statement-stable implicit upper bound and readiness detects body drift', () => {
  assert.match(stableReadHotfix,/language sql\s+stable\s+security invoker/i);
  assert.match(stableReadHotfix,/coalesce\(p_until,statement_timestamp\(\)\)/i);
  assert.doesNotMatch(stableReadHotfix,/coalesce\(p_until,clock_timestamp\(\)\)/i);
  assert.match(stableReadiness,/provider_slo_read_boundary_drift/);
  assert.match(stableReadiness,/statement_timestamp\(\)/);
  assert.match(stableReadiness,/clock_timestamp\(\)/);
  assert.match(stableReadiness,/pg_get_functiondef/);
});



function providerSloReadHarness({rpcValue,restValue,restOk=true,memoryEvents=[]}={}){
  const calls={rpc:0,rest:0};
  const runtime=createProviderSloRuntime({
    memory:{opsEvents:memoryEvents},
    hasSupabase:()=>true,
    supaRpc:async()=>{calls.rpc++;return rpcValue;},
    fetchWithTimeout:async()=>{calls.rest++;return {
      ok:restOk,
      json:async()=>restValue,
    };},
    supaHeaders:()=>({}),
    providerSloWindowsFromBuckets:rows=>rows.map(row=>({
      metadata:{windowId:'provider-slo:verified',row},
    })),
  });
  return {runtime,calls};
}

test('malformed distributed bucket RPC never masquerades as confirmed empty provider traffic',async()=>{
  for(const raw of [null,{bad:true},true,'[]',42]){
    const h=providerSloReadHarness({rpcValue:raw,restValue:[],restOk:false});
    const result=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},24,{
      nowMs:Date.parse('2026-10-08T12:00:00Z'),includeOpen:false,
    });
    assert.equal(result.persistent,false);
    assert.equal(result.migrationReady,false);
    assert.equal(result.distributed,false);
    assert.equal(h.calls.rpc,1);
    assert.equal(h.calls.rest,1);
  }
});

test('valid distributed bucket arrays preserve confirmed SLO and do not trigger REST fallback',async()=>{
  const h=providerSloReadHarness({
    rpcValue:[{bucket_started_at:'2026-10-08T11:45:00Z',requests:12}],
    restValue:[],
  });
  const result=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},24,{
    nowMs:Date.parse('2026-10-08T12:00:00Z'),
  });
  assert.equal(result.persistent,true);
  assert.equal(result.migrationReady,true);
  assert.equal(result.distributed,true);
  assert.equal(result.bucketRows,1);
  assert.equal(result.items.length,1);
  assert.equal(h.calls.rest,0);
});

test('malformed REST fallback JSON cannot be reported as persisted SLO or alert events',async()=>{
  const h=providerSloReadHarness({rpcValue:null,restValue:{message:'error'}});
  const slo=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},24);
  assert.equal(slo.persistent,false);
  assert.equal(slo.distributed,false);
  const alerts=await h.runtime.readProviderIncidentAlertEvents({supabaseUrl:'https://db.test'},24);
  assert.equal(alerts.persistent,false);
  assert.equal(alerts.migrationReady,false);
  assert.deepEqual(alerts.items,[]);
});

test('provider SLO reads keep a bounded finite lookback when callers supply malformed options',async()=>{
  const h=providerSloReadHarness({rpcValue:[],restValue:[]});
  for(const hours of [true,'24',{},NaN,Infinity,0,-1]){
    const result=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},hours,{
      nowMs:Date.parse('2026-10-08T12:00:00Z'),
    });
    assert.equal(result.hours,24);
    assert.equal(result.distributed,true);
  }
  const bounded=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},999,{
    nowMs:Date.parse('2026-10-08T12:00:00Z'),
  });
  assert.equal(bounded.hours,168);
  const invalidClock=await h.runtime.readProviderSloWindows({supabaseUrl:'https://db.test'},5,{
    nowMs:8.64e15,
  });
  assert.equal(invalidClock.persistent,true);
});
