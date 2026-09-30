import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC88 builds factual incident episode history from adverse to safe guards',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentEpisodeHistory\(/);
  assert.match(worker,/openByPair=new Map\(\)/);
  assert.match(worker,/episode\.recoveredAt=new Date\(event\.at\)\.toISOString\(\)/);
  assert.match(worker,/episode\.occurrences\+=1/);
  assert.match(worker,/guardCodes/);
});

test('RC88 keeps full acknowledgement history for first-review latency',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentAcknowledgementHistory\(/);
  assert.match(worker,/firstAcknowledgedAt/);
  assert.match(worker,/incidentSeenAt/);
  const start=worker.indexOf('function buildNewsImpactRecoveryIncidentAcknowledgementHistory');
  const end=worker.indexOf('function buildNewsImpactRecoveryIncidentEpisodeHistory',start);
  const block=worker.slice(start,end);
  assert.doesNotMatch(block,/telegram_id\s*:/);
  assert.doesNotMatch(block,/rawError|error\.message|stack|query/);
});

test('RC88 calculates weekly ACK and recovery SLO compliance',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloDashboard\(/);
  assert.match(worker,/function newsImpactRecoveryEpisodeSloState\(/);
  assert.match(worker,/ackSloPct:newsImpactRecoverySloPct/);
  assert.match(worker,/recoverySloPct:newsImpactRecoverySloPct/);
  assert.match(worker,/avgAckMinutes/);
  assert.match(worker,/avgRecoveryMinutes/);
  assert.match(worker,/weekly/);
});

test('RC88 excludes immature short auto-recovery from ACK breach denominator',()=>{
  assert.match(worker,/const ackEligible=Number\.isFinite\(ackMs\) \|\| elapsedMinutes>=NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES/);
  assert.match(worker,/const ackBreached=ackEligible && !ackMet/);
});

test('RC88 ranks recurring reason plus action episode pairs',()=>{
  assert.match(worker,/const recurrence=new Map\(\)/);
  assert.match(worker,/const key=`\$\{episode\.reason\}\|\$\{episode\.action\}`/);
  assert.match(worker,/filter\(x=>x\.episodes>=2\)/);
  assert.match(worker,/recoveryBreaches/);
  assert.match(worker,/ackBreaches/);
});

test('RC88 admin renders weekly trend and recurring issues without changing routing',()=>{
  assert.match(app,/Incident SLO Dashboard · 4 недели/);
  assert.match(app,/Повторяющиеся Recovery-проблемы/);
  assert.match(app,/ACK breaches/);
  assert.match(app,/Recovery breaches/);
  assert.match(app,/routing не меняется/);
});

test('RC88 dashboard is exposed from the shared runtime loader',()=>{
  assert.match(worker,/incidentEpisodeHistory=buildNewsImpactRecoveryIncidentEpisodeHistory\(failures,incidentAckRows\)/);
  assert.match(worker,/newsImpactRecoveryStrategyLoaded\.incidentEpisodeHistory/);
  assert.match(worker,/newsImpactRecoveryIncidentSloDashboard=newsImpactRecoveryStrategyLoaded\.available/);
  assert.match(worker,/buildNewsImpactRecoveryIncidentSloDashboard\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloDashboard,/);
});

test('RC88 deterministic dashboard drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloDashboardDrill\(/);
  assert.match(worker,/newsImpactRecoveryIncidentSloDashboardSelfTest: newsImpactRecoveryIncidentSloDashboardDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloDashboard','newsImpactRecoveryIncidentWeeklyTrend','newsImpactRecoveryIncidentRecurrence']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});

test('RC88 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc88/i.test(x)));
});
