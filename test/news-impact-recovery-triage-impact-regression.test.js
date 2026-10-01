import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Consolidated recovery triage/impact regression coverage (historical RC90-RC94).

// test/news-impact-recovery-incident-breach-watchlist-rc90.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc90/i.test(x)));
});
}

// test/news-impact-recovery-incident-breach-triage-rc91.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc91/i.test(x)));
});
}

// test/news-impact-recovery-incident-triage-trend-rc92.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  assert.ok(!files.some(x=>/rc92/i.test(x)));
});
}

// test/news-impact-recovery-incident-impact-ranking-rc93.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

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
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc93/i.test(x)));
});
}

// test/news-impact-recovery-incident-impact-trend-rc94.test.js
{
const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC94 computes overdue minutes only inside each weekly window',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentOverdueWithinWindow\(/);
  assert.match(worker,/const from=Math\.max\(windowStartMs,fromMs\)/);
  assert.match(worker,/const to=Math\.min\(windowEndMs,toMs\)/);
  assert.match(worker,/ackOverdueStartMs=startMs\+NEWS_IMPACT_RECOVERY_INCIDENT_ACK_SLO_MINUTES\*60000/);
  assert.match(worker,/recoveryOverdueStartMs=startMs\+NEWS_IMPACT_RECOVERY_INCIDENT_RECOVERY_SLO_MINUTES\*60000/);
});

test('RC94 builds four non-overlapping factual weekly impact windows',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloBreachImpactTrend\(/);
  assert.match(worker,/const windowEndMs=asOfMs-i\*weekMs/);
  assert.match(worker,/const windowStartMs=windowEndMs-weekMs/);
  assert.match(worker,/methodology:'weekly_overlap_minutes_above_existing_ack_and_recovery_slo'/);
  assert.match(worker,/source:'rc87_existing_slo'/);
});

test('RC94 direction is exact sign of week-over-week delta without a stability threshold',()=>{
  assert.match(worker,/direction:deltaMinutes>0 \? 'increased' : deltaMinutes<0 \? 'decreased' : 'unchanged'/);
  assert.match(worker,/Math\.abs\(b\.deltaMinutes\)-Math\.abs\(a\.deltaMinutes\)/);
  assert.doesNotMatch(worker,/IMPACT_TREND_(?:MIN|THRESHOLD|STABILITY)/);
});

test('RC94 admin renders weekly burden and pair direction',()=>{
  assert.match(app,/SLO Impact Trend · 4 недели/);
  assert.match(app,/текущая неделя/);
  assert.match(app,/предыдущая/);
  assert.match(app,/RC94 — недельный trend считает только минуты просрочки/);
});

test('RC94 deterministic drill and health contract',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloBreachImpactTrendDrill\(/);
  assert.match(worker,/trend\.weekly\[2\]\.totalOverdueMinutes===23400/);
  assert.match(worker,/trend\.weekly\[3\]\.totalOverdueMinutes===28470/);
  assert.match(worker,/trend\.summary\.deltaMinutes===5070/);
  assert.match(worker,/timeout\?\.deltaMinutes===8310/);
  assert.match(worker,/server\?\.deltaMinutes===-3240/);
  assert.match(worker,/provider\?\.deltaMinutes===0/);
  assert.match(worker,/newsImpactRecoveryIncidentSloBreachImpactTrendSelfTest: newsImpactRecoveryIncidentSloBreachImpactTrendDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('RC94 keeps privacy, storage and routing boundaries unchanged',()=>{
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc94/i.test(x)));
});
}
