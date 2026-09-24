import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

test('FM AI News lives in Telegram navigation',()=> {
  assert.match(worker,/\{ text: '📰 Новости' \}/);
  assert.match(worker,/text === '📰 Новости'/);
  assert.match(worker,/function sendGeneralFootballNews/);
  assert.doesNotMatch(html,/id="newsView"/);
});

test('news search uses Tavily news mode and source links',()=> {
  assert.match(worker,/async function tavilyNewsSearch/);
  assert.match(worker,/topic:'news'/);
  assert.match(worker,/include_answer:false/);
  assert.match(worker,/function externalNewsUrl/);
  assert.match(worker,/function newsConversionKeyboard/);
  assert.match(worker,/NEWS_BLOCKED_HOST_RE/);
});

test('news is classified into football-impact categories without auto-changing predictions',()=> {
  assert.match(worker,/function footballNewsCategory/);
  for (const code of ['injury','suspension','coach','lineup','transfer','referee','weather']) {
    assert.ok(worker.includes(`code:'${code}'`), `missing news category ${code}`);
  }
  assert.match(worker,/function footballNewsImpactText/);
  assert.match(worker,/FM AI не меняет прогноз только из-за заголовка/);
});

test('favorite-team news can lead to a relevant upcoming match',()=> {
  assert.match(worker,/function favoriteTeamFootballNews/);
  assert.match(worker,/function sendFavoriteTeamNews/);
  assert.match(worker,/news:team:/);
  assert.match(worker,/⚽ Проверить ближайший матч/);
  assert.match(worker,/match:menu:/);
});

test('opt-in morning digest includes a cached news block',()=> {
  assert.match(worker,/function currentMorningFootballNews/);
  assert.match(worker,/function morningNewsText/);
  assert.match(worker,/currentDailyDigest\(cfg\),currentMorningFootballNews\(cfg\)/);
  assert.match(worker,/📰 <b>Главное за утро<\/b>/);
});

test('RC50 health publishes news contracts',()=> {
  assert.match(worker,/fmAiNews:\s*'enabled'/);
  assert.match(worker,/newsSourceLinks:\s*'enabled'/);
  assert.match(worker,/newsImpactContext:\s*'enabled'/);
  assert.match(worker,/favoriteTeamNews:\s*'enabled'/);
  assert.match(worker,/morningNewsDigest:\s*'enabled'/);
  assert.match(worker,/newsMiniAppSeparation:\s*'enabled'/);
});
