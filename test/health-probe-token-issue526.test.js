import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicStatusRouter } from '../src/public-status.js';

const json=(body,status=200,headers={})=>({body,status,headers});

function buildRouter() {
  return createPublicStatusRouter({
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
          schema:{ok:true,status:'ok',fingerprint:'secret-fingerprint'},
          backendSecurity:{ok:true,status:'ok'},
          telegramConfigured:true,
          recentSupabaseAuthFailures:0,
        },
      }),
    },
    publicHealthRuntime:{
      liveSnapshot:()=>({ok:true,status:'alive',version:'6.120.0-rc144'}),
      readinessSnapshot:async()=>({ok:true,status:'ready',version:'6.120.0-rc144',checks:{supabase:{ok:true}}}),
      healthSnapshot:async()=>({ok:true,status:'ready',version:'6.120.0-rc144',devMode:false}),
    },
    appManifest:()=>({
      monetization:'paused',
      deployment:{deploySha:'a'.repeat(40)},
      features:{rollbackSafety:true},
    }),
    loadRuntimeControls:async()=>({schemaReady:true,value:{revision:1},source:'supabase'}),
    publicRuntimeControls:value=>value,
    runtimeControlsCacheMs:30000,
    json,
  });
}

const cfg={
  healthProbeToken:'probe-secret',
  supabaseUrl:'https://example.supabase.co',
  supabaseKey:'service-key',
  monetizationEnabled:false,
  devMode:false,
};

test('public health endpoints expose only minimal availability state',async()=>{
  const router=buildRouter();

  const health=await router.handle(new Request('https://example.test/health'),new URL('https://example.test/health'),cfg);
  assert.deepEqual(health.body,{ok:true});
  assert.equal('version' in health.body,false);

  const ready=await router.handle(new Request('https://example.test/health/ready'),new URL('https://example.test/health/ready'),cfg);
  assert.deepEqual(ready.body,{ok:true,status:'ready'});
  assert.equal('checks' in ready.body,false);
  assert.equal('version' in ready.body,false);

  const live=await router.handle(new Request('https://example.test/health/live'),new URL('https://example.test/health/live'),cfg);
  assert.deepEqual(live.body,{ok:true,status:'alive'});
  assert.equal('version' in live.body,false);
});

test('valid X-Health-Token unlocks detailed deployment diagnostics',async()=>{
  const router=buildRouter();
  const headers={'x-health-token':'probe-secret'};

  const readyRequest=new Request('https://example.test/health/ready',{headers});
  const ready=await router.handle(readyRequest,new URL(readyRequest.url),cfg);
  assert.equal(ready.body.version,'6.120.0-rc144');
  assert.equal(ready.body.checks.schema.fingerprint,'secret-fingerprint');
  assert.equal(ready.body.deployment.deploySha,'a'.repeat(40));

  const healthRequest=new Request('https://example.test/health',{headers});
  const health=await router.handle(healthRequest,new URL(healthRequest.url),cfg);
  assert.equal(health.body.version,'6.120.0-rc144');
  assert.equal(health.body.database,'supabase');
  assert.equal(health.body.monetization,'paused');
  assert.equal(health.body.devMode,false);
  assert.equal(health.body.readiness.checks.schema.fingerprint,'secret-fingerprint');
});

test('wrong health token remains on the public minimal contract',async()=>{
  const router=buildRouter();
  const request=new Request('https://example.test/health',{headers:{'x-health-token':'wrong'}});
  const result=await router.handle(request,new URL(request.url),cfg);
  assert.deepEqual(result.body,{ok:true});
});


test('authenticated health uses readiness result for both body and HTTP status',async()=>{
  const router=createPublicStatusRouter({
    publicStatusRuntime:{
      serviceStatus:async()=>({ok:true,status:'operational'}),
      computeReadinessSnapshot:async()=>({
        ok:false,
        status:'not_ready',
        version:'6.120.0-rc144',
        releaseCandidate:'RC144',
        deployment:{deploySha:'a'.repeat(40)},
        checks:{},
      }),
    },
    publicHealthRuntime:{
      liveSnapshot:()=>({ok:true,status:'alive'}),
      readinessSnapshot:async()=>({ok:true,status:'ready'}),
      healthSnapshot:async()=>({ok:true,status:'ready'}),
    },
    appManifest:()=>({monetization:'paused',deployment:{deploySha:'a'.repeat(40)},features:{}}),
    loadRuntimeControls:async()=>({schemaReady:true,value:{revision:1},source:'supabase'}),
    publicRuntimeControls:value=>value,
    runtimeControlsCacheMs:30000,
    json,
  });
  const request=new Request('https://example.test/health',{headers:{'x-health-token':'probe-secret'}});
  const result=await router.handle(request,new URL(request.url),cfg);
  assert.equal(result.status,503);
  assert.equal(result.body.ok,false);
  assert.equal(result.body.status,'not_ready');
});
