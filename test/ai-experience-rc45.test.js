import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('home exposes a three-match attention ranking without pretending it is a prediction',()=>{
  assert.match(app,/AI-РЕЙТИНГ ДНЯ/);
  assert.match(app,/slice\(0,3\)/);
  assert.match(app,/Это ещё не прогноз исхода/);
  assert.match(css,/\.ai-rank-row/);
});

test('analyzed match hub exposes a dedicated skip or caution lane',()=>{
  assert.match(app,/Лучше пропустить/);
  assert.match(app,/ai-center-feature caution/);
  assert.match(app,/aiSignalCode === 'skip'/);
});

test('telegram bot accepts natural football search through the shared safe route',()=>{
  assert.match(worker,/function sendBotFootballSearch/);
  assert.match(worker,/function botCachedDayMatches/);
  assert.match(worker,/function botRemoteTeamMatches/);
  assert.match(worker,/function botSearchParts/);
  assert.match(worker,/await sendBotFootballSearch\(request, cfg, chatId, text\)/);
});

test('telegram bot escapes HTML and guards provider quota',()=>{
  assert.match(worker,/function telegramHtmlEscape/);
  assert.match(worker,/freeQuotaHealthy\(10,2\)/);
  assert.match(worker,/freeQuotaHealthy\(8,1\)/);
});

test('mini app supports search and exact fixture deep links',()=>{
  assert.match(app,/function openLaunchFixture/);
  assert.match(app,/params\.get\('fixtureId'\)/);
  assert.match(app,/params\.get\('q'\)/);
  assert.match(app,/analysisHistoryForFixture\(id\)/);
});

test('RC45 health exposes ranking and bot contracts',()=>{
  assert.match(worker,/aiMatchRanking:\s*'enabled'/);
  assert.match(worker,/analyzedSkipLane:\s*'enabled'/);
  assert.match(worker,/botNaturalFootballSearch:\s*'enabled'/);
  assert.match(worker,/botFixtureDeepLinks:\s*'enabled'/);
});
