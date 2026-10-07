export function createSettlementSupportRuntime(deps = {}) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Settlement support dependencies are required.');
  }
  const {
    actualOutcomeFromGoals,
    isFinishedStatus,
    scoreBrier,
    settlementDriftBeforeSnapshot,
    settlementDriftProviderSnapshot
  } = deps;

  for (const [name,fn] of Object.entries({
    actualOutcomeFromGoals,
    isFinishedStatus,
    scoreBrier,
    settlementDriftBeforeSnapshot,
    settlementDriftProviderSnapshot,
  })) {
    if (typeof fn !== 'function') throw new TypeError(`Settlement support requires ${name}.`);
  }

  function integerCandidate(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== 'string' || value.length > 24) return null;
    const raw=value.trim();
    if (!/^\d+$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isSafeInteger(number) ? number : null;
  }

  function positiveSafeInteger(value) {
    const number=integerCandidate(value);
    return number !== null && number > 0 ? number : null;
  }

  function nonNegativeSafeInteger(value) {
    const number=integerCandidate(value);
    return number !== null && number >= 0 ? number : null;
  }

  function probabilityValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    if (typeof value !== 'string' || value.length > 48) return null;
    const raw=value.trim();
    if (!/^(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }

  const SETTLEMENT_FINALITY_DELAY_HOURS = 6;
  const SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS = 24;
  const SETTLEMENT_FINALITY_LOOKBACK_DAYS = 7;
  const SETTLEMENT_FINALITY_MAX_FIXTURES = 100;
  const SETTLEMENT_FINALITY_MAX_DATES = 3;
  const SETTLEMENT_FINALITY_DRIFT_STATUSES = new Set(['AWD', 'WO', 'CANC', 'ABD']);
  
  
  const SETTLEMENT_DRIFT_ACTIONS = new Set(['keep_stored', 'accept_provider', 'void_prediction']);
  
  
  function buildSettlementDriftResolution(row, event, action, resolvedAt = new Date().toISOString()) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!SETTLEMENT_DRIFT_ACTIONS.has(normalizedAction)) {
      return { valid: false, error: 'unsupported_action' };
    }
    const before = settlementDriftBeforeSnapshot(row);
    const provider = settlementDriftProviderSnapshot(event);
    const common = {
      settlement_verification_state: 'adjudicated',
      settlement_verification_count:Math.max(1,nonNegativeSafeInteger(row?.settlement_verification_count) ?? 0),
      settlement_resolved_at: resolvedAt,
      settlement_resolution_action: normalizedAction,
      settlement_resolution_event_id: positiveSafeInteger(event?.id),
    };
  
    if (normalizedAction === 'keep_stored') {
      return {
        valid: true,
        patch: common,
        before,
        provider,
        after: { ...before, verificationState: 'adjudicated', resolutionAction: normalizedAction },
      };
    }
  
    if (normalizedAction === 'void_prediction') {
      return {
        valid: true,
        patch: { ...common, status: 'void' },
        before,
        provider,
        after: { ...before, status: 'void', verificationState: 'adjudicated', resolutionAction: normalizedAction },
      };
    }
  
    const providerStatus = String(event?.provider_status || '').toUpperCase();
    const home = nonNegativeSafeInteger(event?.provider_home_goals);
    const away = nonNegativeSafeInteger(event?.provider_away_goals);
    const outcome = home === null || away === null ? '' : actualOutcomeFromGoals(home, away);
    const eventOutcome = String(event?.provider_outcome || '');
    if (!isFinishedStatus(providerStatus) || home === null || away === null || !outcome ||
        (eventOutcome && eventOutcome !== outcome)) {
      return { valid: false, error: 'provider_result_not_safe_to_accept', before, provider };
    }
    const totalGoals = home + away;
    const over25Actual = totalGoals >= 3;
    const bttsActual = home > 0 && away > 0;
    const patch = {
      ...common,
      status: 'settled',
      actual_home_goals: home,
      actual_away_goals: away,
      actual_outcome: outcome,
      correct: String(row?.predicted_outcome || '') === outcome,
      brier_score: scoreBrier(row, outcome),
      over25_actual:over25Actual,
      over25_correct:(()=>{
        const probability=probabilityValue(row?.over25_prob);
        return probability===null ? null : (probability>=50)===over25Actual;
      })(),
      btts_actual:bttsActual,
      btts_correct:(()=>{
        const probability=probabilityValue(row?.btts_prob);
        return probability===null ? null : (probability>=50)===bttsActual;
      })(),
      settlement_verified_at: resolvedAt,
      settlement_verified_status: providerStatus,
    };
    return {
      valid: true,
      patch,
      before,
      provider,
      after: {
        status: 'settled',
        homeGoals: home,
        awayGoals: away,
        outcome,
        correct: patch.correct,
        brierScore: patch.brier_score,
        over25Actual,
        over25Correct: patch.over25_correct,
        bttsActual,
        bttsCorrect: patch.btts_correct,
        verificationState: 'adjudicated',
        resolutionAction: normalizedAction,
      },
    };
  }
  
  
  function stalePredictionCandidates(rows, now = Date.now()) {
    return (rows || [])
      .filter(row => {
        const id = positiveSafeInteger(row?.fixture_id);
        const kickoff = Date.parse(row?.kickoff_at || '');
        return row?.status === 'pending' && id !== null &&
          Number.isFinite(kickoff) && kickoff < now - 36 * 3600_000;
      })
      .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
  }
  
  
  const SETTLEMENT_RUN_STALE_MINUTES = 30;
  const SETTLEMENT_RUN_MAX_ATTEMPTS = 3;
  
  
  const SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD = 2;
  const SETTLEMENT_CIRCUIT_OPEN_HOURS = 72;

  return Object.freeze({
    SETTLEMENT_FINALITY_DELAY_HOURS,
    SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
    SETTLEMENT_FINALITY_LOOKBACK_DAYS,
    SETTLEMENT_FINALITY_MAX_FIXTURES,
    SETTLEMENT_FINALITY_MAX_DATES,
    SETTLEMENT_FINALITY_DRIFT_STATUSES,
    SETTLEMENT_DRIFT_ACTIONS,
    SETTLEMENT_RUN_STALE_MINUTES,
    SETTLEMENT_RUN_MAX_ATTEMPTS,
    SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
    SETTLEMENT_CIRCUIT_OPEN_HOURS,
    buildSettlementDriftResolution,
    stalePredictionCandidates
  });
}
