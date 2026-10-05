import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicStatusRuntime, createPublicStatusRouter } from '../src/public-status.js';

function runtime(overrides = {}) {
  let now=1_000;
  const evidence=[];
  const controls=overrides.controls || {
    maintenanceMode:false,
    analysisEnabled:true,
    searchEnabled:true,
    liveEnabled:true,
    message:'',
  };
  const composite=overrides.composite || {
    valid:true,
    ok:true,
    connectivity:{ok:true,status:'ok',attempts:1},
    schema:{ok:true,status:'ok',contractVersion:2,fingerprint:{fingerprint:'actual',expected:'expected'}},
    backendSecurity:{ok:true,status:'ok'},
    authFailures:{available:true,count:0},
  };

  const api=createPublicStatusRuntime({
    loadRuntimeControls:async()=>({value:controls}),
    publicRuntimeControls:value=>value,
    providerCooldownUntil:()=>Number(overrides.providerCooldownUntil || 0),
    currentReleaseIdentity:()=>({deploySha:'release-sha'}),
    readCompositeReadiness:async(_cfg,windowMinutes)=>{
      assert.equal(windowMinutes,5);
      now+=7;
      return composite;
    },
    scheduleReleaseFieldEvidence:cfg=>evidence.push(cfg),
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    expectedSchemaContractVersion:2,
    expectedSchemaFingerprint:'primary',
    now:()=>now,
  });
  return {api,evidence,setNow:value=>{now=value;}};
}

test('Issue #490 public service status preserves operational/degraded/maintenance semantics',async()=>{
  const operational=runtime();
  const value=await operational.api.serviceStatus({
    botToken:'bot',
    webhookSecret:'hook',
    apiFootballKey:'football',
    tavilyKey:'news',
  });
  assert.equal(value.status,'operational');
  assert.equal(value.ok,true);
  assert.equal(value.services.telegram,'operational');
  assert.equal(value.services.aiAnalysis,'operational');
  assert.equal(value.services.news,'operational');
  assert.equal('deployment' in value,false);

  const degraded=runtime({providerCooldownUntil:2_000});
  assert.equal((await degraded.api.serviceStatus({apiFootballKey:'football'})).status,'degraded');

  const maintenance=runtime({controls:{
    maintenanceMode:true,
    analysisEnabled:false,
    searchEnabled:false,
    liveEnabled:false,
    message:'maintenance',
  }});
  const maintenanceValue=await maintenance.api.serviceStatus({});
  assert.equal(maintenanceValue.status,'maintenance');
  assert.equal(maintenanceValue.ok,false);
  assert.equal(maintenanceValue.services.aiAnalysis,'paused');
  assert.equal(maintenanceValue.notice,'maintenance');
});

test('public service status fails safe on malformed cooldown, config and runtime values',async()=>{
  const malformed=runtime({
    providerCooldownUntil:true,
    controls:{
      maintenanceMode:'false',
      analysisEnabled:'true',
      searchEnabled:true,
      liveEnabled:false,
      message:{internal:'do not expose'},
    },
  });
  const value=await malformed.api.serviceStatus({
    botToken:{secret:true},
    webhookSecret:'hook',
    apiFootballKey:['football'],
    tavilyKey:true,
  });
  assert.equal(value.status,'degraded');
  assert.equal(value.services.telegram,'configuration_required');
  assert.equal(value.services.aiAnalysis,'paused');
  assert.equal(value.services.search,'configuration_required');
  assert.equal(value.services.live,'paused');
  assert.equal(value.services.news,'limited');
  assert.equal(value.notice,'');
  assert.equal('deployment' in value,false);
});

test('Issue #490 readiness builder preserves internal contract before public sanitization',async()=>{
  const rt=runtime();
  const cfg={botToken:'bot',webhookSecret:'hook'};
  const value=await rt.api.computeReadinessSnapshot(cfg);

  assert.equal(value.ok,true);
  assert.equal(value.status,'ready');
  assert.equal(value.version,'6.120.0-rc144');
  assert.equal(value.releaseCandidate,'RC144');
  assert.deepEqual(value.deployment,{deploySha:'release-sha'});
  assert.equal(value.checks.supabase.ok,true);
  assert.equal(value.checks.schema.contractVersion,2);
  assert.equal(value.checks.schema.expectedContractVersion,2);
  assert.equal(value.checks.schema.primaryExpectedFingerprint,'primary');
  assert.equal(value.checks.telegramConfigured,true);
  assert.equal(value.checks.recentSupabaseAuthFailures,0);
  assert.equal(rt.evidence.length,1);
  assert.equal(rt.evidence[0],cfg);
});

test('readiness uses strict booleans and bounded numeric fields',async()=>{
  const rt=runtime({composite:{
    valid:'true',
    ok:'true',
    connectivity:{ok:'true',status:{value:'ok'},attempts:true},
    schema:{ok:1,status:'ok',contractVersion:true,fingerprint:{fingerprint:{secret:true},expected:['expected']}},
    backendSecurity:{ok:'true',status:'ok'},
    authFailures:{available:'true',count:true},
  }});
  const value=await rt.api.computeReadinessSnapshot({
    botToken:{secret:true},
    webhookSecret:'hook',
  });
  assert.equal(value.ok,false);
  assert.equal(value.checks.telegramConfigured,false);
  assert.equal(value.checks.supabase.ok,false);
  assert.equal(value.checks.supabase.status,'unknown');
  assert.equal(value.checks.supabase.attempts,1);
  assert.equal(value.checks.schema.ok,false);
  assert.equal(value.checks.schema.contractVersion,0);
  assert.equal(value.checks.schema.fingerprint,'');
  assert.equal(value.checks.recentSupabaseAuthFailures,null);
});

test('release-field evidence failure does not make readiness unavailable',async()=>{
  const base=runtime();
  const api=createPublicStatusRuntime({
    loadRuntimeControls:async()=>({value:{maintenanceMode:false,analysisEnabled:true,searchEnabled:true,liveEnabled:true}}),
    publicRuntimeControls:value=>value,
    providerCooldownUntil:()=>0,
    currentReleaseIdentity:()=>({deploySha:'release-sha'}),
    readCompositeReadiness:async()=>({
      valid:true,
      ok:true,
      connectivity:{ok:true,status:'ok',attempts:1},
      schema:{ok:true,status:'ok',contractVersion:2},
      backendSecurity:{ok:true,status:'ok'},
      authFailures:{available:true,count:0},
    }),
    scheduleReleaseFieldEvidence:()=>{ throw new Error('evidence unavailable'); },
    now:()=>1000,
  });
  const value=await api.computeReadinessSnapshot({botToken:'bot',webhookSecret:'hook'});
  assert.equal(value.ok,true);
  assert.equal(base.evidence.length,0);
});

test('Issue #490 readiness fails closed when Telegram or composite readiness is not ready',async()=>{
  const missingTelegram=runtime();
  assert.equal((await missingTelegram.api.computeReadinessSnapshot({})).ok,false);

  const compositeFailure=runtime({composite:{
    valid:true,
    ok:false,
    connectivity:{ok:false,status:'network_error',attempts:2},
    schema:{ok:false,status:'unknown'},
    backendSecurity:{ok:false,status:'unknown'},
    authFailures:{available:false,count:0},
  }});
  const value=await compositeFailure.api.computeReadinessSnapshot({botToken:'bot',webhookSecret:'hook'});
  assert.equal(value.ok,false);
  assert.equal(value.status,'not_ready');
  assert.equal(value.checks.supabase.attempts,2);
  assert.equal(value.checks.recentSupabaseAuthFailures,null);
});

test('public router only serves status surfaces to read methods and fails closed on malformed readiness flags',async()=>{
  const router=createPublicStatusRouter({
    publicStatusRuntime:{serviceStatus:async()=>({ok:true,status:'operational'})},
    publicHealthRuntime:{
      liveSnapshot:()=>({ok:true,status:'alive'}),
      readinessSnapshot:async()=>({ok:'true',status:'ready'}),
      healthSnapshot:async()=>({ok:'true',status:'ready'}),
    },
    appManifest:()=>({version:'manifest'}),
    loadRuntimeControls:async()=>({schemaReady:'true',value:{revision:4},source:{internal:'supabase'}}),
    publicRuntimeControls:value=>value,
    runtimeControlsCacheMs:true,
    json:(body,status=200,headers={})=>({body,status,headers}),
  });

  assert.equal(await router.handle({method:'POST'},{pathname:'/health/live'},{}),null);
  assert.equal(await router.handle({method:true},{pathname:'/api/public-status'},{}),null);

  const ready=await router.handle({method:'GET'},{pathname:'/health/ready'},{});
  assert.equal(ready.status,503);
  const health=await router.handle({method:'HEAD'},{pathname:'/health'},{});
  assert.equal(health.status,503);

  const status=await router.handle({method:'GET'},{pathname:'/api/runtime-status'},{});
  assert.equal(status.body.available,false);
  assert.equal(status.body.source,'unknown');
  assert.equal(status.body.cacheSeconds,0);
});

test('Issue #490 public router preserves manifest, runtime-status and retired Supabase probe behavior',async()=>{
  const calls=[];
  const router=createPublicStatusRouter({
    publicStatusRuntime:{serviceStatus:async()=>({ok:true,status:'operational'})},
    publicHealthRuntime:{
      liveSnapshot:()=>({ok:true,status:'alive'}),
      readinessSnapshot:async()=>({ok:true,status:'ready'}),
      healthSnapshot:async()=>({ok:true,status:'ready'}),
    },
    appManifest:cfg=>({version:cfg.version}),
    loadRuntimeControls:async cfg=>{
      calls.push(cfg);
      return {schemaReady:true,value:{revision:9},source:'supabase'};
    },
    publicRuntimeControls:value=>({revision:value.revision}),
    runtimeControlsCacheMs:30_000,
    json:(body,status=200,headers={})=>({body,status,headers}),
  });

  const manifest=await router.handle({method:'GET'},{pathname:'/api/app-manifest'},{version:'manifest'});
  assert.deepEqual(manifest.body,{version:'manifest'});
  const status=await router.handle({method:'GET'},{pathname:'/api/runtime-status'},{});
  assert.equal(status.body.available,true);
  assert.equal(status.body.runtime.revision,9);
  assert.equal(status.body.cacheSeconds,30);
  const retired=await router.handle({method:'GET'},{pathname:'/health/supabase'},{});
  assert.equal(retired.status,404);
  assert.equal(retired.body.code,'ADMIN_DIAGNOSTICS_ONLY');
  assert.equal(calls.length,2);
});
