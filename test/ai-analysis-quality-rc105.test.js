import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createModelIntelligenceRuntime } from '../src/model-intelligence-runtime.js';
import { createAnalysisQualityRuntime } from '../src/analysis-quality-runtime.js';
import { createAnalysisContextRuntime } from '../src/analysis-context-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function normalizeThree(home, draw, away) {
  const total = Number(home) + Number(draw) + Number(away);
  if (!(total > 0)) return null;
  return {
    home: Number(home) / total * 100,
    draw: Number(draw) / total * 100,
    away: Number(away) / total * 100,
  };
}

const modelRuntime = createModelIntelligenceRuntime({
  MODEL_BASE_WEIGHTS: {
    market: 0.42,
    apiPrediction: 0.24,
    recentForm: 0.25,
    seasonStrength: 0.01,
    h2h: 0.08,
  },
  apiFootball: async () => [],
  getCache: async () => null,
  isFinishedStatus: () => true,
  normalizeThree,
  parsePercent: value => Number.parseFloat(String(value).replace('%', '')),
  round1: value => Math.round(Number(value) * 10) / 10,
  setCache: async () => true,
  todayUtc: () => '2026-10-06',
});

const qualityRuntime = createAnalysisQualityRuntime({
  absenceAdjustmentUnits: () => 0,
  assessMatchLineups: () => ({
    home: { confirmed: false },
    away: { confirmed: false },
    anyPublished: false,
    bothPublished: false,
    bothConfirmed: false,
    confirmedSides: 0,
    partialSides: 0,
  }),
  probabilityLeaderMargin: modelRuntime.probabilityLeaderMargin,
});

const contextRuntime = createAnalysisContextRuntime({
  analysisQualityGate: qualityRuntime.analysisQualityGate,
  freeQuotaHealthy: () => true,
  getCache: async () => null,
  getStaleCache: async () => null,
  marketMovementNote: () => '',
  refereeProfile: () => ({}),
  resolveTeamSeasonPlayers: async () => null,
  setCache: async () => true,
});

const analysisRuntimeSource = readRepoFile('src/analysis-runtime.js');
const analysisContextSource = readRepoFile('src/analysis-context-runtime.js');
const appCapabilitiesSource = readRepoFile('src/app-capabilities.js');
const adminOperationalApiSource = readRepoFile('src/admin-operational-api.js');
const appSource = readRepoFile('public/app.js');

test('RC105 confidence coverage is weighted by canonical signal families and ignores duplicates', () => {
  const probability = { home: 55, draw: 25, away: 20 };
  const marketOnly = [{ name: 'market', probabilities: probability, weight: 0.42 }];
  const duplicatedMarket = [
    ...marketOnly,
    { name: 'market', probabilities: probability, weight: 0.42 },
  ];
  const allSignals = [
    { name: 'market', probabilities: probability, weight: 0.42 },
    { name: 'apiPrediction', probabilities: probability, weight: 0.24 },
    { name: 'recentForm', probabilities: probability, weight: 0.25 },
    { name: 'seasonStrength', probabilities: probability, weight: 0.01 },
    { name: 'h2h', probabilities: probability, weight: 0.08 },
  ];

  assert.ok(Math.abs(modelRuntime.signalCanonicalCoverage(marketOnly) - 0.42) < 1e-12);
  assert.ok(Math.abs(modelRuntime.signalCanonicalCoverage(duplicatedMarket) - 0.42) < 1e-12);
  assert.ok(Math.abs(modelRuntime.signalCanonicalCoverage(allSignals) - 1) < 1e-12);

  const confidence = modelRuntime.confidenceModel(
    duplicatedMarket,
    probability,
    { overall: { sample: 5 } },
    { overall: { sample: 5 } },
  );
  assert.equal(confidence.signalCount, 2);
  assert.equal(confidence.diagnostics.weightedCoveragePct, 42);
  assert.equal(confidence.diagnostics.leaderAgreementPct, 100);
  assert.equal(confidence.diagnostics.leaderMarginPctPoints, 30);
});

test('RC105 goal model exposes deterministic sample quality', () => {
  const strong = modelRuntime.poissonGoalModel(
    {
      overall: { sample: 5, ppg: 2, gfAvg: 1.8, gaAvg: 0.8, gdAvg: 1 },
      venue: { sample: 3, ppg: 2.2, gfAvg: 2, gaAvg: 0.7, gdAvg: 1.3 },
    },
    {
      overall: { sample: 5, ppg: 1.4, gfAvg: 1.3, gaAvg: 1.4, gdAvg: -0.1 },
      venue: { sample: 3, ppg: 1.1, gfAvg: 1.1, gaAvg: 1.6, gdAvg: -0.5 },
    },
  );
  const overallOnly = modelRuntime.poissonGoalModel(
    {
      overall: { sample: 5, ppg: 2, gfAvg: 1.8, gaAvg: 0.8, gdAvg: 1 },
    },
    {
      overall: { sample: 5, ppg: 1.4, gfAvg: 1.3, gaAvg: 1.4, gdAvg: -0.1 },
    },
  );

  assert.equal(strong.qualityScore, 100);
  assert.equal(strong.qualityLabel, 'Высокая выборка');
  assert.deepEqual(strong.sample, { overall: 5, venue: 3 });

  assert.equal(overallOnly.qualityScore, 70);
  assert.equal(overallOnly.qualityLabel, 'Рабочая выборка');
  assert.deepEqual(overallOnly.sample, { overall: 5, venue: 0 });
});

test('RC105 quality gate fails closed on weak and malformed evidence', () => {
  const weak = qualityRuntime.analysisQualityGate({
    probabilities: { home: 41, draw: 31, away: 28 },
    confidence: {
      score: 52,
      signalCount: 1,
      disagreement: 16,
      agreement: 40,
    },
    dataTrustScore: 55,
    providerReliability: {
      state: 'degraded',
      trustCap: 60,
    },
    lineupImpact: {
      homeConfirmed: false,
      awayConfirmed: false,
    },
    minutesToKickoff: 10,
  });

  assert.equal(weak.state, 'hold');
  assert.equal(weak.allowSignal, false);
  assert.deepEqual(
    new Set(weak.reasons.map(reason => reason.code)),
    new Set([
      'signal_count',
      'confidence',
      'data_trust',
      'disagreement',
      'lineups_final_window',
      'provider_degraded',
    ]),
  );

  const malformed = qualityRuntime.analysisQualityGate({
    probabilities: { home: Infinity, draw: 0, away: 0 },
    confidence: {
      score: Infinity,
      signalCount: 99,
      disagreement: Number.NaN,
      agreement: 100,
    },
    dataTrustScore: Infinity,
    providerReliability: {
      state: 'healthy',
      trustCap: 100,
    },
    lineupImpact: {
      homeConfirmed: true,
      awayConfirmed: true,
    },
    minutesToKickoff: 120,
  });

  assert.equal(malformed.state, 'blocked');
  assert.equal(malformed.allowSignal, false);
  assert.ok(malformed.reasons.some(reason => reason.code === 'probabilities_invalid'));
});

test('RC105 final-window lineup hold is stricter than the earlier lineup caution window', () => {
  const base = {
    probabilities: { home: 55, draw: 25, away: 20 },
    confidence: {
      score: 75,
      signalCount: 3,
      disagreement: 5,
      agreement: 82,
    },
    dataTrustScore: 85,
    providerReliability: {
      state: 'healthy',
      trustCap: 100,
    },
    lineupImpact: {
      homeConfirmed: false,
      awayConfirmed: false,
    },
  };

  const ninetyMinutes = qualityRuntime.analysisQualityGate({
    ...base,
    minutesToKickoff: 60,
  });
  const finalWindow = qualityRuntime.analysisQualityGate({
    ...base,
    minutesToKickoff: 10,
  });

  assert.equal(ninetyMinutes.state, 'caution');
  assert.equal(ninetyMinutes.allowSignal, true);
  assert.ok(ninetyMinutes.reasons.some(reason => reason.code === 'lineups_pending'));

  assert.equal(finalWindow.state, 'hold');
  assert.equal(finalWindow.allowSignal, false);
  assert.ok(finalWindow.reasons.some(reason => reason.code === 'lineups_final_window'));
});

test('RC105 instructor cannot emit a working signal after quality gate hold', () => {
  const result = contextRuntime.buildAiInstructor({
    probabilities: { home: 60, draw: 25, away: 15 },
    goalModel: null,
    confidence: {
      score: 75,
      signalCount: 1,
      disagreement: 4,
      agreement: 90,
    },
    completeness: {
      score: 10,
      max: 10,
    },
    providerReliability: {
      state: 'healthy',
      trustCap: 100,
    },
    lineupImpact: {
      homeConfirmed: true,
      awayConfirmed: true,
    },
    minutesToKickoff: 120,
  });

  assert.equal(result.qualityGate.state, 'hold');
  assert.equal(result.qualityGate.allowSignal, false);
  assert.equal(result.betSignal.code, 'skip');
  assert.match(result.betSignal.reason, /как минимум два независимых модельных сигнала/);
});

test('RC105 goal-market signal requires working goal-sample quality', () => {
  const base = {
    probabilities: { home: 34, draw: 33, away: 33 },
    confidence: {
      score: 80,
      signalCount: 3,
      disagreement: 3,
      agreement: 80,
    },
    completeness: {
      score: 10,
      max: 10,
    },
    providerReliability: {
      state: 'healthy',
      trustCap: 100,
    },
    lineupImpact: {
      homeConfirmed: true,
      awayConfirmed: true,
    },
    minutesToKickoff: 120,
  };

  const weakSample = contextRuntime.buildAiInstructor({
    ...base,
    goalModel: {
      qualityScore: 64,
      over25: 80,
      btts: 78,
    },
  });
  const workingSample = contextRuntime.buildAiInstructor({
    ...base,
    goalModel: {
      qualityScore: 65,
      over25: 80,
      btts: 78,
    },
  });

  assert.equal(weakSample.betSignal.code, 'skip');
  assert.equal(workingSample.betSignal.code, 'over25');
});

test('RC105 deterministic quality-gate self-test remains release-blocking health evidence', () => {
  const selfTest = qualityRuntime.analysisQualityGateSelfTest();

  assert.equal(selfTest.pass, true);
  assert.equal(selfTest.ready, 'ready');
  assert.equal(selfTest.hold, 'hold');
  assert.equal(selfTest.malformed, 'blocked');
  for (const reason of [
    'signal_count',
    'confidence',
    'data_trust',
    'disagreement',
    'lineups_final_window',
    'provider_degraded',
  ]) {
    assert.ok(selfTest.holdReasons.includes(reason), reason);
  }

  assert.match(appCapabilitiesSource, /aiAnalysisQualityGate:\s*true/);
  assert.match(
    adminOperationalApiSource,
    /releaseCheck\('ai_analysis_quality_gate_selftest',[\s\S]*?aiQualityGateSelfTest\.pass \? 'pass' : 'fail'[\s\S]*?true\)/,
  );
});

test('RC105 analysis payload preserves the current starting-XI cohort version without hard-coding one release number', () => {
  const match = analysisRuntimeSource.match(/analysisVersion:\s*'([^']+)'/);
  assert.ok(match);
  assert.match(match[1], /^\d+\.\d+\.\d+-starting-xi$/);
});

test('RC105 UI exposes quality gate reason and goal-sample quality', () => {
  assert.match(appSource, /<span>Quality Gate<\/span>/);
  assert.match(appSource, /qualityGate\.label/);
  assert.match(appSource, /gateReasons\[0\]\?\.text/);
  assert.match(appSource, /Качество выборки:/);
  assert.match(appSource, /goal\.qualityLabel/);
  assert.match(appSource, /goal\.qualityScore/);

  assert.match(
    analysisContextSource,
    /if \(!qualityGate\.allowSignal && betSignal\.code\s*!==\s*'skip'\)/,
  );
  assert.match(analysisContextSource, /qualityGate,[\s\S]{0,120}?matchPlan,/);
});
