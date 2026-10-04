import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  distributedPreAuthPolicies,
  enforceDistributedPreAuthRateLimit,
  normalizeClientNetworkAddress,
  privacyNetworkFingerprint,
} from '../src/security-gate.js';
import {
  accountRateLimitBucketKey,
  accountRatePolicyForRequest,
} from '../src/account-rate-limit.js';

function request(path='/api/me',{
  method='GET',
  ip='198.51.100.70',
  initData='',
}={}) {
  const headers={};
  if (ip) headers['cf-connecting-ip']=ip;
  if (initData) headers['x-telegram-init-data']=initData;
  if (['POST','PUT','PATCH'].includes(method)) headers['content-type']='application/json';
  return new Request('https://example.com'+path,{
    method,
    headers,
    body:['POST','PUT','PATCH'].includes(method) ? '{}' : undefined,
  });
}

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function sharedBackend() {
  const buckets=new Map();
  const calls=[];
  const rpc=async(_cfg,name,payload)=>{
    assert.equal(name,'claim_provider_request');
    calls.push({...payload});
    const count=(buckets.get(payload.p_bucket_key) || 0)+1;
    buckets.set(payload.p_bucket_key,count);
    return {
      allowed:count<=payload.p_limit,
      retryAfter:payload.p_window_seconds,
    };
  };
  return {rpc,buckets,calls};
}

async function enforce(req,{
  adminSensitive=false,
  backend=sharedBackend(),
  cfg={supabaseUrl:'https://db.example',supabaseKey:'server-key',devMode:false},
  events=[],
  telemetry=[],
}={}) {
  const response=await enforceDistributedPreAuthRateLimit({
    request:req,
    cfg,
    adminSensitive,
    fingerprintSecret:'unit-test-secret',
    hasSupabase:()=>true,
    supaRpc:backend.rpc,
    bumpTelemetry:key=>telemetry.push(key),
    recordOpsEvent:async(_cfg,event)=>events.push(event),
    json,
  });
  return {response,backend,events,telemetry};
}

test('Issue #437 normalizes equivalent IPv4 and IPv6 identities before fingerprinting', async()=>{
  assert.equal(normalizeClientNetworkAddress('198.051.100.004'),'198.51.100.4');
  assert.equal(normalizeClientNetworkAddress('999.1.1.1'),'');
  assert.equal(
    normalizeClientNetworkAddress('2001:0DB8:0000:0000:0000:0000:0000:0001'),
    normalizeClientNetworkAddress('2001:db8::1'),
  );

  const ipv4A=await privacyNetworkFingerprint(
    request('/api/me',{ip:'198.051.100.004'}),
    'stable-secret',
  );
  const ipv4B=await privacyNetworkFingerprint(
    request('/api/me',{ip:'198.51.100.4'}),
    'stable-secret',
  );
  assert.equal(ipv4A,ipv4B);
  assert.match(ipv4A,/^[a-f0-9]{24}$/);

  const ipv6A=await privacyNetworkFingerprint(
    request('/api/me',{ip:'2001:0db8:0:0:0:0:0:1'}),
    'stable-secret',
  );
  const ipv6B=await privacyNetworkFingerprint(
    request('/api/me',{ip:'2001:db8::1'}),
    'stable-secret',
  );
  assert.equal(ipv6A,ipv6B);
  assert.notEqual(ipv4A,ipv6A);

  const rotatedSecret=await privacyNetworkFingerprint(
    request('/api/me',{ip:'198.51.100.4'}),
    'rotated-secret',
  );
  assert.notEqual(rotatedSecret,ipv4A);
});

test('one IP with 100 rotating invalid initData values stays in one distributed first-stage bucket', async()=>{
  const backend=sharedBackend();
  for(let i=0;i<100;i+=1) {
    const {response}=await enforce(request('/api/me',{
      ip:'203.0.113.77',
      initData:`query_id=q${i}&user=garbage-${i}&hash=invalid-${i}`,
    }),{backend});
    assert.equal(response,null);
  }

  assert.equal(backend.calls.length,100);
  assert.equal(new Set(backend.calls.map(call=>call.p_bucket_key)).size,1);
  const [bucketKey]=new Set(backend.calls.map(call=>call.p_bucket_key));
  assert.match(bucketKey,/^preauth:public:[a-f0-9]{24}$/);
  assert.equal(bucketKey.includes('203.0.113.77'),false);
  assert.equal(JSON.stringify(backend.calls).includes('query_id='),false);
  assert.equal(JSON.stringify(backend.calls).includes('invalid-'),false);
});

test('distributed pre-auth policy is NAT-tolerant but stricter for expensive and admin-sensitive routes',()=>{
  const policies=distributedPreAuthPolicies();
  assert.equal(policies.public.limit,180);
  assert.equal(policies.expensive.limit,60);
  assert.equal(policies.admin.limit,24);
  assert.equal(policies.public.failClosed,false);
  assert.equal(policies.expensive.failClosed,true);
  assert.equal(policies.admin.failClosed,true);
  assert.ok(policies.admin.limit<policies.expensive.limit);
  assert.ok(policies.expensive.limit<policies.public.limit);
});

test('pre-auth threshold blocks before Telegram validation or downstream provider work', async()=>{
  const backend=sharedBackend();
  let blocked=null;
  for(let i=0;i<61;i+=1) {
    const result=await enforce(request('/api/analyze',{
      method:'POST',
      ip:'203.0.113.90',
      initData:`user=invalid-${i}&hash=${i}`,
    }),{backend});
    if(result.response) blocked=result.response;
  }
  assert.ok(blocked);
  assert.equal(blocked.status,429);
  assert.equal(blocked.body.code,'PREAUTH_RATE_LIMIT');

  const worker=fs.readFileSync('src/worker.js','utf8');
  const fetchAt=worker.indexOf('async fetch(request, env, ctx)');
  const preAuthAt=worker.indexOf('const distributedPreAuthResponse=await enforceDistributedPreAuthRateLimit',fetchAt);
  const authAt=worker.indexOf('const user = await getRequestUser(request, cfg)',fetchAt);
  const routeAt=worker.indexOf('return await dispatchApiRoute(request, url, cfg, user, API_ROUTE_DEPS)',fetchAt);
  assert.ok(fetchAt>=0 && preAuthAt>fetchAt && authAt>preAuthAt && routeAt>authAt);
});

test('backend outage fails closed for expensive/admin routes but keeps ordinary reads fail-soft', async()=>{
  const throwing={
    rpc:async()=>{ throw new Error('distributed backend unavailable'); },
    calls:[],
    buckets:new Map(),
  };

  const expensive=await enforce(request('/api/analyze',{
    method:'POST',
    ip:'198.51.100.88',
  }),{backend:throwing});
  assert.equal(expensive.response.status,503);
  assert.equal(expensive.response.body.code,'PREAUTH_RATE_GUARD_UNAVAILABLE');
  assert.ok(expensive.telemetry.includes('securityPreAuthFallbacks'));
  assert.ok(expensive.telemetry.includes('securityPreAuthFailClosed'));

  const admin=await enforce(request('/api/runtime-controls',{
    ip:'198.51.100.88',
  }),{backend:throwing,adminSensitive:true});
  assert.equal(admin.response.status,503);
  assert.equal(admin.response.body.code,'PREAUTH_RATE_GUARD_UNAVAILABLE');

  const ordinary=await enforce(request('/api/me',{
    ip:'198.51.100.88',
  }),{backend:throwing});
  assert.equal(ordinary.response,null);
  assert.ok(ordinary.telemetry.includes('securityPreAuthFallbacks'));
});

test('missing network identity is fail-closed only where pre-auth work is expensive or sensitive', async()=>{
  const expensive=await enforce(request('/api/analyze',{
    method:'POST',
    ip:'',
  }));
  assert.equal(expensive.response.status,503);

  const admin=await enforce(request('/api/diagnostics',{ip:''}),{adminSensitive:true});
  assert.equal(admin.response.status,503);

  const ordinary=await enforce(request('/api/me',{ip:''}));
  assert.equal(ordinary.response,null);
});

test('pre-auth persistence and telemetry never contain raw network identity or Telegram initData', async()=>{
  const backend=sharedBackend();
  const events=[];
  const rawIp='192.0.2.123';
  const rawInitData='query_id=secret-query&user=attacker-controlled&hash=invalid-secret';

  for(let i=0;i<181;i+=1) {
    await enforce(request('/api/me',{ip:rawIp,initData:rawInitData}),{backend,events});
  }

  const serialized=JSON.stringify({calls:backend.calls,events});
  assert.equal(serialized.includes(rawIp),false);
  assert.equal(serialized.includes(rawInitData),false);
  assert.equal(serialized.includes('attacker-controlled'),false);
  assert.equal(events.at(-1)?.code,'PREAUTH_RATE_LIMIT_BLOCKED');
});

test('authenticated users retain account-scoped fairness after the shared first-stage network bucket',()=>{
  const req=request('/api/analyze',{method:'POST',ip:'198.51.100.55'});
  const policy=accountRatePolicyForRequest(req);
  const keyA=accountRateLimitBucketKey({id:101},policy);
  const keyB=accountRateLimitBucketKey({id:202},policy);
  assert.notEqual(keyA,keyB);
  assert.equal(keyA,'route:101:analysis');
  assert.equal(keyB,'route:202:analysis');
  assert.equal(keyA.includes('198.51.100.55'),false);
  assert.equal(keyB.includes('198.51.100.55'),false);
});

test('edge first-stage source no longer derives buckets from x-telegram-init-data',()=>{
  const edge=fs.readFileSync('src/edge-security.js','utf8');
  assert.doesNotMatch(edge,/x-telegram-init-data/i);
  assert.match(edge,/privacyNetworkFingerprint\(request, secret\)/);
  assert.match(edge,/Attacker-controlled initData must never create a fresh/);
});
