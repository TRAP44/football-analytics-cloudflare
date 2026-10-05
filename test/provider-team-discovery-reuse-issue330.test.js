import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

function block(start,end){
  const a=worker.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=worker.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return worker.slice(a,b);
}

test('Issue #330 shares team discovery fixtures across search and team page flows',()=>{
  const helper=block(
    'async function loadProviderTeamDiscoveryFixtures',
    'function providerFixtureDirectCacheKey',
  );
  assert.match(helper,/providerTeamDiscoveryCacheKey\(id\)/);
  assert.match(helper,/providerTeamFixtureReuses/);
  assert.equal((helper.match(/apiFootball\('\/fixtures'/g)||[]).length,2);
  assert.match(helper,/team:id,next:12/);
  assert.match(helper,/team:id,last:8/);
  assert.match(helper,/hasLive/);
  assert.match(helper,/Math\.ceil\(liveRefreshSeconds\(\)\/60\)/);
  assert.match(helper,/ttlMinutes/);

  const search=block('async function loadSearchTeamMatches','async function apiSearch');
  assert.match(search,/loadProviderTeamDiscoveryFixtures\(teamId,cfg\)/);
  assert.doesNotMatch(search,/apiFootball\('\/fixtures',\{team:teamId,next:12\}/);
  assert.doesNotMatch(search,/apiFootball\('\/fixtures',\{team:teamId,last:8\}/);

  const team=block('async function apiTeam\(','async function apiTeamIntelligence');
  assert.match(team,/loadProviderTeamDiscoveryFixtures\(teamId,cfg\)/);
  assert.doesNotMatch(team,/apiFootball\('\/fixtures', \{ team:teamId, next:12 \}/);
  assert.doesNotMatch(team,/apiFootball\('\/fixtures', \{ team:teamId, last:8 \}/);
});

test('Issue #330 exposes persistent team-fixture reuse in provider budget telemetry',()=>{
  assert.match(worker,/providerTeamFixtureReuses:\s*0/);
  const budget=block('function providerBudgetProfile','function providerPublicBudgetMode');
  assert.match(budget,/teamFixtureReuses:\s*Number\(memory\.telemetry\?\.providerTeamFixtureReuses \|\| 0\)/);
});

test('Issue #330 leaves distributed guard and LIVE provider feature policy intact',()=>{
  assert.match(worker,/claimDistributedProviderBudget/);
  const policy=block('function providerFeaturePolicy','function featureCacheAgeSeconds');
  assert.match(policy,/mode === 'live'/);
  assert.match(policy,/\['events','statistics'\]/);
  assert.match(policy,/ttlSeconds = Math\.max\(ttlSeconds, 180\)/);
});
