import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC76 loads an equal previous period without changing the current funnel window',()=>{
  assert.match(worker,/const analyticsNowMs=Date\.now\(\)/);
  assert.match(worker,/const previousSince=new Date\(analyticsNowMs-days\*2\*86400_000\)\.toISOString\(\)/);
  assert.match(worker,/previousWindowRows=/);
  assert.match(worker,/createdAt<Date\.parse\(since\)/);
  assert.match(worker,/trendAvailable=false/);
});

test('RC76 only confirms direction when both Wilson intervals separate',()=>{
  assert.match(worker,/function newsImpactTrendSignal\(/);
  assert.match(worker,/currentConfidence\.lowerPct/);
  assert.match(worker,/previousConfidence\.upperPct/);
  assert.match(worker,/currentConfidence\.upperPct/);
  assert.match(worker,/previousConfidence\.lowerPct/);
  for (const signal of ["'improved'","'weakened'","'uncertain'","'insufficient'"]) assert.ok(worker.includes(signal));
});

test('RC76 returns period-over-period trend without exposing identities',()=>{
  assert.match(worker,/function buildNewsImpactActionTrend\(/);
  assert.match(worker,/deltaPctPoints/);
  assert.match(worker,/currentUsers/);
  assert.match(worker,/previousUsers/);
  assert.match(worker,/newsImpactActionTrend,/);
  assert.match(worker,/signalRule:'non_overlapping_wilson_95'/);
});

test('RC76 admin UI distinguishes confirmed movement from uncertainty',()=>{
  assert.match(app,/Динамика News Impact/);
  assert.match(app,/подтверждённый рост/);
  assert.match(app,/подтверждённое снижение/);
  assert.match(app,/изменение не подтверждено/);
  assert.match(app,/мало данных/);
});

test('RC76 deterministic health contract is release gated',()=>{
  assert.match(worker,/function newsImpactActionTrendDrill\(/);
  assert.match(worker,/newsImpactActionTrendSelfTest: newsImpactActionTrendDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactFunnelTrend','newsImpactPeriodComparison','newsImpactTrendSignificanceGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), `missing ${flag}`);
  }
});

test('RC76 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc76/i.test(x)));
});
