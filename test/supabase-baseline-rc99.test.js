import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseline=fs.readFileSync(new URL('../supabase/baseline.sql',import.meta.url),'utf8');
const historicalBaseline=fs.readFileSync(new URL('../supabase/history/baseline_v6_9.sql',import.meta.url),'utf8').trim();
const migrationNames=['v6_10.sql','v6_11.sql','v6_11_1.sql','v6_12.sql','v6_13.sql','v6_14.sql','v6_15.sql'];
const migrations=migrationNames.map(name=>({
  name,
  sql:fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').trim(),
}));

test('RC99 consolidated baseline contains historical baseline and every required migration',()=>{
  assert.ok(baseline.includes(historicalBaseline),'historical v6.9 baseline missing from consolidated baseline');
  for(const migration of migrations){
    assert.ok(baseline.includes(migration.sql),migration.name+' missing from consolidated baseline');
  }
});

test('RC99 consolidated baseline preserves release order',()=>{
  const markers=[
    'BEGIN historical baseline v6.9',
    'BEGIN migration v6.10',
    'BEGIN migration v6.11',
    'BEGIN migration v6.11.1',
    'BEGIN migration v6.12',
    'BEGIN migration v6.13',
    'BEGIN migration v6.14',
    'BEGIN migration v6.15',
  ];
  let previous=-1;
  for(const marker of markers){
    const position=baseline.indexOf(marker);
    assert.ok(position>previous,'out-of-order or missing marker: '+marker);
    previous=position;
  }
});

test('RC99 baseline includes critical security and product schema contracts',()=>{
  const sql=baseline.toLowerCase();
  assert.match(sql,/transition_model_calibration/);
  assert.match(sql,/backend_security_contract/);
  assert.match(sql,/backend_default_acl_contract/);
  assert.match(sql,/bot_digest_subscriptions/);
  assert.match(sql,/referee_match_history/);
  assert.match(sql,/ai_signal_code/);
  assert.match(sql,/growth_events/);
  assert.match(sql,/revoke all privileges on all tables in schema public from public, anon, authenticated/);
});

test('RC99 removes legacy Supabase SQL files from repository root',()=>{
  const root=fs.readdirSync(new URL('../',import.meta.url));
  const legacy=root.filter(name=>/^supabase_(?:baseline|migration)_.*\.sql$/i.test(name));
  assert.deepEqual(legacy,[]);
});
