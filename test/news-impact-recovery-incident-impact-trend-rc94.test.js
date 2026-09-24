import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

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
