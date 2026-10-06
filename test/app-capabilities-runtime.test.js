import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';

const TEST_VERSION='6.120.0-rc144';
const TEST_SHA='a'.repeat(40);

function build({
  plan='FREE',
  runtime={},
  budget={mode:'normal',label:'Норма',liveRefreshSeconds:90},
  quotaHealthy=true,
  overrides={},
}={}) {
  const state={
    maintenanceMode:false,
    liveEnabled:true,
    expandedDataEnabled:true,
    message:'',
    ...runtime,
  };

  return createAppCapabilitiesRuntime({
    memory:{provider:{plan}},
    appVersion:TEST_VERSION,
    minClientVersion:'5.8.0',
    apiContractVersion:5,
    releaseChannel:'rc144',
    releaseCandidate:'RC144',
    paidQuotaHealthy:()=>quotaHealthy,
    providerPublicBudgetMode:()=>budget,
    runtimeControlsSnapshot:()=>state,
    isSecurityLockdownControls:value=>Boolean(value?.securityLockdown),
    publicRuntimeControls:value=>({
      maintenanceMode:value?.maintenanceMode === true,
      liveEnabled:value?.liveEnabled === true,
      expandedDataEnabled:value?.expandedDataEnabled === true,
      securityLockdown:value?.securityLockdown === true,
      message:String(value?.message || ''),
    }),
    currentReleaseIdentity:()=>({deploySha:TEST_SHA}),
    now:()=>new Date('2026-10-05T11:00:00.000Z'),
    ...overrides,
  });
}

test('FREE public capabilities remain standard and quota-conscious',()=>{
  const caps=build().publicDataCapabilities();

  assert.equal(caps.visibility,'public');
  assert.equal(caps.mode,'standard');
  assert.equal(caps.features.events,true);
  assert.equal(caps.features.matchStatistics,true);
  assert.equal(caps.features.liveRefresh,true);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.features.liveOdds,false);
  assert.equal(caps.refreshSeconds,90);
  assert.match(caps.note,/экономит запросы/i);
});

test('paid capabilities enrich only when quota, budget and runtime all allow it',()=>{
  const paid=build({plan:'PRO'}).publicDataCapabilities();
  assert.equal(paid.mode,'expanded');
  assert.equal(paid.features.playerStats,true);
  assert.equal(paid.features.liveOdds,true);
  assert.equal(paid.features.lineupsFallback,true);

  const unhealthy=build({plan:'PRO',quotaHealthy:false}).publicDataCapabilities();
  assert.equal(unhealthy.features.playerStats,false);
  assert.equal(unhealthy.features.lineupsFallback,false);

  const conserve=build({
    plan:'PRO',
    budget:{mode:'conserve',label:'Экономия',liveRefreshSeconds:180},
  }).publicDataCapabilities();
  assert.equal(conserve.features.playerStats,false);
  assert.equal(conserve.features.liveOdds,false);
  assert.equal(conserve.refreshSeconds,180);

  const disabled=build({
    plan:'PRO',
    runtime:{expandedDataEnabled:false},
  }).publicDataCapabilities();
  assert.equal(disabled.features.playerStats,false);
  assert.equal(disabled.features.lineupsFallback,false);
});

test('security lockdown disables live and enrichment even if other controls remain enabled',()=>{
  const caps=build({
    plan:'PRO',
    runtime:{
      securityLockdown:true,
      liveEnabled:true,
      expandedDataEnabled:true,
      message:'lockdown',
    },
  }).publicDataCapabilities();

  assert.equal(caps.label,'Security Lockdown');
  assert.equal(caps.note,'lockdown');
  assert.equal(caps.refreshSeconds,0);
  assert.equal(caps.features.liveRefresh,false);
  assert.equal(caps.features.lineupsFallback,false);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.features.injuries,false);
  assert.equal(caps.features.liveOdds,false);
  assert.equal(caps.features.oddsMovement,false);
});

test('maintenance remains explicit without inventing a security lockdown',()=>{
  const caps=build({
    runtime:{
      maintenanceMode:true,
      message:'maintenance',
    },
  }).publicDataCapabilities();

  assert.equal(caps.label,'Техническое обслуживание');
  assert.equal(caps.note,'maintenance');
});

test('malformed runtime, quota and budget values fail safely',()=>{
  const malformed=createAppCapabilitiesRuntime({
    memory:{provider:{plan:'PRO'}},
    appVersion:TEST_VERSION,
    minClientVersion:'5.8.0',
    apiContractVersion:5,
    releaseChannel:'rc144',
    releaseCandidate:'RC144',
    paidQuotaHealthy:()=> 'true',
    providerPublicBudgetMode:()=>({
      mode:'normal',
      label:'Норма',
      liveRefreshSeconds:'NaN',
    }),
    runtimeControlsSnapshot:()=>({
      liveEnabled:'false',
      expandedDataEnabled:'false',
      maintenanceMode:'true',
    }),
    isSecurityLockdownControls:()=>false,
    publicRuntimeControls:value=>({...value}),
    currentReleaseIdentity:()=>({deploySha:TEST_SHA}),
    now:()=>new Date('2026-10-05T11:00:00.000Z'),
  });

  const caps=malformed.publicDataCapabilities();
  assert.equal(caps.features.liveRefresh,false);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.refreshSeconds,0);

  assert.equal(
    malformed.appManifest({monetizationEnabled:'false'}).monetization,
    'paused',
  );
  assert.equal(
    malformed.appManifest({monetizationEnabled:'true'}).monetization,
    'paused',
  );
  assert.equal(malformed.appManifest({monetizationEnabled:false}).maintenance,false);
});

test('budget refresh seconds are clamped to a bounded public value',()=>{
  assert.equal(
    build({budget:{mode:'normal',label:'Норма',liveRefreshSeconds:-50}})
      .publicDataCapabilities()
      .refreshSeconds,
    0,
  );
  assert.equal(
    build({budget:{mode:'normal',label:'Норма',liveRefreshSeconds:999999}})
      .publicDataCapabilities()
      .refreshSeconds,
    3600,
  );
});

test('missing runtime object fails closed instead of crashing public capabilities',()=>{
  const runtime=build({
    plan:'PRO',
    overrides:{
      runtimeControlsSnapshot:()=>null,
      providerPublicBudgetMode:()=>null,
    },
  });

  const caps=runtime.publicDataCapabilities();
  assert.equal(caps.refreshSeconds,0);
  assert.equal(caps.features.liveRefresh,false);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.label,'Техническое обслуживание');
  assert.match(caps.note,/временно недоступны/);

  const manifest=runtime.appManifest();
  assert.equal(manifest.maintenance,true);
  assert.equal(manifest.monetization,'paused');
});

test('public capabilities fail soft when injected operational helpers throw',()=>{
  const runtime=build({
    plan:'PRO',
    overrides:{
      paidQuotaHealthy:()=>{ throw new Error('quota probe failed'); },
      providerPublicBudgetMode:()=>{ throw new Error('budget failed'); },
      runtimeControlsSnapshot:()=>{ throw new Error('runtime failed'); },
      publicRuntimeControls:()=>{ throw new Error('public controls failed'); },
      currentReleaseIdentity:()=>{ throw new Error('identity failed'); },
      now:()=>{ throw new Error('clock failed'); },
    },
  });

  assert.doesNotThrow(()=>runtime.publicDataCapabilities());
  const caps=runtime.publicDataCapabilities();
  assert.equal(caps.features.liveRefresh,false);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.refreshSeconds,0);
  assert.deepEqual(caps.runtime,{});

  assert.doesNotThrow(()=>runtime.appManifest());
  const manifest=runtime.appManifest();
  assert.equal(manifest.maintenance,true);
  assert.deepEqual(manifest.runtime,{});
  assert.deepEqual(manifest.deployment,{});
  assert.equal(manifest.serverTime,null);
});

test('security-lockdown predicate failure itself is fail-closed',()=>{
  const runtime=build({
    plan:'PRO',
    overrides:{
      isSecurityLockdownControls:()=>{ throw new Error('lockdown probe failed'); },
    },
  });

  const caps=runtime.publicDataCapabilities();
  assert.equal(caps.label,'Security Lockdown');
  assert.equal(caps.refreshSeconds,0);
  assert.equal(caps.features.liveRefresh,false);
  assert.equal(caps.features.playerStats,false);
});

test('public runtime sanitizer boundary prevents private runtime fields from leaking',()=>{
  const runtime=build({
    runtime:{
      message:'public message',
      internalSecret:'do-not-publish',
      adminReason:'private',
    },
  });

  const caps=runtime.publicDataCapabilities();
  assert.deepEqual(caps.runtime,{
    maintenanceMode:false,
    liveEnabled:true,
    expandedDataEnabled:true,
    securityLockdown:false,
    message:'public message',
  });
  assert.equal('internalSecret' in caps.runtime,false);
  assert.equal('adminReason' in caps.runtime,false);

  const manifest=runtime.appManifest();
  assert.equal('internalSecret' in manifest.runtime,false);
  assert.equal('adminReason' in manifest.runtime,false);
});

test('app manifest preserves compatibility, deployment and strict monetization semantics',()=>{
  const runtime=build();

  const paused=runtime.appManifest({monetizationEnabled:false});
  assert.equal(paused.ok,true);
  assert.equal(paused.version,TEST_VERSION);
  assert.equal(paused.recommendedClientVersion,TEST_VERSION);
  assert.equal(paused.apiContract,5);
  assert.equal(paused.releaseCandidate,'RC144');
  assert.equal(paused.monetization,'paused');
  assert.equal(paused.compatibility.contractRequired,5);
  assert.equal(paused.features.runtimeControls,true);
  assert.equal(paused.features.aiAnalysisQualityGate,true);
  assert.equal(paused.deployment.deploySha,TEST_SHA);
  assert.equal(paused.serverTime,'2026-10-05T11:00:00.000Z');

  const enabled=runtime.appManifest({monetizationEnabled:true});
  assert.equal(enabled.monetization,'enabled');

  const stringTrue=runtime.appManifest({monetizationEnabled:'true'});
  assert.equal(stringTrue.monetization,'paused');
});

test('invalid deployment identity and clock values do not break the manifest',()=>{
  const runtime=build({
    overrides:{
      currentReleaseIdentity:()=>[],
      now:()=> 'not-a-date',
    },
  });

  const manifest=runtime.appManifest();
  assert.deepEqual(manifest.deployment,{});
  assert.equal(manifest.serverTime,null);
});

test('runtime factory validates required boundaries and returns a frozen public surface',()=>{
  assert.throws(
    ()=>createAppCapabilitiesRuntime({}),
    /memory is required/,
  );

  const runtime=build();
  assert.equal(Object.isFrozen(runtime),true);
  assert.deepEqual(
    Object.keys(runtime).sort(),
    ['appManifest','publicDataCapabilities'],
  );
});
