import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_API_BODY_BYTES,
  MAX_INVALID_AUTH_BUCKETS,
  MAX_TELEGRAM_INIT_DATA_LENGTH,
  createPreAuthAbuseGuard,
  isJsonMediaType,
  preAuthRequestShapeDecision,
} from '../src/security-gate.js';
import { createUserAuthRuntime } from '../src/auth-user.js';

function request(url='https://example.com/api/analyze', {
  method='GET',
  headers={},
  body,
} = {}) {
  return new Request(url,{method,headers,body});
}

test('same-origin JSON API mutation passes the pre-auth request-shape gate', async () => {
  const req=request('https://example.com/api/analyze',{
    method:'POST',
    headers:{
      origin:'https://example.com',
      'sec-fetch-site':'same-origin',
      'content-type':'application/json',
    },
    body:JSON.stringify({fixtureId:123}),
  });
  const decision=await preAuthRequestShapeDecision(req,{api:true});
  assert.equal(decision.allowed,true);
});


test('same-origin PUT accepts strict JSON media types', async () => {
  for (const contentType of ['application/json','application/json; charset=utf-8','Application/JSON; Charset="utf-8"']) {
    const ok=request('https://example.com/api/preferences',{
      method:'PUT',
      headers:{
        origin:'https://example.com',
        'sec-fetch-site':'same-origin',
        'content-type':contentType,
      },
      body:JSON.stringify({theme:'dark'}),
    });
    assert.equal((await preAuthRequestShapeDecision(ok,{api:true})).allowed,true,contentType);
  }
});

test('JSON mutation media type is mandatory and malformed values are rejected', async () => {
  const bytes=new TextEncoder().encode('{"theme":"dark"}');
  const missing=request('https://example.com/api/preferences',{
    method:'PUT',
    headers:{origin:'https://example.com','sec-fetch-site':'same-origin'},
    body:bytes,
  });
  assert.equal(missing.headers.has('content-type'),false);
  const missingDecision=await preAuthRequestShapeDecision(missing,{api:true});
  assert.equal(missingDecision.status,415);
  assert.equal(missingDecision.code,'UNSUPPORTED_MEDIA_TYPE');

  for (const contentType of ['application/jsonbad','application/json;','text/json','text/plain']) {
    const malformed=request('https://example.com/api/preferences',{
      method:'PUT',
      headers:{
        origin:'https://example.com',
        'sec-fetch-site':'same-origin',
        'content-type':contentType,
      },
      body:bytes,
    });
    const decision=await preAuthRequestShapeDecision(malformed,{api:true});
    assert.equal(decision.status,415,contentType);
    assert.equal(decision.code,'UNSUPPORTED_MEDIA_TYPE',contentType);
  }

  assert.equal(isJsonMediaType('application/json'),true);
  assert.equal(isJsonMediaType('application/json; charset=utf-8'),true);
  assert.equal(isJsonMediaType('application/jsonbad'),false);
  assert.equal(isJsonMediaType('application/json;'),false);
});

test('DELETE endpoints without a JSON body contract keep missing Content-Type compatibility', async () => {
  const req=request('https://example.com/api/favorites',{
    method:'DELETE',
    headers:{origin:'https://example.com','sec-fetch-site':'same-origin'},
  });
  const decision=await preAuthRequestShapeDecision(req,{api:true});
  assert.equal(decision.allowed,true);
});

test('cross-origin and cross-site API mutations are rejected before auth/business work', async () => {
  const crossOrigin=request('https://example.com/api/analyze',{
    method:'POST',
    headers:{origin:'https://attacker.invalid','content-type':'application/json'},
    body:'{}',
  });
  const originDecision=await preAuthRequestShapeDecision(crossOrigin,{api:true});
  assert.equal(originDecision.allowed,false);
  assert.equal(originDecision.status,403);
  assert.equal(originDecision.code,'CROSS_ORIGIN_MUTATION_BLOCKED');

  const crossOriginPut=request('https://example.com/api/preferences',{
    method:'PUT',
    headers:{origin:'https://attacker.invalid','content-type':'application/json'},
    body:'{}',
  });
  const putDecision=await preAuthRequestShapeDecision(crossOriginPut,{api:true});
  assert.equal(putDecision.allowed,false);
  assert.equal(putDecision.status,403);
  assert.equal(putDecision.code,'CROSS_ORIGIN_MUTATION_BLOCKED');

  const crossSite=request('https://example.com/api/analyze',{
    method:'POST',
    headers:{'sec-fetch-site':'cross-site','content-type':'application/json'},
    body:'{}',
  });
  const siteDecision=await preAuthRequestShapeDecision(crossSite,{api:true});
  assert.equal(siteDecision.allowed,false);
  assert.equal(siteDecision.status,403);
  assert.equal(siteDecision.code,'CROSS_SITE_MUTATION_BLOCKED');
});

test('unsupported API methods fail before Telegram authentication', async () => {
  const fake={
    method:'TRACE',
    url:'https://example.com/api/me',
    headers:new Headers(),
  };
  const decision=await preAuthRequestShapeDecision(fake,{api:true});
  assert.equal(decision.allowed,false);
  assert.equal(decision.status,405);
  assert.equal(decision.code,'API_METHOD_NOT_ALLOWED');
});

test('declared and chunked oversized API bodies are rejected', async () => {
  const declared=request('https://example.com/api/analyze',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'content-length':String(MAX_API_BODY_BYTES+1),
    },
    body:'{}',
  });
  const declaredDecision=await preAuthRequestShapeDecision(declared,{api:true});
  assert.equal(declaredDecision.status,413);

  const chunked=request('https://example.com/api/analyze',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:'x'.repeat(MAX_API_BODY_BYTES+1),
  });
  const chunkedDecision=await preAuthRequestShapeDecision(chunked,{api:true});
  assert.equal(chunkedDecision.status,413);
  assert.equal(chunkedDecision.code,'REQUEST_TOO_LARGE');
});

test('oversized Telegram initData is rejected before cryptographic validation', async () => {
  const req=request('https://example.com/api/me',{
    headers:{'x-telegram-init-data':'x'.repeat(MAX_TELEGRAM_INIT_DATA_LENGTH+1)},
  });
  const shape=await preAuthRequestShapeDecision(req,{api:true});
  assert.equal(shape.allowed,false);
  assert.equal(shape.status,431);
  assert.equal(shape.code,'TELEGRAM_INIT_DATA_TOO_LARGE');

  let validationCalls=0;
  const memory={users:new Map(),userSyncAt:new Map()};
  const auth=createUserAuthRuntime({
    memory,
    validateTelegramInitData:async()=>{ validationCalls+=1; return {id:123}; },
    developmentTelegramId:999001,
    hasSupabase:()=>false,
    supaUpsert:async()=>{},
    supaSelectOne:async()=>null,
    withSingleFlight:async(_key,fn)=>await fn(),
    pruneMemoryState:()=>{},
    bumpTelemetry:()=>{},
    recordOpsEvent:async()=>{},
  });
  const user=await auth.getRequestUser(req,{botToken:'secret',devMode:false});
  assert.equal(user,null);
  assert.equal(validationCalls,0);
});

test('normal-sized Telegram initData preserves the existing validator boundary', async () => {
  let validationCalls=0;
  const memory={users:new Map(),userSyncAt:new Map()};
  const auth=createUserAuthRuntime({
    memory,
    validateTelegramInitData:async()=>{ validationCalls+=1; return {id:123,username:'ok'}; },
    developmentTelegramId:999001,
    hasSupabase:()=>false,
    supaUpsert:async()=>{},
    supaSelectOne:async()=>null,
    withSingleFlight:async(_key,fn)=>await fn(),
    pruneMemoryState:()=>{},
    bumpTelemetry:()=>{},
    recordOpsEvent:async()=>{},
  });

  const req=request('https://example.com/api/me',{
    headers:{'x-telegram-init-data':'test-boundary-value'},
  });
  const user=await auth.getRequestUser(req,{botToken:'secret',devMode:false});
  assert.equal(Number(user?.id),123);
  assert.equal(validationCalls,1);
});

test('invalid-auth burst guard throttles repeated failures without retaining raw IP', async () => {
  const memory={authFailureBurst:new Map()};
  const events=[];
  let blocks=0;
  const guard=createPreAuthAbuseGuard({
    memory,
    bumpTelemetry:key=>{ if(key==='securityInvalidAuthBlocks') blocks+=1; },
    recordOpsEvent:async event=>events.push(event),
  });
  const req=request('https://example.com/api/me',{
    headers:{'cf-connecting-ip':'203.0.113.77'},
  });

  for(let i=0;i<30;i+=1) {
    const result=await guard.registerInvalidAuthFailure(req,{adminSensitive:false});
    assert.equal(result.blocked,false);
  }
  const blocked=await guard.registerInvalidAuthFailure(req,{adminSensitive:false});
  assert.equal(blocked.blocked,true);
  assert.ok(blocked.retryAfter>=1);
  assert.equal(blocks,1);
  assert.equal(events.length,1);
  assert.equal(events[0].code,'INVALID_AUTH_BURST_BLOCKED');
  assert.ok([...memory.authFailureBurst.keys()].every(key=>!key.includes('203.0.113.77')));
  assert.ok(!JSON.stringify(events).includes('203.0.113.77'));
});

test('admin-sensitive invalid auth gets a tighter pre-auth throttle', async () => {
  const memory={authFailureBurst:new Map()};
  const guard=createPreAuthAbuseGuard({memory});
  const req=request('https://example.com/api/diagnostics',{
    headers:{'cf-connecting-ip':'198.51.100.4'},
  });
  for(let i=0;i<12;i+=1) {
    assert.equal((await guard.registerInvalidAuthFailure(req,{adminSensitive:true})).blocked,false);
  }
  assert.equal((await guard.registerInvalidAuthFailure(req,{adminSensitive:true})).blocked,true);
});


test('invalid-auth burst guard enforces cap and LRU-like eviction', async () => {
  let clock=100_000;
  const memory={authFailureBurst:new Map()};
  const guard=createPreAuthAbuseGuard({memory,now:()=>clock});

  const requests=[];
  for (let i=0;i<MAX_INVALID_AUTH_BUCKETS;i+=1) {
    const req=request('https://example.com/api/me',{
      headers:{'cf-connecting-ip':`198.51.${Math.floor(i/256)}.${i%256}`},
    });
    requests.push(req);
    await guard.registerInvalidAuthFailure(req,{adminSensitive:false});
  }
  assert.equal(memory.authFailureBurst.size,MAX_INVALID_AUTH_BUCKETS);
  const keys=[...memory.authFailureBurst.keys()];
  const firstKey=keys[0];
  const secondKey=keys[1];

  clock+=1;
  await guard.registerInvalidAuthFailure(requests[0],{adminSensitive:false});
  assert.equal(memory.authFailureBurst.has(firstKey),true);

  const extra=request('https://example.com/api/me',{
    headers:{'cf-connecting-ip':'203.0.113.250'},
  });
  await guard.registerInvalidAuthFailure(extra,{adminSensitive:false});
  assert.equal(memory.authFailureBurst.size,MAX_INVALID_AUTH_BUCKETS);
  assert.equal(memory.authFailureBurst.has(firstKey),true);
  assert.equal(memory.authFailureBurst.has(secondKey),false);
});

test('invalid-auth burst guard expires a bucket without carrying the old count', async () => {
  let clock=500_000;
  const memory={authFailureBurst:new Map()};
  const guard=createPreAuthAbuseGuard({memory,now:()=>clock});
  const req=request('https://example.com/api/me',{
    headers:{'cf-connecting-ip':'203.0.113.88'},
  });

  for (let i=0;i<30;i+=1) {
    assert.equal((await guard.registerInvalidAuthFailure(req,{adminSensitive:false})).blocked,false);
  }
  assert.equal((await guard.registerInvalidAuthFailure(req,{adminSensitive:false})).blocked,true);

  clock+=60_001;
  const afterExpiry=await guard.registerInvalidAuthFailure(req,{adminSensitive:false});
  assert.equal(afterExpiry.blocked,false);
  assert.equal(afterExpiry.remaining,29);
  assert.equal(memory.authFailureBurst.size,1);
});

test('Telegram webhook shape gate stays POST JSON-compatible and strict', async () => {
  const getDecision=await preAuthRequestShapeDecision({
    method:'GET',
    url:'https://example.com/telegram/webhook',
    headers:new Headers(),
  },{webhook:true});
  assert.equal(getDecision.status,405);

  const wrongType=request('https://example.com/telegram/webhook',{
    method:'POST',
    headers:{'content-type':'text/plain'},
    body:'hello',
  });
  assert.equal((await preAuthRequestShapeDecision(wrongType,{webhook:true})).status,415);

  const missingType=request('https://example.com/telegram/webhook',{
    method:'POST',
    body:new TextEncoder().encode('{"update_id":1}'),
  });
  assert.equal(missingType.headers.has('content-type'),false);
  assert.equal((await preAuthRequestShapeDecision(missingType,{webhook:true})).status,415);

  const telegramCompatible=request('https://example.com/telegram/webhook',{
    method:'POST',
    headers:{'content-type':'application/json; charset=utf-8'},
    body:'{"update_id":1}',
  });
  assert.equal((await preAuthRequestShapeDecision(telegramCompatible,{webhook:true})).allowed,true);
});

test('worker exposes security guard telemetry and keeps server-side admin authorization', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const router=fs.readFileSync('src/router.js','utf8');
  assert.match(worker,/preAuthRequestShapeDecision/);
  assert.match(worker,/createPreAuthAbuseGuard/);
  assert.match(worker,/enforceDistributedPreAuthRateLimit/);
  assert.match(worker,/fingerprintSecret:cfg\.botToken/);
  assert.match(worker,/securityInvalidAuthBlocks/);
  assert.match(worker,/securityPreAuthBlocks/);
  assert.match(worker,/preAuthAbuseGuard: 'enabled'/);
  assert.match(worker,/distributedPreAuthRateLimit: 'enabled'/);
  assert.match(router,/isAdminUser\(user, cfg\)/);
  assert.match(router,/adminForbidden\(\)/);
});

test('API security headers include transport and legacy cross-domain hardening', () => {
  const headers=fs.readFileSync('src/security-headers.js','utf8');
  assert.match(headers,/strict-transport-security/);
  assert.match(headers,/x-permitted-cross-domain-policies/);
});
