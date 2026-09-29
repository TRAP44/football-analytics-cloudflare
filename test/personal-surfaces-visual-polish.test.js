import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

test('personal surfaces polish keeps My Teams interaction contract intact',()=>{
  const teams=block(app,'function renderMyTeams','function storageGet');
  for(const token of ['my-team-card','my-team-head','my-team-match','data-open-team','data-team-fixture','analyzeMatch']) {
    assert.ok(teams.includes(token),token);
  }
  assert.match(css,/MatchRadar Public UI Polish — Personal Surfaces/);
  assert.match(css,/\.miniapp-public-shell \.my-team-card\{/);
  assert.match(css,/\.miniapp-public-shell \.my-team-match\{/);
});

test('history polish keeps verified track record and reopen flow intact',()=>{
  const track=block(app,'function renderAiTrackRecord','async function loadHistory');
  const history=block(app,'function renderHistory','function pct');
  for(const token of ['ai-track-card','ai-track-kpis','ai-track-row']) assert.ok(track.includes(token),token);
  for(const token of ['history-item','history-ai-chip','history-open','openHistoryAnalysis']) assert.ok(history.includes(token),token);
  assert.match(css,/\.miniapp-public-shell \.ai-track-card\{/);
  assert.match(css,/\.miniapp-public-shell \.history-item\{/);
});

test('profile polish preserves favorites reminders preferences and service links',()=>{
  const profile=block(html,'<section id="profileView"','<section class="panel admin-console"');
  for(const token of [
    'favoriteTeams','reminderList','preferences-panel','savePreferencesBtn',
    'profile-data-details','Конфиденциальность','Условия использования','Статус сервиса',
  ]) assert.ok(profile.includes(token),token);
  const favoriteFn=block(app,'function renderFavoriteTeams','function renderMyTeams');
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
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch8"/);
  assert.match(html,/styles\.css\?v=6\.120\.0-launch8/);
  assert.match(html,/styles\/public-shell\.css\?v=6\.120\.0-launch8/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch8/);
  assert.match(app,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.doesNotMatch(html,/6\.120\.0-ui2/);
});
