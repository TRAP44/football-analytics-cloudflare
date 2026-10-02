import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
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
  for(const token of ['my-team-card','my-team-head','my-team-match','data-open-team','data-team-fixture','onAnalyzeMatch']) {
    assert.ok(teams.includes(token),token);
  }
  assert.match(app,/onAnalyzeMatch: \(fixtureId, button\) => analyzeMatch\(fixtureId, button\)/);
  assert.match(css,/MatchRadar Public UI Polish — Personal Surfaces/);
  assert.match(css,/\.miniapp-public-shell \.my-team-card\{/);
  assert.match(css,/\.miniapp-public-shell \.my-team-match\{/);
});

test('history polish keeps verified track record and reopen flow intact',()=>{
  const track=block(aiTrackRecordRenderer,'function renderAiTrackRecord','return Object.freeze');
  const history=block(historyRenderer,'function renderHistory','return Object.freeze');
  for(const token of ['ai-track-card','ai-track-kpis','ai-track-row']) assert.ok(track.includes(token),token);
  for(const token of ['history-item','history-ai-chip','history-open','openHistoryAnalysis']) assert.ok((history+' '+app).includes(token),token);
  assert.match(css,/\.miniapp-public-shell \.ai-track-card\{/);
  assert.match(css,/\.miniapp-public-shell \.history-item\{/);
});

test('profile polish keeps team management focused in My Teams and removes the duplicate reminder list while preserving preferences and service links',()=>{
  const profile=block(html,'<section id="profileView"','<nav class="bottom-nav"');
  for(const token of [
    'profileFavoriteTeamsBtn','profileRemindersBtn','preferences-panel','savePreferencesBtn',
    'Конфиденциальность','Условия использования',
  ]) assert.ok(profile.includes(token),token);
  assert.ok(!profile.includes('id="favoriteTeams"'),'favoriteTeams duplicate should not remain in Profile');
  assert.ok(!profile.includes('id="reminderList"'),'duplicate reminder list should not remain in Profile');
  assert.ok(!profile.includes('Активные напоминания'),'duplicate reminder panel copy should not remain in Profile');
  assert.ok(!profile.includes('profile-data-details'),'technical data drawer should not remain in Profile');
  assert.ok(!profile.includes('Статус сервиса'),'technical status link should not remain in Profile');
  for(const technicalCopy of [
    'Проверяем сервер…',
    'серверным лимитом',
    'Клиент не может самостоятельно выдать',
  ]) assert.ok(!profile.includes(technicalCopy), technicalCopy);
  const favoriteFn=block(favoriteTeamsRenderer,'function renderFavoriteTeams','return Object.freeze');
  for(const token of ['favorite-team-row','favorite-team-main','favorite-remove']) assert.ok(favoriteFn.includes(token),token);
  assert.match(css,/\.miniapp-public-shell \.favorite-team-row/);
  assert.match(css,/\.miniapp-public-shell \.reminder-row/);
  assert.match(css,/\.miniapp-public-shell \.preferences-panel\{/);
});

test('personal surfaces keep mobile and touch targets explicit',()=>{
  for(const width of [360,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
  assert.match(css,/\.miniapp-public-shell \.history-open\{[\s\S]*?min-height:40px/);
  assert.match(css,/\.miniapp-public-shell \.primary-setting-btn\{[\s\S]*?min-height:44px/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('frontend revision refreshes personal-surface styles without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.match(html,/styles\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/styles\/public-shell\.css\?v=6\.120\.0-launch\d+/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch\d+/);
  assert.match(runtime,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.doesNotMatch(html,/6\.120\.0-ui2/);
});
