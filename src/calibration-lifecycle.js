export const CALIBRATION_LIFECYCLE_RULES = Object.freeze({
  minTrustedSample: 80,
  minTrainSample: 40,
  minWindowSample: 20,
  minBrierGain: 0.001,
  minPostPromotionSample: 20,
  rollbackBrierTolerance: 0.002,
  rollbackLogLossTolerance: 0.01,
});

function finiteOrNull(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 1e8) / 1e8;
  return value;
}

export function calibrationFingerprintPayload(profile = {}) {
  return canonical({
    algorithm: String(profile.version || ''),
    temperature: finiteOrNull(profile.temperature) ?? 1,
    temperatureActive: Boolean(profile.temperatureActive),
    signalWeights: profile.signalWeights || {},
    weightsActive: Boolean(profile.weightsActive),
  });
}

export async function calibrationProfileFingerprint(profile = {}) {
  const input = JSON.stringify(calibrationFingerprintPayload(profile));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function evaluatePromotionWindows(windows = [], rules = CALIBRATION_LIFECYCLE_RULES) {
  const normalized = (windows || []).map((window, index) => {
    const baselineBrier = finiteOrNull(window?.baselineBrier);
    const candidateBrier = finiteOrNull(window?.candidateBrier);
    const baselineLogLoss = finiteOrNull(window?.baselineLogLoss);
    const candidateLogLoss = finiteOrNull(window?.candidateLogLoss);
    const brierGain = baselineBrier !== null && candidateBrier !== null ? baselineBrier - candidateBrier : null;
    const logLossGain = baselineLogLoss !== null && candidateLogLoss !== null ? baselineLogLoss - candidateLogLoss : null;
    const sample = Math.max(0, Number(window?.sample || 0));
    const pass = sample >= Number(rules.minWindowSample || 20)
      && brierGain !== null && brierGain >= Number(rules.minBrierGain || 0.001)
      && logLossGain !== null && logLossGain >= 0;
    return {
      index: index + 1,
      sample,
      from: window?.from || null,
      to: window?.to || null,
      baselineBrier,
      candidateBrier,
      baselineLogLoss,
      candidateLogLoss,
      brierGain,
      logLossGain,
      pass,
    };
  });
  const requiredWindows = 2;
  const pass = normalized.length >= requiredWindows && normalized.slice(-requiredWindows).every(window => window.pass);
  return {
    pass,
    status: pass ? 'eligible' : normalized.length >= requiredWindows ? 'held' : 'shadow',
    windows: normalized,
    reason: pass
      ? 'Два последовательных trusted holdout-окна подтвердили улучшение Brier без ухудшения log loss.'
      : normalized.length < requiredWindows
        ? 'Нужно два последовательных trusted holdout-окна.'
        : 'Хотя бы одно holdout-окно не подтвердило безопасное улучшение.',
  };
}

export function evaluatePostPromotionRollback(metrics = {}, rules = CALIBRATION_LIFECYCLE_RULES) {
  const sample = Math.max(0, Number(metrics.sample || 0));
  const activeBrier = finiteOrNull(metrics.activeBrier);
  const championBrier = finiteOrNull(metrics.championBrier);
  const activeLogLoss = finiteOrNull(metrics.activeLogLoss);
  const championLogLoss = finiteOrNull(metrics.championLogLoss);
  const brierRegression = activeBrier !== null && championBrier !== null ? activeBrier - championBrier : null;
  const logLossRegression = activeLogLoss !== null && championLogLoss !== null ? activeLogLoss - championLogLoss : null;
  const enoughData = sample >= Number(rules.minPostPromotionSample || 20);
  const rollback = enoughData && (
    (brierRegression !== null && brierRegression > Number(rules.rollbackBrierTolerance || 0.002))
    || (logLossRegression !== null && logLossRegression > Number(rules.rollbackLogLossTolerance || 0.01))
  );
  return {
    sample,
    enoughData,
    rollback,
    activeBrier,
    championBrier,
    activeLogLoss,
    championLogLoss,
    brierRegression,
    logLossRegression,
    reason: rollback
      ? 'Post-promotion когорта ухудшила контрольные метрики сверх допуска.'
      : enoughData
        ? 'Post-promotion метрики находятся в допустимых пределах.'
        : 'Post-promotion выборка ещё недостаточна для решения об откате.',
  };
}

export function splitRollingValidation(rows = [], rules = CALIBRATION_LIFECYCLE_RULES) {
  const sorted = [...(rows || [])].sort((a, b) => Date.parse(a?.kickoff_at || 0) - Date.parse(b?.kickoff_at || 0));
  const windowSize = Math.max(Number(rules.minWindowSample || 20), Math.floor(sorted.length * 0.2));
  const cappedWindow = Math.min(50, windowSize);
  const validationTotal = cappedWindow * 2;
  if (sorted.length < Number(rules.minTrustedSample || 80) || sorted.length - validationTotal < Number(rules.minTrainSample || 40)) {
    return { train: [], windows: [], ready: false, sample: sorted.length };
  }
  const train = sorted.slice(0, sorted.length - validationTotal);
  const first = sorted.slice(sorted.length - validationTotal, sorted.length - cappedWindow);
  const second = sorted.slice(sorted.length - cappedWindow);
  return { train, windows: [first, second], ready: true, sample: sorted.length };
}
