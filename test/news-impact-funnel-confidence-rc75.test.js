import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC75 uses an explicit sample gate before naming a bottleneck',()=>{
  assert.match(recovery,/const minUsers=newsImpactSampleThreshold\(NEWS_IMPACT_FUNNEL_MIN_USERS,10\)/);
  assert.match(recovery,/const stableUsers=Math\.max\(minUsers,newsImpactSampleThreshold\(NEWS_IMPACT_FUNNEL_STABLE_USERS,30\)\)/);
  assert.match(recovery,/eligibleForBottleneck:n>=minUsers/);
  assert.match(recovery,/x\?\.confidence\?\.eligibleForBottleneck!==true/);
  assert.match(recovery,/users>=minUsers/);
  assert.match(growth,/newsImpactActionConfidenceGuard=\{minUsers:NEWS_IMPACT_FUNNEL_MIN_USERS,stableUsers:NEWS_IMPACT_FUNNEL_STABLE_USERS,interval:'wilson_95'\}/);
});

test('RC75 computes a 95 percent Wilson interval for conversion',()=>{
  assert.match(recovery,/function newsImpactConversionConfidence\(/);
  assert.match(recovery,/const z=1\.96/);
  assert.match(recovery,/lowerPct=Math\.round/);
  assert.match(recovery,/upperPct=Math\.round/);
  assert.match(growth,/interval:'wilson_95'/);
});

test('RC75 distinguishes insufficient early and stable samples',()=>{
  for (const status of ["'insufficient'","'early'","'stable'"]) assert.ok(recovery.includes(status));
  assert.match(recovery,/status=n>=stableUsers \? 'stable'/);
  assert.match(recovery,/n>=minUsers \? 'early'/);
  assert.match(recovery,/function newsImpactFunnelConfidenceDrill\(/);
  assert.match(recovery,/insufficient\.eligibleForBottleneck===false/);
  assert.match(recovery,/early\.eligibleForBottleneck===true/);
  assert.match(recovery,/stable\.stable===true/);
  assert.match(recovery,/booleanSample\.status==='empty'/);
  assert.match(recovery,/forgedBottleneck===null/);
});

test('RC75 admin UI exposes uncertainty instead of overclaiming',()=>{
  assert.match(admin,/impactConfidenceGuard=d\.newsImpactActionConfidenceGuard/);
  assert.match(admin,/95% ДИ/);
  assert.match(admin,/данных пока мало для определения узкого места/);
  assert.match(admin,/мало данных/);
});

test('RC75 confidence drill remains wired through the recovery runtime',()=>{
  assert.match(worker,/function newsImpactFunnelConfidenceDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactFunnelConfidenceDrill/s);
  assert.match(worker,/createNewsImpactRecoveryRuntime/);
});

test('RC75 confidence runtime rejects coercive counts and forged bottleneck eligibility',()=>{
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:new Set(['full_ai']),
    NEWS_IMPACT_ACTION_LABELS:{full_ai:'Полный AI'},
    NEWS_IMPACT_FUNNEL_MIN_USERS:10,
    NEWS_IMPACT_FUNNEL_STABLE_USERS:30,
  });

  const booleanSample=runtime.newsImpactConversionConfidence(true,true);
  assert.equal(booleanSample.status,'empty');
  assert.equal(booleanSample.users,0);
  assert.equal(booleanSample.actedUsers,0);
  assert.equal(booleanSample.eligibleForBottleneck,false);

  const decimalSample=runtime.newsImpactConversionConfidence(5.5,10.5);
  assert.equal(decimalSample.status,'empty');

  const clamped=runtime.newsImpactConversionConfidence(99,10);
  assert.equal(clamped.users,10);
  assert.equal(clamped.actedUsers,10);
  assert.equal(clamped.lowerPct>=0,true);
  assert.equal(clamped.upperPct<=100,true);

  assert.equal(runtime.newsImpactActionFunnelBottleneck([
    {code:'forged',users:1,conversionPct:0,confidence:{eligibleForBottleneck:true}},
  ]),null);

  assert.equal(runtime.newsImpactActionFunnelBottleneck([
    {code:'invalid-pct',users:10,conversionPct:-1,confidence:{eligibleForBottleneck:true}},
  ]),null);

  const valid=runtime.newsImpactActionFunnelBottleneck([
    {code:'valid',users:10,conversionPct:50,confidence:{eligibleForBottleneck:true}},
    {code:'higher',users:30,conversionPct:80,confidence:{eligibleForBottleneck:true}},
  ]);
  assert.equal(valid?.code,'valid');
});

test('RC75 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc75/i.test(x)));
});
