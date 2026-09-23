import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC91 derives triage only from RC90 active watchlist',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachTriage\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachTriage=buildNewsImpactRecoveryIncidentSloBreachTriage\(/);
  assert.match(worker,/const items=Array\.isArray\(watchlist\?\.items\)/);
  assert.match(worker,/items\.filter\(x=>x\?\.active\)/);
});

test('RC91 uses only existing RC87 ACK critical and recovery thresholds',()=>{
  assert.match(worker,/const criticalAckMinutes=Number\(thresholds\.criticalAckMinutes \|\| NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES\)/);
  assert.match(worker,/const recoveryMinutes=Number\(thresholds\.recoveryMinutes \|\| NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES\)/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC91 exposes factual stage buckets without sensitive fields',()=>{
  assert.match(worker,/triageStage='ack_overdue'/);
  assert.match(worker,/triageStage='ack_critical'/);
  assert.match(worker,/triageStage='recovery_overdue'/);
  assert.match(worker,/recoveryOverdue:triageItems\.filter/);
  assert.match(worker,/ackCritical:triageItems\.filter/);
  assert.match(worker,/ackOverdue:triageItems\.filter/);
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
});

test('RC91 admin renders triage queue and existing threshold meaning',()=>{
  assert.match(app,/SLO Breach Triage Queue/);
  assert.match(app,/recovery overdue/);
  assert.match(app,/ACK critical/);
  assert.match(app,/RC91 — triage использует только существующие пороги RC87/);
});

test('RC91 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachTriageDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachTriageSelfTest: newsImpactRecoveryIncidentSloBreachTriageDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloBreachTriage','newsImpactRecoveryIncidentBreachStageBuckets']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC91 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc91/i.test(x)));
});
