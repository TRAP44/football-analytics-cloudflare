import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC95 derives concentration only from RC93 factual contribution shares',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactConcentration\(/);
  assert.match(worker,/const ranking=Array\.isArray\(impactRanking\?\.ranking\)/);
  assert.match(worker,/cumulative_share_of_total_overdue_minutes/);
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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc95/i.test(x)));
});
