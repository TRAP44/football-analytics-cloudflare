import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  applyFeatureFreshness,
  applyFeatureFreshnessMap,
  assessFeatureFreshness,
  featureFreshnessLimitSeconds,
} from '../src/data-freshness.js';
import { annotateLineupReliability } from '../src/lineup-quality.js';

const NOW=Date.parse('2026-10-03T12:00:00.000Z');

function availableMeta(overrides={}) {
  return {
    feature:'statistics',
    provider:'api-football',
    source:'network',
    state:'available',
    available:true,
    usable:true,
    observed:true,
    fetchedAt:'2026-10-03T11:59:30.000Z',
    ...overrides,
  };
}

function confirmedLineupQuality() {
  return {
    anyPublished:true,
    bothPublished:true,
    bothConfirmed:true,
    confirmedSides:2,
    structuralBothConfirmed:false,
    home:{confirmed:true},
    away:{confirmed:true},
  };
}

test('RC139 accepts recent attributed live evidence as confidence-bearing',()=>{
  const meta=assessFeatureFreshness(availableMeta(),{mode:'live',now:NOW});

  assert.equal(meta.state,'available');
  assert.equal(meta.freshnessState,'fresh');
  assert.equal(meta.provenanceState,'verified');
  assert.equal(meta.confidenceBearing,true);
  assert.equal(meta.ageSeconds,30);
  assert.equal(meta.available,true);
  assert.equal(meta.modeValid,true);
  assert.equal(meta.timestampInvalid,false);
});

test('explicit stale evidence remains observable but cannot drive analytics',()=>{
  const meta=applyFeatureFreshness(availableMeta({
    feature:'events',
    source:'stale-cache',
    state:'stale',
    fetchedAt:'2026-10-03T11:59:50.000Z',
  }),{mode:'live',now:NOW});

  assert.equal(meta.state,'stale_data');
  assert.equal(meta.observed,true);
  assert.equal(meta.available,false);
  assert.equal(meta.usable,false);
  assert.equal(meta.stale,true);
  assert.equal(meta.confidenceBearing,false);
  assert.equal(meta.transportState,'stale');
});

test('upstream update time takes precedence over a recent HTTP fetch time',()=>{
  const meta=assessFeatureFreshness(availableMeta({
    feature:'liveOdds',
    provider:'the-odds-api',
    fetchedAt:'2026-10-03T11:59:55.000Z',
    sourceUpdatedAt:'2026-10-03T11:50:00.000Z',
  }),{mode:'live',now:NOW});

  assert.equal(meta.ageSeconds,600);
  assert.equal(meta.sourceUpdatedAt,'2026-10-03T11:50:00.000Z');
  assert.equal(meta.stale,true);
  assert.equal(meta.state,'stale_data');
  assert.equal(meta.confidenceBearing,false);
});

test('a malformed supplied sourceUpdatedAt fails closed instead of falling back to fetchedAt',()=>{
  for(const sourceUpdatedAt of [
    'not-a-date',
    '2026-02-30T11:59:00.000Z',
    {},
    [],
    true,
  ]) {
    const meta=assessFeatureFreshness(availableMeta({
      feature:'liveOdds',
      provider:'the-odds-api',
      fetchedAt:'2026-10-03T11:59:55.000Z',
      sourceUpdatedAt,
    }),{mode:'live',now:NOW});

    assert.equal(meta.sourceTimestampInvalid,true,String(sourceUpdatedAt));
    assert.equal(meta.timestampInvalid,true,String(sourceUpdatedAt));
    assert.equal(meta.ageSeconds,null,String(sourceUpdatedAt));
    assert.equal(meta.state,'invalid_freshness',String(sourceUpdatedAt));
    assert.equal(meta.freshnessReason,'source_timestamp_invalid',String(sourceUpdatedAt));
    assert.equal(meta.confidenceBearing,false,String(sourceUpdatedAt));
  }
});

test('impossible fetched timestamps fail closed when no upstream timestamp exists',()=>{
  const meta=assessFeatureFreshness(availableMeta({
    fetchedAt:'2026-02-30T11:59:30.000Z',
  }),{mode:'live',now:NOW});

  assert.equal(meta.fetchTimestampInvalid,true);
  assert.equal(meta.timestampInvalid,true);
  assert.equal(meta.state,'invalid_freshness');
  assert.equal(meta.freshnessReason,'fetch_timestamp_invalid');
  assert.equal(meta.confidenceBearing,false);
});

test('evaluation clock, mode and fallback age reject ambiguous coercion',()=>{
  for(const now of [false,true,null,'0','',Number.NaN,Number.POSITIVE_INFINITY]) {
    const meta=assessFeatureFreshness(availableMeta(),{mode:'live',now});
    assert.equal(meta.clockValid,false,String(now));
    assert.equal(meta.state,'invalid_freshness',String(now));
    assert.equal(meta.freshnessReason,'invalid_clock',String(now));
    assert.equal(meta.confidenceBearing,false,String(now));
  }

  for(const mode of [false,null,'prematch','unknown','']) {
    const meta=assessFeatureFreshness(availableMeta(),{mode,now:NOW});
    assert.equal(meta.modeValid,false,String(mode));
    assert.equal(meta.state,'invalid_freshness',String(mode));
    assert.equal(meta.freshnessReason,'invalid_mode',String(mode));
    assert.equal(meta.confidenceBearing,false,String(mode));
  }

  for(const ageSeconds of [false,true,null,'0','30','   ',{}]) {
    const meta=assessFeatureFreshness(availableMeta({
      source:'network',
      fetchedAt:null,
      ageSeconds,
    }),{mode:'live',now:NOW});
    assert.equal(meta.ageSeconds,null,String(ageSeconds));
    assert.equal(meta.confidenceBearing,false,String(ageSeconds));
    assert.equal(meta.freshnessReason,'freshness_missing',String(ageSeconds));
  }
});

test('provider provenance requires real strings instead of object coercion',()=>{
  for(const [provider,source] of [
    [{name:'api-football'},'network'],
    [['api-football'],'network'],
    ['api-football',{name:'network'}],
    ['api-football',['network']],
    [true,'network'],
    ['api-football',true],
  ]) {
    const meta=assessFeatureFreshness(availableMeta({provider,source}),{
      mode:'live',
      now:NOW,
    });
    assert.equal(meta.provenanceState,'unknown');
    assert.equal(meta.state,'unverified_source');
    assert.equal(meta.confidenceBearing,false);
  }
});

test('freshness flags require actual booleans and forceStale is strict',()=>{
  const malformed=assessFeatureFreshness(availableMeta({
    available:'true',
    usable:'true',
    observed:'true',
  }),{mode:'live',now:NOW,forceStale:'true'});

  assert.equal(malformed.available,false);
  assert.equal(malformed.usable,false);
  assert.equal(malformed.observed,false);
  assert.equal(malformed.stale,false);
  assert.equal(malformed.confidenceBearing,false);

  const forced=assessFeatureFreshness(availableMeta(),{
    mode:'live',
    now:NOW,
    forceStale:true,
  });
  assert.equal(forced.stale,true);
  assert.equal(forced.state,'stale_data');
  assert.equal(forced.confidenceBearing,false);
});

test('provider TTL can extend only within the bounded policy and malformed TTL cannot widen freshness',()=>{
  assert.equal(
    featureFreshnessLimitSeconds(
      {feature:'statistics',policy:{ttlSeconds:75}},
      {feature:'statistics',mode:'live'},
    ),
    150,
  );

  for(const ttlSeconds of [true,false,'75','3600','',null,{}]) {
    const limit=featureFreshnessLimitSeconds(
      {feature:'statistics',policy:{ttlSeconds}},
      {feature:'statistics',mode:'live'},
    );
    assert.equal(limit,150,String(ttlSeconds));
  }

  const excessive=assessFeatureFreshness(availableMeta({
    policy:{ttlSeconds:3600},
  }),{mode:'live',now:NOW});
  assert.equal(excessive.ttlPolicyExcessive,true);
  assert.equal(excessive.freshnessLimitSeconds,150);
  assert.equal(excessive.state,'unverified_freshness');
  assert.equal(excessive.freshnessReason,'ttl_policy_excessive');
  assert.equal(excessive.confidenceBearing,false);
});

test('future timestamps allow only the bounded provider clock skew',()=>{
  const within=assessFeatureFreshness(availableMeta({
    fetchedAt:'2026-10-03T12:00:20.000Z',
  }),{mode:'live',now:NOW});
  assert.equal(within.futureTimestamp,false);
  assert.equal(within.futureSkewSeconds,20);
  assert.equal(within.ageSeconds,0);
  assert.equal(within.confidenceBearing,true);

  const beyond=assessFeatureFreshness(availableMeta({
    fetchedAt:'2026-10-03T12:00:31.000Z',
  }),{mode:'live',now:NOW});
  assert.equal(beyond.futureTimestamp,true);
  assert.equal(beyond.ageSeconds,null);
  assert.equal(beyond.state,'invalid_freshness');
  assert.equal(beyond.freshnessReason,'future_timestamp');
  assert.equal(beyond.confidenceBearing,false);
});

test('embedded freshness requires a real timestamp even when ageSeconds claims zero',()=>{
  const meta=assessFeatureFreshness(availableMeta({
    feature:'lineups',
    source:'embedded',
    fetchedAt:null,
    ageSeconds:0,
  }),{mode:'upcoming',now:NOW});

  assert.equal(meta.timestampRequired,true);
  assert.equal(meta.timestampMissing,true);
  assert.equal(meta.state,'unverified_freshness');
  assert.equal(meta.freshnessReason,'embedded_timestamp_missing');
  assert.equal(meta.confidenceBearing,false);
});

test('freshness map safely normalizes malformed map entries and can force-stale a whole snapshot',()=>{
  assert.deepEqual(applyFeatureFreshnessMap(null),{});
  assert.deepEqual(applyFeatureFreshnessMap([]),{});
  assert.deepEqual(applyFeatureFreshnessMap('broken'),{});

  const malformed=applyFeatureFreshnessMap({
    events:'broken',
    statistics:['broken'],
  },{mode:'live',now:NOW});
  assert.equal(malformed.events.feature,'events');
  assert.equal(malformed.events.available,false);
  assert.equal(malformed.events.confidenceBearing,false);
  assert.equal(malformed.statistics.feature,'statistics');
  assert.equal(malformed.statistics.available,false);

  const forced=applyFeatureFreshnessMap({
    events:availableMeta({feature:'events',source:'cache'}),
    statistics:availableMeta({feature:'statistics',source:'cache'}),
  },{mode:'live',now:NOW,forceStale:true});
  assert.equal(forced.events.stale,true);
  assert.equal(forced.statistics.stale,true);
  assert.equal(forced.events.confidenceBearing,false);
  assert.equal(forced.statistics.available,false);
});

test('lineup reliability cannot promote object provenance or stale freshness to confirmed trust',()=>{
  const malformed=annotateLineupReliability({
    state:'available',
    available:true,
    usable:true,
    observed:true,
    provider:{name:'api-football'},
    source:'network',
    freshnessState:'fresh',
  },confirmedLineupQuality());

  assert.equal(malformed.state,'unverified_source');
  assert.equal(malformed.provenanceState,'unknown');
  assert.equal(malformed.confirmed,false);
  assert.equal(malformed.confidenceBearing,false);

  const stale=annotateLineupReliability({
    state:'available',
    available:true,
    usable:true,
    observed:true,
    provider:'api-football',
    source:'network',
    freshnessState:'stale',
  },confirmedLineupQuality());

  assert.equal(stale.state,'stale_data');
  assert.equal(stale.stale,true);
  assert.equal(stale.confirmed,false);
  assert.equal(stale.confidenceBearing,false);
});

test('Match Center current wiring re-evaluates cache freshness and suppresses stale live analytics',()=>{
  const source=fs.readFileSync('src/match-center-runtime.js','utf8');

  assert.match(source,/if \(!\['live','finished','upcoming'\]\.includes\(mode\)\) return null;/);
  assert.match(source,/safeFeatureFreshnessMap\(\s*cachedMeta,\s*\{mode:cachedMode\},/);
  assert.match(source,/safeFeatureFreshnessMap\(staleMeta,\{\s*mode:staleMode,\s*forceStale:true,/);
  assert.match(source,/livePressure:null,[\s\S]*?smartInsights:null,[\s\S]*?liveAiCoach:null,[\s\S]*?liveOdds:null,[\s\S]*?oddsMovement:null/);
  assert.match(source,/value\?\.confidenceBearing===true[\s\S]*?value\?\.provenanceState==='verified'/);
  assert.match(source,/provider:'api-football',[\s\S]*?source:'embedded',[\s\S]*?fetchedAt:fixtureFetchedAt/);
});

test('prematch analysis gates odds and lineups through refreshed feature trust before model use',()=>{
  const source=fs.readFileSync('src/analysis-runtime.js','utf8');

  assert.match(source,/applyFeatureFreshnessMap\(\{[\s\S]*?odds:resolvedOddsMeta,[\s\S]*?lineups:lineupMeta,[\s\S]*?\},\{mode:'upcoming'\}\)/);
  assert.match(source,/meta\?\.confidenceBearing === true && meta\?\.stale !== true/);
  assert.match(source,/trustedLineups=featureTrusted\('lineups'\) \? lineups : \{\}/);
  assert.match(source,/analysisMarket=objectValue\(oddsMarketForTrustedAnalytics\(market,oddsQuality\)\)/);
  assert.match(source,/if \(analysisMarket\) \{\s*try \{ await saveOddsSnapshot/);
  assert.match(source,/sourceUpdatedAt:safeText\(meta\.sourceUpdatedAt,80\) \|\| null/);
  assert.match(source,/confidenceBearing:meta\.confidenceBearing === true/);
});

test('RC139 release contract uses the current AI freshness capability instead of legacy /health feature flags',()=>{
  const capabilities=fs.readFileSync('src/app-capabilities.js','utf8');
  const health=fs.readFileSync('src/public-health.js','utf8');

  assert.match(capabilities,/aiFreshnessGuard:true/);
  assert.match(capabilities,/preKickoffRecheck:true/);
  assert.match(capabilities,/preKickoffChangeDetection:true/);
  assert.match(capabilities,/analysisDeltaSummary:true/);

  assert.match(health,/readiness:Object\.freeze\(\{[\s\S]*?ok:readiness\.ok === true/);
  assert.doesNotMatch(health,/freshnessAwareDataTrust/);
});
