export function createSettlementSupportRuntime(deps = {}) {
  const {
    actualOutcomeFromGoals,
    isFinishedStatus,
    scoreBrier,
    settlementDriftBeforeSnapshot,
    settlementDriftProviderSnapshot
  } = deps;

  const SETTLEMENT_FINALITY_DELAY_HOURS = 6;
  const SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS = 24;
  const SETTLEMENT_FINALITY_LOOKBACK_DAYS = 7;
  const SETTLEMENT_FINALITY_MAX_FIXTURES = 100;
  const SETTLEMENT_FINALITY_MAX_DATES = 3;
  const SETTLEMENT_FINALITY_DRIFT_STATUSES = new Set(['AWD', 'WO', 'CANC', 'ABD']);
  
  
  const SETTLEMENT_DRIFT_ACTIONS = new Set(['keep_stored', 'accept_provider', 'void_prediction']);
  
  
  function buildSettlementDriftResolution(row, event, action, resolvedAt = new Date().toISOString()) {
    const normalizedAction = String(action || '');
    if (!SETTLEMENT_DRIFT_ACTIONS.has(normalizedAction)) {
      return { valid: false, error: 'unsupported_action' };
    }
    const before = settlementDriftBeforeSnapshot(row);
    const provider = settlementDriftProviderSnapshot(event);
    const common = {
      settlement_verification_state: 'adjudicated',
      settlement_verification_count: Math.max(1, Number(row?.settlement_verification_count || 0)),
      settlement_resolved_at: resolvedAt,
      settlement_resolution_action: normalizedAction,
      settlement_resolution_event_id: Number(event?.id || 0) || null,
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
    const home = Number(event?.provider_home_goals);
    const away = Number(event?.provider_away_goals);
    const outcome = actualOutcomeFromGoals(home, away);
    const eventOutcome = String(event?.provider_outcome || '');
    if (!isFinishedStatus(providerStatus) || !Number.isFinite(home) || !Number.isFinite(away) || !outcome ||
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
      over25_actual: over25Actual,
      over25_correct: row?.over25_prob === null || row?.over25_prob === undefined ? null : (Number(row.over25_prob) >= 50) === over25Actual,
      btts_actual: bttsActual,
      btts_correct: row?.btts_prob === null || row?.btts_prob === undefined ? null : (Number(row.btts_prob) >= 50) === bttsActual,
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
        const id = Number(row?.fixture_id || 0);
        const kickoff = Date.parse(row?.kickoff_at || '');
        return row?.status === 'pending' && Number.isInteger(id) && id > 0 &&
          Number.isFinite(kickoff) && kickoff < now - 36 * 3600_000;
      })
      .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
  }
  
  
  const SETTLEMENT_RUN_STALE_MINUTES = 30;
  const SETTLEMENT_RUN_MAX_ATTEMPTS = 3;
  
  
  const SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD = 2;
  const SETTLEMENT_CIRCUIT_OPEN_HOURS = 72;

  return {
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
  };
}
