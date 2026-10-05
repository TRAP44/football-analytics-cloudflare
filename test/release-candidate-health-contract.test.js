import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicHealthRuntime } from '../src/public-health.js';
import { createPublicStatusRouter } from '../src/public-status.js';

test('public status router delegates health routes without exposing internal readiness details',async()=>{
  const calls=[];
  const publicHealthRuntime={
    liveSnapshot:()=>({ok:true,status:'alive',version:'6.120.0-rc144',releaseCandidate:'RC144'}),
    readinessSnapshot:async()=>({ok:true,status:'ready',version:'6.120.0-rc144',releaseCandidate:'RC144'}),
    healthSnapshot:async()=>({ok:true,status:'ready',version:'6.120.0-rc144',releaseCandidate:'RC144',readiness:{ok:true,status:'ready'}}),
  };
  const router=createPublicStatusRouter({
    publicStatusRuntime:{serviceStatus:async()=>({ok:true,status:'operational'})},
    publicHealthRuntime,
    appManifest:()=>({version:'manifest'}),
    loadRuntimeControls:async()=>({schemaReady:true,value:{revision:4},source:'supabase'}),
    publicRuntimeControls:value=>({revision:value.revision}),
    runtimeControlsCacheMs:30000,
    json:(body,status=200,headers={})=>({body,status,headers}),
  });

  const live=await router.handle({method:'GET'},{pathname:'/health/live'},{});
  const ready=await router.handle({method:'GET'},{pathname:'/health/ready'},{});
  const health=await router.handle({method:'GET'},{pathname:'/health'},{});
  calls.push(live,ready,health);

  assert.deepEqual(calls.map(row=>row.status),[200,200,200]);
  assert.equal(live.headers['cache-control'],'no-store');
  assert.equal(ready.headers['cache-control'],'no-store');
  assert.deepEqual(live.body,{ok:true,status:'alive'});
  assert.deepEqual(ready.body,{ok:true,status:'ready'});
  assert.deepEqual(health.body,{ok:true});
  assert.equal(await router.handle({method:'GET'},{pathname:'/unknown'},{}),null);
});

test('public health runtime can retain sanitized metadata while router keeps it private',async()=>{
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
