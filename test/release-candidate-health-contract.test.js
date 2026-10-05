import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicHealthRuntime } from '../src/public-health.js';
import { createPublicStatusRouter } from '../src/public-status.js';

function requestWithToken(token='') {
  return {
    method:'GET',
    headers:{
      get(name) {
        return String(name || '').toLowerCase()==='x-health-token' ? token : '';
      },
    },
  };
}

test('public /health exposes only ok while valid probe token unlocks deployment diagnostics',async()=>{
  const publicHealthRuntime={
    liveSnapshot:()=>({ok:true,status:'alive',version:'6.120.0-rc144',releaseCandidate:'RC144'}),
    readinessSnapshot:async()=>({ok:true,status:'ready',version:'6.120.0-rc144',releaseCandidate:'RC144'}),
    healthSnapshot:async()=>({
      ok:true,
      status:'ready',
      version:'6.120.0-rc144',
      releaseCandidate:'RC144',
      devMode:false,
      readiness:{ok:true,status:'ready'},
    }),
  };
  const router=createPublicStatusRouter({
    publicStatusRuntime:{
      serviceStatus:async()=>({ok:true,status:'operational'}),
      computeReadinessSnapshot:async()=>({
        ok:true,
        status:'ready',
        version:'6.120.0-rc144',
        releaseCandidate:'RC144',
        deployment:{deploySha:'a'.repeat(40)},
        checks:{
          supabase:{ok:true,status:'ok'},
          schema:{ok:true,status:'ok',fingerprint:'fingerprint'},
          backendSecurity:{ok:true,status:'ok'},
          telegramConfigured:true,
          recentSupabaseAuthFailures:0,
        },
      }),
    },
    publicHealthRuntime,
    appManifest:()=>({
      version:'6.120.0-rc144',
      releaseCandidate:'RC144',
      monetization:'paused',
      deployment:{deploySha:'a'.repeat(40)},
      features:{productionMonitor:true,rollbackVerification:true},
    }),
    loadRuntimeControls:async()=>({schemaReady:true,value:{revision:4},source:'supabase'}),
    publicRuntimeControls:value=>({revision:value.revision}),
    runtimeControlsCacheMs:30000,
    json:(body,status=200,headers={})=>({body,status,headers}),
  });
  const cfg={
    healthProbeToken:'probe-secret',
    supabaseUrl:'https://example.supabase.co',
    supabaseKey:'service-role',
    monetizationEnabled:false,
  };

  const publicHealth=await router.handle(requestWithToken(),{pathname:'/health'},cfg);
  assert.deepEqual(publicHealth.body,{ok:true});
  assert.equal('devMode' in publicHealth.body,false);
  assert.equal('database' in publicHealth.body,false);
  assert.equal('deployment' in publicHealth.body,false);

  const wrongToken=await router.handle(requestWithToken('wrong'),{pathname:'/health'},cfg);
  assert.deepEqual(wrongToken.body,{ok:true});

  const detailed=await router.handle(requestWithToken('probe-secret'),{pathname:'/health'},cfg);
  assert.equal(detailed.body.ok,true);
  assert.equal(detailed.body.devMode,false);
  assert.equal(detailed.body.database,'supabase');
  assert.equal(detailed.body.monetization,'paused');
  assert.equal(detailed.body.deployment.deploySha,'a'.repeat(40));
  assert.equal(detailed.body.features.productionMonitor,true);
});

test('public live and readiness preserve version/release candidate without deployment internals',async()=>{
  const runtime=createPublicHealthRuntime({
    version:'6.120.0-rc144',
    releaseCandidate:'RC144',
    computeReadiness:async()=>({
      ok:true,
      status:'ready',
      version:'6.120.0-rc144',
      releaseCandidate:'RC144',
      deployment:{deploySha:'a'.repeat(40),cloudflareVersionId:'private-detail'},
      checks:{
        supabase:{ok:true,status:'ok'},
        schema:{ok:true,status:'ok',fingerprint:'hidden'},
        backendSecurity:{ok:true,status:'ok'},
        telegramConfigured:true,
      },
    }),
  });

  const live=runtime.liveSnapshot();
  assert.equal(live.version,'6.120.0-rc144');
  assert.equal(live.releaseCandidate,'RC144');
  assert.equal('deployment' in live,false);

  const ready=await runtime.readinessSnapshot({});
  assert.equal(ready.version,'6.120.0-rc144');
  assert.equal(ready.releaseCandidate,'RC144');
  assert.equal('deployment' in ready,false);
  assert.equal('fingerprint' in ready.checks.schema,false);
});
