import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const providerFixtureRuntime=fs.readFileSync('src/provider-fixture-runtime.js','utf8');
const searchDiscoveryRuntime=fs.readFileSync('src/search-discovery-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/global-search-renderer.js','utf8')+'\n'+fs.readFileSync('public/modules/global-search-controller.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC56 discovers team fixtures in one shared backend path',()=> {
  assert.match(searchDiscoveryRuntime,/async function loadSearchTeamMatches\(/);
  assert.match(searchDiscoveryRuntime,/search:team-fixtures:/);
  assert.match(searchDiscoveryRuntime,/await loadSearchTeamMatches\(cached\.teams\[0\], cfg\)/);
  assert.match(searchDiscoveryRuntime,/await loadSearchTeamMatches\(teams\[0\], cfg\)/);
  assert.match(searchDiscoveryRuntime,/const discovery=await loadSearchTeamMatches\(team,cfg,\{secondQuery:parts\.second\}\)/);
  assert.doesNotMatch(worker,/bot:team-matches:/);
});

test('discovery uses provider-supported team next/last queries with recent-match recovery',()=> {
  assert.match(searchDiscoveryRuntime,/TEAM_DISCOVERY_PAST_DAYS = 30/);
  assert.match(searchDiscoveryRuntime,/TEAM_DISCOVERY_FUTURE_DAYS = 120/);
  assert.match(providerFixtureRuntime,/apiFootball\('\/fixtures',\{team:id,next:12\},cfg\)/);
  assert.match(providerFixtureRuntime,/apiFootball\('\/fixtures',\{team:id,last:8\},cfg\)/);
  assert.doesNotMatch(providerFixtureRuntime,/apiFootball\('\/fixtures',\{team:id,from,to\},cfg\)/);
  assert.match(searchDiscoveryRuntime,/mode:upcoming\.length \? 'upcoming' : recent\.length \? 'recent' : 'empty'/);
  assert.match(searchDiscoveryRuntime,/matches:\[\.\.\.split\.upcoming,\.\.\.split\.recent\]/);
});

test('Mini App no longer performs an automatic second team-hub fetch',()=> {
  assert.match(app,/matchDiscovery:data\.matchDiscovery \|\| null/);
  assert.doesNotMatch(app,/const hub = await api\(`\/api\/team\?teamId=/);
  assert.match(app,/data-search-team=/);
  assert.match(app,/Открыть →/);
  assert.match(css,/\.search-team-summary/);
});

test('zero-result UX stays simple while backend preserves recent-match recovery',()=> {
  assert.match(app,/Матчей сейчас нет/);
  assert.match(app,/Матч найден/);
  assert.match(app,/Источник отвечает слишком долго/);
  assert.match(searchDiscoveryRuntime,/recovery=matches\.some\(match=>!match\.finished\)\?'upcoming':'recent'/);
  assert.match(worker,/recoveredRecent:searchRecoveredRecent/);
});

test('RC56 health and playbook describe the release gate',()=> {
  for (const flag of ['zeroResultRecovery','teamFixtureDiscovery','sharedFixtureDiscoveryCache','extendedTeamCalendar','recentMatchFallback']) {
    assert.ok(worker.includes(`${flag}: 'enabled'`), `missing ${flag}`);
  }
});