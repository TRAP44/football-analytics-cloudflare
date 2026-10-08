import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFootballNewsRuntime } from '../src/football-news-runtime.js';

const newsSource=fs.readFileSync('src/football-news-runtime.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const orchestration=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

function runtime(){
  return createFootballNewsRuntime({
    NEWS_BLOCKED_HOST_RE:/^not-trusted\.invalid$/i,
    NEWS_MAJOR_SOURCE_RE:/^bbc\.com$/i,
    NEWS_OFFICIAL_SOURCE_RE:/^fifa\.com$/i,
    TOP_TEAM_SEARCH_CATALOG:[],
    botTeamIdMatches:()=>false,
    fetchWithTimeout:async()=>({ok:false}),
    getCache:async()=>null,
    getFavorites:async()=>[],
    normalizeBotFixtureCard:fixture=>fixture,
    recordGrowthEvent:async()=>{},
    searchText:value=>String(value||'').toLowerCase(),
    setCache:async()=>{},
    telegramApi:async()=>({ok:true}),
    telegramHtmlEscape:value=>String(value),
    todayUtc:()=> '2026-10-08',
  });
}

test('RC70 news fixture linking remains owned by the extracted news runtime',()=>{
  assert.match(worker,/import \{ createFootballNewsRuntime \} from '\.\/football-news-runtime\.js'/);
  assert.match(newsSource,/function newsPublishedMs\(/);
  assert.match(newsSource,/function newsFixtureRelevance\(/);
  assert.match(newsSource,/function newsRelevantFixture\(/);
  assert.match(newsSource,/function newsConversionKeyboard\(/);
  assert.match(orchestration,/newsRelevantFixture|sendFavoriteTeamNews|sendGeneralFootballNews/);
});

test('RC70 links a published injury story to the closest relevant future fixture',()=>{
  const result=runtime().smartNewsMatchLinkDrill();
  assert.equal(result.pass,true);
  assert.equal(result.cases,7);
});

test('RC70 publication-day tokens are strict and resolve at UTC midday',()=>{
  const api=runtime();
  assert.equal(api.newsPublishedDayToken({publishedAt:'2026-09-20T12:00:00Z'}),'20260920');
  assert.equal(api.newsPublishedAtFromDayToken('20260920'),'2026-09-20T12:00:00Z');
  for(const bad of ['20261301','20260230','2026101',true,{}]){
    assert.equal(api.newsPublishedAtFromDayToken(bad),'');
  }
});

test('RC70 only presents a fixture CTA when a match is actually linked',()=>{
  const api=runtime();
  const none=api.newsRelevantFixture({publishedAt:'2026-09-20T12:00:00Z'},[]);
  assert.equal(none,null);
  assert.equal(api.newsFixtureChangeGuide({category:{code:'injury'}},null),'');
});

test('RC70 injury and referee stories explain distinct factors to recheck',()=>{
  const api=runtime();
  const link={fixture:{fixtureId:20},timing:'near_match',hoursFromNews:12};
  assert.match(api.newsFixtureChangeGuide({category:{code:'injury'}},link),/состав/);
  assert.match(api.newsFixtureChangeGuide({category:{code:'referee'}},link),/карточки/);
  assert.match(api.newsFixtureTimingLabel(link),/после новости/);
});

test('RC70 news conversion keeps safe dated and legacy callback branches',()=>{
  const sources=worker+'\n'+orchestration+newsSource;
  assert.match(sources,/datedNewsAiTeamAction=data\.match/);
  assert.match(sources,/legacyNewsAiTeamAction=data\.match/);
  assert.match(sources,/mode:'team_smart_link'/);
  assert.match(sources,/origin:'news_ai_smart_link'/);
  assert.match(app,/smart fixture/);
});
