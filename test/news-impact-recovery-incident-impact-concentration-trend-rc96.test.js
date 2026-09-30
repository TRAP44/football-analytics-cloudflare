import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC96 derives weekly concentration from factual overdue minutes',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactConcentrationTrend\(/);
  assert.match(worker,/newsImpactRecoveryIncidentOverdueWithinWindow\(episode,windowStartMs,windowEndMs\)/);
  assert.match(worker,/weekly_cumulative_share_of_total_overdue_minutes/);
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
