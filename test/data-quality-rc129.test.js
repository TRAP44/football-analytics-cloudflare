import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSharedCacheRuntime } from '../src/cache-runtime.js';
import { createApiFootballGateway } from '../src/api-football-gateway.js';
import { createOddsSnapshotRuntime } from '../src/odds-snapshot-runtime.js';
import { createSettlementRuntime } from '../src/settlement-runtime.js';
import { createMatchCenterRuntime } from '../src/match-center-runtime.js';
import { assessExpectedGoalsQuality } from '../src/xg-quality.js';

const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_19.sql','utf8');

function normalizeThree(a,b,c) {
  const sum=a+b+c;
  if (!Number.isFinite(sum) || sum<=0) return null;
  const round1=value=>Math.round(value*10)/10;
  return {
    home:round1(a/sum*100),
    draw:round1(b/sum*100),
    away:round1(c/sum*100),
  };
}

function predictionOutcomeKey(probabilities) {
  const entries=[
    ['home',Number(probabilities?.home)],
    ['draw',Number(probabilities?.draw)],
    ['away',Number(probabilities?.away)],
  ];
  if (entries.some(([,value])=>!Number.isFinite(value))) return '';
  entries.sort((a,b)=>b[1]-a[1]);
  return entries[0]?.[0] || '';
}

function futureKickoff(minutes=90) {
  return new Date(Date.now()+minutes*60_000).toISOString();
}

test('RC129 migration keeps provenance additive and fingerprint exclusions explicit',()=>{
  assert.match(migration,/alter table public\.analysis_cache[\s\S]*provider text[\s\S]*source_updated_at timestamptz[\s\S]*freshness_status text[\s\S]*updated_at timestamptz/);
  assert.match(migration,/alter table public\.odds_snapshots[\s\S]*provider text[\s\S]*bookmaker_count integer[\s\S]*source_updated_at timestamptz/);
  assert.match(migration,/alter table public\.model_predictions[\s\S]*data_provenance jsonb[\s\S]*model_inputs_version text/);
  assert.doesNotMatch(migration,/create table if not exists public\.(?:analysis_cache|odds_snapshots|model_predictions)/);
  assert.match(migration,/create or replace function public\.backend_schema_fingerprint\(\)/);
  assert.match(
    migration,
    /c\.table_name = 'analysis_cache' and c\.column_name in \('provider','source_updated_at','freshness_status','updated_at'\)/,
  );
});

test('persistent cache provenance requires attributable and measurable source evidence',async()=>{
  let persisted=null;
  const runtime=createSharedCacheRuntime({
    memory:{cache:new Map()},
    hasSupabase:()=>true,
    supaUpsert:async (_cfg,_table,row)=>{ persisted=row; },
  });

  assert.deepEqual(runtime.cacheSourceProvenance({
    sourceMeta:{
      provider:'api-football',
      fetchedAt:'2026-10-07T09:15:30Z',
      freshness:'fresh',
    },
  }),{
    provider:'api-football',
    sourceUpdatedAt:'2026-10-07T09:15:30.000Z',
    freshness:'fresh',
  });

  assert.deepEqual(runtime.cacheSourceProvenance({
    sourceMeta:{provider:'api-football',freshness:'fresh'},
  }),{
    provider:'api-football',
    sourceUpdatedAt:null,
    freshness:'unknown',
  });

  assert.deepEqual(runtime.cacheSourceProvenance({
    sourceMeta:{
      provider:'api-football',
      fetchedAt:'2026-10-07T09:15:30',
      freshness:'fresh',
    },
    generatedAt:'2026-10-07T09:15:31Z',
  }),{
    provider:'api-football',
    sourceUpdatedAt:null,
    freshness:'unknown',
  });

  assert.deepEqual(runtime.cacheSourceProvenance({
    sourceMeta:{
      provider:{name:'api-football'},
      fetchedAt:'2026-10-07T09:15:30Z',
      freshness:'fresh',
    },
  }),{
    provider:'',
    sourceUpdatedAt:'2026-10-07T09:15:30.000Z',
    freshness:'unknown',
  });

  await runtime.setCache('fixture:123',123,{
    sourceMeta:{
      provider:'api-football',
      fetchedAt:'2026-10-07T09:15:30Z',
      freshness:'cached',
    },
  },{},10);

  assert.equal(persisted.provider,'api-football');
  assert.equal(persisted.source_updated_at,'2026-10-07T09:15:30.000Z');
  assert.equal(persisted.freshness_status,'cached');
});

test('odds snapshots persist only validated market evidence and never invent upstream time',async()=>{
  const writes=[];
  const runtime=createOddsSnapshotRuntime({
    hasSupabase:()=>true,
    memory:{oddsSnapshots:new Map()},
    normalizeThree,
    sanitizeOddsSnapshotsForMovement:value=>Array.isArray(value) ? value : [],
    supaSelectMany:async()=>[],
    supaUpsert:async (_cfg,_table,row)=>{ writes.push(row); },
  });

  const saved=await runtime.saveOddsSnapshot(321,{
    odds:{home:2,draw:3.2,away:4.1},
    probabilities:{home:99,draw:0,away:1},
    sources:3,
    provider:'api-football',
    updatedAt:'2026-10-07T09:20:00+00:00',
  },{});

  assert.equal(saved,true);
  assert.equal(writes.length,1);
  const row=writes[0];
  assert.equal(row.fixture_id,321);
  assert.equal(row.source_count,3);
  assert.equal(row.bookmaker_count,3);
  assert.equal(row.provider,'api-football');
  assert.equal(row.source_updated_at,'2026-10-07T09:20:00.000Z');
  assert.deepEqual(
    {home:row.home_prob,draw:row.draw_prob,away:row.away_prob},
    normalizeThree(1/2,1/3.2,1/4.1),
  );

  const malformedTime=await runtime.saveOddsSnapshot(322,{
    odds:{home:1.8,draw:3.5,away:5.2},
    sources:2,
    provider:'api-football',
    updatedAt:'2026-10-07T09:21:00',
  },{});
  assert.equal(malformedTime,true);
  assert.equal(writes.at(-1).source_updated_at,null);

  const before=writes.length;
  assert.equal(await runtime.saveOddsSnapshot(false,{
    odds:{home:2,draw:3,away:4},
    sources:2,
    provider:'api-football',
  },{}),false);
  assert.equal(await runtime.saveOddsSnapshot(323,{
    odds:{home:false,draw:3,away:4},
    sources:2,
    provider:'api-football',
  },{}),false);
  assert.equal(await runtime.saveOddsSnapshot(323,{
    odds:{home:2,draw:3,away:4},
    sources:false,
    provider:'api-football',
  },{}),false);
  assert.equal(await runtime.saveOddsSnapshot(323,{
    odds:{home:2,draw:3,away:4},
    sources:2,
    provider:{name:'api-football'},
  },{}),false);
  assert.equal(writes.length,before);
});

test('odds history drops malformed persisted rows before movement analytics',async()=>{
  const runtime=createOddsSnapshotRuntime({
    hasSupabase:()=>true,
    memory:{oddsSnapshots:new Map()},
    normalizeThree,
    sanitizeOddsSnapshotsForMovement:value=>Array.isArray(value) ? value : [],
    supaSelectMany:async()=>[
      {
        snapshot_time:'2026-10-07T09:00:00Z',
        home_odd:'2.0',
        draw_odd:'3.0',
        away_odd:'4.0',
        source_count:'2',
      },
      {
        snapshot_time:'2026-10-07T09:01:00Z',
        home_odd:false,
        draw_odd:'3.0',
        away_odd:'4.0',
        source_count:'2',
      },
      {
        snapshot_time:'2026-10-07T09:02:00',
        home_odd:'2.1',
        draw_odd:'3.1',
        away_odd:'4.1',
        source_count:'2',
      },
      {
        snapshot_time:'2026-10-07T09:03:00Z',
        home_odd:'2.1',
        draw_odd:'3.1',
        away_odd:'4.1',
        source_count:'0',
      },
    ],
    supaUpsert:async()=>{},
  });

  const rows=await runtime.getOddsSnapshots(777,{},12);
  assert.equal(rows.length,1);
  assert.equal(rows[0].at,'2026-10-07T09:00:00.000Z');
  assert.equal(rows[0].sources,2);
  assert.deepEqual(
    {home:rows[0].homeProb,draw:rows[0].drawProb,away:rows[0].awayProb},
    normalizeThree(1/2,1/3,1/4),
  );
});

test('model prediction capture keeps provenance objects and goal metrics type-safe',async()=>{
  const writes=[];
  const runtime=createSettlementRuntime({
    memory:{modelPredictions:new Map()},
    hasSupabase:()=>true,
    supaInsertIgnore:async (_cfg,_table,row)=>{ writes.push(row); },
    predictionOutcomeKey,
    signalProbabilitySnapshot:signals=>({
      count:Array.isArray(signals) ? signals.length : -1,
    }),
  });

  const malformed=await runtime.captureModelPrediction({
    analysisVersion:{toString(){ throw new Error('must not coerce'); }},
    match:{
      fixtureId:901,
      date:futureKickoff(),
      status:'NS',
      leagueId:39,
      league:'Premier League',
      home:{id:1,name:'Home'},
      away:{id:2,name:'Away'},
    },
    probabilities:{home:45,draw:30,away:25},
    rawProbabilities:{home:false,draw:'30',away:{}},
    confidence:{score:'88'},
    modelBreakdown:{signals:{bad:true},weights:[]},
    modelCalibration:{temperature:'2',sample:false,signalWeights:[]},
    dataPolicy:{mode:'balanced-free'},
    completeness:{score:'80',max:false},
    goalModel:{homeExpected:false,awayExpected:null,over25:'55',btts:{}},
    dataProvenance:['bad'],
  },{});

  assert.equal(malformed,true);
  assert.equal(writes.length,1);
  const malformedRow=writes[0];
  assert.equal(malformedRow.analysis_version,'3.7.0-model-calibration');
  assert.equal(malformedRow.model_inputs_version,'');
  assert.deepEqual(malformedRow.data_provenance,{});
  assert.deepEqual(malformedRow.signal_weights,{});
  assert.deepEqual(malformedRow.signal_probabilities,{count:0});
  assert.equal(malformedRow.home_expected_goals,null);
  assert.equal(malformedRow.away_expected_goals,null);
  assert.equal(malformedRow.over25_prob,null);
  assert.equal(malformedRow.btts_prob,null);
  assert.equal(malformedRow.confidence_score,null);
  assert.equal(malformedRow.raw_home_prob,45);
  assert.equal(malformedRow.raw_draw_prob,30);
  assert.equal(malformedRow.raw_away_prob,25);

  const valid=await runtime.captureModelPrediction({
    analysisVersion:'4.15.0-availability-quality',
    match:{
      fixtureId:902,
      date:futureKickoff(120),
      status:'NS',
      leagueId:39,
      league:'Premier League',
      home:{id:3,name:'Alpha'},
      away:{id:4,name:'Beta'},
    },
    probabilities:{home:50,draw:28,away:22},
    confidence:{score:84},
    modelBreakdown:{signals:[{name:'market'}],weights:{market:.42}},
    modelCalibration:{temperature:1.05,sample:200,signalWeights:{market:.42}},
    dataPolicy:{mode:'expanded'},
    completeness:{score:8,max:10},
    goalModel:{homeExpected:1.7,awayExpected:.9,over25:53.4,btts:49.8},
    dataProvenance:{primaryProvider:'api-football'},
  },{});

  assert.equal(valid,true);
  const validRow=writes.at(-1);
  assert.equal(validRow.model_inputs_version,'4.15.0-availability-quality');
  assert.deepEqual(validRow.data_provenance,{primaryProvider:'api-football'});
  assert.equal(validRow.home_expected_goals,1.7);
  assert.equal(validRow.away_expected_goals,.9);
  assert.equal(validRow.over25_prob,53.4);
  assert.equal(validRow.btts_prob,49.8);
  assert.deepEqual(validRow.signal_weights,{market:.42});
});

test('API-Football retry policy retries transient transport failures but not quota policy',()=>{
  const gateway=createApiFootballGateway({
    memory:{provider:{}},
    providerPlanLimits:{},
    providerBudgetFloors:{FREE:{dailyReserve:20}},
    hasSupabase:()=>false,
    supaRpc:async()=>null,
    bumpTelemetry:()=>{},
    recordOpsEvent:async()=>{},
    loadSharedProviderState:async()=>{},
    phase5ProviderUsage:()=>{},
    persistSharedProviderCooldown:async()=>{},
    fetchWithTimeout:async()=>null,
    updateProviderFromHeaders:()=>{},
    persistSharedProviderQuota:async()=>{},
    providerQuotaEvidence:()=>({}),
    providerSnapshot:()=>({}),
    withSingleFlight:async (_key,run)=>await run(),
    sleepMs:async()=>{},
  });

  assert.equal(gateway.isRetryableFootballTransportError({code:'FOOTBALL_NETWORK'}),true);
  assert.equal(gateway.isRetryableFootballTransportError({code:'UPSTREAM_TIMEOUT'}),true);
  for (const status of [500,502,503,504]) {
    assert.equal(gateway.isRetryableFootballTransportError({code:'FOOTBALL_HTTP',status}),true,String(status));
  }
  for (const error of [
    {code:'FOOTBALL_HTTP',status:400},
    {code:'FOOTBALL_HTTP',status:429},
    {code:'FOOTBALL_RATE_LIMIT',status:429},
    {code:'FOOTBALL_COOLDOWN'},
    {code:'FOOTBALL_DAILY_RESERVE'},
  ]) {
    assert.equal(gateway.isRetryableFootballTransportError(error),false,JSON.stringify(error));
  }

  assert.deepEqual(gateway.providerTransportPolicy({
    responseType:'broken',
    transportRetries:99,
    timeoutMs:100,
    allowDailyReserve:'true',
  }),{
    responseType:'array',
    transportRetries:1,
    timeoutMs:500,
    allowDailyReserve:false,
  });
});

test('Match Center returns a plain 404 when the requested fixture does not exist',async()=>{
  let providerCalls=0;
  const deps=new Proxy({
    json:(payload,status=200,headers={})=>({payload,status,headers}),
    getCache:async()=>null,
    loadProviderFixture:async()=>{ providerCalls+=1; return null; },
  },{
    get(target,property) {
      if (property in target) return target[property];
      return ()=>null;
    },
  });
  const runtime=createMatchCenterRuntime(deps);

  const response=await runtime.apiMatchCenter({
    url:'https://example.test/api/match-center?fixtureId=123',
  },{});

  assert.equal(providerCalls,1);
  assert.equal(response.status,404);
  assert.deepEqual(response.payload,{error:'Матч не найден.'});
});

test('provider xG remains a provider statistic and internal goal model stays separate',()=>{
  const trustedMeta={
    provider:'api-football',
    source:'network',
    available:true,
    usable:true,
    stale:false,
    confidenceBearing:true,
    freshnessState:'fresh',
    provenanceState:'verified',
  };

  const providerXg=assessExpectedGoalsQuality({
    items:[
      {key:'expected_goals',home:'1.35',away:.75},
      {key:'home_expected_goals',home:9,away:9},
    ],
  },{statisticsMeta:trustedMeta,mode:'live'});

  assert.equal(providerXg.state,'verified');
  assert.equal(providerXg.confidenceBearing,true);
  assert.equal(providerXg.home.value,1.35);
  assert.equal(providerXg.away.value,.75);

  const internalOnly=assessExpectedGoalsQuality({
    items:[{key:'home_expected_goals',home:1.35,away:.75}],
  },{statisticsMeta:trustedMeta,mode:'live'});

  assert.equal(internalOnly.state,'unavailable');
  assert.equal(internalOnly.observed,false);
  assert.equal(internalOnly.confidenceBearing,false);
});
