import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC90 derives watchlist only from RC89 breach feed',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachWatchlist\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachWatchlist=buildNewsImpactRecoveryIncidentSloBreachWatchlist\(/);
  assert.match(worker,/const active=items\.filter\(x=>x\?\.active\)/);
  assert.match(worker,/items:activeSorted\.slice\(0,safeLimit\)/);
});

test('RC90 reuses RC87 SLO thresholds without adding routing policy',()=>{
  assert.match(worker,/ackMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES/);
  assert.match(worker,/criticalAckMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES/);
  assert.match(worker,/recoveryMinutes:NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES/);
  assert.match(worker,/source:'rc87_existing_slo'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC90 exposes privacy-safe active aging summary',()=>{
  assert.match(worker,/criticalActive:active\.filter/);
  assert.match(worker,/oldestActiveMinutes:active\.length \? Math\.max/);
  assert.match(worker,/repeatedActivePairs:activeRepeatedPairs\.length/);
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
});

test('RC90 admin renders factual watchlist and aging',()=>{
  assert.match(app,/SLO Breach Watchlist/);
  assert.match(app,/oldest/);
  assert.match(app,/Активных SLO breach-инцидентов/);
  assert.match(app,/RC90 — watchlist и aging/);
});

test('RC90 deterministic watchlist drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachWatchlistDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachWatchlistSelfTest: newsImpactRecoveryIncidentSloBreachWatchlistDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloBreachWatchlist','newsImpactRecoveryIncidentBreachAging']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC90 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24|rc90/i.test(x)));
});
