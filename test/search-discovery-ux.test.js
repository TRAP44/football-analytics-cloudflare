import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

test('Search ranking prefers exact and prefix matches before loose contains',()=>{
  const rankStart=app.indexOf('function discoveryText');
  const rankEnd=app.indexOf('function localDiscoveryResults',rankStart);
  assert.ok(rankStart>=0 && rankEnd>rankStart,'discoveryMatchRank source missing');
  const source=app.slice(rankStart,rankEnd);
  const rank=Function(source+'; return discoveryMatchRank;')();
  assert.equal(rank('Arsenal','arsenal'),0);
  assert.equal(rank('Arsenal Women','ars'),1);
  assert.equal(rank('Real Madrid','mad'),2);
  assert.equal(rank('Manchester City','city'),2);
  assert.equal(rank('Paris Saint-Germain','germain'),3);
  assert.equal(rank('Inter','xyz'),99);
});

test('Search competition result is directly actionable',()=>{
  const start=app.indexOf('function searchCompetitionSummaryCard');
  const end=app.indexOf('function bindDiscoveryActions',start);
  const source=app.slice(start,end);
  assert.match(source,/<button class="search-entity-summary search-competition-summary"/);
  assert.match(source,/data-search-competition/);
  assert.match(source,/data-comp-name/);
  assert.match(source,/Открыть →/);
  const bind=app.slice(end,app.indexOf('function discoveryText',end));
  assert.match(bind,/\[data-search-competition\]/);
  assert.match(bind,/openTournamentMeta/);
});

test('Search discovery hides empty recent and favorite shelves',()=>{
  const start=app.indexOf('function renderDiscoveryHome');
  const end=app.indexOf('function russianCountLabel',start);
  const source=app.slice(start,end);
  assert.match(source,/searchRecentWrap/);
  assert.match(source,/hidden = !rows\.length/);
  assert.match(source,/searchFavoritesWrap/);
  assert.doesNotMatch(source,/Открытые команды появятся здесь/);
  assert.doesNotMatch(source,/Добавьте команду в избранное — она появится здесь/);
});

test('Search uses consistent AI action wording',()=>{
  const start=app.indexOf('function searchMatchCard');
  const end=app.indexOf('function bindSearchMatchActions',start);
  const source=app.slice(start,end);
  assert.match(source,/>Разобрать матч<\/button>/);
  assert.doesNotMatch(source,/Преданализ/);
});

test('Search competition summary styling stays explicit',()=>{
  assert.match(css,/MatchRadar Search & Discovery — direct, ranked, actionable results/);
  assert.match(css,/\.search-entity-summary\.search-competition-summary\{[\s\S]*?width:100%/);
  assert.match(css,/#searchRecentWrap\[hidden\],[\s\S]*?#searchFavoritesWrap\[hidden\]\{[\s\S]*?display:none!important/);
});
