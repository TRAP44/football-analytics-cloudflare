import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

// Consolidated recovery impact summary regression coverage (historical RC95-RC98).

// test/news-impact-recovery-incident-impact-concentration-rc95.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC95 derives concentration only from RC93 factual contribution shares',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactConcentration\(/);
  assert.match(worker,/const ranking=Array\.isArray\(impactRanking\?\.ranking\)/);
  assert.match(recovery,/cumulative_share_of_total_overdue_minutes/);
  assert.match(worker,/top1ContributionPct/);
  assert.match(worker,/top3ContributionPct/);
  assert.match(worker,/top5ContributionPct/);
});

test('RC95 keeps concentration arithmetic cumulative and threshold-free',()=>{
  assert.match(worker,/const cumulativePct=\(count\)=>Math\.round\(ranking\.slice\(0,count\)\.reduce/);
  assert.match(worker,/residualAfterTop5Pct:Math\.max\(0,Math\.round\(\(100-top5Pct\)\*10\)\/10\)/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC95 admin renders top contribution concentration',()=>{
  assert.match(app,/SLO Impact Concentration/);
  assert.match(app,/top1/);
  assert.match(app,/top3/);
  assert.match(app,/top5/);
  assert.match(app,/RC95 — концентрация является только кумулятивной долей фактических overdue minutes/);
});

test('RC95 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloImpactConcentrationDrill\(/);
  assert.match(worker,/result\.summary\.top1ContributionPct===40/);
  assert.match(worker,/result\.summary\.top3ContributionPct===80/);
  assert.match(worker,/result\.summary\.top5ContributionPct===95/);
  assert.match(worker,/result\.summary\.residualAfterTop5Pct===5/);
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactConcentrationSelfTest: newsImpactRecoveryIncidentSloImpactConcentrationDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloImpactConcentration','newsImpactRecoveryIncidentTopContributionShares']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC95 privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc95/i.test(x)));
});
}

// test/news-impact-recovery-incident-impact-concentration-trend-rc96.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC96 derives weekly concentration from factual overdue minutes',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend\(/);
  assert.match(worker,/newsImpactRecoveryIncidentOverdueWithinWindow\(episode,windowStartMs,windowEndMs\)/);
  assert.match(recovery,/weekly_cumulative_share_of_total_overdue_minutes/);
  assert.match(worker,/top1ContributionPct/);
  assert.match(worker,/top3ContributionPct/);
  assert.match(worker,/top5ContributionPct/);
});

test('RC96 uses exact percentage-point deltas without a new threshold',()=>{
  assert.match(worker,/top1DeltaPctPoints=Math\.round/);
  assert.match(worker,/top3DeltaPctPoints=Math\.round/);
  assert.match(worker,/top5DeltaPctPoints=Math\.round/);
  assert.match(worker,/direction=\(delta\)=>delta>0 \? 'increased' : delta<0 \? 'decreased' : 'unchanged'/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC96 admin renders 4-week concentration trend',()=>{
  assert.match(app,/SLO Impact Concentration Trend · 4 недели/);
  assert.match(app,/остаток вне top-5/);
  assert.match(app,/Динамика: top1/);
  assert.match(app,/RC96 — trend сравнивает долю фактических overdue minutes/);
});

test('RC96 deterministic drill locks concentration arithmetic',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill\(/);
  assert.match(worker,/previous\?\.totalOverdueMinutes===210/);
  assert.match(worker,/previous\?\.top1ContributionPct===42\.9/);
  assert.match(worker,/current\?\.totalOverdueMinutes===250/);
  assert.match(worker,/current\?\.top1ContributionPct===48/);
  assert.match(worker,/result\.summary\.top1DeltaPctPoints===5\.1/);
  assert.match(worker,/result\.summary\.top3DeltaPctPoints===-1\.7/);
  assert.match(worker,/result\.summary\.top5DeltaPctPoints===0\.8/);
});

test('RC96 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactConcentrationTrendSelfTest: newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloImpactConcentrationTrend','newsImpactRecoveryIncidentWeeklyConcentrationShares']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc96/i.test(x)));
});
}

// test/news-impact-recovery-incident-impact-executive-summary-rc97.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC97 executive summary only composes existing RC93-RC96 views',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary\(/);
  assert.match(worker,/sourceReleases:\['RC93','RC94','RC95','RC96'\]/);
  assert.match(recovery,/methodology:'summary_of_existing_slo_impact_views'/);
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactExecutiveSummary=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary\(/);
});

test('RC97 exposes cumulative, weekly and concentration facts without new thresholds',()=>{
  assert.match(worker,/cumulativeOverdueMinutes:Number\(rankingSummary\.totalOverdueMinutes \|\| 0\)/);
  assert.match(worker,/currentWeekOverdueMinutes:Number\(trendSummary\.currentOverdueMinutes \|\| 0\)/);
  assert.match(worker,/weekDeltaMinutes:Number\(trendSummary\.deltaMinutes \|\| 0\)/);
  assert.match(worker,/top1ContributionPct:Number\(concentrationSummary\.top1ContributionPct \|\| 0\)/);
  assert.match(worker,/top1WeeklyDeltaPctPoints:Number\(concentrationTrendSummary\.top1DeltaPctPoints \|\| 0\)/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC97 admin renders one executive summary over detailed impact views',()=>{
  assert.match(app,/SLO Impact Executive Summary/);
  assert.match(app,/Ведущая пара/);
  assert.match(app,/Неделя: ↗/);
  assert.match(app,/RC97 — единая сводка только объединяет уже рассчитанные RC93–RC96 factual SLO impact views/);
});

test('RC97 deterministic drill locks the unified factual contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill\(/);
  assert.match(worker,/result\.summary\.cumulativeOverdueMinutes===1000/);
  assert.match(worker,/result\.summary\.currentWeekOverdueMinutes===300/);
  assert.match(worker,/result\.summary\.weekDeltaMinutes===80/);
  assert.match(worker,/result\.summary\.top1ContributionPct===40/);
  assert.match(worker,/result\.topPair\?\.reason==='server_error'/);
  assert.match(worker,/result\.sourceReleases\.join\(','\)==='RC93,RC94,RC95,RC96'/);
});

test('RC97 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactExecutiveSummarySelfTest: newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloImpactExecutiveSummary','newsImpactRecoveryIncidentSloImpactUnifiedView']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc97/i.test(x)));
});
}

// test/news-impact-recovery-incident-impact-focus-queue-rc98.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC98 composes factual ranking, trend and executive summary into a short focus queue',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactFocusQueue\(/);
  assert.match(recovery,/const trendByKey=new Map/);
  assert.match(worker,/safeLimit=Math\.max\(1,Math\.min\(10,Number\(limit \|\| 5\)\)\)/);
  assert.match(worker,/queuePosition:index\+1/);
  assert.match(worker,/sourceReleases:\['RC93','RC94','RC97'\]/);
});

test('RC98 ordering is factual and does not introduce a severity score',()=>{
  assert.match(worker,/b\.currentWeekOverdueMinutes-a\.currentWeekOverdueMinutes/);
  assert.match(worker,/b\.weekDeltaMinutes-a\.weekDeltaMinutes/);
  assert.match(worker,/b\.totalOverdueMinutes-a\.totalOverdueMinutes/);
  assert.match(recovery,/ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC98 admin renders focus queue without automated routing claims',()=>{
  assert.match(app,/SLO Impact Focus Queue/);
  assert.match(app,/мин за неделю/);
  assert.match(app,/В очереди:/);
  assert.match(app,/RC98 — Focus Queue сортирует только по фактам/);
});

test('RC98 deterministic drill locks ordering and summary',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloImpactFocusQueueDrill\(/);
  assert.match(worker,/result\.summary\.queuedPairs===3/);
  assert.match(worker,/result\.summary\.increasingQueuedPairs===2/);
  assert.match(worker,/result\.rows\[0\]\?\.reason==='b'/);
  assert.match(worker,/result\.rows\[1\]\?\.reason==='a'/);
  assert.match(worker,/result\.rows\[2\]\?\.reason==='c'/);
});



test('RC95-RC98 impact summary runtime rejects malformed containers and coercive metrics',()=>{
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES:30,
    NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES:120,
    NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES:360,
  });
  const evil={toString(){throw new Error('must not coerce');}};

  const empty=runtime.buildNewsImpactRecoveryIncidentSloImpactConcentration(null);
  assert.equal(empty.available,false);
  assert.deepEqual(empty.rows,[]);

  const concentration=runtime.buildNewsImpactRecoveryIncidentSloImpactConcentration({
    available:true,
    summary:{pairs:true,totalOverdueMinutes:'bad'},
    ranking:[
      {reason:evil,action:'full_ai',contributionPct:100,totalOverdueMinutes:100},
      {reason:'valid',action:'share',contributionPct:60,totalOverdueMinutes:60,activeEpisodes:1},
    ],
  });
  assert.equal(concentration.summary.pairs,1);
  assert.equal(concentration.summary.top1ContributionPct,60);
  assert.equal(concentration.rows.length,1);

  const trend=runtime.buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend({broken:true},null);
  assert.equal(trend.weeks,4);
  assert.equal(trend.summary.currentOverdueMinutes,0);

  const executive=runtime.buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary(
    null,
    {available:true,summary:{deltaMinutes:true}},
    {available:true,summary:{top1ContributionPct:150}},
    {available:true,summary:{top1Direction:evil}},
  );
  assert.equal(executive.available,false);
  assert.equal(executive.summary.weekDeltaMinutes,0);
  assert.equal(executive.summary.top1ContributionPct,0);
  assert.equal(executive.summary.top1WeeklyDirection,'unchanged');

  const focus=runtime.buildNewsImpactRecoveryIncidentSloImpactFocusQueue(
    {available:true,summary:{pairs:1,activePairs:1},ranking:[
      {reason:'a',action:'full_ai',totalOverdueMinutes:100,contributionPct:50,activeEpisodes:1},
      {reason:evil,action:'share',totalOverdueMinutes:999,contributionPct:99},
    ]},
    {available:true,summary:{currentOverdueMinutes:20,deltaMinutes:-5},pairs:[
      {reason:'a',action:'full_ai',currentOverdueMinutes:20,previousOverdueMinutes:25,deltaMinutes:-5,direction:'increased',currentContributionPct:100},
    ]},
    {available:true,summary:{breachPairs:1,activePairs:1,currentWeekOverdueMinutes:20,weekDeltaMinutes:-5}},
    {limit:true},
  );
  assert.equal(focus.rows.length,1);
  assert.equal(focus.rows[0].weekDirection,'decreased');
});

test('RC98 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactFocusQueueSelfTest: newsImpactRecoveryIncidentSloImpactFocusQueueDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloImpactFocusQueue','newsImpactRecoveryIncidentSloImpactFocusOrdering']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc98/i.test(x)));
});
}
