import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  annotateStatisticsReliability,
  assessMatchStatisticsQuality,
  inspectStatisticValue,
  sanitizeStatisticsForDisplay,
  statisticsForTrustedAnalytics,
} from '../src/statistics-quality.js';

const trustedMeta = {
  provider:'api-football', source:'network', state:'available', available:true, usable:true,
  observed:true, stale:false, confidenceBearing:true, freshnessState:'fresh', provenanceState:'verified',
};

function stats(items) {
  return {
    home:{ values:Object.fromEntries(items.map(row => [row.key,row.home])) },
    away:{ values:Object.fromEntries(items.map(row => [row.key,row.away])) },
    items:items.map(row => ({ label:row.key, ...row })),
  };
}

test('RC142 accepts trusted internally consistent comparative statistics', () => {
  const input=stats([
    {key:'Total Shots',home:12,away:9},
    {key:'Shots on Goal',home:5,away:3},
    {key:'Ball Possession',home:'54%',away:'46%'},
    {key:'Total passes',home:510,away:420},
    {key:'Passes accurate',home:438,away:348},
    {key:'Passes %',home:'86%',away:'83%'},
  ]);
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:trustedMeta,mode:'live'});
  assert.equal(quality.state,'verified');
  assert.equal(quality.invalidCellCount,0);
  assert.equal(quality.confidenceBearing,true);
  assert.equal(statisticsForTrustedAnalytics(input,quality).items.length,6);
});

test('RC142 rejects malformed, fractional and out-of-range guarded values', () => {
  assert.equal(inspectStatisticValue('Total Shots',-1).valid,false);
  assert.equal(inspectStatisticValue('Total Shots','2.5').reason,'non_integer_count');
  assert.equal(inspectStatisticValue('Ball Possession','105%').reason,'out_of_range');
  const input=stats([
    {key:'Total Shots',home:'oops',away:9},
    {key:'Ball Possession',home:'110%',away:'46%'},
  ]);
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:trustedMeta});
  assert.equal(quality.state,'sanitized');
  const display=sanitizeStatisticsForDisplay(input,quality);
  assert.equal(display.items.find(row=>row.key==='Total Shots')?.home,null);
  assert.equal(display.items.find(row=>row.key==='Ball Possession')?.home,null);
  assert.equal(statisticsForTrustedAnalytics(display,quality).items.length,0);
});

test('RC142 removes semantic contradictions before pressure and smart analytics', () => {
  const input=stats([
    {key:'Total Shots',home:8,away:10},
    {key:'Shots on Goal',home:11,away:4},
    {key:'Ball Possession',home:'70%',away:'60%'},
    {key:'Total passes',home:400,away:500},
    {key:'Passes accurate',home:450,away:410},
    {key:'Passes %',home:'90%',away:'82%'},
  ]);
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:trustedMeta});
  assert.equal(quality.state,'sanitized');
  assert.ok(quality.issues.some(x=>x.code==='component_exceeds_total' && x.side==='home'));
  assert.ok(quality.issues.some(x=>x.code==='accurate_passes_exceed_total' && x.side==='home'));
  assert.ok(quality.issues.some(x=>x.code==='possession_pair_mismatch'));
  const display=sanitizeStatisticsForDisplay(input,quality);
  assert.equal(display.items.find(row=>row.key==='Shots on Goal')?.home,null);
  assert.equal(display.items.find(row=>row.key==='Passes accurate')?.home,null);
  assert.equal(display.items.some(row=>row.key==='Ball Possession'),false);
  const analytical=statisticsForTrustedAnalytics(display,quality);
  assert.equal(analytical.items.some(row=>row.key==='Shots on Goal'),false);
  assert.equal(analytical.items.some(row=>row.key==='Ball Possession'),false);
});

test('RC142 keeps one-sided values visible but excludes incomplete pairs from comparative analytics', () => {
  const input=stats([
    {key:'Total Shots',home:7,away:null},
    {key:'Corner Kicks',home:3,away:4},
  ]);
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:trustedMeta});
  assert.equal(quality.state,'sanitized');
  assert.equal(quality.partialPairCount,1);
  const display=sanitizeStatisticsForDisplay(input,quality);
  assert.equal(display.items.find(row=>row.key==='Total Shots')?.home,7);
  const analytical=statisticsForTrustedAnalytics(display,quality);
  assert.equal(analytical.items.some(row=>row.key==='Total Shots'),false);
  assert.equal(analytical.items.some(row=>row.key==='Corner Kicks'),true);
});

test('RC142 fails closed when freshness/provenance is untrusted', () => {
  const input=stats([{key:'Total Shots',home:7,away:8}]);
  const meta={...trustedMeta,stale:true,confidenceBearing:false,freshnessState:'stale'};
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:meta});
  assert.equal(quality.state,'source_untrusted');
  assert.equal(sanitizeStatisticsForDisplay(input,quality).items.length,0);
  assert.equal(statisticsForTrustedAnalytics(input,quality).items.length,0);
  const annotated=annotateStatisticsReliability(meta,quality);
  assert.equal(annotated.available,false);
  assert.equal(annotated.confidenceBearing,false);
});

test('RC142 leaves xG for the dedicated RC140 xG guard', () => {
  const input=stats([
    {key:'expected_goals',home:'1.20',away:'0.80'},
    {key:'Total Shots',home:8,away:7},
  ]);
  const quality=assessMatchStatisticsQuality(input,{statisticsMeta:trustedMeta});
  assert.equal(quality.state,'verified');
  const display=sanitizeStatisticsForDisplay(input,quality);
  const analytical=statisticsForTrustedAnalytics(display,quality);
  assert.ok(analytical.items.some(row=>row.key==='expected_goals'));
});

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC142 routes sanitized statistics into comparative live analytics', () => {
  assert.match(worker,/assessMatchStatisticsQuality\(rawFormattedStatistics/);
  assert.match(worker,/sanitizeStatisticsForDisplay\(rawFormattedStatistics, statisticsQuality\)/);
  assert.match(worker,/statisticsForTrustedAnalytics\(publicStatistics, statisticsQuality\)/);
  assert.match(worker,/livePressure\(analyticalStatistics\)/);
  assert.match(worker,/statistics: analyticalStatistics/);
  assert.match(worker,/statisticsQuality,/);
  assert.match(worker,/statisticsSemanticQualityGuard: 'enabled'/);
});

test('RC142 exposes statistics quality in Match Center and release health contracts', () => {
  assert.match(worker,/match-center:\$\{fixtureId\}:v14-statistics-quality-rc142/);
  assert.match(app,/function statisticsQualityHintHtml/);
  assert.match(app,/statisticsQualityHintHtml\(d\.statisticsQuality\)/);
  assert.match(smoke,/'statisticsSemanticQualityGuard'/);
});
