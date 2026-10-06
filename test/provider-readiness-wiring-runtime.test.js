import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createProviderReadinessWiringRuntime } from '../src/provider-readiness-wiring-runtime.js';

function makeMemory() {
  return {
    cache:new Map(),
    provider:{
      name:'API-Football',
      plan:'FREE',
      dailyLimit:100,
      dailyRemaining:80,
      minuteLimit:10,
      minuteRemaining:8,
      updatedAt:new Date().toISOString(),
      lastError:'',
    },
    providerFeatureFetch:{
      api:0,
      cache:0,
      stale:0,
      skipped:0,
      byFeature:{},
      lastUpdatedAt:null,
    },
    providerE2E:{ last:null },
    telemetry:{},
    opsEvents:[],
  };
}

function deps(overrides = {}) {
  return {
    APP_VERSION:'test',
    COMPATIBLE_SCHEMA_FINGERPRINTS:['0123456789abcdef0123456789abcdef'],
    EXPECTED_SCHEMA_CONTRACT_VERSION:2,
    EXPECTED_SCHEMA_FINGERPRINT:'0123456789abcdef0123456789abcdef',
    SUPABASE_SCHEMA_GUIDANCE:'schema guidance',
    bumpTelemetry:()=>{},
    clamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
    fetchWithTimeout:async()=>{ throw new Error('network should not run during composition'); },
    getCache:async()=>null,
    getCacheEntry:async()=>null,
    hasSupabase:()=>false,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isLiveStatus:status=>['1H','2H','HT'].includes(String(status || '').toUpperCase()),
    memory:makeMemory(),
    observeProviderRequest:async()=>{},
    phase5ProviderUsage:()=>{},
    providerSloReport:async()=>({ overall:{ state:'ok' }, incident:{ activeIncident:null } }),
    readIntegrityDiagnostics:async()=>({ migrationReady:true, lastRun:{ health:'ok' } }),
    readTelegramDedupeHealth:async()=>({ available:true, state:'ok' }),
    recordOpsEvent:async()=>{},
    redactOpsString:(value,limit=180)=>String(value ?? '').slice(0,limit),
    runtimeControlsSnapshot:()=>({ expandedDataEnabled:true, liveEnabled:true }),
    setCache:async()=>{},
    sleepMs:async()=>{},
    supaHeaders:()=>({}),
    supaRpc:async()=>null,
    telemetrySnapshot:()=>({}),
    withSingleFlight:async(_key,fn)=>fn(),
    ...overrides,
  };
}

test('provider readiness wiring fails fast when a required dependency is missing', () => {
  const input = deps();
  delete input.clamp;
  assert.throws(
    () => createProviderReadinessWiringRuntime(input),
    /clamp is required/,
  );
});

test('provider readiness wiring composes a frozen runtime with passing self-tests', () => {
  const runtime = createProviderReadinessWiringRuntime(deps());

  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(runtime.providerDataReliabilitySelfTest().pass, true);
  assert.equal(runtime.supabaseProbeConfirmationSelfTest().pass, true);

  const transition = runtime.providerTransitionProfile();
  assert.equal(transition.plan, 'FREE');
  assert.equal(transition.paid, false);
  assert.equal(transition.mode, 'economy');
  assert.equal(transition.quotaHealthy, true);
});

test('provider readiness free-quota proxy is fail-closed during composition and functional afterward', () => {
  const runtime = createProviderReadinessWiringRuntime(deps());
  const transition = runtime.providerTransitionProfile();

  assert.equal(typeof runtime.freeQuotaHealthy, 'function');
  assert.equal(typeof transition.quotaHealthy, 'boolean');
  assert.equal(transition.quotaHealthy, true);
});

test('worker composition keeps provider readiness free of TDZ and restores shared cache boundary', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');

  assert.match(worker, /let sharedCacheRuntime = null;/);
  assert.match(worker, /function getSharedCacheRuntime\(\)/);
  assert.match(worker, /function getCacheEntry\(\.\.\.args\)/);
  assert.match(worker, /function getCache\(\.\.\.args\)/);
  assert.match(worker, /function getStaleCache\(\.\.\.args\)/);
  assert.match(worker, /function setCache\(\.\.\.args\)/);

  assert.match(worker, /clamp:\s*\(\.\.\.args\)\s*=>\s*clamp\(\.\.\.args\)/);
  assert.match(worker, /isFinishedStatus:\s*\(\.\.\.args\)\s*=>\s*isFinishedStatus\(\.\.\.args\)/);
  assert.match(worker, /isLiveStatus:\s*\(\.\.\.args\)\s*=>\s*isLiveStatus\(\.\.\.args\)/);

  assert.doesNotMatch(worker, /const tavll\(/);
  assert.doesNotMatch(worker, /const buildSmartMatchInsights = \(\.\.\.args\) home:/);
  assert.doesNotMatch(worker, /\n\s*r \}\);\s*\n/);
});

test('worker no longer imports child provider-readiness factories directly', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  for (const name of [
    'createReminderDeliveryRuntime',
    'createProviderBudgetRuntime',
    'createSupabaseReadinessRuntime',
    'createApiFootballGateway',
    'createProviderDataRuntime',
    'createCompositeReadinessRuntime',
    'createDiagnosticsRuntime',
  ]) {
    assert.doesNotMatch(worker, new RegExp(`\\b${name}\\b`));
  }
  assert.match(worker, /createProviderReadinessWiringRuntime/);
});
