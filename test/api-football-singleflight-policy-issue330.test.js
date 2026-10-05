import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballGateway } from '../src/api-football-gateway.js';

function createGateway() {
  const inflight=new Map();
  const fetchCalls=[];
  const memory={
    provider:{
      plan:'PRO',
      dailyRemaining:999,
      minuteRemaining:999,
      updatedAt:new Date().toISOString(),
      cooldownUntil:null,
    },
  };

  const gateway=createApiFootballGateway({
    memory,
    providerPlanLimits:{FREE:{minute:10},PRO:{minute:60}},
    providerBudgetFloors:{FREE:{dailyReserve:20,minuteReserve:1},PRO:{dailyReserve:0,minuteReserve:1}},
    hasSupabase:()=>true,
    supaRpc:async()=>({allowed:true,count:1,retryAfter:0}),
    bumpTelemetry:()=>{},
    observeProviderRequest:()=>{},
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:async(_url,_init,timeoutMs)=>{
      fetchCalls.push(timeoutMs);
      await new Promise(resolve=>setTimeout(resolve,5));
      return {
        ok:true,
        status:200,
        headers:{get:()=>null},
        json:async()=>({response:[]}),
      };
    },
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},
    providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:async(key,factory)=>{
      if(inflight.has(key)) return await inflight.get(key);
      const task=Promise.resolve().then(factory);
      inflight.set(key,task);
      try { return await task; }
      finally { if(inflight.get(key)===task) inflight.delete(key); }
    },
    sleepMs:async()=>{},
  });

  return {gateway,fetchCalls};
}

test('provider single-flight key normalizes equivalent defaults',()=>{
  const {gateway}=createGateway();
  const base=gateway.providerRequestKey('/status',{}, {responseType:'any'});
  const explicit=gateway.providerRequestKey('/status',{}, {
    responseType:'any',
    transportRetries:1,
    timeoutMs:10000,
    allowDailyReserve:false,
  });
  assert.equal(base,explicit);
});

test('provider single-flight key separates transport and quota semantics',()=>{
  const {gateway}=createGateway();
  const base=gateway.providerRequestKey('/status',{}, {responseType:'any'});
  assert.notEqual(base,gateway.providerRequestKey('/status',{}, {responseType:'any',transportRetries:0}));
  assert.notEqual(base,gateway.providerRequestKey('/status',{}, {responseType:'any',timeoutMs:8000}));
  assert.notEqual(base,gateway.providerRequestKey('/status',{}, {responseType:'any',allowDailyReserve:true}));
  assert.notEqual(base,gateway.providerRequestKey('/status',{}, {responseType:'array'}));
});

test('concurrent identical provider calls still deduplicate',async()=>{
  const {gateway,fetchCalls}=createGateway();
  await Promise.all([
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'}, {responseType:'any',transportRetries:0,timeoutMs:8000}),
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'}, {responseType:'any',transportRetries:0,timeoutMs:8000}),
  ]);
  assert.deepEqual(fetchCalls,[8000]);
});

test('concurrent calls with different transport policy cannot inherit each other',async()=>{
  const {gateway,fetchCalls}=createGateway();
  await Promise.all([
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'}, {responseType:'any',transportRetries:0,timeoutMs:8000}),
    gateway.apiFootball('/status',{}, {apiFootballKey:'secret'}, {responseType:'any',transportRetries:0,timeoutMs:10000}),
  ]);
  assert.deepEqual(fetchCalls.sort((a,b)=>a-b),[8000,10000]);
});


test('Issue #330 invalid numeric transport settings fall back to safe defaults',()=>{
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
});

test('Issue #330 invalid numeric policy cannot skip the provider execution loop',async()=>{
  const {gateway,fetchCalls}=createGateway();
  const value=await gateway.apiFootball('/status',{}, {apiFootballKey:'secret'}, {
    responseType:'any',
    transportRetries:'NaN',
    timeoutMs:'NaN',
  });
  assert.equal(value,null);
  assert.deepEqual(fetchCalls,[10000]);
  assert.equal(
    gateway.providerRequestKey('/status',{}, {responseType:'any',transportRetries:'NaN',timeoutMs:'NaN'}),
    gateway.providerRequestKey('/status',{}, {responseType:'any',transportRetries:1,timeoutMs:10000}),
  );
});
