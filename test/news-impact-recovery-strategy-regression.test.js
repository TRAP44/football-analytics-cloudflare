import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const recoverySource=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');

const ACTION_CODES=new Set(['full_ai','squads','market','recheck','news','share']);
const DECISION_CODES=new Set(['material','stable','detail','guarded','baseline_missing','unavailable']);
const FAILURE_CODES=new Set([
  'provider_rate_limit','provider_unavailable','quota_exhausted','analysis_warming',
  'match_missing','invalid_fixture','data_invalid','telegram_delivery','timeout','server_error',
]);
const RECOVERY_CODES=new Set(['retry','retry_soon','retry_later','wait_quota_reset','open_search','open_full_ai']);
const STRATEGY_GUARD_CODES=new Set([
  'fixed_default','baseline_sample','no_significant_better','significant_better',
  'stability_sample','recent_regression','stable_significant_better','performance_drift',
]);
const INCIDENT_CODES=new Set(['performance_drift','recent_regression']);

function runtime(extra={}) {
  return createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:ACTION_CODES,
    NEWS_IMPACT_ACTION_LABELS:Object.fromEntries([...ACTION_CODES].map(code=>[code,code])),
    NEWS_IMPACT_DECISION_CODES:DECISION_CODES,
    NEWS_IMPACT_FAILURE_CODES:FAILURE_CODES,
    NEWS_IMPACT_FAILURE_LABELS:Object.fromEntries([...FAILURE_CODES].map(code=>[code,code])),
    NEWS_IMPACT_FUNNEL_MIN_USERS:10,
    NEWS_IMPACT_FUNNEL_STABLE_USERS:30,
    NEWS_IMPACT_OUTCOME_CODES:{
      full_ai:'analysis_delivered',
      share:'share_card_delivered',
      market:'market_delivered',
      squads:'squads_delivered',
      recheck:'recheck_delivered',
      news:'news_delivered',
    },
    NEWS_IMPACT_RECOVERY_CODES:RECOVERY_CODES,
    NEWS_IMPACT_RECOVERY_LABELS:Object.fromEntries([...RECOVERY_CODES].map(code=>[code,code])),
    NEWS_IMPACT_RECOVERY_WINDOW_MINUTES:5,
    NEWS_IMPACT_RECOVERY_SOURCE_WINDOW_MINUTES:30,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_ATTEMPTS:30,
    NEWS_IMPACT_RECOVERY_STRATEGY_MIN_LIFT_PCT_POINTS:5,
    NEWS_IMPACT_RECOVERY_STABILITY_MIN_ATTEMPTS:10,
    NEWS_IMPACT_RECOVERY_STABILITY_WINDOW_DAYS:7,
    NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS:20,
    NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS:10,
    NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS:15,
    NEWS_IMPACT_RECOVERY_STRATEGY_GUARD_CODES:STRATEGY_GUARD_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_CODES:INCIDENT_CODES,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES:30,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES:120,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES:360,
    recordGrowthEvent:async()=>true,
    ...extra,
  });
}

test('RC80-RC84 implementations live in recovery runtime and Worker only delegates',()=>{
  for (const name of [
    'recordNewsImpactRecoveryAttempt',
    'buildNewsImpactRecoveryEffectiveness',
    'newsImpactRecoveryBest',
    'buildNewsImpactRecoveryStrategyEvidence',
    'newsImpactRecoveryStrategyDecision',
    'buildNewsImpactRecoveryStrategyMatrix',
    'newsImpactRecoveryDriftDecision',
    'buildNewsImpactRecoveryDriftMatrix',
    'buildNewsImpactRecoveryTransitionHistory',
    'summarizeNewsImpactRecoveryTransitions',
    'buildNewsImpactRecoveryAdminAlerts',
  ]) {
    assert.ok(recoverySource.includes(name),name+' runtime implementation missing');
    assert.match(worker,new RegExp('function '+name+'\\(\\.\\.\\.args\\).*getNewsImpactRecoveryRuntime\\(\\)\\.'+name),name+' Worker delegate missing');
  }
});

test('RC80 records only strictly identified recovery attempts',async()=>{
  const recorded=[];
  const r=runtime({
    recordGrowthEvent:async(_cfg,event)=>{recorded.push(event);return true;},
  });

  assert.equal(await r.recordNewsImpactRecoveryAttempt({},{
    userId:true,
    fixtureId:100,
    decision:'material',
    action:'full_ai',
    recovery:'retry',
  }),false);
  assert.equal(recorded.length,0);

  assert.equal(await r.recordNewsImpactRecoveryAttempt({},{
    userId:'7',
    fixtureId:'100',
    decision:'material',
    action:'full_ai',
    recovery:'retry',
    channel:{toString(){throw new Error('must not coerce');}},
  }),true);
  assert.equal(recorded.length,1);
  assert.equal(recorded[0].userId,7);
  assert.equal(recorded[0].fixtureId,100);
  assert.equal(recorded[0].channel,'telegram');
});

test('RC80 recovery effectiveness accepts only valid containers and confirmed delivery outcomes',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');

  const empty=r.buildNewsImpactRecoveryEffectiveness({broken:true},null,undefined,{asOfMs});
  assert.ok(empty.every(row=>row.observed===0));

  const attempt={
    telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:00:00Z',
    metadata:{decision:'material',action:'full_ai',recovery:'retry'},
  };
  const wrongOutcome={
    telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:02:00Z',
    metadata:{decision:'material',action:'full_ai',outcome:'share_card_delivered'},
  };
  const wrong=r.buildNewsImpactRecoveryEffectiveness([attempt],[wrongOutcome],[],{asOfMs,windowMinutes:true})
    .find(row=>row.recovery==='retry');
  assert.equal(wrong.recovered,0);
  assert.equal(wrong.failed,1);

  const correctOutcome={...wrongOutcome,metadata:{...wrongOutcome.metadata,outcome:'analysis_delivered'}};
  const correct=r.buildNewsImpactRecoveryEffectiveness([attempt],[correctOutcome],[],{asOfMs,windowMinutes:true})
    .find(row=>row.recovery==='retry');
  assert.equal(correct.recovered,1);
  assert.equal(correct.failed,0);
});

test('RC80 best-recovery ranking cannot be forged with a truthy flag or tiny sample',()=>{
  const r=runtime();
  assert.equal(r.newsImpactRecoveryBest({broken:true}),null);
  assert.equal(r.newsImpactRecoveryBest([
    {recovery:'forged',attempts:1,successPct:100,confidence:{eligibleForBottleneck:true}},
  ]),null);
  assert.equal(r.newsImpactRecoveryBest([
    {recovery:'forged',attempts:30,successPct:100,confidence:{eligibleForBottleneck:'true'}},
  ]),null);

  const best=r.newsImpactRecoveryBest([
    {recovery:'retry',attempts:30,successPct:70,confidence:{eligibleForBottleneck:true}},
    {recovery:'open_full_ai',attempts:30,successPct:80,confidence:{eligibleForBottleneck:true}},
  ]);
  assert.equal(best?.recovery,'open_full_ai');
});

test('RC81 strategy evidence fails closed on malformed inputs and wrong outcome codes',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  assert.deepEqual(r.buildNewsImpactRecoveryStrategyEvidence({broken:true},null,null,null),[]);

  const failure={
    telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T09:55:00Z',
    metadata:{decision:'material',action:'full_ai',reason:'server_error'},
  };
  const attempt={
    telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:00:00Z',
    metadata:{decision:'material',action:'full_ai',recovery:'retry'},
  };
  const wrongOutcome={
    telegram_id:'7',fixture_id:'100',created_at:'2026-09-23T10:02:00Z',
    metadata:{decision:'material',action:'full_ai',outcome:'share_card_delivered'},
  };
  const evidence=r.buildNewsImpactRecoveryStrategyEvidence([attempt],[wrongOutcome],[failure],{
    asOfMs,recoveryWindowMinutes:true,sourceWindowMinutes:true,
  });
  assert.equal(evidence.length,1);
  assert.equal(evidence[0].attempts,1);
  assert.equal(evidence[0].recovered,0);
  assert.equal(evidence[0].failed,1);

  assert.doesNotThrow(()=>r.buildNewsImpactRecoveryStrategyEvidence([attempt],[],[{
    ...failure,
    metadata:{...failure.metadata,reason:{toString(){throw new Error('must not coerce');}}},
  }],{asOfMs}));
});

test('RC81 adaptive strategy requires real stable sample and separated confidence',()=>{
  const r=runtime();
  const fixed={
    reason:'server_error',action:'full_ai',recovery:'retry',recoveryLabel:'retry',
    attempts:30,successPct:20,confidence:r.newsImpactConversionConfidence(6,30),
  };
  const better={
    reason:'server_error',action:'full_ai',recovery:'open_full_ai',recoveryLabel:'open',
    attempts:30,successPct:83.3,confidence:r.newsImpactConversionConfidence(25,30),
  };

  const adaptive=r.newsImpactRecoveryStrategyDecision('server_error','full_ai',[fixed,better]);
  assert.equal(adaptive.strategy,'adaptive');
  assert.equal(adaptive.selectedRecovery,'open_full_ai');

  const malformed=r.newsImpactRecoveryStrategyDecision(
    {toString(){throw new Error('must not coerce');}},
    'full_ai',
    {broken:true},
  );
  assert.equal(malformed.strategy,'fixed');
  assert.equal(malformed.reason,'server_error');

  const coercive=r.newsImpactRecoveryStrategyDecision('server_error','full_ai',[
    {...fixed,attempts:true},
    better,
  ]);
  assert.equal(coercive.strategy,'fixed');
  assert.equal(coercive.guardReason,'baseline_sample');
});

test('RC82 recent stability window cannot be satisfied by coercive attempt counts',()=>{
  const r=runtime();
  const fixedLong={reason:'server_error',action:'full_ai',recovery:'retry',attempts:40,successPct:20,confidence:r.newsImpactConversionConfidence(8,40)};
  const candidateLong={reason:'server_error',action:'full_ai',recovery:'open_full_ai',attempts:40,successPct:85,confidence:r.newsImpactConversionConfidence(34,40)};
  const fixedRecent={...fixedLong,attempts:10,successPct:30,confidence:r.newsImpactConversionConfidence(3,10)};
  const candidateRecent={...candidateLong,attempts:true,successPct:80,confidence:r.newsImpactConversionConfidence(8,10)};

  const decision=r.newsImpactRecoveryStrategyDecision(
    'server_error','full_ai',
    [fixedLong,candidateLong],
    [fixedRecent,candidateRecent],
  );
  assert.equal(decision.strategy,'fixed');
  assert.equal(decision.guardReason,'stability_sample');
  assert.equal(decision.proposedRecovery,'open_full_ai');

  assert.match(growth,/evidenceSource:'shared_runtime_loader'/);
  assert.match(growth,/recentRule:'candidate_not_worse'/);
});

test('RC83 drift guard requires valid sample, percentages and Wilson bounds',()=>{
  const r=runtime();
  const adaptive={
    reason:'server_error',action:'full_ai',
    fixedRecovery:'retry',fixedRecoveryLabel:'retry',
    selectedRecovery:'open_full_ai',selectedRecoveryLabel:'open',
    strategy:'adaptive',
    fixedAttempts:50,fixedSuccessPct:35,fixedConfidence:r.newsImpactConversionConfidence(18,50),
  };
  const prior=[{
    reason:'server_error',action:'full_ai',recovery:'open_full_ai',
    attempts:50,successPct:90,confidence:r.newsImpactConversionConfidence(45,50),
  }];
  const recent=[{
    reason:'server_error',action:'full_ai',recovery:'open_full_ai',
    attempts:10,successPct:40,confidence:r.newsImpactConversionConfidence(4,10),
  }];

  const blocked=r.newsImpactRecoveryDriftDecision(adaptive,prior,recent);
  assert.equal(blocked.strategy,'fixed');
  assert.equal(blocked.guardReason,'performance_drift');
  assert.equal(blocked.driftDetected,true);

  const coercive=r.newsImpactRecoveryDriftDecision(adaptive,prior,[{
    ...recent[0],attempts:true,successPct:'40',
  }]);
  assert.equal(coercive.strategy,'adaptive');
  assert.equal(coercive.driftStatus,'insufficient');

  const invalidConfidence=r.newsImpactRecoveryDriftDecision(adaptive,[{
    ...prior[0],confidence:{lowerPct:{toString(){throw new Error('must not coerce');}}},
  }],recent);
  assert.equal(invalidConfidence.driftStatus,'insufficient');
});

test('RC84 transition history and admin alerts reject malformed collections and objects',()=>{
  const r=runtime();
  assert.deepEqual(r.buildNewsImpactRecoveryTransitionHistory({broken:true},null),[]);
  assert.deepEqual(r.summarizeNewsImpactRecoveryTransitions({broken:true}),{
    total:0,fixedToAdaptive:0,adaptiveToFixed:0,recoveryChanged:0,last:null,
  });

  const rows=[
    {created_at:'2026-09-01T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'baseline_sample'}},
    {created_at:'2026-09-05T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'open_full_ai',strategy:'adaptive',strategy_guard:'stable_significant_better'}},
    {created_at:'2026-09-10T10:00:00Z',metadata:{reason:'server_error',action:'full_ai',recovery:'retry',strategy:'fixed',strategy_guard:'performance_drift'}},
    {created_at:'2026-09-11T10:00:00Z',metadata:{reason:{toString(){throw new Error('must not coerce');}},action:'share'}},
  ];
  const history=r.buildNewsImpactRecoveryTransitionHistory(rows,{limit:true});
  assert.equal(history.length,2);
  assert.equal(Object.prototype.hasOwnProperty.call(history[0],'telegram_id'),false);

  assert.deepEqual(r.buildNewsImpactRecoveryAdminAlerts({broken:true},'ok',{broken:true}),[]);
  const evidenceAlert=r.buildNewsImpactRecoveryAdminAlerts([],{
    toString(){throw new Error('must not coerce');},
  },[]);
  assert.equal(evidenceAlert.length,1);
  assert.equal(evidenceAlert[0].code,'strategy_evidence_unavailable');

  const unsuppressed=r.buildNewsImpactRecoveryAdminAlerts([
    {reason:'server_error',action:'full_ai',guardReason:'performance_drift',driftDropPctPoints:20},
  ],'ok',[
    {status:'active',acknowledged:'true',alertSuppressed:'true',reason:'server_error',action:'full_ai',code:'performance_drift'},
  ]);
  assert.equal(unsuppressed.length,1);
  assert.equal(unsuppressed[0].code,'performance_drift');
});

test('RC80-RC84 deterministic runtime drills are restored and passing',()=>{
  const r=runtime();
  for (const [name,result] of [
    ['effectiveness',r.newsImpactRecoveryEffectivenessDrill()],
    ['strategy',r.newsImpactRecoveryStrategyDrill()],
    ['stability',r.newsImpactRecoveryStabilityDrill()],
    ['drift',r.newsImpactRecoveryDriftDrill()],
    ['transition',r.newsImpactRecoveryTransitionDrill()],
  ]) {
    assert.equal(result.pass,true,name+' drill failed');
    assert.ok(result.cases>0,name+' drill has no cases');
  }
});

test('RC80 attribution and RC81-RC84 admin contracts remain wired',()=>{
  assert.match(analysisController,/newsImpactRecoveryCode:safeText\(/);
  assert.match(analysisController,/newsImpactRecoveryFrom:safeText\(/);
  assert.match(app,/Recovery → подтверждённый результат/);
  assert.match(app,/Recovery Strategy Guard/);
  assert.match(app,/Drift circuit breaker/);
  assert.match(app,/История Recovery Strategy/);
  assert.match(growth,/newsImpactRecoveryStrategyGuard=\{/);
  assert.match(growth,/newsImpactRecoveryTransitionHistory=/);
});

test('RC80-RC84 need no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc8[0-4]/i.test(x)));
});
