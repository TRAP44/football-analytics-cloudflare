import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';

function build({plan='FREE',runtime={},budget={mode:'normal',label:'Норма',liveRefreshSeconds:90},quotaHealthy=true}={}) {
  const state={
    maintenanceMode:false,
    liveEnabled:true,
    expandedDataEnabled:true,
    message:'',
    ...runtime,
  };
  return createAppCapabilitiesRuntime({
    memory:{provider:{plan}},
    appVersion:'6.120.0-rc144',
    minClientVersion:'5.8.0',
    apiContractVersion:5,
    releaseChannel:'rc144',
    releaseCandidate:'RC144',
    paidQuotaHealthy:()=>quotaHealthy,
    providerPublicBudgetMode:()=>budget,
    runtimeControlsSnapshot:()=>state,
    isSecurityLockdownControls:value=>Boolean(value?.securityLockdown),
    publicRuntimeControls:value=>value ? {...value} : {...state},
    currentReleaseIdentity:()=>({deploySha:'a'.repeat(40)}),
    now:()=>new Date('2026-10-05T11:00:00.000Z'),
  });
}

test('FREE public capabilities remain standard and quota-conscious',()=>{
  const caps=build().publicDataCapabilities();
  assert.equal(caps.mode,'standard');
  assert.equal(caps.features.events,true);
  assert.equal(caps.features.liveRefresh,true);
  assert.equal(caps.features.playerStats,false);
  assert.equal(caps.refreshSeconds,90);
  assert.match(caps.note,/экономит запросы/i);
});

test('paid capabilities enrich only when quota and runtime allow it',()=>{
  const paid=build({plan:'PRO'}).publicDataCapabilities();
  assert.equal(paid.mode,'expanded');
  assert.equal(paid.features.playerStats,true);
  assert.equal(paid.features.liveOdds,true);

  const conserve=build({plan:'PRO',budget:{mode:'conserve',label:'Экономия',liveRefreshSeconds:180}}).publicDataCapabilities();
  assert.equal(conserve.features.playerStats,false);
  assert.equal(conserve.features.liveOdds,false);

  const disabled=build({plan:'PRO',runtime:{expandedDataEnabled:false}}).publicDataCapabilities();
  assert.equal(disabled.features.playerStats,false);
});

test('security lockdown and maintenance remain explicit in the public capability contract',()=>{
  const lockdown=build({runtime:{securityLockdown:true,maintenanceMode:true,message:'lockdown'}}).publicDataCapabilities();
  assert.equal(lockdown.label,'Security Lockdown');
  assert.equal(lockdown.note,'lockdown');

  const maintenance=build({runtime:{maintenanceMode:true,message:'maintenance'}}).publicDataCapabilities();
  assert.equal(maintenance.label,'Техническое обслуживание');
  assert.equal(maintenance.note,'maintenance');
});

test('app manifest preserves compatibility and monetization flags through injected boundaries',()=>{
  const runtime=build();
  const paused=runtime.appManifest({monetizationEnabled:false});
  assert.equal(paused.version,'6.120.0-rc144');
  assert.equal(paused.apiContract,5);
  assert.equal(paused.releaseCandidate,'RC144');
  assert.equal(paused.monetization,'paused');
  assert.equal(paused.compatibility.contractRequired,5);
  assert.equal(paused.features.runtimeControls,true);
  assert.equal(paused.serverTime,'2026-10-05T11:00:00.000Z');

  const enabled=runtime.appManifest({monetizationEnabled:true});
  assert.equal(enabled.monetization,'enabled');
});
