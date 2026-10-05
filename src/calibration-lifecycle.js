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

function nonNegativeFiniteOrNull(value) {
  const number = finiteOrNull(value);
  return number !== null && number >= 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveRule(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeRule(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function validWindowRange(from, to) {
  const fromMs = Date.parse(String(from || ''));
  const toMs = Date.parse(String(to || ''));
  return {
    valid: Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs <= toMs,
    fromMs,
    toMs,
  };
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
    temperatureActive: profile.temperatureActive === true,
    signalWeights: profile.signalWeights && typeof profile.signalWeights === 'object' && !Array.isArray(profile.signalWeights)
      ? profile.signalWeights
      : {},
    weightsActive: profile.weightsActive === true,
  });
}

export async function calibrationProfileFingerprint(profile = {}) {
  const input = JSON.stringify(calibrationFingerprintPayload(profile));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function evaluatePromotionWindows(windows = [], rules = CALIBRATION_LIFECYCLE_RULES) {
  const minWindowSample = Math.ceil(positiveRule(rules?.minWindowSample, CALIBRATION_LIFECYCLE_RULES.minWindowSample));
  const minBrierGain = nonNegativeRule(rules?.minBrierGain, CALIBRATION_LIFECYCLE_RULES.minBrierGain);
  const normalized = (Array.isArray(windows) ? windows : []).map((window, index) => {
    const baselineBrier = nonNegativeFiniteOrNull(window?.baselineBrier);
    const candidateBrier = nonNegativeFiniteOrNull(window?.candidateBrier);
    const baselineLogLoss = nonNegativeFiniteOrNull(window?.baselineLogLoss);
    const candidateLogLoss = nonNegativeFiniteOrNull(window?.candidateLogLoss);
    const brierGain = baselineBrier !== null && candidateBrier !== null ? baselineBrier - candidateBrier : null;
    const logLossGain = baselineLogLoss !== null && candidateLogLoss !== null ? baselineLogLoss - candidateLogLoss : null;
    const sample = nonNegativeInteger(window?.sample);
    const range = validWindowRange(window?.from, window?.to);
    const pass = range.valid
      && sample >= minWindowSample
      && brierGain !== null && brierGain >= minBrierGain
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
      rangeValid: range.valid,
      fromMs: range.valid ? range.fromMs : null,
      toMs: range.valid ? range.toMs : null,
      pass,
    };
  });
  const requiredWindows = 2;
  const latest = normalized.slice(-requiredWindows);
  const nonOverlapping = latest.length === requiredWindows
    && latest[0].rangeValid
    && latest[1].rangeValid
    && latest[0].toMs < latest[1].fromMs;
  const pass = latest.length === requiredWindows
    && nonOverlapping
    && latest.every(window => window.pass);
  return {
    pass,
    status: pass ? 'eligible' : normalized.length >= requiredWindows ? 'held' : 'shadow',
    windows: normalized.map(({ fromMs, toMs, ...window }) => window),
    nonOverlapping,
    reason: pass
      ? 'Два последовательных trusted holdout-окна подтвердили улучшение Brier без ухудшения log loss.'
      : normalized.length < requiredWindows
        ? 'Нужно два последовательных trusted holdout-окна.'
        : !nonOverlapping
          ? 'Два последних holdout-окна должны быть валидными, последовательными и непересекающимися.'
          : 'Хотя бы одно holdout-окно не подтвердило безопасное улучшение.',
  };
}

export function evaluatePostPromotionRollback(metrics = {}, rules = CALIBRATION_LIFECYCLE_RULES) {
  const sample = nonNegativeInteger(metrics?.sample);
  const activeBrier = nonNegativeFiniteOrNull(metrics?.activeBrier);
  const championBrier = nonNegativeFiniteOrNull(metrics?.championBrier);
  const activeLogLoss = nonNegativeFiniteOrNull(metrics?.activeLogLoss);
  const championLogLoss = nonNegativeFiniteOrNull(metrics?.championLogLoss);
  const brierRegression = activeBrier !== null && championBrier !== null ? activeBrier - championBrier : null;
  const logLossRegression = activeLogLoss !== null && championLogLoss !== null ? activeLogLoss - championLogLoss : null;
  const minPostPromotionSample = Math.ceil(positiveRule(
    rules?.minPostPromotionSample,
    CALIBRATION_LIFECYCLE_RULES.minPostPromotionSample,
  ));
  const rollbackBrierTolerance = nonNegativeRule(
    rules?.rollbackBrierTolerance,
    CALIBRATION_LIFECYCLE_RULES.rollbackBrierTolerance,
  );
  const rollbackLogLossTolerance = nonNegativeRule(
    rules?.rollbackLogLossTolerance,
    CALIBRATION_LIFECYCLE_RULES.rollbackLogLossTolerance,
  );
  const enoughData = sample >= minPostPromotionSample;
  const rollback = enoughData && (
    (brierRegression !== null && brierRegression > rollbackBrierTolerance)
    || (logLossRegression !== null && logLossRegression > rollbackLogLossTolerance)
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
  const validRows = (Array.isArray(rows) ? rows : [])
    .map(row => ({ row, kickoffMs: Date.parse(String(row?.kickoff_at || '')) }))
    .filter(item => Number.isFinite(item.kickoffMs));
  validRows.sort((a, b) => a.kickoffMs - b.kickoffMs);
  const sorted = validRows.map(item => item.row);
  const minWindowSample = Math.ceil(positiveRule(rules?.minWindowSample, CALIBRATION_LIFECYCLE_RULES.minWindowSample));
  const minTrustedSample = Math.ceil(positiveRule(rules?.minTrustedSample, CALIBRATION_LIFECYCLE_RULES.minTrustedSample));
  const minTrainSample = Math.ceil(positiveRule(rules?.minTrainSample, CALIBRATION_LIFECYCLE_RULES.minTrainSample));
  const windowSize = Math.max(minWindowSample, Math.floor(sorted.length * 0.2));
  const cappedWindow = Math.min(50, windowSize);
  const validationTotal = cappedWindow * 2;
  if (sorted.length < minTrustedSample || sorted.length - validationTotal < minTrainSample) {
    return { train: [], windows: [], ready: false, sample: sorted.length };
  }
  const train = sorted.slice(0, sorted.length - validationTotal);
  const first = sorted.slice(sorted.length - validationTotal, sorted.length - cappedWindow);
  const second = sorted.slice(sorted.length - cappedWindow);
  return { train, windows: [first, second], ready: true, sample: sorted.length };
}
