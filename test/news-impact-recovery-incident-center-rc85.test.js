import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC85 derives privacy-safe recovery incident events from categorical guards',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentEvents\(/);
  assert.match(worker,/NEWS_IMPACT_RECOVERY_INCIDENT_CODES/);
  assert.match(worker,/guardReason,/);
  assert.match(worker,/priority:(?:guardReason|event\.guardReason)==='performance_drift' \? 'high' : 'medium'/);
  const start=worker.indexOf('function buildNewsImpactRecoveryIncidentEvents');
  const end=worker.indexOf('function newsImpactRecoveryIncidentKey',start);
  const block=worker.slice(start,end);
  assert.doesNotMatch(block,/telegram_id\s*:/);
  assert.doesNotMatch(block,/rawError|error\.message|stack|query/);
});

test('RC85 incident lifecycle marks current failures active and normalized guards recovered',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentCenter\(/);
  assert.match(worker,/(?:status:active|const status=active) \? 'active' : 'recovered'/);
  assert.match(worker,/currentGuardReason/);
  assert.match(worker,/currentOnly:true/);
  assert.match(worker,/strategy_evidence_unavailable/);
});

test('RC85 summarizes active recovered and priority counts',()=>{
  assert.match(worker,/function summarizeNewsImpactRecoveryIncidents\(/);
  assert.match(worker,/active:list\.filter\(x=>x\.status==='active'\)\.length/);
  assert.match(worker,/recovered:list\.filter\(x=>x\.status==='recovered'\)\.length/);
  assert.match(worker,/highActive:list\.filter/);
  assert.match(worker,/mediumActive:list\.filter/);
});

test('RC85 uses the shared 30-day loader and exposes only sanitized incident data',()=>{
  assert.match(worker,/incidentEvents=buildNewsImpactRecoveryIncidentEvents\(failures/);
  assert.match(worker,/newsImpactRecoveryStrategyLoaded\.incidentEvents/);
  assert.match(worker,/newsImpactRecoveryIncidents=buildNewsImpactRecoveryIncidentCenter/);
  assert.match(worker,/newsImpactRecoveryIncidentSummary=summarizeNewsImpactRecoveryIncidents/);
  assert.match(worker,/newsImpactRecoveryIncidents,/);
  assert.match(worker,/newsImpactRecoveryIncidentSummary,/);
});

test('RC85 admin has a localized incident center with lifecycle state',()=>{
  assert.match(app,/Recovery Incident Center/);
  assert.match(app,/активен/);
  assert.match(app,/восстановлен/);
  assert.match(app,/текущее состояние/);
  assert.match(app,/В Incident Center нет Telegram ID и raw error/);
});

test('RC85 deterministic incident drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSelfTest: newsImpactRecoveryIncidentDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentCenter','newsImpactRecoveryIncidentLifecycle','newsImpactRecoveryIncidentPrivacyGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC85 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|rc85/i.test(x)));
});
