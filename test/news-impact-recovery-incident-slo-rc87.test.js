import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC87 derives incident episodes and recovery timestamps from factual failure guards',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentEvents\(/);
  assert.match(worker,/episodeStartedAt/);
  assert.match(worker,/episodeLastSeenAt/);
  assert.match(worker,/episodeRecoveredAt/);
  assert.match(worker,/open\.episode\.recoveredAt=new Date\(event\.at\)\.toISOString\(\)/);
});

test('RC87 defines acknowledgement and recovery SLO targets',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES = 30/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_CRITICAL_MINUTES = 120/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES = 360/);
  assert.match(worker,/ackStatus/);
  assert.match(worker,/recoveryStatus/);
  assert.match(worker,/ackLatencyMinutes/);
  assert.match(worker,/recoveryLatencyMinutes/);
});

test('RC87 escalates overdue active incidents without changing routing',()=>{
  assert.match(worker,/effectivePriority='critical'/);
  assert.match(worker,/escalationReason='recovery_slo_breach'/);
  assert.match(worker,/escalationReason='ack_critical_overdue'/);
  assert.match(worker,/escalationReason='ack_slo_breach'/);
  assert.match(worker,/persistence:'none'/);
  assert.match(worker,/fallback:'fixed'/);
});

test('RC87 summarizes escalations and SLO breaches',()=>{
  assert.match(worker,/escalatedActive:list\.filter/);
  assert.match(worker,/criticalActive:list\.filter/);
  assert.match(worker,/ackSloBreached:list\.filter/);
  assert.match(worker,/recoverySloBreached:list\.filter/);
  assert.match(worker,/avgAckMinutes/);
  assert.match(worker,/avgRecoveryMinutes/);
});

test('RC87 adds SLO escalation alerts',()=>{
  assert.match(worker,/incident_recovery_slo_breach/);
  assert.match(worker,/incident_ack_slo_breach/);
  assert.match(worker,/critical:list\.filter\(x=>x\.severity==='critical'\)\.length/);
  assert.match(app,/ACK SLO просрочено/);
  assert.match(app,/Recovery SLO просрочено/);
  assert.match(app,/приоритет повышен/);
});

test('RC87 admin explains latency and routing isolation',()=>{
  assert.match(app,/SLO: просмотр/);
  assert.match(app,/возраст/);
  assert.match(app,/просмотр:/);
  assert.match(app,/восстановление:/);
  assert.match(app,/Эскалация меняет только административный приоритет, а не recovery-routing/);
});

test('RC87 deterministic SLO drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloSelfTest: newsImpactRecoveryIncidentSloDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSlo','newsImpactRecoveryIncidentEscalation','newsImpactRecoveryIncidentLatencyMetrics']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC87 keeps SLO derived and needs no new Supabase migration',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloGuard/);
  assert.match(worker,/derived_from_incident_age_and_ack_state/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|rc87/i.test(x)));
});
