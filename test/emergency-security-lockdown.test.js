import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  failClosedRuntimeControls,
  isSecurityLockdownControls,
  runtimeLockdownDecision,
  telegramLockdownDecision,
} from '../src/runtime-lockdown.js';
import { createRuntimeControlsRuntime } from '../src/runtime-controls.js';
import { createWorkerBootstrapRuntime } from '../src/worker-bootstrap-runtime.js';

const locked = Object.freeze({
  maintenanceMode:true,
  analysisEnabled:false,
  searchEnabled:false,
  liveEnabled:false,
  remindersEnabled:false,
  expandedDataEnabled:false,
  autoSettlementRecoveryEnabled:false,
});

const normal = Object.freeze({
  maintenanceMode:false,
  analysisEnabled:true,
  searchEnabled:true,
  liveEnabled:true,
  remindersEnabled:true,
  expandedDataEnabled:true,
  autoSettlementRecoveryEnabled:false,
});

function req(path,method='GET') {
  return new Request(`https://example.com${path}`,{method});
}

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function lockedRow(revision=17) {
  return {
    id:'global',
    maintenance_mode:true,
    analysis_enabled:false,
    search_enabled:false,
    live_enabled:false,
    reminders_enabled:false,
    expanded_data_enabled:false,
    auto_settlement_recovery_enabled:false,
    message:'Security Lockdown',
    revision,
    updated_at:'2026-10-07T10:00:00.000Z',
  };
}

function normalRow(revision=17) {
  return {
    id:'global',
    maintenance_mode:false,
    analysis_enabled:true,
    search_enabled:true,
    live_enabled:true,
    reminders_enabled:true,
    expanded_data_enabled:true,
    auto_settlement_recovery_enabled:false,
    message:'',
    revision,
    updated_at:'2026-10-07T10:00:00.000Z',
  };
}

function runtimeControlsHarness(overrides={}) {
  const memory={};
  const events=[];
  const patches=[];
  const deps={
    memory,
    DEFAULT_RUNTIME_CONTROLS:{
      ...normal,
      message:'',
      revision:1,
      updatedAt:null,
    },
    RUNTIME_CONTROLS_CACHE_MS:30_000,
    SUPABASE_SCHEMA_GUIDANCE:'schema unavailable',
    APP_VERSION:'6.120.0-rc144',
    hasSupabase:()=>true,
    supaSelectOne:async()=>normalRow(),
    supaInsertIgnore:async()=>true,
    supaSelectMany:async()=>[],
    fetchWithTimeout:async(url,init={})=>{
      const value=String(url);
      if (value.includes('/runtime_control_history')) {
        return {ok:true,status:200};
      }
      if (value.includes('/runtime_controls')) {
        const body=JSON.parse(init.body);
        patches.push(body);
        return {
          ok:true,
          status:200,
          json:async()=>[body],
        };
      }
      throw new Error('unexpected fetch '+value);
    },
    supaHeaders:()=>({'content-type':'application/json'}),
    recordOpsEvent:async(_cfg,event)=>{ events.push(event); },
    redactOpsString:value=>String(value ?? '').slice(0,160),
    json,
    isAdminUser:()=>true,
    clock:()=>Date.parse('2026-10-07T11:00:00.000Z'),
    ...overrides,
  };
  return {
    api:createRuntimeControlsRuntime(deps),
    memory,
    events,
    patches,
  };
}

function bootstrapDeps(overrides={}) {
  return {
    API_ROUTE_DEPS:{},
    bumpTelemetry:()=>{},
    closedBetaAccessDecision:()=>({allowed:true}),
    cloudflareEdgeGuard:async()=>({blocked:false,configured:true,degraded:false}),
    config:()=>({botToken:'test-token',devMode:false}),
    createPreAuthAbuseGuard:()=>({
      registerInvalidAuthFailure:async()=>({blocked:false}),
    }),
    dispatchApiRoute:async()=>json({ok:true}),
    enforceDistributedAccountRateLimit:async()=>null,
    enforceDistributedPreAuthRateLimit:async()=>null,
    enforceRouteBurst:()=>null,
    getRequestUser:async()=>({id:123}),
    handleScheduled:async()=>[],
    handleTelegramWebhook:async()=>json({ok:true}),
    hasSupabase:()=>true,
    isAdminSensitivePath:()=>false,
    isFootballRateLimitError:()=>false,
    isSecurityLockdownControls,
    json,
    loadRuntimeControls:async()=>({value:normal,source:'supabase'}),
    memory:{},
    phase5ValidationContext:async()=>({}),
    preAuthRequestShapeDecision:async()=>({allowed:true}),
    publicDataCapabilities:()=>({source:'test'}),
    publicRouteError:()=>({
      status:502,
      body:{error:'server',code:'SERVER_ERROR'},
    }),
    publicStatusRouter:{handle:async()=>null},
    reconcileAnalysisUsageReservations:async()=>true,
    recordOpsEvent:async()=>{},
    recordPhase5ProviderRequestSummary:async()=>{},
    redactOpsString:value=>String(value ?? ''),
    runtimeGuard:()=>null,
    supaRpc:async()=>null,
    ...overrides,
  };
}

test('fail-closed snapshot strips untrusted fields and requires deterministic timestamps',()=>{
  const fallback=failClosedRuntimeControls({
    revision:true,
    updatedAt:'2026-10-03T08:00:00',
    secret:'must-not-survive',
  },{toString:()=> 'spoofed_reason'});

  assert.equal(fallback.revision,1);
  assert.equal(fallback.updatedAt,null);
  assert.equal(fallback.controlPlaneReason,'control_plane_unavailable');
  assert.equal('secret' in fallback,false);
  assert.equal(isSecurityLockdownControls(fallback),true);

  const deterministic=failClosedRuntimeControls({
    revision:'17',
    updatedAt:'2026-10-03T08:00:00+02:00',
  },'runtime_controls_unavailable');
  assert.equal(deterministic.revision,17);
  assert.equal(deterministic.updatedAt,'2026-10-03T06:00:00.000Z');
});

test('lockdown detection requires exact booleans and survives hostile getters',()=>{
  assert.equal(isSecurityLockdownControls({...locked,maintenanceMode:'true'}),false);
  assert.equal(isSecurityLockdownControls({...locked,autoSettlementRecoveryEnabled:0}),false);
  assert.equal(isSecurityLockdownControls({...locked,analysisEnabled:0}),false);
  assert.equal(isSecurityLockdownControls([]),false);

  const hostile={...locked};
  Object.defineProperty(hostile,'analysisEnabled',{
    get(){throw new Error('hostile getter');},
  });
  assert.equal(isSecurityLockdownControls(hostile),false);

  const decision=runtimeLockdownDecision(req('/api/preferences','PATCH'),{
    runtime:hostile,
  });
  assert.equal(decision.blocked,true);
  assert.equal(decision.code,'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE');
  assert.equal(decision.controlPlaneFailClosed,true);
});

test('malformed runtime state becomes fail-closed for HTTP and Telegram surfaces',()=>{
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

test('malformed requests and hostile Telegram update getters fail closed instead of throwing',()=>{
  const hostileRequest={};
  Object.defineProperty(hostileRequest,'url',{
    get(){throw new Error('url getter');},
  });
  Object.defineProperty(hostileRequest,'method',{
    get(){throw new Error('method getter');},
  });

  const decision=runtimeLockdownDecision(hostileRequest,{
    runtime:locked,
    isAdmin:true,
  });
  assert.equal(decision.blocked,true);
  assert.equal(decision.invalidRequest,true);

  const hostileUpdate={};
  Object.defineProperty(hostileUpdate,'message',{
    get(){throw new Error('message getter');},
  });
  const telegram=telegramLockdownDecision(hostileUpdate,{runtime:locked});
  assert.equal(telegram.blocked,true);
});

test('control-plane outages and malformed database rows become explicit fail-closed state',async()=>{
  const missing=runtimeControlsHarness({
    supaSelectOne:async()=>null,
  });
  const missingState=await missing.api.loadRuntimeControls({}, {force:true});
  assert.equal(missingState.source,'fail_closed');
  assert.equal(missingState.schemaReady,false);
  assert.equal(missingState.value.controlPlaneReason,'runtime_controls_missing');
  assert.equal(isSecurityLockdownControls(missingState.value),true);

  const unavailable=runtimeControlsHarness({
    supaSelectOne:async()=>{throw new Error('database unavailable');},
  });
  const unavailableState=await unavailable.api.loadRuntimeControls({}, {force:true});
  assert.equal(unavailableState.source,'fail_closed');
  assert.equal(unavailableState.value.controlPlaneReason,'runtime_controls_unavailable');

  const timezoneLess=runtimeControlsHarness({
    supaSelectOne:async()=>({
      ...normalRow(),
      updated_at:'2026-10-07T10:00:00',
    }),
  });
  const invalidState=await timezoneLess.api.loadRuntimeControls({}, {force:true});
  assert.equal(invalidState.source,'fail_closed');
  assert.equal(invalidState.value.controlPlaneReason,'runtime_controls_invalid');
});

test('runtime controls never fall back to normal defaults when Supabase is unavailable',async()=>{
  const {api}=runtimeControlsHarness({
    hasSupabase:()=>false,
    supaSelectOne:async()=>{throw new Error('must not read');},
  });

  const state=await api.loadRuntimeControls({}, {force:true});
  assert.equal(state.source,'fail_closed');
  assert.equal(state.schemaReady,false);
  assert.equal(state.value.maintenanceMode,true);
  assert.equal(state.value.analysisEnabled,false);
  assert.equal(state.value.searchEnabled,false);
  assert.equal(state.value.liveEnabled,false);
  assert.equal(state.value.remindersEnabled,false);
  assert.equal(state.value.expandedDataEnabled,false);
  assert.equal(state.value.autoSettlementRecoveryEnabled,false);
});

test('lockdown keeps safe reads available while blocking mutations and provider fan-out',()=>{
  for (const path of [
    '/api/me',
    '/api/history',
    '/api/billing/plans',
  ]) {
    const decision=runtimeLockdownDecision(req(path),{runtime:locked});
    assert.equal(decision.blocked,false,path);
    assert.equal(decision.readOnly,true,path);
  }

  for (const [path,method,admin] of [
    ['/api/favorites','POST',false],
    ['/api/preferences','PATCH',false],
    ['/api/billing/invoice','POST',false],
    ['/api/billing/subscription','POST',false],
    ['/api/admin/billing/refund','POST',true],
    ['/api/model-remediation','POST',true],
    ['/api/client-telemetry','POST',false],
  ]) {
    const decision=runtimeLockdownDecision(req(path,method),{
      runtime:locked,
      isAdmin:admin,
    });
    assert.equal(decision.blocked,true,`${method} ${path}`);
    assert.equal(decision.code,'SECURITY_LOCKDOWN_WRITE_BLOCKED');
  }

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
    const decision=runtimeLockdownDecision(req(path),{
      runtime:locked,
      isAdmin:true,
    });
    assert.equal(decision.blocked,true,path);
    assert.equal(decision.code,'SECURITY_LOCKDOWN_PROVIDER_PAUSED');
    assert.equal(decision.providerFanout,true);
  }
});

test('admin recovery exceptions require exact admin boolean, path, and method',()=>{
  for (const [path,method] of [
    ['/api/runtime-controls','GET'],
    ['/api/runtime-controls','PATCH'],
    ['/api/runtime-controls','POST'],
    ['/api/runtime-controls/rollback','POST'],
  ]) {
    const decision=runtimeLockdownDecision(req(path,method),{
      runtime:locked,
      isAdmin:true,
    });
    assert.equal(decision.blocked,false,`${method} ${path}`);
    assert.equal(decision.recovery,true);
  }

  for (const [path,method] of [
    ['/api/runtime-controls','DELETE'],
    ['/api/runtime-controls','OPTIONS'],
    ['/api/runtime-controls/rollback','GET'],
    ['/api/runtime-controls/rollback','PATCH'],
  ]) {
    const decision=runtimeLockdownDecision(req(path,method),{
      runtime:locked,
      isAdmin:true,
    });
    assert.equal(decision.blocked,true,`${method} ${path}`);
  }

  assert.equal(
    runtimeLockdownDecision(req('/api/runtime-controls','POST'),{
      runtime:locked,
      isAdmin:'true',
    }).blocked,
    true,
  );
});

test('lockdown can only be released through an explicit audited action',async()=>{
  const events=[];
  const harness=runtimeControlsHarness({
    supaSelectOne:async()=>lockedRow(),
    recordOpsEvent:async(_cfg,event)=>{events.push(event);},
  });

  const ordinary=await harness.api.saveRuntimeControls(
    {supabaseUrl:'https://db.example'},
    {id:7},
    {
      expectedRevision:17,
      action:'update',
      ...normal,
      message:'',
      reason:'ordinary update',
    },
  );
  assert.equal(ordinary.status,409);
  assert.equal(ordinary.code,'SECURITY_LOCKDOWN_EXPLICIT_RELEASE_REQUIRED');
  assert.equal(harness.patches.length,0);

  const released=await harness.api.saveRuntimeControls(
    {supabaseUrl:'https://db.example'},
    {id:7},
    {
      expectedRevision:17,
      action:'lockdown_release',
      reason:'incident resolved',
    },
  );
  assert.equal(released.status,200);
  assert.equal(isSecurityLockdownControls(released.value),false);
  assert.equal(released.value.revision,18);
  assert.equal(harness.patches.length,1);
  assert.equal(events.at(-1)?.code,'SECURITY_LOCKDOWN_RELEASED');
  assert.equal(events.at(-1)?.meta?.action,'lockdown_release');
});

test('explicit lockdown transition persists the complete fail-safe control vector',async()=>{
  const events=[];
  const harness=runtimeControlsHarness({
    supaSelectOne:async()=>normalRow(),
    recordOpsEvent:async(_cfg,event)=>{events.push(event);},
  });

  const result=await harness.api.saveRuntimeControls(
    {supabaseUrl:'https://db.example'},
    {id:7},
    {
      expectedRevision:17,
      action:'lockdown',
      reason:'security incident',
    },
  );

  assert.equal(result.status,200);
  assert.equal(isSecurityLockdownControls(result.value),true);
  assert.equal(result.value.revision,18);
  assert.equal(events.at(-1)?.code,'SECURITY_LOCKDOWN_ENABLED');
  assert.equal(events.at(-1)?.meta?.securityLockdown,true);
});

test('scheduled execution fails closed on malformed controls and pauses during explicit lockdown',async()=>{
  for (const runtimeValue of [
    {maintenanceMode:false},
    {...normal,searchEnabled:'true'},
    locked,
  ]) {
    let handled=0;
    const events=[];
    const runtime=createWorkerBootstrapRuntime(bootstrapDeps({
      loadRuntimeControls:async()=>({value:runtimeValue,source:'supabase'}),
      handleScheduled:async()=>{handled+=1; return ['ran'];},
      recordOpsEvent:async(_cfg,event)=>{events.push(event);},
    }));

    const result=await runtime.scheduled(
      {scheduledTime:Date.parse('2026-10-07T12:00:00.000Z')},
      {},
      {},
    );

    assert.equal(result,undefined);
    assert.equal(handled,0);
    assert.ok(
      events.some(event=>
        event.code==='SCHEDULED_CONTROL_PLANE_INVALID'
        || event.code==='SECURITY_LOCKDOWN_SCHEDULED_TASKS_PAUSED'
      ),
      JSON.stringify(events),
    );
  }
});

test('normal verified runtime state preserves scheduled and HTTP routing',async()=>{
  let handled=0;
  const runtime=createWorkerBootstrapRuntime(bootstrapDeps({
    loadRuntimeControls:async()=>({value:normal,source:'supabase'}),
    handleScheduled:async()=>{handled+=1; return ['scheduled'];},
  }));

  const scheduled=await runtime.scheduled(
    {scheduledTime:Date.parse('2026-10-07T12:01:00.000Z')},
    {},
    {},
  );
  assert.deepEqual(scheduled,['scheduled']);
  assert.equal(handled,1);

  assert.equal(
    runtimeLockdownDecision(req('/api/billing/invoice','POST'),{
      runtime:normal,
    }).blocked,
    false,
  );
  assert.equal(
    runtimeLockdownDecision(req('/api/search'),{runtime:normal}).blocked,
    false,
  );
});

test('Telegram lockdown blocks new actions but preserves structurally verified reconciliation',()=>{
  assert.equal(
    telegramLockdownDecision(
      {pre_checkout_query:{id:'q1'}},
      {runtime:locked},
    ).rejectCheckout,
    true,
  );
  assert.equal(
    telegramLockdownDecision(
      {callback_query:{id:'cb1'}},
      {runtime:locked},
    ).blocked,
    true,
  );
  assert.equal(
    telegramLockdownDecision(
      {message:{text:'/start'}},
      {runtime:locked},
    ).blocked,
    true,
  );

  assert.equal(
    telegramLockdownDecision({
      message:{successful_payment:{telegram_payment_charge_id:'charge'}},
    },{runtime:locked}).paymentReconciliation,
    true,
  );
  assert.equal(
    telegramLockdownDecision({
      message:{refunded_payment:{telegram_payment_charge_id:'charge'}},
    },{runtime:locked}).paymentReconciliation,
    true,
  );
  assert.equal(
    telegramLockdownDecision({
      subscription:{
        state:'canceled',
        invoice_payload:'signed-payload',
        user:{id:7},
      },
    },{runtime:locked}).paymentReconciliation,
    true,
  );

  for (const malformed of [
    {message:{successful_payment:'true'}},
    {message:{successful_payment:{telegram_payment_charge_id:true}}},
    {message:{refunded_payment:{}}},
    {subscription:{state:'canceled'}},
    {subscription:{state:'other',invoice_payload:'signed-payload',user:{id:7}}},
  ]) {
    assert.equal(
      telegramLockdownDecision(malformed,{runtime:locked}).blocked,
      true,
    );
  }
});

test('admin UI exposes explicit lockdown and release controls without a hidden second control plane',()=>{
  const admin=fs.readFileSync('public/admin.html','utf8');
  const moduleSource=fs.readFileSync(
    'public/modules/admin-runtime-controls.js',
    'utf8',
  );

  assert.match(admin,/runtimeSecurityLockdownToggle/);
  assert.match(moduleSource,/action: wasSecurityLockdown \? 'update' : 'lockdown'/);
  assert.match(moduleSource,/action: 'lockdown_release'/);
  assert.match(moduleSource,/LOCKDOWN/);
});
