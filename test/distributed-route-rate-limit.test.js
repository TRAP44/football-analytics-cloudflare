import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountRateLimitBucketKey,
  accountRatePolicies,
  accountRatePolicyForRequest,
  enforceDistributedAccountRateLimit,
} from '../src/account-rate-limit.js';
import {
  isAdminSensitivePath,
  privilegedRatePolicyInventory,
} from '../src/security-route-registry.js';
import { createMaintenanceRuntime } from '../src/maintenance-runtime.js';
import { createScheduledJobsRuntime } from '../src/scheduled-jobs.js';
import { createWorkerBootstrapRuntime } from '../src/worker-bootstrap-runtime.js';

function request(path,{method='GET',ip='198.51.100.70'}={}) {
  return new Request('https://example.com'+path,{
    method,
    headers:ip
      ? {'cf-connecting-ip':ip,'content-type':'application/json'}
      : {'content-type':'application/json'},
    body:['POST','PUT','PATCH'].includes(method) ? '{}' : undefined,
  });
}

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function sharedRpcBackend() {
  const buckets=new Map();
  const calls=[];
  const rpc=async(_cfg,name,payload)=>{
    assert.equal(name,'claim_provider_request');
    calls.push({...payload});
    const count=(buckets.get(payload.p_bucket_key) || 0)+1;
    buckets.set(payload.p_bucket_key,count);
    return {
      allowed:count<=payload.p_limit,
      retryAfter:payload.p_window_seconds,
    };
  };
  return {rpc,buckets,calls};
}

async function enforce({
  req,
  user,
  backend,
  memory={},
  bumpTelemetry=()=>{},
  recordOpsEvent=async()=>{},
  hasSupabase=()=>true,
}){
  return await enforceDistributedAccountRateLimit({
    request:req,
    user,
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase,
    supaRpc:backend.rpc,
    bumpTelemetry,
    recordOpsEvent,
    json,
    memory,
  });
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
    isSecurityLockdownControls:()=>false,
    json,
    loadRuntimeControls:async()=>({value:{},source:'memory'}),
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

function scheduledRuntime(overrides={}) {
  const noop=async()=>({ok:true});
  return createScheduledJobsRuntime({
    settleBacktestDaily:noop,
    processDueReminders:noop,
    processLineupNotifications:noop,
    processImportantChangeNotifications:noop,
    processSmartNotifications:noop,
    processPostMatchReturns:noop,
    runProductionMonitor:noop,
    processDailyDigests:noop,
    cleanupOpsEvents:noop,
    cleanupRateWindows:noop,
    cleanupScheduledJobLeases:noop,
    cleanupGrowthEvents:noop,
    cleanupIntegrityData:noop,
    runSettlementWatchdog:noop,
    runSettlementFinalityVerification:noop,
    recordOpsEvent:noop,
    ...overrides,
  });
}

test('distributed account guard covers public writes and every registered privileged route',()=>{
  for (const [path,method] of [
    ['/api/preferences','PUT'],
    ['/api/favorites','POST'],
    ['/api/favorite-players','DELETE'],
    ['/api/reminders','DELETE'],
    ['/api/billing/invoice','POST'],
  ]) {
    const policy=accountRatePolicyForRequest(request(path,{method}));
    assert.ok(policy,path);
    assert.equal(policy.limit>0,true,path);
    assert.equal(policy.windowSeconds>0,true,path);
  }

  for (const item of privilegedRatePolicyInventory()) {
    assert.equal(isAdminSensitivePath(item.path),true,item.path);
    const policy=accountRatePolicyForRequest(request(item.path));
    assert.ok(policy,item.path);
    assert.equal(policy.limit,item.distributedLimit,item.path);
    assert.equal(policy.windowSeconds,item.distributedWindowSeconds,item.path);
  }

  for (const path of [
    '/api/admin/example',
    '/api/provider/custom-action',
    '/api/runtime-controls/custom-action',
  ]) {
    assert.equal(isAdminSensitivePath(path),true,path);
    assert.ok(accountRatePolicyForRequest(request(path)),path);
  }

  const inventory=accountRatePolicies();
  assert.equal(Object.isFrozen(inventory),true);
  assert.ok(inventory.some(item=>item.label==='analysis' && item.scope==='account'));
  assert.ok(inventory.some(item=>item.scope==='privileged-account'));
});

test('account bucket identity is strict and never uses network identity or coercive user ids',()=>{
  const req=request('/api/preferences',{method:'PUT',ip:'198.51.100.55'});
  const policy=accountRatePolicyForRequest(req);
  assert.ok(policy);

  const keyA=accountRateLimitBucketKey({id:101},policy);
  const keyB=accountRateLimitBucketKey({id:'202'},policy);
  assert.equal(keyA,'route:101:preferences-write');
  assert.equal(keyB,'route:202:preferences-write');
  assert.notEqual(keyA,keyB);
  assert.equal(keyA.includes('198.51.100.55'),false);
  assert.equal(keyB.includes('198.51.100.55'),false);

  assert.equal(accountRateLimitBucketKey({id:true},policy),'');
  assert.equal(accountRateLimitBucketKey({id:1.5},policy),'');
  assert.equal(
    accountRateLimitBucketKey({
      id:{valueOf(){throw new Error('must not coerce user id');}},
    },policy),
    '',
  );

  const hostilePolicy={};
  Object.defineProperty(hostilePolicy,'label',{
    get(){throw new Error('must not escape bucket boundary');},
  });
  assert.equal(accountRateLimitBucketKey({id:101},hostilePolicy),'');
});

test('two Telegram accounts behind one IP do not share the account-level bucket',async()=>{
  const backend=sharedRpcBackend();
  const ip='198.51.100.55';
  const req=request('/api/preferences',{method:'PUT',ip});
  const policy=accountRatePolicyForRequest(req);
  assert.ok(policy);

  for(let i=0;i<policy.limit;i+=1) {
    assert.equal(await enforce({req,user:{id:101},backend,memory:{}}),null);
  }
  const blockedA=await enforce({req,user:{id:101},backend,memory:{}});
  assert.equal(blockedA.status,429);
  assert.equal(blockedA.body.code,'DISTRIBUTED_BURST_GUARD');

  const firstB=await enforce({req,user:{id:202},backend,memory:{}});
  assert.equal(firstB,null);
});

test('shared Supabase RPC enforces one account window across independent Worker isolates',async()=>{
  const backend=sharedRpcBackend();
  const req=request('/api/analyze',{method:'POST',ip:'203.0.113.40'});
  const policy=accountRatePolicyForRequest(req);
  assert.equal(policy.limit,6);

  const isolateA={};
  const isolateB={};
  for(let i=0;i<3;i+=1) {
    assert.equal(await enforce({req,user:{id:77},backend,memory:isolateA}),null);
  }
  for(let i=0;i<3;i+=1) {
    assert.equal(await enforce({req,user:{id:77},backend,memory:isolateB}),null);
  }

  const crossIsolateBlock=await enforce({
    req,
    user:{id:77},
    backend,
    memory:isolateB,
  });
  assert.equal(crossIsolateBlock.status,429);
  assert.equal(backend.buckets.get('route:77:analysis'),7);
});

test('distributed limiter sends the exact server-only atomic fixed-window RPC contract',async()=>{
  const calls=[];
  const req=request('/api/analyze',{method:'POST'});
  const result=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:async(_cfg,name,payload,timeout)=>{
      calls.push({name,payload,timeout});
      return {allowed:true,retryAfter:60};
    },
    json,
    memory:{},
  });

  assert.equal(result,null);
  assert.deepEqual(calls,[{
    name:'claim_provider_request',
    payload:{
      p_bucket_key:'route:77:analysis',
      p_limit:6,
      p_window_seconds:60,
    },
    timeout:1800,
  }]);
});

test('malformed backend allow flags degrade safely and retry-after rejects coercion',async()=>{
  const req=request('/api/analyze',{method:'POST'});
  const memory={};
  const events=[];
  const malformed=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:'true',retryAfter:'not-a-number'}),
    bumpTelemetry:()=>{},
    recordOpsEvent:(_cfg,event)=>{ events.push(event); },
    json,
    memory,
  });
  assert.equal(malformed,null);
  assert.equal(events[0]?.code,'DISTRIBUTED_ROUTE_GUARD_DEGRADED');

  const blocked=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:false,retryAfter:{value:99999}}),
    bumpTelemetry:()=>{},
    recordOpsEvent:async()=>{},
    json,
    memory:{},
  });
  assert.equal(blocked.status,429);
  assert.equal(blocked.body.retryAfter,60);
  assert.equal(blocked.headers['retry-after'],'60');

  const bounded=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:false,retryAfter:99999}),
    json,
    memory:{},
  });
  assert.equal(bounded.status,429);
  assert.equal(bounded.headers['retry-after'],'3600');
});

test('observability failures cannot turn an authenticated distributed block into an allow',async()=>{
  const response=await enforceDistributedAccountRateLimit({
    request:request('/api/analyze',{method:'POST'}),
    user:{id:77},
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:false,retryAfter:10}),
    bumpTelemetry:()=>{throw new Error('telemetry down');},
    recordOpsEvent:()=>{throw new Error('ops down');},
    json,
    memory:{},
  });

  assert.equal(response.status,429);
  assert.equal(response.body.code,'DISTRIBUTED_BURST_GUARD');
  assert.equal(response.headers['retry-after'],'10');
});

test('response construction failure is not misclassified as a backend fallback',async()=>{
  await assert.rejects(
    ()=>enforceDistributedAccountRateLimit({
      request:request('/api/analyze',{method:'POST'}),
      user:{id:77},
      cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
      hasSupabase:()=>true,
      supaRpc:async()=>({allowed:false,retryAfter:10}),
      json:()=>{throw new Error('response encoder unavailable');},
      memory:{},
    }),
    /response encoder unavailable/,
  );
});

test('backend, availability and request-shape failures stay local-fallback safe',async()=>{
  const req=request('/api/analyze',{method:'POST'});
  const events=[];
  const hostile={code:'RPC_DOWN'};
  Object.defineProperty(hostile,'message',{
    get(){throw new Error('hostile message getter');},
  });

  const degraded=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{},
    hasSupabase:()=>true,
    supaRpc:async()=>{throw hostile;},
    recordOpsEvent:(_cfg,event)=>{events.push(event);},
    bumpTelemetry:()=>{throw new Error('telemetry down');},
    json,
    memory:{},
  });
  assert.equal(degraded,null);
  assert.equal(events[0]?.code,'DISTRIBUTED_ROUTE_GUARD_DEGRADED');
  assert.equal(events[0]?.message,'RPC_DOWN');

  let rpcCalls=0;
  const unavailable=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{},
    hasSupabase:()=>{throw new Error('availability probe failed');},
    supaRpc:async()=>{rpcCalls+=1; return {allowed:true};},
    json,
    memory:{},
  });
  assert.equal(unavailable,null);
  assert.equal(rpcCalls,0);

  const truthyAvailability=await enforceDistributedAccountRateLimit({
    request:req,
    user:{id:77},
    cfg:{},
    hasSupabase:()=> 'true',
    supaRpc:async()=>{rpcCalls+=1; return {allowed:true};},
    json,
    memory:{},
  });
  assert.equal(truthyAvailability,null);
  assert.equal(rpcCalls,0);

  assert.equal(
    accountRatePolicyForRequest({
      method:'POST',
      url:{toString(){throw new Error('must not coerce url');}},
    }),
    null,
  );
});

test('Worker bootstrap enforces local account burst before distributed account RPC and routing',async()=>{
  const calls=[];
  const runtime=createWorkerBootstrapRuntime(bootstrapDeps({
    enforceRouteBurst:()=>{
      calls.push('local');
      return null;
    },
    enforceDistributedAccountRateLimit:async()=>{
      calls.push('distributed');
      return null;
    },
    dispatchApiRoute:async()=>{
      calls.push('dispatch');
      return json({ok:true});
    },
  }));

  const response=await runtime.fetch(
    request('/api/preferences',{method:'PUT'}),
    {},
    {},
  );
  assert.equal(response.status,200);
  assert.deepEqual(calls,['local','distributed','dispatch']);

  calls.length=0;
  const localBlock=createWorkerBootstrapRuntime(bootstrapDeps({
    enforceRouteBurst:()=>{
      calls.push('local');
      return json({code:'LOCAL_BLOCK'},429);
    },
    enforceDistributedAccountRateLimit:async()=>{
      calls.push('distributed');
      return null;
    },
    dispatchApiRoute:async()=>{
      calls.push('dispatch');
      return json({ok:true});
    },
  }));
  const localResponse=await localBlock.fetch(
    request('/api/preferences',{method:'PUT'}),
    {},
    {},
  );
  assert.equal(localResponse.status,429);
  assert.equal(localResponse.body.code,'LOCAL_BLOCK');
  assert.deepEqual(calls,['local']);

  calls.length=0;
  const distributedBlock=createWorkerBootstrapRuntime(bootstrapDeps({
    enforceRouteBurst:()=>{
      calls.push('local');
      return null;
    },
    enforceDistributedAccountRateLimit:async()=>{
      calls.push('distributed');
      return json({code:'DISTRIBUTED_BLOCK'},429);
    },
    dispatchApiRoute:async()=>{
      calls.push('dispatch');
      return json({ok:true});
    },
  }));
  const distributedResponse=await distributedBlock.fetch(
    request('/api/preferences',{method:'PUT'}),
    {},
    {},
  );
  assert.equal(distributedResponse.status,429);
  assert.equal(distributedResponse.body.code,'DISTRIBUTED_BLOCK');
  assert.deepEqual(calls,['local','distributed']);
});

test('rate-window cleanup deletes only windows older than the two-day cutoff',async()=>{
  const deletes=[];
  const runtime=createMaintenanceRuntime({
    hasSupabase:()=>true,
    memory:{
      telemetry:{},
      inflight:new Map(),
      routeBurst:new Map(),
      cache:new Map(),
    },
    redactOpsString:value=>String(value),
    supaDelete:async(...args)=>{deletes.push(args);},
  });
  const before=Date.now()-2*86400_000;
  const result=await runtime.cleanupRateWindows({supabaseUrl:'https://db.example'});
  const after=Date.now()-2*86400_000;

  assert.equal(result.ok,true);
  assert.equal(deletes.length,1);
  assert.equal(deletes[0][1],'provider_rate_windows');
  assert.deepEqual(Object.keys(deletes[0][2]),['updated_at']);
  assert.match(deletes[0][2].updated_at,/^lt\./);

  const cutoff=Date.parse(deletes[0][2].updated_at.slice(3));
  assert.ok(Number.isFinite(cutoff));
  assert.ok(cutoff>=before && cutoff<=after);
});

test('03:00 UTC scheduled plan invokes rate-window cleanup exactly once',async()=>{
  let rateCleanupCalls=0;
  const runtime=scheduledRuntime({
    cleanupRateWindows:async()=>{
      rateCleanupCalls+=1;
      return {ok:true};
    },
  });

  const tasks=runtime.buildScheduledTaskPlan(
    {},
    new Date('2026-10-07T03:05:00Z'),
    {lost:false},
  );
  assert.equal(
    tasks.filter(([name])=>name==='rate_window_cleanup').length,
    1,
  );
  await Promise.all(tasks.map(([,promise])=>promise));
  assert.equal(rateCleanupCalls,1);

  const outsideWindow=runtime.buildScheduledTaskPlan(
    {},
    new Date('2026-10-07T03:15:00Z'),
    {lost:false},
  );
  assert.equal(
    outsideWindow.some(([name])=>name==='rate_window_cleanup'),
    false,
  );
  await Promise.all(outsideWindow.map(([,promise])=>promise));
});
