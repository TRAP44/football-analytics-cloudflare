import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const providerFixtureRuntime=readFileSync(new URL('../src/provider-fixture-runtime.js',import.meta.url),'utf8');
const providerBudgetRuntime=readFileSync(new URL('../src/provider-budget-runtime.js',import.meta.url),'utf8');
const apiFootballGateway=readFileSync(new URL('../src/api-football-gateway.js',import.meta.url),'utf8');
const teamTournamentRuntime=readFileSync(new URL('../src/team-tournament-runtime.js',import.meta.url),'utf8');
const searchDiscoveryRuntime=readFileSync(new URL('../src/search-discovery-runtime.js',import.meta.url),'utf8');

function block(start,end,source=worker){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('Issue #330 shares team discovery fixtures across search and team page flows',()=>{
  const helper=block(
    'async function loadProviderTeamDiscoveryFixtures',
    'function providerFixtureDirectCacheKey',
    providerFixtureRuntime,
  );
  assert.match(helper,/providerTeamDiscoveryCacheKey\(id\)/);
  assert.match(helper,/providerTeamFixtureReuses/);
  assert.equal((helper.match(/apiFootball\('\/fixtures'/g)||[]).length,2);
  assert.match(helper,/team:id,next:12/);
  assert.match(helper,/team:id,last:8/);
  assert.match(helper,/hasLive/);
  assert.match(helper,/Math\.ceil\(Number\(liveRefreshSeconds\(\)\)\/60\)/);
  assert.match(helper,/ttlMinutes/);

  const search=block('async function loadSearchTeamMatches','async function apiSearch',searchDiscoveryRuntime);
  assert.match(search,/loadProviderTeamDiscoveryFixtures\(teamId,cfg\)/);
  assert.doesNotMatch(search,/apiFootball\('\/fixtures',\{team:teamId,next:12\}/);
  assert.doesNotMatch(search,/apiFootball\('\/fixtures',\{team:teamId,last:8\}/);

  const team=block('async function apiTeam(request, cfg)','  return Object.freeze',teamTournamentRuntime);
  assert.match(team,/loadProviderTeamDiscoveryFixtures\(teamId,cfg\)/);
  assert.doesNotMatch(team,/apiFootball\('\/fixtures', \{ team:teamId, next:12 \}/);
  assert.doesNotMatch(team,/apiFootball\('\/fixtures', \{ team:teamId, last:8 \}/);
});

test('Issue #330 exposes persistent team-fixture reuse in provider budget telemetry',()=>{
  assert.match(providerFixtureRuntime,/bumpTelemetry\('providerTeamFixtureReuses'\)/);
  const budget=block('function providerBudgetProfile','function providerPublicBudgetMode',providerBudgetRuntime);
  assert.match(budget,/teamFixtureReuses:\s*Number\(memory\.telemetry\?\.providerTeamFixtureReuses \|\| 0\)/);
});

test('Issue #330 leaves distributed guard and LIVE provider feature policy intact',()=>{
  assert.match(apiFootballGateway,/async function claimDistributedProviderBudget\(cfg\)/);
  const policy=block('function providerFeaturePolicy','function featureCacheAgeSeconds',providerBudgetRuntime);
  assert.match(policy,/mode === 'live'/);
  assert.match(policy,/\['events','statistics'\]/);
  assert.match(policy,/ttlSeconds = Math\.max\(ttlSeconds, 180\)/);
});

test('Issue #330 caches only deduplicated team fixtures and preserves no-network mode',()=>{
  const helper=block(
    'async function loadProviderTeamDiscoveryFixtures',
    'function providerFixtureDirectCacheKey',
    providerFixtureRuntime,
  );
  assert.match(helper,/if \(!id\) return \[\]/);
  assert.match(helper,/if \(!allowNetwork\) return \[\]/);
  assert.match(helper,/Promise\.allSettled\(\[/);
  assert.match(helper,/seenFixtures\.has\(fixtureId\)/);
  assert.match(helper,/seenFixtures\.add\(fixtureId\)/);
  assert.match(helper,/homeId!==id && awayId!==id/);
  assert.match(helper,/if \(errors\.length===2\) throw errors\[0\]/);
  assert.match(helper,/const ttlMinutes=partial \? 5 : hasLive \? liveTtl : 120/);
});
