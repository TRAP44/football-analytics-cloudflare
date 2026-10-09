import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { workerRuntime } from '../test-support/worker-root.js';

const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('RC69 keeps news in Telegram and adds per-item AI conversion actions',()=>{
  assert.doesNotMatch(html,/id="newsView"/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsConversionKeyboard\(/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/🧠 Проверить с AI/);
  assert.match(worker,/news:ai_match:/);
  assert.match(worker,/news:ai_team:/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/reply_markup:newsConversionKeyboard\(items,extra/);
});

test('news intent resolves known clubs without storing arbitrary headline text',()=>{
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsTeamHint\(/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsTeamToken\(/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsTeamByToken\(/);
  assert.match(readContractSource(new URL('../src/telegram-update-orchestration.js', import.meta.url), 'utf8'),/eventName:'news_ai_intent'/);
  const event=/backgroundGrowthEvent\(cfg,\{userId:callbackUserId,eventName:'news_ai_intent',[\s\S]{0,280}?metadata:\{([^}]*)\}/.exec(worker);
  assert.ok(event,'news AI intent event missing');
  assert.doesNotMatch(event[1],/title|content|query|url/);
});

test('news copy explains why the item matters and what AI will check',()=>{
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/🧠 Что проверить:/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsConversionHook\(/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/MatchRadar AI не меняет прогноз только из-за заголовка/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/needs_confirmation/);
});

test('direct club news can open the known fixture without repeated search',()=>{
  assert.match(worker,/news:ai_match:\(\\d\+\)/);
  assert.match(worker,/origin:'news_ai_cta'/);
  assert.match(worker,/sendBotFixtureMenu\(request,cfg,callbackUserId,callbackChatId,fixtureId\)/);
});

test('general news team CTA falls back to the existing match search flow',()=>{
  assert.match(worker,/news:ai_team:\(\[a-z0-9\]\{2,32\}\)/);
  assert.match(worker,/sendBotFootballSearch\(request,cfg,callbackUserId,callbackChatId,teamName\)/);
});

test('launch analytics exposes news AI intent and RC69 deterministic health',()=>{
  assert.match(readContractSource(new URL('../src/growth-analytics-runtime.js', import.meta.url), 'utf8'),/aiIntent:newsAiIntent\.size/);
  assert.match(readContractSource(new URL('../src/growth-analytics-runtime.js', import.meta.url), 'utf8'),/intentPct:/);
  assert.match(readContractSource(new URL('../public/modules/admin-launch-funnel.js', import.meta.url), 'utf8'),/Новости → AI/);
  assert.match(readContractSource(new URL('../src/football-news-runtime.js', import.meta.url), 'utf8'),/function newsConversionDrill\(/);
  const runtime=workerRuntime.getFootballNewsRuntime();
  assert.equal(runtime.newsConversionDrill().pass,true);
  for (const method of ['newsConversionKeyboard','newsTeamHint','newsTeamByToken','sendGeneralFootballNews']) {
    assert.equal(typeof runtime[method],'function',method);
  }
});

test('RC69 news CTA requires safe provider story URLs and bounds per-message link count',()=>{
  const source=fs.readFileSync('src/football-news-runtime.js','utf8');
  const start=source.indexOf('function newsConversionKeyboard');
  const end=source.indexOf('function newsConversionDrill',start);
  assert.ok(start>=0 && end>start);
  const block=source.slice(start,end);
  assert.match(block,/safeArray\(items\)\.slice\(0,4\)/);
  assert.match(block,/externalNewsUrl\(/);
  assert.match(block,/if \(!url\) continue/);
  assert.match(block,/callback_data:\`news:ai_match:/);
  assert.match(block,/callback_data:\`news:ai_team:/);
});
