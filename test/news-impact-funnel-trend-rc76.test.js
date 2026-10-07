import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC76 loads an equal previous period without changing the current funnel window',()=>{
  assert.match(growth,/const analyticsNowMs=Date\.now\(\)/);
  assert.match(growth,/const previousSince=new Date\(analyticsNowMs-days\*2\*86400_000\)\.toISOString\(\)/);
  assert.match(growth,/previousWindowRows=/);
  assert.match(growth,/createdAt<Date\.parse\(since\)/);
  assert.match(growth,/previousNewsImpactActionRows=previousWindowRows\.filter/);
  assert.match(growth,/const previousPeriodEndMs=Date\.parse\(since\)/);
  assert.match(growth,/asOfMs:Number\.isFinite\(previousPeriodEndMs\) \? previousPeriodEndMs : analyticsNowMs/);
  assert.doesNotMatch(growth,/previousNewsImpactActionRows=comparisonRows\.filter/);
  assert.match(growth,/trendAvailable=false/);
});

test('RC76 only confirms direction when both Wilson intervals separate',()=>{
  assert.match(recovery,/function newsImpactTrendSignal\(/);
  assert.match(recovery,/function newsImpactTrendConfidence\(/);
  assert.match(recovery,/eligibleForBottleneck!==true/);
  assert.match(recovery,/newsImpactCount\(currentRow\.users\)<minUsers/);
  assert.match(recovery,/currentConfidence\.lowerPct>previousConfidence\.upperPct/);
  assert.match(recovery,/currentConfidence\.upperPct<previousConfidence\.lowerPct/);
  for (const signal of ["'improved'","'weakened'","'uncertain'","'insufficient'"]) assert.ok(recovery.includes(signal));
});

test('RC76 returns period-over-period trend without exposing identities',()=>{
  assert.match(recovery,/function buildNewsImpactActionTrend\(/);
  assert.match(recovery,/deltaPctPoints/);
  assert.match(recovery,/currentUsers/);
  assert.match(recovery,/previousUsers/);
  assert.match(growth,/newsImpactActionTrend,/);
  assert.match(growth,/signalRule:'non_overlapping_wilson_95'/);
});

test('RC76 admin UI distinguishes confirmed movement from uncertainty',()=>{
  assert.match(admin,/Динамика News Impact/);
  assert.match(admin,/подтверждённый рост/);
  assert.match(admin,/подтверждённое снижение/);
  assert.match(admin,/изменение не подтверждено/);
  assert.match(admin,/мало данных/);
});

test('RC76 deterministic trend drill remains wired through the recovery runtime',()=>{
  assert.match(recovery,/function newsImpactActionTrendDrill\(/);
  assert.match(recovery,/signal==='improved'/);
  assert.match(recovery,/signal==='uncertain'/);
  assert.match(recovery,/signal==='insufficient'/);
  assert.match(recovery,/deltaPctPoints===50/);
  assert.match(recovery,/forged==='insufficient'/);
  assert.match(recovery,/malformed\.length===0/);
  assert.match(worker,/function newsImpactActionTrendDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactActionTrendDrill/s);
});

test('RC76 trend runtime rejects malformed rows, coercive flags and invalid intervals',()=>{
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_FUNNEL_MIN_USERS:10,
    NEWS_IMPACT_FUNNEL_STABLE_USERS:30,
  });

  assert.equal(runtime.newsImpactTrendSignal(
    {confidence:{eligibleForBottleneck:'true',lowerPct:90,upperPct:100}},
    {confidence:{eligibleForBottleneck:true,lowerPct:0,upperPct:10}},
  ),'insufficient');

  assert.equal(runtime.newsImpactTrendSignal(
    {confidence:{eligibleForBottleneck:true,lowerPct:90,upperPct:80}},
    {confidence:{eligibleForBottleneck:true,lowerPct:0,upperPct:10}},
  ),'insufficient');

  assert.deepEqual(runtime.buildNewsImpactActionTrend({broken:true},null),[]);

  const rows=runtime.buildNewsImpactActionTrend([
    null,
    {code:{toString(){throw new Error('must not coerce');}},label:'bad'},
    {
      code:'material',
      label:'Material',
      users:true,
      conversionPct:'not-a-number',
      confidence:{eligibleForBottleneck:true,lowerPct:60,upperPct:80},
    },
  ],[
    {
      code:'material',
      label:'Material',
      users:10,
      conversionPct:50,
      confidence:{eligibleForBottleneck:true,lowerPct:20,upperPct:40},
    },
  ]);

  assert.equal(rows.length,1);
  assert.equal(rows[0].code,'material');
  assert.equal(rows[0].signal,'insufficient');
  assert.equal(rows[0].currentUsers,0);
  assert.equal(rows[0].currentPct,0);
  assert.equal(rows[0].previousPct,50);
  assert.equal(rows[0].deltaPctPoints,0);
});

test('RC76 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc76/i.test(x)));
});
