import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAppCapabilitiesRuntime } from '../src/app-capabilities.js';
import { createSearchDiscoveryRuntime } from '../src/search-discovery-runtime.js';

const app=[
  fs.readFileSync('public/app.js','utf8'),
  fs.readFileSync('public/modules/global-search-renderer.js','utf8'),
].join('\n');
const telegram=fs.readFileSync('src/telegram-search-runtime.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

const NOW=Date.parse('2026-10-07T18:00:00.000Z');

function deps(overrides={}) {
  return {
    COMPETITIONS:new Map(),
    apiFootball:async()=>[],
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFootballRateLimitError:()=>false,
    isRetryableFootballTransportError:()=>false,
    isYouthReserveMatch:(league,home,away)=>
      /(?:u-?21|youth|reserve)/i.test(
        [league,home,away].join(' '),
      ),
    json:(body,status=200,headers={})=>({body,status,headers}),
    loadProviderTeamDiscoveryFixtures:async()=>[],
    normalizeCountryName:value=>String(value || ''),
    normalizeTeamHubMatch:value=>value,
    publicDataCapabilities:()=>({}),
    setCache:async()=>{},
    ...overrides,
  };
}

function match(fixtureId,{
  date='2026-10-08T18:00:00.000Z',
  category='league',
  priority=80,
  live=false,
  finished=false,
  home='Example FC',
  away='Opponent',
}={}) {
  return {
    fixtureId,
    date,
    live,
    finished,
    league:'Competition',
    home:{name:home},
    away:{name:away},
    competition:{
      category,
      priority,
      friendly:category==='friendly',
      youth:category==='youth',
    },
  };
}

test('RC57 ranks live then official first-team matches before friendlies and youth fixtures',()=>{
  const runtime=createSearchDiscoveryRuntime(deps());
  const ranked=runtime.rankTeamDiscoveryMatches([
    match(1,{
      date:'2026-10-07T19:00:00.000Z',
      category:'friendly',
      priority:99,
    }),
    match(2,{
      date:'2026-10-07T21:00:00.000Z',
      category:'cup',
      priority:70,
    }),
    match(3,{
      date:'2026-10-07T20:00:00.000Z',
      category:'youth',
      priority:99,
      home:'Example FC U21',
    }),
    match(4,{
      date:'2026-10-07T18:10:00.000Z',
      category:'league',
      live:true,
    }),
  ],NOW);

  assert.deepEqual(
    ranked.map(row=>row.fixtureId),
    [4,2,1,3],
  );
  assert.equal(ranked[0].selection.primary,true);
  assert.equal(ranked[1].selection.official,true);
  assert.equal(ranked[2].selection.official,false);
  assert.equal(ranked[3].selection.firstTeam,false);
});

test('stale unfinished fixtures can never become a primary match that is absent from visible discovery',()=>{
  const runtime=createSearchDiscoveryRuntime(deps());
  const staleScheduled=match(10,{
    date:'2026-10-07T10:00:00.000Z',
    category:'league',
  });
  const future=match(11,{
    date:'2026-10-08T18:00:00.000Z',
    category:'league',
  });

  const split=runtime.splitTeamDiscoveryMatches(
    [staleScheduled,future],
    '',
    {now:NOW,upcomingLimit:8,recentLimit:4},
  );

  assert.deepEqual(
    split.upcoming.map(row=>row.fixtureId),
    [11],
  );
  assert.deepEqual(split.recent,[]);
  assert.equal(split.primary.fixtureId,11);
  assert.equal(split.upcoming[0].selection.primary,true);
  assert.equal(
    split.upcoming.some(row=>row.fixtureId===10),
    false,
  );
  assert.deepEqual(
    runtime.rankTeamDiscoveryMatches([staleScheduled],NOW),
    [],
  );

  const payload=runtime.teamSearchFixturePayload(
    {id:7,name:'Example FC'},
    [staleScheduled,future],
    '',
    {now:NOW},
  );
  assert.equal(payload.primaryFixtureId,11);
  assert.ok(
    payload.matches.some(
      row=>row.fixtureId===payload.primaryFixtureId,
    ),
  );
});

test('recent finished match becomes primary when no valid upcoming match survives',()=>{
  const runtime=createSearchDiscoveryRuntime(deps());
  const split=runtime.splitTeamDiscoveryMatches([
    match(20,{
      date:'2026-10-07T08:00:00.000Z',
      category:'league',
      finished:false,
    }),
    match(21,{
      date:'2026-10-06T18:00:00.000Z',
      category:'league',
      finished:true,
    }),
  ],'',{now:NOW});

  assert.deepEqual(split.upcoming,[]);
  assert.deepEqual(
    split.recent.map(row=>row.fixtureId),
    [21],
  );
  assert.equal(split.primary.fixtureId,21);
  assert.equal(split.primary.selection.primary,true);
  assert.equal(split.mode,'recent');
});

test('selection rejects ambiguous timestamps unknown competition identity and coercive priorities',()=>{
  const runtime=createSearchDiscoveryRuntime(deps());

  const ambiguous=runtime.matchSelectionProfile(
    match(30,{
      date:'2026-10-08 18:00:00',
      category:'league',
    }),
    NOW,
  );
  assert.equal(ambiguous.temporalInvalid,true);
  assert.equal(ambiguous.staleUnfinished,true);
  assert.equal(ambiguous.lane,5);

  const invalidFinished=runtime.matchSelectionProfile(
    match(300,{
      date:'not-a-timestamp',
      category:'league',
      finished:true,
    }),
    NOW,
  );
  assert.equal(invalidFinished.temporalInvalid,true);
  assert.equal(invalidFinished.lane,5);

  const unknownCategory=runtime.matchSelectionProfile(
    match(31,{
      category:'',
    }),
    NOW,
  );
  assert.equal(unknownCategory.official,false);
  assert.equal(unknownCategory.lane,2);

  for (const priority of [
    true,
    [99],
    {valueOf(){return 99;}},
  ]) {
    assert.equal(
      runtime.matchSelectionProfile(
        match(32,{priority}),
        NOW,
      ).priority,
      0,
    );
  }
  assert.equal(
    runtime.matchSelectionProfile(
      match(33,{priority:'87.5'}),
      NOW,
    ).priority,
    87.5,
  );
});

test('server selection metadata stays internally consistent for the visible list',()=>{
  const runtime=createSearchDiscoveryRuntime(deps());
  const split=runtime.splitTeamDiscoveryMatches([
    match(40,{
      date:'2026-10-07T20:00:00.000Z',
      category:'friendly',
    }),
    match(41,{
      date:'2026-10-07T21:00:00.000Z',
      category:'cup',
    }),
    match(42,{
      date:'2026-10-06T18:00:00.000Z',
      category:'league',
      finished:true,
    }),
  ],'',{now:NOW});

  const visible=[...split.upcoming,...split.recent];
  const primaries=visible.filter(
    row=>row.selection?.primary===true,
  );

  assert.equal(primaries.length,1);
  assert.equal(primaries[0].fixtureId,split.primary.fixtureId);
  assert.equal(split.primary.fixtureId,41);
  assert.match(
    split.primary.selection.reason,
    /официальный матч основной команды/i,
  );
});

test('Mini App preserves server primary selection without inventing a second ranking model',()=>{
  assert.match(
    app,
    /const matches=mergedRows\(\s*safeRead\(globalSearch,'remoteMatches'\),\s*localMatches,\s*'fixtureId'/,
  );
  assert.match(app,/matchSortTuple/);
  assert.match(app,/left\.rank-right\.rank/);
  assert.match(app,/ОСНОВНОЙ МАТЧ/);
  assert.match(app,/primaryFixtureId/);
  assert.doesNotMatch(
    app,
    /MatchRadar AI выбрал основной матч/,
  );
  assert.match(css,/\.search-match-card\.is-primary/);
});

test('Telegram uses the shared server ranking and keeps primary metadata',()=>{
  assert.match(
    telegram,
    /optionalCall\(rankTeamDiscoveryMatches,\[\],matches\)/,
  );
  assert.match(telegram,/Основной матч для анализа/);
  assert.match(
    telegram,
    /matches\.find\(match=>plainObject\(match\.selection\)\?\.primary === true\)/,
  );
  assert.match(
    telegram,
    /Первый матч — основной выбор MatchRadar AI/,
  );
});

test('RC57 selection capabilities are exposed by the current app manifest',()=>{
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
    'matchSelectionIntelligence',
    'primaryMatchRecommendation',
    'officialMatchPriority',
    'selectionReasonUx',
  ]) {
    assert.equal(features[flag],true,flag);
  }
});
