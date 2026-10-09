import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=(fs.readFileSync('src/worker.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8')
  +'\n'+fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8'));

test('telegram match buttons answer inline instead of forcing the mini app',()=> {
  assert.match(worker,/callback_data:\`match:verdict:/);
  assert.match(worker,/callback_data:\`match:referee:/);
  assert.match(worker,/callback_data:\`match:squads:/);
  assert.match(worker,/callback_data:\`match:market:/);
  assert.match(worker,/function sendBotFixtureSection/);
});

test('telegram AI verdict includes skip confidence risk and data quality',()=> {
  assert.match(worker,/function botAiVerdictText/);
  assert.match(worker,/Лучше пропустить/);
  assert.match(worker,/Качество данных/);
  assert.match(worker,/Уверенность/);
  assert.match(worker,/Риск/);
  assert.match(worker,/Судья/);
});

test('telegram sections reuse the protected analysis pipeline',()=> {
  assert.match(worker,/function botAnalyzeFixture/);
  assert.match(worker,/await apiAnalyze\(inner,cfg,\{id:user\}\)/);
  assert.match(worker,/fixture:\$\{id\}:v17-starting-xi-rc146/);
});

test('match cards are cached and selectable from multi-result search and daily picks',()=> {
  assert.match(worker,/function rememberBotFixtureCards/);
  assert.match(worker,/bot:fixture-card:/);
  assert.match(worker,/match:menu:/);
  assert.match(worker,/sendBotFixtureMenu/);
});

test('find-match button prompts for natural text in chat',()=> {
  assert.match(worker,/text === '🔎 Найти матч'/);
  assert.match(worker,/Напишите клуб или конкретный матч/);
});

test('RC48 release contract preserves inline AI boundaries',()=> {
  assert.match(worker,/TELEGRAM_ANALYSIS_FIXTURE_MISMATCH/);
  assert.match(worker,/bot:fixture-card:\$\{id\}:v2/);
  assert.match(worker,/match:menu:\$\{fixtureId\}/);
  assert.match(worker,/return Object\.freeze\(\{/);
});

test('RC48 inline AI actions preserve callback-only server processing instead of a web-app dependency',()=>{
  for(const section of ['verdict','referee','squads','market']){
    assert.match(worker,new RegExp('callback_data:\\x60match:'+section+':'));
  }
  assert.match(worker,/sendBotFixtureSection/);
  assert.match(worker,/match:menu:\$\{fixtureId\}/);
  assert.match(worker,/function botAiVerdictText/);
});
