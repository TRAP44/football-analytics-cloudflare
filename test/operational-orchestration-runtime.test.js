import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createOperationalOrchestrationRuntime } from '../src/operational-orchestration-runtime.js';

const noop=()=>{};

function runtimeMemory(provider={}) {
  return {
    provider,
    modelPredictions:new Map(),
    modelRemediation:{lastRun:null,actions:[]},
  };
}

function baseDeps(overrides={}) {
  const target={
    APP_VERSION:'test',
    RC_NAME:'rc-test',
    RUNTIME_CONTROLS_CACHE_MS:30_000,
    EXPECTED_SCHEMA_CONTRACT_VERSION:2,
    EXPECTED_SCHEMA_FINGERPRINT:'0123456789abcdef0123456789abcdef',
    DEFAULT_RUNTIME_CONTROLS:{},
    PROVIDER_FEATURE_TTLS:{},
    SETTLEMENT_DRIFT_ACTIONS:new Set(),
    SETTLEMENT_FINALITY_DRIFT_STATUSES:new Set(),
    memory:runtimeMemory(),
    enc:{encode:()=>new Uint8Array()},
    loadRuntimeControls:async()=>({
      value:{
        maintenanceMode:false,
        analysisEnabled:true,
        searchEnabled:true,
        liveEnabled:true,
        remindersEnabled:true,
        expandedDataEnabled:true,
        message:'',
      },
      schemaReady:true,
      source:'memory',
    }),
    publicRuntimeControls:value=>value,
    currentReleaseIdentity:()=>({}),
    readCompositeReadiness:async()=>({
      valid:true,
      ok:true,
      connectivity:{ok:true,status:'ok',attempts:1},
      schema:{ok:true,status:'ok'},
      backendSecurity:{ok:true,status:'ok'},
      authFailures:{available:true,count:0},
    }),
    json:(body)=>body,
    claimScheduledJob:async(_cfg,options)=>({
      claimed:true,
      persistent:false,
      reason:'memory_only',
      jobKey:options.jobKey,
      groupKey:options.groupKey,
      scheduledAt:new Date(options.scheduledAt).toISOString(),
      leaseSeconds:options.leaseSeconds,
    }),
    renewScheduledJob:async()=>({renewed:true,persistent:false,reason:'memory_only'}),
    completeScheduledJob:async()=>true,
    releaseScheduledJob:async()=>true,
    ...overrides,
  };
  return new Proxy(target,{
    get(source,key) {
      if (Reflect.has(source,key)) return Reflect.get(source,key);
      return noop;
    },
  });
}

test('operational orchestration fails fast on invalid composition dependencies', () => {
  assert.throws(
    () => createOperationalOrchestrationRuntime(null),
    /Operational orchestration dependencies are required/,
  );
  assert.throws(
    () => createOperationalOrchestrationRuntime(baseDeps({renewScheduledJob:undefined})),
    /renewScheduledJob is required/,
  );
});

test('expired ISO provider cooldown does not leave public status degraded forever', async () => {
  const runtime=createOperationalOrchestrationRuntime(baseDeps({
    memory:runtimeMemory({cooldownUntil:'2020-01-01T00:00:00.000Z'}),
  }));

  const status=await runtime.publicStatusRouter.handle(
    {method:'GET'},
    new URL('https://example.test/api/public-status'),
    {apiFootballKey:'configured'},
  );

  assert.equal(status.status,'operational');
});

test('malformed provider cooldown remains fail-closed in public status', async () => {
  const runtime=createOperationalOrchestrationRuntime(baseDeps({
    memory:runtimeMemory({cooldownUntil:'not-a-timestamp'}),
  }));

  const status=await runtime.publicStatusRouter.handle(
    {method:'GET'},
    new URL('https://example.test/api/public-status'),
    {apiFootballKey:'configured'},
  );

  assert.equal(status.status,'degraded');
});

test('impossible ISO provider cooldown stays invalid instead of being normalized by Date.parse', async () => {
  const runtime=createOperationalOrchestrationRuntime(baseDeps({
    memory:runtimeMemory({cooldownUntil:'2026-02-31T00:00:00.000Z'}),
  }));

  const status=await runtime.publicStatusRouter.handle(
    {method:'GET'},
    new URL('https://example.test/api/public-status'),
    {apiFootballKey:'configured'},
  );

  assert.equal(status.status,'degraded');
});

test('corrupt provider state and throwing cooldown getters fail closed in public status', async () => {
  const corrupt=createOperationalOrchestrationRuntime(baseDeps({
    memory:runtimeMemory([]),
  }));
  assert.equal(
    (await corrupt.publicStatusRouter.handle(
      {method:'GET'},
      new URL('https://example.test/api/public-status'),
      {apiFootballKey:'configured'},
    )).status,
    'degraded',
  );

  const provider={};
  Object.defineProperty(provider,'cooldownUntil',{
    enumerable:true,
    get() {
      throw new Error('corrupt provider state');
    },
  });
  const throwing=createOperationalOrchestrationRuntime(baseDeps({
    memory:runtimeMemory(provider),
  }));
  assert.equal(
    (await throwing.publicStatusRouter.handle(
      {method:'GET'},
      new URL('https://example.test/api/public-status'),
      {apiFootballKey:'configured'},
    )).status,
    'degraded',
  );
});

test('scheduled orchestration renews a persistent lease through explicit wiring', async () => {
  let renewals=0;
  const runtime=createOperationalOrchestrationRuntime(baseDeps({
    claimScheduledJob:async(_cfg,options)=>({
      claimed:true,
      persistent:true,
      reason:'claimed',
      jobKey:options.jobKey,
      groupKey:options.groupKey,
      scheduledAt:new Date(options.scheduledAt).toISOString(),
      leaseSeconds:options.leaseSeconds,
      leaseToken:'lease-token-1234567890',
      lockedUntil:new Date(Date.now()+600_000).toISOString(),
    }),
    renewScheduledJob:async(_cfg,claim)=> {
      renewals+=1;
      return {
        renewed:true,
        persistent:true,
        reason:'renewed',
        jobKey:claim.jobKey,
        groupKey:claim.groupKey,
        lockedUntil:new Date(Date.now()+600_000).toISOString(),
      };
    },
    completeScheduledJob:async()=>true,
  }));

  const results=await runtime.handleScheduled(
    {scheduledTime:Date.UTC(2026,9,6,12,7,0)},
    {},
    {},
  );

  assert.ok(Array.isArray(results));
  assert.ok(renewals>=1);
});

test('operational runtime surface and API route dependency bag are immutable', () => {
  const runtime=createOperationalOrchestrationRuntime(baseDeps());
  assert.equal(Object.isFrozen(runtime),true);
  assert.equal(Object.isFrozen(runtime.API_ROUTE_DEPS),true);
});

test('worker restores Telegram links composition and exact operational dependency wiring', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const operational=fs.readFileSync('src/operational-orchestration-runtime.js','utf8');

  assert.match(worker,/function getTelegramLinksRuntime\(\)/);
  for (const name of [
    'telegramWebAppUrl',
    'telegramAnalysisHandoffParams',
    'telegramFullAnalysisUrl',
    'fixtureShareStartParam',
    'campaignStartParam',
    'fixtureTelegramDeepLink',
    'telegramCampaignDeepLink',
    'telegramShareComposerUrl',
  ]) {
    assert.match(worker,new RegExp(`function ${name}\\(\\.\\.\\.args\\)`));
  }

  assert.match(worker,/\brenewScheduledJob\b/);
  assert.match(operational,/providerCooldownUntil:providerCooldownTimestamp/);
  assert.match(operational,/createScheduledJobsRuntime\(\{[\s\S]*?renewScheduledJob[\s\S]*?\}\);/);
  assert.doesNotMatch(operational,/\bprobeSupabaseReadinessConfirmed\b/);
});
