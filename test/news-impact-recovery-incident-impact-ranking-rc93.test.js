import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC93 derives factual overdue minutes from existing incident episode timestamps',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBurden\(/);
  assert.match(worker,/ackOverdueMinutes=Math\.max\(0,ackElapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES\)/);
  assert.match(worker,/recoveryOverdueMinutes=Math\.max\(0,elapsedMinutes-NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES\)/);
  assert.match(worker,/totalOverdueMinutes:ackOverdueMinutes\+recoveryOverdueMinutes/);
});

test('RC93 aggregates burden by reason and action without inventing new thresholds',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachImpactRanking\(/);
  assert.match(worker,/const key=String\(episode\.reason \|\| ''\)\+'\|'\+String\(episode\.action \|\| ''\)/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/methodology:'sum_minutes_above_existing_ack_and_recovery_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC93 contribution is a share of overdue minutes, not a routing score',()=>{
  assert.match(worker,/contributionPct:totalOverdueMinutes>0/);
  assert.match(worker,/Math\.round\(\(Number\(row\.totalOverdueMinutes \|\| 0\)\/totalOverdueMinutes\)\*1000\)\/10/);
  assert.match(worker,/b\.totalOverdueMinutes-a\.totalOverdueMinutes/);
  assert.match(worker,/b\.recoveryOverdueMinutes-a\.recoveryOverdueMinutes/);
  assert.match(worker,/b\.ackOverdueMinutes-a\.ackOverdueMinutes/);
});

test('RC93 admin explains factual SLO contribution',()=>{
  assert.match(app,/SLO Breach Impact Ranking/);
  assert.match(app,/ACK сверх SLO/);
  assert.match(app,/Recovery сверх SLO/);
  assert.match(app,/RC93 — ranking показывает фактическую долю минут сверх существующих ACK\/Recovery SLO/);
});

test('RC93 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachImpactRankingDrill\(/);
  assert.match(worker,/result\.summary\.totalOverdueMinutes===990/);
  assert.match(worker,/top\?\.totalOverdueMinutes===960/);
  assert.match(worker,/top\?\.contributionPct===97/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachImpactRankingSelfTest: newsImpactRecoveryIncidentSloBreachImpactRankingDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloBreachImpactRanking','newsImpactRecoveryIncidentOverdueContribution']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC93 privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc93/i.test(x)));
});
