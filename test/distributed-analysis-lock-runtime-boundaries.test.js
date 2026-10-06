import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createDistributedAnalysisLockRuntime } from '../src/distributed-analysis-lock-runtime.js';

function baseDeps(overrides={}) {
  return {
    APP_VERSION:'6.120.0-rc144',
    DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS:90,
    DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS:4,
    DISTRIBUTED_ANALYSIS_WAIT_MS:1600,
    bumpTelemetry:()=>{},
    fetchWithTimeout:async()=>{ throw new Error('unexpected network'); },
    getCache:async()=>null,
    getCacheEntry:async()=>null,
    hasSupabase:()=>false,
    memory:{cache:new Map()},
    randomUUID:()=> '33333333-3333-4333-8333-333333333333',
    recordOpsEvent:async()=>{},
    sleepMs:async()=>{},
    supaDelete:async()=>{},
    supaHeaders:()=>({'content-type':'application/json'}),
    supaSelectOne:async()=>null,
    ...overrides,
  };
}

test('distributed lock validates dependencies, memory cache, and freezes exports', () => {
  const broken=baseDeps();
  delete broken.getCacheEntry;
  assert.throws(
    () => createDistributedAnalysisLockRuntime(broken),
    /getCacheEntry is required/,
  );

  assert.throws(
    () => createDistributedAnalysisLockRuntime({
      ...baseDeps(),
      memory:{cache:{}},
    }),
    /memory\.cache must be a Map/,
  );

  const runtime=createDistributedAnalysisLockRuntime(baseDeps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('lock keys reject coercive and unsafe fixture identifiers', () => {
  const runtime=createDistributedAnalysisLockRuntime(baseDeps());

  assert.equal(runtime.distributedAnalysisLockKey(123),'analysis:compute-lock:123:v1');
  assert.equal(runtime.distributedAnalysisLockKey('123'),'analysis:compute-lock:123:v1');
  assert.equal(runtime.distributedAnalysisLockKey(true),'');
  assert.equal(runtime.distributedAnalysisLockKey(1.5),'');
  assert.equal(runtime.distributedAnalysisLockKey(Number.MAX_SAFE_INTEGER+1),'');
});

test('invalid coordination policy falls back to a bounded safe policy', () => {
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS:true,
    DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS:99,
    DISTRIBUTED_ANALYSIS_WAIT_MS:1,
  }));

  assert.deepEqual(runtime.distributedAnalysisLockPolicy(),{
    ttlSeconds:90,
    waitAttempts:4,
    waitMs:1600,
    maxWaitMs:6400,
  });
  assert.equal(runtime.distributedAnalysisLockDrill().pass,true);
});

test('coordination availability probe failures fail closed', async () => {
  const events=[];
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>{ throw new Error('probe failed'); },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const result=await runtime.claimDistributedAnalysisLock(123,{});
  assert.equal(result.claimed,false);
  assert.equal(result.unavailable,true);
  assert.equal(result.reason,'coordination_probe_failed');
  assert.equal(events[0].code,'ANALYSIS_LOCK_FAIL_CLOSED');
});

test('invalid fixture claims fail before any shared coordination call', async () => {
  let reads=0;
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>true,
    getCacheEntry:async()=>{ reads+=1; return null; },
  }));

  const result=await runtime.claimDistributedAnalysisLock(true,{});
  assert.equal(result.claimed,false);
  assert.equal(result.unavailable,true);
  assert.equal(result.reason,'invalid_fixture_id');
  assert.equal(reads,0);
});

test('fresh validated shared lock joins without creating a second claim', async () => {
  let network=0;
  const claimId='11111111-1111-4111-8111-111111111111';
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>true,
    getCacheEntry:async()=>({
      expired:false,
      expiresAt:new Date(Date.now()+60_000).toISOString(),
      payload:{state:'computing',fixtureId:123,claimId},
    }),
    fetchWithTimeout:async()=>{ network+=1; throw new Error('should not call'); },
  }));

  const result=await runtime.claimDistributedAnalysisLock(123,{});
  assert.equal(result.claimed,false);
  assert.equal(result.shared,true);
  assert.equal(result.unavailable,undefined);
  assert.equal(network,0);
});

test('malformed fresh lock fails closed rather than allowing duplicate analysis', async () => {
  const events=[];
  let network=0;
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>true,
    getCacheEntry:async()=>({
      expired:false,
      payload:{state:'computing',fixtureId:999,claimId:'bad'},
    }),
    fetchWithTimeout:async()=>{ network+=1; return null; },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const result=await runtime.claimDistributedAnalysisLock(123,{});
  assert.equal(result.claimed,false);
  assert.equal(result.unavailable,true);
  assert.equal(result.reason,'invalid_existing_lock');
  assert.equal(network,0);
  assert.equal(events[0].code,'ANALYSIS_LOCK_ENTRY_INVALID');
});

test('expired locks are deleted only while expired and a confirmed insert owns the claim', async () => {
  const deletes=[];
  const memory={cache:new Map()};
  memory.cache.set('analysis:compute-lock:123:v1',{
    payload:{
      state:'computing',
      fixtureId:123,
      claimId:'11111111-1111-4111-8111-111111111111',
    },
    expiresAt:Date.now()-1000,
  });

  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    memory,
    hasSupabase:()=>true,
    getCacheEntry:async()=>({
      expired:true,
      expiresAt:new Date(Date.now()-1000).toISOString(),
      payload:{
        state:'computing',
        fixtureId:123,
        claimId:'11111111-1111-4111-8111-111111111111',
      },
    }),
    supaDelete:async(_cfg,_table,filters)=>deletes.push(filters),
    fetchWithTimeout:async(_url,init)=>{
      const [row]=JSON.parse(init.body);
      return {
        ok:true,
        status:201,
        json:async()=>[row],
      };
    },
  }));

  const result=await runtime.claimDistributedAnalysisLock(123,{
    supabaseUrl:'https://example.supabase.co',
  });

  assert.equal(result.claimed,true);
  assert.equal(result.shared,true);
  assert.match(result.claimId,/^[0-9a-f-]{36}$/);
  assert.equal(deletes.length,1);
  assert.equal(deletes[0].cache_key,'eq.analysis:compute-lock:123:v1');
  assert.match(deletes[0].expires_at,/^lte\./);
  assert.equal(memory.cache.get(result.key)?.payload?.claimId,result.claimId);
});

test('ambiguous successful insert responses fail closed', async () => {
  const events=[];
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>true,
    fetchWithTimeout:async()=>({
      ok:true,
      status:201,
      json:async()=>({unexpected:true}),
    }),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const result=await runtime.claimDistributedAnalysisLock(123,{
    supabaseUrl:'https://example.supabase.co',
  });
  assert.equal(result.claimed,false);
  assert.equal(result.unavailable,true);
  assert.equal(result.reason,'coordination_unavailable');
  assert.equal(events.at(-1)?.code,'ANALYSIS_LOCK_FAIL_CLOSED');
});

test('release never deletes a lock after ownership changes', async () => {
  const deletes=[];
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    hasSupabase:()=>true,
    supaSelectOne:async()=>({
      payload:{
        state:'computing',
        fixtureId:123,
        claimId:'22222222-2222-4222-8222-222222222222',
      },
    }),
    supaDelete:async(...args)=>deletes.push(args),
  }));

  const result=await runtime.releaseDistributedAnalysisLock({
    shared:true,
    key:'analysis:compute-lock:123:v1',
    claimId:'11111111-1111-4111-8111-111111111111',
  },{});

  assert.equal(result.released,false);
  assert.equal(result.reason,'ownership_changed');
  assert.equal(deletes.length,0);
});

test('release uses claim identity in the delete filter', async () => {
  const deletes=[];
  const claimId='11111111-1111-4111-8111-111111111111';
  const key='analysis:compute-lock:123:v1';
  const memory={cache:new Map([[key,{
    payload:{state:'computing',fixtureId:123,claimId},
    expiresAt:Date.now()+60_000,
  }]])};

  let selects=0;
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    memory,
    hasSupabase:()=>true,
    supaSelectOne:async()=>{
      selects+=1;
      return selects===1
        ? {
            cache_key:key,
            fixture_id:123,
            payload:{state:'computing',fixtureId:123,claimId},
          }
        : null;
    },
    supaDelete:async(_cfg,table,filters)=>deletes.push({table,filters}),
  }));

  const result=await runtime.releaseDistributedAnalysisLock({
    shared:true,
    key,
    claimId,
  },{});

  assert.equal(result.released,true);
  assert.equal(deletes.length,1);
  assert.equal(deletes[0].table,'analysis_cache');
  assert.equal(deletes[0].filters.cache_key,`eq.${key}`);
  assert.equal(deletes[0].filters.fixture_id,'eq.123');
  assert.equal(deletes[0].filters['payload->>claimId'],`eq.${claimId}`);
  assert.equal(memory.cache.has(key),false);
});

test('shared analysis wait ignores cross-fixture payloads and returns matching analysis', async () => {
  let reads=0;
  const runtime=createDistributedAnalysisLockRuntime(baseDeps({
    sleepMs:async()=>{},
    getCache:async()=>{
      reads+=1;
      if (reads===1) return {match:{fixtureId:999},generatedAt:'x'};
      return {match:{fixtureId:123},generatedAt:'y'};
    },
  }));

  const result=await runtime.waitForSharedAnalysis(
    'fixture:123:v15-availability-quality-rc144',
    {},
  );

  assert.equal(reads,2);
  assert.equal(result.match.fixtureId,123);
  assert.equal(result.generatedAt,'y');
});

test('shared analysis wait rejects malformed keys and sleep failures safely', async () => {
  let reads=0;
  const invalid=createDistributedAnalysisLockRuntime(baseDeps({
    getCache:async()=>{ reads+=1; return {}; },
  }));
  assert.equal(await invalid.waitForSharedAnalysis('not-a-fixture-cache',{}),null);
  assert.equal(reads,0);

  const sleepFailure=createDistributedAnalysisLockRuntime(baseDeps({
    sleepMs:async()=>{ throw new Error('timer unavailable'); },
    getCache:async()=>{ reads+=1; return {}; },
  }));
  assert.equal(
    await sleepFailure.waitForSharedAnalysis('fixture:123:v15',{}),
    null,
  );
});

test('worker keeps distributed analysis lock dependencies explicit', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/distributed-analysis-lock-runtime.js','utf8');

  assert.match(
    worker,
    /createDistributedAnalysisLockRuntime\(\{[\s\S]*?APP_VERSION,[\s\S]*?DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS,[\s\S]*?DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS,[\s\S]*?DISTRIBUTED_ANALYSIS_WAIT_MS,[\s\S]*?bumpTelemetry,[\s\S]*?fetchWithTimeout,[\s\S]*?getCache,[\s\S]*?getCacheEntry,[\s\S]*?hasSupabase,[\s\S]*?memory,[\s\S]*?randomUUID:[\s\S]*?recordOpsEvent,[\s\S]*?sleepMs,[\s\S]*?supaDelete,[\s\S]*?supaHeaders,[\s\S]*?supaSelectOne[\s\S]*?\}\);/,
  );
  assert.match(source,/ANALYSIS_LOCK_FAIL_CLOSED/);
  assert.match(source,/'payload->>claimId'/);
  assert.match(source,/return Object\.freeze\(\{/);
});
