import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC75 uses an explicit sample gate before naming a bottleneck',()=>{
  assert.match(worker,/const NEWS_IMPACT_FUNNEL_MIN_USERS = 10/);
  assert.match(worker,/const NEWS_IMPACT_FUNNEL_STABLE_USERS = 30/);
  assert.match(recovery,/eligibleForBottleneck:n>=NEWS_IMPACT_FUNNEL_MIN_USERS/);
  assert.match(recovery,/filter\(x=>Boolean\(x\?\.confidence\?\.eligibleForBottleneck\)\)/);
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
  assert.match(recovery,/status=n>=NEWS_IMPACT_FUNNEL_STABLE_USERS \? 'stable'/);
  assert.match(recovery,/n>=NEWS_IMPACT_FUNNEL_MIN_USERS \? 'early'/);
  assert.match(recovery,/function newsImpactFunnelConfidenceDrill\(/);
  assert.match(recovery,/insufficient\.eligibleForBottleneck===false/);
  assert.match(recovery,/early\.eligibleForBottleneck===true/);
  assert.match(recovery,/stable\.stable===true/);
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

test('RC75 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc75/i.test(x)));
});
