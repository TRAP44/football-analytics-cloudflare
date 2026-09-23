import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC98 composes factual ranking, trend and executive summary into a short focus queue',()=>{
  assert.match(worker,/function buildNewsImpactRecoveryIncidentSloImpactFocusQueue\(/);
  assert.match(worker,/const trendByKey=new Map/);
  assert.match(worker,/safeLimit=Math\.max\(1,Math\.min\(10,Number\(limit \|\| 5\)\)\)/);
  assert.match(worker,/queuePosition:index\+1/);
  assert.match(worker,/sourceReleases:\['RC93','RC94','RC97'\]/);
});

test('RC98 ordering is factual and does not introduce a severity score',()=>{
  assert.match(worker,/b\.currentWeekOverdueMinutes-a\.currentWeekOverdueMinutes/);
  assert.match(worker,/b\.weekDeltaMinutes-a\.weekDeltaMinutes/);
  assert.match(worker,/b\.totalOverdueMinutes-a\.totalOverdueMinutes/);
  assert.match(worker,/ordering:'current_week_overdue_then_week_delta_then_cumulative_overdue'/);
  assert.match(worker,/routingChanged:false/);
  assert.match(worker,/persistence:'none'/);
});

test('RC98 admin renders focus queue without automated routing claims',()=>{
  assert.match(app,/SLO Impact Focus Queue/);
  assert.match(app,/мин за неделю/);
  assert.match(app,/В очереди:/);
  assert.match(app,/RC98 — Focus Queue сортирует только по фактам/);
});

test('RC98 deterministic drill locks ordering and summary',()=>{
  assert.match(worker,/function newsImpactRecoveryIncidentSloImpactFocusQueueDrill\(/);
  assert.match(worker,/result\.summary\.queuedPairs===3/);
  assert.match(worker,/result\.summary\.increasingQueuedPairs===2/);
  assert.match(worker,/result\.rows\[0\]\?\.reason==='b'/);
  assert.match(worker,/result\.rows\[1\]\?\.reason==='a'/);
  assert.match(worker,/result\.rows\[2\]\?\.reason==='c'/);
});

test('RC98 health, privacy and storage boundaries remain fail-closed',()=>{
  assert.match(worker,/newsImpactRecoveryIncidentSloImpactFocusQueueSelfTest: newsImpactRecoveryIncidentSloImpactFocusQueueDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactRecoveryIncidentSloImpactFocusQueue','newsImpactRecoveryIncidentSloImpactFocusOrdering']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
  assert.match(worker,/privacy:\{telegramIdsExposed:false,rawErrorsExposed:false,freeTextExposed:false\}/);
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^v6_\d/.test(x));
  assert.ok(files.includes('v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|v6_18|v6_19|v6_20|v6_21|v6_22|v6_23|v6_24/i.test(x)));
});
