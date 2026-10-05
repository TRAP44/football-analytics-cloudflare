import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareEdgePolicies, edgePolicyForRequest } from '../src/edge-security.js';

test('public health endpoints are covered by the edge limiter',()=>{
  for (const path of ['/health','/health/live','/health/ready','/api/health']) {
    const policy=edgePolicyForRequest(new Request('https://example.com'+path));
    assert.equal(policy?.id,'public-health',path);
  }
  const policy=cloudflareEdgePolicies().find(item=>item.id==='public-health');
  assert.ok(policy);
  assert.equal(policy.binding,'EDGE_ANALYZE_RATE_LIMIT');
  assert.ok(policy.limit>=1);
});
