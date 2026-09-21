import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrationProfileFingerprint,
  evaluatePostPromotionRollback,
  evaluatePromotionWindows,
  splitRollingValidation,
} from '../src/calibration-lifecycle.js';

const passingWindow = (from, to) => ({
  sample: 20,
  from,
  to,
  baselineBrier: 0.205,
  candidateBrier: 0.202,
  baselineLogLoss: 0.91,
  candidateLogLoss: 0.90,
});

test('fingerprint depends on production parameters, not object key order', async () => {
  const a = await calibrationProfileFingerprint({ version: '3.9', temperature: 1.1, temperatureActive: true, weightsActive: true, signalWeights: { market: 0.5, form: 0.5 } });
  const b = await calibrationProfileFingerprint({ signalWeights: { form: 0.5, market: 0.5 }, weightsActive: true, temperatureActive: true, temperature: 1.1, version: '3.9' });
  assert.equal(a, b);
});

test('promotion requires two passing non-overlapping windows', () => {
  const result = evaluatePromotionWindows([
    passingWindow('2026-01-01', '2026-01-20'),
    passingWindow('2026-01-21', '2026-02-09'),
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.status, 'eligible');
});

test('promotion is held when the newest window regresses log loss', () => {
  const result = evaluatePromotionWindows([
    passingWindow('2026-01-01', '2026-01-20'),
    { ...passingWindow('2026-01-21', '2026-02-09'), candidateLogLoss: 0.93 },
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.status, 'held');
});

test('post-promotion guard rolls back material regression', () => {
  const result = evaluatePostPromotionRollback({
    sample: 24,
    activeBrier: 0.214,
    championBrier: 0.210,
    activeLogLoss: 0.94,
    championLogLoss: 0.92,
  });
  assert.equal(result.rollback, true);
});

test('post-promotion guard waits for enough trusted rows', () => {
  const result = evaluatePostPromotionRollback({
    sample: 12,
    activeBrier: 0.25,
    championBrier: 0.20,
    activeLogLoss: 1.1,
    championLogLoss: 0.9,
  });
  assert.equal(result.rollback, false);
  assert.equal(result.enoughData, false);
});

test('rolling split creates train plus two chronological windows', () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ kickoff_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), id: index }));
  const split = splitRollingValidation(rows);
  assert.equal(split.ready, true);
  assert.equal(split.train.length, 40);
  assert.equal(split.windows[0].length, 20);
  assert.equal(split.windows[1].length, 20);
  assert.ok(Date.parse(split.windows[0][19].kickoff_at) < Date.parse(split.windows[1][0].kickoff_at));
});
