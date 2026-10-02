import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isSecurityLockdownControls, runtimeLockdownDecision } from '../src/runtime-lockdown.js';

const locked = Object.freeze({
  maintenanceMode: true,
  analysisEnabled: false,
  searchEnabled: false,
  liveEnabled: false,
  remindersEnabled: false,
  expandedDataEnabled: false,
  autoSettlementRecoveryEnabled: false,
});

function req(path, method = 'GET') {
  return new Request(`https://example.com${path}`, { method });
}

test('lockdown is a derived state of the existing runtime controls, not a second control plane', () => {
  assert.equal(isSecurityLockdownControls(locked), true);
  assert.equal(isSecurityLockdownControls({ ...locked, searchEnabled: true }), false);
  assert.equal(isSecurityLockdownControls({ ...locked, maintenanceMode: false }), false);
});

test('lockdown keeps safe reads available while blocking all normal mutations', () => {
  assert.equal(runtimeLockdownDecision(req('/api/me'), { runtime: locked }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/history'), { runtime: locked }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/billing/plans'), { runtime: locked }).blocked, false);

  for (const [path, method, admin] of [
    ['/api/favorites', 'POST', false],
    ['/api/preferences', 'PATCH', false],
    ['/api/billing/invoice', 'POST', false],
    ['/api/billing/subscription', 'POST', false],
    ['/api/admin/billing/refund', 'POST', true],
    ['/api/model-remediation', 'POST', true],
    ['/api/client-telemetry', 'POST', false],
  ]) {
    const decision = runtimeLockdownDecision(req(path, method), { runtime: locked, isAdmin: admin });
    assert.equal(decision.blocked, true, `${method} ${path} must be blocked`);
    assert.equal(decision.code, 'SECURITY_LOCKDOWN_WRITE_BLOCKED');
  }
});

test('lockdown stops provider fan-out for users and admins', () => {
  for (const path of [
    '/api/search',
    '/api/matches',
    '/api/tournament',
    '/api/team',
    '/api/team/intelligence',
    '/api/team/squad',
    '/api/match-center',
    '/api/provider/probe',
    '/api/provider/e2e-validation',
    '/api/provider/coverage-audit',
  ]) {
    const userDecision = runtimeLockdownDecision(req(path), { runtime: locked, isAdmin: false });
    assert.equal(userDecision.blocked, true, path);
    assert.equal(userDecision.code, 'SECURITY_LOCKDOWN_PROVIDER_PAUSED');
    const adminDecision = runtimeLockdownDecision(req(path), { runtime: locked, isAdmin: true });
    assert.equal(adminDecision.blocked, true, `admin ${path}`);
  }
});

test('admin recovery endpoints remain available during lockdown', () => {
  assert.equal(runtimeLockdownDecision(req('/api/runtime-controls', 'GET'), { runtime: locked, isAdmin: true }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/runtime-controls', 'PATCH'), { runtime: locked, isAdmin: true }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/runtime-controls/rollback', 'POST'), { runtime: locked, isAdmin: true }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/runtime-controls', 'PATCH'), { runtime: locked, isAdmin: false }).blocked, true);
});

test('normal runtime state preserves existing routing', () => {
  const normal = {
    maintenanceMode: false,
    analysisEnabled: true,
    searchEnabled: true,
    liveEnabled: true,
    remindersEnabled: true,
    expandedDataEnabled: true,
    autoSettlementRecoveryEnabled: false,
  };
  assert.equal(runtimeLockdownDecision(req('/api/billing/invoice', 'POST'), { runtime: normal }).blocked, false);
  assert.equal(runtimeLockdownDecision(req('/api/search'), { runtime: normal }).blocked, false);
});

test('worker and admin surface wire lockdown into history, rollback-safe runtime controls and cron suppression', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const admin = fs.readFileSync('public/admin.html', 'utf8');
  const module = fs.readFileSync('public/modules/admin-runtime-controls.js', 'utf8');

  assert.match(worker, /securityLockdown: isSecurityLockdownControls\(value\)/);
  assert.match(worker, /SECURITY_LOCKDOWN_EXPLICIT_RELEASE_REQUIRED/);
  assert.match(worker, /SECURITY_LOCKDOWN_ENABLED/);
  assert.match(worker, /SECURITY_LOCKDOWN_RELEASED/);
  assert.match(worker, /SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED/);
  assert.match(worker, /runtimeLockdownDecision\(request, \{ runtime, isAdmin: admin \}\)/);
  assert.match(admin, /runtimeSecurityLockdownToggle/);
  assert.match(module, /action: wasSecurityLockdown \? 'update' : 'lockdown'/);
  assert.match(module, /action: 'lockdown_release'/);
  assert.match(module, /LOCKDOWN/);
});
