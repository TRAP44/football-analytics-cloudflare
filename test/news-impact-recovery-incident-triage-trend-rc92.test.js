import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC92 reconstructs weekly active triage snapshots from factual episode timestamps',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentTriageStageAt\(/);
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachTriageTrend\(/);
  assert.match(worker,/if \(Number\.isFinite\(recoveredMs\) && recoveredMs<=atMs\) return null/);
  assert.match(worker,/for \(let i=safeWeeks-1;i>=0;i-=1\)/);
  assert.match(worker,/snapshotAt:new Date\(snapshotAtMs\)\.toISOString\(\)/);
});

test('RC92 reuses RC87 thresholds and does not create new routing policy',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC92 reports week-over-week triage deltas and persistent pairs',()=>{
  assert.match(worker,/totalDelta:Number\(current\.total \|\| 0\)-Number\(previous\.total \|\| 0\)/);
  assert.match(worker,/recoveryOverdueDelta:/);
  assert.match(worker,/ackCriticalDelta:/);
  assert.match(worker,/ackOverdueDelta:/);
  assert.match(worker,/filter\(x=>x\.weeksPresent>=2\)/);
  assert.match(worker,/recoveryOverdueWeeks/);
  assert.match(worker,/ackCriticalWeeks/);
});

test('RC92 admin renders 4-week trend and recurring triage pairs',()=>{
  assert.match(app,/Triage Trend · 4 недели/);
  assert.match(app,/stuck pairs/);
  assert.match(app,/Пары, остающиеся в triage минимум 2 недельных снимка/);
  assert.match(app,/RC92 — trend строится из фактических incident episodes/);
});

test('RC92 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachTriageTrendDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachTriageTrendSelfTest: newsImpactRecoveryIncidentSloBreachTriageTrendDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloBreachTriageTrend','newsImpactRecoveryIncidentTriageRecurrence']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC92 privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc92/i.test(x)));
});
