import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC89 derives breach feed only from existing incident episode SLO state',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachFeed\(/);
  assert.match(worker,/newsImpactRecoveryEpisodeSloState\(episode,asOfMs\)/);
  assert.match(worker,/!slo\.ackBreached && !slo\.recoveryBreached/);
  assert.match(worker,/breachTypes\.push\('ack'\)/);
  assert.match(worker,/breachTypes\.push\('recovery'\)/);
});

test('RC89 uses existing critical ACK and recovery thresholds without new routing policy',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES/);
  assert.match(worker,/episode\.active && slo\.recoveryBreached/);
  assert.match(worker,/routingChanged:false/);
  assert.doesNotMatch(worker,/RC89_ACK|RC89_RECOVERY|BREACH_TARGET_MINUTES/);
});

test('RC89 breach feed keeps privacy-safe categorical drilldown',()=>{
  const start=worker.indexOf('function buildNewsImpactRecoveryIncidentSloBreachFeed');
  const end=worker.indexOf('function buildNewsImpactRecoveryIncidentCenter',start);
  const block=worker.slice(start,end);
  assert.doesNotMatch(block,/telegram_id\s*:/);
  assert.doesNotMatch(block,/raw_error\s*:|error\.message|stack\s*:|query\s*:/);
  assert.match(block,/freeTextExposed:false/);
  assert.match(block,/rawErrorsExposed:false/);
  assert.match(block,/telegramIdsExposed:false/);
});

test('RC89 groups recurring breach pairs by reason plus action',()=>{
  assert.match(worker,/String\(item\.reason \|\| ''\)\+'\|'\+String\(item\.action \|\| ''\)/);
  assert.match(worker,/filter\(x=>x\.breachEpisodes>=2\)/);
  assert.match(worker,/activeBreaches/);
  assert.match(worker,/ackBreaches/);
  assert.match(worker,/recoveryBreaches/);
});

test('RC89 exposes breach feed from shared episode history',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachFeed=newsImpactRecoveryStrategyLoaded\.available/);
  assert.match(worker,/newsImpactRecoveryStrategyLoaded\.incidentEpisodeHistory/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachFeed,/);
});

test('RC89 admin renders factual breach drilldown',()=>{
  assert.match(app,/SLO Breach Feed/);
  assert.match(app,/ACK latency/);
  assert.match(app,/recovery latency/);
  assert.match(app,/RC89 — drilldown/);
  assert.match(app,/routing-решения не добавляются/);
});

test('RC89 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachFeedDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachFeedSelfTest: newsImpactRecoveryIncidentSloBreachFeedDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloBreachFeed','newsImpactRecoveryIncidentBreachDrilldown','newsImpactRecoveryIncidentBreachPrivacyGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC89 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc89/i.test(x)));
});
