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
