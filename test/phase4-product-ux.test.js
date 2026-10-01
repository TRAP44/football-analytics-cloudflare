import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const myTeamsRenderer=fs.readFileSync('public/modules/my-teams-renderer.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

test('Phase 4 public navigation is Home My Teams History Profile with search on Home',()=>{
  assert.match(html,/id="navMatches"[\s\S]*Главная/);
  assert.match(html,/id="navMyTeams"[\s\S]*Мои команды/);
  assert.match(html,/id="navHistory"[\s\S]*История/);
  assert.match(html,/id="navProfile"[\s\S]*Профиль/);
  assert.doesNotMatch(html,/id="navSearch"/);
  assert.match(html,/id="homeSearchBtn"/);
});
test('Home keeps frequent match filters visible and secondary filters behind one disclosure',()=>{
  const start=html.indexOf('<div class="home-filter-controls">');
  const end=html.indexOf('<div class="section-head">',start);
  assert.ok(start>=0 && end>start);
  const controls=html.slice(start,end);
  const drawer=controls.slice(controls.indexOf('<details'),controls.indexOf('</details>')+10);
  const quick=controls.slice(0,controls.indexOf('<details'));
  for(const filter of ['top','live','all']) assert.match(quick,new RegExp(`data-filter="${filter}"`));
  for(const filter of ['favorites','international','cups','england','spain','italy','germany','france']) {
    assert.match(drawer,new RegExp(`data-filter="${filter}"`));
    assert.doesNotMatch(quick,new RegExp(`data-filter="${filter}"`));
  }
  assert.match(drawer,/data-filter-summary-value hidden/);
  assert.match(app,/summaryValue\.hidden = !activeDrawerFilter/);
  assert.match(app,/const drawerFilters = \['favorites', 'international', 'cups', 'england', 'spain', 'italy', 'germany', 'france'\]/);
  assert.match(app,/querySelector\('\[data-filter-summary-value\]'\)/);
  assert.match(css,/MatchRadar Home Filter Simplification — fast choices first/);
});

test('new users use Search or My Teams without a duplicate favorite-team promo on Home',()=>{
  assert.doesNotMatch(html,/id="homeFavoriteBtn"/);
  assert.doesNotMatch(html,/Сделайте ленту своей/);
  assert.match(html,/id="homeSearchBtn"/);
  assert.match(html,/id="navMyTeams"/);
  assert.match(myTeamsRenderer,/function renderMyTeams\(\)/);
});
test('My Teams reuses favorites and existing match catalog',()=>{
  const start=myTeamsRenderer.indexOf('function renderMyTeams');
  const end=myTeamsRenderer.indexOf('return Object.freeze',start);
  const body=myTeamsRenderer.slice(start,end);
  assert.match(body,/state\.favorites/);
  assert.match(body,/state\.matches\.filter/);
  assert.match(body,/onAnalyzeMatch/);
  assert.doesNotMatch(body,/api\(/);
  assert.match(app,/onAnalyzeMatch: \(fixtureId, button\) => analyzeMatch\(fixtureId, button\)/);
});
test('Match Center first level keeps AI confidence data quality three factors and risks',()=>{
  const start=app.indexOf('function analysisGlanceHtml');
  const end=app.indexOf('function renderAnalysis',start);
  const body=app.slice(start,end);
  assert.match(body,/slice\(0, 3\)/);
  assert.match(body,/Уверенность AI/);
  assert.match(body,/Данные:/);
  assert.match(body,/Главные факторы/);
  assert.match(body,/Основные риски/);
});
test('mobile contracts explicitly cover 360 375 390 and 430 widths without horizontal overflow',()=>{
  assert.match(css,/overflow-x:hidden/);
  for(const width of [360,375,390,430]) assert.match(css,new RegExp('max-width:'+width+'px'));
});
test('admin navigation remains outside the public bottom navigation',()=>{
  const nav=html.slice(html.indexOf('<nav class="bottom-nav"'),html.indexOf('</nav>',html.indexOf('<nav class="bottom-nav"')));
  assert.doesNotMatch(nav,/admin|provider|runtime|diagnostic|release/i);
  assert.doesNotMatch(html,/data-admin-only/);
});
