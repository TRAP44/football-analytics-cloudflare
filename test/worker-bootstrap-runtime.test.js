import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createWorkerBootstrapRuntime } from '../src/worker-bootstrap-runtime.js';

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function request(url='https://example.test/api/me',method='GET') {
  return {
    url,
    method,
    headers:{get:()=>null},
  };
}

function deps(overrides={}) {
  return {
    API_ROUTE_DEPS:{},
    bumpTelemetry:()=>{},
    closedBetaAccessDecision:()=>({allowed:true}),
    cloudflareEdgeGuard:async()=>({blocked:false,configured:true}),
    config:()=>({botToken:'test-token',devMode:false}),
    createPreAuthAbuseGuard:()=>({
      registerInvalidAuthFailure:async()=>({blocked:false}),
    }),
    dispatchApiRoute:async()=>json({ok:true}),
    enforceDistributedAccountRateLimit:async()=>null,
    enforceDistributedPreAuthRateLimit:async()=>null,
    enforceRouteBurst:()=>null,
    getRequestUser:async()=>({id:123}),
    handleScheduled:()=>['scheduled'],
    handleTelegramWebhook:async()=>json({ok:true}),
    hasSupabase:()=>true,
    isAdminSensitivePath:()=>false,
    isFootballRateLimitError:()=>false,
    isSecurityLockdownControls:()=>false,
    json,
    loadRuntimeControls:async()=>({
      value:{
        maintenanceMode:false,
        analysisEnabled:true,
        searchEnabled:true,
        liveEnabled:true,
        remindersEnabled:true,
        expandedDataEnabled:true,
        autoSettlementRecoveryEnabled:false,
      },
      source:'memory',
    }),
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
    redactOpsString:value=>String(value),
    runtimeGuard:()=>null,
    supaRpc:async()=>null,
    ...overrides,
  };
}

test('worker bootstrap fails fast and returns a frozen execution surface', () => {
  assert.throws(
    () => createWorkerBootstrapRuntime(null),
    /Worker bootstrap dependencies are required/,
  );

  const missing=deps();
  delete missing.dispatchApiRoute;
  assert.throws(
    () => createWorkerBootstrapRuntime(missing),
    /dispatchApiRoute is required/,
  );

  const runtime=createWorkerBootstrapRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
  assert.equal(typeof runtime.fetch,'function');
  assert.equal(typeof runtime.scheduled,'function');
});

test('edge rejection survives telemetry and ops failures and normalizes unsafe metadata', async () => {
  const runtime=createWorkerBootstrapRuntime(deps({
    cloudflareEdgeGuard:async()=>({
      blocked:true,
      kind:'rate_limit',
      code:'EDGE_RATE_LIMIT_BLOCKED',
      status:999,
      retryAfter:Number.POSITIVE_INFINITY,
    }),
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
    recordOpsEvent:async()=>{ throw new Error('ops down'); },
  }));

  const response=await runtime.fetch(request(),{},{});
  assert.equal(response.status,429);
  assert.equal(response.body.code,'EDGE_RATE_LIMIT_BLOCKED');
  assert.equal(response.body.retryAfter,undefined);
  assert.deepEqual(response.headers,{});
});

test('malformed or failed pre-auth guards fail closed', async () => {
  const malformed=createWorkerBootstrapRuntime(deps({
    preAuthRequestShapeDecision:async()=>null,
  }));
  const malformedResponse=await malformed.fetch(request(),{},{});
  assert.equal(malformedResponse.status,503);
  assert.equal(malformedResponse.body.code,'REQUEST_GUARD_UNAVAILABLE');

  const failed=createWorkerBootstrapRuntime(deps({
    enforceDistributedPreAuthRateLimit:async()=>{ throw new Error('guard down'); },
  }));
  const failedResponse=await failed.fetch(request(),{},{});
  assert.equal(failedResponse.status,503);
  assert.equal(failedResponse.body.code,'PREAUTH_RATE_GUARD_UNAVAILABLE');
});

test('webhook and API error responses survive observability failure', async () => {
  const webhook=createWorkerBootstrapRuntime(deps({
    handleTelegramWebhook:async()=>{
      const error=new Error('handler failed');
      error.telegramWebhookRetry=false;
      throw error;
    },
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
    recordOpsEvent:async()=>{ throw new Error('ops down'); },
  }));
  const webhookResponse=await webhook.fetch(
    request('https://example.test/telegram/webhook','POST'),
    {},
    {},
  );
  assert.equal(webhookResponse.status,200);
  assert.deepEqual(webhookResponse.body,{ok:false});

  const api=createWorkerBootstrapRuntime(deps({
    dispatchApiRoute:async()=>{ throw new Error('route failed'); },
    bumpTelemetry:()=>{ throw new Error('telemetry down'); },
    recordOpsEvent:async()=>{ throw new Error('ops down'); },
  }));
  const apiResponse=await api.fetch(request(),{},{});
  assert.equal(apiResponse.status,502);
  assert.equal(apiResponse.body.code,'SERVER_ERROR');
  assert.deepEqual(apiResponse.body.provider,{source:'test'});
});

test('public status and malformed runtime state use controlled fail-closed responses', async () => {
  const publicStatus=createWorkerBootstrapRuntime(deps({
    publicStatusRouter:{handle:async()=>{ throw new Error('readiness down'); }},
  }));
  const publicResponse=await publicStatus.fetch(
    request('https://example.test/health/ready'),
    {},
    {},
  );
  assert.equal(publicResponse.status,503);
  assert.equal(publicResponse.body.code,'PUBLIC_STATUS_UNAVAILABLE');

  let runtimeValue='not-called';
  const runtimeState=createWorkerBootstrapRuntime(deps({
    loadRuntimeControls:async()=>null,
    runtimeGuard:(_request,_user,_cfg,value)=>{
      runtimeValue=value;
      return json({code:'RUNTIME_FAIL_CLOSED'},503);
    },
  }));
  const runtimeResponse=await runtimeState.fetch(request(),{},{});
  assert.equal(runtimeResponse.status,503);
  assert.equal(runtimeValue,undefined);
});

test('invalid scheduled time and lockdown classifier failure never launch cron work', async () => {
  let reconciles=0;
  let handled=0;
  const invalid=createWorkerBootstrapRuntime(deps({
    reconcileAnalysisUsageReservations:async()=>{ reconciles+=1; },
    handleScheduled:()=>{ handled+=1; return ['core']; },
  }));
  await invalid.scheduled({scheduledTime:0},{},{});
  assert.equal(reconciles,0);
  assert.equal(handled,0);

  const classifier=createWorkerBootstrapRuntime(deps({
    isSecurityLockdownControls:()=>{ throw new Error('classifier down'); },
    handleScheduled:()=>{ handled+=1; return ['core']; },
  }));
  await classifier.scheduled({scheduledTime:1791302400000},{},{});
  assert.equal(handled,0);
});

test('analysis usage reconciliation failure does not block scheduled core work', async () => {
  let reconciles=0;
  let handled=0;
  const runtime=createWorkerBootstrapRuntime(deps({
    reconcileAnalysisUsageReservations:async()=>{
      reconciles+=1;
      throw new Error('reconciliation down');
    },
    handleScheduled:()=>{
      handled+=1;
      return ['core'];
    },
  }));

  const result=await runtime.scheduled(
    {scheduledTime:1791302400000},
    {},
    {},
  );

  assert.deepEqual(result,['core']);
  assert.equal(reconciles,1);
  assert.equal(handled,1);
});

test('worker keeps exact bootstrap wiring and no legacy inline default handler', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const bootstrap=fs.readFileSync('src/worker-bootstrap-runtime.js','utf8');

  assert.match(worker,/export default createWorkerBootstrapRuntime\(\{/);
  assert.match(bootstrap,/return Object\.freeze\(\{/);
  assert.match(bootstrap,/REQUEST_GUARD_UNAVAILABLE/);
  assert.match(bootstrap,/PREAUTH_RATE_GUARD_UNAVAILABLE/);
  assert.match(bootstrap,/CRON_SCHEDULE_INVALID/);
  assert.match(bootstrap,/ANALYSIS_USAGE_RECONCILIATION_FAILED/);
});
