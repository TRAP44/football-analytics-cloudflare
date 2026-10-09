import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseReadinessRuntime } from '../src/supabase-readiness-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const readinessSource=fs.readFileSync('src/supabase-readiness-runtime.js','utf8');
const monitor=fs.readFileSync('src/production-monitor-runtime.js','utf8');
const release=fs.readFileSync('src/release-readiness-runtime.js','utf8');
const admin=fs.readFileSync('src/admin-operational-api.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

function runtime(outcomes=[],{configured=true}={}){
  const observed={fetch:0,sleep:[],telemetry:[]};
  const api=createSupabaseReadinessRuntime({
    hasSupabase:()=>configured,
    fetchWithTimeout:async()=>{
      const value=outcomes[observed.fetch++];
      if(value instanceof Error)throw value;
      return value||{ok:true,status:200,headers:{get:()=>''},json:async()=>[]};
    },
    sleepMs:async ms=>observed.sleep.push(ms),
    bumpTelemetry:key=>observed.telemetry.push(key),
    supaHeaders:()=>({apikey:'opaque'}),
    redactOpsString:()=> '[redacted]',
  });
  return {api,observed,cfg:{supabaseUrl:'https://example.supabase.co'}};
}
function failed(status=503){
  return {ok:false,status,text:async()=> 'secret endpoint details'};
}
function success(){
  return {ok:true,status:200,headers:{get:()=> '0-0/0'},json:async()=>[]};
}
test('RC109 confirmed Supabase probe is owned by extracted readiness runtime',()=>{
  assert.match(fs.readFileSync('src/provider-readiness-wiring-runtime.js','utf8'),/createSupabaseReadinessRuntime/);
  assert.match(readinessSource,/function combineSupabaseProbeAttempts/);
  assert.match(readinessSource,/async function probeSupabaseConfirmed/);
  assert.match(monitor,/probeSupabaseConfirmed\(cfg\)/);
});
test('RC109 a healthy probe completes without a redundant retry',async()=>{
  const {api,observed,cfg}=runtime([success()]);
  const result=await api.probeSupabaseConfirmed(cfg);
  assert.equal(result.ok,true);
  assert.equal(result.attempts,1);
  assert.equal(result.recovered,false);
  assert.equal(observed.fetch,1);
  assert.deepEqual(observed.sleep,[]);
});
test('RC109 intermittent network failure recovers on exactly one confirmation attempt',async()=>{
  const {api,observed,cfg}=runtime([failed(),success()]);
  const result=await api.probeSupabaseConfirmed(cfg,{retryDelayMs:0});
  assert.equal(result.ok,true);
  assert.equal(result.attempts,2);
  assert.equal(result.recovered,true);
  assert.equal(result.confirmedFailure,false);
  assert.equal(observed.fetch,2);
  assert.ok(observed.telemetry.includes('supabaseProbeRecoveries'));
});
test('RC109 repeated failures are confirmed and never reported as recovery',async()=>{
  const {api,observed,cfg}=runtime([failed(),failed(502)]);
  const result=await api.probeSupabaseConfirmed(cfg,{retryDelayMs:0});
  assert.equal(result.ok,false);
  assert.equal(result.attempts,2);
  assert.equal(result.confirmedFailure,true);
  assert.equal(result.recovered,false);
  assert.ok(observed.telemetry.includes('supabaseProbeConfirmedFailures'));
});
test('RC109 unconfigured Supabase performs no network I/O',async()=>{
  const {api,observed,cfg}=runtime([],{configured:false});
  const result=await api.probeSupabaseConfirmed(cfg);
  assert.equal(result.configured,false);
  assert.equal(observed.fetch,0);
  assert.deepEqual(observed.sleep,[]);
});
test('RC109 readiness, release and admin contracts retain the confirmation self-test',()=>{
  const {api}=runtime();
  assert.equal(api.supabaseProbeConfirmationSelfTest().pass,true);
  assert.match(admin,/releaseCheck\('supabase_probe_confirmation'/);
  assert.match(release,/productionCheck\('supabase_probe_confirmation'/);
  assert.match(smoke,/'supabaseProbeConfirmation'/);
  assert.match(smoke,/'providerDataReliability'/);
});
