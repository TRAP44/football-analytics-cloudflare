import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC75 uses an explicit sample gate before naming a bottleneck',()=>{
  assert.match(worker,/NEWS_IMPACT_FUNNEL_MIN_USERS = 10/);
  assert.match(worker,/NEWS_IMPACT_FUNNEL_STABLE_USERS = 30/);
  assert.match(worker,/eligibleForBottleneck:n>=NEWS_IMPACT_FUNNEL_MIN_USERS/);
  assert.match(worker,/filter\(x=>Boolean\(x\?\.confidence\?\.eligibleForBottleneck\)\)/);
});

test('RC75 computes a 95 percent Wilson interval for conversion',()=>{
  assert.match(worker,/function newsImpactConversionConfidence\(/);
  assert.match(worker,/const z=1\.96/);
  assert.match(worker,/lowerPct=Math\.round/);
  assert.match(worker,/upperPct=Math\.round/);
  assert.match(worker,/interval:'wilson_95'/);
});

test('RC75 distinguishes insufficient early and stable samples',()=>{
  for (const status of ["'insufficient'","'early'","'stable'"]) assert.ok(worker.includes(status));
  assert.match(worker,/status=n>=NEWS_IMPACT_FUNNEL_STABLE_USERS \? 'stable'/);
  assert.match(worker,/n>=NEWS_IMPACT_FUNNEL_MIN_USERS \? 'early'/);
  assert.match(worker,/function newsImpactFunnelConfidenceDrill\(/);
});

test('RC75 admin UI exposes uncertainty instead of overclaiming',()=>{
  assert.match(app,/impactConfidenceGuard=d\.newsImpactActionConfidenceGuard/);
  assert.match(app,/95% ДИ/);
  assert.match(app,/данных пока мало для определения узкого места/);
  assert.match(app,/мало данных/);
});

test('RC75 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc75/i.test(x)));
});
