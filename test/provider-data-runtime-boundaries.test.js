import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderDataRuntime } from '../src/provider-data-runtime.js';

function makeRuntime(overrides = {}) {
  const calls = {
    api: 0,
    cacheWrites: [],
    counters: [],
  };
  const deps = {
    apiFootball: async () => {
      calls.api += 1;
      return [];
    },
    featureCacheAgeSeconds: payload => {
      const at = Date.parse(payload?.fetchedAt || '');
      return Number.isFinite(at) ? Math.max(0, Math.floor((Date.now() - at) / 1000)) : null;
    },
    getCache: async () => null,
    getCacheEntry: async () => null,
    isFinishedStatus: status => ['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isFootballRateLimitError: error => String(error?.code || '') === 'FOOTBALL_RATE_LIMIT',
    isLiveStatus: status => ['1H','2H','HT','ET','P'].includes(String(status || '').toUpperCase()),
    memory: { providerE2E:{ last:null } },
    providerFeatureCounter: (feature, type) => calls.counters.push([feature, type]),
    providerFeaturePolicy: feature => ({ feature, allowed:true, reason:'', ttlSeconds:45 }),
    redactOpsString: value => String(value || '').slice(0, 160),
    setCache: async (...args) => {
      calls.cacheWrites.push(args);
    },
    ...overrides,
  };
  return { runtime:createProviderDataRuntime(deps), calls };
}

test('provider data state fails closed on malformed non-array responses', () => {
  const { runtime } = makeRuntime();
  const malformed = runtime.providerDataState({ unexpected:true }, { attempted:true });

  assert.equal(malformed.state, 'invalid_response');
  assert.equal(malformed.available, false);
  assert.equal(malformed.observed, false);
  assert.equal(malformed.usable, false);
  assert.equal(malformed.degraded, true);
  assert.equal(malformed.reason, 'invalid_data_shape');
  assert.equal(malformed.count, 0);
});

test('provider feature fetch rejects invalid fixture ids before provider/cache work', async () => {
  let cacheReads = 0;
  const { runtime, calls } = makeRuntime({
    getCacheEntry: async () => {
      cacheReads += 1;
      return null;
    },
  });

  const result = await runtime.providerFeatureFetch({
    feature:'events',
    path:'/fixtures/events',
    params:{ fixture:1.5 },
    fixtureId:1.5,
    cfg:{},
    context:{ mode:'live' },
  });

  assert.deepEqual(result.data, []);
  assert.equal(result.meta.reason, 'invalid_fixture');
  assert.equal(result.meta.source, 'skipped');
  assert.equal(calls.api, 0);
  assert.equal(cacheReads, 0);
  assert.equal(calls.cacheWrites.length, 0);
});

test('provider feature cache validates fixture identity and writes versioned envelopes', async () => {
  const writes = [];
  let apiCalls = 0;
  const now = new Date().toISOString();
  const { runtime } = makeRuntime({
    getCacheEntry: async (_key, _cfg, allowExpired) => allowExpired ? null : ({
      payload:{
        fixtureId:999,
        feature:'events',
        data:[{ id:'wrong-fixture' }],
        provider:'api-football',
        fetchedAt:now,
      },
      expiresAt:new Date(Date.now() + 60_000).toISOString(),
    }),
    apiFootball: async () => {
      apiCalls += 1;
      return [{ id:'fresh' }];
    },
    setCache: async (...args) => writes.push(args),
  });

  const result = await runtime.providerFeatureFetch({
    feature:'events',
    path:'/fixtures/events',
    params:{ fixture:123 },
    fixtureId:123,
    cfg:{},
    context:{ mode:'live' },
  });

  assert.equal(apiCalls, 1);
  assert.deepEqual(result.data, [{ id:'fresh' }]);
  assert.equal(result.meta.source, 'network');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'provider-feature:events:123:v5.0');
  assert.equal(writes[0][1], 123);
  assert.equal(writes[0][2].fixtureId, 123);
  assert.equal(writes[0][2].feature, 'events');
  assert.deepEqual(writes[0][2].data, [{ id:'fresh' }]);
});

test('provider fetch does not cache malformed network payloads', async () => {
  const { runtime, calls } = makeRuntime({
    apiFootball: async () => {
      calls.api += 1;
      return { unexpected:true };
    },
  });

  const result = await runtime.analysisProviderFetch({
    feature:'predictions',
    path:'/predictions',
    params:{ fixture:123 },
    fixtureId:123,
    cfg:{},
  });

  assert.deepEqual(result.data, []);
  assert.equal(result.meta.state, 'invalid_response');
  assert.equal(result.meta.source, 'error');
  assert.equal(result.meta.degraded, true);
  assert.equal(calls.cacheWrites.length, 0);
});

test('provider source summary maps network traffic to api and stale-cache to stale', () => {
  const { runtime } = makeRuntime();
  const summary = runtime.providerFeatureSourcesSummary({
    events:{ source:'network' },
    statistics:{ source:'api' },
    lineups:{ source:'cache' },
    injuries:{ source:'stale-cache' },
    players:{ source:'embedded' },
    liveOdds:{ source:'error' },
  });

  assert.deepEqual(summary, {
    api:2,
    cache:1,
    embedded:1,
    stale:1,
    skipped:0,
    error:1,
    other:0,
  });
});

test('provider validation status fails closed on empty or unknown states', () => {
  const { runtime } = makeRuntime();

  assert.equal(runtime.providerValidationStatus([]).ready, false);
  assert.equal(runtime.providerValidationStatus([{ state:'unknown' }]).ready, false);
  assert.equal(runtime.providerValidationStatus([{ state:'pass' }]).code, 'READY');
  assert.equal(runtime.providerValidationStatus([{ state:'warn' }]).code, 'READY_WITH_LIMITATIONS');
});

test('provider reliability self-test still passes after boundary hardening', () => {
  const { runtime } = makeRuntime();
  assert.equal(runtime.providerDataReliabilitySelfTest().pass, true);
});



test('provider rejects coerced fixture identifiers before any cache or API work',async()=>{
  const ids=[true,false,[123],{toString:()=>123},'1e3','+123','12.5',-1,Number.MAX_SAFE_INTEGER+1];
  for(const fixtureId of ids){
    let reads=0;
    const {runtime,calls}=makeRuntime({getCacheEntry:async()=>{reads++;return null;}});
    const result=await runtime.providerFeatureFetch({
      feature:'events',fixtureId,path:'/fixtures/events',cfg:{},context:{mode:'live'},
    });
    assert.equal(result.meta.reason,'invalid_fixture');
    assert.equal(reads,0);
    assert.equal(calls.api,0);
  }
});

test('provider policy must explicitly allow network requests with boolean true',async()=>{
  for(const allowed of ['false','true',1,null,undefined,{}]){
    const {runtime,calls}=makeRuntime({
      providerFeaturePolicy:()=>({allowed,reason:'quota_hold',ttlSeconds:30}),
    });
    const result=await runtime.providerFeatureFetch({
      feature:'events',fixtureId:123,path:'/fixtures/events',cfg:{},context:{mode:'live'},
    });
    assert.equal(result.meta.source,'skipped');
    assert.equal(result.meta.reason,'quota_hold');
    assert.equal(calls.api,0);
    assert.equal(calls.cacheWrites.length,0);
  }
  const {runtime,calls}=makeRuntime();
  const result=await runtime.providerFeatureFetch({feature:'events',fixtureId:'00123',cfg:{},context:{mode:'live'}});
  assert.equal(result.meta.source,'network');
  assert.equal(calls.api,1);
});

test('provider stale cache remains marked untrusted during quota denial',async()=>{
  const stale={
    payload:{fixtureId:123,feature:'events',data:[{id:44}],fetchedAt:'2026-10-01T10:00:00Z'},
    expiresAt:'2026-10-01T11:00:00Z',
  };
  const {runtime,calls}=makeRuntime({
    providerFeaturePolicy:()=>({allowed:false,reason:'quota_hold',ttlSeconds:60}),
    getCacheEntry:async(_key,_cfg,expired)=>expired?stale:null,
  });
  const value=await runtime.providerFeatureFetch({
    feature:'events',fixtureId:123,cfg:{},context:{mode:'live'},
  });
  assert.deepEqual(value.data,[{id:44}]);
  assert.equal(value.meta.source,'stale');
  assert.equal(value.meta.available,false);
  assert.equal(value.meta.usable,false);
  assert.equal(value.meta.degraded,true);
  assert.equal(calls.api,0);
  assert.equal(calls.cacheWrites.length,0);
});

test('provider caches only canonical fixture identifiers from validated network results',async()=>{
  const {runtime,calls}=makeRuntime({
    apiFootball:async()=>[{event:'goal'}],
  });
  const result=await runtime.providerFeatureFetch({
    feature:'events',fixtureId:'000123',cfg:{},path:'/fixtures/events',context:{mode:'live'},
  });
  assert.equal(result.meta.source,'network');
  assert.equal(calls.cacheWrites.length,1);
  assert.equal(calls.cacheWrites[0][0],'provider-feature:events:123:v5.0');
  assert.equal(calls.cacheWrites[0][2].fixtureId,123);
});
