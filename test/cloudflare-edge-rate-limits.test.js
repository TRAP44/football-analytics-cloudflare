import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cloudflareEdgeGuard,
  cloudflareEdgePolicies,
  edgePolicyForRequest,
  obviousScannerPath,
} from '../src/edge-security.js';
import { createWorkerBootstrapRuntime } from '../src/worker-bootstrap-runtime.js';

function request(path, { method='GET', ip='203.0.113.10', initData='' } = {}) {
  const headers={};
  if (ip) headers['cf-connecting-ip']=ip;
  if (initData) headers['x-telegram-init-data']=initData;
  return new Request(`https://example.com${path}`, { method, headers });
}

function limiter(success=true, capture=null) {
  return {
    async limit(input) {
      if (capture) capture.push(input);
      return { success };
    },
  };
}

function nestedEncodedDot(levels=1) {
  let value='%2e';
  for (let i=1; i<levels; i+=1) value=value.replaceAll('%','%25');
  return value;
}

function bootstrapHarness(edgeDecision) {
  const calls=[];
  const telemetry=[];
  const ops=[];
  const fn=name=>(...args)=>{ calls.push(name); return args; };
  const runtime=createWorkerBootstrapRuntime({
    API_ROUTE_DEPS:{},
    bumpTelemetry:key=>{ telemetry.push(key); calls.push(`telemetry:${key}`); },
    closedBetaAccessDecision:()=>({allowed:true}),
    cloudflareEdgeGuard:async()=>{ calls.push('edge'); return edgeDecision; },
    config:()=>({}),
    createPreAuthAbuseGuard:fn('createPreAuthAbuseGuard'),
    dispatchApiRoute:async()=>{ calls.push('dispatchApiRoute'); return {route:true}; },
    enforceDistributedAccountRateLimit:async()=>({allowed:true}),
    enforceDistributedPreAuthRateLimit:async()=>({allowed:true}),
    enforceRouteBurst:async()=>({allowed:true}),
    getRequestUser:async()=>{ calls.push('getRequestUser'); return {id:1,__telegramValidated:true}; },
    handleScheduled:async()=>{},
    handleTelegramWebhook:async()=>({}),
    hasSupabase:()=>false,
    isAdminSensitivePath:()=>false,
    isFootballRateLimitError:()=>false,
    isSecurityLockdownControls:()=>false,
    json:(body,status=200,headers={})=>({body,status,headers}),
    loadRuntimeControls:async()=>({}),
    memory:{
      edgeRateLimitWarningAt:0,
      routeBurst:new Map(),
      authFailureBurst:new Map(),
    },
    phase5ValidationContext:async()=>null,
    preAuthRequestShapeDecision:async()=>{ calls.push('preAuthShape'); return {allowed:false,status:418,code:'SHAPE_STOP',error:'stop'}; },
    publicDataCapabilities:()=>({}),
    publicRouteError:()=>({}),
    publicStatusRouter:{handle:async()=>{ calls.push('publicStatus'); return null; }},
    reconcileAnalysisUsageReservations:async()=>{},
    recordOpsEvent:async(_cfg,event)=>{ ops.push(event); calls.push(`ops:${event.code}`); return event; },
    recordPhase5ProviderRequestSummary:async()=>{},
    redactOpsString:value=>String(value ?? ''),
    runtimeGuard:async()=>({allowed:true}),
    supaRpc:async()=>({ok:true}),
  });
  return {runtime,calls,telemetry,ops};
}

test('edge policies apply stable first-stage buckets, with stricter sensitive routes', () => {
  assert.equal(edgePolicyForRequest(request('/api/analyze'))?.id, 'api-preauth');
  assert.equal(edgePolicyForRequest(request('/api/me'))?.id, 'api-preauth');
  assert.equal(edgePolicyForRequest(request('/api/search'))?.id, 'api-preauth');
  assert.equal(edgePolicyForRequest(request('/api/billing/invoice', { method:'POST' }))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/api/admin/billing/refund', { method:'POST' }))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/api/runtime-controls'))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/telegram/webhook', { method:'POST' }))?.id, 'telegram-webhook');
  assert.equal(edgePolicyForRequest(request('/api/public-status')), null);
  assert.equal(edgePolicyForRequest(request('/api/health'))?.id, 'public-health');
  assert.equal(edgePolicyForRequest(request('/api/app-manifest')), null);
  assert.equal(edgePolicyForRequest(request('/api/runtime-status')), null);
  assert.equal(edgePolicyForRequest(request('/health/live'))?.id, 'public-health');
});

test('obvious scanner paths reject plain, encoded and excessively nested probes', async () => {
  const paths=[
    '/api/.env',
    '/api/.git/config',
    '/api/wp-admin',
    '/api/phpmyadmin',
    '/api/vendor/phpunit/test',
    '/api/%2eenv',
    '/api/%2egit/config',
    '/api/%252eenv',
    '/api/%2eenv%2elocal',
    `/api/${nestedEncodedDot(4)}env`,
    `/api/${nestedEncodedDot(8)}env`,
  ];

  for (const path of paths) {
    assert.equal(obviousScannerPath(new URL(`https://example.com${path}`).pathname), true, path);
    const result=await cloudflareEdgeGuard(request(path), {});
    assert.equal(result.blocked, true, path);
    assert.equal(result.status, 404);
    assert.equal(result.code, 'EDGE_SCANNER_BLOCKED');
  }

  assert.equal(obviousScannerPath('/api/search'),false);
  assert.equal(obviousScannerPath('/api/team/%20name'),false);
});

test('rate-limit binding uses a hashed network fingerprint and never raw network or Telegram input', async () => {
  const seen=[];
  const env={
    TELEGRAM_BOT_TOKEN:'test-fingerprint-secret',
    EDGE_ANALYZE_RATE_LIMIT:limiter(false,seen),
  };
  const result=await cloudflareEdgeGuard(
    request('/api/analyze',{
      method:'POST',
      ip:'198.51.100.42',
      initData:'user=attacker&hash=garbage',
    }),
    env,
  );

  assert.equal(result.blocked,true);
  assert.equal(result.status,429);
  assert.equal(result.policy,'api-preauth');
  assert.equal(seen.length,1);
  assert.match(seen[0].key,/^api-preauth:[a-f0-9]{24}$/);
  assert.doesNotMatch(seen[0].key,/198\.51\.100\.42|user=|garbage/);
});

test('rotating attacker-controlled Telegram initData cannot fragment the pre-auth bucket', async () => {
  const seen=[];
  const env={
    TELEGRAM_BOT_TOKEN:'test-fingerprint-secret',
    EDGE_ANALYZE_RATE_LIMIT:limiter(true,seen),
  };

  for(let i=0;i<100;i+=1) {
    const result=await cloudflareEdgeGuard(request('/api/analyze',{
      method:'POST',
      ip:'198.51.100.50',
      initData:`user=attacker-${i}&hash=garbage-${i}`,
    }),env);
    assert.equal(result.blocked,false);
  }

  assert.equal(seen.length,100);
  assert.equal(new Set(seen.map(item=>item.key)).size,1);
  assert.ok(seen.every(item=>!item.key.includes('198.51.100.50')));
  assert.ok(seen.every(item=>!item.key.includes('user=')));
  assert.ok(seen.every(item=>!item.key.includes('garbage')));
});

test('binding outage, malformed result and invalid network identity degrade to Worker guards', async () => {
  const throwing={async limit(){throw new Error('binding unavailable');}};
  const failure=await cloudflareEdgeGuard(request('/api/analyze'),{EDGE_ANALYZE_RATE_LIMIT:throwing});
  assert.deepEqual(
    {blocked:failure.blocked,configured:failure.configured,degraded:failure.degraded,policy:failure.policy},
    {blocked:false,configured:true,degraded:true,policy:'api-preauth'},
  );

  const malformed=await cloudflareEdgeGuard(request('/api/analyze'),{
    EDGE_ANALYZE_RATE_LIMIT:{async limit(){return {};}},
  });
  assert.equal(malformed.blocked,false);
  assert.equal(malformed.configured,true);
  assert.equal(malformed.degraded,true);

  const missingBinding=await cloudflareEdgeGuard(request('/api/analyze'),{});
  assert.equal(missingBinding.blocked,false);
  assert.equal(missingBinding.configured,false);
  assert.equal(missingBinding.degraded,true);

  for (const ip of ['', '999.999.999.999', 'not-an-ip']) {
    const seen=[];
    const missingIp=await cloudflareEdgeGuard(
      request('/api/analyze',{ip}),
      {EDGE_ANALYZE_RATE_LIMIT:limiter(false,seen)},
    );
    assert.equal(missingIp.blocked,false,ip);
    assert.equal(missingIp.degraded,true,ip);
    assert.equal(seen.length,0,ip);
  }
});

test('webhook ceiling is intentionally looser than API and sensitive ceilings', () => {
  const policies=Object.fromEntries(cloudflareEdgePolicies().map(item=>[item.id,item]));
  assert.equal(policies['api-preauth'].limit,600);
  assert.equal(policies.sensitive.limit,30);
  assert.equal(policies['telegram-webhook'].limit,6000);
  assert.equal(policies['telegram-webhook'].period,60);
  assert.equal(policies['public-health'].limit,600);
});

test('wrangler bindings stay synchronized with runtime edge policy definitions', () => {
  const cfg=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  const bindings=Object.fromEntries(cfg.ratelimits.map(item=>[item.name,item.simple]));
  const policies=cloudflareEdgePolicies();

  assert.deepEqual(cfg.ratelimits,[
    {name:'EDGE_ANALYZE_RATE_LIMIT',namespace_id:'386101',simple:{limit:600,period:60}},
    {name:'EDGE_SENSITIVE_RATE_LIMIT',namespace_id:'386102',simple:{limit:30,period:60}},
    {name:'EDGE_WEBHOOK_RATE_LIMIT',namespace_id:'386103',simple:{limit:6000,period:60}},
  ]);

  for (const policy of policies) {
    assert.ok(bindings[policy.binding], `${policy.id} binding ${policy.binding} must exist`);
    assert.deepEqual(
      bindings[policy.binding],
      {limit:policy.limit,period:policy.period},
      `${policy.id} runtime policy must match wrangler binding`,
    );
  }

  assert.equal(new Set(cfg.ratelimits.map(item=>item.namespace_id)).size,cfg.ratelimits.length);
});

test('worker bootstrap short-circuits edge blocks before pre-auth and authentication', async () => {
  const {runtime,calls,telemetry,ops}=bootstrapHarness({
    blocked:true,
    configured:true,
    kind:'rate_limit',
    code:'EDGE_RATE_LIMIT_BLOCKED',
    status:429,
    retryAfter:60,
    policy:'api-preauth',
  });

  const response=await runtime.fetch(request('/api/analyze',{method:'POST'}),{},null);

  assert.equal(response.status,429);
  assert.equal(response.body.code,'EDGE_RATE_LIMIT_BLOCKED');
  assert.equal(response.headers['retry-after'],'60');
  assert.equal(calls[0],'edge');
  assert.equal(calls.includes('preAuthShape'),false);
  assert.equal(calls.includes('getRequestUser'),false);
  assert.equal(calls.includes('dispatchApiRoute'),false);
  assert.ok(telemetry.includes('edgeRateLimitBlocks'));
  assert.equal(ops[0]?.code,'EDGE_RATE_LIMIT_BLOCKED');
});

test('degraded edge protection hands control to the next pre-auth guard', async () => {
  const {runtime,calls,telemetry,ops}=bootstrapHarness({
    blocked:false,
    configured:false,
    degraded:true,
    policy:'api-preauth',
  });

  const response=await runtime.fetch(request('/api/analyze',{method:'POST'}),{},null);

  assert.equal(response.status,418);
  assert.equal(response.body.code,'SHAPE_STOP');
  assert.ok(calls.indexOf('edge')>=0);
  assert.ok(calls.indexOf('preAuthShape')>calls.indexOf('edge'));
  assert.equal(calls.includes('getRequestUser'),false);
  assert.ok(telemetry.includes('edgeRateLimitFallbacks'));
  assert.equal(ops.some(event=>event.code==='EDGE_RATE_LIMIT_DEGRADED'),true);
});

test('obvious scanner paths are routed through Worker before SPA asset fallback', () => {
  const cfg=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  for (const pattern of [
    '/.env*',
    '/.git/*',
    '/wp-*',
    '/phpmyadmin*',
    '/vendor/phpunit/*',
    '/actuator*',
    '/server-status*',
    '/cgi-bin/*',
  ]) {
    assert.ok(cfg.assets.run_worker_first.includes(pattern),pattern);
  }
});
