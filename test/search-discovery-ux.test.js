import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { discoveryMatchRank, mergeById } from '../public/modules/global-search-controller.js';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

test('Search ranking prefers exact and prefix matches before loose contains',()=>{
  assert.equal(discoveryMatchRank('Arsenal','arsenal'),0);
  assert.equal(discoveryMatchRank('Arsenal Women','ars'),1);
  assert.equal(discoveryMatchRank('Real Madrid','mad'),2);
  assert.equal(discoveryMatchRank('Manchester City','city'),2);
  assert.equal(discoveryMatchRank('Paris Saint-Germain','germain'),3);
  assert.equal(discoveryMatchRank('Inter','xyz'),99);
});

test('Search competition result is directly actionable',()=>{
  const start=app.indexOf('function searchCompetitionSummaryCard');
  const end=app.indexOf('function bindDiscoveryActions',start);
  const source=app.slice(start,end);
  assert.match(source,/<button class="search-entity-summary search-competition-summary"/);
  assert.match(source,/data-search-competition/);
  assert.match(source,/data-comp-name/);
  assert.match(source,/Открыть →/);
  const bind=app.slice(end,app.indexOf('function setDiscoveryHomeVisibility',end));
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

test('Search ranking normalizes Cyrillic ё and rejects empty or nontext values',()=>{
  assert.equal(discoveryMatchRank('Ёлка','елка'),0);
  assert.equal(discoveryMatchRank('Ежевика','ёж'),99);
  assert.equal(discoveryMatchRank('Arsenal',''),99);
  assert.equal(discoveryMatchRank('', 'arsenal'),99);
  assert.equal(discoveryMatchRank({toString:()=> 'Arsenal'},'arsenal'),99);
});
test('Search merge deduplicates IDs without mutating input collections',()=>{
  const first=[{id:10,name:'Arsenal'},{id:0,name:'Invalid'}];
  const second=[{id:'10',name:'Duplicate'},{id:20,name:'Chelsea'},{id:true,name:'Malformed'}];
  const merged=mergeById(first,second);
  assert.deepEqual(merged.map(x=>x.id),[10,20]);
  assert.equal(merged[0].name,'Arsenal');
  assert.notEqual(merged[0],first[0]);
  assert.equal(first.length,2);
  assert.equal(second.length,3);
});
