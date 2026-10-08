import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const schemaRuntime = fs.readFileSync('src/supabase-schema-runtime.js', 'utf8');
const monitorRuntime = fs.readFileSync('src/production-monitor-runtime.js', 'utf8');
const scheduled = fs.readFileSync('src/scheduled-jobs.js', 'utf8');

test('production monitor distinguishes confirmed drift from transient schema probe outages', () => {
  assert.match(schemaRuntime, /function schemaProbeStatusKind\(/);
  assert.match(schemaRuntime, /function classifySupabaseSchemaProbeFailures\(/);
  assert.match(monitorRuntime, /schemaStatus === 'unavailable'/);
  assert.match(monitorRuntime, /schemaFailureMode:/);
  assert.match(monitorRuntime, /schemaUnavailable:/);
  assert.match(monitorRuntime, /Production работает, но нужен контроль/);
});

test('production monitor waits for reminder reads before deep Supabase schema probes', () => {
  assert.match(scheduled, /const remindersTask = run\('reminders', \(\) => processDueReminders\(cfg\)\);/);
  assert.match(scheduled, /const monitorAfterReminders = remindersTask[\s\S]*?\.then\(\(\) => run\('production_monitor', \(\) => runProductionMonitor\(cfg, scheduledAt\)\)\);/);
  assert.match(scheduled, /tasks\.push\(\['production_monitor', monitorAfterReminders\]\);/);
});



import { createSupabaseSchemaRuntime } from '../src/supabase-schema-runtime.js';

function schemaProbeHarness(overrides={}) {
  return createSupabaseSchemaRuntime({
    EXPECTED_SCHEMA_FINGERPRINT:'expected-fingerprint',
    hasSupabase:()=>true,
    supaRpc:async()=>({ok:true,fingerprint:'expected-fingerprint'}),
    ...overrides,
  });
}

test('failed probe responses use strict booleans rather than truthy strings',()=>{
  const rt=schemaProbeHarness();
  const result=rt.summarizeSupabaseSchemaChecks([
    {id:'team',ok:'true',status:'ok'},
    {id:'players',ok:true,status:'ok'},
  ]);
  assert.equal(result.ok,false);
  assert.deepEqual(result.missing,['team']);
  const classified=rt.classifySupabaseSchemaProbeFailures(
    [{id:'team',ok:'false',status:'network_error'}],
    {ok:'true',status:'fingerprint_unconfirmed'},
    {ok:'true',status:'error'},
  );
  assert.equal(classified.failureMode,'unavailable');
  assert.deepEqual(classified.unavailable,['team','schema_fingerprint','personal_write_guards']);
});

test('confirmed schema drift and unavailable probes have separate classifications',()=>{
  const rt=schemaProbeHarness();
  const cases=[
    ['http_404','drift'],
    ['fingerprint_mismatch','drift'],
    ['42703','drift'],
    ['http_503','unavailable'],
    ['http_429','unavailable'],
    ['timeout','unavailable'],
    ['unknown_provider_error','unavailable'],
  ];
  for(const [status,kind] of cases){
    assert.equal(rt.schemaProbeStatusKind(status),kind,status);
  }
  const mixed=rt.classifySupabaseSchemaProbeFailures(
    [{id:'users',ok:false,status:'http_404'},{id:'billing',ok:false,status:'http_503'}],
    {ok:true,status:'ok'}, {ok:true,status:'ok'},
  );
  assert.equal(mixed.failureMode,'mixed');
  assert.deepEqual(mixed.drift,['users']);
  assert.deepEqual(mixed.unavailable,['billing']);
});

test('confirmation logic does not mistake ok string for a successful retry',()=>{
  const rt=schemaProbeHarness();
  const failed={ok:false,status:'unavailable',failureMode:'unavailable',missing:[],unavailable:['users']};
  const malformed={ok:'true',status:'ok',missing:[]};
  const result=rt.combineSupabaseSchemaProbeAttempts(failed,malformed);
  assert.equal(result.recovered,false);
  assert.equal(result.confirmedFailure,true);
  assert.equal(result.attempts,2);
  const first=rt.combineSupabaseSchemaProbeAttempts(malformed);
  assert.equal(first.confirmedFailure,true);
  assert.equal(first.recovered,false);
  const real=rt.combineSupabaseSchemaProbeAttempts(failed,{ok:true,status:'ok',missing:[]});
  assert.equal(real.recovered,true);
  assert.equal(real.confirmedFailure,false);
});

test('fingerprint RPC must confirm strict ok even when expected fingerprint matches',async()=>{
  const rt=schemaProbeHarness({
    supaRpc:async()=>({ok:'true',fingerprint:'expected-fingerprint'}),
  });
  const result=await rt.readSupabaseSchemaFingerprint({});
  assert.equal(result.ok,false);
  assert.equal(result.status,'fingerprint_unconfirmed');
  const healthy=await schemaProbeHarness().readSupabaseSchemaFingerprint({});
  assert.equal(healthy.ok,true);
  assert.equal(healthy.status,'ok');
});
