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

test('fail-closed snapshot rejects object coercion and strips untrusted previous fields',()=>{
  const fallback=failClosedRuntimeControls({
    revision:true,
    updatedAt:{toString:()=> '2026-10-03T08:00:00.000Z'},
    secret:'must-not-survive',
  },{toString:()=> 'spoofed_reason'});

  assert.equal(fallback.revision,1);
  assert.equal(fallback.updatedAt,null);
  assert.equal(fallback.controlPlaneReason,'control_plane_unavailable');
  assert.equal('secret' in fallback,false);
  assert.equal(isSecurityLockdownControls(fallback),true);
});

test('lockdown detection requires exact boolean state',()=>{
  assert.equal(isSecurityLockdownControls({...locked,maintenanceMode:'true'}),false);
  assert.equal(isSecurityLockdownControls({...locked,autoSettlementRecoveryEnabled:0}),false);
  assert.equal(isSecurityLockdownControls({...locked,analysisEnabled:0}),false);
  assert.equal(isSecurityLockdownControls([]),false);
});

test('malformed runtime state becomes fail-closed instead of disabling lockdown',()=>{
  const decision=runtimeLockdownDecision(req('/api/preferences','PATCH'),{
    runtime:{maintenanceMode:'false'},
  });
  assert.equal(decision.blocked,true);
  assert.equal(decision.code,'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE');
  assert.equal(decision.controlPlaneFailClosed,true);

  const telegram=telegramLockdownDecision({message:{text:'/start'}},{
    runtime:{analysisEnabled:'true'},
  });
  assert.equal(telegram.blocked,true);
  assert.equal(telegram.controlPlaneFailClosed,true);
});

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

test('runtime-controls domain never falls back to normal defaults when controls cannot be verified', () => {
  const runtimeControls = fs.readFileSync('src/runtime-controls.js', 'utf8');
  const start = runtimeControls.indexOf('async function loadRuntimeControls');
  const end = runtimeControls.indexOf('function runtimeHistorySnapshot', start);
  const block = runtimeControls.slice(start, end);

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

test('admin recovery exceptions are limited to explicit methods',()=>{
  for(const [path,method] of [
    ['/api/runtime-controls','DELETE'],
    ['/api/runtime-controls','OPTIONS'],
    ['/api/runtime-controls/rollback','GET'],
    ['/api/runtime-controls/rollback','PATCH'],
  ]){
    const decision=runtimeLockdownDecision(req(path,method),{runtime:locked,isAdmin:true});
    assert.equal(decision.blocked,true,`${method} ${path}`);
    assert.equal(decision.code,'SECURITY_LOCKDOWN_WRITE_BLOCKED');
  }

  const truthyAdmin=runtimeLockdownDecision(req('/api/runtime-controls','POST'),{
    runtime:locked,
    isAdmin:'true',
  });
  assert.equal(truthyAdmin.blocked,true);
});

test('malformed lockdown request is blocked rather than throwing',()=>{
  const decision=runtimeLockdownDecision(
    {method:{toString:()=> 'GET'},url:{toString:()=> 'https://example.com/api/me'}},
    {runtime:locked,isAdmin:true},
  );
  assert.equal(decision.blocked,true);
  assert.equal(decision.invalidRequest,true);
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
  const worker = (fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
  const runtimeControls = fs.readFileSync('src/runtime-controls.js', 'utf8');
  const admin = fs.readFileSync('public/admin.html', 'utf8');
  const module = fs.readFileSync('public/modules/admin-runtime-controls.js', 'utf8');

  assert.match(runtimeControls, /securityLockdown: isSecurityLockdownControls\(value\)/);
  assert.match(runtimeControls, /SECURITY_LOCKDOWN_EXPLICIT_RELEASE_REQUIRED/);
  assert.match(runtimeControls, /SECURITY_LOCKDOWN_ENABLED/);
  assert.match(runtimeControls, /SECURITY_LOCKDOWN_RELEASED/);
  assert.match(worker, /SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED/);
  assert.match(runtimeControls, /runtimeLockdownDecision\([\s\S]*runtime:normalizedRuntime[\s\S]*isAdmin:admin/);
  assert.match(admin, /runtimeSecurityLockdownToggle/);
  assert.match(module, /action: wasSecurityLockdown \? 'update' : 'lockdown'/);
  assert.match(module, /action: 'lockdown_release'/);
  assert.match(module, /LOCKDOWN/);
});


test('Telegram lockdown blocks new actions and checkout but preserves verified payment/refund reconciliation', () => {
  assert.equal(telegramLockdownDecision({ pre_checkout_query: { id: 'q1' } }, { runtime: locked }).blocked, true);
  assert.equal(telegramLockdownDecision({ pre_checkout_query: { id: 'q1' } }, { runtime: locked }).rejectCheckout, true);
  assert.equal(telegramLockdownDecision({ callback_query: { id: 'cb1' } }, { runtime: locked }).blocked, true);
  assert.equal(telegramLockdownDecision({ message: { text: '/start' } }, { runtime: locked }).blocked, true);

  assert.equal(telegramLockdownDecision({
    message:{successful_payment:{telegram_payment_charge_id:'charge'}},
  },{runtime:locked}).blocked,false);
  assert.equal(telegramLockdownDecision({
    message:{refunded_payment:{telegram_payment_charge_id:'charge'}},
  },{runtime:locked}).blocked,false);
  assert.equal(telegramLockdownDecision({
    subscription:{state:'canceled',invoice_payload:'signed-payload',user:{id:7}},
  },{runtime:locked}).blocked,false);

  for(const malformed of [
    {message:{successful_payment:'true'}},
    {message:{successful_payment:{telegram_payment_charge_id:true}}},
    {message:{refunded_payment:{}}},
    {subscription:{state:'canceled'}},
    {subscription:{state:'other',invoice_payload:'signed-payload',user:{id:7}}},
  ]){
    assert.equal(telegramLockdownDecision(malformed,{runtime:locked}).blocked,true);
  }
});

test('worker applies Telegram lockdown before checkout, callbacks and bot business routing', () => {
  const worker = (fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
  const start = worker.indexOf('async function processTelegramUpdate');
  const preCheckout = worker.indexOf('if (update.pre_checkout_query)', start);
  const callback = worker.indexOf('if (update.callback_query)', start);
  const boundary = worker.indexOf('telegramLockdownDecision(update', start);
  assert.ok(start >= 0 && boundary > start);
  assert.ok(boundary < preCheckout);
  assert.ok(boundary < callback);
  assert.match(worker.slice(start, preCheckout), /securityLockdown: true/);
});
