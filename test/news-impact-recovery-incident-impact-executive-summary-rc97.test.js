import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC97 executive summary only composes existing RC93-RC96 views',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactExecutiveSummary\(/);
  assert.match(worker,/sourceReleases:\['RC93','RC94','RC95','RC96'\]/);
  assert.match(worker,/methodology:'summary_of_existing_slo_impact_views'/);
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
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc97/i.test(x)));
});
