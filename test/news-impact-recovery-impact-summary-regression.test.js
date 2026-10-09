import { workerRuntime } from '../test-support/worker-root.js';
import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

// Consolidated recovery impact summary regression coverage (historical RC95-RC98).

const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');

// test/news-impact-recovery-incident-impact-concentration-rc95.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC95 derives concentration only from RC93 factual contribution shares',()=>{
  assert.match(recovery,/function buildNewsImpactRecoveryIncidentSloImpactConcentration\(/);
  assert.match(recovery,/const ranking=\(source && Array\.isArray\(source\.ranking\)/);
  assert.match(recovery,/cumulative_share_of_total_overdue_minutes/);
  assert.match(recovery,/top1ContributionPct/);
  assert.match(recovery,/top3ContributionPct/);
  assert.match(recovery,/top5ContributionPct/);
});

test('RC95 keeps concentration arithmetic cumulative and threshold-free',()=>{
  assert.match(recovery,/const cumulativePct=\(count\)=>Math\.min\(/);
  assert.match(recovery,/residualAfterTop5Pct:Math\.max\(0,Math\.round\(\(100-top5Pct\)\*10\)\/10\)/);
  assert.match(recovery,/source:'rc87_existing_slo'/);
  assert.match(recovery,/routingChanged:false/);
  assert.match(recovery,/persistence:'none'/);
});

test('RC95 admin renders top contribution concentration',()=>{
  assert.match(app,/SLO Impact Concentration/);
  assert.match(app,/top1/);
  assert.match(app,/top3/);
  assert.match(app,/top5/);
  assert.match(app,/RC95 — концентрация является только кумулятивной долей фактических overdue minutes/);
});

test('RC95 deterministic drill and production runtime contract',()=>{
  assert.match(recovery,/function newsImpactRecoveryIncidentSloImpactConcentrationDrill\(/);
  assert.match(recovery,/result\.summary\.top1ContributionPct===40/);
  assert.match(recovery,/result\.summary\.top3ContributionPct===80/);
  assert.match(recovery,/result\.summary\.top5ContributionPct===95/);
  assert.match(recovery,/result\.summary\.residualAfterTop5Pct===5/);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactConcentrationDrill().pass,true);
  assert.equal(typeof workerRuntime.getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactConcentration,'function');
});

test('RC95 privacy and storage boundaries remain fail-closed',()=>{
  assert.match(recovery,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
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
  assert.match(recovery,/function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend\(/);
  assert.match(recovery,/newsImpactRecoveryIncidentOverdueWithinWindow\(episode,windowStartMs,windowEndMs\)/);
  assert.match(recovery,/weekly_cumulative_share_of_total_overdue_minutes/);
  assert.match(recovery,/top1ContributionPct/);
  assert.match(recovery,/top3ContributionPct/);
  assert.match(recovery,/top5ContributionPct/);
});

test('RC96 uses exact percentage-point deltas without a new threshold',()=>{
  assert.match(recovery,/top1DeltaPctPoints=Math\.round/);
  assert.match(recovery,/top3DeltaPctPoints=Math\.round/);
  assert.match(recovery,/top5DeltaPctPoints=Math\.round/);
  assert.match(recovery,/direction=\(delta\)=>delta>0 \? 'increased' : delta<0 \? 'decreased' : 'unchanged'/);
  assert.match(recovery,/source:'rc87_existing_slo'/);
  assert.match(recovery,/routingChanged:false/);
  assert.match(recovery,/persistence:'none'/);
});

test('RC96 admin renders 4-week concentration trend',()=>{
  assert.match(app,/SLO Impact Concentration Trend · 4 недели/);
  assert.match(app,/остаток вне top-5/);
  assert.match(app,/Динамика: top1/);
  assert.match(app,/RC96 — trend сравнивает долю фактических overdue minutes/);
});

test('RC96 deterministic drill locks concentration arithmetic',()=>{
  assert.match(recovery,/function newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill\(/);
  assert.match(recovery,/previous\?\.totalOverdueMinutes===210/);
  assert.match(recovery,/previous\?\.top1ContributionPct===42\.9/);
  assert.match(recovery,/current\?\.totalOverdueMinutes===250/);
  assert.match(recovery,/current\?\.top1ContributionPct===48/);
  assert.match(recovery,/result\.summary\.top1DeltaPctPoints===5\.1/);
  assert.match(recovery,/result\.summary\.top3DeltaPctPoints===-1\.7/);
  assert.match(recovery,/result\.summary\.top5DeltaPctPoints===0\.8/);
});

test('RC96 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactConcentrationTrendDrill().pass,true);
  assert.equal(typeof workerRuntime.getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend,'function');
  assert.match(recovery,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
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
  assert.match(recovery,/function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary\(/);
  assert.match(recovery,/sourceReleases:\['RC93','RC94','RC95','RC96'\]/);
  assert.match(recovery,/methodology:'summary_of_existing_slo_impact_views'/);
  assert.match(readContractSource(new URL('../src/growth-analytics-runtime.js', import.meta.url), 'utf8'),/newsImpactRecoveryIncidentSloImpactExecutiveSummary=buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary\(/);
});

test('RC97 exposes cumulative, weekly and concentration facts without new thresholds',()=>{
  assert.match(recovery,/cumulativeOverdueMinutes:newsImpactNonNegativeNumber\(rankingSummary\.totalOverdueMinutes\)/);
  assert.match(recovery,/currentWeekOverdueMinutes:newsImpactNonNegativeNumber\(trendSummary\.currentOverdueMinutes\)/);
  assert.match(recovery,/weekDeltaMinutes:newsImpactSignedNumber\(trendSummary\.deltaMinutes\)/);
  assert.match(recovery,/top1ContributionPct:newsImpactPercentage\(concentrationSummary\.top1ContributionPct\)/);
  assert.match(recovery,/top1WeeklyDeltaPctPoints:newsImpactSignedNumber\(concentrationTrendSummary\.top1DeltaPctPoints\)/);
  assert.match(recovery,/source:'rc87_existing_slo'/);
  assert.match(recovery,/routingChanged:false/);
  assert.match(recovery,/persistence:'none'/);
});

test('RC97 admin renders one executive summary over detailed impact views',()=>{
  assert.match(app,/SLO Impact Executive Summary/);
  assert.match(app,/Ведущая пара/);
  assert.match(app,/Неделя: ↗/);
  assert.match(app,/RC97 — единая сводка только объединяет уже рассчитанные RC93–RC96 factual SLO impact views/);
});

test('RC97 deterministic drill locks the unified factual contract',()=>{
  assert.match(recovery,/function newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill\(/);
  assert.match(recovery,/result\.summary\.cumulativeOverdueMinutes===1000/);
  assert.match(recovery,/result\.summary\.currentWeekOverdueMinutes===300/);
  assert.match(recovery,/result\.summary\.weekDeltaMinutes===80/);
  assert.match(recovery,/result\.summary\.top1ContributionPct===40/);
  assert.match(recovery,/result\.topPair\?\.reason==='server_error'/);
  assert.match(recovery,/result\.sourceReleases\.join\(','\)==='RC93,RC94,RC95,RC96'/);
});

test('RC97 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactExecutiveSummaryDrill().pass,true);
  assert.equal(typeof workerRuntime.getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary,'function');
  assert.match(recovery,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
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
  assert.match(recovery,/function buildNewsImpactRecoveryIncidentSloImpactFocusQueue\(/);
  assert.match(recovery,/const trendByKey=new Map/);
  assert.match(recovery,/const safeLimit=configuredLimit!==null && Number\.isSafeInteger\(configuredLimit\)/);
  assert.match(recovery,/queuePosition:index\+1/);
  assert.match(recovery,/sourceReleases:\['RC93','RC94','RC97'\]/);
});

test('RC98 ordering is factual and does not introduce a severity score',()=>{
  assert.match(recovery,/b\.currentWeekOverdueMinutes-a\.currentWeekOverdueMinutes/);
  assert.match(recovery,/b\.weekDeltaMinutes-a\.weekDeltaMinutes/);
  assert.match(recovery,/b\.totalOverdueMinutes-a\.totalOverdueMinutes/);
  assert.match(recovery,/ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue'/);
  assert.match(recovery,/routingChanged:false/);
  assert.match(recovery,/persistence:'none'/);
});

test('RC98 admin renders focus queue without automated routing claims',()=>{
  assert.match(app,/SLO Impact Focus Queue/);
  assert.match(app,/мин за неделю/);
  assert.match(app,/В очереди:/);
  assert.match(app,/RC98 — Focus Queue сортирует только по фактам/);
});

test('RC98 deterministic drill locks ordering and summary',()=>{
  assert.match(recovery,/function newsImpactRecoveryIncidentSloImpactFocusQueueDrill\(/);
  assert.match(recovery,/result\.summary\.queuedPairs===3/);
  assert.match(recovery,/result\.summary\.increasingQueuedPairs===2/);
  assert.match(recovery,/result\.rows\[0\]\?\.reason==='b'/);
  assert.match(recovery,/result\.rows\[1\]\?\.reason==='a'/);
  assert.match(recovery,/result\.rows\[2\]\?\.reason==='c'/);
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
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactRecoveryIncidentSloImpactFocusQueueDrill().pass,true);
  assert.equal(typeof workerRuntime.getNewsImpactRecoveryRuntime().buildNewsImpactRecoveryIncidentSloImpactFocusQueue,'function');
  assert.match(recovery,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc98/i.test(x)));
});
}
