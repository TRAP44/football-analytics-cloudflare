import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  annotateOddsReliability,
  assessOddsMarketQuality,
  inspectDecimalOdd,
  oddsMarketForTrustedAnalytics,
  sanitizeOddsSnapshotsForMovement,
} from '../src/odds-quality.js';

const trustedMeta = {
  provider:'api-football', source:'network', state:'available', available:true, usable:true,
  observed:true, stale:false, confidenceBearing:true, freshnessState:'fresh', provenanceState:'verified',
};

test('RC143 accepts a trusted internally consistent 1X2 market', () => {
  const market={
    odds:{home:1.8,draw:3.7,away:4.5},
    probabilities:{home:53.1,draw:25.8,away:21.1},
    sources:4,bookmakers:4,provider:'api-football',
  };
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.state,'verified');
  assert.equal(quality.marketValid,true);
  assert.equal(quality.confidenceBearing,true);
  const safe=oddsMarketForTrustedAnalytics(market,quality);
  assert.ok(safe);
  assert.equal(safe.sources,4);
  assert.ok(Math.abs(safe.probabilities.home+safe.probabilities.draw+safe.probabilities.away-100)<=0.2);
});

test('RC143 rejects malformed, out-of-range and economically impossible odds triples', () => {
  assert.equal(inspectDecimalOdd(true).reason,'invalid_type');
  assert.equal(inspectDecimalOdd('abc').reason,'invalid_format');
  assert.equal(inspectDecimalOdd(1).reason,'out_of_range');
  const market={odds:{home:100,draw:100,away:100},sources:2,provider:'api-football'};
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.state,'invalid');
  assert.equal(quality.marketValid,false);
  assert.ok(quality.issues.some(x=>x.code==='implied_total_out_of_range'));
  assert.equal(oddsMarketForTrustedAnalytics(market,quality),null);
});

test('RC143 recomputes inconsistent reported probabilities from trusted decimal odds', () => {
  const market={
    odds:{home:2,draw:3.5,away:4},
    probabilities:{home:90,draw:5,away:5},
    sources:3,provider:'api-football',
  };
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.state,'sanitized');
  assert.ok(quality.probabilityIssueCount>0);
  const safe=oddsMarketForTrustedAnalytics(market,quality);
  assert.ok(safe);
  assert.notDeepEqual(safe.probabilities,market.probabilities);
  assert.ok(Math.abs(safe.probabilities.home+safe.probabilities.draw+safe.probabilities.away-100)<=0.2);
});

test('RC143 fails closed for stale/unverified odds and provider provenance mismatch', () => {
  const market={odds:{home:2,draw:3.5,away:4},sources:2,provider:'api-football'};
  const stale={...trustedMeta,confidenceBearing:false,stale:true,freshnessState:'stale'};
  const staleQuality=assessOddsMarketQuality(market,{oddsMeta:stale});
  assert.equal(staleQuality.state,'source_untrusted');
  assert.equal(staleQuality.confidenceBearing,false);
  const mismatch=assessOddsMarketQuality(market,{oddsMeta:{...trustedMeta,provider:'the-odds-api'}});
  assert.equal(mismatch.state,'invalid');
  assert.ok(mismatch.issues.some(x=>x.code==='provider_mismatch'));
  const annotated=annotateOddsReliability(trustedMeta,mismatch);
  assert.equal(annotated.available,false);
  assert.equal(annotated.confidenceBearing,false);
});

test('RC143 rejects markets without a positive bounded source count', () => {
  const market={odds:{home:2,draw:3.5,away:4},sources:0,provider:'api-football'};
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.marketValid,false);
  assert.ok(quality.issues.some(x=>x.code==='source_count_invalid'));
});

test('RC143 filters malformed historical snapshots and recomputes movement probabilities from odds', () => {
  const rows=[
    {at:'2026-09-25T12:00:00Z',home:2,draw:3.5,away:4,homeProb:99,drawProb:0.5,awayProb:0.5,sources:3},
    {at:'2026-09-25T12:01:00Z',home:100,draw:100,away:100,homeProb:33.3,drawProb:33.3,awayProb:33.3,sources:3},
    {at:'not-a-date',home:2,draw:3.5,away:4,sources:3},
  ];
  const safe=sanitizeOddsSnapshotsForMovement(rows);
  assert.equal(safe.length,1);
  assert.notEqual(safe[0].homeProb,99);
  assert.ok(Math.abs(safe[0].homeProb+safe[0].drawProb+safe[0].awayProb-100)<=0.2);
});

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC143 gates prematch and live odds before snapshots, movement and model blending', () => {
  assert.match(worker,/assessOddsMarketQuality\(market, \{ oddsMeta:analysisFeatureMeta\.odds \|\| \{\}, mode:'upcoming' \}\)/);
  assert.match(worker,/analysisFeatureMeta\.odds = annotateOddsReliability/);
  assert.match(worker,/const analysisMarket = oddsMarketForTrustedAnalytics\(market, oddsQuality\)/);
  assert.match(worker,/blendProbabilitySignals\(\{ market:analysisMarket/);
  assert.match(worker,/liveOdds = oddsMarketForTrustedAnalytics\(liveOdds, liveOddsQuality\)/);
  assert.match(worker,/sanitizeOddsSnapshotsForMovement\(snapshots\)/);
  assert.match(worker,/if \(liveOdds\) \{[\s\S]*saveOddsSnapshot/);
});

test('RC143 exposes odds quality through Match Center, analysis and production health contracts', () => {
  assert.match(worker,/match-center:\$\{fixtureId\}:v15-odds-quality-rc143/);
  assert.match(worker,/fixture:\$\{fixtureId\}:v14-odds-quality-rc143/);
  assert.match(worker,/analysisVersion: '4\.14\.0-odds-quality'/);
  assert.match(worker,/liveOddsQuality,/);
  assert.match(worker,/oddsQuality,/);
  assert.match(worker,/oddsSemanticQualityGuard: 'enabled'/);
  assert.match(app,/function oddsQualityHintHtml/);
  assert.match(app,/oddsQualityHintHtml\(d\.liveOddsQuality\)/);
  assert.match(app,/oddsQualityHintHtml\(d\.oddsQuality\)/);
  assert.match(smoke,/'oddsSemanticQualityGuard'/);
});
