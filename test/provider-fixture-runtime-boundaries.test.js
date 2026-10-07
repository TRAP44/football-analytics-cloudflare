import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createProviderFixtureRuntime } from '../src/provider-fixture-runtime.js';

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function fixture(id,status='NS',elapsed=null,homeId=1,awayId=2) {
  return {
    fixture:{
      id,
      date:'2026-10-06T18:00:00.000Z',
      status:{short:status,long:status,elapsed},
    },
    league:{
      id:39,
      name:'Premier League',
      country:'England',
      season:2026,
      round:'Regular Season - 1',
      logo:'',
    },
    teams:{
      home:{id:homeId,name:'Home',logo:''},
      away:{id:awayId,name:'Away',logo:''},
    },
    goals:{home:0,away:0},
  };
}

function deps(overrides={}) {
  return {
    apiFootball:async()=>[],
    bumpTelemetry:()=>{},
    catalogRank:()=>0,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isFootballRateLimitError:error=>String(error?.code || '').startsWith('FOOTBALL_RATE'),
    isRetryableFootballTransportError:error=>
      ['FOOTBALL_NETWORK','UPSTREAM_TIMEOUT'].includes(String(error?.code || ''))
      || (String(error?.code || '')==='FOOTBALL_HTTP' && [408,500,502,503,504].includes(Number(error?.status))),
    isLiveStatus:status=>['1H','2H','HT'].includes(String(status || '').toUpperCase()),
    isTopLeague:()=>false,
    json,
    liveRefreshSeconds:()=>30,
    markCachedSourceMeta:(meta,extra={})=>({...meta,cached:true,...extra}),
    matchInterestScore:()=>1,
    matchStatusRank:()=>0,
    normalizeCompetition:()=>({
      name:'Premier League',
      shortName:'EPL',
      country:'England',
      featured:false,
      group:'england',
      category:'league',
      tier:'major',
      youth:false,
      friendly:false,
      lower:false,
      priority:100,
    }),
    normalizeRoundLabel:value=>String(value || ''),
    persistIntegrityRun:async()=>true,
    providerBudgetProfile:()=>({paid:false}),
    publicDataCapabilities:()=>({provider:'api-football'}),
    runMatchIntegrityGuard:(fixtures,date)=>({
      accepted:fixtures.map(row=>({
        fixture:row,
        integrity:{state:'clean',score:100,warnings:0,infos:0,issues:[]},
      })),
      report:{
        requestedDate:date,
        inspected:fixtures.length,
        accepted:fixtures.length,
        clean:fixtures.length,
        incomplete:0,
        warningMatches:0,
        quarantined:0,
        duplicates:0,
        repaired:0,
        warnings:0,
        errors:0,
        qualityScore:100,
        health:'ok',
      },
      issues:[],
    }),
    scoreSnapshot:row=>({
      home:row?.goals?.home ?? null,
      away:row?.goals?.away ?? null,
    }),
    setCache:async()=>{},
    settlePredictionsFromFixtures:async()=>true,
    sourceMeta:value=>value,
    statusLabel:(_status,elapsed)=>String(elapsed ?? ''),
    todayUtc:()=> '2026-10-06',
    ...overrides,
  };
}

test('provider fixture runtime fails fast and exposes an immutable surface', () => {
  const broken=deps();
  delete broken.apiFootball;
  assert.throws(
    () => createProviderFixtureRuntime(broken),
    /apiFootball is required/,
  );

  const runtime=createProviderFixtureRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('fixture/date cache keys reject invalid calendar dates and unsafe ids without version churn', () => {
  const runtime=createProviderFixtureRuntime(deps());

  assert.equal(runtime.providerFixtureDateCacheKey('2026-02-31'),'');
  assert.equal(runtime.providerTeamDiscoveryCacheKey(1.5),'');
  assert.equal(runtime.providerFixtureDirectCacheKey(-1),'');
  assert.equal(runtime.providerFixtureDirectCacheKey(Number.MAX_SAFE_INTEGER+1),'');

  assert.equal(runtime.providerFixtureDateCacheKey('2026-10-06'),'provider-fixtures:2026-10-06:v1');
  assert.equal(runtime.providerTeamDiscoveryCacheKey(77),'provider-team-discovery:77:v1');
  assert.equal(runtime.providerFixtureDirectCacheKey(123),'provider-fixture:123:v1');
});

test('date loader reuses legacy warm cache and rejects malformed network payloads', async () => {
  let apiCalls=0;
  const cachedRuntime=createProviderFixtureRuntime(deps({
    getCache:async key=>key==='provider-fixtures:2026-10-06:v1'
      ? {fixtures:[fixture(11)]}
      : null,
    apiFootball:async()=>{
      apiCalls+=1;
      return [];
    },
  }));

  const cached=await cachedRuntime.loadProviderFixturesForDate('2026-10-06',{});
  assert.equal(cached.length,1);
  assert.equal(cached[0].fixture.id,11);
  assert.equal(apiCalls,0);

  const malformedRuntime=createProviderFixtureRuntime(deps({
    apiFootball:async()=>({unexpected:true}),
  }));
  await assert.rejects(
    () => malformedRuntime.loadProviderFixturesForDate('2026-10-06',{}),
    error=>error?.code==='FOOTBALL_INVALID_RESPONSE',
  );

  assert.deepEqual(
    await malformedRuntime.loadProviderFixturesForDate('2026-99-99',{}),
    [],
  );
});

test('team discovery keeps usable half of a two-request fanout and short-caches partial results', async () => {
  const writes=[];
  let calls=0;
  const runtime=createProviderFixtureRuntime(deps({
    apiFootball:async(_path,params)=>{
      calls+=1;
      if (params.next) {
        const error=new Error('timeout');
        error.code='UPSTREAM_TIMEOUT';
        throw error;
      }
      return [fixture(22,'FT',null,77,2),fixture(22,'FT',null,77,2),fixture(23,'FT',null,3,77)];
    },
    setCache:async(...args)=>writes.push(args),
  }));

  const rows=await runtime.loadProviderTeamDiscoveryFixtures(
    77,
    {},
    {forceRefresh:true},
  );

  assert.equal(calls,2);
  assert.deepEqual(rows.map(row=>row.fixture.id),[22,23]);
  assert.equal(writes.length,1);
  assert.equal(writes[0][0],'provider-team-discovery:77:v1');
  assert.equal(writes[0][4],5);
  assert.equal(writes[0][2].teamId,77);
  assert.equal(writes[0][2].partial,true);
});

test('team discovery rejects fixtures outside the requested team scope', async () => {
  let calls=0;
  const runtime=createProviderFixtureRuntime(deps({
    apiFootball:async()=>{
      calls+=1;
      return [
        fixture(31,'FT',null,1,2),
        fixture(32,'FT',null,77,4),
        fixture(33,'FT',null,5,77),
      ];
    },
  }));

  const rows=await runtime.loadProviderTeamDiscoveryFixtures(
    77,
    {},
    {forceRefresh:true},
  );

  assert.equal(calls,2);
  assert.deepEqual(rows.map(row=>row.fixture.id),[32,33]);
});

test('direct fixture loader only accepts the requested fixture identity', async () => {
  const writes=[];
  const runtime=createProviderFixtureRuntime(deps({
    apiFootball:async()=>[
      fixture(999),
      fixture(123),
    ],
    setCache:async(...args)=>writes.push(args),
  }));

  const row=await runtime.loadProviderFixture(123,{});

  assert.equal(row.fixture.id,123);
  assert.equal(writes.length,1);
  assert.equal(writes[0][0],'provider-fixture:123:v1');
  assert.equal(writes[0][2].fixtureId,123);
  assert.equal(writes[0][2].fixture.fixture.id,123);
});

test('public match feed serves stale cache on retryable transport failure with bounded retry metadata', async () => {
  const error=new Error('provider timeout');
  error.code='UPSTREAM_TIMEOUT';
  error.retryAfter=Number.POSITIVE_INFINITY;

  const stalePayload={
    date:'2026-10-06',
    matches:[{fixtureId:123}],
    refreshedAt:'2026-10-06T17:00:00.000Z',
    sourceMeta:{provider:'api-football',label:'API-Football'},
  };

  const runtime=createProviderFixtureRuntime(deps({
    apiFootball:async()=>{ throw error; },
    getCache:async()=>null,
    getStaleCache:async key=>key==='matches:2026-10-06:v6-integrity'
      ? stalePayload
      : null,
  }));

  const response=await runtime.apiMatches(
    {url:'https://example.test/api/matches?date=2026-10-06'},
    {cacheMinutes:10},
  );

  assert.equal(response.body.cached,true);
  assert.equal(response.body.stale,true);
  assert.equal(response.body.retryAfter,15);
  assert.match(response.body.warning,/временно недоступен/);
});

test('fresh match feed preserves elapsed zero and normalizes public ids', async () => {
  const runtime=createProviderFixtureRuntime(deps({
    apiFootball:async()=>[fixture('123','1H',0)],
  }));

  const response=await runtime.apiMatches(
    {url:'https://example.test/api/matches?date=2026-10-06'},
    {cacheMinutes:10},
  );

  assert.equal(response.body.cached,false);
  assert.equal(response.body.matches.length,1);
  assert.equal(response.body.matches[0].fixtureId,123);
  assert.equal(response.body.matches[0].home.id,1);
  assert.equal(response.body.matches[0].away.id,2);
  assert.equal(response.body.matches[0].elapsed,0);
});

test('worker passes retryable provider classification into the fixture runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const runtime=fs.readFileSync('src/provider-fixture-runtime.js','utf8');

  assert.match(
    worker,
    /createProviderFixtureRuntime\(\{[\s\S]*?isRetryableFootballTransportError[\s\S]*?\}\);/,
  );
  assert.match(runtime,/recoverableProviderError/);
  assert.match(runtime,/FOOTBALL_INVALID_RESPONSE/);
  assert.match(runtime,/matches:\$\{date\}:v6-integrity/);
});
