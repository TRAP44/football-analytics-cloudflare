import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('match center builds a dedicated AI LIVE coach',()=>{
  assert.match(worker,/function buildLiveAiCoach/);
  assert.match(worker,/liveAiCoach = live \?/);
  assert.match(worker,/v14-statistics-quality-rc142/);
  assert.match(app,/function liveAiCoachHtml/);
  assert.match(app,/d\.liveAiCoach/);
  assert.match(css,/\.live-ai-coach/);
});

test('AI LIVE compares the current match with the cached pre-match AI snapshot',()=>{
  assert.match(worker,/fixture:\$\{fixtureId\}:v13-freshness-trust/);
  assert.match(worker,/prematchAnalysis/);
  assert.match(worker,/Сценарий сломан/);
  assert.match(worker,/Сценарий подтверждается/);
});

test('AI LIVE has explicit low-data and broken-scenario guards',()=>{
  assert.match(worker,/Ждать больше данных/);
  assert.match(worker,/Не опираться на предматчевый сигнал/);
  assert.match(worker,/dataScore<35/);
});

test('AI LIVE surfaces volatility and next things to watch',()=>{
  assert.match(worker,/volatilityLabel/);
  assert.match(worker,/watchNext/);
  assert.match(worker,/Удаление меняет базовый сценарий/);
  assert.match(app,/Что смотреть дальше/);
});

test('RC44 exposes the AI LIVE health contract',()=>{
  assert.match(worker,/aiLiveCoach:\s*'enabled'/);
  assert.match(worker,/prematchLiveComparison:\s*'enabled'/);
  assert.match(worker,/liveScenarioGuard:\s*'enabled'/);
});
