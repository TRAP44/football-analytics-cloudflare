import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createDistributedAnalysisLockRuntime } from '../src/distributed-analysis-lock-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const lockSource=fs.readFileSync('src/distributed-analysis-lock-runtime.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');

const telemetry=[];
const events=[];
const lockRuntime=createDistributedAnalysisLockRuntime({
  APP_VERSION:'test',
  DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS:90,
  DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS:4,
  DISTRIBUTED_ANALYSIS_WAIT_MS:1600,
  bumpTelemetry(key){ telemetry.push(key); },
  async fetchWithTimeout(){ return {ok:true,status:201,json:async()=>[]}; },
  async getCache(){ return null; },
  async getCacheEntry(){ return null; },
  hasSupabase(){ return false; },
  memory:{cache:new Map()},
  randomUUID(){ return '123e4567-e89b-42d3-a456-426614174000'; },
  async recordOpsEvent(_cfg,event){ events.push(event); },
  async sleepMs(){},
  async supaDelete(){},
  supaHeaders(extra={}){ return extra; },
  async supaSelectOne(){ return null; },
});

test('RC66 defines a bounded distributed analysis lock policy',()=> {
  const policy=lockRuntime.distributedAnalysisLockPolicy();
  assert.deepEqual(policy,{
    ttlSeconds:90,
    waitAttempts:4,
    waitMs:1600,
    maxWaitMs:6400,
  });
  assert.equal(lockRuntime.distributedAnalysisLockKey(12345),'analysis:compute-lock:12345:v1');
  assert.equal(lockRuntime.distributedAnalysisLockKey(true),'');
  assert.equal(lockRuntime.distributedAnalysisLockDrill().pass,true);
});

test('lock claim uses persistent analysis_cache conflict dedupe when Supabase is available',()=> {
  assert.match(lockSource,/rest\/v1\/analysis_cache\?on_conflict=cache_key/);
  assert.match(lockSource,/Prefer:'resolution=ignore-duplicates,return=representation'/);
  assert.match(lockSource,/safeTelemetry\('analysisLockClaims'\)/);
  assert.match(lockSource,/safeTelemetry\('analysisLockJoins'\)/);
});

test('coordination degradation fails closed before expensive recompute',async()=> {
  const failClosed=createDistributedAnalysisLockRuntime({
    APP_VERSION:'test',
    DISTRIBUTED_ANALYSIS_LOCK_TTL_SECONDS:90,
    DISTRIBUTED_ANALYSIS_WAIT_ATTEMPTS:4,
    DISTRIBUTED_ANALYSIS_WAIT_MS:1600,
    bumpTelemetry(key){ telemetry.push(key); },
    async fetchWithTimeout(){ throw new Error('should not run'); },
    async getCache(){ return null; },
    async getCacheEntry(){ return null; },
    hasSupabase(){ throw new Error('probe failed'); },
    memory:{cache:new Map()},
    randomUUID(){ return '123e4567-e89b-42d3-a456-426614174000'; },
    async recordOpsEvent(_cfg,event){ events.push(event); },
    async sleepMs(){},
    async supaDelete(){},
    supaHeaders(extra={}){ return extra; },
    async supaSelectOne(){ return null; },
  });
  const result=await failClosed.claimDistributedAnalysisLock(12345,{});
  assert.equal(result.claimed,false);
  assert.equal(result.unavailable,true);
  assert.equal(result.degraded,true);
  assert.equal(result.reason,'coordination_probe_failed');
  assert.ok(telemetry.includes('analysisLockFailClosed'));
  assert.match(analysis,/code:'ANALYSIS_COORDINATION_DEGRADED'/);
});

test('non-owner waits for shared fixture analysis instead of recomputing',()=> {
  assert.match(analysis,/optionalAsync\(waitForSharedAnalysis,cacheKey,cfg\)/);
  assert.match(analysis,/sharedJoin:true/);
  assert.match(analysis,/code:'ANALYSIS_WARMING'/);
  assert.match(analysis,/reasonCode:'shared_compute_pending'/);
  assert.match(lockSource,/safeTelemetry\('analysisLockJoinHits'\)/);
  assert.match(lockSource,/safeTelemetry\('analysisLockTimeouts'\)/);
});

test('analysis owner always releases the distributed lock after usage finalization',()=> {
  const finalization=analysis.slice(analysis.indexOf('} finally {'),analysis.indexOf('return Object.freeze({'));
  assert.match(finalization,/finalizeAnalysisUsageReservation/);
  assert.match(finalization,/refundAnalysisQuota/);
  assert.match(finalization,/refundEntitlementUsage/);
  assert.match(finalization,/await releaseDistributedAnalysisLock\(analysisLock,cfg\)/);
  assert.match(lockSource,/async function releaseDistributedAnalysisLock\(/);
  assert.match(lockSource,/payload->>claimId/);
});

test('RC66 traffic guard remains wired through current production modules',()=> {
  assert.match(worker,/createDistributedAnalysisLockRuntime/);
  assert.match(worker,/claimDistributedAnalysisLock/);
  assert.match(worker,/waitForSharedAnalysis/);
  assert.match(worker,/releaseDistributedAnalysisLock/);
  assert.match(lockSource,/ANALYSIS_LOCK_FAIL_CLOSED/);
});
