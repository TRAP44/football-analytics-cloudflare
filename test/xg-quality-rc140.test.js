import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assessExpectedGoalsQuality,
  inspectExpectedGoalsValue,
  sanitizeExpectedGoalsForDisplay,
  statisticsForTrustedExpectedGoals,
} from '../src/xg-quality.js';

const trustedMeta = {
  provider:'api-football',
  source:'network',
  state:'available',
  available:true,
  usable:true,
  stale:false,
  confidenceBearing:true,
  freshnessState:'fresh',
  provenanceState:'verified',
};

function stats(home, away) {
  return {
    items:[
      { key:'expected_goals', label:'xG', home, away },
      { key:'Shots on Goal', label:'В створ', home:4, away:2 },
    ],
  };
}

test('RC140 accepts a complete finite provider xG pair from a trusted statistics source', () => {
  const quality = assessExpectedGoalsQuality(stats('1.42', '0,87'), { statisticsMeta:trustedMeta, mode:'live' });
  assert.equal(quality.state, 'verified');
  assert.equal(quality.confidenceBearing, true);
  assert.equal(quality.home.value, 1.42);
  assert.equal(quality.away.value, 0.87);
  assert.equal(quality.validSides, 2);
});

test('RC140 keeps one-sided xG observable but excludes it from comparative analytics', () => {
  const quality = assessExpectedGoalsQuality(stats('1.10', null), { statisticsMeta:trustedMeta, mode:'live' });
  assert.equal(quality.state, 'partial');
  assert.equal(quality.confidenceBearing, false);
  const display = sanitizeExpectedGoalsForDisplay(stats('1.10', null), quality);
  assert.equal(display.items.find(row => row.key === 'expected_goals')?.home, 1.1);
  const analytical = statisticsForTrustedExpectedGoals(display, quality);
  assert.equal(analytical.items.some(row => row.key === 'expected_goals'), false);
  assert.equal(analytical.items.some(row => row.key === 'Shots on Goal'), true);
});

test('RC140 rejects malformed or implausible xG without suppressing unrelated statistics', () => {
  assert.equal(inspectExpectedGoalsValue('12%').valid, false);
  assert.equal(inspectExpectedGoalsValue(22).reason, 'out_of_range');
  const quality = assessExpectedGoalsQuality(stats('12%', 0.4), { statisticsMeta:trustedMeta });
  assert.equal(quality.state, 'invalid');
  assert.equal(quality.confidenceBearing, false);
  const display = sanitizeExpectedGoalsForDisplay(stats('12%', 0.4), quality);
  const row = display.items.find(item => item.key === 'expected_goals');
  assert.equal(row?.home, null);
  assert.equal(row?.away, 0.4);
});

test('RC140 rejects structurally valid xG from stale or unverified statistics', () => {
  const stale = assessExpectedGoalsQuality(stats(1.2, 0.8), {
    statisticsMeta:{ ...trustedMeta, stale:true, confidenceBearing:false, freshnessState:'stale' },
  });
  assert.equal(stale.state, 'source_untrusted');
  assert.equal(stale.confidenceBearing, false);

  const unknown = assessExpectedGoalsQuality(stats(1.2, 0.8), {
    statisticsMeta:{ ...trustedMeta, provenanceState:'unknown' },
  });
  assert.equal(unknown.state, 'source_untrusted');
  assert.equal(unknown.confidenceBearing, false);
});

const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');

test('RC140 routes xG through the semantic guard before live AI and post-match evidence', () => {
  assert.match(worker, /assessExpectedGoalsQuality\(formattedStatistics/);
  assert.match(worker, /statisticsForTrustedExpectedGoals\(publicStatistics, xgQuality\)/);
  assert.match(worker, /statistics: analyticalStatistics,[\s\S]{0,260}buildSmartMatchInsights/);
  assert.match(worker, /statistics: analyticalStatistics,[\s\S]{0,260}buildLiveAiCoach/);
  assert.match(worker, /buildPostMatchReview\(\{prediction:postMatchPrediction,fixture,statistics:analyticalStatistics/);
  assert.match(worker, /xgQuality,/);
  assert.match(worker, /xgSemanticQualityGuard: 'enabled'/);
});

test('RC140 exposes xG quality in Match Center and production health contracts', () => {
  assert.match(worker, /match-center:\$\{fixtureId\}:v12-xg-quality-rc140/);
  assert.match(worker, /const APP_VERSION = '6\.116\.0-rc140'/);
  assert.match(worker, /const RC_NAME = 'RC140'/);
  assert.match(app, /const CLIENT_VERSION = '6\.116\.0-rc140'/);
  assert.match(app, /xgQualityHintHtml/);
  assert.match(app, /\['xG', d\.availability\?\.xg\]/);
  assert.match(smoke, /'xgSemanticQualityGuard'/);
});
