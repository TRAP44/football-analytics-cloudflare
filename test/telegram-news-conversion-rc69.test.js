import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const playbook=fs.readFileSync('TELEGRAM_NEWS_CONVERSION_RC69.md','utf8');

test('RC69 keeps news in Telegram and adds per-item AI conversion actions',()=>{
  assert.doesNotMatch(html,/id="newsView"/);
  assert.match(worker,/function newsConversionKeyboard\(/);
  assert.match(worker,/🧠 Проверить с AI/);
  assert.match(worker,/news:ai_match:/);
  assert.match(worker,/news:ai_team:/);
  assert.match(worker,/reply_markup:newsConversionKeyboard\(news\.items,extra/);
});

test('news intent resolves known clubs without storing arbitrary headline text',()=>{
  assert.match(worker,/function newsTeamHint\(/);
  assert.match(worker,/function newsTeamToken\(/);
  assert.match(worker,/function newsTeamByToken\(/);
  assert.match(worker,/eventName:'news_ai_intent'/);
  const event=/recordGrowthEvent\(cfg,\{userId:callbackUserId,eventName:'news_ai_intent',[\s\S]{0,280}?metadata:\{([^}]*)\}/.exec(worker);
  assert.ok(event,'news AI intent event missing');
  assert.doesNotMatch(event[1],/title|content|query|url/);
});

test('news copy explains why the item matters and what AI will check',()=>{
  assert.match(worker,/🧠 Что проверить:/);
  assert.match(worker,/function newsConversionHook\(/);
  assert.match(worker,/FM AI не меняет прогноз только из-за заголовка/);
  assert.match(worker,/needs_confirmation/);
});

test('direct club news can open the known fixture without repeated search',()=>{
  assert.match(worker,/news:ai_match:\(\\d\+\)/);
  assert.match(worker,/origin:'news_ai_cta'/);
  assert.match(worker,/sendBotFixtureMenu\(request,cfg,callbackUserId,callbackChatId,fixtureId\)/);
});

test('general news team CTA falls back to the existing match search flow',()=>{
  assert.match(worker,/news:ai_team:\(\[a-z0-9\]\{2,32\}\)/);
  assert.match(worker,/sendBotFootballSearch\(request,cfg,callbackUserId,callbackChatId,team\.canonical\)/);
});

test('launch analytics exposes news AI intent and RC69 deterministic health',()=>{
  assert.match(worker,/aiIntent:newsAiIntent\.size/);
  assert.match(worker,/intentPct:/);
  assert.match(app,/Новости → AI/);
  assert.match(worker,/function newsConversionDrill\(/);
  assert.match(worker,/newsConversionSelfTest: newsConversionDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['telegramNewsConversionEngine','newsPerItemAiCta','newsTeamIntentResolution','newsConversionTracking']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
  assert.match(playbook,/Telegram News Conversion Engine/);
});
