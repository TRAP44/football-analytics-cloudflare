import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminSensitivePathInventory,
  adminSensitiveRouteRule,
  isAdminSensitivePath,
  privilegedDistributedRatePolicy,
  privilegedLocalRatePolicy,
  privilegedRatePolicyInventory,
  usesStrictTelegramFreshness,
  requiresAdminAuthorizationPath,
} from '../src/security-route-registry.js';

const ROUTER_ADMIN_PATHS=[
  '/api/beta-dashboard',
  '/api/admin/billing/refundable',
  '/api/admin/billing/refund',
  '/api/admin/channel-publisher/test',
  '/api/phase5-dashboard',
  '/api/runtime-controls',
  '/api/runtime-controls/rollback',
  '/api/provider',
  '/api/provider/budget',
  '/api/provider/e2e-validation',
  '/api/provider/probe',
  '/api/provider/coverage-audit',
  '/api/diagnostics',
  '/api/release-readiness',
  '/api/production-readiness',
  '/api/rc-regression',
  '/api/release-monitor',
  '/api/production-monitor',
  '/api/launch-funnel',
  '/api/recovery-incident-ack',
  '/api/post-deploy-regression-response',
  '/api/reminder-health',
  '/api/data-integrity',
  '/api/model-quality',
  '/api/calibration-control',
  '/api/model-remediation',
];

test('authoritative admin-sensitive registry covers every router admin surface',()=>{
  for (const path of ROUTER_ADMIN_PATHS) {
    assert.equal(isAdminSensitivePath(path),true,path);
    assert.equal(requiresAdminAuthorizationPath(path),true,path);
    assert.ok(privilegedLocalRatePolicy(path),path);
    assert.ok(privilegedDistributedRatePolicy(path,'POST'),path);
  }
  assert.ok(adminSensitivePathInventory().some(route=>route.path==='/api/post-deploy-regression-response'));
});

test('strict-freshness operational publisher route stays classified without inventing admin authorization',()=>{
  assert.equal(isAdminSensitivePath('/api/media-publisher-link'),true);
  assert.equal(requiresAdminAuthorizationPath('/api/media-publisher-link'),false);
  assert.ok(privilegedDistributedRatePolicy('/api/media-publisher-link','POST'));
});

test('registry rejects path coercion and non-canonical route inputs',()=>{
  for(const path of [
    {toString:()=>'/api/diagnostics'},
    ['/api/diagnostics'],
    ' /api/diagnostics',
    '/api/diagnostics ',
    'api/diagnostics',
    '/api/diagnostics?x=1',
    '/api/diagnostics#x',
    '/api\\diagnostics',
  ]){
    assert.equal(isAdminSensitivePath(path),false);
    assert.equal(requiresAdminAuthorizationPath(path),false);
    assert.equal(privilegedLocalRatePolicy(path),null);
  }
});

test('registry rules and returned rate policies are immutable',()=>{
  const rule=adminSensitiveRouteRule('/api/provider/probe');
  assert.ok(rule);
  assert.equal(Object.isFrozen(rule),true);
  assert.equal(Object.isFrozen(rule.rate),true);
  assert.throws(()=>{ rule.rate.distributedLimit=999; },TypeError);

  const first=privilegedDistributedRatePolicy('/api/provider/probe','POST');
  assert.equal(Object.isFrozen(first),true);
  assert.throws(()=>{ first.limit=999; },TypeError);

  const second=privilegedDistributedRatePolicy('/api/provider/probe','POST');
  assert.equal(second.limit,6);
});

test('distributed privileged policy treats malformed or unsupported methods fail-closed as mutation',()=>{
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics','GET').mutation,false);
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics','HEAD').mutation,false);
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics','POST').mutation,true);
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics','OPTIONS').mutation,true);
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics',{toString:()=> 'GET'}).mutation,true);
  assert.equal(privilegedDistributedRatePolicy('/api/diagnostics',['GET']).mutation,true);
});

test('registry inventories are isolated immutable snapshots',()=>{
  const inventory=adminSensitivePathInventory();
  assert.equal(Object.isFrozen(inventory),true);
  assert.equal(Object.isFrozen(inventory[0]),true);
  assert.throws(()=>inventory.push({path:'/api/evil',adminAuthorization:false}),TypeError);
  assert.equal(isAdminSensitivePath('/api/evil'),false);
});

test('registry prefix matching is boundary-safe',()=>{
  assert.equal(isAdminSensitivePath('/api/provider/budget'),true);
  assert.equal(isAdminSensitivePath('/api/runtime-controls/rollback'),true);
  assert.equal(isAdminSensitivePath('/api/admin/security/test'),true);
  assert.equal(isAdminSensitivePath('/api/providerish'),false);
  assert.equal(isAdminSensitivePath('/api/runtime-controls-extra'),false);
  assert.equal(isAdminSensitivePath('/api/adminish/test'),false);
});

test('strict Telegram freshness applies to every sensitive registry route',()=>{
  for(const row of adminSensitivePathInventory()){
    assert.equal(usesStrictTelegramFreshness(row.path),true,row.path);
    const local=privilegedLocalRatePolicy(row.path);
    const distributed=privilegedDistributedRatePolicy(row.path,'POST');
    assert.ok(local.limit>=1 && local.windowMs>=1000,row.path);
    assert.ok(distributed.limit>=1 && distributed.windowSeconds>=1,row.path);
  }
  assert.equal(usesStrictTelegramFreshness('/api/not-sensitive'),false);
});
test('privileged policy inventories cannot be mutated through nested entries',()=>{
  const policies=privilegedRatePolicyInventory();
  assert.equal(Object.isFrozen(policies),true);
  assert.ok(policies.length>0);
  assert.equal(Object.isFrozen(policies[0]),true);
  assert.throws(()=>{policies[0].distributedLimit=9999;},TypeError);
  assert.equal(privilegedRatePolicyInventory()[0].distributedLimit,policies[0].distributedLimit);
});
