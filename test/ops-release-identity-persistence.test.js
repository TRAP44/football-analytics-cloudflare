import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createTelemetryOpsRuntime } from '../src/telemetry-ops-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const migration=fs.readFileSync(
  'supabase/migrations/supabase_migration_v6_29_13.sql',
  'utf8',
);

function buildRuntime({
  identity=()=>({
    appVersion:'6.120.0-rc144',
    releaseCandidate:'RC144',
    deploySha:'a'.repeat(40),
    cloudflareVersionId:'11111111-2222-3333-4444-555555555555',
    cloudflareVersionTag:'a'.repeat(40),
    cloudflareVersionTimestamp:'2026-10-07T12:00:00.000Z',
  }),
  hasSupabase=()=>false,
  supaRpc=async()=>({ok:false}),
  fetchWithTimeout=async()=>({ok:true,status:201}),
}={}) {
  const memory={telemetry:{},opsEvents:[]};
  const calls={rpc:[],fetch:[]};
  const api=createTelemetryOpsRuntime({
    MAX_MEMORY_OPS_EVENTS:20,
    currentReleaseIdentity:identity,
    fetchWithTimeout:async(...args)=>{
      calls.fetch.push(args);
      return await fetchWithTimeout(...args);
    },
    hasSupabase,
    memory,
    observeProviderRequestLocal:()=>true,
    supaHeaders:()=>({
      apikey:'server-only',
      'content-type':'application/json',
    }),
    supaRpc:async(...args)=>{
      calls.rpc.push(args);
      return await supaRpc(...args);
    },
  });
  return {api,memory,calls};
}

test('ops events persist authoritative release identity after metadata sanitization',async()=>{
  const {api,calls}=buildRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({ok:false}),
  });

  const row=await api.recordOpsEventTask(
    {supabaseUrl:'https://project.supabase.co'},
    {
      severity:'warning',
      source:'release',
      eventType:'identity_test',
      transitionKey:'release-identity-test',
      meta:{
        deploySha:'attacker-value',
        cloudflareVersionId:'attacker-version',
        releaseCandidate:'ATTACKER',
        userId:123,
        nested:{authorization:'Bearer secret',safe:'ok'},
      },
    },
  );

  assert.equal(row._persistenceStatus,'persistent');
  assert.equal(row.metadata.deploySha,'a'.repeat(40));
  assert.equal(
    row.metadata.cloudflareVersionId,
    '11111111-2222-3333-4444-555555555555',
  );
  assert.equal(row.metadata.releaseCandidate,'RC144');
  assert.equal('userId' in row.metadata,false);
  assert.deepEqual(row.metadata.nested,{safe:'ok'});

  assert.equal(calls.rpc.length,1);
  assert.equal(calls.fetch.length,1);
  const requestBody=JSON.parse(calls.fetch[0][1].body);
  assert.equal(requestBody.metadata.deploySha,'a'.repeat(40));
  assert.equal(requestBody.metadata.releaseCandidate,'RC144');
  assert.equal('userId' in requestBody.metadata,false);
});

test('repeated transition refreshes in-memory release attribution to the newest deployment',async()=>{
  let deploy='a'.repeat(40);
  let versionId='11111111-2222-3333-4444-555555555555';
  const {api,memory}=buildRuntime({
    identity:()=>({
      appVersion:'6.120.0-rc144',
      releaseCandidate:'RC144',
      deploySha:deploy,
      cloudflareVersionId:versionId,
      cloudflareVersionTag:deploy,
      cloudflareVersionTimestamp:'2026-10-07T12:00:00.000Z',
    }),
  });

  await api.recordOpsEventTask({},{
    eventType:'release_transition',
    transitionKey:'same-transition',
    meta:{phase:'old'},
  });

  deploy='b'.repeat(40);
  versionId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const second=await api.recordOpsEventTask({},{
    eventType:'release_transition',
    transitionKey:'same-transition',
    meta:{phase:'new'},
  });

  assert.equal(second.occurrence_count,2);
  assert.equal(second.metadata.deploySha,'b'.repeat(40));
  assert.equal(second.metadata.cloudflareVersionId,versionId);
  assert.equal(second.metadata.phase,'new');
  assert.equal(memory.opsEvents.length,1);
  assert.equal(memory.opsEvents[0].metadata.deploySha,'b'.repeat(40));
  assert.equal(memory.opsEvents[0].metadata.cloudflareVersionId,versionId);
  assert.equal(memory.opsEvents[0].metadata.phase,'new');
  assert.equal(memory.opsEvents[0].metadata.occurrenceCount,2);
});

test('deployment identity field names remain explicitly allowed by ops metadata policy',()=>{
  const {api}=buildRuntime();
  for(const key of [
    'appVersion',
    'releaseCandidate',
    'deploySha',
    'cloudflareVersionId',
    'cloudflareVersionTag',
    'cloudflareVersionTimestamp',
  ]){
    assert.equal(api.sensitiveOpsMetadataKey(key),false,key);
  }
  for(const key of ['telegramId','userId','apiKey','authorization','sessionId']){
    assert.equal(api.sensitiveOpsMetadataKey(key),true,key);
  }
});

test('fallback ops persistence treats Supabase HTTP failures as failed writes',async()=>{
  const {api,memory}=buildRuntime({
    hasSupabase:()=>true,
    supaRpc:async()=>({ok:false}),
    fetchWithTimeout:async()=>({ok:false,status:503}),
  });

  const row=await api.recordOpsEventTask(
    {supabaseUrl:'https://project.supabase.co'},
    {
      eventType:'persistence_failure',
      transitionKey:'persistence-failure',
    },
  );

  assert.equal(row._persistenceStatus,'failed');
  assert.equal(memory.telemetry.opsPersistenceErrors,1);
});

test('v6.29.13 makes latest occurrence metadata win while preserving atomic counters',()=>{
  assert.match(
    migration,
    /create or replace function public\.record_ops_event_occurrence\(/,
  );
  assert.match(
    migration,
    /on conflict \(transition_key\) do update[\s\S]*metadata = coalesce\(public\.ops_events\.metadata,'\{\}'::jsonb\)[\s\S]*\|\| coalesce\(excluded\.metadata,'\{\}'::jsonb\)[\s\S]*\|\| jsonb_build_object\(/,
  );
  assert.match(
    migration,
    /occurrence_count = public\.ops_events\.occurrence_count \+ 1/,
  );
  assert.match(
    migration,
    /revoke all on function public\.record_ops_event_occurrence[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.record_ops_event_occurrence[\s\S]*to service_role/,
  );
});

test('worker delegates ops persistence to the hardened telemetry runtime',()=>{
  assert.match(worker,/createTelemetryOpsRuntime\(\{/);
  assert.match(
    worker,
    /currentReleaseIdentity,[\s\S]{0,320}?fetchWithTimeout,[\s\S]{0,320}?hasSupabase:[\s\S]{0,320}?memory,[\s\S]{0,320}?supaHeaders:[\s\S]{0,320}?supaRpc:/,
  );
  assert.match(
    worker,
    /function recordOpsEventTask\(\.\.\.args\) \{ return getTelemetryOpsRuntime\(\)\.recordOpsEventTask\(\.\.\.args\); \}/,
  );
});
