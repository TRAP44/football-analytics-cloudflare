import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { workerRuntime } from '../test-support/worker-root.js';

const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const html=fs.readFileSync('public/index.html','utf8');

test('RC69 keeps news in Telegram and adds per-item AI conversion actions',()=>{
  assert.doesNotMatch(html,/id="newsView"/);
  const runtime=workerRuntime.getFootballNewsRuntime();
  const item={title:'Arsenal team news',url:'https://example.com/news'};
  const team=runtime.newsConversionKeyboard([item]);
  assert.deepEqual(team.inline_keyboard,[[
    {text:'↗ Источник 1',url:item.url},
    {text:'🧠 Arsenal',callback_data:'news:ai_team:arsenal'},
  ]]);
  const direct=runtime.newsConversionKeyboard([item],[],{fixtureId:998877});
  assert.equal(direct.inline_keyboard[0][1].text,'🧠 Проверить с AI');
  assert.equal(direct.inline_keyboard[0][1].callback_data,'news:ai_match:998877');
});

test('news intent resolves known clubs without storing arbitrary headline text',()=>{
  const runtime=workerRuntime.getFootballNewsRuntime();
  const hint=runtime.newsTeamHint({title:'Барселона объявила состав на матч',content:'Private arbitrary headline text'});
  assert.equal(hint.canonical,'Barcelona');
  assert.equal(hint.token,'barcelona');
  assert.equal(runtime.newsTeamToken(hint),'barcelona');
  assert.equal(runtime.newsTeamByToken(hint.token).canonical,'Barcelona');
  assert.equal(runtime.newsTeamByToken('unknownclub'),null);
  assert.equal(runtime.newsTeamHint({title:'Unrelated story'}),null);
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
  const runtime=workerRuntime.getFootballNewsRuntime();
  const items=Array.from({length:8},(_,i)=>({title:'Arsenal update',url:`https://example.com/${i}`}));
  const extra=[[{text:'Back',callback_data:'menu:main'}]];
  const keyboard=runtime.newsConversionKeyboard(items,extra);
  assert.equal(keyboard.inline_keyboard.length,5);
  assert.deepEqual(keyboard.inline_keyboard.at(-1),extra[0]);
  assert.deepEqual(keyboard.inline_keyboard.slice(0,4).map(row=>row[0].url),items.slice(0,4).map(item=>item.url));
  for (const row of keyboard.inline_keyboard.slice(0,4)) {
    assert.equal(row[1].callback_data,'news:ai_team:arsenal');
    assert.ok(Buffer.byteLength(row[1].callback_data,'utf8')<=64);
  }
  for (const url of ['javascript:alert(1)','data:text/html,x','https://user:password@example.com/a']) {
    assert.deepEqual(runtime.newsConversionKeyboard([{title:'Arsenal',url}]).inline_keyboard,[],url);
  }
});


test('news callbacks retain publication day without arbitrary headline content',()=>{
  const runtime=workerRuntime.getFootballNewsRuntime();
  const item={title:'Arsenal private headline',content:'Private provider content',url:'https://example.com/story',publishedAt:'2026-09-20T12:00:00Z'};
  const team=runtime.newsConversionKeyboard([item]).inline_keyboard[0][1].callback_data;
  const direct=runtime.newsConversionKeyboard([item],[],{fixtureId:42}).inline_keyboard[0][1].callback_data;
  assert.equal(team,'news:ai_team:arsenal:20260920');
  assert.equal(direct,'news:ai_match:42:20260920');
  for (const callback of [team,direct]) {
    assert.doesNotMatch(callback,/private|headline|provider|example/i);
    assert.ok(Buffer.byteLength(callback,'utf8')<=64);
  }
});

test('news keyboard rejects malformed items and never invokes object coercion',()=>{
  const runtime=workerRuntime.getFootballNewsRuntime();
  const hostile={toString(){throw new Error('unexpected coercion');}};
  for (const items of [null,undefined,hostile,[null,42,hostile,{title:'Arsenal',url:hostile}]]) {
    assert.deepEqual(runtime.newsConversionKeyboard(items).inline_keyboard,[]);
  }
});
