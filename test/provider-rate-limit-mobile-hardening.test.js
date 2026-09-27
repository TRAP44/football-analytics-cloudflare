import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../src/api-football-gateway.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8') + '\n' + readFileSync(new URL('../public/styles/public-shell.css', import.meta.url), 'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('FREE LIVE cadence and shared feature cache protect provider minute budget',()=>{
  const refresh=block(worker,'function liveRefreshSeconds','function providerFeaturePolicy');
  assert.match(refresh,/return 90/);

  const policy=block(worker,'function providerFeaturePolicy','function featureCacheAgeSeconds');
  assert.match(policy,/mode === 'live'/);
  assert.match(policy,/\['events','statistics'\]/);
  assert.match(policy,/ttlSeconds = Math\.max\(ttlSeconds, 180\)/);
});

test('fixtures are reused from persistent shared caches before provider calls',()=>{
  const fixtures=block(worker,'function providerFixtureDateCacheKey','async function apiMatches');
  assert.match(fixtures,/provider-fixtures:/);
  assert.match(fixtures,/provider-fixture:/);
  assert.match(fixtures,/cachedProviderFixture/);
  assert.match(fixtures,/loadProviderFixture/);

  const matches=block(worker,'async function apiMatches','function normalizeStandingRow');
  assert.match(matches,/providerBatchKey/);
  assert.match(matches,/providerBatchTtl=isToday \? 2/);

  const matchCenter=block(worker,'async function apiMatchCenter','async function cachedTeamIntelligenceForAnalysis');
  assert.match(matchCenter,/loadProviderFixture\(fixtureId,cfg\)/);

  const analyze=block(worker,'async function apiAnalyze','async function publicServiceStatus');
  assert.match(analyze,/loadProviderFixture\(fixtureId,cfg\)/);
});

test('FREE AI avoids optional network fan-out and reuses cached feature data',()=>{
  const providerFetch=block(worker,'async function analysisProviderFetch','async function providerFeatureFetch');
  assert.match(providerFetch,/analysis-provider:/);
  assert.match(providerFetch,/provider-feature:/);
  assert.match(providerFetch,/source:'cache'/);
  assert.match(providerFetch,/source:'stale'/);

  const analyze=block(worker,'async function apiAnalyze','async function publicServiceStatus');
  assert.match(analyze,/const canFetchLineups = detailedCoverage && paid/);
  assert.match(analyze,/const canFetchFreshForm = detailedCoverage && paid/);
  assert.match(analyze,/const canFetchH2H = detailedCoverage && paid/);
  assert.match(analyze,/const canFetchInjuries = paid/);
});

test('real provider response headers persist quota evidence without synthetic probes',()=>{
  const quota=block(worker,'function providerQuotaEvidence','function quotaUsed');
  for(const token of ['PROVIDER_QUOTA_CONFIRMED','dailyLimit','dailyRemaining','minuteLimit','minuteRemaining','response_headers']){
    assert.match(quota,new RegExp(token));
  }
  const network=block(worker,'async function apiFootballNetwork','function providerRequestKey');
  assert.match(network,/providerQuotaEvidence\(cfg\)/);
  assert.match(network,/FOOTBALL_RATE_LIMIT_BODY/);
});

test('client deduplicates match center refreshes and keeps provider cooldown non-blocking',()=>{
  const request=block(app,'async function requestMatchCenter','function updateLiveCountdown');
  assert.match(request,/matchCenterInFlight/);
  assert.match(request,/state\.clientPerf\.deduped/);

  const open=block(app,'async function openMatchCenter','function syncAnalysisBusyUi');
  assert.match(open,/\['rate_limit','provider'\]/);
  assert.match(open,/showView\(sourceView/);

  const search=block(app,'async function runGlobalSearch','function openTournamentMeta');
  assert.doesNotMatch(search,/dedupe:\s*false/);

  const matches=block(app,'async function loadMatches','function syncFilterButtons');
  assert.doesNotMatch(matches,/dedupe:\s*false/);
  assert.match(app,/query\.trim\(\)\.length >= 3/);
  assert.match(app,/setTimeout\(\(\) => runGlobalSearch\(\), 500\)/);
});

test('360-400px mobile layout keeps score status teams and title stable',()=>{
  assert.match(css,/provider cooldown \+ 360–400px mobile hardening/);
  assert.match(css,/\.center-score-core > strong,[\s\S]*white-space: nowrap/);
  assert.match(css,/\.center-team-card strong[\s\S]*-webkit-line-clamp: 2/);
  assert.match(css,/#topbarTitle[\s\S]*overflow-wrap: anywhere/);
  assert.match(css,/@media \(max-width: 430px\)/);
  assert.match(css,/@media \(max-width: 380px\)/);
});
