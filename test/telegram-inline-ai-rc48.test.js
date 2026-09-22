import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

test('telegram match buttons answer inline instead of forcing the mini app',()=> {
  assert.match(worker,/callback_data: `match:verdict:/);
  assert.match(worker,/callback_data: `match:referee:/);
  assert.match(worker,/callback_data: `match:squads:/);
  assert.match(worker,/callback_data: `match:market:/);
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
  assert.match(worker,/await apiAnalyze\(inner, cfg, \{ id:Number\(userId\) \}\)/);
  assert.match(worker,/fixture:\$\{id\}:v10-ai-instructor/);
});

test('match cards are cached and selectable from multi-result search and daily picks',()=> {
  assert.match(worker,/function rememberBotFixtureCards/);
  assert.match(worker,/bot:fixture-card:/);
  assert.match(worker,/match:menu:/);
  assert.match(worker,/sendBotFixtureMenu/);
});

test('find-match button prompts for natural text in chat',()=> {
  assert.match(worker,/text === '🔎 Найти матч'/);
  assert.match(worker,/Напишите название команды или конкретный матч/);
});

test('RC48 health exposes inline bot contracts',()=> {
  assert.match(worker,/botInlineAiVerdict:\s*'enabled'/);
  assert.match(worker,/botInlineMatchSections:\s*'enabled'/);
  assert.match(worker,/botCachedAnalysisReuse:\s*'enabled'/);
  assert.match(worker,/botMatchCardCallbacks:\s*'enabled'/);
});
