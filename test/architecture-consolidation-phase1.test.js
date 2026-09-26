import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read=(p)=>readFileSync(new URL('../'+p, import.meta.url),'utf8');

test('fresh install baseline is current through schema v6.19',()=>{
  assert.equal(existsSync(new URL('../supabase/baseline/supabase_baseline_v6_19.sql',import.meta.url)),true);
  const sql=read('supabase/baseline/supabase_baseline_v6_19.sql');
  for(const token of ['analysis_cache','provider text','source_updated_at','freshness_status','bookmaker_count','data_provenance','model_inputs_version']) assert.match(sql,new RegExp(token));
  assert.match(sql,/Fresh-install baseline refused/);
});

test('release contract is the documented source of truth',()=>{
  const c=JSON.parse(read('release-contract.json'));
  assert.equal(c.productionSchema,'6.19');
  assert.equal(c.freshInstallBaseline,'supabase/baseline/supabase_baseline_v6_19.sql');
  assert.equal(c.accessContract,'public-telegram-validated-by-default');
  assert.match(read('supabase/README.md'),/release-contract\.json/);
  assert.match(read('INSTALL_RU.md'),/release-contract\.json/);
});

test('public feedback hides internal beta and severity terminology',()=>{
  const html=read('public/index.html');
  const start=html.indexOf('<section class="panel beta-feedback-panel">');
  const end=html.indexOf('<section class="panel admin-console"',start);
  const publicFeedback=html.slice(start,end);
  assert.match(publicFeedback,/Сообщить о проблеме/);
  assert.doesNotMatch(publicFeedback,/Closed beta|>\\s*(?:BLOCKER|MAJOR|MINOR)\\b|Beta Dashboard/i);
  const app=read('public/app.js');
  assert.doesNotMatch(app.slice(0,app.indexOf('function betaHealthLabel')),/title:\s*'Закрытая beta'/);
});
