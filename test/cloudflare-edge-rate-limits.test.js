import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cloudflareEdgeGuard,
  cloudflareEdgePolicies,
  edgePolicyForRequest,
  obviousScannerPath,
} from '../src/edge-security.js';

function request(path, { method='GET', ip='203.0.113.10' } = {}) {
  return new Request(`https://example.com${path}`, {
    method,
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  });
}

function limiter(success=true, capture=null) {
  return {
    async limit(input) {
      if (capture) capture.push(input);
      return { success };
    },
  };
}

test('edge policies cover analyze, billing/admin and Telegram webhook without touching normal reads', () => {
  assert.equal(edgePolicyForRequest(request('/api/analyze'))?.id, 'analyze');
  assert.equal(edgePolicyForRequest(request('/api/billing/invoice', { method:'POST' }))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/api/admin/billing/refund', { method:'POST' }))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/api/runtime-controls'))?.id, 'sensitive');
  assert.equal(edgePolicyForRequest(request('/telegram/webhook', { method:'POST' }))?.id, 'telegram-webhook');
  assert.equal(edgePolicyForRequest(request('/api/me')), null);
  assert.equal(edgePolicyForRequest(request('/health/live')), null);
});

test('obvious scanner paths are rejected before auth/business routing', async () => {
  for (const path of ['/api/.env', '/api/.git/config', '/api/wp-admin', '/api/phpmyadmin', '/api/vendor/phpunit/test']) {
    assert.equal(obviousScannerPath(path), true, path);
    const result = await cloudflareEdgeGuard(request(path), {});
    assert.equal(result.blocked, true, path);
    assert.equal(result.status, 404);
    assert.equal(result.code, 'EDGE_SCANNER_BLOCKED');
  }
});

test('rate-limit binding uses a hashed network fingerprint and never the raw IP as its key', async () => {
  const seen=[];
  const env={ EDGE_ANALYZE_RATE_LIMIT: limiter(false,seen) };
  const result=await cloudflareEdgeGuard(request('/api/analyze', { method:'POST', ip:'198.51.100.42' }),env);
  assert.equal(result.blocked,true);
  assert.equal(result.status,429);
  assert.equal(result.policy,'analyze');
  assert.equal(seen.length,1);
  assert.match(seen[0].key,/^analyze:[a-f0-9]{24}$/);
  assert.equal(seen[0].key.includes('198.51.100.42'),false);
});

test('Webhook ceiling is intentionally much looser than user API ceilings', () => {
  const policies=Object.fromEntries(cloudflareEdgePolicies().map(x=>[x.id,x]));
  assert.equal(policies.analyze.limit,30);
  assert.equal(policies.sensitive.limit,120);
  assert.equal(policies['telegram-webhook'].limit,6000);
  assert.equal(policies['telegram-webhook'].period,60);
});

test('binding outage and missing network identity fail open to existing Worker guards', async () => {
  const throwing={ async limit(){ throw new Error('binding unavailable'); } };
  const failure=await cloudflareEdgeGuard(request('/api/analyze'),{EDGE_ANALYZE_RATE_LIMIT:throwing});
  assert.equal(failure.blocked,false);
  assert.equal(failure.degraded,true);

  const missingBinding=await cloudflareEdgeGuard(request('/api/analyze'),{});
  assert.equal(missingBinding.blocked,false);
  assert.equal(missingBinding.configured,false);

  const missingIp=await cloudflareEdgeGuard(request('/api/analyze',{ip:''}),{EDGE_ANALYZE_RATE_LIMIT:limiter(false)});
  assert.equal(missingIp.blocked,false);
  assert.equal(missingIp.degraded,true);
});

test('wrangler declares three independent Cloudflare rate-limit namespaces', () => {
  const cfg=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
  assert.deepEqual(cfg.ratelimits,[
    {name:'EDGE_ANALYZE_RATE_LIMIT',namespace_id:'386101',simple:{limit:30,period:60}},
    {name:'EDGE_SENSITIVE_RATE_LIMIT',namespace_id:'386102',simple:{limit:120,period:60}},
    {name:'EDGE_WEBHOOK_RATE_LIMIT',namespace_id:'386103',simple:{limit:6000,period:60}},
  ]);
});

test('worker executes the Cloudflare guard before request-body/auth gates and exposes telemetry', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const fetchAt=worker.indexOf('async fetch(request, env, ctx)');
  const edgeAt=worker.indexOf('cloudflareEdgeGuard(request, env)',fetchAt);
  const shapeAt=worker.indexOf('preAuthRequestShapeDecision(request',fetchAt);
  assert.ok(fetchAt>=0 && edgeAt>fetchAt && shapeAt>edgeAt);
  assert.match(worker,/edgeRateLimitBlocks: 0/);
  assert.match(worker,/EDGE_RATE_LIMIT_DEGRADED/);
  assert.match(worker,/cloudflareEdgeRateLimits: 'enabled'/);
});
