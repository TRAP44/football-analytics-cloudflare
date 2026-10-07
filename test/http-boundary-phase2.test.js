import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpRuntime } from '../src/http.js';
import { createWorkerBootstrapRuntime } from '../src/worker-bootstrap-runtime.js';

const runtime=createHttpRuntime({
  appVersion:'6.120.0-rc144',
  apiContractVersion:5,
  minClientVersion:'5.8.0',
  releaseChannel:'rc144',
  personalWriteLimits:{favorites:25,reminders:20},
});

test('HTTP boundary preserves JSON metadata and restrictive security headers',async()=>{
  const response=runtime.json(
    {ok:true},
    201,
    {'x-test':'yes'},
  );

  assert.equal(response.status,201);
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
  );
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(
    response.headers.get('x-content-type-options'),
    'nosniff',
  );
  assert.equal(
    response.headers.get('content-security-policy'),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assert.equal(
    response.headers.get('x-app-version'),
    '6.120.0-rc144',
  );
  assert.equal(response.headers.get('x-api-contract'),'5');
  assert.equal(
    response.headers.get('x-min-client-version'),
    '5.8.0',
  );
  assert.equal(
    response.headers.get('x-release-channel'),
    'rc144',
  );
  assert.equal(
    response.headers.get('vary'),
    'x-telegram-init-data',
  );
  assert.equal(response.headers.get('x-test'),'yes');
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null,
  );
});

test('HTTP boundary prevents security, identity and CORS header overrides',()=>{
  const response=runtime.json({ok:true},200,{
    'Content-Type':'text/html',
    'Cache-Control':'public, max-age=3600',
    'X-Content-Type-Options':'off',
    'Content-Security-Policy':"default-src *",
    'Cross-Origin-Opener-Policy':'unsafe-none',
    'Cross-Origin-Resource-Policy':'cross-origin',
    'X-Frame-Options':'SAMEORIGIN',
    'X-App-Version':'spoofed',
    'X-Api-Contract':'999',
    'X-Min-Client-Version':'0',
    'X-Release-Channel':'evil',
    'Vary':'*',
    'Content-Length':'9999',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Credentials':'true',
    'Retry-After':'9',
    'X-Request-Id':'req-1',
  });

  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
  );
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(
    response.headers.get('content-security-policy'),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assert.equal(
    response.headers.get('cross-origin-opener-policy'),
    'same-origin',
  );
  assert.equal(
    response.headers.get('cross-origin-resource-policy'),
    'same-origin',
  );
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal(
    response.headers.get('x-app-version'),
    '6.120.0-rc144',
  );
  assert.equal(response.headers.get('x-api-contract'),'5');
  assert.equal(
    response.headers.get('x-min-client-version'),
    '5.8.0',
  );
  assert.equal(
    response.headers.get('x-release-channel'),
    'rc144',
  );
  assert.equal(
    response.headers.get('vary'),
    'x-telegram-init-data',
  );
  assert.equal(response.headers.get('content-length'),null);
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    null,
  );
  assert.equal(
    response.headers.get('access-control-allow-credentials'),
    null,
  );
  assert.equal(response.headers.get('retry-after'),'9');
  assert.equal(response.headers.get('x-request-id'),'req-1');
});

test('malformed extra headers fail soft without overriding the response boundary',()=>{
  const hostile={};
  Object.defineProperty(hostile,'x-hostile',{
    enumerable:true,
    get(){throw new Error('hostile header getter');},
  });
  Object.defineProperty(hostile,'x-good',{
    enumerable:true,
    value:'safe',
  });
  Object.defineProperty(hostile,'x-crlf',{
    enumerable:true,
    value:'bad\r\nheader',
  });

  assert.doesNotThrow(
    ()=>runtime.json({ok:true},200,hostile),
  );
  const response=runtime.json({ok:true},200,hostile);
  assert.equal(response.headers.get('x-good'),'safe');
  assert.equal(response.headers.get('x-hostile'),null);
  assert.equal(response.headers.get('x-crlf'),null);

  const proxy=new Proxy({},{
    ownKeys(){throw new Error('hostile ownKeys');},
  });
  assert.doesNotThrow(
    ()=>runtime.json({ok:true},200,proxy),
  );
});

test('JSON serialization and status failures return a safe 500 JSON response',async()=>{
  const cyclic={ok:true};
  cyclic.self=cyclic;
  const cycleResponse=runtime.json(cyclic,201);
  assert.equal(cycleResponse.status,500);
  assert.deepEqual(await cycleResponse.json(),{
    error:'Сервис временно недоступен.',
    code:'RESPONSE_SERIALIZATION_FAILED',
  });

  const hostile={};
  Object.defineProperty(hostile,'value',{
    enumerable:true,
    get(){throw new Error('hostile JSON getter');},
  });
  const hostileResponse=runtime.json(hostile,201);
  assert.equal(hostileResponse.status,500);
  assert.equal(
    (await hostileResponse.json()).code,
    'RESPONSE_SERIALIZATION_FAILED',
  );

  assert.equal(runtime.json({ok:true},'201').status,500);
  assert.equal(runtime.json({ok:true},99).status,500);
  assert.equal(runtime.json({ok:true},204).status,500);
  assert.equal(runtime.json({ok:true},304).status,500);

  const nullBody=runtime.json(undefined,200);
  assert.equal(nullBody.status,200);
  assert.equal(await nullBody.text(),'null');
});

test('runtime metadata never invokes coercive configuration values',()=>{
  const options={
    apiContractVersion:5,
    minClientVersion:'5.8.0',
    releaseChannel:'rc144',
  };
  Object.defineProperty(options,'appVersion',{
    get(){throw new Error('hostile appVersion getter');},
  });

  assert.doesNotThrow(()=>createHttpRuntime(options));
  const guarded=createHttpRuntime(options);
  const response=guarded.json({ok:true});
  assert.equal(response.headers.get('x-app-version'),'');
  assert.equal(response.headers.get('x-api-contract'),'5');

  const coercive=createHttpRuntime({
    appVersion:{
      toString(){throw new Error('must not stringify');},
    },
    apiContractVersion:true,
  });
  const coerciveResponse=coercive.json({ok:true});
  assert.equal(coerciveResponse.headers.get('x-app-version'),'');
  assert.equal(coerciveResponse.headers.get('x-api-contract'),'');
});

test('HTTP boundary preserves admin forbidden response contract',async()=>{
  assert.equal(Object.isFrozen(runtime),true);
  const response=runtime.adminForbidden();
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{
    error:'Этот технический раздел доступен только администратору.',
    code:'ADMIN_ONLY',
  });
});

test('public route errors preserve known categories and strict configured limits',()=>{
  assert.deepEqual(
    runtime.publicRouteError({
      code:'FOOTBALL_RATE_LIMIT',
      retryAfter:7,
    }),
    {
      status:429,
      body:{
        error:'Футбольные данные временно обновляются медленнее. Повторите примерно через 7 сек.',
        code:'FOOTBALL_RATE_LIMIT',
        category:'rate_limit',
        recoverable:true,
        retryAfter:7,
      },
    },
  );

  assert.deepEqual(
    runtime.publicRouteError({code:'FAVORITES_LIMIT'}),
    {
      status:409,
      body:{
        error:'Достигнут лимит избранных команд: 25.',
        code:'FAVORITES_LIMIT',
        category:'limit',
        recoverable:false,
      },
    },
  );

  assert.deepEqual(
    runtime.publicRouteError({code:'REMINDERS_LIMIT'}),
    {
      status:409,
      body:{
        error:'Достигнут лимит активных напоминаний: 20.',
        code:'REMINDERS_LIMIT',
        category:'limit',
        recoverable:false,
      },
    },
  );

  assert.equal(
    runtime.publicRouteError(
      new Error('Supabase unavailable'),
    ).status,
    503,
  );
  assert.equal(
    runtime.publicRouteError({
      code:'UPSTREAM_TIMEOUT',
    }).status,
    504,
  );
  assert.equal(
    runtime.publicRouteError({
      code:'FOOTBALL_PROVIDER_FAILURE',
    }).status,
    502,
  );
  assert.equal(
    runtime.publicRouteError(
      new Error('unknown'),
    ).body.category,
    'service',
  );

  const stringLimit=createHttpRuntime({
    personalWriteLimits:{favorites:'25'},
  });
  assert.equal(
    stringLimit.publicRouteError({
      code:'FAVORITES_LIMIT',
    }).body.error,
    'Достигнут лимит избранных команд.',
  );
});

test('public route error retry metadata is bounded without boolean coercion',()=>{
  const negative=runtime.publicRouteError({
    code:'FOOTBALL_RATE_LIMIT',
    retryAfter:-10,
  });
  assert.equal(negative.body.retryAfter,undefined);
  assert.doesNotMatch(negative.body.error,/-10/);

  const infinite=runtime.publicRouteError({
    code:'FOOTBALL_COOLDOWN',
    retryAfter:Infinity,
  });
  assert.equal(infinite.body.retryAfter,undefined);

  const booleanRetry=runtime.publicRouteError({
    code:'FOOTBALL_RATE_LIMIT',
    retryAfter:true,
  });
  assert.equal(booleanRetry.body.retryAfter,undefined);

  const fractional=runtime.publicRouteError({
    code:'FOOTBALL_RATE_LIMIT',
    retryAfter:2.2,
  });
  assert.equal(fractional.body.retryAfter,3);

  const numericString=runtime.publicRouteError({
    code:'FOOTBALL_RATE_LIMIT',
    retryAfter:'2.2',
  });
  assert.equal(numericString.body.retryAfter,3);

  const capped=runtime.publicRouteError({
    code:'FOOTBALL_RATE_LIMIT',
    retryAfter:999999999,
  });
  assert.equal(capped.body.retryAfter,604800);
});

test('hostile error metadata cannot escape or spoof HTTP error classification',()=>{
  const hostile={};
  Object.defineProperty(hostile,'code',{
    get(){throw new Error('hostile code getter');},
  });
  Object.defineProperty(hostile,'retryAfter',{
    get(){throw new Error('hostile retry getter');},
  });
  Object.defineProperty(hostile,'message',{
    get(){throw new Error('hostile message getter');},
  });

  assert.doesNotThrow(
    ()=>runtime.publicRouteError(hostile),
  );
  assert.deepEqual(
    runtime.publicRouteError(hostile),
    {
      status:502,
      body:{
        error:'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.',
        code:'SERVER_ERROR',
        category:'service',
        recoverable:true,
        retryAfter:undefined,
      },
    },
  );

  const coercive={
    code:{
      toString(){throw new Error('must not coerce code');},
    },
    message:{
      toString(){return 'Supabase unavailable';},
    },
  };
  assert.equal(
    runtime.publicRouteError(coercive).body.category,
    'service',
  );

  assert.equal(
    runtime.publicRouteError({},'true').status,
    502,
  );
  assert.equal(
    runtime.publicRouteError({},true).status,
    429,
  );
});

function bootstrapHarness({
  dispatchApiRoute,
  recordOpsEvent=async()=>{},
}={}) {
  const http=createHttpRuntime({
    appVersion:'6.120.0-rc144',
    apiContractVersion:5,
    minClientVersion:'5.8.0',
    releaseChannel:'rc144',
  });
  const runtimeControls={
    maintenanceMode:false,
    analysisEnabled:true,
    searchEnabled:true,
    liveEnabled:true,
    remindersEnabled:true,
    expandedDataEnabled:true,
    autoSettlementRecoveryEnabled:false,
  };

  return createWorkerBootstrapRuntime({
    API_ROUTE_DEPS:{},
    bumpTelemetry:()=>{},
    closedBetaAccessDecision:()=>({allowed:true}),
    cloudflareEdgeGuard:async()=>({
      blocked:false,
      degraded:false,
      configured:true,
    }),
    config:()=>({}),
    createPreAuthAbuseGuard:()=>({
      registerInvalidAuthFailure:async()=>({blocked:false}),
    }),
    dispatchApiRoute,
    enforceDistributedAccountRateLimit:async()=>null,
    enforceDistributedPreAuthRateLimit:async()=>null,
    enforceRouteBurst:()=>null,
    getRequestUser:async()=>({telegramId:1}),
    handleScheduled:async()=>undefined,
    handleTelegramWebhook:async()=>http.json({ok:true}),
    hasSupabase:()=>false,
    isAdminSensitivePath:()=>false,
    isFootballRateLimitError:()=>false,
    isSecurityLockdownControls:()=>false,
    json:http.json,
    loadRuntimeControls:async()=>({value:runtimeControls}),
    memory:{},
    phase5ValidationContext:async()=>({}),
    preAuthRequestShapeDecision:async()=>({allowed:true}),
    publicDataCapabilities:()=>({}),
    publicRouteError:http.publicRouteError,
    publicStatusRouter:{handle:async()=>null},
    reconcileAnalysisUsageReservations:async()=>true,
    recordOpsEvent,
    recordPhase5ProviderRequestSummary:async()=>true,
    redactOpsString:value=>
      typeof value==='string'
        ? value.slice(0,240)
        : 'redacted',
    runtimeGuard:()=>null,
    supaRpc:async()=>null,
  });
}

test('worker HTTP catch boundary survives hostile thrown error metadata',async()=>{
  const events=[];
  const hostile={};
  Object.defineProperty(hostile,'message',{
    get(){throw new Error('hostile worker message');},
  });
  Object.defineProperty(hostile,'code',{
    get(){throw new Error('hostile worker code');},
  });

  const worker=bootstrapHarness({
    dispatchApiRoute:async()=>{throw hostile;},
    recordOpsEvent:async(_cfg,event)=>{
      events.push(event);
    },
  });

  const originalConsoleError=console.error;
  console.error=()=>{};
  let response;
  try {
    response=await worker.fetch(
      new Request('https://example.test/api/test'),
      {},
      {},
    );
  } finally {
    console.error=originalConsoleError;
  }

  assert.equal(response.status,502);
  const body=await response.json();
  assert.equal(body.code,'SERVER_ERROR');
  assert.equal(body.category,'service');
  assert.ok(
    events.some(
      event=>
        event?.eventType==='route_error'
        && event?.code==='SERVER_ERROR',
    ),
  );
});

test('worker composes HTTP runtime instead of owning response helpers',()=>{
  const worker=fs.readFileSync('src/worker.js','utf8');
  assert.match(
    worker,
    /import \{ createHttpRuntime \} from '\.\/http\.js';/,
  );
  assert.match(
    worker,
    /const \{ json, adminForbidden, publicRouteError \} = createHttpRuntime\(/,
  );
  assert.doesNotMatch(worker,/function json\(/);
  assert.doesNotMatch(worker,/function adminForbidden\(/);
  assert.doesNotMatch(worker,/function publicRouteError\(/);
});
