import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyFeatureFreshness,
  applyFeatureFreshnessMap,
  assessFeatureFreshness,
  featureFreshnessLimitSeconds,
} from '../src/data-freshness.js';

test('RC139 accepts a recent attributed live feature as confidence-bearing', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const meta = assessFeatureFreshness({
    feature:'statistics', provider:'api-football', source:'network',
    state:'available', available:true, usable:true, observed:true,
    fetchedAt:'2026-09-25T11:59:30Z',
  }, { mode:'live', now });
  assert.equal(meta.state, 'available');
  assert.equal(meta.freshnessState, 'fresh');
  assert.equal(meta.provenanceState, 'verified');
  assert.equal(meta.confidenceBearing, true);
  assert.equal(meta.ageSeconds, 30);
  assert.equal(meta.available, true);
});

test('RC139 makes non-empty explicit stale cache observational only', () => {
  const meta = applyFeatureFreshness({
    feature:'events', provider:'api-football', source:'stale',
    state:'stale', available:true, usable:true, observed:true, count:4,
    fetchedAt:'2026-09-25T11:59:00Z',
  }, { mode:'live', now:Date.parse('2026-09-25T12:00:00Z') });
  assert.equal(meta.state, 'stale_data');
  assert.equal(meta.observed, true);
  assert.equal(meta.available, false);
  assert.equal(meta.usable, false);
  assert.equal(meta.stale, true);
  assert.equal(meta.confidenceBearing, false);
  assert.equal(meta.transportState, 'stale');
});

test('RC139 uses upstream odds update time instead of a recent HTTP fetch time', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const meta = assessFeatureFreshness({
    feature:'liveOdds', provider:'the-odds-api', source:'network',
    state:'available', available:true, usable:true, observed:true,
    fetchedAt:'2026-09-25T11:59:55Z',
    sourceUpdatedAt:'2026-09-25T11:50:00Z',
  }, { mode:'live', now });
  assert.equal(meta.ageSeconds, 600);
  assert.equal(meta.stale, true);
  assert.equal(meta.state, 'stale_data');
  assert.equal(meta.confidenceBearing, false);
});

test('RC139 rejects data without provider provenance even when structurally available', () => {
  const meta = assessFeatureFreshness({
    feature:'lineups', provider:'unknown', source:'embedded',
    state:'available', available:true, usable:true, observed:true, ageSeconds:0,
  }, { mode:'live' });
  assert.equal(meta.state, 'unverified_source');
  assert.equal(meta.provenanceState, 'unknown');
  assert.equal(meta.available, false);
  assert.equal(meta.confidenceBearing, false);
});

test('RC139 force-stale map can downgrade an entire cached live snapshot', () => {
  const map = applyFeatureFreshnessMap({
    events:{provider:'api-football',source:'cache',state:'available',available:true,usable:true,observed:true,ageSeconds:20},
    statistics:{provider:'api-football',source:'cache',state:'available',available:true,usable:true,observed:true,ageSeconds:20},
  }, { mode:'live', forceStale:true });
  assert.equal(map.events.stale, true);
  assert.equal(map.statistics.stale, true);
  assert.equal(map.events.confidenceBearing, false);
  assert.equal(map.statistics.available, false);
});

test('RC139 freshness limits remain at least as permissive as active provider TTLs', () => {
  const limit = featureFreshnessLimitSeconds({ policy:{ ttlSeconds:75 } }, { feature:'statistics', mode:'live' });
  assert.equal(limit, 150);
});

const worker = fs.readFileSync('src/worker.js', 'utf8');
const lineup = fs.readFileSync('src/lineup-quality.js', 'utf8');

test('RC139 Match Center rejects stale live data from derived analytics', () => {
  assert.match(worker, /applyFeatureFreshnessMap\(staleMeta, \{ mode:staleMode, forceStale:true \}\)/);
  assert.match(worker, /livePressure:null, smartInsights:null, liveAiCoach:null, liveOdds:null, oddsMovement:null/);
  assert.match(worker, /const statisticsQuality = assessMatchStatisticsQuality\(rawFormattedStatistics/);
  assert.match(worker, /sanitizeStatisticsForDisplay\(rawFormattedStatistics, statisticsQuality\)/);
  assert.match(worker, /const eventQuality = assessMatchEventQuality\(rawFormattedEvents, \{ eventsMeta:featureMeta\.events \|\| \{\}, mode:centerMode, elapsed \}\)/);
  assert.match(worker, /const analyticalEvents = eventsForTrustedAnalytics\(rawFormattedEvents, eventQuality\)/);
  assert.match(worker, /assessFixtureAvailabilityQuality\(injuryRows,/);
  assert.match(worker, /const trustedInjuryRows = sanitizeAvailabilityRows\(injuryRows, availabilityQuality\)/);
});

test('RC139 embedded Match Center data carries provider and fetch provenance', () => {
  assert.match(worker, /featureMeta\.statistics = \{ feature:'statistics', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt/);
  assert.match(worker, /featureMeta\.players = \{ feature:'players', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt/);
  assert.match(worker, /featureMeta\.lineups = \{ feature:'lineups', provider:'api-football', source:'embedded', fetchedAt:fixtureFetchedAt/);
});

test('RC139 excludes stale market data before probability blending and snapshots', () => {
  assert.match(worker, /analysisFeatureMeta\.odds = annotateOddsReliability/);
  assert.match(worker, /const analysisMarket = oddsMarketForTrustedAnalytics\(market, oddsQuality\)/);
  assert.match(worker, /blendProbabilitySignals\(\{ market:analysisMarket/);
  assert.match(worker, /if \(analysisMarket\) await saveOddsSnapshot/);
  assert.match(worker, /market:analysisMarket, marketMovement/);
});

test('RC139 persists freshness verdicts in the analysis provenance envelope', () => {
  assert.match(worker, /freshnessState:String\(meta\?\.freshnessState \|\| 'unknown'\)/);
  assert.match(worker, /provenanceState:String\(meta\?\.provenanceState \|\| 'unknown'\)/);
  assert.match(worker, /confidenceBearing:Boolean\(meta\?\.confidenceBearing\)/);
  assert.match(worker, /sourceUpdatedAt:meta\?\.sourceUpdatedAt \|\| null/);
});

test('RC139 lineup semantics align confidence-bearing state with structural confirmation', () => {
  assert.match(lineup, /confidenceBearing: Boolean\(originalAvailable && originalUsable\)/);
  assert.match(lineup, /partial: true,[\s\S]{0,100}confidenceBearing: false/);
});


const smoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const runtime = fs.readFileSync('public/modules/app-runtime.js', 'utf8');

test('RC139 is part of the production release health contract', () => {
  assert.match(worker, /const APP_VERSION = '6\.120\.0-rc144'/);
  assert.match(worker, /const RC_NAME = 'RC144'/);
  assert.match(worker, /freshnessAwareDataTrust: 'enabled'/);
  assert.match(worker, /analysisVersion: '4\.15\.0-availability-quality'/);
  assert.match(worker, /fixture:\$\{fixtureId\}:v15-availability-quality-rc144/);
  assert.match(app, /const CLIENT_VERSION = '6\.120\.0-rc144'/);
  assert.match(smoke, /'freshnessAwareDataTrust'/);
});
