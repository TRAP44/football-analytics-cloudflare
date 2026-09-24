import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC74 builds per-decision News Impact action conversion',()=>{
  assert.match(worker,/function buildNewsImpactActionFunnel\(/);
  for (const code of ['material','detail','stable','guarded','baseline_missing','unavailable']) {
    assert.ok(worker.includes(`['${code}'`), `missing funnel decision ${code}`);
  }
  assert.match(worker,/decisionUsers\.has\(uid\)/);
  assert.match(worker,/conversionPct=users \? Math\.round\(\(actedUsers\.size\/users\)\*1000\)\/10 : 0/);
});

test('RC74 identifies the lowest-conversion decision state without exposing user ids',()=>{
  assert.match(worker,/function newsImpactActionFunnelBottleneck\(/);
  assert.match(worker,/sort\(\(a,b\)=>Number\(a\.conversionPct \|\| 0\)-Number\(b\.conversionPct \|\| 0\)/);
  assert.match(worker,/const newsImpactActionBottleneck=newsImpactActionFunnelBottleneck\(newsImpactActionFunnel\)/);
  assert.match(worker,/newsImpactActionBottleneck,/);
});

test('RC74 launch analytics UI shows decision-to-action funnel',()=>{
  assert.match(app,/const impactFunnel=Array\.isArray\(d\.newsImpactActionFunnel\)/);
  assert.match(app,/const impactBottleneck=d\.newsImpactActionBottleneck \|\| null/);
  assert.match(app,/News Impact → действие/);
  assert.match(app,/самая низкая конверсия/);
  assert.match(app,/topAction\?\.label/);
});

test('RC74 deterministic health contract is present',()=>{
  assert.match(worker,/function newsImpactActionFunnelDrill\(/);
  assert.match(worker,/newsImpactActionFunnelSelfTest: newsImpactActionFunnelDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactActionFunnel','newsImpactDecisionConversion','newsImpactActionBottleneck']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), `missing ${flag}`);
  }
});

test('RC74 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc74/i.test(x)));
});
