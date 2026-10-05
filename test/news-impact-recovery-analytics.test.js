import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsImpactRecoveryAnalytics } from '../src/news-impact-recovery-analytics.js';

function makeAnalytics() {
  return createNewsImpactRecoveryAnalytics({
    NEWS_IMPACT_RECOVERY_DRIFT_PRIOR_MIN_ATTEMPTS: 20,
    NEWS_IMPACT_RECOVERY_DRIFT_RECENT_MIN_ATTEMPTS: 10,
    NEWS_IMPACT_RECOVERY_DRIFT_DROP_PCT_POINTS: 12,
  });
}

test('adaptive recovery is blocked when recent effectiveness materially drifts', () => {
  const { newsImpactRecoveryDriftDecision } = makeAnalytics();
  const decision = {
    reason: 'provider_unavailable',
    action: 'full_ai',
    fixedRecovery: 'retry_later',
    fixedRecoveryLabel: 'Повторить позже',
    fixedAttempts: 80,
    fixedSuccessPct: 58,
    fixedConfidence: { lowerPct: 50, upperPct: 65 },
    selectedRecovery: 'open_full_ai',
    selectedRecoveryLabel: 'Открыть полный AI',
    selectedAttempts: 100,
    selectedSuccessPct: 84,
    selectedConfidence: { lowerPct: 78, upperPct: 89 },
    strategy: 'adaptive',
    guardReason: 'significant_better',
  };

  const result = newsImpactRecoveryDriftDecision(
    decision,
    [{
      reason: 'provider_unavailable',
      action: 'full_ai',
      recovery: 'open_full_ai',
      attempts: 80,
      successPct: 86,
      confidence: { lowerPct: 80, upperPct: 91 },
    }],
    [{
      reason: 'provider_unavailable',
      action: 'full_ai',
      recovery: 'open_full_ai',
      attempts: 20,
      successPct: 60,
      confidence: { lowerPct: 51, upperPct: 69 },
    }],
  );

  assert.equal(result.strategy, 'fixed');
  assert.equal(result.selectedRecovery, 'retry_later');
  assert.equal(result.guardReason, 'performance_drift');
  assert.equal(result.driftDetected, true);
  assert.equal(result.driftStatus, 'blocked');
  assert.equal(result.driftDropPctPoints, 26);
});

test('adaptive recovery remains selected when recent evidence is stable', () => {
  const { newsImpactRecoveryDriftDecision } = makeAnalytics();
  const decision = {
    reason: 'timeout',
    action: 'full_ai',
    fixedRecovery: 'retry_soon',
    fixedRecoveryLabel: 'Повторить',
    fixedAttempts: 60,
    fixedSuccessPct: 62,
    fixedConfidence: { lowerPct: 54, upperPct: 69 },
    selectedRecovery: 'open_full_ai',
    selectedRecoveryLabel: 'Открыть полный AI',
    selectedAttempts: 90,
    selectedSuccessPct: 82,
    selectedConfidence: { lowerPct: 75, upperPct: 88 },
    strategy: 'adaptive',
    guardReason: 'significant_better',
  };

  const result = newsImpactRecoveryDriftDecision(
    decision,
    [{
      reason: 'timeout',
      action: 'full_ai',
      recovery: 'open_full_ai',
      attempts: 70,
      successPct: 83,
      confidence: { lowerPct: 76, upperPct: 89 },
    }],
    [{
      reason: 'timeout',
      action: 'full_ai',
      recovery: 'open_full_ai',
      attempts: 20,
      successPct: 80,
      confidence: { lowerPct: 73, upperPct: 87 },
    }],
  );

  assert.equal(result.strategy, 'adaptive');
  assert.equal(result.selectedRecovery, 'open_full_ai');
  assert.equal(result.driftDetected, false);
  assert.equal(result.driftStatus, 'stable');
  assert.equal(result.driftDropPctPoints, 3);
});
