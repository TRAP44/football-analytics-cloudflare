import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Consolidated recovery incident/SLO regression coverage (historical RC85-RC89).

// test/news-impact-recovery-incident-center-rc85.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  assert.ok(!files.some(x=>/rc85/i.test(x)));
});
}

// test/news-impact-recovery-incident-ack-rc86.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc86/i.test(x)));
});
}

// test/news-impact-recovery-incident-slo-rc87.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc87/i.test(x)));
});
}

// test/news-impact-recovery-incident-slo-dashboard-rc88.test.js
{
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
}

// test/news-impact-recovery-incident-breach-feed-rc89.test.js
{
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
}
