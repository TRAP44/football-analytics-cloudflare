import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC72 maps News Impact Delta to explicit user-facing decision states',()=>{
  assert.match(worker,/function newsImpactDecisionCard\(/);
  for (const code of ['material','stable','detail','guarded','baseline_missing','unavailable']) {
    assert.ok(worker.includes(`code:'${code}'`), `missing decision ${code}`);
  }
  assert.match(worker,/Причинность не подтверждается/);
});

test('decision state controls Telegram actions instead of one generic keyboard',()=>{
  assert.match(worker,/function newsImpactDecisionKeyboard\(/);
  assert.match(worker,/Открыть обновлённый AI-разбор/);
  assert.match(worker,/Проверить составы/);
  assert.match(worker,/Проверить рынок/);
  assert.match(worker,/Ещё новости/);
  assert.match(worker,/options\.newsImpactDelta[\s\S]*newsImpactDecisionKeyboard/);
});

test('Telegram summary leads with decision and next action',()=>{
  assert.match(worker,/const newsDecision=newsImpactDecisionCard\(newsImpact\)/);
  assert.match(worker,/Что делать:/);
  assert.match(worker,/Существенное изменение/);
  assert.match(worker,/Сценарий стабилен/);
});

test('decision analytics stores only categorical outcome',()=>{
  assert.match(worker,/decision:String\(decision\?\.code \|\| ''\)\.slice\(0,24\)/);
  assert.match(worker,/const newsImpactDecisionSummary=/);
  assert.match(worker,/material:newsImpactRows\.filter/);
  assert.match(worker,/stable:newsImpactRows\.filter/);
  assert.match(app,/решения:/);
});

test('RC72 deterministic health contract is present',()=>{
  assert.match(worker,/function newsImpactDecisionDrill\(/);
  assert.match(worker,/newsImpactDecisionSelfTest: newsImpactDecisionDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['newsImpactDecisionCard','newsImpactActionRouting','newsImpactCausalityGuardUx','newsImpactDecisionAnalytics']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
});
