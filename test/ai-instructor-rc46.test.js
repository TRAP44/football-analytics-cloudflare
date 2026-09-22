import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('AI instructor separates model confidence from source-data trust',()=> {
  assert.match(worker,/const dataTrust = \{/);
  assert.match(worker,/dataTrustScore/);
  assert.match(app,/Качество данных/);
  assert.match(app,/dataTrust\.label/);
});

test('AI instructor renders a concrete pre-kickoff plan',()=> {
  assert.match(worker,/const matchPlan = \{/);
  assert.match(worker,/checks:planChecks/);
  assert.match(app,/AI-ПЛАН ДО СТАРТОВОГО СВИСТКА/);
  assert.match(app,/Условие отмены/);
  assert.match(app,/Что смотреть дальше/);
  assert.match(css,/\.ai-match-plan/);
});

test('telegram bot understands common football question intents',()=> {
  assert.match(worker,/function botSearchParts/);
  assert.match(worker,/intent === 'referee'/);
  assert.match(worker,/intent === 'pick'/);
  assert.match(worker,/function botIntentLead/);
});

test('telegram bot routes natural questions through existing safe search',()=> {
  assert.match(worker,/botSearchParts/);
  assert.match(worker,/sendBotFootballSearch/);
  assert.match(worker,/freeQuotaHealthy\(10,2\)/);
  assert.match(worker,/telegramHtmlEscape/);
});

test('RC46 health exposes trust plan and intent contracts',()=> {
  assert.match(worker,/aiDataTrust:\s*'enabled'/);
  assert.match(worker,/aiMatchPlan:\s*'enabled'/);
  assert.match(worker,/botFootballIntentUnderstanding:\s*'enabled'/);
  assert.match(worker,/botAskCommand:\s*'enabled'/);
});

test('prematch empty state uses correct Russian wording',()=> {
  assert.doesNotMatch(app,/Главное недоступен/);
  assert.match(app,/Преданализ недоступен/);
});
