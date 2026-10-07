import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const adminHtml=fs.readFileSync('public/admin.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');
const myTeamsRenderer=fs.readFileSync('public/modules/my-teams-renderer.js','utf8');
const favoriteTeamsRenderer=fs.readFileSync('public/modules/favorite-teams-renderer.js','utf8');
const historyRenderer=fs.readFileSync('public/modules/history-renderer.js','utf8');
const aiTrackRecordRenderer=fs.readFileSync('public/modules/ai-track-record-renderer.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('personal surfaces polish keeps My Teams interaction contract intact',()=>{
  const teams=block(myTeamsRenderer,'function renderMyTeams','return Object.freeze');
  for(const token of [
    'my-team-card',
    'my-team-head',
    'my-team-match',
    'data-open-team',
    'data-team-fixture',
    'onOpenMatch',
  ]) assert.ok(teams.includes(token),token);

  assert.doesNotMatch(teams,/onAnalyzeMatch/);
  assert.match(
    app,
    /onOpenMatch: \(fixtureId, button\) => openMatchCenter\(fixtureId, button\)/,
  );
  assert.match(css,/MatchRadar Public UI Polish — Personal Surfaces/);
  assert.match(css,/\.miniapp-public-shell \.my-team-card\{/);
  assert.match(css,/\.miniapp-public-shell \.my-team-match\{/);
});

test('My Teams visual focus only labels strict future kickoff evidence as upcoming',()=>{
  assert.match(
    myTeamsRenderer,
    /const parts=\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)T/,
  );
  assert.match(myTeamsRenderer,/day > new Date\(Date\.UTC\(year,month,0\)\)\.getUTCDate\(\)/);
  assert.match(myTeamsRenderer,/item\.kickoffMs >= nowMs/);
  assert.match(myTeamsRenderer,/now = \(\) => Date\.now\(\)/);
  assert.doesNotMatch(
    myTeamsRenderer,
    /filter\(match => match\.finished !== true && match\.live !== true && validDateMs\(match\.date\) !== null\)/,
  );
});

test('history polish keeps verified track record and reopen flow intact',()=>{
  const track=block(aiTrackRecordRenderer,'function renderAiTrackRecord','return Object.freeze');
  const history=block(historyRenderer,'function renderHistory','return Object.freeze');
  for(const token of ['ai-track-card','ai-track-kpis','ai-track-row']) assert.ok(track.includes(token),token);
  for(const token of ['history-item','history-ai-chip','history-open']) assert.ok(history.includes(token),token);
  assert.match(app,/openHistoryAnalysis\(fixtureId, button\)/);
  assert.match(css,/\.miniapp-public-shell \.ai-track-card\{/);
  assert.match(css,/\.miniapp-public-shell \.history-item\{/);
});

test('profile polish preserves restored reminders, user settings and service links without duplicate favorite-team management',()=>{
  const profile=block(html,'<section id="profileView"','<nav class="bottom-nav"');
  for(const token of [
    'profileFavoriteTeamsBtn',
    'profileRemindersBtn',
    'remindersPanel',
    'reminderList',
    'preferences-panel',
    'savePreferencesBtn',
    'Конфиденциальность',
    'Условия использования',
    'Статус сервиса',
  ]) assert.ok(profile.includes(token),token);

  assert.ok(!profile.includes('id="favoriteTeams"'),'favoriteTeams duplicate should not remain in Profile');
  assert.ok(!profile.includes('profile-data-details'),'technical data drawer should not remain in Profile');

  const favoriteFn=block(favoriteTeamsRenderer,'function renderFavoriteTeams','return Object.freeze');
  for(const token of ['favorite-team-row','favorite-team-main','favorite-remove']) assert.ok(favoriteFn.includes(token),token);
  assert.match(css,/\.miniapp-public-shell \.favorite-team-row/);
  assert.match(css,/\.miniapp-public-shell \.reminder-row/);
  assert.match(css,/\.miniapp-public-shell \.preferences-panel\{/);
});

test('personal surfaces keep 44px touch targets across desktop and narrow Telegram WebViews',()=>{
  for(const width of [360,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));

  assert.match(
    css,
    /\.miniapp-public-shell \.history-open\{[\s\S]*?min-height:44px/,
  );
  assert.match(
    css,
    /\.miniapp-public-shell \.favorite-team-main\{[\s\S]*?min-height:44px/,
  );
  assert.match(
    css,
    /\.miniapp-public-shell \.favorite-remove,\s*\.miniapp-public-shell \.reminder-remove\{[\s\S]*?min-height:44px/,
  );
  assert.doesNotMatch(
    css,
    /\.miniapp-public-shell \.history-open\{grid-column:2;width:100%;min-height:(?:3\d|4[0-3])px\}/,
  );
  assert.doesNotMatch(
    css,
    /\.miniapp-public-shell \.favorite-remove,\s*\.miniapp-public-shell \.reminder-remove\{width:100%;min-height:(?:3\d|4[0-3])px\}/,
  );
  assert.match(css,/\.miniapp-public-shell \.primary-setting-btn\{[\s\S]*?min-height:44px/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend revision refreshes personal-surface assets without changing release identity',()=>{
  for(const surface of [html,adminHtml]){
    assert.match(surface,/frontend-asset-revision" content="6\.120\.0-launch59"/);
    assert.match(surface,/styles\.css\?v=6\.120\.0-launch59/);
    assert.match(surface,/styles\/public-shell\.css\?v=6\.120\.0-launch59/);
    assert.match(surface,/app\.js\?v=6\.120\.0-launch59/);
  }
  assert.match(runtime,/FRONTEND_ASSET_REVISION = '6\.120\.0-launch59'/);
  assert.match(runtime,/CLIENT_VERSION = '6\.120\.0-rc144'/);
});
