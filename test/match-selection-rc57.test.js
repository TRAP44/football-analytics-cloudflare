import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');
const playbook=fs.readFileSync('MATCH_SELECTION_RC57.md','utf8');

test('RC57 server ranks the primary match before client rendering',()=> {
  assert.match(worker,/function matchSelectionProfile\(/);
  assert.match(worker,/function compareMatchSelection\(/);
  assert.match(worker,/function rankTeamDiscoveryMatches\(/);
  assert.match(worker,/live \? 0 : !finished && official \? 1 : !finished \? 2 : official \? 3 : 4/);
  assert.match(worker,/Ближайший официальный матч основной команды/);
});

test('official upcoming beats an earlier friendly and youth fixture',()=> {
  assert.match(worker,/MATCH_SELECTION_DRILL_NOW/);
  assert.match(worker,/fixtureId:1,date:'2026-09-24T18:00:00Z'.*category:'friendly'/s);
  assert.match(worker,/fixtureId:2,date:'2026-09-26T18:00:00Z'.*category:'cup'/s);
  assert.match(worker,/fixtureId:5,date:'2026-09-25T18:00:00Z'.*Example FC U21/s);
  assert.match(worker,/Number\(primary\?\.fixtureId\)===2/);
  assert.match(worker,/officialUpcoming\.join\(','\)==='2,3'/);
});

test('selection metadata is part of search and team discovery payloads',()=> {
  assert.match(worker,/primaryFixtureId:Number\(split\.primary\?\.fixtureId \|\| 0\) \|\| null/);
  assert.match(worker,/primaryReason:String\(split\.primary\?\.selection\?\.reason \|\| ''\)/);
  assert.match(worker,/primaryFixtureId:Number\(discovery\.primary\?\.fixtureId \|\| 0\) \|\| null/);
});

test('Mini App preserves server ranking and explains the primary match',()=> {
  assert.match(app,/mergeById\(state\.globalSearch\.remoteMatches, local\.matches, 'fixtureId'\)/);
  assert.match(app,/selection\?\.rank \|\| 999/);
  assert.match(app,/ОСНОВНОЙ МАТЧ/);
  assert.match(app,/FM AI выбрал основной матч/);
  assert.match(css,/\.search-match-card\.is-primary/);
});

test('Telegram highlights the primary match and analytics remains query-text free',()=> {
  assert.match(worker,/matches=rankTeamDiscoveryMatches\(matches\)\.slice\(0,3\)/);
  assert.match(worker,/Основной матч для анализа/);
  assert.match(worker,/Первый матч — основной выбор FM AI/);
  const event=/eventName:'search_result',channel:'telegram',metadata:\{intent:parts\.intent,outcome:'match',recognized,recovery,primaryFixtureId,count:Math\.min\(3,matches\.length\)\}/;
  assert.match(worker,event);
});

test('RC57 release gate exposes match-selection self test',()=> {
  for (const flag of ['matchSelectionIntelligence','primaryMatchRecommendation','officialMatchPriority','selectionReasonUx']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
  assert.match(worker,/matchSelectionSelfTest: matchSelectionDrill\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(playbook,/LIVE → официальный upcoming → прочий upcoming → официальный recent → прочий recent/);
});