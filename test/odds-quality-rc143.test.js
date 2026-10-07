import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  annotateOddsReliability,
  assessOddsMarketQuality,
  inspectDecimalOdd,
  oddsMarketForTrustedAnalytics,
  probabilitiesFromDecimalOdds,
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

test('RC143 rejects malformed, coercible, out-of-range and economically impossible odds triples', () => {
  assert.equal(inspectDecimalOdd(true).reason,'invalid_type');
  assert.equal(inspectDecimalOdd([2]).reason,'invalid_type');
  assert.equal(inspectDecimalOdd({toString:()=> '2'}).reason,'invalid_type');
  assert.equal(inspectDecimalOdd('abc').reason,'invalid_format');
  assert.equal(inspectDecimalOdd(1).reason,'out_of_range');
  const market={odds:{home:100,draw:100,away:100},sources:2,provider:'api-football'};
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.state,'invalid');
  assert.equal(quality.marketValid,false);
  assert.ok(quality.issues.some(x=>x.code==='implied_total_out_of_range'));
  assert.equal(oddsMarketForTrustedAnalytics(market,quality),null);
});

test('RC143 exported probability derivation rejects coercible or impossible odds', () => {
  assert.equal(probabilitiesFromDecimalOdds({home:true,draw:3.5,away:4}),null);
  assert.equal(probabilitiesFromDecimalOdds({home:[2],draw:3.5,away:4}),null);
  assert.equal(probabilitiesFromDecimalOdds({home:{toString:()=> '2'},draw:3.5,away:4}),null);
  assert.equal(probabilitiesFromDecimalOdds({home:100,draw:100,away:100}),null);
  const probabilities=probabilitiesFromDecimalOdds({home:'2.0',draw:'3.5',away:'4'});
  assert.ok(probabilities);
  assert.ok(Math.abs(probabilities.home+probabilities.draw+probabilities.away-100)<=0.2);
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

test('RC143 rejects coercible freshness/provenance states instead of trusting stringified metadata', () => {
  const market={odds:{home:2,draw:3.5,away:4},sources:2,provider:'api-football'};

  const arrayFreshness=assessOddsMarketQuality(market,{
    oddsMeta:{...trustedMeta,freshnessState:['fresh']},
  });
  assert.equal(arrayFreshness.sourceTrusted,false);
  assert.equal(arrayFreshness.confidenceBearing,false);
  assert.equal(arrayFreshness.state,'source_untrusted');

  const objectProvenance=assessOddsMarketQuality(market,{
    oddsMeta:{...trustedMeta,provenanceState:{toString:()=> 'verified'}},
  });
  assert.equal(objectProvenance.sourceTrusted,false);
  assert.equal(objectProvenance.confidenceBearing,false);
  assert.equal(objectProvenance.state,'source_untrusted');
});

test('RC143 rejects markets without a positive bounded source count', () => {
  const market={odds:{home:2,draw:3.5,away:4},sources:0,provider:'api-football'};
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.equal(quality.marketValid,false);
  assert.ok(quality.issues.some(x=>x.code==='source_count_invalid'));
});

test('RC143 rejects coerced source counts and conflicting source metadata', () => {
  const base={odds:{home:2,draw:3.5,away:4},provider:'api-football'};

  const coerced=assessOddsMarketQuality({...base,sources:true},{oddsMeta:trustedMeta});
  assert.equal(coerced.marketValid,false);
  assert.ok(coerced.issues.some(issue=>issue.code==='source_count_invalid'));

  const conflict=assessOddsMarketQuality({...base,sources:3,bookmakers:4},{oddsMeta:trustedMeta});
  assert.equal(conflict.marketValid,false);
  assert.ok(conflict.issues.some(issue=>issue.code==='source_count_mismatch'));

  const numericString=assessOddsMarketQuality({...base,sources:'3'},{oddsMeta:trustedMeta});
  assert.equal(numericString.marketValid,true);
  assert.equal(numericString.sourceCount,3);
});

test('RC143 trusted-market projection requires strict quality booleans', () => {
  const market={odds:{home:2,draw:3.5,away:4},sources:2,provider:'api-football'};
  const quality=assessOddsMarketQuality(market,{oddsMeta:trustedMeta});
  assert.ok(oddsMarketForTrustedAnalytics(market,quality));
  assert.equal(oddsMarketForTrustedAnalytics(market,{...quality,confidenceBearing:'true'}),null);
  assert.equal(oddsMarketForTrustedAnalytics(market,{...quality,marketValid:1}),null);
});

test('RC143 reliability annotation requires strict quality booleans', () => {
  const base={
    state:'verified',
    observed:true,
    sourceTrusted:true,
    marketValid:true,
  };
  const forged=annotateOddsReliability(trustedMeta,{...base,sourceTrusted:'true'});
  assert.equal(forged.available,false);
  assert.equal(forged.confidenceBearing,false);

  const forgedObserved=annotateOddsReliability(trustedMeta,{...base,observed:'true'});
  assert.equal(forgedObserved.available,false);
  assert.equal(forgedObserved.confidenceBearing,false);

  const forgedMarket=annotateOddsReliability(trustedMeta,{...base,marketValid:'true'});
  assert.equal(forgedMarket.available,false);
  assert.equal(forgedMarket.confidenceBearing,false);
});

test('RC143 filters malformed historical snapshots and recomputes movement probabilities from odds', () => {
  const rows=[
    {at:'2026-09-25T12:00:00Z',home:2,draw:3.5,away:4,homeProb:99,drawProb:0.5,awayProb:0.5,sources:3},
    {at:'2026-09-25T12:00:00.000Z',home:2.1,draw:3.4,away:3.9,sources:3},
    {at:'2026-09-25T12:01:00Z',home:100,draw:100,away:100,homeProb:33.3,drawProb:33.3,awayProb:33.3,sources:3},
    {at:'2026-09-25T12:01:30Z',home:2,draw:3.5,away:4,sources:true},
    {at:'2026-09-25T12:01:45Z',home:2,draw:3.5,away:4,sources:0},
    {at:'not-a-date',home:2,draw:3.5,away:4,sources:3},
    {at:new Date('2026-09-25T12:02:00Z'),home:2,draw:3.5,away:4,sources:3},
  ];
  const safe=sanitizeOddsSnapshotsForMovement(rows);
  assert.equal(safe.length,1);
  assert.equal(safe[0].at,'2026-09-25T12:00:00.000Z');
  assert.notEqual(safe[0].homeProb,99);
  assert.ok(Math.abs(safe[0].homeProb+safe[0].drawProb+safe[0].awayProb-100)<=0.2);
});

const worker = fs.readFileSync('src/worker.js', 'utf8')
  + '\n' + fs.readFileSync('src/analysis-runtime.js', 'utf8')
  + '\n' + fs.readFileSync('src/match-center-runtime.js', 'utf8')
  + '\n' + fs.readFileSync('src/odds-snapshot-runtime.js', 'utf8');
const app=fs.readFileSync('public/app.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC143 gates prematch and live odds before snapshots, movement and model blending', () => {
  assert.match(worker,/assessOddsMarketQuality\(market,\{[\s\S]{0,180}?oddsMeta:objectValue\(analysisFeatureMeta\.odds\) \|\| \{\},[\s\S]{0,120}?mode:'upcoming'/);
  assert.match(worker,/analysisFeatureMeta\.odds=objectValue\(annotateOddsReliability/);
  assert.match(worker,/analysisMarket=objectValue\(oddsMarketForTrustedAnalytics\(market,oddsQuality\)\)/);
  assert.match(worker,/blendProbabilitySignals\(\{[\s\S]{0,120}?market:analysisMarket/);
  assert.match(worker,/oddsMarketForTrustedAnalytics\(liveOdds,liveOddsQuality\)/);
  assert.match(worker,/sanitizeOddsSnapshotsForMovement\(snapshots\)/);
  assert.match(worker,/if \(liveOdds\) \{[\s\S]{0,500}?saveOddsSnapshot/);
});

test('RC143 exposes odds quality through Match Center, analysis and production health contracts', () => {
  assert.match(worker,/match-center:\$\{fixtureId\}:v16-availability-quality-rc144/);
  assert.match(worker,/fixture:\$\{fixtureId\}:v15-availability-quality-rc144/);
  assert.match(worker,/analysisVersion:\s*'4\.15\.0-availability-quality'/);
  assert.match(worker,/liveOddsQuality,/);
  assert.match(worker,/oddsQuality,/);
  assert.match(worker,/liveOdds:liveOddsTrusted/);
  assert.match(app,/function oddsQualityHintHtml/);
  assert.match(app,/oddsQualityHintHtml\(d\.liveOddsQuality\)/);
  assert.match(app,/oddsQualityHintHtml\(d\.oddsQuality\)/);
  assert.match(smoke,/'oddsSemanticQualityGuard'/);
});
