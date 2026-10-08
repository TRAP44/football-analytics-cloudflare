import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_READINESS_CACHE_MS,
  createPublicHealthRuntime,
  sanitizePublicReadiness,
} from '../src/public-health.js';

test('public readiness removes deployment identity, fingerprints and internal counters', () => {
  const value=sanitizePublicReadiness({
    ok:true,
    status:'ready',
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    deployment:{deploySha:'secret-ish-build-metadata',cloudflareVersionId:'id'},
    latencyMs:123,
    checks:{
      supabase:{ok:true,status:'ok',attempts:2,latencyMs:100},
      schema:{ok:true,status:'ok',fingerprint:'abc',expectedFingerprint:'def',contractVersion:2},
      backendSecurity:{ok:true,status:'ok',latencyMs:100},
      telegramConfigured:true,
      recentSupabaseAuthFailures:0,
    },
  });

  assert.deepEqual(value,{
    ok:true,
    status:'ready',
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    latencyMs:123,
    checks:{
      supabase:{ok:true,status:'ok'},
      schema:{ok:true,status:'ok'},
      backendSecurity:{ok:true,status:'ok'},
      telegramConfigured:true,
    },
  });
  assert.equal('deployment' in value,false);
  assert.equal('fingerprint' in value.checks.schema,false);
  assert.equal('recentSupabaseAuthFailures' in value.checks,false);
});

test('public readiness rejects boolean and object coercion at the public boundary', () => {
  const value=sanitizePublicReadiness({
    ok:'true',
    status:{value:'ready'},
    version:{value:'6.120.0'},
    releaseCandidate:['RC144'],
    latencyMs:true,
    checks:{
      supabase:{ok:'true',status:['ok']},
      schema:[],
      backendSecurity:{ok:1,status:'ok'},
      telegramConfigured:'false',
    },
  });

  assert.deepEqual(value,{
    ok:false,
    status:'not_ready',
    version:'',
    releaseCandidate:'',
    latencyMs:null,
    checks:{
      supabase:{ok:false,status:'unknown'},
      schema:{ok:false,status:'unknown'},
      backendSecurity:{ok:false,status:'ok'},
      telegramConfigured:false,
    },
  });
});

test('public readiness accepts only bounded non-negative latency and strips control characters', () => {
  assert.equal(sanitizePublicReadiness({latencyMs:'123.5'}).latencyMs,123.5);
  assert.equal(sanitizePublicReadiness({latencyMs:-1}).latencyMs,null);
  assert.equal(sanitizePublicReadiness({latencyMs:9999999}).latencyMs,null);
  assert.equal(sanitizePublicReadiness({version:'6.1\u0000hidden'}).version,'');
  assert.equal(sanitizePublicReadiness({status:' ready\nspoofed '}).status,'not_ready');
});

test('public readiness coalesces concurrent probes and caches completed results', async () => {
  let now=1000;
  let calls=0;
  let releaseFirst;
  const first=new Promise(resolve=>{ releaseFirst=resolve; });
  const runtime=createPublicHealthRuntime({
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    now:()=>now,
    cacheMs:PUBLIC_READINESS_CACHE_MS,
    computeReadiness:async()=>{
      calls+=1;
      if (calls===1) await first;
      return {
        ok:true,status:'ready',version:'6.120.0-rc144',releaseCandidate:'RC144',
        checks:{supabase:{ok:true,status:'ok'},schema:{ok:true,status:'ok'},backendSecurity:{ok:true,status:'ok'},telegramConfigured:true},
      };
    },
  });

  const a=runtime.readinessSnapshot();
  const b=runtime.readinessSnapshot();
  assert.equal(calls,0);
  await Promise.resolve();
  assert.equal(calls,1);
  releaseFirst();
  await Promise.all([a,b]);
  assert.equal(calls,1);

  await runtime.readinessSnapshot();
  assert.equal(calls,1);

  now+=PUBLIC_READINESS_CACHE_MS+1;
  await runtime.readinessSnapshot();
  assert.equal(calls,2);
});

test('public readiness cache rejects malformed TTL and clock rollback safely', async () => {
  let now=1000;
  let calls=0;
  const runtime=createPublicHealthRuntime({
    cacheMs:true,
    now:()=>now,
    computeReadiness:async()=>{
      calls+=1;
      return {ok:true,status:'ready'};
    },
  });

  await runtime.readinessSnapshot();
  now+=1000;
  await runtime.readinessSnapshot();
  assert.equal(calls,1);

  now=500;
  await runtime.readinessSnapshot();
  assert.equal(calls,2);
});

test('public health devMode requires a strict boolean', async () => {
  const runtime=createPublicHealthRuntime({
    computeReadiness:async()=>({ok:true,status:'ready'}),
  });
  assert.equal((await runtime.healthSnapshot({devMode:'false'})).devMode,false);
  runtime.invalidate();
  assert.equal((await runtime.healthSnapshot({devMode:true})).devMode,true);
});

test('public liveness is dependency-free and full public health stays minimal', async () => {
  let calls=0;
  const runtime=createPublicHealthRuntime({
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    computeReadiness:async()=>{
      calls+=1;
      return {
        ok:false,status:'not_ready',version:'6.120.0-rc144',releaseCandidate:'RC144',
        checks:{supabase:{ok:false,status:'unavailable'},schema:{ok:false,status:'unknown'},backendSecurity:{ok:false,status:'unknown'},telegramConfigured:true},
      };
    },
  });

  assert.deepEqual(runtime.liveSnapshot(),{
    ok:true,status:'alive',version:'6.120.0-rc144',releaseCandidate:'RC144',
  });
  assert.equal(calls,0);

  const full=await runtime.healthSnapshot({devMode:false});
  assert.equal(calls,1);
  assert.deepEqual(full,{
    ok:false,
    status:'not_ready',
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    devMode:false,
    readiness:{ok:false,status:'not_ready'},
  });
});

test('public readiness invalidation refreshes a frozen and sanitized snapshot',async()=>{
  let calls=0;
  const api=createPublicHealthRuntime({
    now:()=>1_000,
    cacheMs:30_000,
    computeReadiness:async()=>({
      ok:true,status:'ready',version:'v'+(++calls),
      checks:{supabase:{ok:true,status:'ok',privateToken:'never expose'}},
      deployment:{sha:'secret'},
    }),
  });
  const first=await api.readinessSnapshot();
  assert.equal(first.version,'v1');
  assert.equal(Object.isFrozen(first),true);
  assert.equal(Object.isFrozen(first.checks),true);
  assert.equal(Object.isFrozen(first.checks.supabase),true);
  assert.equal('deployment' in first,false);
  assert.equal('privateToken' in first.checks.supabase,false);
  assert.equal((await api.readinessSnapshot()).version,'v1');
  api.invalidate();
  const refreshed=await api.readinessSnapshot();
  assert.equal(refreshed.version,'v2');
  assert.equal(calls,2);
});

test('failed readiness probes are retried instead of poisoning the public cache',async()=>{
  let calls=0;
  const api=createPublicHealthRuntime({
    now:()=>1_000,
    computeReadiness:async()=>{
      calls++;
      if(calls===1) throw new Error('temporary upstream failure');
      return {ok:true,status:'ready'};
    },
  });
  await assert.rejects(api.readinessSnapshot(),/temporary upstream failure/);
  assert.equal((await api.readinessSnapshot()).ok,true);
  assert.equal((await api.readinessSnapshot()).ok,true);
  assert.equal(calls,2);
});
