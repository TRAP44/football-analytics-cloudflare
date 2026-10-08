import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseSchemaRuntime } from '../src/supabase-schema-runtime.js';

const schema=fs.readFileSync('src/supabase-schema-runtime.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const monitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
const release=fs.readFileSync('src/release-readiness-runtime.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

function runtime(){
  return createSupabaseSchemaRuntime({
    EXPECTED_SCHEMA_FINGERPRINT:'a'.repeat(32),
    PERSONAL_WRITE_LIMITS:{},
    bumpTelemetry:()=>{},
    fetchWithTimeout:async()=>({ok:true}),
    hasSupabase:()=>true,
    readProviderIncidentAlertDeliveryContract:async()=>({ok:true}),
    redactOpsString:value=>String(value),
    sleepMs:async()=>{},
    supaHeaders:()=>({}),
    supaRpc:async()=>({ok:true}),
  });
}

test('RC126 schema confirmation remains wired after runtime extraction',()=>{
  assert.match(schema,/function combineSupabaseSchemaProbeAttempts/);
  assert.match(schema,/async function probeSupabaseSchemaDriftConfirmed/);
  assert.match(worker,/getSupabaseSchemaRuntime\(\)\.probeSupabaseSchemaDriftConfirmed/);
  assert.match(worker,/getSupabaseSchemaRuntime\(\)\.supabaseSchemaProbeConfirmationSelfTest/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmation'/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmationSelfTest'/);
});

test('RC126 transient schema probe recovery requires exactly two attempts',()=>{
  const api=runtime();
  const result=api.combineSupabaseSchemaProbeAttempts(
    {ok:false,status:'drift',missing:['growth_events'],unavailable:[]},
    {ok:true,status:'ok',missing:[],unavailable:[]},
  );
  assert.equal(result.ok,true);
  assert.equal(result.attempts,2);
  assert.equal(result.recovered,true);
  assert.equal(result.confirmedFailure,false);
  assert.deepEqual(result.initialMissing,['growth_events']);
});

test('RC126 repeated drift remains confirmed and fail closed',()=>{
  const api=runtime();
  const first={ok:false,status:'drift',failureMode:'drift',missing:['growth_events'],unavailable:[]};
  const result=api.combineSupabaseSchemaProbeAttempts(first,first);
  assert.equal(result.ok,false);
  assert.equal(result.attempts,2);
  assert.equal(result.recovered,false);
  assert.equal(result.confirmedFailure,true);
  assert.equal(result.failureMode,'drift');
});

test('RC126 healthy first attempt avoids a redundant second probe',()=>{
  const api=runtime();
  const result=api.combineSupabaseSchemaProbeAttempts({
    ok:true,status:'ok',checked:7,missing:[],
  });
  assert.equal(result.ok,true);
  assert.equal(result.attempts,1);
  assert.equal(result.recovered,false);
  assert.equal(result.confirmedFailure,false);
  assert.equal(api.supabaseSchemaProbeConfirmationSelfTest().pass,true);
});

test('RC126 production monitoring distinguishes recovered probes and confirmed failures',()=>{
  assert.match(monitor,/code:'SCHEMA_PROBE_RECOVERED'/);
  assert.match(monitor,/schemaProbeAttempts:/);
  assert.match(monitor,/schemaProbeRecovered:/);
  assert.match(monitor,/schemaProbeConfirmedFailure:/);
  assert.match(monitor,/probeSupabaseSchemaDriftConfirmed\(cfg\)/);
  assert.match(schema,/bumpTelemetry\('supabaseSchemaProbeRecoveries'\)/);
  assert.match(schema,/bumpTelemetry\('supabaseSchemaProbeConfirmedFailures'\)/);
});

test('RC126 release readiness continues to block confirmed schema drift',()=>{
  assert.match(release,/productionCheck\('supabase_schema_probe_confirmation'/);
  assert.match(release,/supabaseSchemaProbeConfirmationSelfTest\(\)\.pass \? 'pass' : 'fail'/);
  assert.match(schema,/combined\.confirmedFailure/);
  assert.match(schema,/const second = await probeSupabaseSchemaDrift\(cfg\)/);
});

test('RC126 schema confirmation survives later migrations and smoke contracts',()=>{
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_18.sql'),true);
  assert.equal(fs.existsSync('supabase/baseline/supabase_baseline_v6_19.sql'),true);
  assert.match(smoke,/'supabaseSchemaProbeConfirmation'/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmationSelfTest'/);
});
