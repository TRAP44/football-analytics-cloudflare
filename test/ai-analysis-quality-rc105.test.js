import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC105 confidence uses weighted signal coverage instead of raw source count',()=>{
  assert.match(worker,/function signalCanonicalCoverage\(/);
  assert.match(worker,/MODEL_BASE_WEIGHTS/);
  assert.match(worker,/function signalLeaderAgreement\(/);
  assert.match(worker,/function probabilityLeaderMargin\(/);
  assert.match(worker,/weightedCoveragePct/);
  assert.match(worker,/leaderAgreementPct/);
  assert.match(worker,/leaderMarginPctPoints/);
  assert.doesNotMatch(worker,/const coverage = clamp\(\(signals\?\.length \|\| 0\) \/ 4/);
});

test('RC105 goal totals and BTTS expose sample quality',()=>{
  assert.match(worker,/qualityScore/);
  assert.match(worker,/qualityLabel: qualityScore >= 80/);
  assert.match(worker,/sample: \{ overall: overallSample, venue: venueSample \}/);
  assert.match(worker,/goalModel\?\.qualityScore \|\| 0\) >= 65/);
});

test('RC105 quality gate fails closed on weak analysis evidence',()=>{
  assert.match(worker,/function analysisQualityGate\(/);
  assert.match(worker,/code:'signal_count'/);
  assert.match(worker,/code:'confidence'/);
  assert.match(worker,/code:'data_trust'/);
  assert.match(worker,/code:'disagreement'/);
  assert.match(worker,/code:'leader_agreement'/);
  assert.match(worker,/code:'thin_margin'/);
  assert.match(worker,/code:'lineups_final_window'/);
  assert.match(worker,/code:'provider_degraded'/);
  assert.match(worker,/allowSignal: state === 'ready' \|\| state === 'caution'/);
});

test('RC105 instructor cannot emit a working signal after quality gate hold',()=>{
  assert.match(worker,/const qualityGate = analysisQualityGate\(/);
  assert.match(worker,/if \(!qualityGate\.allowSignal && betSignal\.code !== 'skip'\)/);
  assert.match(worker,/Качество входных данных не прошло рабочий gate/);
  assert.match(worker,/qualityGate, matchPlan/);
});

test('RC105 final-window lineups are a hard hold',()=>{
  assert.match(worker,/nearKickoff && !lineupsConfirmed/);
  assert.match(worker,/До старта осталось мало времени, но оба стартовых состава ещё не подтверждены/);
});

test('RC105 exposes a deterministic quality-gate self-test and health contract',()=>{
  assert.match(worker,/function analysisQualityGateSelfTest\(/);
  assert.match(worker,/ready\.state === 'ready'/);
  assert.match(worker,/hold\.state === 'hold'/);
  assert.match(worker,/aiAnalysisQualityGate: 'enabled'/);
  assert.match(worker,/aiAnalysisQualityGateSelfTest: analysisQualityGateSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(worker,/releaseCheck\('ai_analysis_quality_gate_selftest'/);
});

test('RC105 persists the quality-gate analysis version',()=>{
  assert.ok(worker.includes("analysisVersion: '4.10.0-role-hydration'"));
});


test('RC105 UI explains quality-gate and goal-sample quality',()=>{
  assert.match(app,/Quality Gate/);
  assert.match(app,/qualityGate\.label/);
  assert.match(app,/gateReasons\[0\]\?\.text/);
  assert.match(app,/Качество выборки:/);
  assert.match(app,/goal\.qualityScore/);
});
