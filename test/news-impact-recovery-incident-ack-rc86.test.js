import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC86 persists acknowledgements as categorical growth events only',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT = 'news_impact_recovery_incident_ack'/);
  assert.match(worker,/eventName:NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT/);
  assert.match(worker,/incident_guard:code/);
  assert.match(worker,/incident_seen_at:lastSeenAt/);
  assert.match(worker,/ack_state:'acknowledged'/);
  const start=worker.indexOf('async function apiNewsImpactRecoveryIncidentAck');
  const end=worker.indexOf('async function apiLaunchFunnel',start);
  const block=worker.slice(start,end);
  assert.doesNotMatch(block,/rawError|error\.message|stack|note:/);
});

test('RC86 acknowledgement is scoped to the exact incident occurrence',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentAcknowledgements\(/);
  assert.match(worker,/incidentSeenAt/);
  assert.match(worker,/ack\.incidentSeenAt/);
  assert.match(worker,/ack\.acknowledgedAt/);
  assert.match(worker,/canAcknowledge:Boolean\(active && !currentOnly/);
});

test('RC86 suppresses acknowledged warnings until a new incident occurrence',()=>{
  assert.match(worker,/alertSuppressed:acknowledged/);
  assert.match(worker,/const suppressed=new Set/);
  assert.match(worker,/suppressed\.has\(newsImpactRecoveryIncidentKey/);
  assert.match(worker,/suppressedAlerts:list\.filter/);
  assert.match(app,/новый failure автоматически снова требует внимания/);
});

test('RC86 exposes a fixed runbook for each incident type',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentRunbook\(/);
  assert.match(worker,/Performance drift/);
  assert.match(worker,/Recent regression/);
  assert.match(worker,/Strategy evidence unavailable/);
  assert.match(worker,/automaticSafety/);
  assert.match(app,/Автозащита:/);
});

test('RC86 acknowledgement endpoint is admin-only and conflict-safe',()=>{
  assert.match(worker,/\/api\/recovery-incident-ack/);
  assert.match(worker,/isAdminUser\(user, cfg\)/);
  assert.match(worker,/Инцидент уже изменился или больше не активен/);
  assert.match(worker,/memory\.newsImpactRecoveryStrategy=\{value:null,loadedAt:0\}/);
});

test('RC86 admin UI acknowledges without hiding an active incident',()=>{
  assert.match(app,/recoveryIncidentAckPending: new Set\(\)/);
  assert.match(app,/async function acknowledgeRecoveryIncident/);
  assert.match(app,/✓ Просмотрено/);
  assert.match(app,/активен · просмотрен/);
  assert.match(app,/Recovery Incident Center/);
});

test('RC86 deterministic ack self-test and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentAckDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentAckSelfTest: newsImpactRecoveryIncidentAckDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentAcknowledgement','newsImpactRecoveryIncidentRunbook','newsImpactRecoveryIncidentAlertSuppression','newsImpactRecoveryIncidentAckPrivacyGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC86 reuses growth_events and needs no Supabase migration',()=>{
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_ACK_EVENT/);
  assert.match(worker,/incidentAckRows=rows\.filter/);
  const files=fs.readdirSync('.').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|rc86/i.test(x)));
});
