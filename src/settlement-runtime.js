// Settlement and prediction-integrity runtime extracted from worker.js.
// Provider, Supabase and runtime-control capabilities remain injected by the composition root.
export function createSettlementRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Settlement runtime dependencies are required.');
  }
  const {
    APP_VERSION,
    DEFAULT_RUNTIME_CONTROLS,
    SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
    SETTLEMENT_CIRCUIT_OPEN_HOURS,
    SETTLEMENT_DRIFT_ACTIONS,
    SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
    SETTLEMENT_FINALITY_DELAY_HOURS,
    SETTLEMENT_FINALITY_DRIFT_STATUSES,
    SETTLEMENT_FINALITY_LOOKBACK_DAYS,
    SETTLEMENT_FINALITY_MAX_DATES,
    SETTLEMENT_FINALITY_MAX_FIXTURES,
    SETTLEMENT_RUN_MAX_ATTEMPTS,
    SETTLEMENT_RUN_STALE_MINUTES,
    SUPABASE_SCHEMA_GUIDANCE,
    actualOutcomeFromGoals,
    brierFromProbabilities,
    buildSettlementDriftResolution,
    bytesToHex,
    enc,
    fetchWithTimeout,
    fixtureIdentity,
    fixtureStatusShort,
    freeQuotaHealthy,
    getCache,
    hasSupabase,
    isFinishedStatus,
    loadProviderFixturesForDate,
    loadRuntimeControls,
    memory,
    parseJsonObject,
    predictionOutcomeKey,
    probeOptionalTable,
    providerSnapshot,
    recordOpsEvent,
    redactOpsString,
    regulationScore,
    scoreBrier,
    setCache,
    signalProbabilitySnapshot,
    stalePredictionCandidates,
    supaHeaders,
    supaInsertIgnore,
    supaPatch,
    supaSelectMany,
    supaSelectOne,
    supaSelectPaged,
    supaUpsert,
    todayUtc,
  } = deps;

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

  function finiteNumericCandidate(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.length > 48) return null;
    const raw=value.trim();
    if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
    const number=Number(raw);
    return Number.isFinite(number) ? number : null;
  }

  function boundedCount(value,max=1_000_000) {
    const number=nonNegativeSafeInteger(value);
    return number===null ? 0 : Math.min(number,max);
  }

  function plainObject(value) {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  }

  function rows(value) {
    return Array.isArray(value) ? value : [];
  }

  function safeText(value,max=180) {
    if (typeof value!=='string') return '';
    return value.trim().slice(0,max);
  }

  function finiteModelNumber(value,min=-Infinity,max=Infinity) {
    const number=finiteNumericCandidate(value);
    return number!==null && number>=min && number<=max ? number : null;
  }

  async function captureModelPrediction(payload, cfg) {
    const source=plainObject(payload);
    const match=plainObject(source?.match);
    const probabilities=plainObject(source?.probabilities);
    if (!match || !probabilities) return false;

    const fixtureId=positiveSafeInteger(match.fixtureId);
    const kickoffRaw=safeText(match.date,80);
    const kickoffMs=kickoffRaw ? Date.parse(kickoffRaw) : NaN;
    const status=safeText(match.status,16).toUpperCase();
    const probabilityCheck=predictionProbabilityIntegrity({
      home_prob:probabilities.home,
      draw_prob:probabilities.draw,
      away_prob:probabilities.away,
    });
    if (fixtureId===null || !probabilityCheck.valid || !Number.isFinite(kickoffMs)) return false;
    if (!['NS','TBD'].includes(status)) return false;
    // Backtest only genuine pre-match snapshots, never a prediction captured after kickoff.
    if (kickoffMs<=Date.now()+120_000) return false;

    let predictedOutcome='';
    try {
      predictedOutcome=safeText(predictionOutcomeKey(probabilities),16).toLowerCase();
    } catch {
      return false;
    }
    if (!['home','draw','away'].includes(predictedOutcome)) return false;

    const analysisVersion=safeText(source.analysisVersion,120);
    const modelBreakdown=plainObject(source.modelBreakdown) || {};
    const signals=rows(modelBreakdown.signals);
    const signalWeights=plainObject(modelBreakdown.weights) || {};
    let signalProbabilities={};
    try {
      signalProbabilities=plainObject(signalProbabilitySnapshot(signals)) || {};
    } catch {}

    const rawProbabilities=plainObject(source.rawProbabilities) || {};
    const calibration=plainObject(source.modelCalibration) || {};
    const dataPolicy=plainObject(source.dataPolicy) || {};
    const completeness=plainObject(source.completeness) || {};
    const goalModel=plainObject(source.goalModel) || {};
    const confidence=plainObject(source.confidence) || {};
    const dataProvenance=plainObject(source.dataProvenance) || {};

    const row = {
      fixture_id:fixtureId,
      analysis_version:analysisVersion || '3.7.0-model-calibration',
      captured_at:new Date().toISOString(),
      kickoff_at:new Date(kickoffMs).toISOString(),
      league_id:positiveSafeInteger(match.leagueId),
      league_name:safeText(match.league,180),
      home_id:positiveSafeInteger(plainObject(match.home)?.id),
      away_id:positiveSafeInteger(plainObject(match.away)?.id),
      home_name:safeText(plainObject(match.home)?.name,180),
      away_name:safeText(plainObject(match.away)?.name,180),
      home_prob:probabilityCheck.values[0],
      draw_prob:probabilityCheck.values[1],
      away_prob:probabilityCheck.values[2],
      predicted_outcome:predictedOutcome,
      confidence_score:finiteModelNumber(confidence.score,0,100),
      signal_names:signals
        .map(signal=>safeText(plainObject(signal)?.name,120))
        .filter(Boolean),
      signal_weights:signalWeights,
      signal_probabilities:signalProbabilities,
      raw_home_prob:finiteModelNumber(rawProbabilities.home,0,100) ?? probabilityCheck.values[0],
      raw_draw_prob:finiteModelNumber(rawProbabilities.draw,0,100) ?? probabilityCheck.values[1],
      raw_away_prob:finiteModelNumber(rawProbabilities.away,0,100) ?? probabilityCheck.values[2],
      calibration_mode:safeText(calibration.mode,80) || 'baseline',
      calibration_profile_fingerprint:safeText(calibration.fingerprint,160),
      calibration_temperature:finiteModelNumber(calibration.temperature,0.01,100) ?? 1,
      calibration_sample:finiteModelNumber(calibration.sample,0,Number.MAX_SAFE_INTEGER) ?? 0,
      calibration_weights:plainObject(calibration.signalWeights) || {},
      data_mode:safeText(dataPolicy.mode,80),
      completeness_score:finiteModelNumber(completeness.score,0,100000) ?? 0,
      completeness_max:finiteModelNumber(completeness.max,0,100000) ?? 0,
      home_expected_goals:finiteModelNumber(goalModel.homeExpected,0,20),
      away_expected_goals:finiteModelNumber(goalModel.awayExpected,0,20),
      over25_prob:finiteModelNumber(goalModel.over25,0,100),
      btts_prob:finiteModelNumber(goalModel.btts,0,100),
      data_provenance:dataProvenance,
      model_inputs_version:analysisVersion,
      status:'pending',
    };

    if (hasSupabase(cfg)) {
      try {
        // fixture_id is the primary key: the FIRST pre-match snapshot stays immutable.
        await supaInsertIgnore(cfg, 'model_predictions', row, 'fixture_id');
        return true;
      } catch (error) {
        // Current releases require the current schema. Do not retry a failed write
        // with a legacy shape: auth/network/provider failures must not masquerade
        // as schema compatibility and trigger a second database write.
        console.warn('model prediction capture skipped', error?.message || error);
        return false;
      }
    }
    if (!memory.modelPredictions.has(fixtureId)) memory.modelPredictions.set(fixtureId, row);
    return true;
  }

  async function settlePredictionsFromFixtures(fixtures, cfg) {
    const finished = (fixtures || []).filter(f => {
      const fixtureId = positiveSafeInteger(fixtureIdentity(f));
      return fixtureId !== null && isFinishedStatus(fixtureStatusShort(f));
    });
    if (!finished.length) return { checked: 0, settled: 0 };
    const ids = [...new Set(finished.map(f => positiveSafeInteger(fixtureIdentity(f))).filter(id => id !== null))];
    let rows = [];
    if (hasSupabase(cfg)) {
      try {
        rows = await supaSelectMany(cfg, 'model_predictions', {
          status: 'eq.pending',
          fixture_id: `in.(${ids.join(',')})`,
        }, { limit: Math.min(500, ids.length + 10) });
      } catch (error) {
        console.warn('model prediction settle read skipped', error?.message || error);
        return { checked: 0, settled: 0 };
      }
    } else {
      rows = ids.map(id => memory.modelPredictions.get(Number(id))).filter(x => x?.status === 'pending');
    }
    if (!rows.length) return { checked: 0, settled: 0 };
  
    const fixtureMap = new Map(
      finished
        .map(f => [positiveSafeInteger(fixtureIdentity(f)), f])
        .filter(([id]) => id !== null)
    );
    let settled = 0;
    for (const row of rows) {
      const rowFixtureId = positiveSafeInteger(row?.fixture_id);
      if (rowFixtureId === null) continue;
      const fixture = fixtureMap.get(rowFixtureId);
      const score = regulationScore(fixture);
      if (!score) continue;
      const actualOutcome = actualOutcomeFromGoals(score.home, score.away);
      if (!actualOutcome) continue;
      const totalGoals = score.home + score.away;
      const bttsActual = score.home > 0 && score.away > 0;
      const over25Actual = totalGoals >= 3;
      const patch = {
        status: 'settled',
        settled_at: new Date().toISOString(),
        actual_home_goals: score.home,
        actual_away_goals: score.away,
        actual_outcome: actualOutcome,
        correct: String(row.predicted_outcome || '') === actualOutcome,
        brier_score: scoreBrier(row, actualOutcome),
        over25_actual:over25Actual,
        over25_correct:(()=>{
          const probability=finiteModelNumber(row?.over25_prob,0,100);
          return probability===null ? null : (probability>=50)===over25Actual;
        })(),
        btts_actual:bttsActual,
        btts_correct:(()=>{
          const probability=finiteModelNumber(row?.btts_prob,0,100);
          return probability===null ? null : (probability>=50)===bttsActual;
        })(),
        settlement_verification_state: 'unverified',
        settlement_verified_at: null,
        settlement_verified_status: fixtureStatusShort(fixture),
      };
      if (hasSupabase(cfg)) {
        try {
          await supaPatch(cfg, 'model_predictions', { fixture_id: `eq.${rowFixtureId}`, status: 'eq.pending' }, patch);
          settled++;
        } catch (error) {
          console.warn('model prediction settle patch skipped', error?.message || error);
        }
      } else {
        memory.modelPredictions.set(rowFixtureId, { ...row, ...patch });
        settled++;
      }
    }
    return { checked: rows.length, settled };
  }

  function predictionProbabilityIntegrity(row) {
    const raw=['home_prob','draw_prob','away_prob'].map(key=>row?.[key]);
    const values=raw.map(finiteNumericCandidate);
    const present=raw.every(value=>value!==null && value!==undefined && value!=='');
    const finite=present && values.every(value=>value!==null);
    const bounded=finite && values.every(value=>value>=0 && value<=100);
    const sum=finite ? values.reduce((a,b)=>a+b,0) : null;
    const sumOk=Number.isFinite(sum) && Math.abs(sum-100)<=1.5;
    return {present,finite,bounded,sum,sumOk,values,valid:present && finite && bounded && sumOk};
  }

  function predictionSnapshotTiming(row) {
    // model_predictions uses captured_at. created_at is accepted only as a
    // compatibility fallback for old/manual snapshots.
    const capturedRaw = row?.captured_at ?? row?.created_at;
    const kickoffRaw = row?.kickoff_at;
    const capturedAt = capturedRaw === null || capturedRaw === undefined || capturedRaw === '' ? NaN : Date.parse(capturedRaw);
    const kickoffAt = kickoffRaw === null || kickoffRaw === undefined || kickoffRaw === '' ? NaN : Date.parse(kickoffRaw);
    const valid = Number.isFinite(capturedAt) && Number.isFinite(kickoffAt);
    return { capturedAt, kickoffAt, valid, late: valid && capturedAt >= kickoffAt };
  }

  function settledOutcomeIntegrity(row) {
    const outcome=safeText(row?.actual_outcome,16).toLowerCase();
    const home=nonNegativeSafeInteger(row?.actual_home_goals);
    const away=nonNegativeSafeInteger(row?.actual_away_goals);
    const scoreValid=home!==null && away!==null;
    const outcomeValid=['home','draw','away'].includes(outcome);
    const expectedOutcome=scoreValid ? actualOutcomeFromGoals(home,away) : '';
    return {
      scoreValid,
      outcomeValid,
      expectedOutcome,
      valid:scoreValid && outcomeValid && expectedOutcome===outcome,
    };
  }

  function predictionConsistency(row, { settled = false } = {}) {
    const probabilityCheck = predictionProbabilityIntegrity(row);
    if (!probabilityCheck.valid) return { testable: false, valid: false, predictedValid: false, topMatches: false, correctMatches: false };
    const predicted = String(row?.predicted_outcome || '');
    const predictedValid = ['home','draw','away'].includes(predicted);
    const expectedPredicted=predictionOutcomeKey({
      home:probabilityCheck.values[0],
      draw:probabilityCheck.values[1],
      away:probabilityCheck.values[2],
    });
    const topMatches = predictedValid && predicted === expectedPredicted;
    let correctMatches = true;
    if (settled) {
      const actual = String(row?.actual_outcome || '');
      correctMatches = typeof row?.correct === 'boolean' &&
        ['home','draw','away'].includes(actual) &&
        row.correct === (predicted === actual);
    }
    return { testable: true, predictedValid, topMatches, correctMatches, valid: predictedValid && topMatches && correctMatches };
  }

  function trustedSettlementForMetrics(row) {
    const state = String(row?.settlement_verification_state || 'unverified');
    return row?.status === 'settled' && ['confirmed', 'adjudicated'].includes(state);
  }

  function trustedMetricsGateSelfTest() {
    const base = { status: 'settled' };
    return {
      pass:
        trustedSettlementForMetrics({ ...base, settlement_verification_state: 'confirmed' }) &&
        trustedSettlementForMetrics({ ...base, settlement_verification_state: 'adjudicated' }) &&
        !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'verified' }) &&
        !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'unverified' }) &&
        !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'drift' }) &&
        !trustedSettlementForMetrics({ status: 'void', settlement_verification_state: 'adjudicated' }),
      confirmed: trustedSettlementForMetrics({ ...base, settlement_verification_state: 'confirmed' }),
      adjudicated: trustedSettlementForMetrics({ ...base, settlement_verification_state: 'adjudicated' }),
      verifiedBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'verified' }),
      unverifiedBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'unverified' }),
      driftBlocked: !trustedSettlementForMetrics({ ...base, settlement_verification_state: 'drift' }),
      voidBlocked: !trustedSettlementForMetrics({ status: 'void', settlement_verification_state: 'adjudicated' }),
    };
  }

  function modelQualityEligibleRow(row) {
    const timing = predictionSnapshotTiming(row);
    return trustedSettlementForMetrics(row) &&
      predictionProbabilityIntegrity(row).valid &&
      timing.valid && !timing.late &&
      settledOutcomeIntegrity(row).valid &&
      predictionConsistency(row, { settled: true }).valid;
  }

  function verifiedSettledRows(settledRows, pendingRows = []) {
    const settled = Array.isArray(settledRows) ? settledRows : [];
    const all = [...settled, ...(Array.isArray(pendingRows) ? pendingRows : [])];
    const fixtureCounts = new Map();
    for (const row of all) {
      const id=positiveSafeInteger(row?.fixture_id);
      if (id!==null) fixtureCounts.set(id,(fixtureCounts.get(id) || 0)+1);
    }
    return settled.filter(row=>{
      const id=positiveSafeInteger(row?.fixture_id);
      return id!==null && fixtureCounts.get(id)===1 && modelQualityEligibleRow(row);
    });
  }

  function verifiedBrierScore(row) {
    const probabilityCheck=predictionProbabilityIntegrity(row);
    if (!probabilityCheck.valid || !settledOutcomeIntegrity(row).valid) return null;
    return brierFromProbabilities({
      home:probabilityCheck.values[0],
      draw:probabilityCheck.values[1],
      away:probabilityCheck.values[2],
    },safeText(row?.actual_outcome,16).toLowerCase());
  }

  function buildPredictionIntegrity(settledRows, pendingRows) {
    const settled = Array.isArray(settledRows) ? settledRows : [];
    const pending = Array.isArray(pendingRows) ? pendingRows : [];
    const all = [...settled, ...pending];
    const now = Date.now();
  
    const invalidProbabilities = all.filter(row => !predictionProbabilityIntegrity(row).valid);
    const invalidSnapshotMetadata = all.filter(row => !predictionSnapshotTiming(row).valid);
    const snapshotAfterKickoff = all.filter(row => predictionSnapshotTiming(row).late);
    const stalePending = pending.filter(row => {
      const timing = predictionSnapshotTiming(row);
      return Number.isFinite(timing.kickoffAt) && timing.kickoffAt < now - 36 * 3600_000;
    });
    const missingVersion = all.filter(row => !String(row?.analysis_version || '').trim());
    const missingSignals = all.filter(row => {
      const signalMap = parseJsonObject(row?.signal_probabilities);
      return !signalMap || !Object.keys(signalMap).length;
    });
    const invalidSettledOutcome = settled.filter(row => !settledOutcomeIntegrity(row).valid);
    const inconsistentPrediction = all.filter(row => {
      if (!predictionProbabilityIntegrity(row).valid) return false;
      const check = predictionConsistency(row, { settled: false });
      return !check.predictedValid || !check.topMatches;
    });
    const invalidCorrectFlag = settled.filter(row => {
      if (!predictionProbabilityIntegrity(row).valid || !settledOutcomeIntegrity(row).valid) return false;
      return !predictionConsistency(row, { settled: true }).correctMatches;
    });
    const invalidFixtureIds=all.filter(row=>positiveSafeInteger(row?.fixture_id)===null);
  
    const fixtureCounts=new Map();
    for (const row of all) {
      const id=positiveSafeInteger(row?.fixture_id);
      if (id===null) continue;
      fixtureCounts.set(id,(fixtureCounts.get(id) || 0)+1);
    }
    const duplicateFixtures = [...fixtureCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([fixtureId, count]) => ({ fixtureId, count }))
      .slice(0, 20);
  
    const severe = invalidProbabilities.length + invalidSnapshotMetadata.length + snapshotAfterKickoff.length +
      invalidSettledOutcome.length + inconsistentPrediction.length + invalidCorrectFlag.length +
      invalidFixtureIds.length + duplicateFixtures.length;
    const warning = stalePending.length;
  
    const checks = [
      {
        key: 'probabilities',
        label: 'Вероятности 1X2',
        state: invalidProbabilities.length ? 'fail' : 'pass',
        count: invalidProbabilities.length,
        detail: invalidProbabilities.length
          ? 'Есть строки с NaN/выходом за 0–100 или суммой, отличающейся от 100 более чем на 1.5 п.п.'
          : 'Все загруженные снимки вероятностей 1X2 проходят базовую проверку.',
      },
      {
        key: 'snapshot_metadata',
        label: 'Время снимков',
        state: invalidSnapshotMetadata.length ? 'fail' : 'pass',
        count: invalidSnapshotMetadata.length,
        detail: invalidSnapshotMetadata.length
          ? 'Есть строки без корректного времени снимка или времени начала матча; предматчевый статус нельзя подтвердить.'
          : 'Время снимка и время начала матча доступны у всех загруженных записей.',
      },
      {
        key: 'snapshot_timing',
        label: 'Время предматчевых снимков',
        state: snapshotAfterKickoff.length ? 'fail' : 'pass',
        count: snapshotAfterKickoff.length,
        detail: snapshotAfterKickoff.length
          ? 'Есть снимки, созданные в момент начала матча или позже.'
          : 'Поздние снимки в загруженной выборке не обнаружены.',
      },
      {
        key: 'pending_settlement',
        label: 'Зависшие ожидания',
        state: stalePending.length ? 'warn' : 'pass',
        count: stalePending.length,
        detail: stalePending.length
          ? 'Есть прогнозы в ожидании старше 36 часов после начала матча — нужен контроль ежедневной фиксации результата.'
          : 'Зависших прогнозов в ожидании старше 36 часов нет.',
      },
      {
        key: 'settled_outcome',
        label: 'Фактический результат',
        state: invalidSettledOutcome.length ? 'fail' : 'pass',
        count: invalidSettledOutcome.length,
        detail: invalidSettledOutcome.length
          ? 'Есть завершённые записи без корректного счёта либо сохранённый исход не совпадает со счётом.'
          : 'Завершённые записи имеют корректный счёт и согласованный исход 1X2.',
      },
      {
        key: 'prediction_consistency',
        label: 'Прогнозируемый исход',
        state: inconsistentPrediction.length ? 'fail' : 'pass',
        count: inconsistentPrediction.length,
        detail: inconsistentPrediction.length
          ? 'Есть строки, где сохранённый прогноз отсутствует или не совпадает с максимальной вероятностью 1X2.'
          : 'Сохранённый прогноз согласован с максимальной вероятностью 1X2.',
      },
      {
        key: 'correct_flag',
        label: 'Признак правильности',
        state: invalidCorrectFlag.length ? 'fail' : 'pass',
        count: invalidCorrectFlag.length,
        detail: invalidCorrectFlag.length
          ? 'Есть завершённые записи, где признак правильности не согласован с прогнозом и фактическим исходом.'
          : 'Признак правильности согласован с прогнозом и фактическим исходом.',
      },
      {
        key: 'fixture_identity',
        label: 'Идентификатор матча',
        state: invalidFixtureIds.length ? 'fail' : 'pass',
        count: invalidFixtureIds.length,
        detail: invalidFixtureIds.length
          ? 'Есть строки без корректного номера матча.'
          : 'Все загруженные строки имеют корректный номер матча.',
      },
      {
        key: 'duplicates',
        label: 'Уникальность матчей',
        state: duplicateFixtures.length ? 'fail' : 'pass',
        count: duplicateFixtures.length,
        detail: duplicateFixtures.length
          ? 'В загруженной выборке повторяется номер матча.'
          : 'Дубликаты номеров матчей в загруженной выборке не обнаружены.',
      },
      {
        key: 'version_metadata',
        label: 'Версия анализа',
        state: missingVersion.length ? 'info' : 'pass',
        count: missingVersion.length,
        detail: missingVersion.length
          ? 'У старых снимков может отсутствовать версия анализа; они показываются как «старая / неизвестная».'
          : 'У всех загруженных снимков есть версия анализа.',
      },
      {
        key: 'signal_snapshot',
        label: 'Снимки отдельных сигналов',
        state: missingSignals.length ? 'info' : 'pass',
        count: missingSignals.length,
        detail: missingSignals.length
          ? 'У части старых версий отсутствуют сохранённые вероятности отдельных сигналов; это информационное ограничение анализа групп версий.'
          : 'Вероятности отдельных сигналов доступны у всей загруженной выборки.',
      },
    ];
  
    return {
      status: severe ? 'blocked' : warning ? 'watch' : 'clean',
      label: severe ? 'Есть нарушения целостности' : warning ? 'Есть пункты для проверки' : 'Проверки целостности пройдены',
      loadedRows: all.length,
      settledRows: settled.length,
      pendingRows: pending.length,
      severeIssues: severe,
      warningIssues: warning,
      informationalIssues: missingVersion.length + missingSignals.length,
      truncatedPotentially: settled.length >= 500 || pending.length >= 500,
      checks,
      examples: {
        invalidProbabilityFixtures: invalidProbabilities.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        invalidSnapshotFixtures: invalidSnapshotMetadata.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        lateSnapshotFixtures: snapshotAfterKickoff.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        stalePendingFixtures: stalePending.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        invalidOutcomeFixtures: invalidSettledOutcome.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        inconsistentPredictionFixtures: inconsistentPrediction.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        invalidCorrectFlagFixtures: invalidCorrectFlag.slice(0, 8).map(row => Number(row?.fixture_id || 0)).filter(Boolean),
        invalidFixtureRows: invalidFixtureIds.length,
        duplicateFixtures,
      },
      note: 'Проверка целостности анализирует только строки, загруженные текущим административным запросом (до 500 завершённых + 500 ожидающих). Строки с ошибками исключаются из метрик качества; веса модели автоматически не меняются.',
    };
  }

  function modelIntegritySelfTest() {
    const now = Date.now();
    const valid = {
      fixture_id: 1,
      home_prob: 50, draw_prob: 25, away_prob: 25,
      predicted_outcome: 'home', correct: true,
      actual_outcome: 'home', actual_home_goals: 2, actual_away_goals: 1,
      analysis_version: 'selftest', signal_probabilities: { market: { home: 50, draw: 25, away: 25 } },
      kickoff_at: new Date(now - 2 * 3600_000).toISOString(),
      captured_at: new Date(now - 3 * 3600_000).toISOString(),
    };
    const invalid = {
      ...valid,
      fixture_id: 2,
      home_prob: 90, draw_prob: 30, away_prob: 20,
      captured_at: new Date(now - 1 * 3600_000).toISOString(),
    };
    const missingProbability = {
      ...valid,
      fixture_id: 4,
      home_prob: null, draw_prob: 50, away_prob: 50,
    };
    const missingTimestamp = {
      ...valid,
      fixture_id: 5,
      captured_at: null,
    };
    const invalidOutcome = {
      ...valid,
      fixture_id: 6,
      actual_outcome: 'away',
      correct: false,
    };
    const inconsistentPrediction = {
      ...valid,
      fixture_id: 7,
      predicted_outcome: 'away',
      correct: false,
    };
    const stalePending = {
      ...valid,
      fixture_id: 3,
      actual_outcome: null,
      actual_home_goals: null,
      actual_away_goals: null,
      kickoff_at: new Date(now - 48 * 3600_000).toISOString(),
      captured_at: new Date(now - 49 * 3600_000).toISOString(),
    };
    const result = buildPredictionIntegrity([valid, invalid, missingProbability, missingTimestamp, invalidOutcome, inconsistentPrediction], [stalePending]);
    return {
      pass:
        result.checks.find(x => x.key === 'probabilities')?.count === 2 &&
        result.checks.find(x => x.key === 'snapshot_metadata')?.count === 1 &&
        result.checks.find(x => x.key === 'snapshot_timing')?.count === 1 &&
        result.checks.find(x => x.key === 'pending_settlement')?.count === 1 &&
        result.checks.find(x => x.key === 'settled_outcome')?.count === 1 &&
        result.checks.find(x => x.key === 'prediction_consistency')?.count === 1,
      result,
    };
  }

  function modelRemediationSelfTest() {
    const now = Date.now();
    const row = (fixtureId, hoursAgo, status = 'pending') => ({
      fixture_id: fixtureId,
      status,
      kickoff_at: new Date(now - hoursAgo * 3600_000).toISOString(),
      captured_at: new Date(now - (hoursAgo + 2) * 3600_000).toISOString(),
    });
    const candidates = stalePredictionCandidates([
      row(11, 48),
      row(12, 40),
      row(13, 12),
      row(14, 72, 'settled'),
    ], now);
    const batch = selectRemediationBatch(candidates, 20, 5);
    return {
      pass: candidates.length === 2 && batch.selected.length === 2 &&
        batch.selected.map(x => Number(x.fixture_id)).join(',') === '11,12' && batch.dates.length <= 5,
      candidates: candidates.length,
      selected: batch.selected.length,
      dates: batch.dates.length,
    };
  }

  async function probeSettlementFinalitySchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const predictionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
      predictionUrl.searchParams.set('select', 'settlement_verification_state,settlement_verified_at,settlement_verified_status');
      predictionUrl.searchParams.set('limit', '1');
      const eventUrl = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_verification_events`);
      eventUrl.searchParams.set('select', 'id,fixture_id,state,observed_at');
      eventUrl.searchParams.set('limit', '1');
      const [predictionResponse, eventResponse] = await Promise.all([
        fetchWithTimeout(predictionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement finality prediction schema'),
        fetchWithTimeout(eventUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement finality event schema'),
      ]);
      if (!predictionResponse.ok || !eventResponse.ok) {
        return { ok: false, status: `prediction_${predictionResponse.status}_events_${eventResponse.status}` };
      }
      return { ok: true, status: 'ok' };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  async function probeSettlementTrustSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
      url.searchParams.set('select', 'settlement_verification_count,settlement_first_verified_at');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement trust schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  function settlementFinalityVerdict(row, fixture) {
    const status = fixtureStatusShort(fixture).toUpperCase();
    if (SETTLEMENT_FINALITY_DRIFT_STATUSES.has(status)) {
      return { state: 'drift', reason: `provider_status_${status.toLowerCase()}`, status, score: regulationScore(fixture) };
    }
    if (!isFinishedStatus(status)) return { state: 'wait', reason: 'provider_not_final', status, score: null };
    const score = regulationScore(fixture);
    if (!score) return { state: 'wait', reason: 'score_unavailable', status, score: null };
    const storedHome = nonNegativeSafeInteger(row?.actual_home_goals);
    const storedAway = nonNegativeSafeInteger(row?.actual_away_goals);
    const storedOutcome = String(row?.actual_outcome || '');
    const providerOutcome = actualOutcomeFromGoals(score.home, score.away);
    if (storedHome === null || storedAway === null || !['home', 'draw', 'away'].includes(storedOutcome) || !providerOutcome) {
      return { state: 'drift', reason: 'stored_settlement_incomplete', status, score, providerOutcome };
    }
    const same = storedHome === score.home && storedAway === score.away && storedOutcome === providerOutcome;
    if (!same) {
      return {
        state: 'drift',
        reason: 'score_or_outcome_changed',
        status,
        score,
        providerOutcome,
      };
    }
  
    const priorState = String(row?.settlement_verification_state || 'unverified');
    if (priorState === 'verified') {
      const priorStatus = String(row?.settlement_verified_status || '').toUpperCase();
      if (priorStatus && priorStatus !== status) {
        return {
          state: 'drift',
          reason: 'provider_final_status_changed',
          status,
          score,
          providerOutcome,
          priorStatus,
        };
      }
      return {
        state: 'confirmed',
        reason: 'second_pass_match',
        status,
        score,
        providerOutcome,
        priorStatus: priorStatus || status,
      };
    }
  
    return {
      state: 'verified',
      reason: 'first_pass_match',
      status,
      score,
      providerOutcome,
    };
  }

  function settlementFinalitySelfTest() {
    const row = { status: 'settled', actual_home_goals: 2, actual_away_goals: 1, actual_outcome: 'home', settlement_verification_state: 'unverified' };
    const fixture = (status, home, away) => ({
      fixture: { id: 1, status: { short: status } },
      score: { fulltime: { home, away } },
      goals: { home, away },
    });
    const verified = settlementFinalityVerdict(row, fixture('FT', 2, 1));
    const confirmed = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('FT', 2, 1));
    const lateScoreDrift = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('FT', 1, 1));
    const lateStatusDrift = settlementFinalityVerdict({ ...row, settlement_verification_state: 'verified', settlement_verified_status: 'FT' }, fixture('AET', 2, 1));
    const missingStoredScoreDrift = settlementFinalityVerdict({
      ...row,
      actual_home_goals: null,
      actual_away_goals: null,
      actual_outcome: 'draw',
    }, fixture('FT', 0, 0));
    const statusDrift = settlementFinalityVerdict(row, fixture('AWD', 2, 1));
    const wait = settlementFinalityVerdict(row, fixture('2H', 2, 1));
    return {
      pass: verified.state === 'verified' &&
        confirmed.state === 'confirmed' &&
        lateScoreDrift.state === 'drift' &&
        lateStatusDrift.state === 'drift' &&
        missingStoredScoreDrift.state === 'drift' &&
        statusDrift.state === 'drift' &&
        wait.state === 'wait',
      verified: verified.state,
      confirmed: confirmed.state,
      lateScoreDrift: lateScoreDrift.state,
      lateStatusDrift: lateStatusDrift.state,
      missingStoredScoreDrift: missingStoredScoreDrift.state,
      wait: wait.state,
    };
  }

  function settlementFinalitySummary(rows = []) {
    const settled = (rows || []).filter(row => row?.status === 'settled');
    const count = state => settled.filter(row => String(row?.settlement_verification_state || 'unverified') === state).length;
    return {
      totalSettled: settled.length,
      verified: count('verified'),
      confirmed: count('confirmed'),
      drift: count('drift'),
      unverified: count('unverified'),
      adjudicated: count('adjudicated'),
      trustedForMetrics: count('confirmed') + count('adjudicated'),
    };
  }

  async function probeSettlementAdjudicationSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const predictionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/model_predictions`);
      predictionUrl.searchParams.set('select', 'settlement_resolved_at,settlement_resolution_action,settlement_resolution_event_id');
      predictionUrl.searchParams.set('limit', '1');
      const resolutionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_drift_resolutions`);
      resolutionUrl.searchParams.set('select', 'source_event_id,fixture_id,action,reason,created_at');
      resolutionUrl.searchParams.set('limit', '1');
      const [predictionResponse, resolutionResponse] = await Promise.all([
        fetchWithTimeout(predictionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement adjudication prediction schema'),
        fetchWithTimeout(resolutionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement adjudication resolution schema'),
      ]);
      if (!predictionResponse.ok || !resolutionResponse.ok) {
        return { ok: false, status: `prediction_${predictionResponse.status}_resolution_${resolutionResponse.status}` };
      }
      return { ok: true, status: 'ok' };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  function settlementDriftBeforeSnapshot(row = {}) {
    return {
      status: String(row.status || ''),
      homeGoals: nonNegativeSafeInteger(row.actual_home_goals),
      awayGoals: nonNegativeSafeInteger(row.actual_away_goals),
      outcome: String(row.actual_outcome || ''),
      correct: typeof row.correct === 'boolean' ? row.correct : null,
      brierScore:finiteModelNumber(row.brier_score,0,2),
      over25Actual: typeof row.over25_actual === 'boolean' ? row.over25_actual : null,
      over25Correct: typeof row.over25_correct === 'boolean' ? row.over25_correct : null,
      bttsActual: typeof row.btts_actual === 'boolean' ? row.btts_actual : null,
      bttsCorrect: typeof row.btts_correct === 'boolean' ? row.btts_correct : null,
    };
  }

  function settlementDriftProviderSnapshot(event = {}) {
    return {
      status: String(event.provider_status || ''),
      homeGoals: nonNegativeSafeInteger(event.provider_home_goals),
      awayGoals: nonNegativeSafeInteger(event.provider_away_goals),
      outcome: String(event.provider_outcome || ''),
      observedAt: event.observed_at || null,
      reason: String(event.reason || ''),
    };
  }

  async function settlementDriftResolutionToken(row, event) {
    const source = [
      Number(row?.fixture_id || 0),
      String(row?.settlement_verification_state || ''),
      String(row?.status || ''),
      String(row?.actual_home_goals ?? ''),
      String(row?.actual_away_goals ?? ''),
      String(row?.actual_outcome || ''),
      Number(event?.id || 0),
      String(event?.observed_at || ''),
      String(event?.provider_home_goals ?? ''),
      String(event?.provider_away_goals ?? ''),
      String(event?.provider_outcome || ''),
      String(event?.provider_status || ''),
    ].join('|');
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(source));
    return bytesToHex(new Uint8Array(digest)).slice(0, 32);
  }

  function settlementDriftAdjudicationSelfTest() {
    const row = {
      status: 'settled',
      predicted_outcome: 'home',
      actual_home_goals: 2,
      actual_away_goals: 1,
      actual_outcome: 'home',
      correct: true,
      home_prob: 60,
      draw_prob: 25,
      away_prob: 15,
      over25_prob: 55,
      btts_prob: 52,
    };
    const event = {
      id: 11,
      provider_status: 'FT',
      provider_home_goals: 1,
      provider_away_goals: 1,
      provider_outcome: 'draw',
    };
    const keep = buildSettlementDriftResolution(row, event, 'keep_stored', '2026-01-01T00:00:00.000Z');
    const accept = buildSettlementDriftResolution(row, event, 'accept_provider', '2026-01-01T00:00:00.000Z');
    const voided = buildSettlementDriftResolution(row, event, 'void_prediction', '2026-01-01T00:00:00.000Z');
    const unsafe = buildSettlementDriftResolution(row, { ...event, provider_status: 'CANC' }, 'accept_provider', '2026-01-01T00:00:00.000Z');
    const missingScoreUnsafe = buildSettlementDriftResolution(row, {
      ...event,
      provider_home_goals: null,
      provider_away_goals: null,
      provider_outcome: '',
    }, 'accept_provider', '2026-01-01T00:00:00.000Z');
    return {
      pass: keep.valid && keep.patch.settlement_verification_state === 'adjudicated' &&
        keep.patch.actual_home_goals === undefined &&
        accept.valid && accept.patch.actual_home_goals === 1 && accept.patch.actual_away_goals === 1 &&
        accept.patch.actual_outcome === 'draw' && accept.patch.correct === false &&
        voided.valid && voided.patch.status === 'void' &&
        !unsafe.valid &&
        !missingScoreUnsafe.valid,
      keep: keep.valid,
      accept: accept.valid ? accept.patch.actual_outcome : accept.error,
      void: voided.valid ? voided.patch.status : voided.error,
      unsafeAcceptBlocked: !unsafe.valid,
      missingScoreAcceptBlocked: !missingScoreUnsafe.valid,
    };
  }

  async function loadSettlementDriftReview(cfg, limit = 20) {
    if (!hasSupabase(cfg)) return { schemaReady: false, items: [], unresolved: 0 };
    const schema = await probeSettlementAdjudicationSchema(cfg);
    if (!schema.ok) return { schemaReady: false, schemaStatus: schema.status, items: [], unresolved: 0 };
    const rows = await supaSelectMany(cfg, 'model_predictions', {
      status: 'eq.settled',
      settlement_verification_state: 'eq.drift',
    }, { limit: Math.max(1, Math.min(20, Number(limit || 20))), order: 'kickoff_at.desc' });
    if (!rows.length) return { schemaReady: true, schemaStatus: 'ok', items: [], unresolved: 0 };
  
    const ids = [...new Set(rows.map(row => positiveSafeInteger(row?.fixture_id)).filter(id => id !== null))];
    const events = await supaSelectMany(cfg, 'settlement_verification_events', {
      state: 'eq.drift',
      fixture_id: `in.(${ids.join(',')})`,
    }, { limit: Math.min(100, Math.max(20, ids.length * 4)), order: 'observed_at.desc' });
    const eventByFixture = new Map();
    for (const event of events || []) {
      const id = Number(event.fixture_id);
      if (!eventByFixture.has(id)) eventByFixture.set(id, event);
    }
    const eventIds = [...new Set([...eventByFixture.values()].map(event => positiveSafeInteger(event?.id)).filter(id => id !== null))];
    let resolutions = [];
    if (eventIds.length) {
      resolutions = await supaSelectMany(cfg, 'settlement_drift_resolutions', {
        source_event_id: `in.(${eventIds.join(',')})`,
      }, { limit: eventIds.length + 5, order: 'created_at.desc' }).catch(() => []);
    }
    const resolutionByEvent = new Map((resolutions || []).map(row => [Number(row.source_event_id), row]));
  
    const items = await Promise.all(rows.map(async row => {
      const event = eventByFixture.get(Number(row.fixture_id)) || null;
      const locked = event ? resolutionByEvent.get(Number(event.id)) || null : null;
      const providerStatus = String(event?.provider_status || '').toUpperCase();
      const providerHome = nonNegativeSafeInteger(event?.provider_home_goals);
      const providerAway = nonNegativeSafeInteger(event?.provider_away_goals);
      const providerOutcome = providerHome === null || providerAway === null
        ? ''
        : actualOutcomeFromGoals(providerHome, providerAway);
      const providerAcceptable = Boolean(event && isFinishedStatus(providerStatus) &&
        providerHome !== null && providerAway !== null &&
        providerOutcome && (!event.provider_outcome || String(event.provider_outcome) === providerOutcome));
      return {
        fixtureId: positiveSafeInteger(row?.fixture_id),
        league: String(row.league_name || ''),
        home: String(row.home_name || ''),
        away: String(row.away_name || ''),
        kickoffAt: row.kickoff_at || null,
        eventId: positiveSafeInteger(event?.id),
        observedAt: event?.observed_at || null,
        driftReason: String(event?.reason || ''),
        stored: settlementDriftBeforeSnapshot(row),
        provider: settlementDriftProviderSnapshot(event || {}),
        providerAcceptable,
        resolutionToken: event ? await settlementDriftResolutionToken(row, event) : '',
        lockedAction: locked ? String(locked.action || '') : '',
      };
    }));
    return {
      schemaReady: true,
      schemaStatus: 'ok',
      unresolved: items.length,
      maxItems: 20,
      actions: ['keep_stored', 'accept_provider', 'void_prediction'],
      items,
    };
  }

  async function resolveSettlementDrift(cfg, user, input = {}) {
    const schema = await probeSettlementAdjudicationSchema(cfg);
    if (!schema.ok) {
      const error = new Error(SUPABASE_SCHEMA_GUIDANCE);
      error.code = 'SETTLEMENT_ADJUDICATION_SCHEMA';
      throw error;
    }
    const fixtureId = positiveSafeInteger(input.fixtureId);
    const eventId = positiveSafeInteger(input.eventId);
    const action = String(input.resolutionAction || '').trim().toLowerCase();
    const reason = redactOpsString(input.reason || '', 220).trim();
    if (fixtureId === null || eventId === null) {
      const error = new Error('Некорректная запись расхождения.');
      error.code = 'SETTLEMENT_DRIFT_CASE';
      throw error;
    }
    if (!SETTLEMENT_DRIFT_ACTIONS.has(action)) {
      const error = new Error('Неизвестное действие ручного разбора.');
      error.code = 'SETTLEMENT_DRIFT_ACTION';
      throw error;
    }
    if (reason.length < 5) {
      const error = new Error('Укажите причину ручного решения — минимум 5 символов.');
      error.code = 'SETTLEMENT_DRIFT_REASON';
      throw error;
    }
  
    const row = await supaSelectOne(cfg, 'model_predictions', { fixture_id: `eq.${fixtureId}` });
    if (!row || row.status !== 'settled' || String(row.settlement_verification_state || '') !== 'drift') {
      const error = new Error('Запись расхождения уже изменилась. Обновите предварительную проверку.');
      error.code = 'SETTLEMENT_DRIFT_STALE';
      throw error;
    }
    const events = await supaSelectMany(cfg, 'settlement_verification_events', {
      fixture_id: `eq.${fixtureId}`,
      state: 'eq.drift',
    }, { limit: 1, order: 'observed_at.desc' });
    const event = events?.[0] || null;
    if (!event || Number(event.id) !== eventId) {
      const error = new Error('Событие расхождения изменилось. Обновите предварительную проверку.');
      error.code = 'SETTLEMENT_DRIFT_EVENT_STALE';
      throw error;
    }
    const expectedToken = await settlementDriftResolutionToken(row, event);
    if (!input.resolutionToken || String(input.resolutionToken) !== expectedToken) {
      const error = new Error('Снимок расхождения изменился. Обновите предварительную проверку.');
      error.code = 'SETTLEMENT_DRIFT_TOKEN_STALE';
      throw error;
    }
  
    if (action === 'accept_provider') {
      const providerStatus = String(event?.provider_status || '').toUpperCase();
      const providerHome = nonNegativeSafeInteger(event?.provider_home_goals);
      const providerAway = nonNegativeSafeInteger(event?.provider_away_goals);
      const providerOutcome = providerHome === null || providerAway === null
        ? ''
        : actualOutcomeFromGoals(providerHome, providerAway);
      if (!isFinishedStatus(providerStatus) || providerHome === null || providerAway === null || !providerOutcome ||
          (event?.provider_outcome && String(event.provider_outcome) !== providerOutcome)) {
        const error = new Error('Исправление источника данных нельзя безопасно принять для этого статуса или счёта.');
        error.code = 'SETTLEMENT_DRIFT_UNSAFE';
        throw error;
      }
    }

    const resolution = buildSettlementDriftResolution(row, event, action);
    if (!resolution.valid) {
      const error = new Error(action === 'accept_provider'
        ? 'Исправление источника данных нельзя безопасно принять для этого статуса или счёта. Оставьте сохранённый результат либо аннулируйте запись.'
        : 'Ручное решение не может быть применено.');
      error.code = 'SETTLEMENT_DRIFT_UNSAFE';
      throw error;
    }
  
    const auditRow = {
      source_event_id: eventId,
      fixture_id: fixtureId,
      action,
      reason,
      admin_telegram_id: positiveSafeInteger(user?.id),
      before_snapshot: resolution.before,
      provider_snapshot: resolution.provider,
      after_snapshot: resolution.after,
      created_at: new Date().toISOString(),
    };
    await supaInsertIgnore(cfg, 'settlement_drift_resolutions', auditRow, 'source_event_id');
    const persisted = await supaSelectOne(cfg, 'settlement_drift_resolutions', { source_event_id: `eq.${eventId}` });
    if (!persisted) {
      const error = new Error('Не удалось записать журнал ручного решения.');
      error.code = 'SETTLEMENT_DRIFT_AUDIT';
      throw error;
    }
    if (String(persisted.action || '') !== action) {
      const error = new Error(`Это расхождение уже заблокировано действием ${String(persisted.action || '')}. Обновите предварительную проверку.`);
      error.code = 'SETTLEMENT_DRIFT_ALREADY_LOCKED';
      throw error;
    }
  
    await supaPatch(cfg, 'model_predictions', {
      fixture_id: `eq.${fixtureId}`,
      status: 'eq.settled',
      settlement_verification_state: 'eq.drift',
    }, resolution.patch);
  
    await recordOpsEvent(cfg, {
      severity: action === 'accept_provider' ? 'warning' : 'info',
      source: 'model',
      eventType: 'settlement_adjudication',
      code: action === 'accept_provider'
        ? 'SETTLEMENT_DRIFT_PROVIDER_ACCEPTED'
        : action === 'void_prediction'
          ? 'SETTLEMENT_DRIFT_VOIDED'
          : 'SETTLEMENT_DRIFT_STORED_CONFIRMED',
      message: reason,
      meta: {
        fixtureId,
        sourceEventId: eventId,
        action,
        stored: resolution.before,
        provider: resolution.provider,
        after: resolution.after,
      },
    }).catch(() => null);
  
    return {
      fixtureId,
      sourceEventId: eventId,
      action,
      resolvedAt: resolution.patch.settlement_resolved_at,
      before: resolution.before,
      provider: resolution.provider,
      after: resolution.after,
    };
  }

  async function runSettlementFinalityVerification(cfg) {
    if (!hasSupabase(cfg) || !cfg.apiFootballKey) return { skipped: 'no_persistent_database_or_provider' };
    const [schema, trustSchema] = await Promise.all([
      probeSettlementFinalitySchema(cfg),
      probeSettlementTrustSchema(cfg),
    ]);
    if (!schema.ok) return { skipped: 'finality_schema_missing', status: schema.status };
    if (!trustSchema.ok) return { skipped: 'trust_schema_missing', status: trustSchema.status };
  
    const markerKey = `settlement-finality:${todayUtc()}:v2`;
    if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date: todayUtc() };
    if (!automaticSettlementQuotaHealthy()) return { skipped: 'provider_quota_guard' };
  
    const since = new Date(Date.now() - SETTLEMENT_FINALITY_LOOKBACK_DAYS * 86400_000).toISOString();
    const verifyBefore = new Date(Date.now() - SETTLEMENT_FINALITY_DELAY_HOURS * 3600_000).toISOString();
    const confirmBeforeMs = Date.now() - SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS * 3600_000;
  
    let rows = await supaSelectMany(cfg, 'model_predictions', {
      status: 'eq.settled',
      settlement_verification_state: 'in.(unverified,verified)',
      kickoff_at: `gte.${since}`,
      settled_at: `lte.${verifyBefore}`,
    }, { limit: 200, order: 'kickoff_at.desc' });
  
    rows = (rows || []).filter(row => {
      const state = String(row?.settlement_verification_state || 'unverified');
      if (state === 'unverified') return true;
      const verifiedAt = Date.parse(row?.settlement_verified_at || row?.settlement_first_verified_at || '');
      return state === 'verified' && (!Number.isFinite(verifiedAt) || verifiedAt <= confirmBeforeMs);
    });
  
    if (!rows.length) {
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), candidates: 0, verified: 0, confirmed: 0, drift: 0 }, cfg, 1440).catch(() => null);
      return { ok: true, candidates: 0, verified: 0, confirmed: 0, drift: 0, skipped: 0 };
    }
  
    const selected = [];
    const dates = new Set();
    for (const row of rows) {
      const date = String(row?.kickoff_at || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!dates.has(date) && dates.size >= SETTLEMENT_FINALITY_MAX_DATES) continue;
      dates.add(date);
      selected.push(row);
      if (selected.length >= SETTLEMENT_FINALITY_MAX_FIXTURES) break;
    }
  
    const fixtureIds = new Set(selected.map(row => positiveSafeInteger(row?.fixture_id)).filter(id => id !== null));
    const fixtureMap = new Map();
    for (const date of dates) {
      const fixtures = await loadProviderFixturesForDate(date, cfg);
      for (const fixture of fixtures || []) {
        const id = fixtureIdentity(fixture);
        if (fixtureIds.has(id)) fixtureMap.set(id, fixture);
      }
    }
  
    let verified = 0, confirmed = 0, drift = 0, skipped = 0;
    for (const row of selected) {
      const fixture = fixtureMap.get(Number(row.fixture_id));
      if (!fixture) { skipped++; continue; }
      const verdict = settlementFinalityVerdict(row, fixture);
      if (verdict.state === 'wait') { skipped++; continue; }
  
      const now = new Date().toISOString();
      const previousState = String(row?.settlement_verification_state || 'unverified');
      const previousCount = Math.max(0, Number(row?.settlement_verification_count || 0));
      const patch = {
        settlement_verification_state: verdict.state,
        settlement_verified_at: now,
        settlement_verified_status: verdict.status,
        settlement_verification_count: verdict.state === 'confirmed'
          ? 2
          : verdict.state === 'verified'
            ? Math.max(1, previousCount)
            : previousCount,
      };
      if (verdict.state === 'verified' && !row?.settlement_first_verified_at) {
        patch.settlement_first_verified_at = now;
      }
      await supaPatch(cfg, 'model_predictions', {
        fixture_id: `eq.${Number(row.fixture_id)}`,
        status: 'eq.settled',
        settlement_verification_state: `eq.${previousState}`,
      }, patch);
  
      if (verdict.state === 'verified') {
        verified++;
        continue;
      }
      if (verdict.state === 'confirmed') {
        confirmed++;
        continue;
      }
  
      drift++;
      await supaInsertIgnore(cfg, 'settlement_verification_events', {
        observed_at: now,
        fixture_id: positiveSafeInteger(row?.fixture_id),
        state: 'drift',
        reason: verdict.reason,
        stored_home_goals: nonNegativeSafeInteger(row?.actual_home_goals),
        stored_away_goals: nonNegativeSafeInteger(row?.actual_away_goals),
        stored_outcome: String(row.actual_outcome || ''),
        provider_home_goals: nonNegativeSafeInteger(verdict.score?.home),
        provider_away_goals: nonNegativeSafeInteger(verdict.score?.away),
        provider_outcome: String(verdict.providerOutcome || ''),
        provider_status: verdict.status,
        detail: {
          settledAt: row.settled_at || null,
          verificationDelayHours: SETTLEMENT_FINALITY_DELAY_HOURS,
          confirmationDelayHours: SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
          previousVerificationState: previousState,
          previousVerificationCount: previousCount,
          previousVerifiedAt: row.settlement_verified_at || null,
          previousVerifiedStatus: row.settlement_verified_status || null,
          appVersion: APP_VERSION,
        },
      });
    }
  
    const result = {
      ok: true,
      candidates: selected.length,
      verified,
      confirmed,
      drift,
      skipped,
      providerCalls: dates.size,
      dates: [...dates],
    };
    await recordOpsEvent(cfg, {
      severity: drift ? 'warning' : 'info',
      source: 'model',
      eventType: 'settlement_finality',
      code: drift ? 'SETTLEMENT_FINALITY_DRIFT' : confirmed ? 'SETTLEMENT_FINALITY_CONFIRMED' : 'SETTLEMENT_FINALITY_VERIFIED',
      message: drift
        ? `Settlement finality found ${drift} drift row(s); trusted metrics continue to exclude them.`
        : `Settlement finality: ${verified} first-pass verified, ${confirmed} second-pass confirmed.`,
      meta: result,
    }).catch(() => null);
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...result }, cfg, 1440).catch(() => null);
    return result;
  }

  function selectRemediationBatch(candidates, maxFixtures = 20, maxDates = 5) {
    const selected = [];
    const dates = new Set();
    for (const row of candidates || []) {
      const date = String(row?.kickoff_at || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!dates.has(date) && dates.size >= maxDates) continue;
      dates.add(date);
      selected.push(row);
      if (selected.length >= maxFixtures) break;
    }
    return { selected, dates: [...dates] };
  }

  async function remediationFingerprint(rows) {
    const source = (rows || [])
      .map(row => `${Number(row?.fixture_id || 0)}:${String(row?.kickoff_at || '')}:${String(row?.captured_at || row?.created_at || '')}`)
      .sort()
      .join('|');
    if (!source) return '';
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(source));
    return bytesToHex(new Uint8Array(digest)).slice(0, 32);
  }

  async function loadPredictionRemediationRows(cfg, maxRows = 5000) {
    if (hasSupabase(cfg)) {
      return await supaSelectPaged(cfg, 'model_predictions', {}, {
        pageSize: 1000,
        maxRows,
        order: 'kickoff_at.desc',
      });
    }
    const rows = [...memory.modelPredictions.values()].sort((a, b) => Date.parse(b.kickoff_at || 0) - Date.parse(a.kickoff_at || 0));
    return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
  }

  function publicRemediationAction(row) {
    return {
      actionId: String(row?.action_id || ''),
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
      finishedAt: row?.finished_at || null,
      actionType: String(row?.action_type || ''),
      triggerSource: String(row?.trigger_source || (row?.action_type === 'auto_recover' ? 'cron' : 'admin')),
      status: String(row?.status || ''),
      reason: String(row?.reason || ''),
      candidateCount: Number(row?.candidate_count || 0),
      inspectedCount: Number(row?.inspected_count || 0),
      settledCount: Number(row?.settled_count || 0),
      skippedCount: Number(row?.skipped_count || 0),
      attemptNo: Math.max(1, Number(row?.attempt_no || 1)),
      retryOfActionId: row?.retry_of_action_id ? String(row.retry_of_action_id) : null,
      detail: parseJsonObject(row?.detail),
    };
  }

  async function loadRemediationActions(cfg, limit = 10) {
    if (!hasSupabase(cfg)) return memory.modelRemediation.actions.slice(0, limit).map(publicRemediationAction);
    const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {}, {
      limit: Math.max(1, Math.min(20, Number(limit || 10))),
      order: 'created_at.desc',
    });
    return rows.map(publicRemediationAction);
  }

  async function probeSettlementWatchdogSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const runtimeUrl = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_controls`);
      runtimeUrl.searchParams.set('select', 'auto_settlement_recovery_enabled');
      runtimeUrl.searchParams.set('limit', '1');
      const actionUrl = new URL(`${cfg.supabaseUrl}/rest/v1/prediction_integrity_actions`);
      actionUrl.searchParams.set('select', 'trigger_source');
      actionUrl.searchParams.set('limit', '1');
      const [runtimeResponse, actionResponse] = await Promise.all([
        fetchWithTimeout(runtimeUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement watchdog runtime schema'),
        fetchWithTimeout(actionUrl, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement watchdog audit schema'),
      ]);
      if (!runtimeResponse.ok || !actionResponse.ok) {
        return {
          ok: false,
          status: `runtime_${runtimeResponse.status}_audit_${actionResponse.status}`,
        };
      }
      return { ok: true, status: 'ok' };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  async function probeSettlementRunLedgerSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/prediction_integrity_actions`);
      url.searchParams.set('select', 'updated_at,finished_at,attempt_no,retry_of_action_id');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement run ledger schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  function settlementBatchKey(fixtureIds = []) {
    return [...new Set((fixtureIds || []).map(positiveSafeInteger).filter(id => id !== null))]
      .sort((a, b) => a - b)
      .join(',');
  }

  function settlementRetryDecision(latestAction, fixtureIds = []) {
    const currentKey = settlementBatchKey(fixtureIds);
    if (!latestAction || settlementBatchKey(latestAction.fixture_ids || latestAction.fixtureIds || []) !== currentKey) {
      return { attemptNo: 1, retryOfActionId: null, retryExhausted: false };
    }
    if (String(latestAction.status || '') !== 'interrupted') {
      return { attemptNo: 1, retryOfActionId: null, retryExhausted: false };
    }
    const previousAttempt = Math.max(1, Number(latestAction.attempt_no || latestAction.attemptNo || 1));
    if (previousAttempt >= SETTLEMENT_RUN_MAX_ATTEMPTS) {
      return {
        attemptNo: SETTLEMENT_RUN_MAX_ATTEMPTS,
        retryOfActionId: String(latestAction.action_id || latestAction.actionId || ''),
        retryExhausted: true,
      };
    }
    return {
      attemptNo: previousAttempt + 1,
      retryOfActionId: String(latestAction.action_id || latestAction.actionId || ''),
      retryExhausted: false,
    };
  }

  function settlementRunLedgerSelfTest() {
    const ids = [30, 10, 20];
    const fresh = settlementRetryDecision(null, ids);
    const retry = settlementRetryDecision({ status: 'interrupted', attempt_no: 1, action_id: 'a', fixture_ids: [20, 30, 10] }, ids);
    const exhausted = settlementRetryDecision({ status: 'interrupted', attempt_no: 3, action_id: 'b', fixture_ids: [10, 20, 30] }, ids);
    const different = settlementRetryDecision({ status: 'interrupted', attempt_no: 2, action_id: 'c', fixture_ids: [10, 20] }, ids);
    return {
      pass: fresh.attemptNo === 1 && !fresh.retryOfActionId &&
        retry.attemptNo === 2 && retry.retryOfActionId === 'a' && !retry.retryExhausted &&
        exhausted.attemptNo === 3 && exhausted.retryExhausted &&
        different.attemptNo === 1 && !different.retryOfActionId,
      fresh: fresh.attemptNo,
      retry: retry.attemptNo,
      exhausted: exhausted.retryExhausted,
      differentBatch: different.attemptNo,
    };
  }

  async function inspectSettlementRunLedger(cfg) {
    if (!hasSupabase(cfg)) return { active: [], stale: [], cutoff: null };
    const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {
      action_type: 'eq.auto_recover',
      status: 'eq.started',
    }, { limit: 20, order: 'updated_at.asc' });
    const cutoffTs = Date.now() - SETTLEMENT_RUN_STALE_MINUTES * 60_000;
    const active = [];
    const stale = [];
    for (const row of rows || []) {
      const ts = Date.parse(row.updated_at || row.created_at || 0);
      if (Number.isFinite(ts) && ts <= cutoffTs) stale.push(row);
      else active.push(row);
    }
    return { active, stale, cutoff: new Date(cutoffTs).toISOString() };
  }

  async function reconcileInterruptedSettlementActions(cfg) {
    const ledger = await inspectSettlementRunLedger(cfg);
    if (!ledger.stale.length) return { reconciled: [], active: ledger.active, cutoff: ledger.cutoff };
    const now = new Date().toISOString();
    const reconciled = [];
    for (const row of ledger.stale) {
      const detail = {
        ...parseJsonObject(row.detail),
        phase: 'interrupted',
        interruptedReason: 'stale_started_reconciled',
        interruptedAt: now,
      };
      await supaPatch(cfg, 'prediction_integrity_actions', { action_id: `eq.${String(row.action_id)}` }, {
        status: 'interrupted',
        updated_at: now,
        finished_at: now,
        detail,
      });
      reconciled.push({ ...row, status: 'interrupted', updated_at: now, finished_at: now, detail });
    }
    await noteSettlementWatchdogOutcome(cfg, 'failed', {
      actionId: reconciled[reconciled.length - 1]?.action_id || null,
      error: `${reconciled.length} зависших запусков фиксации результата отмечено как прерванные`,
    }).catch(() => null);
    await recordOpsEvent(cfg, {
      severity: 'warning',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: 'SETTLEMENT_RUN_INTERRUPTED',
      message: `Зависших запусков фиксации результата отмечено как прерванные: ${reconciled.length}.`,
      meta: {
        count: reconciled.length,
        staleMinutes: SETTLEMENT_RUN_STALE_MINUTES,
        actionIds: reconciled.map(x => String(x.action_id)).slice(0, 10),
      },
    }).catch(() => null);
    return { reconciled, active: ledger.active, cutoff: ledger.cutoff };
  }

  async function resolveSettlementRetryLineage(cfg, fixtureIds) {
    if (!hasSupabase(cfg)) return settlementRetryDecision(null, fixtureIds);
    const rows = await supaSelectMany(cfg, 'prediction_integrity_actions', {
      action_type: 'eq.auto_recover',
    }, { limit: 20, order: 'created_at.desc' });
    const key = settlementBatchKey(fixtureIds);
    const latest = (rows || []).find(row => settlementBatchKey(row.fixture_ids || []) === key) || null;
    return settlementRetryDecision(latest, fixtureIds);
  }

  async function probeSettlementReliabilitySchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/settlement_watchdog_state`);
      url.searchParams.set('select', 'id,consecutive_failures,circuit_open_until,last_run_at,last_status,last_action_id,last_error,updated_at');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase settlement reliability schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }

  function normalizeSettlementReliability(row = {}) {
    const openUntil = row.circuit_open_until || row.circuitOpenUntil || null;
    const openTs = openUntil ? Date.parse(openUntil) : 0;
    return {
      consecutiveFailures: Math.max(0, Number(row.consecutive_failures ?? row.consecutiveFailures ?? 0)),
      circuitOpenUntil: openUntil,
      circuitOpen: Number.isFinite(openTs) && openTs > Date.now(),
      lastRunAt: row.last_run_at || row.lastRunAt || null,
      lastStatus: String(row.last_status || row.lastStatus || 'never'),
      lastActionId: row.last_action_id || row.lastActionId || null,
      lastError: String(row.last_error || row.lastError || '').slice(0, 180),
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  }

  async function loadSettlementReliability(cfg) {
    if (!hasSupabase(cfg)) return normalizeSettlementReliability();
    const row = await supaSelectOne(cfg, 'settlement_watchdog_state', { id: 'eq.global' });
    return normalizeSettlementReliability(row || {});
  }

  async function saveSettlementReliability(cfg, patch = {}) {
    if (!hasSupabase(cfg)) return normalizeSettlementReliability(patch);
    const current = await loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability());
    const merged = {
      id: 'global',
      consecutive_failures: Math.max(0, Number(patch.consecutiveFailures ?? current.consecutiveFailures ?? 0)),
      circuit_open_until: patch.circuitOpenUntil !== undefined ? patch.circuitOpenUntil : current.circuitOpenUntil,
      last_run_at: patch.lastRunAt !== undefined ? patch.lastRunAt : current.lastRunAt,
      last_status: String(patch.lastStatus ?? current.lastStatus ?? 'never').slice(0, 32),
      last_action_id: patch.lastActionId !== undefined ? patch.lastActionId : current.lastActionId,
      last_error: String(patch.lastError !== undefined ? patch.lastError : current.lastError || '').slice(0, 180),
      updated_at: new Date().toISOString(),
    };
    await supaUpsert(cfg, 'settlement_watchdog_state', merged, 'id');
    return normalizeSettlementReliability(merged);
  }

  async function noteSettlementWatchdogOutcome(cfg, status, meta = {}) {
    const current = await loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability());
    const now = new Date().toISOString();
    if (['completed', 'partial'].includes(String(status))) {
      return await saveSettlementReliability(cfg, {
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        lastRunAt: now,
        lastStatus: String(status),
        lastActionId: meta.actionId || null,
        lastError: '',
      });
    }
    if (String(status) !== 'failed') {
      return await saveSettlementReliability(cfg, {
        lastRunAt: now,
        lastStatus: String(status || 'unknown'),
        lastActionId: meta.actionId || null,
        lastError: meta.error || '',
      });
    }
    const failures = Number(current.consecutiveFailures || 0) + 1;
    const circuitOpenUntil = failures >= SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD
      ? new Date(Date.now() + SETTLEMENT_CIRCUIT_OPEN_HOURS * 3600_000).toISOString()
      : current.circuitOpenUntil;
    return await saveSettlementReliability(cfg, {
      consecutiveFailures: failures,
      circuitOpenUntil,
      lastRunAt: now,
      lastStatus: 'failed',
      lastActionId: meta.actionId || null,
      lastError: meta.error || '',
    });
  }

  async function resetSettlementCircuit(cfg, user, reason) {
    const before = await loadSettlementReliability(cfg);
    const after = await saveSettlementReliability(cfg, {
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastRunAt: before.lastRunAt,
      lastStatus: 'reset',
      lastActionId: null,
      lastError: '',
    });
    const action = await recordRemediationAction(cfg, user, {
      actionType: 'circuit_reset',
      triggerSource: 'admin',
      status: 'completed',
      reason,
      candidateCount: 0,
      inspectedCount: 0,
      settledCount: 0,
      skippedCount: 0,
      fixtureIds: [],
      detail: {
        previousFailures: Number(before.consecutiveFailures || 0),
        previousOpenUntil: before.circuitOpenUntil || null,
      },
    });
    await recordOpsEvent(cfg, {
      severity: 'info',
      source: 'model',
      eventType: 'settlement_watchdog',
      code: 'SETTLEMENT_CIRCUIT_RESET',
      message: reason,
      meta: { previousFailures: before.consecutiveFailures, previousOpenUntil: before.circuitOpenUntil },
    }).catch(() => null);
    return { before, after, action };
  }

  async function recordRemediationAction(cfg, user, action) {
    const now = new Date().toISOString();
    const actionStatus = String(action.status || 'completed');
    const row = {
      action_id: String(action.actionId || crypto.randomUUID()),
      action_type: String(action.actionType || 'recover'),
      ...(action.triggerSource ? { trigger_source: String(action.triggerSource).slice(0, 20) } : {}),
      status: actionStatus,
      reason: redactOpsString(action.reason || '', 220),
      updated_at: now,
      finished_at: actionStatus === 'started' ? null : now,
      attempt_no: Math.max(1, Math.min(SETTLEMENT_RUN_MAX_ATTEMPTS, Number(action.attemptNo || 1))),
      retry_of_action_id: action.retryOfActionId ? String(action.retryOfActionId) : null,
      admin_telegram_id: positiveSafeInteger(user?.id),
      candidate_count: Number(action.candidateCount || 0),
      inspected_count: Number(action.inspectedCount || 0),
      settled_count: Number(action.settledCount || 0),
      skipped_count: Number(action.skippedCount || 0),
      fixture_ids: (action.fixtureIds || []).map(positiveSafeInteger).filter(id => id !== null).slice(0, 20),
      detail: action.detail || {},
    };
    if (hasSupabase(cfg)) await supaInsertIgnore(cfg, 'prediction_integrity_actions', row, 'action_id');
    memory.modelRemediation.actions.unshift({ ...row, created_at: now });
    memory.modelRemediation.actions = memory.modelRemediation.actions.slice(0, 20);
    return publicRemediationAction({ ...row, created_at: now });
  }

  async function finalizeRemediationAction(cfg, actionId, patch = {}) {
    const now = new Date().toISOString();
    const finalStatus = String(patch.status || 'completed');
    const update = {
      status: finalStatus,
      updated_at: now,
      finished_at: finalStatus === 'started' ? null : now,
      inspected_count: Number(patch.inspectedCount || 0),
      settled_count: Number(patch.settledCount || 0),
      skipped_count: Number(patch.skippedCount || 0),
      detail: patch.detail || {},
    };
    if (hasSupabase(cfg)) {
      await supaPatch(cfg, 'prediction_integrity_actions', { action_id: `eq.${String(actionId)}` }, update);
    }
    const idx = memory.modelRemediation.actions.findIndex(row => String(row?.action_id || '') === String(actionId));
    if (idx >= 0) memory.modelRemediation.actions[idx] = { ...memory.modelRemediation.actions[idx], ...update };
    const row = idx >= 0
      ? memory.modelRemediation.actions[idx]
      : { action_id: String(actionId), created_at: new Date().toISOString(), ...update };
    return publicRemediationAction(row);
  }

  async function buildModelRemediationReport(cfg, { maxRows = 5000 } = {}) {
    if (!hasSupabase(cfg) && !cfg.devMode) {
      return { available: false, reason: 'Supabase не настроен: восстановление требует постоянную базу данных.' };
    }
    const [schema, watchdogSchema, reliabilitySchema, runLedgerSchema, finalitySchema, trustSchema, adjudicationSchema, reliability, runtimeState] = await Promise.all([
      hasSupabase(cfg) ? probeOptionalTable(cfg, 'prediction_integrity_actions') : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementWatchdogSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementReliabilitySchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementRunLedgerSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementFinalitySchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementTrustSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? probeSettlementAdjudicationSchema(cfg) : Promise.resolve({ ok: true, status: 'memory' }),
      hasSupabase(cfg) ? loadSettlementReliability(cfg).catch(() => normalizeSettlementReliability()) : Promise.resolve(normalizeSettlementReliability()),
      loadRuntimeControls(cfg),
    ]);
    const loaded = await loadPredictionRemediationRows(cfg, maxRows);
    const settled = loaded.rows.filter(row => row.status === 'settled');
    const pending = loaded.rows.filter(row => row.status === 'pending');
    const candidates = stalePredictionCandidates(pending);
    const batch = selectRemediationBatch(candidates);
    const candidateToken = await remediationFingerprint(batch.selected);
    let recentActions = [];
    if (schema.ok) recentActions = await loadRemediationActions(cfg, 10).catch(() => []);
    const runLedger = runLedgerSchema.ok
      ? await inspectSettlementRunLedger(cfg).catch(() => ({ active: [], stale: [], cutoff: null }))
      : { active: [], stale: [], cutoff: null };
    const integrity = buildPredictionIntegrity(settled, pending);
    const finality = settlementFinalitySummary(loaded.rows);
    const driftReview = adjudicationSchema.ok
      ? await loadSettlementDriftReview(cfg, 20).catch(error => ({ schemaReady: true, schemaStatus: 'error', unresolved: 0, items: [], error: redactOpsString(error?.message || error, 160) }))
      : { schemaReady: false, schemaStatus: adjudicationSchema.status || 'missing', unresolved: 0, items: [] };
    return {
      available: true,
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      schemaReady: Boolean(schema.ok),
      schemaStatus: schema.status || (schema.ok ? 'ok' : 'missing'),
      scan: {
        loadedRows: loaded.rows.length,
        settledRows: settled.length,
        pendingRows: pending.length,
        maxRows,
        truncated: Boolean(loaded.truncated),
      },
      integrity,
      recovery: {
        stalePending: candidates.length,
        selectedCount: batch.selected.length,
        candidateToken,
        fixtureIds: batch.selected.map(row => Number(row.fixture_id)),
        estimatedProviderCalls: batch.dates.length,
        maxFixturesPerRun: 20,
        maxDatesPerRun: 5,
        candidates: batch.selected.map(row => ({
          fixtureId: Number(row.fixture_id),
          kickoffAt: row.kickoff_at,
          league: String(row.league_name || ''),
          home: String(row.home_name || ''),
          away: String(row.away_name || ''),
          ageHours: Math.max(0, Math.floor((Date.now() - Date.parse(row.kickoff_at || 0)) / 3600_000)),
        })),
      },
      recentActions,
      driftReview,
      watchdog: {
        schemaReady: Boolean(watchdogSchema.ok),
        schemaStatus: watchdogSchema.status || (watchdogSchema.ok ? 'ok' : 'missing'),
        mode: runtimeState.value?.autoSettlementRecoveryEnabled ? 'active' : 'shadow',
        autoRecoveryEnabled: Boolean(runtimeState.value?.autoSettlementRecoveryEnabled),
        scheduleUtc: '04:00',
        maxRunsPerDay: 1,
        maxFixturesPerRun: 20,
        maxDatesPerRun: 5,
        quotaGuard: true,
        reliability: {
          schemaReady: Boolean(reliabilitySchema.ok),
          schemaStatus: reliabilitySchema.status || (reliabilitySchema.ok ? 'ok' : 'missing'),
          consecutiveFailures: Number(reliability.consecutiveFailures || 0),
          circuitOpen: Boolean(reliability.circuitOpen),
          circuitOpenUntil: reliability.circuitOpenUntil || null,
          lastRunAt: reliability.lastRunAt || null,
          lastStatus: reliability.lastStatus || 'never',
          lastActionId: reliability.lastActionId || null,
          lastError: reliability.lastError || '',
          failureThreshold: SETTLEMENT_CIRCUIT_FAILURE_THRESHOLD,
          openHours: SETTLEMENT_CIRCUIT_OPEN_HOURS,
        },
        runLedger: {
          schemaReady: Boolean(runLedgerSchema.ok),
          schemaStatus: runLedgerSchema.status || (runLedgerSchema.ok ? 'ok' : 'missing'),
          activeStarted: Number(runLedger.active?.length || 0),
          staleStarted: Number(runLedger.stale?.length || 0),
          staleAfterMinutes: SETTLEMENT_RUN_STALE_MINUTES,
          maxAttempts: SETTLEMENT_RUN_MAX_ATTEMPTS,
        },
        finality: {
          schemaReady: Boolean(finalitySchema.ok && trustSchema.ok),
          schemaStatus: finalitySchema.ok && trustSchema.ok
            ? 'ok'
            : `finality_${finalitySchema.status || 'missing'}_trust_${trustSchema.status || 'missing'}`,
          trustSchemaReady: Boolean(trustSchema.ok),
          verified: Number(finality.verified || 0),
          confirmed: Number(finality.confirmed || 0),
          drift: Number(finality.drift || 0),
          unverified: Number(finality.unverified || 0),
          adjudicated: Number(finality.adjudicated || 0),
          trustedForMetrics: Number(finality.trustedForMetrics || 0),
          totalSettled: Number(finality.totalSettled || 0),
          scheduleUtc: '05:00',
          delayHours: SETTLEMENT_FINALITY_DELAY_HOURS,
          confirmationDelayHours: SETTLEMENT_FINALITY_CONFIRM_DELAY_HOURS,
          trustedStates: ['confirmed', 'adjudicated'],
          lookbackDays: SETTLEMENT_FINALITY_LOOKBACK_DAYS,
          maxDatesPerRun: SETTLEMENT_FINALITY_MAX_DATES,
        },
      },
      policy: {
        dryRunFirst: true,
        deletesPredictions: false,
        rewritesSnapshots: false,
        onlySettlesPending: true,
        adminIdExposed: false,
        automaticRecoveryRuntimeGated: true,
        note: 'Запрос выполняет только предварительную проверку без изменений. В метрики качества и калибровку попадают только результаты, подтверждённые повторной проверкой спустя 24+ часа, либо явно разобранные администратором.',
      },
    };
  }

  function settlementWatchdogDecision(report, runtime, { providerReady = true, quotaHealthy = true, schemaReady = true, runtimeVerified = true, circuitOpen = false } = {}) {
    const stalePending=boundedCount(report?.recovery?.stalePending);
    const selectedCount=boundedCount(report?.recovery?.selectedCount);
    const providerCalls=boundedCount(report?.recovery?.estimatedProviderCalls);
    if (!report?.available) return { state: 'unavailable', recover: false, stalePending, selectedCount, providerCalls };
    if (!schemaReady || !report?.schemaReady) return { state: 'schema_missing', recover: false, stalePending, selectedCount, providerCalls };
    if (!stalePending) return { state: 'clean', recover: false, stalePending, selectedCount, providerCalls };
    if (!runtimeVerified) return { state: 'runtime_unverified', recover: false, stalePending, selectedCount, providerCalls };
    if (!runtime?.autoSettlementRecoveryEnabled) return { state: 'observe', recover: false, stalePending, selectedCount, providerCalls };
    if (circuitOpen) return { state: 'circuit_open', recover: false, stalePending, selectedCount, providerCalls };
    if (!providerReady) return { state: 'provider_missing', recover: false, stalePending, selectedCount, providerCalls };
    if (!quotaHealthy) return { state: 'quota_guard', recover: false, stalePending, selectedCount, providerCalls };
    if (!selectedCount || !providerCalls) return { state: 'no_batch', recover: false, stalePending, selectedCount, providerCalls };
    return { state: 'recover', recover: true, stalePending, selectedCount, providerCalls };
  }

  function settlementWatchdogSelfTest() {
    const report = {
      available: true,
      schemaReady: true,
      recovery: { stalePending: 7, selectedCount: 5, estimatedProviderCalls: 2 },
    };
    const shadow = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: false }, { schemaReady: true, providerReady: true, quotaHealthy: true });
    const unverified = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: false, providerReady: true, quotaHealthy: true });
    const quota = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: false });
    const circuit = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: true, circuitOpen: true });
    const recover = settlementWatchdogDecision(report, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, runtimeVerified: true, providerReady: true, quotaHealthy: true });
    const clean = settlementWatchdogDecision({ ...report, recovery: { stalePending: 0, selectedCount: 0, estimatedProviderCalls: 0 } }, { autoSettlementRecoveryEnabled: true }, { schemaReady: true, providerReady: true, quotaHealthy: true });
    return {
      pass: shadow.state === 'observe' && !shadow.recover && unverified.state === 'runtime_unverified' && !unverified.recover && quota.state === 'quota_guard' && !quota.recover && circuit.state === 'circuit_open' && !circuit.recover && recover.state === 'recover' && recover.recover && clean.state === 'clean',
      shadow: shadow.state,
      runtime: unverified.state,
      quota: quota.state,
      circuit: circuit.state,
      active: recover.state,
      clean: clean.state,
    };
  }

  function automaticSettlementQuotaHealthy() {
    const p = memory.provider || {};
    const paid = ['PRO', 'ULTRA', 'MEGA'].includes(String(p.plan || '').toUpperCase());
    if (paid) return !providerSnapshot().cooldownActive;
    const dailyKnown=finiteNumericCandidate(p.dailyRemaining)!==null;
    const minuteKnown=finiteNumericCandidate(p.minuteRemaining)!==null;
    if (!dailyKnown || !minuteKnown) return false;
    return freeQuotaHealthy(15, 4);
  }

  async function runSettlementWatchdog(cfg) {
    if (!hasSupabase(cfg)) return { skipped: 'no_persistent_database' };
    const markerKey = `settlement-watchdog:${todayUtc()}:v1`;
    const runLedgerSchema = await probeSettlementRunLedgerSchema(cfg);
    if (!runLedgerSchema.ok) return { skipped: 'run_ledger_schema_missing', status: runLedgerSchema.status };
    const reconciliation = await reconcileInterruptedSettlementActions(cfg);
    const ledgerAfter = await inspectSettlementRunLedger(cfg);
    if (ledgerAfter.active.length) {
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'model',
        eventType: 'settlement_watchdog',
        code: 'SETTLEMENT_RUN_IN_PROGRESS',
        message: 'Проверка фиксации результатов пропущена: другой запуск ещё выполняется.',
        meta: {
          activeRuns: ledgerAfter.active.length,
          staleAfterMinutes: SETTLEMENT_RUN_STALE_MINUTES,
          actionIds: ledgerAfter.active.map(x => String(x.action_id)).slice(0, 10),
        },
      }).catch(() => null);
      return { skipped: 'run_in_progress', activeRuns: ledgerAfter.active.length };
    }
    if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date: todayUtc(), reconciledInterrupted: reconciliation.reconciled.length };
  
    const report = await buildModelRemediationReport(cfg, { maxRows: 5000 });
    const runtimeState = await loadRuntimeControls(cfg);
    const runtime = runtimeState.value || DEFAULT_RUNTIME_CONTROLS;
    const decision = settlementWatchdogDecision(report, runtime, {
      schemaReady: Boolean(report?.watchdog?.schemaReady),
      runtimeVerified: runtimeState.source === 'supabase',
      providerReady: Boolean(cfg.apiFootballKey),
      quotaHealthy: automaticSettlementQuotaHealthy(),
      circuitOpen: Boolean(report?.watchdog?.reliability?.circuitOpen),
    });
    const baseMeta = {
      state: decision.state,
      stalePending: decision.stalePending,
      selectedCount: decision.selectedCount,
      providerCalls: decision.providerCalls,
      scanTruncated: Boolean(report?.scan?.truncated),
      autoRecoveryEnabled: Boolean(runtime.autoSettlementRecoveryEnabled),
      runtimeVerified: runtimeState.source === 'supabase',
      runtimeRevision: Number(runtime.revision || 1),
      circuitOpen: Boolean(report?.watchdog?.reliability?.circuitOpen),
      circuitOpenUntil: report?.watchdog?.reliability?.circuitOpenUntil || null,
      consecutiveFailures: Number(report?.watchdog?.reliability?.consecutiveFailures || 0),
      reconciledInterrupted: Number(reconciliation.reconciled?.length || 0),
      runLedgerActive: Number(ledgerAfter.active?.length || 0),
    };
  
    if (decision.state === 'clean') {
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta }, cfg, 1440).catch(() => null);
      return { ok: true, ...baseMeta };
    }
  
    if (!decision.recover) {
      const severity = ['schema_missing', 'runtime_unverified', 'provider_missing', 'quota_guard', 'circuit_open', 'unavailable'].includes(decision.state) ? 'warning' : 'info';
      const code = ({
        observe: 'SETTLEMENT_WATCHDOG_OBSERVE',
        schema_missing: 'SETTLEMENT_WATCHDOG_SCHEMA',
        runtime_unverified: 'SETTLEMENT_WATCHDOG_RUNTIME',
        provider_missing: 'SETTLEMENT_WATCHDOG_PROVIDER',
        quota_guard: 'SETTLEMENT_WATCHDOG_QUOTA',
        circuit_open: 'SETTLEMENT_WATCHDOG_CIRCUIT_OPEN',
        no_batch: 'SETTLEMENT_WATCHDOG_NO_BATCH',
        unavailable: 'SETTLEMENT_WATCHDOG_UNAVAILABLE',
      })[decision.state] || 'SETTLEMENT_WATCHDOG';
      await recordOpsEvent(cfg, {
        severity,
        source: 'model',
        eventType: 'settlement_watchdog',
        code,
        message: decision.state === 'observe'
          ? `Settlement watchdog detected ${decision.stalePending} stale pending; automatic recovery is paused by runtime control.`
          : `Settlement watchdog did not execute recovery: ${decision.state}.`,
        meta: baseMeta,
      }).catch(() => null);
      if (decision.state !== 'quota_guard') {
        await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta }, cfg, 1440).catch(() => null);
      }
      return { ok: true, ...baseMeta };
    }
  
    const currentIds=[...new Set(
      (Array.isArray(report.recovery?.fixtureIds) ? report.recovery.fixtureIds : [])
        .map(positiveSafeInteger)
        .filter(id=>id!==null),
    )];
    const candidateMap=new Map(
      (Array.isArray(report.recovery?.candidates) ? report.recovery.candidates : [])
        .map(row=>[positiveSafeInteger(row?.fixtureId),row])
        .filter(([id])=>id!==null),
    );
    const dates = [...new Set(currentIds.map(id => String(candidateMap.get(id)?.kickoffAt || '').slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
    const fixtureSet = new Set(currentIds);
    const fixtures = [];
    const retry = await resolveSettlementRetryLineage(cfg, currentIds);
    if (retry.retryExhausted) {
      await recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'model',
        eventType: 'settlement_watchdog',
        code: 'SETTLEMENT_RETRY_EXHAUSTED',
        message: 'Для текущего пакета матчей исчерпан лимит повторных попыток фиксации результатов.',
        meta: { ...baseMeta, retryOfActionId: retry.retryOfActionId, maxAttempts: SETTLEMENT_RUN_MAX_ATTEMPTS },
      }).catch(() => null);
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta, state: 'retry_exhausted' }, cfg, 1440).catch(() => null);
      return { ok: true, ...baseMeta, state: 'retry_exhausted', retryOfActionId: retry.retryOfActionId };
    }
    const actionId = crypto.randomUUID();
    const reason = 'Плановое восстановление ожидающих результатов';
    let auditStarted = false;
    let executionResult = null;
  
    try {
      await recordRemediationAction(cfg, null, {
        actionId,
        actionType: 'auto_recover',
        triggerSource: 'cron',
        status: 'started',
        reason,
        attemptNo: retry.attemptNo,
        retryOfActionId: retry.retryOfActionId,
        candidateCount: Number(report.recovery?.stalePending || 0),
        inspectedCount: currentIds.length,
        settledCount: 0,
        skippedCount: currentIds.length,
        fixtureIds: currentIds,
        detail: {
          phase: 'preflight',
          providerCallsPlanned: dates.length,
          scanTruncated: Boolean(report.scan?.truncated),
          runtimeRevision: Number(runtime.revision || 1),
          candidateToken: String(report.recovery?.candidateToken || ''),
          batchKey: settlementBatchKey(currentIds),
          attemptNo: retry.attemptNo,
          retryOfActionId: retry.retryOfActionId,
        },
      });
      auditStarted = true;
  
      for (const date of dates) {
        const rows = await loadProviderFixturesForDate(date, cfg);
        fixtures.push(...rows.filter(fixture => fixtureSet.has(fixtureIdentity(fixture))));
      }
      const settlement = await settlePredictionsFromFixtures(fixtures, cfg);
      const after = await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${currentIds.join(',')})` }, { limit: currentIds.length + 2 });
      const settledCount = after.filter(row => row.status === 'settled').length;
      const skippedCount = Math.max(0, currentIds.length - settledCount);
      const status = skippedCount ? 'partial' : 'completed';
      executionResult = { settledCount, skippedCount, status };
      const action = await finalizeRemediationAction(cfg, actionId, {
        status,
        inspectedCount: currentIds.length,
        settledCount,
        skippedCount,
        detail: {
          phase: 'final',
          providerCalls: dates.length,
          finishedFixtures: fixtures.filter(f => isFinishedStatus(fixtureStatusShort(f))).length,
          settlementChecked: settlement.checked,
          scanTruncated: Boolean(report.scan?.truncated),
          runtimeRevision: Number(runtime.revision || 1),
        },
      });
      memory.modelRemediation.lastRun = action;
      await recordOpsEvent(cfg, {
        severity: skippedCount ? 'warning' : 'info',
        source: 'model',
        eventType: 'settlement_watchdog',
        code: skippedCount ? 'SETTLEMENT_WATCHDOG_PARTIAL' : 'SETTLEMENT_WATCHDOG_COMPLETED',
        message: `${reason}: завершено ${settledCount}, пропущено ${skippedCount}.`,
        meta: { ...baseMeta, actionId, settledCount, skippedCount },
      }).catch(() => null);
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), ...baseMeta, actionId, settledCount, skippedCount, status }, cfg, 1440).catch(() => null);
      return { ok: true, ...baseMeta, actionId, settledCount, skippedCount, status };
    } catch (error) {
      if (executionResult) {
        await noteSettlementWatchdogOutcome(cfg, executionResult.status, { actionId }).catch(() => null);
        await recordOpsEvent(cfg, {
          severity: 'error',
          source: 'model',
          eventType: 'settlement_watchdog',
          code: 'SETTLEMENT_WATCHDOG_AUDIT_FINALIZE_FAILED',
          message: error?.message || error,
          meta: { ...baseMeta, actionId, ...executionResult, auditStatus: 'started' },
        }).catch(() => null);
        await setCache(markerKey, 0, {
          checkedAt: new Date().toISOString(),
          ...baseMeta,
          actionId,
          ...executionResult,
          auditPending: true,
        }, cfg, 1440).catch(() => null);
        return { ok: true, ...baseMeta, actionId, ...executionResult, auditPending: true };
      }
      await noteSettlementWatchdogOutcome(cfg, 'failed', { actionId, error: redactOpsString(error?.message || error, 180) }).catch(() => null);
      const failurePatch = {
        status: 'failed',
        inspectedCount: currentIds.length,
        settledCount: 0,
        skippedCount: currentIds.length,
        detail: {
          phase: auditStarted ? 'execution' : 'audit_preflight',
          providerCalls: dates.length,
          scanTruncated: Boolean(report.scan?.truncated),
          runtimeRevision: Number(runtime.revision || 1),
          error: redactOpsString(error?.message || error, 180),
        },
      };
      if (auditStarted) {
        await finalizeRemediationAction(cfg, actionId, failurePatch).catch(() => null);
      } else {
        await recordRemediationAction(cfg, null, {
          actionId,
          actionType: 'auto_recover',
          triggerSource: 'cron',
          status: 'failed',
          reason,
          attemptNo: retry.attemptNo,
          retryOfActionId: retry.retryOfActionId,
          candidateCount: Number(report.recovery?.stalePending || 0),
          inspectedCount: currentIds.length,
          settledCount: 0,
          skippedCount: currentIds.length,
          fixtureIds: currentIds,
          detail: failurePatch.detail,
        }).catch(() => null);
      }
      await recordOpsEvent(cfg, {
        severity: 'error',
        source: 'model',
        eventType: 'settlement_watchdog',
        code: 'SETTLEMENT_WATCHDOG_FAILED',
        message: error?.message || error,
        meta: { ...baseMeta, actionId },
      }).catch(() => null);
      return { ok: false, ...baseMeta, actionId, error: redactOpsString(error?.message || error, 180) };
    }
  }

  async function settleBacktestDaily(cfg) {
    if (!hasSupabase(cfg) || !cfg.apiFootballKey) return { skipped: 'no_persistent_database_or_provider' };
    const d = new Date(Date.now() - 86400_000);
    const date = d.toISOString().slice(0, 10);
    const markerKey = `backtest:settled:${date}:v1`;
    if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date };
    const start = `${date}T00:00:00.000Z`;
    const end = new Date(Date.parse(start) + 86400_000).toISOString();
    let pending = [];
    try {
      pending = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${start}` }, { limit: 200, order: 'kickoff_at.asc' });
    } catch (error) {
      console.warn('daily backtest pending read skipped', error?.message || error);
      return { skipped: 'prediction_table_unavailable' };
    }
    pending = pending.filter(x => Date.parse(x.kickoff_at || '') < Date.parse(end));
    if (!pending.length) {
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: 0 }, cfg, 1440);
      return { date, pending: 0, settled: 0 };
    }
    if (!freeQuotaHealthy(12, 3)) return { skipped: 'provider_quota_guard', date, pending: pending.length };
    try {
      const fixtures = await loadProviderFixturesForDate(date, cfg);
      const result = await settlePredictionsFromFixtures(fixtures, cfg);
      await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: pending.length, settled: result.settled }, cfg, 1440);
      return { date, pending: pending.length, settled: result.settled };
    } catch (error) {
      console.warn('daily backtest settle skipped', error?.message || error);
      return { skipped: 'provider_error', date };
    }
  }

  return Object.freeze({
    buildModelRemediationReport,
    buildPredictionIntegrity,
    captureModelPrediction,
    modelIntegritySelfTest,
    modelQualityEligibleRow,
    modelRemediationSelfTest,
    noteSettlementWatchdogOutcome,
    probeSettlementAdjudicationSchema,
    probeSettlementFinalitySchema,
    probeSettlementReliabilitySchema,
    probeSettlementRunLedgerSchema,
    probeSettlementTrustSchema,
    probeSettlementWatchdogSchema,
    recordRemediationAction,
    resetSettlementCircuit,
    resolveSettlementDrift,
    runSettlementFinalityVerification,
    runSettlementWatchdog,
    settleBacktestDaily,
    settlePredictionsFromFixtures,
    settlementDriftAdjudicationSelfTest,
    settlementDriftBeforeSnapshot,
    settlementDriftProviderSnapshot,
    settlementFinalitySelfTest,
    settlementRunLedgerSelfTest,
    settlementWatchdogSelfTest,
    trustedMetricsGateSelfTest,
    verifiedBrierScore,
    verifiedSettledRows,
  });
}
