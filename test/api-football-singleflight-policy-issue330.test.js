import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballGateway } from '../src/api-football-gateway.js';
import { createCommonInfrastructureRuntime } from '../src/common-infrastructure-runtime.js';

function deferred() {
  let resolve;
  let reject;
  const promise=new Promise((res,rej)=>{
    resolve=res;
    reject=rej;
  });
  return {promise,resolve,reject};
}

function createGateway({
  fetchWithTimeout,
  supaRpc,
} = {}) {
  const fetchCalls=[];
  const counters={};
  const memory={
    inflight:new Map(),
    provider:{
      plan:'PRO',
      dailyRemaining:999,
      minuteRemaining:999,
      updatedAt:new Date().toISOString(),
      cooldownUntil:null,
    },
  };

  const bumpTelemetry=(key,amount=1)=>{
    counters[key]=Number(counters[key] || 0)+amount;
  };

  const infrastructure=createCommonInfrastructureRuntime({
    memory,
    bumpTelemetry,
  });

  const gateway=createApiFootballGateway({
    memory,
    providerPlanLimits:{FREE:{minute:10},PRO:{minute:60}},
    providerBudgetFloors:{
      FREE:{dailyReserve:20,minuteReserve:1},
      PRO:{dailyReserve:0,minuteReserve:1},
    },
    hasSupabase:()=>true,
    supaRpc:supaRpc || (async()=>({allowed:true,count:1,retryAfter:0})),
    bumpTelemetry,
    observeProviderRequest:()=>{},
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:fetchWithTimeout || (async(_url,_init,timeoutMs)=>{
      fetchCalls.push(timeoutMs);
      await new Promise(resolve=>setTimeout(resolve,5));
      return {
        ok:true,
        status:200,
        headers:{get:()=>null},
        json:async()=>({response:[]}),
      };
    }),
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},
    providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:infrastructure.withSingleFlight,
    sleepMs:async()=>{},
  });

  return {gateway,fetchCalls,counters,memory};
}

test('Issue #330 equivalent default transport policy produces one compatibility key',()=>{
  const {gateway}=createGateway();
  const base=gateway.providerRequestKey('/status',{}, {responseType:'any'});
  const explicit=gateway.providerRequestKey('/status',{}, {
    responseType:'any',
    transportRetries:1,
    timeoutMs:10000,
    allowDailyReserve:false,
  });

  assert.equal(base,explicit);
  assert.equal(Object.isFrozen(gateway.providerTransportPolicy({})),true);
});

test('Issue #330 compatibility key separates every material transport/quota semantic',()=>{
  const {gateway}=createGateway();
  const base=gateway.providerRequestKey('/status',{}, {responseType:'any'});

  assert.notEqual(
    base,
    gateway.providerRequestKey('/status',{}, {
      responseType:'any',
      transportRetries:0,
    }),
  );
  assert.notEqual(
    base,
    gateway.providerRequestKey('/status',{}, {
      responseType:'any',
      timeoutMs:8000,
    }),
  );
  assert.notEqual(
    base,
    gateway.providerRequestKey('/status',{}, {
      responseType:'any',
      allowDailyReserve:true,
    }),
  );
  assert.notEqual(
    base,
    gateway.providerRequestKey('/status',{}, {
      responseType:'array',
    }),
  );
});

test('Issue #330 normalized parameter order does not fragment identical single-flight calls',()=>{
  const {gateway}=createGateway();
  const left=gateway.providerRequestKey(
    '/fixtures',
    {team:7,season:2026},
    {responseType:'array',transportRetries:0},
  );
  const right=gateway.providerRequestKey(
    '/fixtures',
    {season:2026,team:7},
    {responseType:'array',transportRetries:0},
  );

  assert.equal(left,right);
});

test('concurrent identical provider calls deduplicate through the real infrastructure single-flight',async()=>{
  const {gateway,fetchCalls,counters,memory}=createGateway();

  await Promise.all([
    gateway.apiFootball(
      '/status',
      {},
      {apiFootballKey:'secret'},
      {responseType:'any',transportRetries:0,timeoutMs:8000},
    ),
    gateway.apiFootball(
      '/status',
      {},
      {apiFootballKey:'secret'},
      {responseType:'any',transportRetries:0,timeoutMs:8000},
    ),
  ]);

  assert.deepEqual(fetchCalls,[8000]);
  assert.equal(counters.singleflightJoins,1);
  assert.equal(memory.inflight.size,0);
});

test('concurrent calls with different timeout policy never inherit each other',async()=>{
  const {gateway,fetchCalls,counters}=createGateway();

  await Promise.all([
    gateway.apiFootball(
      '/status',
      {},
      {apiFootballKey:'secret'},
      {responseType:'any',transportRetries:0,timeoutMs:8000},
    ),
    gateway.apiFootball(
      '/status',
      {},
      {apiFootballKey:'secret'},
      {responseType:'any',transportRetries:0,timeoutMs:10000},
    ),
  ]);

  assert.deepEqual(fetchCalls.sort((a,b)=>a-b),[8000,10000]);
  assert.equal(counters.singleflightJoins,undefined);
});

test('concurrent calls with different retry policy never inherit each other',async()=>{
  let networkCalls=0;
  const firstEntered=deferred();
  const releaseFirst=deferred();
  const {gateway,counters}=createGateway({
    fetchWithTimeout:async()=>{
      networkCalls+=1;
      if (networkCalls===1) {
        firstEntered.resolve();
        await releaseFirst.promise;
        throw new Error('network');
      }
      return {
        ok:true,
        status:200,
        headers:{get:()=>null},
        json:async()=>({response:[]}),
      };
    },
  });

  const noRetry=gateway.apiFootball(
    '/status',
    {},
    {apiFootballKey:'secret'},
    {responseType:'any',transportRetries:0,timeoutMs:8000},
  );

  await firstEntered.promise;

  const withRetry=gateway.apiFootball(
    '/status',
    {},
    {apiFootballKey:'secret'},
    {responseType:'any',transportRetries:1,timeoutMs:8000},
  );

  releaseFirst.resolve();

  const [left,right]=await Promise.allSettled([noRetry,withRetry]);

  assert.equal(left.status,'rejected');
  assert.equal(left.reason?.code,'FOOTBALL_NETWORK');
  assert.equal(right.status,'fulfilled');
  assert.equal(networkCalls,2);
  assert.equal(counters.singleflightJoins,undefined);
});

test('single-flight rejection is cleaned up so a later identical call can retry',async()=>{
  let attempts=0;
  const firstRelease=deferred();
  const {gateway,memory,counters}=createGateway({
    fetchWithTimeout:async()=>{
      attempts+=1;
      if (attempts===1) {
        await firstRelease.promise;
        throw new Error('network down');
      }
      return {
        ok:true,
        status:200,
        headers:{get:()=>null},
        json:async()=>({response:[{id:2}]}),
      };
    },
  });

  const left=gateway.apiFootball(
    '/status',
    {},
    {apiFootballKey:'secret'},
    {responseType:'array',transportRetries:0,timeoutMs:8000},
  );
  const right=gateway.apiFootball(
    '/status',
    {},
    {apiFootballKey:'secret'},
    {responseType:'array',transportRetries:0,timeoutMs:8000},
  );

  firstRelease.resolve();

  const failed=await Promise.allSettled([left,right]);
  assert.equal(failed.every(result=>result.status==='rejected'),true);
  assert.equal(attempts,1);
  assert.equal(counters.singleflightJoins,1);
  assert.equal(memory.inflight.size,0);

  const recovered=await gateway.apiFootball(
    '/status',
    {},
    {apiFootballKey:'secret'},
    {responseType:'array',transportRetries:0,timeoutMs:8000},
  );

  assert.deepEqual(recovered,[{id:2}]);
  assert.equal(attempts,2);
  assert.equal(memory.inflight.size,0);
});

test('Issue #330 invalid numeric transport settings fall back to normalized safe policy',()=>{
  const {gateway}=createGateway();

  assert.deepEqual(gateway.providerTransportPolicy({
    responseType:'unexpected',
    transportRetries:'not-a-number',
    timeoutMs:'not-a-number',
  }),{
    responseType:'array',
    transportRetries:1,
    timeoutMs:10000,
    allowDailyReserve:false,
  });

  assert.deepEqual(gateway.providerTransportPolicy({
    transportRetries:0.75,
    timeoutMs:2500.9,
  }),{
    responseType:'array',
    transportRetries:0,
    timeoutMs:2500,
    allowDailyReserve:false,
  });

  assert.deepEqual(gateway.providerTransportPolicy({
    transportRetries:99,
    timeoutMs:-10,
    allowDailyReserve:'true',
  }),{
    responseType:'array',
    transportRetries:1,
    timeoutMs:500,
    allowDailyReserve:false,
  });
});

test('normalized invalid policy shares the same key and execution semantics as its fallback',async()=>{
  const {gateway,fetchCalls,counters}=createGateway();

  const invalid={
    responseType:'unexpected',
    transportRetries:'NaN',
    timeoutMs:'NaN',
  };
  const fallback={
    responseType:'array',
    transportRetries:1,
    timeoutMs:10000,
    allowDailyReserve:false,
  };

  assert.equal(
    gateway.providerRequestKey('/status',{},invalid),
    gateway.providerRequestKey('/status',{},fallback),
  );

  await Promise.all([
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'},invalid),
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'},fallback),
  ]);

  assert.deepEqual(fetchCalls,[10000]);
  assert.equal(counters.singleflightJoins,1);
});

test('different response types never share a single-flight result shape',async()=>{
  const calls=[];
  const {gateway,counters}=createGateway({
    fetchWithTimeout:async(_url,_init,timeoutMs)=>{
      calls.push(timeoutMs);
      return {
        ok:true,
        status:200,
        headers:{get:()=>null},
        json:async()=>({
          response:[{id:1}],
          paging:{current:1,total:1},
        }),
      };
    },
  });

  const [arrayResult,envelopeResult]=await Promise.all([
    gateway.apiFootball(
      '/fixtures',
      {id:1},
      {apiFootballKey:'secret'},
      {responseType:'array',transportRetries:0},
    ),
    gateway.apiFootball(
      '/fixtures',
      {id:1},
      {apiFootballKey:'secret'},
      {responseType:'envelope',transportRetries:0},
    ),
  ]);

  assert.deepEqual(arrayResult,[{id:1}]);
  assert.deepEqual(envelopeResult,{
    response:[{id:1}],
    paging:{current:1,total:1},
  });
  assert.equal(calls.length,2);
  assert.equal(counters.singleflightJoins,undefined);
});
