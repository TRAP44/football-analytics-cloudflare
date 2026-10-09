import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8') + '\n' + fs.readFileSync('public/modules/global-search-renderer.js', 'utf8') + '\n' + fs.readFileSync('public/modules/global-search-controller.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const searchDiscoveryRuntime = fs.readFileSync('src/search-discovery-runtime.js', 'utf8');
const providerFixtureRuntime = fs.readFileSync('src/provider-fixture-runtime.js', 'utf8');

test('search exposes teams, leagues, upcoming and finished modes', () => {
  for (const mode of ['all','teams','competitions','upcoming','finished']) {
    assert.match(html, new RegExp(`data-search-mode="${mode}"`));
  }
  assert.match(html, />Команды</);
  assert.match(html, />Лиги</);
  assert.match(html, />Предстоящие</);
  assert.match(html, />Завершённые</);
  assert.match(app, /function setGlobalSearchMode\(/);
  assert.match(app, /remoteMatches/);
  assert.match(app, /matchSourceTeam/);
});

test('search enriches league queries with cached upcoming and finished fixtures', () => {
  assert.match(searchDiscoveryRuntime, /async function loadSearchCompetitionMatches\(/);
  assert.match(readContractSource(new URL('../src/search-discovery-runtime.js', import.meta.url), 'utf8'), /apiFootball\('\/fixtures',\s*\{\s*league:\s*leagueId,\s*season,\s*from,\s*to\s*\}/);
  assert.match(searchDiscoveryRuntime, /preferCompetitionSearch\(/);
  assert.match(app, /remoteMatches:entityRows\(\s*safeRead\(data,'matches'\),\s*'fixtureId'/);
  assert.match(app, /safeText\(safeRead\(matchSource,'name'\),160\)/);
});

test('search enriches a team query on the server with recent and upcoming fixtures', () => {
  assert.match(searchDiscoveryRuntime, /async function loadSearchTeamMatches\(/);
  assert.match(searchDiscoveryRuntime, /search:team-fixtures:/);
  assert.match(providerFixtureRuntime, /apiFootball\('\/fixtures',\{team:id,next:12\},cfg\)/);
  assert.match(providerFixtureRuntime, /apiFootball\('\/fixtures',\{team:id,last:8\},cfg\)/);
  assert.doesNotMatch(providerFixtureRuntime, /apiFootball\('\/fixtures',\{team:id,from,to\},cfg\)/);
  assert.match(searchDiscoveryRuntime, /loadProviderTeamDiscoveryFixtures\(teamId,cfg/);
  assert.doesNotMatch(app, /const hub = await api\(`\/api\/team\?teamId=/);
  assert.match(app, /plainObject\(safeRead\(data,'matchDiscovery'\)\) \|\| null/);
  assert.match(readContractSource(new URL('../public/modules/global-search-renderer.js', import.meta.url), 'utf8'), /Предстоящие матчи/);
  assert.match(readContractSource(new URL('../public/modules/global-search-renderer.js', import.meta.url), 'utf8'), /Завершённые матчи/);
});

test('team fixture discovery avoids date-range queries that require a season', () => {
  assert.doesNotMatch(searchDiscoveryRuntime+'\n'+providerFixtureRuntime, /apiFootball\('\/fixtures',\s*\{\s*team:[^}]*\bfrom\b[^}]*\bto\b/);
  assert.match(searchDiscoveryRuntime,/loadProviderTeamDiscoveryFixtures\(teamId,cfg/);
  assert.match(providerFixtureRuntime,/apiFootball\('\/fixtures',\{team:id,next:12\},cfg\)/);
  assert.match(providerFixtureRuntime,/apiFootball\('\/fixtures',\{team:id,last:8\},cfg\)/);
});

test('search match results have direct actions without running analysis automatically', () => {
  assert.match(app, /data-search-fixture/);
  assert.match(app, /data-search-center/);
  assert.match(app, /Преданализ/);
  assert.match(app, /Центр матча/);
  assert.match(app, /Итоги/);
  assert.match(styles, /\.search-match-card/);
});

test('server manifest advertises unified search capabilities', () => {
  assert.match(readContractSource(new URL('../src/app-capabilities.js', import.meta.url), 'utf8'), /unifiedSearch:\s*true/);
  assert.match(readContractSource(new URL('../src/app-capabilities.js', import.meta.url), 'utf8'), /searchMatchHistory:\s*true/);
  assert.match(readContractSource(new URL('../src/app-capabilities.js', import.meta.url), 'utf8'), /searchLeagueFixtures:\s*true/);
});

test('unified search discards out-of-order provider responses and errors',()=>{
  const controller=fs.readFileSync('public/modules/global-search-controller.js','utf8');
  const start=controller.indexOf('async function runGlobalSearch');
  const end=controller.indexOf('function ',start+20);
  assert.ok(start>=0);
  const flow=controller.slice(start,start+6000);
  assert.match(flow,/const seq=nextRequestSeq\(\)/);
  assert.match(flow,/seq!==currentRequestSeq\(\)/);
  assert.match(flow,/query!==currentQuery\(\)/);
  assert.match(flow,/catch \(error\) \{\s*if \(seq!==currentRequestSeq\(\)\) return/);
});
