import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'));
const html=fs.readFileSync('public/index.html','utf8');

test('MatchRadar AI News lives in Telegram navigation',()=> {
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
  assert.match(worker,/MatchRadar AI не меняет прогноз только из-за заголовка/);
});

test('favorite-team news can lead to a relevant upcoming match',()=> {
  assert.match(worker,/function favoriteTeamFootballNews/);
  assert.match(worker,/function sendFavoriteTeamNews/);
  assert.match(worker,/news:team:/);
  assert.match(worker,/⚽ Проверить ближайший матч/);
  assert.match(worker,/match:menu:/);
});

test('opt-in morning digest includes cached news without making news a delivery prerequisite',()=> {
  assert.match(worker,/function currentMorningFootballNews/);
  assert.match(worker,/function morningNewsText/);
  const start=worker.indexOf('async function processDailyDigests');
  const end=worker.indexOf('function telegramHtmlEscape',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/digest=await currentDailyDigest\(cfg\)/);
  assert.match(block,/currentMorningFootballNews\(cfg\)\.catch/);
  assert.match(block,/items:\[\]/);
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
