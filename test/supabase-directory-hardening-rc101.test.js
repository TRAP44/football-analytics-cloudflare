import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baselinePath='supabase/baseline/supabase_baseline_v6_18.sql';
const baseline=fs.readFileSync(baselinePath,'utf8');

test('RC101 keeps Supabase SQL out of repository root',()=>{
  const root=fs.readdirSync('.').filter(x=>/^supabase_(?:baseline|migration)_.*\.sql$/i.test(x));
  assert.deepEqual(root,[]);
  assert.equal(fs.existsSync(baselinePath),true);
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_15.sql'),true);
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_16.sql'),true);
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_17.sql'),true);
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_18.sql'),true);
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_18_1.sql'),true);
});

test('RC101 baseline refuses an established application schema before DDL',()=>{
  assert.match(baseline,/RC101 safety guard/);
  assert.match(baseline,/to_regclass\('public\.users'\)/);
  assert.match(baseline,/to_regclass\('public\.runtime_controls'\)/);
  assert.match(baseline,/to_regclass\('public\.model_predictions'\)/);
  assert.match(baseline,/Fresh-install baseline refused: existing Football Analytics schema detected/);
  const guard=baseline.indexOf('RC101 safety guard');
  const firstDdl=baseline.indexOf('create table if not exists public.users');
  assert.ok(guard>=0 && firstDdl>guard);
});

test('RC101 preserves all numbered production upgrade migrations',()=>{
  for(const name of ['v6_9','v6_10','v6_11','v6_11_1','v6_12','v6_13','v6_14','v6_15','v6_16','v6_17','v6_18','v6_18_1']){
    assert.equal(fs.existsSync(`supabase/migrations/supabase_migration_${name}.sql`),true,name);
  }
});
