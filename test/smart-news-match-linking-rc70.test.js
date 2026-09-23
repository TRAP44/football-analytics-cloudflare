import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC70 scores fixtures against the news publication time',()=>{
  assert.match(worker,/function newsPublishedMs\(/);
  assert.match(worker,/function newsFixtureRelevance\(/);
  assert.match(worker,/function newsRelevantFixture\(/);
  assert.match(worker,/hoursFromNews/);
  assert.match(worker,/timing='pre_match'/);
  assert.match(worker,/timing='near_match'/);
});

test('each favorite-team news item can receive its own fixture CTA',()=>{
  assert.match(worker,/const smartLink=\(fixtures \|\| \[\]\)\.length \? newsRelevantFixture\(item,fixtures\) : null/);
  assert.match(worker,/linkedFixtureId=Number\(smartLink\?\.fixture\?\.fixtureId \|\| fixtureId \|\| 0\)/);
  assert.match(worker,/newsFeedText\(news\.items,\{title:'FM AI News',teamName:team\.team_name \|\| '',fixture,fixtures:matches \|\| \[\]\}\)/);
  assert.match(worker,/newsConversionKeyboard\(news\.items,extra,\{fixtureId:Number\(fixture\?\.fixtureId \|\| 0\),fixtures:matches \|\| \[\]\}\)/);
});

test('general-news CTA carries only a safe publication-day token',()=>{
  assert.match(worker,/function newsPublishedDayToken\(/);
  assert.match(worker,/function newsPublishedAtFromDayToken\(/);
  assert.match(worker,/news:ai_team:\$\{hint\.token\}\$\{dayToken \?/);
  assert.match(worker,/datedNewsAiTeamAction=data\.match/);
  assert.match(worker,/legacyNewsAiTeamAction=data\.match/);
});

test('dated team intent can resolve a smart fixture and falls back to search',()=>{
  assert.match(worker,/mode:'team_smart_link'/);
  assert.match(worker,/origin:'news_ai_smart_link'/);
  assert.match(worker,/sendBotFixtureMenu\(request,cfg,callbackUserId,callbackChatId,fixtureId\)/);
  assert.match(worker,/sendBotFootballSearch\(request,cfg,callbackUserId,callbackChatId,team\.canonical\)/);
});

test('news text explains the linked match and which AI inputs should be rechecked',()=>{
  assert.match(worker,/function newsFixtureTimingLabel\(/);
  assert.match(worker,/function newsFixtureChangeGuide\(/);
  assert.match(worker,/🎯 Матч:/);
  assert.match(worker,/Перепроверить:/);
  assert.match(worker,/состав · глубина скамейки · баланс сил · рынок/);
});

test('RC70 health and launch analytics expose smart fixture usage',()=>{
  assert.match(worker,/smartFixtureIntent:smartNewsAiUsers\.size/);
  assert.match(app,/smart fixture/);
  assert.match(worker,/function smartNewsMatchLinkDrill\(/);
  assert.match(worker,/smartNewsLinkSelfTest: smartNewsMatchLinkDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['smartNewsFixtureLinking','newsTimeRelevanceGuard','perNewsFixtureCta','newsImpactDeltaGuide']) {
    assert.ok(worker.includes(flag + ": 'enabled'"));
  }
});
