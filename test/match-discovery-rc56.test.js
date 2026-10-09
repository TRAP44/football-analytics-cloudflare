import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';

const providerFixtureRuntime=fs.readFileSync(
  'src/provider-fixture-runtime.js',
  'utf8',
);
const searchDiscoveryRuntime=fs.readFileSync(
  'src/search-discovery-runtime.js',
  'utf8',
);
const app=[
  fs.readFileSync('public/app.js','utf8'),
  fs.readFileSync('public/modules/global-search-renderer.js','utf8'),
  fs.readFileSync('public/modules/global-search-controller.js','utf8'),
].join('\n');
const css=fs.readFileSync('public/styles.css','utf8');

const COMPETITIONS=new Map([
  [39,{
    name:'Премьер-лига',
    short:'АПЛ',
    group:'england',
    category:'league',
    tier:'major',
    priority:100,
  }],
]);

function fixture(id,{
  homeId=10,
  awayId=20,
  date='2026-10-08T18:00:00.000Z',
  status='NS',
}={}) {
  return {
    fixture:{id,date,status:{short:status}},
    teams:{
      home:{id:homeId,name:'Home'},
      away:{id:awayId,name:'Away'},
    },
    league:{id:39,name:'Premier League'},
  };
}

function searchDeps(overrides={}) {
  return {
    COMPETITIONS,
    apiFootball:async()=>[],
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFootballRateLimitError:()=>false,
    isRetryableFootballTransportError:()=>false,
    isYouthReserveMatch:()=>false,
    json:(body,status=200,headers={})=>({body,status,headers}),
    loadProviderTeamDiscoveryFixtures:async()=>[],
    normalizeCountryName:value=>String(value || ''),
    normalizeTeamHubMatch:(row,teamId)=>{
      const homeId=Number(row?.teams?.home?.id);
      const awayId=Number(row?.teams?.away?.id);
      if (homeId!==teamId && awayId!==teamId) {
        return {fixtureId:0};
      }
      return {
        fixtureId:Number(row?.fixture?.id) || 0,
        date:String(row?.fixture?.date || ''),
        live:false,
        finished:false,
        home:{name:'Home'},
        away:{name:'Away'},
        league:'Premier League',
        competition:{
          category:'league',
          priority:80,
          name:'Premier League',
        },
      };
    },
    publicDataCapabilities:()=>({}),
    setCache:async()=>{},
    ...overrides,
  };
}

test('RC56 discovers team fixtures through one shared backend path',()=>{
  assert.match(
    searchDiscoveryRuntime,
    /async function loadSearchTeamMatches\(/,
  );
  assert.match(
    searchDiscoveryRuntime,
    /search:team-fixtures:/,
  );
  assert.match(
    searchDiscoveryRuntime,
    /loadProviderTeamDiscoveryFixtures\(teamId,cfg\)/,
  );
  assert.match(
    providerFixtureRuntime,
    /apiFootball\('\/fixtures',\{team:id,next:12\},cfg\)/,
  );
  assert.match(
    providerFixtureRuntime,
    /apiFootball\('\/fixtures',\{team:id,last:8\},cfg\)/,
  );
  assert.doesNotMatch(
    providerFixtureRuntime,
    /apiFootball\('\/fixtures',\{team:id,from,to\},cfg\)/,
  );
});

test('RC56 rejects coercive team identities before discovery or cache selection',()=>{
  const runtime=createSearchDiscoveryRuntime(searchDeps());

  assert.equal(
    runtime.normalizeSearchTeam({
      team:{id:'123',name:'Arsenal'},
    },'arsenal',[]).id,
    123,
  );

  for (const id of [
    true,
    false,
    [123],
    {valueOf(){return 123;}},
    1.5,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.equal(
      runtime.normalizeSearchTeam({
        team:{id,name:'Arsenal'},
      },'arsenal',[]).id,
      null,
      String(id),
    );
  }

  assert.deepEqual(
    runtime.splitTeamDiscoveryMatches([
      {
        fixtureId:[99],
        date:'2099-10-08T18:00:00.000Z',
        live:false,
        finished:false,
        home:{name:'A'},
        away:{name:'B'},
        competition:{category:'league',priority:80},
      },
    ]),
    {
      upcoming:[],
      recent:[],
      primary:null,
      mode:'empty',
    },
  );
});

test('RC56 rejects team and competition caches without exact scope identity',async()=>{
  const teamRuntime=createSearchDiscoveryRuntime(searchDeps({
    getCache:async key=>String(key).startsWith('search:team-fixtures:')
      ? {
          fixtures:[fixture(999)],
          refreshedAt:'2026-10-07T18:00:00.000Z',
        }
      : null,
    freeQuotaHealthy:()=>false,
  }));

  const teamResult=await teamRuntime.loadSearchTeamMatches(
    {id:10,name:'Home'},
    {},
  );

  assert.deepEqual(teamResult.matches,[]);
  assert.equal(teamResult.matchSource.id,10);
  assert.match(teamResult.warning,/бережём остаток лимита/);

  const competitionRuntime=createSearchDiscoveryRuntime(searchDeps({
    getCache:async key=>String(key).startsWith(
      'search:competition-fixtures:',
    )
      ? {
          matches:[{fixtureId:999}],
          refreshedAt:'2026-10-07T18:00:00.000Z',
        }
      : null,
    freeQuotaHealthy:()=>false,
  }));

  const competitionResult=
    await competitionRuntime.loadSearchCompetitionMatches(
      {
        leagueId:39,
        season:2026,
        name:'Premier League',
      },
      {},
    );

  assert.deepEqual(competitionResult.matches,[]);
  assert.equal(competitionResult.matchSource.id,39);
  assert.match(
    competitionResult.warning,
    /бережём остаток лимита/,
  );
});

test('provider team discovery validates team scope before shared caching',()=>{
  assert.match(
    providerFixtureRuntime,
    /positiveSafeInteger\(value\.teamId\)!==teamId/,
  );
  assert.match(
    providerFixtureRuntime,
    /homeId!==id && awayId!==id/,
  );
  assert.match(
    providerFixtureRuntime,
    /seenFixtures\.has\(fixtureId\)/,
  );
  assert.match(
    providerFixtureRuntime,
    /function integerCandidate\(value\)/,
  );
});

test('RC56 preserves upcoming-first discovery with recent-match recovery',()=>{
  const runtime=createSearchDiscoveryRuntime(searchDeps());
  const result=runtime.splitTeamDiscoveryMatches([
    {
      fixtureId:1,
      date:'2099-10-08T18:00:00.000Z',
      live:false,
      finished:false,
      home:{name:'Home'},
      away:{name:'Away'},
      competition:{category:'league',priority:80},
    },
    {
      fixtureId:2,
      date:'2026-10-01T18:00:00.000Z',
      live:false,
      finished:true,
      home:{name:'Home'},
      away:{name:'Away'},
      competition:{category:'league',priority:80},
    },
  ]);

  assert.equal(result.mode,'upcoming');
  assert.equal(result.upcoming[0].fixtureId,1);
  assert.equal(result.recent[0].fixtureId,2);

  const recentOnly=runtime.teamSearchFixturePayload(
    {id:10,name:'Home'},
    [{
      fixtureId:2,
      date:'2026-10-01T18:00:00.000Z',
      live:false,
      finished:true,
      home:{name:'Home'},
      away:{name:'Away'},
      competition:{category:'league',priority:80},
    }],
  );

  assert.equal(recentOnly.matchDiscovery.mode,'recent');
  assert.equal(recentOnly.matchDiscovery.recent,1);
  assert.equal(recentOnly.matches[0].fixtureId,2);
});

test('Mini App reuses search discovery payload without an automatic second team-hub fetch',()=>{
  assert.match(app,/matchDiscovery:matchDiscovery\s*\? safeShallowCopy\(matchDiscovery\)\s*: null/);
  assert.doesNotMatch(
    app,
    /const hub = await api\(`\/api\/team\?teamId=/,
  );
  assert.match(app,/data-search-team=/);
  assert.match(app,/Открыть →/);
  assert.match(css,/\.search-team-summary/);
});

test('zero-result UX remains explicit while backend retains recent recovery',()=>{
  assert.match(readContractSource(new URL('../public/modules/global-search-renderer.js', import.meta.url), 'utf8'),/Матчей сейчас нет/);
  assert.match(readContractSource(new URL('../public/modules/global-search-renderer.js', import.meta.url), 'utf8'),/Матч найден/);
  assert.match(app,/Источник отвечает слишком долго/);
  assert.match(
    searchDiscoveryRuntime,
    /mode:upcoming\.length\s*\? 'upcoming'\s*: recent\.length\s*\? 'recent'\s*: 'empty'/,
  );
});

test('RC56 discovery capabilities are exposed through the current app manifest',()=>{
  const runtime=createAppCapabilitiesRuntime({
    memory:{provider:{plan:'FREE'}},
    appVersion:'test',
    minClientVersion:'test',
    apiContractVersion:1,
    releaseChannel:'test',
    releaseCandidate:'test',
    paidQuotaHealthy:()=>false,
    providerPublicBudgetMode:()=>({
      mode:'normal',
      label:'Норма',
      liveRefreshSeconds:30,
    }),
    runtimeControlsSnapshot:()=>({
      maintenanceMode:false,
      liveEnabled:true,
      expandedDataEnabled:true,
    }),
    isSecurityLockdownControls:()=>false,
    publicRuntimeControls:value=>value,
    currentReleaseIdentity:()=>({}),
    now:()=>new Date('2026-10-07T18:00:00.000Z'),
  });

  const features=runtime.appManifest({}).features;

  for (const flag of [
    'zeroResultRecovery',
    'teamFixtureDiscovery',
    'sharedFixtureDiscoveryCache',
    'extendedTeamCalendar',
    'recentMatchFallback',
    'matchSelectionIntelligence',
    'primaryMatchRecommendation',
  ]) {
    assert.equal(features[flag],true,flag);
  }
});
