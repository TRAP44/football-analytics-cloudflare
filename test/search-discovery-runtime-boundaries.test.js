import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';

const COMPETITIONS=new Map([
  [39,{name:'Премьер-лига',short:'АПЛ',group:'england',category:'league',tier:'major',priority:100}],
  [140,{name:'Ла Лига',short:'Ла Лига',group:'spain',category:'league',tier:'major',priority:98}],
]);

function normalizeTeamHubMatch(fixture) {
  const id=Number(fixture?.fixture?.id);
  return {
    fixtureId:Number.isSafeInteger(id) && id>0 ? id : null,
    date:String(fixture?.fixture?.date || ''),
    live:String(fixture?.fixture?.status?.short || '').toUpperCase()==='1H',
    finished:String(fixture?.fixture?.status?.short || '').toUpperCase()==='FT',
    home:{name:String(fixture?.teams?.home?.name || '')},
    away:{name:String(fixture?.teams?.away?.name || '')},
    league:String(fixture?.league?.name || 'League'),
    competition:{category:'league',priority:80,name:'League'},
  };
}

function deps(overrides={}) {
  return {
    COMPETITIONS,
    apiFootball:async()=>[],
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFootballRateLimitError:error=>String(error?.code || '').startsWith('FOOTBALL_RATE'),
    isRetryableFootballTransportError:error=>
      ['UPSTREAM_TIMEOUT','FOOTBALL_NETWORK'].includes(String(error?.code || ''))
      || String(error?.code || '')==='FOOTBALL_INVALID_RESPONSE',
    isYouthReserveMatch:(_league,home,away)=>
      /\b(?:u\d{2}|reserve|youth)\b/i.test(`${home || ''} ${away || ''}`),
    json:(body,status=200,headers={})=>({body,status,headers}),
    loadProviderTeamDiscoveryFixtures:async()=>[],
    normalizeCountryName:value=>String(value || ''),
    normalizeTeamHubMatch,
    publicDataCapabilities:()=>({provider:'test'}),
    setCache:async()=>{},
    ...overrides,
  };
}

function fixture(id,{
  date='2026-10-07T18:00:00.000Z',
  status='NS',
  home='Home',
  away='Away',
}={}) {
  return {
    fixture:{id,date,status:{short:status}},
    teams:{
      home:{id:10,name:home},
      away:{id:20,name:away},
    },
    league:{id:39,name:'Premier League'},
  };
}

test('search discovery requires competition catalog and all runtime dependencies', () => {
  const broken=deps();
  delete broken.COMPETITIONS;

  assert.throws(
    () => createSearchDiscoveryRuntime(broken),
    /COMPETITIONS is required/,
  );

  const brokenRetry=deps();
  delete brokenRetry.isRetryableFootballTransportError;
  assert.throws(
    () => createSearchDiscoveryRuntime(brokenRetry),
    /isRetryableFootballTransportError is required/,
  );

  assert.equal(Object.isFrozen(createSearchDiscoveryRuntime(deps())),true);
});

test('search alias and match-selection drills remain green', () => {
  const runtime=createSearchDiscoveryRuntime(deps());

  assert.deepEqual(runtime.searchQualityDrill(),{
    pass:true,
    total:21,
    failed:0,
  });
  assert.equal(runtime.matchSelectionDrill().pass,true);
  assert.equal(runtime.matchSelectionDrill().primaryFixtureId,2);
});

test('known competition search uses injected catalog instead of undeclared worker globals', () => {
  const runtime=createSearchDiscoveryRuntime(deps());

  const results=runtime.searchKnownCompetitions('АПЛ');
  assert.equal(results.length,1);
  assert.equal(results[0].leagueId,39);
  assert.equal(results[0].score,220);

  const malformedQuery=runtime.searchKnownCompetitions({unexpected:true});
  assert.equal(malformedQuery.length,2);
  assert.ok(malformedQuery.every(row=>Number.isFinite(row.score)));
});

test('team normalization rejects unsafe ids and does not depend on undeclared regex globals', () => {
  const runtime=createSearchDiscoveryRuntime(deps());

  const team=runtime.normalizeSearchTeam({
    team:{
      id:'123',
      name:'Manchester United',
      country:'England',
      founded:'1878',
      national:false,
    },
  },'мю',runtime.topTeamSearchCandidates('мю'));

  assert.equal(team.id,123);
  assert.equal(team.name,'Manchester United');
  assert.equal(team.founded,1878);
  assert.equal(team.youthReserve,false);
  assert.ok(team.score>=170);

  const unsafe=runtime.normalizeSearchTeam({
    team:{
      id:1.5,
      name:'Example U21',
      country:'England',
    },
  },'example',{unexpected:true});

  assert.equal(unsafe.id,null);
  assert.equal(unsafe.youthReserve,true);
  assert.ok(Number.isFinite(unsafe.score));
});

test('competition fixture discovery rejects invalid season and malformed provider collections', async () => {
  let apiCalls=0;
  const runtime=createSearchDiscoveryRuntime(deps({
    apiFootball:async()=>{
      apiCalls+=1;
      return {unexpected:true};
    },
  }));

  const invalidSeason=await runtime.loadSearchCompetitionMatches({
    leagueId:39,
    season:1.5,
    name:'League',
  },{});
  assert.deepEqual(invalidSeason,{
    matches:[],
    matchSource:null,
    warning:'',
  });
  assert.equal(apiCalls,0);

  const malformed=await runtime.loadSearchCompetitionMatches({
    leagueId:39,
    season:2026,
    name:'League',
  },{});
  assert.equal(malformed.matches.length,0);
  assert.match(malformed.warning,/временно недоступен/);
  assert.equal(apiCalls,1);
});

test('competition stale cache must belong to the requested competition', async () => {
  const runtime=createSearchDiscoveryRuntime(deps({
    freeQuotaHealthy:()=>false,
    getStaleCache:async()=>({
      matchSource:{kind:'competition',id:140,name:'Wrong league'},
      matches:[{fixtureId:999}],
    }),
  }));

  const result=await runtime.loadSearchCompetitionMatches({
    leagueId:39,
    season:2026,
    name:'Premier League',
  },{});

  assert.deepEqual(result.matches,[]);
  assert.equal(result.matchSource.id,39);
  assert.match(result.warning,/бережём остаток лимита/);
});

test('valid competition cache is reused without provider work', async () => {
  let providerCalls=0;
  const runtime=createSearchDiscoveryRuntime(deps({
    getCache:async()=>({
      matchSource:{kind:'competition',id:39,name:'Premier League'},
      matches:[{fixtureId:10}],
      refreshedAt:'2026-10-06T18:00:00.000Z',
    }),
    apiFootball:async()=>{
      providerCalls+=1;
      return [];
    },
  }));

  const result=await runtime.loadSearchCompetitionMatches({
    leagueId:39,
    season:2026,
    name:'Premier League',
  },{});

  assert.equal(result.cached,true);
  assert.equal(result.matches[0].fixtureId,10);
  assert.equal(providerCalls,0);
});

test('match ranking tolerates malformed collections, NaN priorities and hostile limits', () => {
  const runtime=createSearchDiscoveryRuntime(deps());

  assert.deepEqual(runtime.rankTeamDiscoveryMatches({unexpected:true}),[]);

  const profile=runtime.matchSelectionProfile({
    fixtureId:5,
    date:'2026-10-07T10:00:00.000Z',
    competition:{category:'league',priority:'NaN'},
    home:{name:'Home'},
    away:{name:'Away'},
  },Date.parse('2026-10-06T00:00:00.000Z'));

  assert.equal(profile.priority,0);
  assert.ok(Number.isFinite(profile.distanceMs));

  const split=runtime.splitTeamDiscoveryMatches([
    {
      fixtureId:1,
      date:'2099-10-07T10:00:00.000Z',
      finished:false,
      live:false,
      competition:{category:'league',priority:80},
      home:{name:'A'},
      away:{name:'B'},
    },
    {
      fixtureId:2,
      date:'2099-10-08T10:00:00.000Z',
      finished:false,
      live:false,
      competition:{category:'league',priority:80},
      home:{name:'A'},
      away:{name:'B'},
    },
  ],'',{
    upcomingLimit:999999,
    recentLimit:-3,
  });

  assert.equal(split.upcoming.length,2);
  assert.equal(split.recent.length,0);
});

test('team discovery validates provider collections and cache identity', async () => {
  const malformed=createSearchDiscoveryRuntime(deps({
    loadProviderTeamDiscoveryFixtures:async()=>({unexpected:true}),
  }));

  const malformedResult=await malformed.loadSearchTeamMatches({
    id:10,
    name:'Home',
  },{});

  assert.deepEqual(malformedResult.matches,[]);
  assert.match(malformedResult.warning,/временно недоступен/);

  const wrongCache=createSearchDiscoveryRuntime(deps({
    getCache:async()=>({
      teamId:20,
      fixtures:[fixture(1)],
    }),
    freeQuotaHealthy:()=>false,
  }));

  const wrongCacheResult=await wrongCache.loadSearchTeamMatches({
    id:10,
    name:'Home',
  },{});

  assert.deepEqual(wrongCacheResult.matches,[]);
  assert.match(wrongCacheResult.warning,/бережём остаток лимита/);
});

test('retryable team-search failure is not cached as an empty 24-hour success', async () => {
  const writes=[];
  const error=new Error('timeout');
  error.code='UPSTREAM_TIMEOUT';

  const runtime=createSearchDiscoveryRuntime(deps({
    apiFootball:async()=>{ throw error; },
    setCache:async(...args)=>writes.push(args),
  }));

  const response=await runtime.apiSearch({
    url:'https://example.test/api/search?q=zzzzzz',
  },{});

  assert.deepEqual(response.body.teams,[]);
  assert.match(response.body.warning,/временно недоступен/);
  assert.equal(writes.length,0);
});

test('valid team search is normalized, deduplicated and cached', async () => {
  const writes=[];
  const runtime=createSearchDiscoveryRuntime(deps({
    apiFootball:async(path)=>{
      if (path==='/teams') {
        return [
          {team:{id:10,name:'Arsenal',country:'England'}},
          {team:{id:10,name:'Arsenal duplicate',country:'England'}},
          {team:{id:1.5,name:'Broken',country:'England'}},
        ];
      }
      return [];
    },
    loadProviderTeamDiscoveryFixtures:async()=>[
      fixture(100,{home:'Arsenal',away:'Chelsea'}),
    ],
    setCache:async(...args)=>writes.push(args),
  }));

  const response=await runtime.apiSearch({
    url:'https://example.test/api/search?q=Arsenal',
  },{});

  assert.equal(response.body.teams.length,1);
  assert.equal(response.body.teams[0].id,10);
  assert.equal(response.body.teams[0].name,'Arsenal');
  assert.ok(writes.some(args=>String(args[0]).startsWith('search:teams:')));
});

test('public catalog copies do not expose mutable internal team alias data', () => {
  const runtime=createSearchDiscoveryRuntime(deps());
  const first=runtime.TOP_TEAM_SEARCH_CATALOG[0];

  assert.equal(Object.isFrozen(runtime.TOP_TEAM_SEARCH_CATALOG),true);
  assert.equal(Object.isFrozen(first),true);
  assert.equal(Object.isFrozen(first.aliases),true);
  assert.throws(
    () => first.aliases.push('mutated'),
    TypeError,
  );
  assert.equal(runtime.topTeamSearchPlan('arsenal').best.canonical,'Arsenal');
});

test('worker wires search catalog and retryable classifier without eager TDZ', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const runtimeSource=fs.readFileSync('src/search-discovery-runtime.js','utf8');

  assert.match(
    worker,
    /const\s*\{[\s\S]*?COMPETITIONS[\s\S]*?\}\s*=\s*createCompetitionIntegrityRuntime/,
  );
  assert.match(
    worker,
    /createSearchDiscoveryRuntime\(\{[\s\S]*?COMPETITIONS[\s\S]*?isRetryableFootballTransportError[\s\S]*?\}\);/,
  );
  assert.match(
    worker,
    /const TOP_TEAM_SEARCH_CATALOG = new Proxy\(\[\],/,
  );
  assert.doesNotMatch(
    worker,
    /SEARCH_COMPETITION_ALIASES = \(\.\.\.args\)/,
  );
  assert.match(runtimeSource,/FOOTBALL_INVALID_RESPONSE/);
  assert.match(runtimeSource,/if \(!providerDegraded\) await setCache/);
  assert.match(runtimeSource,/return Object\.freeze\(\{/);
});
