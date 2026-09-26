import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
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
test('new users get favorite-team onboarding without profile setup',()=>{
  assert.match(html,/Добавьте любимые команды — покажем их матчи первыми/);
  assert.match(html,/Профиль настраивать не нужно/);
  assert.match(app,/function renderMyTeams\(\)/);
});
test('My Teams reuses favorites and existing match catalog',()=>{
  const start=app.indexOf('function renderMyTeams');
  const end=app.indexOf('function storageGet',start);
  const body=app.slice(start,end);
  assert.match(body,/state\.favorites/);
  assert.match(body,/state\.matches\.filter/);
  assert.match(body,/analyzeMatch/);
  assert.doesNotMatch(body,/api\(/);
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
  assert.match(html,/data-admin-only hidden/);
});
