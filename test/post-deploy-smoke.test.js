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

test('post-deploy smoke accepts missing runtime tag only when the immutable Cloudflare Version ID is pre-verified',async()=>{
  const runtimeWithoutTag={
    ...deploymentIdentity,
    deploySha:null,
    cloudflareVersionTag:null,
  };
  const result=await runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
    fetchImpl:healthyFetch({deployment:runtimeWithoutTag}),
    expectedVersionId:deploymentIdentity.cloudflareVersionId,
    retries:1,
    retryDelayMs:0,
  });
  assert.equal(result.ok,true);

  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:healthyFetch({deployment:runtimeWithoutTag}),
      retries:1,
      retryDelayMs:0,
    }),
    /no verified Cloudflare Version ID was supplied/,
  );
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:healthyFetch({deployment:runtimeWithoutTag}),
      expectedVersionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      retries:1,
      retryDelayMs:0,
    }),
    /Version ID does not match/,
  );
});

test('post-deploy smoke never masks a present but malformed runtime tag with the Version ID fallback',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:healthyFetch({
        deployment:{
          ...deploymentIdentity,
          deploySha:null,
          cloudflareVersionTag:'not-a-sha',
        },
      }),
      expectedVersionId:deploymentIdentity.cloudflareVersionId,
      retries:1,
      retryDelayMs:0,
    }),
    /RELEASE_IDENTITY_DEPLOY_SHA_REQUIRED/,
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


function withRouteResponse(route, respond) {
  const fallback=healthyFetch();
  return async (input, options)=>{
    if(new URL(input).pathname===route) return respond(input, options);
    return fallback(input, options);
  };
}

function withJsonMutation(route, mutate) {
  const fallback=healthyFetch();
  return async (input, options)=>{
    const response=await fallback(input, options);
    if(new URL(input).pathname!==route) return response;
    return json(mutate(await response.json()),response.status);
  };
}

test('post-deploy smoke fails closed on every required readiness dependency',async()=>{
  const failures=[
    ['supabase',body=>{body.checks.supabase.ok=false;},/Readiness Supabase probe failed/],
    ['schema',body=>{body.checks.schema.ok=false;},/Readiness schema fingerprint failed/],
    ['backendSecurity',body=>{body.checks.backendSecurity.ok=false;},/Readiness backend security contract failed/],
    ['telegramConfigured',body=>{body.checks.telegramConfigured=false;},/Readiness Telegram configuration failed/],
    ['releaseCandidate',body=>{body.releaseCandidate='RC999';},/Expected RC35, received RC999/],
  ];
  for(const [dependency,mutate,pattern] of failures) {
    await assert.rejects(
      runDeploymentSmoke('https://football.example.test',VERSION,{
        fetchImpl:withJsonMutation('/health/ready',body=>{
          mutate(body);
          return body;
        }),
        retries:1,
        retryDelayMs:0,
      }),
      pattern,
      'Readiness regression: '+dependency,
    );
  }
});

test('post-deploy smoke rejects unexpected public access to protected endpoints',async()=>{
  const protectedPaths=[
    '/api/me',
    '/api/release-readiness',
    '/api/calibration-control',
    '/api/launch-funnel',
    '/api/admin/channel-publisher/test',
  ];
  for(const route of protectedPaths) {
    await assert.rejects(
      runDeploymentSmoke('https://football.example.test',VERSION,{
        fetchImpl:withRouteResponse(route,()=>json({ok:true})),
        retries:1,
        retryDelayMs:0,
      }),
      error => error?.message?.includes(route)
        && error.message.includes('HTTP 401'),
      'Unauthenticated endpoint must not be exposed: '+route,
    );
  }
});

test('post-deploy smoke blocks exposure of internal database health and webhook without a secret',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:withRouteResponse('/health/supabase',()=>json({ok:true})),
      retries:1,
      retryDelayMs:0,
    }),
    /\/health\/supabase must remain unavailable publicly/,
  );
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:withRouteResponse('/telegram/webhook',()=>json({ok:true})),
      retries:1,
      retryDelayMs:0,
    }),
    /Telegram webhook must reject a request without its secret with HTTP 403/,
  );
});

test('post-deploy smoke rejects an application shell with weakened security headers',async()=>{
  const goodHtml='<!doctype html>';
  for(const [name,headers,expected] of [
    ['missing CSP',{
      'content-type':'text/html',
      'x-content-type-options':'nosniff',
    },/required Content-Security-Policy/],
    ['weak CSP',{
      'content-type':'text/html',
      'content-security-policy':"default-src 'self'; script-src 'self' https://telegram.org",
      'x-content-type-options':'nosniff',
    },/required Content-Security-Policy/],
    ['missing nosniff',{
      'content-type':'text/html',
      'content-security-policy':"default-src 'self'; script-src 'self' https://telegram.org; object-src 'none'",
    },/X-Content-Type-Options: nosniff/],
  ]) {
    await assert.rejects(
      runDeploymentSmoke('https://football.example.test',VERSION,{
        fetchImpl:withRouteResponse('/',()=>new Response(goodHtml,{status:200,headers})),
        retries:1,
        retryDelayMs:0,
      }),
      expected,
      'Unsafe shell accepted: '+name,
    );
  }
});

test('post-deploy smoke validates static legal pages and public status script MIME',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:withRouteResponse('/privacy.html',()=>new Response('<!doctype html>',{
        status:200,
        headers:{'content-type':'text/html'},
      })),
      retries:1,
      retryDelayMs:0,
    }),
    /\/privacy\.html is missing the static security policy/,
  );
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:withRouteResponse('/status.js',()=>new Response('export {};',{
        status:200,
        headers:{'content-type':'text/html'},
      })),
      retries:1,
      retryDelayMs:0,
    }),
    /\/status\.js must be a public JavaScript asset/,
  );
});

test('post-deploy smoke rejects malformed manifest responses and non-boolean capabilities',async()=>{
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:withRouteResponse('/api/app-manifest',()=>new Response('invalid-json',{
        status:200,
        headers:{'content-type':'application/json'},
      })),
      retries:1,
      retryDelayMs:0,
    }),
    /App manifest returned invalid JSON/,
  );
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,{
      fetchImpl:healthyFetch({featureOverrides:{aiFreshnessGuard:'true'}}),
      retries:1,
      retryDelayMs:0,
    }),
    /App manifest feature aiFreshnessGuard is not enabled/,
  );
});

test('post-deploy smoke verifies every public service is operational',async()=>{
  for(const service of ['telegram','miniApp','aiAnalysis','search','live']) {
    await assert.rejects(
      runDeploymentSmoke('https://football.example.test',VERSION,{
        fetchImpl:healthyFetch({serviceOverrides:{[service]:'configuration_required'}}),
        retries:1,
        retryDelayMs:0,
      }),
      new RegExp('Public status service '+service+' must be operational'),
      'Non-operational service incorrectly passed: '+service,
    );
  }
});

test('post-deploy smoke uses non-following, uncached requests with explicit webhook POST',async()=>{
  const seen=[];
  const fallback=healthyFetch();
  const fetchImpl=async (input,options)=>{
    seen.push({
      path:new URL(input).pathname,
      method:options.method,
      redirect:options.redirect,
      cacheControl:options.headers?.['cache-control'],
      hasSignal:options.signal instanceof AbortSignal,
      body:options.body,
    });
    return fallback(input,options);
  };
  const result=await runDeploymentSmoke('https://football.example.test',VERSION,{
    fetchImpl,
    retries:1,
    retryDelayMs:0,
  });
  assert.equal(result.ok,true);
  assert.ok(seen.length>=15);
  for(const request of seen) {
    assert.equal(request.redirect,'manual','Redirects must never be silently followed');
    assert.equal(request.cacheControl,'no-cache','Smoke must not reuse stale cached responses');
    assert.equal(request.hasSignal,true,'Every request must be abortable');
  }
  const webhook=seen.find(request=>request.path==='/telegram/webhook');
  assert.equal(webhook?.method,'POST');
  assert.equal(webhook?.body,'{}');
  assert.ok(seen.filter(request=>request.path==='/health/ready').length>=1);
});


test('post-deploy smoke permits only Cloudflare same-origin 307 canonical redirects for public HTML', async () => {
  const fallback=healthyFetch();
  const seen=[];
  const fetchImpl=async (input,options)=>{
    const path=new URL(input).pathname;
    seen.push({path,redirect:options.redirect});
    if(['/privacy.html','/terms.html','/status.html'].includes(path)) {
      return new Response(null,{status:307,headers:{location:path.slice(0,-5)}});
    }
    if(['/privacy','/terms','/status'].includes(path)) {
      return new Response('<!doctype html>',{status:200,headers:{
        'content-type':'text/html; charset=utf-8',
        'content-security-policy':"default-src 'self'; object-src 'none'",
      }});
    }
    return fallback(input,options);
  };
  const result=await runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
    fetchImpl,retries:1,retryDelayMs:0,
  });
  assert.equal(result.ok,true);
  for(const path of ['/privacy','/terms','/status']) {
    assert.ok(seen.some(item=>item.path===path));
  }
  assert.ok(seen.every(item=>item.redirect==='manual'));
});

test('post-deploy smoke rejects external, unexpected, and unsafe canonical HTML redirects', async () => {
  for(const location of ['https://external.example/privacy','/admin','/privacy?secret=true','/privacy#jump']) {
    await assert.rejects(
      runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
        fetchImpl:withRouteResponse('/privacy.html',()=>new Response(null,{status:307,headers:{location}})),
        retries:1,retryDelayMs:0,
      }),
      /outside its expected same-origin canonical HTML path/,
      'Unsafe redirect accepted: '+location,
    );
  }
  await assert.rejects(
    runDeploymentSmoke('https://football.example.test',VERSION,DEPLOY_SHA,{
      fetchImpl:withRouteResponse('/privacy.html',()=>new Response(null,{status:307,headers:{location:'/privacy'}})),
      retries:1,retryDelayMs:0,
    }),
    /privacy\.html must be a public HTML page/,
    'Canonical destination must still be a real HTML asset.',
  );
});
