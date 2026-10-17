import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAnalysisRuntime } from '../src/analysis-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function json(body, status = 200, headers = {}) {
  return { body, status, headers };
}

function baseDeps() {
  const clean = () => '';
  return {
    cleanNewsImpactDecisionCode: clean,
    cleanNewsImpactActionCode: clean,
    cleanNewsImpactRecoveryCode: clean,
    json,
    recordGrowthEvent: async () => true,
    recordNewsImpactOutcome: async () => true,
    recordNewsImpactRecoveryAttempt: async () => true,
    recordNewsImpactFailure: async () => true,
    selectNewsImpactRecoveryStrategy: async () => ({ code:'retry', strategy:'fixed', guardReason:'test' }),
    newsImpactFailureCode: () => 'server_error',
  };
}

test('analysis runtime rejects fractional/unsafe fixture ids and invalid users', async () => {
  const runtime = createAnalysisRuntime(baseDeps());

  const fractional = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:1.5 }) },
    {},
    { id:123 },
  );
  const unsafe = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:Number.MAX_SAFE_INTEGER + 1 }) },
    {},
    { id:123 },
  );
  const invalidUser = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123 }) },
    {},
    { id:0 },
  );

  assert.equal(fractional.status, 400);
  assert.equal(unsafe.status, 400);
  assert.equal(invalidUser.status, 401);
});

test('analysis runtime rejects boolean identifier coercion', async () => {
  const runtime=createAnalysisRuntime(baseDeps());

  const fixture=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:true})},
    {},
    {id:123},
  );
  const user=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:true},
  );

  assert.equal(fixture.status,400);
  assert.equal(user.status,401);
});

test('analysis cache outages fail soft before the quota gate', async () => {
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>{ throw new Error('cache down'); },
    getStaleCache:async()=>{ throw new Error('stale cache down'); },
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:3,limit:3,left:0}),
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.quota.left,0);
});

test('malformed quota snapshots fail closed instead of bypassing quota', async () => {
  for (const quota of [
    {plan:'FREE',used:'oops',limit:3,left:3},
    {plan:'FREE',used:0,limit:3,left:999},
    {plan:'FREE',used:5,limit:3,left:1},
    {plan:'FREE',used:0,limit:0,left:0},
  ]) {
    const runtime=createAnalysisRuntime({
      ...baseDeps(),
      getCache:async()=>null,
      getStaleCache:async()=>null,
      resolveUserEntitlements:async()=>({source:'free',access:{}}),
      getQuota:async()=>quota,
    });

    const response=await runtime.apiAnalyze(
      {json:async()=>({fixtureId:123})},
      {},
      {id:456},
    );

    assert.equal(response.status,503,JSON.stringify(quota));
    assert.equal(response.body.code,'ANALYSIS_QUOTA_UNAVAILABLE',JSON.stringify(quota));
  }
});

test('quota snapshots may report used above a reduced limit only when left is exactly zero', async () => {
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>null,
    getStaleCache:async()=>null,
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:5,limit:3,left:0}),
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
  assert.deepEqual(response.body.quota,{
    plan:'FREE',
    used:5,
    limit:3,
    left:0,
  });
});

test('shared analysis joins reject cross-fixture payloads', async () => {
  let historyWrites=0;
  let rejected=0;
  const runtime=createAnalysisRuntime({
    ...baseDeps(),
    getCache:async()=>null,
    getStaleCache:async()=>null,
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:0,limit:3,left:3}),
    claimDistributedAnalysisLock:async()=>({claimed:false,unavailable:false}),
    waitForSharedAnalysis:async()=>({
      generatedAt:new Date().toISOString(),
      match:{fixtureId:999,status:'NS'},
    }),
    recordHistory:async()=>{ historyWrites+=1; },
    recordOpsEvent:async(_cfg,event)=>{
      if (event?.code==='ANALYSIS_SHARED_CACHE_INVALID') rejected+=1;
    },
  });

  const response=await runtime.apiAnalyze(
    {json:async()=>({fixtureId:123})},
    {},
    {id:456},
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_WARMING');
  assert.equal(historyWrites,0);
  assert.equal(rejected,1);
});

test('analysis runtime treats string false as false and cached quota metadata is fail-soft', async () => {
  let entitlementsCalled = 0;
  const cached = {
    generatedAt:new Date(Date.now() - 60_000).toISOString(),
    match:{
      fixtureId:123,
      date:new Date(Date.now() + 3600_000).toISOString(),
      status:'NS',
    },
  };
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => cached,
    getStaleCache: async () => null,
    analysisFreshness: () => ({ needsRecheck:true, state:'recheck', reasonCode:'lineups_window' }),
    newsImpactDeltaStatus: () => null,
    recordHistory: async () => {},
    getQuota: async () => { throw new Error('quota metadata unavailable'); },
    analysisResponsePayload: (payload, meta) => ({ ...payload, ...meta }),
    resolveUserEntitlements: async () => {
      entitlementsCalled += 1;
      return { source:'free', access:{} };
    },
  });

  const response = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123, recheck:'false' }) },
    {},
    { id:456 },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.cached, true);
  assert.equal(response.body.quota, null);
  assert.equal(entitlementsCalled, 0);
});

test('analysis runtime rejects cache payloads for another fixture and records the integrity code', async () => {
  const events=[];
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => ({
      generatedAt:new Date().toISOString(),
      match:{ fixtureId:999, date:new Date().toISOString(), status:'NS' },
    }),
    getStaleCache: async () => null,
    recordOpsEvent: async (_cfg,event) => { events.push(event); },
    resolveUserEntitlements: async () => ({ source:'free', access:{} }),
    getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
  });

  const response = await runtime.apiAnalyze(
    { json: async () => ({ fixtureId:123 }) },
    {},
    { id:456 },
  );

  assert.equal(response.status,429);
  assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
  assert.equal(events.length,1);
  assert.equal(events[0].code,'ANALYSIS_CACHE_INVALID');
  assert.deepEqual(events[0].meta,{fixtureId:123});
});

test('client-supplied news impact flags cannot mint a free recheck', async () => {
  let historyEligibilityChecks = 0;
  const stale = {
    generatedAt:new Date(Date.now() - 60_000).toISOString(),
    match:{
      fixtureId:123,
      date:new Date(Date.now() + 3600_000).toISOString(),
      status:'NS',
    },
  };
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => null,
    getStaleCache: async () => stale,
    analysisFreshness: () => ({ needsRecheck:false, state:'fresh', reasonCode:'fresh' }),
    userHasAnalyzedFixture: async () => {
      historyEligibilityChecks += 1;
      return true;
    },
    resolveUserEntitlements: async () => ({ source:'free', access:{} }),
    getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
  });

  const response = await runtime.apiAnalyze(
    {
      json: async () => ({
        fixtureId:123,
        recheck:true,
        newsImpactRecheck:true,
        newsPublishedAt:new Date().toISOString(),
      }),
    },
    {},
    { id:456 },
  );

  assert.equal(response.status, 429);
  assert.equal(historyEligibilityChecks, 0);
});

test('analysis wiring owns Tavily adapter and keeps boundary helpers local to the runtime', () => {
  const worker = readRepoFile('src/worker.js');
  const runtime = readRepoFile('src/analysis-runtime.js');

  assert.doesNotMatch(worker, /\btavilySearch\b/);
  assert.match(runtime, /fetchWithTimeout/);
  assert.match(runtime, /Authorization|authorization/);
  assert.match(runtime, /Bearer/);
  assert.match(runtime, /isRetryableFootballTransportError/);
  assert.match(runtime, /function quotaSnapshot\(value, fallback = null\)/);
  assert.match(runtime, /const expectedLeft=Math\.max\(0,limit-used\)/);
  assert.match(runtime, /function safeAnalysisProviderFetch\(input\)/);
  assert.match(runtime, /analysisCachePayload\(joinedCandidate,fixtureId\)/);
  assert.match(runtime, /return Object\.freeze\(\{apiAnalyze,analyzeFixtureForSystem\}\)/);
});

function staleRecheckRuntime({ ownership, quota = { plan:'FREE', used:3, limit:3, left:0 }, entitlements = { source:'free', access:{} }, reserve } = {}) {
  const calls = { quota:0, ownershipOptions:null, reservations:0 };
  const stale = {
    generatedAt:new Date(Date.now() - 6 * 3600_000).toISOString(),
    match:{ fixtureId:123, date:new Date(Date.now() + 3600_000).toISOString(), status:'NS' },
  };
  const runtime = createAnalysisRuntime({
    ...baseDeps(),
    getCache: async () => null,
    getStaleCache: async () => stale,
    analysisFreshness: () => ({ needsRecheck:true, state:'recheck', reasonCode:'lineups_window' }),
    userHasAnalyzedFixture: async (_userId, _fixtureId, _cfg, options) => {
      calls.ownershipOptions = options;
      return ownership();
    },
    analysisResponsePayload: (payload, meta) => ({ ...payload, ...meta }),
    resolveUserEntitlements: async () => entitlements,
    ...(reserve ? { reserveEntitlementUsage: async (...args) => { calls.reservations += 1; return reserve(...args); } } : {}),
    getQuota: async () => { calls.quota += 1; return quota; },
  });
  const request = () => runtime.apiAnalyze({ json: async () => ({ fixtureId:123, recheck:true }) }, {}, { id:456 });
  return { request, calls };
}

test('history outage during a recheck shows the saved analysis instead of charging the quota', async () => {
  const { request, calls } = staleRecheckRuntime({
    ownership: () => { const error = new Error('down'); error.code = 'HISTORY_UNAVAILABLE'; throw error; },
  });
  const response = await request();

  assert.equal(response.status, 200);
  assert.equal(response.body.stale, true);
  assert.equal(response.body.recheck.performed, false);
  assert.equal(response.body.recheck.reasonCode, 'history_unavailable');
  assert.match(response.body.warning, /лимит не списан/);
  assert.deepEqual(calls.ownershipOptions, { strict:true });
});

test('a confirmed "never analysed" recheck still goes through the normal quota check', async () => {
  const { request, calls } = staleRecheckRuntime({ ownership: () => false });
  const response = await request();

  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'ANALYSIS_QUOTA_EXHAUSTED');
  assert.ok(calls.quota >= 1);
});

// Ревью Codex #825: ограниченный Weekend Pass при сбое истории не тратит использование.
test('history outage protects a usage-limited Pass like the quota; only an unlimited Pass recomputes', async () => {
  const outage = () => { const error = new Error('down'); error.code = 'HISTORY_UNAVAILABLE'; throw error; };
  const pass = usageLimit => ({ source:'pass', access:{ expandedAi:true }, passes:{ active:[{ id:'p1', type:'WEEKEND_PASS', usageLimit, usageCount:1 }] } });
  const limited = staleRecheckRuntime({ ownership: outage, entitlements: pass(5), reserve: async () => ({ reserved:true }) });
  const response = await limited.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.recheck.reasonCode, 'history_unavailable');
  assert.match(response.body.warning, /лимит не списан/);
  assert.equal(limited.calls.reservations, 0, 'no Pass use is reserved while ownership is unknown');

  const source = readRepoFile('src/analysis-runtime.js');
  assert.match(source, /const unlimitedPassCandidate=passCandidate\s*&& activePasses\.some\(item=>objectValue\(item\) && objectValue\(item\)\.usageLimit==null\);/);
  assert.match(source, /if \(recheckOwnershipUnknown && !unlimitedPassCandidate && staleBefore\)/);
});

// Ревью Codex #868: исчерпанный дневной лимит не отсекает того, у кого есть бонус за приглашение.
test('exhausted daily quota still reaches the referral bonus reservation when a bonus exists', async () => {
  const run = async hasBonus => {
    const calls = { quota:0, bonus:0, check:0 };
    const runtime = createAnalysisRuntime({
      ...baseDeps(),
      getCache: async () => null,
      getStaleCache: async () => null,
      resolveUserEntitlements: async () => ({ source:'free', access:{} }),
      getQuota: async () => ({ plan:'FREE', used:3, limit:3, left:0 }),
      hasReferralBonus: async () => { calls.check += 1; return hasBonus(); },
      claimDistributedAnalysisLock: async () => ({ claimed:true }),
      releaseDistributedAnalysisLock: async () => true,
      reserveAnalysisQuota: async () => { calls.quota += 1; return { allowed:false, plan:'FREE', used:3, limit:3, left:0 }; },
      reserveReferralBonus: async () => { calls.bonus += 1; return { allowed:false, reserved:false, reason:'no_bonus' }; },
    });
    const response = await runtime.apiAnalyze({ json: async () => ({ fixtureId:123 }) }, {}, { id:456 });
    return { response, calls };
  };

  const withBonus = await run(() => true);
  assert.equal(withBonus.calls.check, 1);
  assert.equal(withBonus.calls.quota, 1, 'the guard lets the request through to the reservation');
  assert.equal(withBonus.calls.bonus, 1, 'the bonus reservation is attempted');
  assert.equal(withBonus.response.status, 429, 'a lost race for the bonus still ends with the limit response');

  for (const hasBonus of [() => false, () => { throw new Error('storage down'); }]) {
    const { response, calls } = await run(hasBonus);
    assert.equal(response.status, 429);
    assert.equal(response.body.code, 'ANALYSIS_QUOTA_EXHAUSTED');
    assert.equal(calls.quota, 0);
    assert.equal(calls.bonus, 0);
  }
});

test('client body cannot request the internal system lineup refresh or bypass the cached analysis',async()=>{
  let providerCalls=0;
  const cached={match:{fixtureId:123,status:'NS',date:new Date(Date.now()+3600000).toISOString()},generatedAt:new Date().toISOString()};
  const runtime=createAnalysisRuntime({...baseDeps(),getCache:async()=>cached,
    loadProviderFixture:async()=>{providerCalls++;throw new Error('must stay cached');},
    analysisFreshness:()=>({needsRecheck:false})});
  const response=await runtime.apiAnalyze({json:async()=>({fixtureId:123,system:true,lineupEvent:{force:true}})},{},{id:456});
  assert.equal(response.status,200);
  assert.equal(response.body.cached,true);
  assert.equal(providerCalls,0);
});

function cachedResponseGate() {
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

test('cached response starts history and quota together and schedules growth/referrals only after both finish',async()=>{
  const history=cachedResponseGate(),quota=cachedResponseGate(),events=[],pending=[];
  const cached={generatedAt:new Date().toISOString(),match:{fixtureId:123,status:'NS',date:new Date(Date.now()+3600000).toISOString()}};
  const quotaValue={plan:'FREE',used:2,limit:3,left:1};
  const runtime=createAnalysisRuntime({...baseDeps(),
    getCache:async()=>cached,analysisFreshness:()=>({needsRecheck:false}),newsImpactDeltaStatus:()=>null,
    analysisResponsePayload:(payload,meta)=>({...payload,...meta}),
    recordHistory:async()=>{events.push('history');await history.promise;events.push('history_done');},
    getQuota:async()=>{events.push('quota');const value=await quota.promise;events.push('quota_done');return value;},
    recordGrowthEvent:async()=>{events.push('growth');},
    grantReferralRewards:async()=>{events.push('referral');},
    loadProviderFixture:async()=>{throw new Error('cached response must not call provider');},
  });
  let settled=false;
  const response=runtime.apiAnalyze({json:async()=>({fixtureId:123})},{waitUntil:task=>pending.push(task)},{id:456});
  response.then(()=>{settled=true;});
  for(let i=0;i<12;i++)await Promise.resolve();
  assert.deepEqual(events,['history','quota']);
  quota.resolve(quotaValue);
  for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(settled,false,'history must still finish before the response');
  assert.ok(!events.includes('growth') && !events.includes('referral'));
  history.resolve();
  const result=await response;
  assert.equal(result.status,200);assert.equal(result.body.cached,true);
  assert.deepEqual(result.body.quota,quotaValue);
  assert.ok(events.indexOf('growth')>events.indexOf('quota_done'));
  assert.ok(events.indexOf('referral')>events.indexOf('history_done'));
  assert.equal(events.filter(event=>event==='growth').length,1);
  assert.equal(events.filter(event=>event==='referral').length,1);
  await Promise.all(pending);
});

test('cold analysis reads the shared cache once and still enforces quota',async()=>{
  for(const entry of [null,{payload:{generatedAt:new Date().toISOString(),match:{fixtureId:123,status:'NS'}},expired:true}]){
    let reads=0;
    const runtime=createAnalysisRuntime({
      ...baseDeps(),
      getCacheEntry:async(_key,_cfg,allowExpired)=>{reads++;assert.equal(allowExpired,true);return entry;},
      getCache:async()=>assert.fail('duplicate fresh read'),
      getStaleCache:async()=>assert.fail('duplicate stale read'),
      analysisFreshness:()=>({needsRecheck:true}),
      resolveUserEntitlements:async()=>({source:'free',access:{}}),
      getQuota:async()=>({plan:'FREE',used:3,limit:3,left:0}),
    });
    const response=await runtime.apiAnalyze({json:async()=>({fixtureId:123})},{},{id:456});
    assert.equal(reads,1);assert.equal(response.status,429);
    assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
  }
});

test('single-read cache outages fail soft without bypassing quota',async()=>{
  const runtime=createAnalysisRuntime({
    ...baseDeps(),getCacheEntry:async()=>{throw new Error('cache down');},
    getCache:async()=>assert.fail('duplicate fresh read'),getStaleCache:async()=>assert.fail('duplicate stale read'),
    resolveUserEntitlements:async()=>({source:'free',access:{}}),
    getQuota:async()=>({plan:'FREE',used:3,limit:3,left:0}),
  });
  const response=await runtime.apiAnalyze({json:async()=>({fixtureId:123})},{},{id:456});
  assert.equal(response.status,429);assert.equal(response.body.code,'ANALYSIS_QUOTA_EXHAUSTED');
});

test('single-read fresh cache keeps cached responses and fixture identity checks',async()=>{
  for(const fixtureId of [123,999]){
    let rejected=0;
    const payload={generatedAt:new Date().toISOString(),match:{fixtureId,date:new Date(Date.now()+3600000).toISOString(),status:'NS'}};
    const runtime=createAnalysisRuntime({
      ...baseDeps(),getCacheEntry:async()=>({payload,expired:false}),
      getCache:async()=>assert.fail('duplicate fresh read'),getStaleCache:async()=>assert.fail('duplicate stale read'),
      analysisFreshness:()=>({needsRecheck:false,state:'fresh'}),newsImpactDeltaStatus:()=>null,
      recordHistory:async()=>{},analysisResponsePayload:(value,meta)=>({...value,...meta}),
      recordOpsEvent:async(_cfg,event)=>{if(event.code==='ANALYSIS_CACHE_INVALID')rejected++;},
      resolveUserEntitlements:async()=>({source:'free',access:{}}),
      getQuota:async()=>({plan:'FREE',used:3,limit:3,left:0}),
    });
    const response=await runtime.apiAnalyze({json:async()=>({fixtureId:123})},{},{id:456});
    assert.equal(response.status,fixtureId===123?200:429);
    if(fixtureId===123)assert.equal(response.body.cached,true);
    assert.equal(rejected,fixtureId===123?0:1);
  }
});

test('slow cached analysis reports one bounded phase event through waitUntil without awaiting it',async()=>{
  let at=0;const events=[],pending=[];
  const payload={generatedAt:new Date().toISOString(),match:{fixtureId:123,date:new Date(Date.now()+3600000).toISOString(),status:'NS'}};
  let finish;
  const runtime=createAnalysisRuntime({
    ...baseDeps(),analysisTimingNow:()=>at,
    getCacheEntry:async()=>{at=2400;return {payload,expired:false};},
    analysisFreshness:()=>({needsRecheck:false,state:'fresh'}),newsImpactDeltaStatus:()=>null,
    recordHistory:async()=>{},analysisResponsePayload:(value,meta)=>({...value,...meta}),
    getQuota:async()=>({plan:'FREE',used:0,limit:3,left:3}),
    recordOpsEvent:(_cfg,event)=>{events.push(event);return new Promise(resolve=>{finish=resolve;});},
  });
  const result=await runtime.apiAnalyze({json:async()=>({fixtureId:123})},{waitUntil:task=>pending.push(task)},{id:456});
  assert.equal(result.status,200);assert.equal(events.length,1);assert.equal(pending.length,1);
  assert.equal(events[0].code,'ANALYSIS_SLOW_REQUEST');assert.equal(events[0].durationMs,2400);
  assert.equal(events[0].meta.cacheMs,2400);
  assert.doesNotMatch(JSON.stringify(events[0]),/fixtureId|userId|generatedAt/);
  finish();await pending[0];
});

function deferredValue(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function freshProviderDeps(overrides={}){
  return {...baseDeps(),
    getCache:async()=>null,getStaleCache:async()=>null,
    claimDistributedAnalysisLock:async()=>({claimed:true}),releaseDistributedAnalysisLock:async()=>{},
    loadProviderFixture:async()=>({fixture:{id:123,date:new Date(Date.now()+3600000).toISOString(),status:{short:'NS'}},league:{id:39,season:2026,name:'Premier League'},teams:{home:{id:1,name:'Home'},away:{id:2,name:'Away'}}}),
    validateFixtureIntegrity:()=>({quarantine:false,issues:[],warnings:[]}),
    isYouthReserveMatch:()=>false,isLiveStatus:()=>false,isFinishedStatus:()=>false,
    memory:{provider:{plan:'PRO'}},freeQuotaHealthy:()=>true,
    analysisProviderFetch:async()=>({data:[],meta:{}}),
    recordOpsEvent:async()=>{},...overrides};
}

test('fresh AI requests lineups before unrelated provider requests have finished',async()=>{
  const gate=deferredValue();const lineupStarted=deferredValue();const called=[];
  const rt=createAnalysisRuntime(freshProviderDeps({analysisProviderFetch:async request=>{
    called.push(request.feature);if(request.feature==='lineups')lineupStarted.resolve(request);
    await gate.promise;return {data:[],meta:{}};
  }}));
  const response=rt.analyzeFixtureForSystem(123,{});
  // A scheduling deadline makes the old serial lineup phase fail without hanging.
  let timer;try{
    const request=await Promise.race([lineupStarted.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('lineups waited for other features')),500);})]);
    assert.equal(request.allowed,true);assert.equal(called.length,5);
  }finally{clearTimeout(timer);gate.resolve();}
  const result=await response;assert.equal(result.body.code,'ANALYSIS_MODEL_INVALID');
});

test('season data starts once its cache decision is ready while recent form is still pending',async()=>{
  const gate=deferredValue();const seasonStarted=deferredValue();let formPending=0;
  const rt=createAnalysisRuntime(freshProviderDeps({
    getRecentTeamForm:async()=>{formPending++;await gate.promise;return null;},
    getCache:async key=>{if(key.startsWith('analysis:team-season:'))seasonStarted.resolve();return null;},
  }));
  const response=rt.analyzeFixtureForSystem(123,{});
  let timer;try{
    await Promise.race([seasonStarted.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('season data waited for recent form')),500);})]);
    assert.equal(formPending,2);
  }finally{clearTimeout(timer);gate.resolve();}
  const result=await response;assert.equal(result.body.code,'ANALYSIS_MODEL_INVALID');
});
