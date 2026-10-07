import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const analytics=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC74 builds per-decision News Impact action conversion',()=>{
  assert.match(recovery,/function buildNewsImpactActionFunnel\(/);
  assert.match(recovery,/NEWS_IMPACT_FUNNEL_DECISIONS\.map/);
  assert.match(recovery,/decisionUsers\.has\(uid\)/);
  assert.match(recovery,/const conversionPct=users \? Math\.round\(\(actedUsers\.size\/users\)\*1000\)\/10 : 0/);
  assert.match(recovery,/observedUsers:observedDecisionUsers\.size/);
  assert.match(recovery,/immatureUsers/);
  assert.match(recovery,/actionWindowMinutes/);
});

test('RC74 identifies the lowest-conversion eligible decision state without exposing user ids',()=>{
  assert.match(recovery,/function newsImpactActionFunnelBottleneck\(/);
  assert.match(recovery,/eligibleForBottleneck/);
  assert.match(recovery,/Number\(a\.conversionPct \|\| 0\)-Number\(b\.conversionPct \|\| 0\)/);
  assert.match(analytics,/const newsImpactActionBottleneck=newsImpactActionFunnelBottleneck\(newsImpactActionFunnel\)/);
  assert.match(analytics,/newsImpactActionBottleneck,/);
});

test('RC74 launch analytics UI shows decision-to-action funnel',()=>{
  assert.match(admin,/const impactFunnel=Array\.isArray\(d\.newsImpactActionFunnel\)/);
  assert.match(admin,/const impactBottleneck=d\.newsImpactActionBottleneck \|\| null/);
  assert.match(admin,/News Impact → действие/);
  assert.match(admin,/самая низкая конверсия/);
  assert.match(admin,/topAction\?\.label/);
});

test('RC74 deterministic funnel drill remains present in the recovery runtime',()=>{
  assert.match(recovery,/function newsImpactActionFunnelDrill\(/);
  assert.match(recovery,/material\?\.conversionPct===50/);
  assert.match(recovery,/stable\?\.conversionPct===100/);
  assert.match(recovery,/bottleneck\?\.code==='material'/);
  assert.match(recovery,/cases:8/);
  assert.match(worker,/function newsImpactActionFunnelDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactActionFunnelDrill/s);
  assert.match(worker,/createNewsImpactRecoveryRuntime/);
});

test('RC74 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc74/i.test(x)));
});
