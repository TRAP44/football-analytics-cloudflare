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
    headers:{get:name=>name==='x-telegram-init-data'?'auth-fixture':null},
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

test('invalid worker configuration and URL are rejected before request dispatch',async()=>{
  let dispatches=0;
  const invalidConfig=createWorkerBootstrapRuntime(deps({
    config:()=>null,
    dispatchApiRoute:async()=>{dispatches++;return json({ok:true});},
  }));
  const configResponse=await invalidConfig.fetch(request(),{},{});
  assert.equal(configResponse.status,503);
  assert.equal(configResponse.body.code,'WORKER_CONFIG_UNAVAILABLE');

  const invalidUrl=createWorkerBootstrapRuntime(deps({
    dispatchApiRoute:async()=>{dispatches++;return json({ok:true});},
  }));
  const urlResponse=await invalidUrl.fetch(request('not-a-valid-url'),{},{});
  assert.equal(urlResponse.status,400);
  assert.equal(urlResponse.body.code,'REQUEST_URL_INVALID');
  assert.equal(dispatches,0);
});

test('scheduled worker rejects control-plane corruption before side effects',async()=>{
  let reconciles=0,handled=0;
  const runtime=createWorkerBootstrapRuntime(deps({
    loadRuntimeControls:async()=>({value:{maintenanceMode:false}}),
    reconcileAnalysisUsageReservations:async()=>{reconciles++;},
    handleScheduled:async()=>{handled++;return ['bad'];},
  }));
  const result=await runtime.scheduled({scheduledTime:1791302400000},{},{});
  assert.equal(result,undefined);
  assert.equal(reconciles,0);
  assert.equal(handled,0);
});

test('only Node pre-work controls timeout can recover; manual lockdown and corrupt controls stay stopped',async()=>{
  const {failClosedRuntimeControls}=await import('../src/runtime-lockdown.js');
  let handled=0;
  const base={source:'fail_closed',failClosed:true,transientReadTimeout:true,value:failClosedRuntimeControls({},'runtime_controls_unavailable')};
  const cases=[
    {state:base,node:true,retry:true},
    {state:base,node:false,retry:false},
    {state:{...base,transientReadTimeout:false},node:true,retry:false},
    {state:{...base,source:'supabase'},node:true,retry:false},
    {state:{...base,value:failClosedRuntimeControls({},'runtime_controls_invalid')},node:true,retry:false},
    {state:{...base,value:failClosedRuntimeControls({},'runtime_controls_missing')},node:true,retry:false},
    {state:{...base,failClosed:false},node:true,retry:false},
  ];
  for(const item of cases){
    const runtime=createWorkerBootstrapRuntime(deps({
      config:()=>({cronRunner:item.node?'github-actions':'',backgroundJobsExecutor:'github'}),
      isSecurityLockdownControls:()=>true,
      loadRuntimeControls:async(_cfg,options)=>{assert.equal(options.force,true);return item.state;},
      handleScheduled:()=>{handled++;},
    }));
    const result=await runtime.scheduled({scheduledTime:1791302400000},{},{});
    assert.deepEqual(result,item.retry?[{task:'scheduled_execution',status:'skipped',reason:'runtime_controls_read_timeout'}]:undefined);
  }
  assert.equal(handled,0);
});

test('runner recovery forces fresh controls before actual scheduled work and never reuses fail-closed state',async()=>{
  const {failClosedRuntimeControls,isSecurityLockdownControls}=await import('../src/runtime-lockdown.js');
  const {runCron,recoverControlRead}=await import('../scripts/cron-runner.js');
  const valid=await deps().loadRuntimeControls();
  let reads=0,handled=0,at=Date.parse('2026-10-20T09:30:10Z');
  const runtime=createWorkerBootstrapRuntime(deps({
    config:()=>({cronRunner:'github-actions',backgroundJobsExecutor:'github'}),isSecurityLockdownControls,
    loadRuntimeControls:async(_cfg,options)=>{
      assert.equal(options.force,true);reads++;
      return reads===1?{source:'fail_closed',failClosed:true,transientReadTimeout:true,value:failClosedRuntimeControls({},'runtime_controls_unavailable')}:valid;
    },
    handleScheduled:()=>{handled++;return [{task:'smart_notifications',status:'ok'}];},
  }));
  const initial=await runCron({worker:runtime,env:{},nowMs:at});
  assert.equal(initial.failed,true);assert.equal(handled,0);
  const recovered=await recoverControlRead({initial,now:()=>at,wait:async ms=>{at+=ms;},endMs:initial.scheduledTime+300000,
    run:nowMs=>runCron({worker:runtime,env:{},nowMs})});
  assert.equal(recovered.length,1);assert.equal(recovered[0].failed,false);
  assert.equal(reads,2);assert.equal(handled,1);assert.equal(initial.failed,true,'original failure stays visible');
  assert.equal(recovered[0].scheduledTime,initial.scheduledTime,'only pre-claim timeout retries the same main slot');
});


test('missing Telegram credentials are denied without database, user lookup or protected dispatch',async()=>{
  for(const path of ['/api/me','/api/launch-funnel','/api/analyze','/api/admin/channel-publisher/test']){
    for(const value of [null,'','   ']){
      const calls=[];
      const runtime=createWorkerBootstrapRuntime(deps({
        enforceDistributedPreAuthRateLimit:async()=>{calls.push('db');throw Error('database unavailable');},
        getRequestUser:async()=>{calls.push('auth');return {id:123};},
        dispatchApiRoute:async()=>{calls.push('route');return json({ok:true});},
        recordOpsEvent:async()=>{calls.push('ops');},
      }));
      const req=request(`https://example.test${path}`);
      req.headers={get:()=>value};
      const response=await runtime.fetch(req,{},{});
      assert.equal(response.status,401,path);
      assert.deepEqual(calls,[],path);
    }
  }
});

test('missing credentials retain real local public/admin burst protection',async()=>{
  const {createPreAuthAbuseGuard}=await import('../src/security-gate.js');
  for(const admin of [false,true]){
    const memory={},events=[];
    const limit=createPreAuthAbuseGuard({memory:{}}).invalidAuthPolicies()[admin?'admin':'public'].limit;
    const runtime=createWorkerBootstrapRuntime(deps({memory,createPreAuthAbuseGuard,
      isAdminSensitivePath:()=>admin,
      enforceDistributedPreAuthRateLimit:async()=>{throw Error('must not call distributed guard');},
      recordOpsEvent:async(_cfg,event)=>{events.push(event);},
    }));
    const req=new Request('https://example.test/api/me',{headers:{'cf-connecting-ip':'203.0.113.10'}});
    for(let i=0;i<limit;i++)assert.equal((await runtime.fetch(req,{},{})).status,401);
    const response=await runtime.fetch(req,{},{});
    assert.equal(response.status,429);assert.equal(response.body.code,'INVALID_AUTH_BURST');
    assert.ok(Number(response.headers['retry-after'])>0);
    assert.equal(events.filter(event=>event.code==='INVALID_AUTH_BURST_BLOCKED').length,1);
  }
});

test('invalid local authorization guard still fails closed for missing credentials',async()=>{
  for(const guard of [()=>null,()=>({registerInvalidAuthFailure:async()=>null}),()=>{throw Error('unavailable');}]){
    const runtime=createWorkerBootstrapRuntime(deps({createPreAuthAbuseGuard:guard}));
    const response=await runtime.fetch(new Request('https://example.test/api/me'),{},{});
    assert.equal(response.status,503);assert.equal(response.body.code,'INVALID_AUTH_GUARD_UNAVAILABLE');
  }
});

test('nonempty credentials retain distributed gate before authentication and never bypass invalid signature',async()=>{
  const calls=[];
  const runtime=createWorkerBootstrapRuntime(deps({
    enforceDistributedPreAuthRateLimit:async()=>{calls.push('preauth');return null;},
    getRequestUser:async()=>{calls.push('auth');return null;},
    createPreAuthAbuseGuard:()=>({registerInvalidAuthFailure:async()=>{calls.push('local');return {blocked:false};}}),
    dispatchApiRoute:async()=>{calls.push('route');return json({ok:true});},
  }));
  const response=await runtime.fetch(request(),{},{});
  assert.equal(response.status,401);assert.deepEqual(calls,['preauth','auth','local']);
  const stopped=createWorkerBootstrapRuntime(deps({
    enforceDistributedPreAuthRateLimit:async()=>json({code:'PREAUTH_RATE_LIMIT'},429),
    getRequestUser:async()=>{throw Error('must stop before auth');},
  }));
  assert.equal((await stopped.fetch(request(),{},{})).status,429);
});

test('empty development credentials retain the established development authentication path',async()=>{
  const calls=[];
  const runtime=createWorkerBootstrapRuntime(deps({
    config:()=>({devMode:true}),
    enforceDistributedPreAuthRateLimit:async()=>{calls.push('preauth');return null;},
    getRequestUser:async()=>{calls.push('auth');return {id:123,__developmentIdentity:true};},
    dispatchApiRoute:async()=>{calls.push('route');return json({ok:true});},
  }));
  const response=await runtime.fetch(new Request('http://localhost/api/me'),{},{});
  assert.equal(response.status,200);assert.deepEqual(calls,['preauth','auth','route']);
});

test('public endpoints and webhook keep their routing without Telegram credentials',async()=>{
  const runtime=createWorkerBootstrapRuntime(deps({
    publicStatusRouter:{handle:async req=>req.url.endsWith('/health/ready')?json({ok:true}):null},
    enforceDistributedPreAuthRateLimit:async()=>{throw Error('must not gate public routes');},
    handleTelegramWebhook:async()=>json({ok:true}),
  }));
  assert.equal((await runtime.fetch(new Request('https://example.test/health/ready'),{},{})).status,200);
  assert.equal((await runtime.fetch(new Request('https://example.test/telegram/webhook',{method:'POST'}),{},{})).status,200);
});


test('real Telegram signature validation still gates protected routes after pre-auth',async()=>{
  const {createUserAuthRuntime}=await import('../src/auth-user.js');
  const {validateTelegramInitData}=await import('../src/crypto-utils.js');
  const {createHmac}=await import('node:crypto');
  const botToken='test-only-signing-token',calls=[];
  const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:123})});
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(botToken).digest();
  params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));
  const auth=createUserAuthRuntime({memory:{users:new Map()},validateTelegramInitData,hasSupabase:()=>false,
    bumpTelemetry:()=>{},recordOpsEvent:async()=>{},
  });
  const runtime=createWorkerBootstrapRuntime(deps({config:()=>({botToken,devMode:false}),getRequestUser:auth.getRequestUser,
    enforceDistributedPreAuthRateLimit:async()=>{calls.push('preauth');return null;},
    dispatchApiRoute:async()=>{calls.push('route');return json({ok:true});},
  }));
  const valid=params.toString();
  for(const [initData,expected] of [[valid,200],[valid.replace('user=','user=x'),401]]){
    calls.length=0;
    const response=await runtime.fetch(new Request('https://example.test/api/me',{headers:{'x-telegram-init-data':initData}}),{},{});
    assert.equal(response.status,expected);assert.deepEqual(calls,expected===200?['preauth','route']:['preauth']);
  }
});
