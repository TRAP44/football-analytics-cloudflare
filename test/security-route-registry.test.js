import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminSensitivePathInventory,
  isAdminSensitivePath,
  privilegedDistributedRatePolicy,
  privilegedLocalRatePolicy,
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

test('registry prefix matching is boundary-safe',()=>{
  assert.equal(isAdminSensitivePath('/api/provider/budget'),true);
  assert.equal(isAdminSensitivePath('/api/runtime-controls/rollback'),true);
  assert.equal(isAdminSensitivePath('/api/admin/security/test'),true);
  assert.equal(isAdminSensitivePath('/api/providerish'),false);
  assert.equal(isAdminSensitivePath('/api/runtime-controls-extra'),false);
  assert.equal(isAdminSensitivePath('/api/adminish/test'),false);
});
