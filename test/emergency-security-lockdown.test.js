import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { failClosedRuntimeControls, isSecurityLockdownControls, runtimeLockdownDecision, telegramLockdownDecision } from '../src/runtime-lockdown.js';

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

test('control-plane failure produces an explicit fail-closed lockdown snapshot', () => {
  const fallback = failClosedRuntimeControls({
    maintenanceMode: false,
    analysisEnabled: true,
    searchEnabled: true,
    liveEnabled: true,
    remindersEnabled: true,
    expandedDataEnabled: true,
    autoSettlementRecoveryEnabled: true,
    revision: 17,
    updatedAt: '2026-10-03T08:00:00.000Z',
  }, 'runtime_controls_unavailable');

  assert.equal(isSecurityLockdownControls(fallback), true);
  assert.equal(fallback.controlPlaneFailClosed, true);
  assert.equal(fallback.controlPlaneReason, 'runtime_controls_unavailable');
  assert.equal(fallback.revision, 17);
  assert.equal(fallback.autoSettlementRecoveryEnabled, false);

  const provider = runtimeLockdownDecision(req('/api/search'), { runtime: fallback });
  assert.equal(provider.blocked, true);
  assert.equal(provider.code, 'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE');
  assert.equal(provider.controlPlaneFailClosed, true);

  const write = runtimeLockdownDecision(req('/api/preferences', 'PATCH'), { runtime: fallback });
  assert.equal(write.blocked, true);
  assert.equal(write.code, 'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE');

  assert.equal(runtimeLockdownDecision(req('/api/runtime-controls', 'PATCH'), { runtime: fallback, isAdmin: true }).blocked, false);
});

test('worker never falls back to normal defaults when runtime controls cannot be verified', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const start = worker.indexOf('async function loadRuntimeControls');
  const end = worker.indexOf('function runtimeHistorySnapshot', start);
  const block = worker.slice(start, end);

  assert.match(block, /activateFailClosed\('supabase_not_configured'\)/);
  assert.match(block, /activateFailClosed\('runtime_controls_missing'\)/);
  assert.match(block, /activateFailClosed\('runtime_controls_unavailable', error\)/);
  assert.match(block, /source: 'fail_closed'/);
  assert.doesNotMatch(block, /previous \|\| \{ \.\.\.DEFAULT_RUNTIME_CONTROLS \}/);
  assert.doesNotMatch(block, /normalizeRuntimeControls\(row \|\| DEFAULT_RUNTIME_CONTROLS\)/);
});

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


test('Telegram lockdown blocks new actions and checkout but preserves payment/refund reconciliation', () => {
  assert.equal(telegramLockdownDecision({ pre_checkout_query: { id: 'q1' } }, { runtime: locked }).blocked, true);
  assert.equal(telegramLockdownDecision({ pre_checkout_query: { id: 'q1' } }, { runtime: locked }).rejectCheckout, true);
  assert.equal(telegramLockdownDecision({ callback_query: { id: 'cb1' } }, { runtime: locked }).blocked, true);
  assert.equal(telegramLockdownDecision({ message: { text: '/start' } }, { runtime: locked }).blocked, true);
  assert.equal(telegramLockdownDecision({ message: { successful_payment: { telegram_payment_charge_id: 'charge' } } }, { runtime: locked }).blocked, false);
  assert.equal(telegramLockdownDecision({ message: { refunded_payment: { telegram_payment_charge_id: 'charge' } } }, { runtime: locked }).blocked, false);
  assert.equal(telegramLockdownDecision({ subscription: { state: 'canceled' } }, { runtime: locked }).blocked, false);
});

test('worker applies Telegram lockdown before checkout, callbacks and bot business routing', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const start = worker.indexOf('async function processTelegramUpdate');
  const preCheckout = worker.indexOf('if (update.pre_checkout_query)', start);
  const callback = worker.indexOf('if (update.callback_query)', start);
  const boundary = worker.indexOf('telegramLockdownDecision(update', start);
  assert.ok(start >= 0 && boundary > start);
  assert.ok(boundary < preCheckout);
  assert.ok(boundary < callback);
  assert.match(worker.slice(start, preCheckout), /securityLockdown: true/);
});
