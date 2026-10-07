import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeploymentSmoke } from '../scripts/post-deploy-smoke.js';

const VERSION='6.27.0-rc35';
const RC='RC35';
const DEPLOY_SHA='0123456789abcdef0123456789abcdef01234567';
const deploymentIdentity={
  deploySha:DEPLOY_SHA,
  cloudflareVersionId:'11111111-2222-3333-4444-555555555555',
  cloudflareVersionTag:DEPLOY_SHA,
  cloudflareVersionTimestamp:'2026-09-29T12:36:17.000Z',
};

const REQUIRED_FEATURES=[
  'startupSafety',
  'rollbackSafety',
  'productionMonitor',
  'rollbackVerification',
  'providerDataReliability',
  'aiAnalysisQualityGate',
  'telegramMiniAppE2E',
  'telegramWebhookPersistentDedupe',
  'supabaseProbeConfirmation',
  'supabaseSchemaProbeConfirmation',
  'cloudflareEdgeRateLimits',
  'aiFreshnessGuard',
  'preKickoffRecheck',
  'preKickoffChangeDetection',
  'analysisDeltaSummary',
];

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{'content-type':'application/json'},
});

function manifestFeatures(overrides={}) {
  return Object.fromEntries(REQUIRED_FEATURES.map(name=>[name,true]).concat(Object.entries(overrides)));
}

function healthyFetch({
  staleReadyOnce=false,
  devMode=false,
  monetization='paused',
  deployment=deploymentIdentity,
  featureOverrides={},
  serviceOverrides={},
  healthStatus='ready',
}={}) {
  let readyCalls=0;
  return async input=>{
    const url=new URL(input);

    if(url.pathname==='/health/ready'){
      readyCalls+=1;
      const version=staleReadyOnce && readyCalls===1 ? '6.26.0-rc34' : VERSION;
      return json({
        ok:true,
        status:'ready',
        version,
        releaseCandidate:RC,
        checks:{
          supabase:{ok:true,status:'ok'},
          schema:{ok:true,status:'ok'},
          backendSecurity:{ok:true,status:'ok'},
          telegramConfigured:true,
        },
      });
    }

    if(url.pathname==='/health'){
      return json({
        ok:healthStatus==='ready',
        status:healthStatus,
        version:VERSION,
        releaseCandidate:RC,
        devMode,
        readiness:{ok:healthStatus==='ready',status:healthStatus},
      },healthStatus==='ready'?200:503);
    }

    if(url.pathname==='/api/app-manifest'){
      return json({
        version:VERSION,
        releaseCandidate:RC,
        deployment,
        monetization,
        features:manifestFeatures(featureOverrides),
      });
    }

    if(url.pathname==='/api/public-status'){
      return json({
        ok:true,
        status:'operational',
        version:VERSION,
        releaseCandidate:RC,
        services:{
          telegram:'operational',
          miniApp:'operational',
          aiAnalysis:'operational',
          search:'operational',
          live:'operational',
          ...serviceOverrides,
        },
      });
    }

    if(url.pathname==='/'){
      return new Response('<!doctype html>',{
        status:200,
        headers:{
          'content-type':'text/html; charset=UTF-8',
          'content-security-policy':"default-src 'self'; script-src 'self' https://telegram.org; object-src 'none'",
          'x-content-type-options':'nosniff',
        },
      });
    }

    if(['/privacy.html','/terms.html','/status.html'].includes(url.pathname)){
      return new Response('<!doctype html>',{
        status:200,
        headers:{
          'content-type':'text/html; charset=UTF-8',
          'content-security-policy':"default-src 'self'; object-src 'none'",
        },
      });
    }

    if(url.pathname==='/status.js'){
      return new Response('export {};',{
        status:200,
        headers:{'content-type':'text/javascript; charset=UTF-8'},
      });
    }

    if(url.pathname==='/telegram/webhook') return json({ok:false},403);
    if(url.pathname==='/health/supabase') return json({error:'not found'},404);
    if(url.pathname.startsWith('/api/')) return json({error:'Telegram auth required'},401);
    return json({error:'not found'},404);
  };
}

test('post-deploy smoke validates the minimal public health contract and current manifest capabilities',async()=>{
  const result=await runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
    fetchImpl:healthyFetch(),
    retries:1,
    retryDelayMs:0,
  });

  assert.equal(result.ok,true);
  assert.equal(result.version,VERSION);
  assert.equal(result.releaseCandidate,RC);
  assert.equal(result.checks,25);
});

test('public health/readiness/status do not need deployment identity when manifest carries the verified revision',async()=>{
  const fetchImpl=healthyFetch();
  const seen=[];
  const wrapped=async input=>{
    const response=await fetchImpl(input);
    const path=new URL(input).pathname;
    if(['/health/ready','/health','/api/public-status'].includes(path)){
      const body=await response.json();
      seen.push({path,hasDeployment:Object.hasOwn(body,'deployment')});
      return json(body,response.status);
    }
    return response;
  };

  const result=await runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
    fetchImpl:wrapped,
    retries:1,
    retryDelayMs:0,
  });

  assert.equal(result.ok,true);
  assert.deepEqual(seen,[
    {path:'/health/ready',hasDeployment:false},
    {path:'/health',hasDeployment:false},
    {path:'/api/public-status',hasDeployment:false},
  ]);
});

test('post-deploy smoke binds exact deployment SHA to the app manifest',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',{
      fetchImpl:healthyFetch(),
      retries:1,
      retryDelayMs:0,
    }),
    /deploy SHA does not match/,
  );
});

test('post-deploy smoke rejects malformed release identity from the app manifest',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:healthyFetch({
        deployment:{...deploymentIdentity,cloudflareVersionId:'not-a-version-id'},
      }),
      retries:1,
      retryDelayMs:0,
    }),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_INVALID/,
  );

  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:healthyFetch({
        deployment:{...deploymentIdentity,cloudflareVersionTimestamp:'2099-01-01T00:00:00.000Z'},
      }),
      retries:1,
      retryDelayMs:0,
    }),
    /RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW/,
  );
});

test('post-deploy smoke retries while an older readiness version is still propagating',async()=>{
  const result=await runDeploymentSmoke('https://football.example.test/',VERSION,{
    fetchImpl:healthyFetch({staleReadyOnce:true}),
    retries:2,
    retryDelayMs:0,
  });
  assert.equal(result.version,VERSION);
});

test('post-deploy smoke rejects DEV_MODE from minimal public health',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({devMode:true}),
      retries:1,
      retryDelayMs:0,
    }),
    /DEV_MODE=true/,
  );
});

test('post-deploy smoke validates monetization through app manifest instead of public health',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({monetization:'enabled'}),
      retries:1,
      retryDelayMs:0,
    }),
    /MONETIZATION_ENABLED=false/,
  );

  const enabled=await runDeploymentSmoke('https://football.example.test',VERSION,{
    fetchImpl:healthyFetch({monetization:'enabled'}),
    retries:1,
    retryDelayMs:0,
    expectedMonetization:'enabled',
  });
  assert.equal(enabled.ok,true);
});

test('post-deploy smoke requires the manifest freshness capability used by RC139',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({featureOverrides:{aiFreshnessGuard:false}}),
      retries:1,
      retryDelayMs:0,
    }),
    /App manifest feature aiFreshnessGuard is not enabled/,
  );
});

test('post-deploy smoke requires all API-Football-backed public services to be operational',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({serviceOverrides:{aiAnalysis:'configuration_required'}}),
      retries:1,
      retryDelayMs:0,
    }),
    /aiAnalysis must be operational/,
  );
});

test('post-deploy smoke rejects a non-ready health snapshot even when readiness was previously healthy',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({healthStatus:'not_ready'}),
      retries:1,
      retryDelayMs:0,
    }),
    /Health endpoint/,
  );
});
