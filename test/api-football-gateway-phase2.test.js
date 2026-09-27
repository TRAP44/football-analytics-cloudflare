import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiFootballGateway } from '../src/api-football-gateway.js';

function runtime(overrides = {}) {
  const memory={provider:{plan:'FREE',minuteLimit:10,minuteRemaining:10,dailyRemaining:90},...overrides.memory};
  const counters={};
  const sleeps=[];
  const gateway=createApiFootballGateway({
    memory,
    providerPlanLimits:{FREE:{minute:10},PRO:{minute:300},UNKNOWN:{minute:10}},
    providerBudgetFloors:{FREE:{minuteReserve:2},PRO:{minuteReserve:20},UNKNOWN:{minuteReserve:2}},
    hasSupabase: overrides.hasSupabase || (()=>false),
    supaRpc: overrides.supaRpc || (async()=>({allowed:true})),
    bumpTelemetry:key=>{counters[key]=(counters[key]||0)+1;},
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:overrides.fetchWithTimeout || (async()=>new Response(JSON.stringify({response:[]}),{status:200})),
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>{},
    providerSnapshot:()=>({cooldownActive:false}),
    withSingleFlight:async(_key,fn)=>fn(),
    sleepMs:async ms=>{sleeps.push(ms);},
  });
  return {gateway,memory,counters,sleeps};
}

test('Phase 2 gateway preserves FREE distributed safety budget',()=>{
  const {gateway}=runtime();
  assert.equal(gateway.distributedProviderMinuteLimit(),4);
});

test('Phase 2 gateway fails open when distributed Supabase guard is unavailable',async()=>{
  const {gateway,counters}=runtime({hasSupabase:()=>true,supaRpc:async()=>{throw new Error('db unavailable');}});
  const result=await gateway.claimDistributedProviderBudget({});
  assert.equal(result.allowed,true);
  assert.equal(result.degraded,true);
  assert.equal(counters.providerDistributedFallbacks,1);
});

test('Phase 2 gateway keeps request keys deterministic',()=>{
  const {gateway}=runtime();
  assert.equal(gateway.providerRequestKey('/fixtures',{team:7,season:2026,empty:''},{responseType:'envelope'}),'football:/fixtures?season=2026&team=7:type=envelope');
});

test('Phase 2 gateway retries only network transport failures once',async()=>{
  let attempts=0;
  const {gateway,sleeps}=runtime({fetchWithTimeout:async()=>{
    attempts+=1;
    if(attempts===1) throw new Error('network');
    return new Response(JSON.stringify({response:[{id:1}]}),{status:200});
  }});
  const result=await gateway.apiFootball('/fixtures',{id:1},{apiFootballKey:'test-key'});
  assert.deepEqual(result,[{id:1}]);
  assert.equal(attempts,2);
  assert.deepEqual(sleeps,[180]);
});

test('Phase 2 gateway does not retry provider HTTP failures',async()=>{
  let attempts=0;
  const {gateway}=runtime({fetchWithTimeout:async()=>{
    attempts+=1;
    return new Response(JSON.stringify({response:[]}),{status:500});
  }});
  await assert.rejects(()=>gateway.apiFootball('/fixtures',{id:1},{apiFootballKey:'test-key'}),error=>error?.code==='FOOTBALL_HTTP');
  assert.equal(attempts,1);
});


test('Phase 2 gateway preserves timeout classification after bounded retry', async () => {
  let attempts = 0;
  const timeout = Object.assign(new Error('API-Football timeout'), { code: 'UPSTREAM_TIMEOUT' });
  const { gateway, sleeps } = runtime({
    fetchWithTimeout: async () => {
      attempts += 1;
      throw timeout;
    },
  });

  await assert.rejects(
    () => gateway.apiFootball('/fixtures', { id: 1 }, { apiFootballKey: 'test-key' }),
    error => error?.code === 'UPSTREAM_TIMEOUT',
  );
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [180]);
});
