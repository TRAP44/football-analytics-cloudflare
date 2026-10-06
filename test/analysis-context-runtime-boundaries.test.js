import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';

function deps(overrides = {}) {
  return {
    analysisQualityGate:()=>({
      state:'ready',
      allowSignal:true,
      reasons:[],
      metrics:{},
    }),
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getStaleCache:async()=>null,
    marketMovementNote:()=> '',
    refereeProfile:value=>value ? {name:String(value),available:true} : {name:'',available:false},
    resolveTeamSeasonPlayers:async()=>({
      available:false,
      players:[],
      reason:'unavailable',
    }),
    setCache:async()=>true,
    ...overrides,
  };
}

function validPlayerStats() {
  return {
    available:true,
    complete:true,
    partial:false,
    scope:'team-season',
    players:[{id:1,name:'Player'}],
    summary:{
      count:1,
      complete:true,
      pagesLoaded:1,
      pagesTotal:1,
      sourceScope:'team-season',
    },
    reason:'',
  };
}

test('analysis context validates dependencies and freezes exports', () => {
  const broken=deps();
  delete broken.analysisQualityGate;
  assert.throws(
    () => createAnalysisContextRuntime(broken),
    /analysisQualityGate is required/,
  );

  const runtime=createAnalysisContextRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('cached team intelligence rejects invalid ids, cross-scope rows and cache failures', async () => {
  let reads=0;
  const runtime=createAnalysisContextRuntime(deps({
    getStaleCache:async()=>{
      reads+=1;
      return {
        stats:{
          available:true,
          team:{id:99},
          league:{id:39,season:2026},
        },
        playerStats:validPlayerStats(),
      };
    },
  }));

  assert.deepEqual(
    await runtime.cachedTeamIntelligenceForAnalysis(1.5,39,2026,{}),
    {stats:null,playerStats:null},
  );
  assert.equal(reads,0);

  assert.deepEqual(
    await runtime.cachedTeamIntelligenceForAnalysis(10,39,2026,{}),
    {stats:null,playerStats:null},
  );
  assert.equal(reads,1);

  const failing=createAnalysisContextRuntime(deps({
    getStaleCache:async()=>{ throw new Error('cache unavailable'); },
  }));
  assert.deepEqual(
    await failing.cachedTeamIntelligenceForAnalysis(10,39,2026,{}),
    {stats:null,playerStats:null},
  );
});

test('cached team intelligence returns only scope-valid available blocks', async () => {
  const stats={
    available:true,
    team:{id:10},
    league:{id:39,season:2026},
    derived:{ppg:2},
  };
  const runtime=createAnalysisContextRuntime(deps({
    getStaleCache:async()=>({
      stats,
      playerStats:validPlayerStats(),
    }),
  }));

  const result=await runtime.cachedTeamIntelligenceForAnalysis(10,39,2026,{});
  assert.equal(result.stats,stats);
  assert.equal(result.playerStats.available,true);
  assert.equal(result.playerStats.players.length,1);
});

test('player-role hydration scopes cache entries and bounds pagination', async () => {
  const writes=[];
  const calls=[];
  const runtime=createAnalysisContextRuntime(deps({
    resolveTeamSeasonPlayers:async(...args)=>{
      calls.push(args);
      return validPlayerStats();
    },
    setCache:async(...args)=>{
      writes.push(args);
      return true;
    },
  }));

  const result=await runtime.hydratePlayerRolesForAnalysis({
    teamId:'10',
    teamName:'  Arsenal  ',
    leagueId:'39',
    leagueName:' Premier League ',
    season:'2026',
    needed:true,
    cfg:{},
    maxPages:999,
  });

  assert.equal(result.source,'analysis-hydration');
  assert.equal(result.network,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],10);
  assert.equal(calls[0][2],39);
  assert.equal(calls[0][4],2026);
  assert.deepEqual(calls[0][6],{maxPages:2});

  assert.equal(writes.length,1);
  assert.equal(writes[0][1],10);
  assert.equal(writes[0][2].teamId,10);
  assert.equal(writes[0][2].leagueId,39);
  assert.equal(writes[0][2].season,2026);
});

test('player-role cache rejects cross-scope entries and quota failures use only scoped stale data', async () => {
  let network=0;
  const runtime=createAnalysisContextRuntime(deps({
    freeQuotaHealthy:()=>false,
    getCache:async()=>({
      teamId:11,
      leagueId:39,
      season:2026,
      playerStats:validPlayerStats(),
    }),
    getStaleCache:async()=>({
      teamId:10,
      leagueId:39,
      season:2026,
      playerStats:validPlayerStats(),
    }),
    resolveTeamSeasonPlayers:async()=>{
      network+=1;
      return validPlayerStats();
    },
  }));

  const result=await runtime.hydratePlayerRolesForAnalysis({
    teamId:10,
    leagueId:39,
    season:2026,
    needed:true,
    cfg:{},
  });

  assert.equal(result.source,'analysis-stale-cache');
  assert.equal(result.stale,true);
  assert.equal(result.network,false);
  assert.equal(network,0);
});

test('comparison numbers reject coercion traps and malformed metric thresholds', () => {
  const runtime=createAnalysisContextRuntime(deps());

  assert.equal(runtime.comparisonNumber(null),null);
  assert.equal(runtime.comparisonNumber(''),null);
  assert.equal(runtime.comparisonNumber(true),null);
  assert.equal(runtime.comparisonNumber(Infinity),null);
  assert.equal(runtime.comparisonNumber('2.5'),2.5);

  const metric=runtime.comparisonMetric({
    key:{bad:true},
    label:' Test ',
    homeValue:'2',
    awayValue:'1',
    minGap:Infinity,
    better:'unexpected',
    format:'unexpected',
    note:{bad:true},
  });
  assert.equal(metric.edge,'home');
  assert.equal(metric.key,'');
  assert.equal(metric.label,'Test');
  assert.equal(metric.format,'number');
  assert.equal(metric.better,'higher');
  assert.equal(metric.note,'');
});

test('match comparison ignores malformed H2H and absence containers', () => {
  const runtime=createAnalysisContextRuntime(deps());
  const result=runtime.buildMatchComparison({
    homeName:{bad:true},
    awayName:{bad:true},
    homeForm:{overall:{ppg:2,gfAvg:2,gaAvg:1,cleanSheetPct:40},venue:{ppg:2}},
    awayForm:{overall:{ppg:1,gfAvg:1,gaAvg:2,cleanSheetPct:20},venue:{ppg:1}},
    h2h:{homeWins:Infinity,awayWins:0,draws:0},
    absences:{home:'not-an-array',away:[]},
    hasInjuryData:true,
  });

  assert.equal(result.metrics.some(metric=>metric.key==='h2h'),false);
  assert.equal(result.metrics.some(metric=>metric.key==='absences'),false);
  assert.equal(result.dataReuse.sources.includes('очные встречи'),false);
  assert.equal(result.dataReuse.sources.includes('потери состава'),false);
  assert.doesNotMatch(result.balanceLabel,/\[object Object\]/);
});

test('match comparison reports only provenance that is actually present', () => {
  const runtime=createAnalysisContextRuntime(deps());
  const result=runtime.buildMatchComparison({
    homeName:'Home',
    awayName:'Away',
    goalModel:{homeExpected:1.8,awayExpected:1.1},
  });

  assert.deepEqual(result.dataReuse.sources,[]);
  assert.equal(result.dataReuse.seasonStatsCached,false);
  assert.equal(result.dataReuse.standingsCached,false);
  assert.ok(result.metrics.some(metric=>metric.key==='expected_goals'));
});

test('AI instructor fails closed on hostile probability, confidence and trust values', () => {
  const runtime=createAnalysisContextRuntime(deps());
  const result=runtime.buildAiInstructor({
    probabilities:{home:Infinity,draw:0,away:0},
    goalModel:{qualityScore:Infinity,over25:Infinity,btts:Infinity},
    confidence:{score:Infinity,signalCount:3,disagreement:0,agreement:100},
    completeness:{score:Infinity,max:Infinity},
    providerReliability:{state:'healthy',trustCap:Infinity},
  });

  assert.equal(result.betSignal.code,'skip');
  assert.equal(result.confidenceScore,0);
  assert.equal(result.dataTrust.score,0);
  assert.equal(result.dataTrust.reliabilityCap,0);
  assert.equal(result.verdict.outcome,'Нет данных');
  assert.equal(result.verdict.total,'Нет данных');
  assert.equal(result.verdict.btts,'Нет данных');
  assert.equal(result.riskLabel,'Высокий');
});

test('invalid 1X2 probabilities cannot be rescued by an otherwise strong goal model', () => {
  const runtime=createAnalysisContextRuntime(deps({
    analysisQualityGate:()=>({
      state:'ready',
      allowSignal:true,
      reasons:[],
    }),
  }));

  const result=runtime.buildAiInstructor({
    probabilities:{home:90,draw:30,away:20},
    goalModel:{qualityScore:90,over25:80,btts:75},
    confidence:{score:90,signalCount:4,disagreement:2,agreement:95},
    completeness:{score:10,max:10},
    providerReliability:{state:'healthy',trustCap:100},
  });

  assert.equal(result.betSignal.code,'skip');
  assert.match(result.betSignal.reason,/вероятности не прошли проверку/i);
  assert.equal(result.verdict.outcome,'Нет данных');
});

test('AI instructor quality-gate failures cannot leak a betting signal', () => {
  const runtime=createAnalysisContextRuntime(deps({
    analysisQualityGate:()=>{ throw new Error('gate down'); },
  }));

  const result=runtime.buildAiInstructor({
    probabilities:{home:65,draw:20,away:15},
    goalModel:{qualityScore:80,over25:70,btts:60},
    confidence:{score:80,signalCount:3,disagreement:4,agreement:90},
    completeness:{score:10,max:10},
    providerReliability:{state:'healthy',trustCap:100},
  });

  assert.equal(result.betSignal.code,'skip');
  assert.equal(result.qualityGate.state,'blocked');
  assert.equal(result.qualityGate.allowSignal,false);
  assert.ok(result.qualityGate.reasons.some(reason=>reason.code==='quality_gate_unavailable'));
});

test('AI instructor formatting dependencies fail soft and hostile arrays are sanitized', () => {
  const runtime=createAnalysisContextRuntime(deps({
    marketMovementNote:()=>{ throw new Error('market formatter down'); },
    refereeProfile:()=>{ throw new Error('referee formatter down'); },
  }));

  const result=runtime.buildAiInstructor({
    probabilities:{home:60,draw:25,away:15},
    confidence:{score:80,signalCount:3,disagreement:4,agreement:90},
    completeness:{score:10,max:10},
    providerReliability:{state:'healthy',trustCap:100},
    factors:{not:'an array'},
    risks:{not:'an array'},
    referee:{bad:true},
    lineupImpact:{note:{bad:true}},
  });

  assert.equal(result.marketNote,'');
  assert.equal(result.referee,'');
  assert.equal(result.refereeProfile,null);
  assert.deepEqual(result.factors,[]);
  assert.deepEqual(result.risks,[]);
  assert.equal(result.matchPlan.checks.length,3);
});

test('valid AI instructor behavior preserves verdict and strong signal semantics', () => {
  const runtime=createAnalysisContextRuntime(deps());

  const result=runtime.buildAiInstructor({
    probabilities:{home:60,draw:25,away:15},
    goalModel:{qualityScore:80,over25:70,btts:40},
    confidence:{score:80,signalCount:3,disagreement:4,agreement:90},
    completeness:{score:10,max:10},
    providerReliability:{state:'healthy',trustCap:100},
  });

  assert.equal(result.betSignal.code,'double_home');
  assert.deepEqual(result.verdict,{
    outcome:'П1 · 60%',
    total:'ТБ 2.5 · 70%',
    btts:'Нет · 60%',
  });
  assert.equal(result.dataTrust.score,100);
});

test('worker keeps analysis context dependencies explicit', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/analysis-context-runtime.js','utf8');

  assert.match(
    worker,
    /createAnalysisContextRuntime\(\{[\s\S]*?analysisQualityGate,[\s\S]*?freeQuotaHealthy,[\s\S]*?getCache,[\s\S]*?getStaleCache,[\s\S]*?marketMovementNote,[\s\S]*?refereeProfile,[\s\S]*?resolveTeamSeasonPlayers,[\s\S]*?setCache,[\s\S]*?\}\);/,
  );
  assert.match(source,/const requiredFunctions=\{/);
  assert.match(source,/teamIntelligenceCacheValue/);
  assert.match(source,/playerRoleCacheValue/);
  assert.match(source,/safeQualityGate/);
  assert.match(source,/return Object\.freeze\(\{/);
});
