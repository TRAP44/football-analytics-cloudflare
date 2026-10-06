import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createMatchCenterRuntime } from '../src/match-center-runtime.js';

function fixture(overrides={}) {
  return {
    fixture:{
      id:123,
      date:'2030-01-01T12:00:00Z',
      status:{short:'NS',long:'Not Started',elapsed:null},
      venue:{name:'Stadium',city:'City'},
      referee:'',
      timezone:'UTC',
    },
    league:{
      id:39,
      name:'Premier League',
      logo:'https://example.test/league.png',
      country:'England',
      round:'Round 1',
    },
    teams:{
      home:{id:1,name:'Home',logo:'https://example.test/home.png'},
      away:{id:2,name:'Away',logo:'https://example.test/away.png'},
    },
    score:{halftime:{home:null,away:null},fulltime:{home:null,away:null}},
    ...overrides,
  };
}

function unavailableMeta(feature) {
  return {
    feature,
    provider:'api-football',
    source:'network',
    state:'empty_response',
    available:false,
    usable:false,
    observed:true,
    confidenceBearing:false,
    stale:false,
    provenanceState:'verified',
    freshnessState:'fresh',
  };
}

function baseDeps(overrides={}) {
  const freshness=meta=>({
    ...(meta && typeof meta==='object' ? meta : {}),
    stale:false,
    freshnessState:'fresh',
    provenanceState:'verified',
    confidenceBearing:meta?.available===true && meta?.usable!==false,
  });
  return {
    annotateAvailabilityReliability:(meta,quality)=>({...meta,confidenceBearing:quality?.confidenceBearing===true,provenanceState:meta?.provenanceState || 'verified'}),
    annotateEventReliability:(meta,quality)=>({...meta,confidenceBearing:quality?.confidenceBearing===true,provenanceState:meta?.provenanceState || 'verified'}),
    annotateLineupReliability:(meta,quality)=>({...meta,confidenceBearing:quality?.bothConfirmed===true,provenanceState:meta?.provenanceState || 'verified'}),
    annotateOddsReliability:(meta,quality)=>({...meta,confidenceBearing:quality?.confidenceBearing===true,provenanceState:meta?.provenanceState || 'verified'}),
    annotateStatisticsReliability:(meta,quality)=>({...meta,confidenceBearing:quality?.confidenceBearing===true,provenanceState:meta?.provenanceState || 'verified'}),
    applyFeatureFreshness:freshness,
    applyFeatureFreshnessMap:(meta)=>Object.fromEntries(Object.entries(meta || {}).map(([key,value])=>[key,freshness(value)])),
    assessExpectedGoalsQuality:()=>({state:'unavailable',observed:false,confidenceBearing:false}),
    assessFixtureAvailabilityQuality:()=>({state:'unavailable',observed:false,acceptedCount:0,rejectedCount:0,confidenceBearing:false}),
    assessMatchEventQuality:()=>({state:'unavailable',observed:false,confidenceBearing:false}),
    assessMatchLineups:()=>({home:{confirmed:false},away:{confirmed:false},bothConfirmed:false,bothPublished:false,anyPublished:false,confirmedSides:0,partialSides:0}),
    assessMatchStatisticsQuality:()=>({state:'unavailable',observed:false,confidenceBearing:false}),
    assessOddsMarketQuality:()=>({state:'unavailable',marketValid:false,confidenceBearing:false}),
    buildAiTimeline:({match,events})=>({match,events}),
    buildLiveAiCoach:()=>null,
    buildOddsMovement:()=>null,
    buildPostMatchReview:()=>null,
    buildSmartMatchInsights:()=>null,
    embeddedLiveData:()=>({events:[],statistics:[],players:[],lineups:[]}),
    eventsForTrustedAnalytics:()=>[],
    extractLiveMarket:()=>null,
    formatAbsences:()=>({home:[],away:[],summary:{home:{total:0},away:{total:0},resolvedByLineup:0},resolvedByLineup:{home:[],away:[]}}),
    formatLineups:()=>({}),
    formatLiveEvents:()=>[],
    formatLiveStatistics:()=>({items:[],home:{values:{}},away:{values:{}}}),
    formatPlayerLeaders:()=>({home:[],away:[]}),
    getCache:async()=>null,
    getOddsSnapshots:async()=>[],
    getStaleCache:async()=>null,
    isFinishedStatus:status=>String(status || '').toUpperCase()==='FT',
    isFootballRateLimitError:()=>false,
    isRetryableFootballTransportError:()=>false,
    isLiveStatus:status=>['1H','HT','2H','ET','P'].includes(String(status || '').toUpperCase()),
    isYouthReserveMatch:()=>false,
    json:(body,status=200,headers={})=>({body,status,headers}),
    livePressure:()=>null,
    loadFixtureAiTimeline:async()=>null,
    loadModelPredictionForFixture:async()=>null,
    loadProviderFixture:async()=>fixture(),
    oddsMarketForTrustedAnalytics:()=>null,
    providerBudgetProfile:()=>({paid:false,mode:'normal',liveRefreshSeconds:30}),
    providerDataState:(data)=>({
      state:Array.isArray(data) && data.length ? 'available' : 'empty_response',
      available:Array.isArray(data) && data.length>0,
      usable:Array.isArray(data) && data.length>0,
      observed:true,
      count:Array.isArray(data) ? data.length : 0,
    }),
    providerFeatureFetch:async({feature})=>({data:[],meta:unavailableMeta(feature)}),
    providerFeaturePolicy:()=>({}),
    providerPublicBudgetMode:()=> 'normal',
    publicDataCapabilities:()=>({}),
    recordOpsEvent:async()=>{},
    runtimeControlsSnapshot:()=>({liveEnabled:true}),
    sanitizeAvailabilityRows:()=>[],
    sanitizeEventsForDisplay:()=>[],
    sanitizeExpectedGoalsForDisplay:value=>value,
    sanitizeStatisticsForDisplay:value=>value,
    saveOddsSnapshot:async()=>{},
    saveRefereeMatchHistory:async()=>{},
    scoreSnapshot:()=>({home:0,away:0}),
    secondaryOddsMarket:async()=>null,
    secondaryOpenLigaEvents:async()=>null,
    setCache:async()=>{},
    settlePredictionsFromFixtures:async()=>{},
    statisticsForTrustedAnalytics:value=>value,
    statisticsForTrustedExpectedGoals:value=>value,
    statusLabel:status=>status,
    usableOddsFeatureMeta:meta=>meta,
    validateFixtureIntegrity:()=>({state:'valid',qualityScore:100,quarantine:false,warnings:[],issues:[]}),
    ...overrides,
  };
}

function request(value='123') {
  return {url:`https://example.test/api/match-center?fixtureId=${encodeURIComponent(value)}`};
}

test('Match Center validates dependencies and freezes the public API', () => {
  const broken=baseDeps();
  delete broken.getCache;
  assert.throws(
    () => createMatchCenterRuntime(broken),
    /getCache is required/,
  );

  const runtime=createMatchCenterRuntime(baseDeps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('Match Center rejects coercive, fractional and malformed fixture ids', async () => {
  const runtime=createMatchCenterRuntime(baseDeps());

  assert.equal((await runtime.apiMatchCenter(request('true'),{})).status,400);
  assert.equal((await runtime.apiMatchCenter(request('1.5'),{})).status,400);
  assert.equal((await runtime.apiMatchCenter({url:'not a url'},{})).status,400);
});

test('cache outages fail soft while cross-fixture cache rows are rejected', async () => {
  const events=[];
  let providerCalls=0;
  const runtime=createMatchCenterRuntime(baseDeps({
    getCache:async()=>({
      mode:'upcoming',
      match:{fixtureId:999},
    }),
    loadProviderFixture:async()=>{
      providerCalls+=1;
      return fixture();
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(providerCalls,1);
  assert.equal(events[0].code,'MATCH_CENTER_CACHE_INVALID');

  const cacheDown=createMatchCenterRuntime(baseDeps({
    getCache:async()=>{ throw new Error('cache down'); },
  }));
  assert.equal((await cacheDown.apiMatchCenter(request(),{})).status,200);
});

test('cached live signals are revalidated against current feature freshness', async () => {
  let providerCalls=0;
  const cached={
    generatedAt:new Date().toISOString(),
    mode:'live',
    match:{fixtureId:123,status:'1H'},
    events:[{id:'e1'}],
    statistics:{items:[{key:'Total Shots',home:5,away:4}]},
    livePressure:{home:60,away:40},
    smartInsights:{items:[{title:'Old'}]},
    liveAiCoach:{state:'holds'},
    liveOdds:{odds:{home:2,draw:3,away:4}},
    oddsMovement:{sample:2},
    xgQuality:{confidenceBearing:true},
    liveOddsQuality:{confidenceBearing:true},
    availabilityQuality:{confidenceBearing:true},
    lineupQuality:{bothConfirmed:true},
    playerLeaders:{home:[{id:1}],away:[]},
    absences:{home:[{id:7}],away:[]},
    availability:{
      events:true,statistics:true,xg:true,players:true,injuries:true,
      liveOdds:true,lineupsTrusted:true,lineupsConfirmed:true,
    },
    dataFreshness:{
      events:{feature:'events',provider:'api-football',source:'network',available:true,usable:true},
      statistics:{feature:'statistics',provider:'api-football',source:'network',available:true,usable:true},
      players:{feature:'players',provider:'api-football',source:'network',available:true,usable:true},
      injuries:{feature:'injuries',provider:'api-football',source:'network',available:true,usable:true},
      lineups:{feature:'lineups',provider:'api-football',source:'network',available:true,usable:true},
      liveOdds:{feature:'liveOdds',provider:'api-football',source:'network',available:true,usable:true},
    },
  };

  const runtime=createMatchCenterRuntime(baseDeps({
    getCache:async()=>cached,
    loadProviderFixture:async()=>{
      providerCalls+=1;
      return fixture();
    },
    applyFeatureFreshnessMap:meta=>Object.fromEntries(
      Object.entries(meta || {}).map(([feature,value])=>[
        feature,
        {
          ...value,
          stale:['statistics','liveOdds','lineups'].includes(feature),
          provenanceState:'verified',
          confidenceBearing:!['statistics','liveOdds','lineups'].includes(feature),
        },
      ]),
    ),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(providerCalls,0);
  assert.equal(response.body.cached,true);
  assert.equal(response.body.livePressure,null);
  assert.equal(response.body.smartInsights,null);
  assert.equal(response.body.liveAiCoach,null);
  assert.equal(response.body.liveOdds,null);
  assert.equal(response.body.oddsMovement,null);
  assert.equal(response.body.availability.statistics,false);
  assert.equal(response.body.availability.xg,false);
  assert.equal(response.body.availability.liveOdds,false);
  assert.equal(response.body.availability.lineupsTrusted,false);
  assert.equal(response.body.availability.lineupsConfirmed,false);
});

test('provider fixture identity mismatch fails closed', async () => {
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>fixture({
      fixture:{
        ...fixture().fixture,
        id:999,
      },
    }),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,409);
  assert.equal(response.body.code,'MATCH_IDENTITY_MISMATCH');
});

test('invalid or duplicate team identity fails closed', async () => {
  for (const teams of [
    {home:{id:true,name:'Home'},away:{id:2,name:'Away'}},
    {home:{id:1,name:'Home'},away:{id:1,name:'Away'}},
  ]) {
    const runtime=createMatchCenterRuntime(baseDeps({
      loadProviderFixture:async()=>fixture({teams}),
    }));
    const response=await runtime.apiMatchCenter(request(),{});
    assert.equal(response.status,409);
    assert.equal(response.body.code,'MATCH_TEAM_IDENTITY_INVALID');
  }
});

test('optional live provider failures do not destroy the core Match Center response', async () => {
  const liveFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'1H',long:'First Half',elapsed:20},
    },
  });
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    providerFeatureFetch:async()=>{ throw new Error('feature provider down'); },
  }));

  const response=await runtime.apiMatchCenter(request(),{liveOddsEnabled:true});
  assert.equal(response.status,200);
  assert.equal(response.body.mode,'live');
  assert.equal(response.body.availability.events,false);
  assert.equal(response.body.availability.statistics,false);
  assert.equal(response.body.availability.injuries,false);
  assert.equal(response.body.availability.liveOdds,false);
});

test('untrusted lineup metadata cannot confirm XI or reconcile absences', async () => {
  let lineupArgument='not-called';
  const liveFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'1H',long:'First Half',elapsed:10},
    },
  });
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    embeddedLiveData:()=>({
      events:[],
      statistics:[],
      players:[],
      lineups:[{team:{id:1}}],
    }),
    applyFeatureFreshness:meta=>({
      ...meta,
      stale:false,
      freshnessState:'fresh',
      provenanceState:meta?.feature==='lineups' ? 'unknown' : 'verified',
      confidenceBearing:meta?.feature==='lineups'
        ? false
        : meta?.available===true,
    }),
    assessMatchLineups:()=>({
      home:{confirmed:true},
      away:{confirmed:true},
      bothConfirmed:true,
      bothPublished:true,
      anyPublished:true,
      confirmedSides:2,
      partialSides:0,
    }),
    annotateLineupReliability:meta=>({
      ...meta,
      confidenceBearing:false,
      provenanceState:'unknown',
    }),
    formatLineups:()=>({
      home:{startXI:Array.from({length:11},(_,i)=>({id:i+1}))},
      away:{startXI:Array.from({length:11},(_,i)=>({id:i+20}))},
    }),
    formatAbsences:(_rows,_home,_away,lineups)=>{
      lineupArgument=lineups;
      return {home:[],away:[]};
    },
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(response.body.availability.lineups,true);
  assert.equal(response.body.availability.lineupsTrusted,false);
  assert.equal(response.body.availability.lineupsConfirmed,false);
  assert.equal(lineupArgument,null);
});

test('untrusted player metadata excludes player leaders from public availability', async () => {
  let rowsSeen=null;
  const liveFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'1H',long:'First Half',elapsed:10},
    },
  });
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    embeddedLiveData:()=>({
      events:[],
      statistics:[],
      players:[{team:{id:1},players:[{player:{id:7,name:'P'}}]}],
      lineups:[],
    }),
    applyFeatureFreshness:meta=>({
      ...meta,
      stale:false,
      freshnessState:'fresh',
      provenanceState:'unknown',
      confidenceBearing:false,
    }),
    formatPlayerLeaders:rows=>{
      rowsSeen=rows;
      return {home:[{id:7}],away:[]};
    },
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.deepEqual(rowsSeen,[]);
  assert.equal(response.body.availability.players,false);
});

test('live prematch handoff rejects cross-fixture AI snapshots', async () => {
  let prematchSeen='unset';
  const liveFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'1H',long:'First Half',elapsed:15},
    },
  });
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    getStaleCache:async key=>key.startsWith('fixture:')
      ? {match:{fixtureId:999},probabilities:{home:60,draw:25,away:15}}
      : null,
    buildLiveAiCoach:input=>{
      prematchSeen=input.prematch;
      return {state:'ok'};
    },
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(prematchSeen,null);
});

test('live refresh interval is bounded and runtime controls can disable it', async () => {
  const liveFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'1H',long:'First Half',elapsed:15},
    },
  });

  const low=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    providerBudgetProfile:()=>({paid:false,mode:'normal',liveRefreshSeconds:1}),
  }));
  assert.equal((await low.apiMatchCenter(request(),{})).body.refreshSeconds,10);

  const disabled=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>liveFixture,
    providerBudgetProfile:()=>({paid:false,mode:'normal',liveRefreshSeconds:999}),
    runtimeControlsSnapshot:()=>({liveEnabled:false}),
  }));
  assert.equal((await disabled.apiMatchCenter(request(),{})).body.refreshSeconds,0);
});

test('cache write failures do not erase a completed Match Center response', async () => {
  const events=[];
  const runtime=createMatchCenterRuntime(baseDeps({
    setCache:async()=>{ throw new Error('cache write failed'); },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(response.body.persistence.cacheStored,false);
  assert.ok(events.some(event=>event.code==='MATCH_CENTER_CACHE_WRITE_FAILED'));
});

test('transient provider failure serves stale live data without stale AI signals', async () => {
  const stale={
    generatedAt:'2026-10-07T10:00:00Z',
    mode:'live',
    match:{fixtureId:123,status:'1H'},
    livePressure:{home:90},
    smartInsights:{items:['old']},
    liveAiCoach:{signal:'old'},
    liveOdds:{odds:{home:2}},
    oddsMovement:{home:-5},
    availability:{events:true,statistics:true,xg:true,players:true,injuries:true,liveOdds:true,lineupsConfirmed:true,lineupsTrusted:true},
    dataFreshness:{},
  };
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>{ throw Object.assign(new Error('provider down'),{retryAfter:12}); },
    getStaleCache:async()=>stale,
    isRetryableFootballTransportError:()=>true,
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(response.body.stale,true);
  assert.equal(response.body.livePressure,null);
  assert.equal(response.body.smartInsights,null);
  assert.equal(response.body.liveAiCoach,null);
  assert.equal(response.body.liveOdds,null);
  assert.equal(response.body.oddsMovement,null);
  assert.equal(response.body.availability.events,false);
  assert.equal(response.body.availability.xg,false);
  assert.equal(response.body.retryAfter,12);
});

test('finished Match Center rejects a cross-fixture model prediction', async () => {
  let predictionSeen='unset';
  const finishedFixture=fixture({
    fixture:{
      ...fixture().fixture,
      status:{short:'FT',long:'Match Finished',elapsed:90},
      referee:'Referee',
    },
  });
  const events=[];
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>finishedFixture,
    loadModelPredictionForFixture:async()=>({
      fixture_id:999,
      predicted_outcome:'home',
    }),
    buildPostMatchReview:input=>{
      predictionSeen=input.prediction;
      return {available:false};
    },
    recordOpsEvent:async(_cfg,event)=>events.push(event),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.status,200);
  assert.equal(predictionSeen,null);
  assert.ok(events.some(event=>event.code==='POST_MATCH_PREDICTION_IDENTITY_MISMATCH'));
});

test('public Match Center payload sanitizes external image URLs', async () => {
  const runtime=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>fixture({
      league:{
        id:39,
        name:'League',
        logo:'javascript:alert(1)',
        country:'Country',
        round:'R1',
      },
      teams:{
        home:{id:1,name:'Home',logo:'javascript:alert(1)'},
        away:{id:2,name:'Away',logo:'https://example.test/away.png'},
      },
    }),
  }));

  const response=await runtime.apiMatchCenter(request(),{});
  assert.equal(response.body.match.leagueLogo,'');
  assert.equal(response.body.match.home.logo,'');
  assert.match(response.body.match.away.logo,/^https:/);

  const credentials=createMatchCenterRuntime(baseDeps({
    loadProviderFixture:async()=>fixture({
      teams:{
        home:{id:1,name:'Home',logo:'https://user:pass@example.test/home.png'},
        away:{id:2,name:'Away',logo:'https://example.test/away.png'},
      },
    }),
  }));
  const credentialResponse=await credentials.apiMatchCenter(request(),{});
  assert.equal(credentialResponse.body.match.home.logo,'');
});

test('worker keeps Match Center composition explicit and runtime export frozen', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/match-center-runtime.js','utf8');

  assert.match(
    worker,
    /createMatchCenterRuntime\(\{[\s\S]*?annotateAvailabilityReliability,[\s\S]*?applyFeatureFreshnessMap,[\s\S]*?assessExpectedGoalsQuality,[\s\S]*?loadProviderFixture,[\s\S]*?setCache,[\s\S]*?validateFixtureIntegrity,[\s\S]*?\}\);/,
  );
  assert.match(source,/safeProviderFeatureFetch/);
  assert.match(source,/prematchAnalysisPayload/);
  assert.match(source,/lineupsConfirmed:lineupTrusted/);
  assert.match(source,/return Object\.freeze\(\{apiMatchCenter\}\)/);
});
