import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCompetitionIntegrityRuntime } from '../src/competition-integrity-runtime.js';
import { createProviderBudgetRuntime } from '../src/provider-budget-runtime.js';
import { createProviderFixtureRuntime } from '../src/provider-fixture-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

const matchCenterRuntime=readRepoFile('src/match-center-runtime.js');
const analysisRuntime=readRepoFile('src/analysis-runtime.js');
const app=readRepoFile('public/app.js');

function sourceBlock(source,start,end) {
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

function json(body,status=200,headers={}) {
  return {body,status,headers};
}

function competitionRuntime() {
  return createCompetitionIntegrityRuntime({
    APP_VERSION:'test',
    bumpTelemetry:()=>{},
    hasSupabase:()=>false,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isLiveStatus:status=>['1H','HT','2H','ET','LIVE'].includes(String(status || '').toUpperCase()),
    json,
    memory:{},
    recordOpsEvent:async()=>{},
    safeOpsMetadata:value=>value,
    supaSelectMany:async()=>[],
    supaUpsert:async()=>true,
  });
}

function fixture(id,{
  status='NS',
  leagueId=9999,
  leagueName='Club Friendly Games',
  country='World',
  homeName=`Home ${id}`,
  awayName=`Away ${id}`,
}={}) {
  return {
    fixture:{
      id,
      date:'2026-10-07T18:00:00.000Z',
      status:{short:status,long:status,elapsed:status==='1H' ? 20 : null},
    },
    league:{
      id:leagueId,
      name:leagueName,
      country,
      season:2026,
      round:'Regular Season - 1',
      logo:'',
    },
    teams:{
      home:{id:id*2+1,name:homeName,logo:''},
      away:{id:id*2+2,name:awayName,logo:''},
    },
    goals:{home:0,away:0},
  };
}

function fixtureRuntimeDeps(overrides={}) {
  const integrity=competitionRuntime();
  return {
    apiFootball:async()=>[],
    bumpTelemetry:()=>{},
    catalogRank:integrity.catalogRank,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    isFootballRateLimitError:error=>String(error?.code || '').startsWith('FOOTBALL_RATE'),
    isRetryableFootballTransportError:error=>
      ['FOOTBALL_NETWORK','UPSTREAM_TIMEOUT'].includes(String(error?.code || ''))
      || (String(error?.code || '')==='FOOTBALL_HTTP' && [408,500,502,503,504].includes(Number(error?.status))),
    isLiveStatus:status=>['1H','HT','2H','ET','LIVE'].includes(String(status || '').toUpperCase()),
    isTopLeague:()=>false,
    json,
    liveRefreshSeconds:()=>90,
    markCachedSourceMeta:(meta,extra={})=>({...meta,cached:true,...extra}),
    matchInterestScore:integrity.matchInterestScore,
    matchStatusRank:integrity.matchStatusRank,
    normalizeCompetition:(leagueId,leagueName,country)=>leagueId===39
      ? {
          id:39,
          name:'Премьер-лига',
          shortName:'АПЛ',
          country:'Англия',
          featured:true,
          group:'england',
          category:'league',
          tier:'elite',
          youth:false,
          friendly:false,
          lower:false,
          priority:100,
        }
      : {
          id:Number(leagueId || 0),
          name:String(leagueName || 'Товарищеский матч'),
          shortName:'Товарищеский',
          country:String(country || 'Мир'),
          featured:false,
          group:'other',
          category:'friendly',
          tier:'basic',
          youth:false,
          friendly:true,
          lower:false,
          priority:10,
        },
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
    statusLabel:status=>String(status || ''),
    todayUtc:()=> '2026-10-07',
    ...overrides,
  };
}

function providerBudget(plan='FREE') {
  const memory={
    provider:{
      plan,
      dailyLimit:plan==='FREE' ? 100 : 7500,
      dailyRemaining:plan==='FREE' ? 80 : 7000,
      minuteLimit:plan==='FREE' ? 10 : 300,
      minuteRemaining:plan==='FREE' ? 7 : 250,
      cooldownUntil:null,
      updatedAt:'2026-10-07T12:00:00.000Z',
    },
    providerFeatureFetch:{api:0,cache:0,stale:0,skipped:0,byFeature:{},lastUpdatedAt:null},
    telemetry:{},
  };
  const runtime=createProviderBudgetRuntime({
    clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    hasSupabase:()=>false,
    memory,
    phase5ProviderUsage:()=>({}),
    recordOpsEvent:async()=>{},
    runtimeControlsSnapshot:()=>({
      expandedDataEnabled:true,
      liveEnabled:true,
    }),
    setCache:async()=>{},
  });
  return {runtime,memory};
}

test('P0 capped public feed keeps elite upcoming matches ahead of low-value LIVE fixtures',async()=>{
  const rows=[
    ...Array.from({length:121},(_,index)=>fixture(1000+index,{status:'1H'})),
    fixture(1,{
      status:'NS',
      leagueId:39,
      leagueName:'Premier League',
      country:'England',
      homeName:'Arsenal',
      awayName:'Liverpool',
    }),
  ];
  const runtime=createProviderFixtureRuntime(fixtureRuntimeDeps({
    apiFootball:async()=>rows,
  }));

  const response=await runtime.apiMatches(
    {url:'https://example.test/api/matches?date=2026-10-07'},
    {cacheMinutes:10},
  );

  assert.equal(response.status,200);
  assert.equal(response.body.matches.length,120);
  assert.equal(response.body.matches[0].fixtureId,1);
  assert.equal(response.body.matches[0].live,false);
  assert.equal(response.body.matches[0].featured,true);
  assert.ok(response.body.matches.some(row=>row.fixtureId===1));
  assert.ok(response.body.matches.filter(row=>row.live).length<121);
});

test('P0 competition relevance itself is independent from LIVE status',()=>{
  const runtime=competitionRuntime();

  const eliteUpcoming={
    featured:true,
    live:false,
    category:'league',
    competition:{featured:true,category:'league'},
  };
  const friendlyLive={
    featured:false,
    live:true,
    category:'friendly',
    competition:{featured:false,category:'friendly'},
  };

  assert.ok(runtime.catalogRank(eliteUpcoming)<runtime.catalogRank(friendlyLive));
  assert.equal(runtime.matchStatusRank('1H'),0);
  assert.equal(runtime.matchStatusRank('NS'),1);
});

test('P0 All and For You do not inherit unconditional LIVE-first sorting',()=>{
  const filtered=sourceBlock(app,'function filteredMatches','function categoryLabel');
  const liveBranch=filtered.indexOf("state.filter === 'live' && Boolean(a.live) !== Boolean(b.live)");
  const featuredBranch=filtered.indexOf('Boolean(a.featured) !== Boolean(b.featured)');
  const priorityBranch=filtered.indexOf('const ap = Number(a.competition?.priority || 0)');

  assert.ok(liveBranch>=0);
  assert.ok(featuredBranch>liveBranch);
  assert.ok(priorityBranch>featuredBranch);
  assert.doesNotMatch(filtered,/^\s*if \(Boolean\(a\.live\) !== Boolean\(b\.live\)\)/m);
  assert.match(filtered,/state\.filter === 'live'\) byFilter = Boolean\(m\.live\)/);
});

test('P0 FREE provider policy reserves the Match Center events request for AI analysis',()=>{
  const {runtime}=providerBudget('FREE');

  const events=runtime.providerFeaturePolicy('events',{
    mode:'live',
    preserveAiBudget:true,
  });
  const statistics=runtime.providerFeaturePolicy('statistics',{
    mode:'live',
    preserveAiBudget:true,
  });

  assert.equal(events.allowed,false);
  assert.equal(events.reason,'interactive_ai_reserve');
  assert.ok(events.ttlSeconds>=180);
  assert.equal(statistics.allowed,true);
  assert.ok(statistics.ttlSeconds>=180);

  const center=sourceBlock(
    matchCenterRuntime,
    'async function apiMatchCenter',
    '  return Object.freeze({apiMatchCenter});',
  );
  assert.match(center,/preserveAiBudget:budgetProfile\.paid!==true/);
  assert.match(center,/secondaryOpenLigaEvents/);
  assert.match(center,/feature:'statistics',[\s\S]*path:'\/fixtures\/statistics'/);
});

test('P0 public feed cache is longer on FREE than on paid provider plans',async()=>{
  async function cacheTtl(paid) {
    const writes=[];
    const runtime=createProviderFixtureRuntime(fixtureRuntimeDeps({
      apiFootball:async()=>[
        fixture(1,{
          leagueId:39,
          leagueName:'Premier League',
          country:'England',
        }),
      ],
      providerBudgetProfile:()=>({paid}),
      setCache:async(...args)=>writes.push(args),
    }));
    await runtime.apiMatches(
      {url:'https://example.test/api/matches?date=2026-10-07'},
      {cacheMinutes:10},
    );
    return writes.at(-1)?.[4];
  }

  assert.equal(await cacheTtl(false),3);
  assert.equal(await cacheTtl(true),1);
});

test('P0 AI optional availability data fails soft instead of dereferencing null',()=>{
  const analyze=sourceBlock(
    analysisRuntime,
    'async function apiAnalyze',
    '  return Object.freeze({apiAnalyze});',
  );

  assert.match(
    analyze,
    /let normalizedAbsences=null;[\s\S]*try \{[\s\S]*formatAbsences\(trustedInjuries,homeId,awayId,trustedLineups\)[\s\S]*\} catch \{\}/,
  );
  assert.match(
    analyze,
    /normalizedAbsences[\s\S]*Array\.isArray\(normalizedAbsences\.home\)[\s\S]*Array\.isArray\(normalizedAbsences\.away\)/,
  );
  assert.match(
    analyze,
    /methodology:'Данные о потерях недоступны; анализ продолжен без этого сигнала\.'/,
  );
  assert.match(
    analyze,
    /blendProbabilitySignals\(\{[\s\S]*market:analysisMarket,[\s\S]*model:trustedApiPrediction/,
  );
});
