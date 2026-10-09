export function createCalibrationRuntime(deps = {}) {
  const {
    APP_VERSION,
    CALIBRATION_CACHE_KEY,
    CALIBRATION_CACHE_MINUTES,
    CALIBRATION_PROFILE_VERSION,
    MODEL_BASE_WEIGHTS,
    average,
    averageMetric,
    brierFromProbabilities,
    calibrationProfileFingerprint,
    clamp,
    evaluatePostPromotionRollback,
    evaluatePromotionWindows,
    fetchWithTimeout,
    getCache,
    hasSupabase,
    logLossFromProbabilities,
    memory,
    normalizeThree,
    parseJsonObject,
    pct,
    predictedOutcomeForProbabilities,
    probeOptionalTable,
    recordOpsEvent,
    redactOpsString,
    rowFinalProbabilities,
    rowRawProbabilities,
    safeOpsMetadata,
    sendTelegramMessage,
    setCache,
    splitRollingValidation,
    supaHeaders,
    supaInsertIgnore,
    supaRpc,
    supaSelectMany,
    supaSelectOne,
    temperatureScaleProbabilities,
    validThreeProbabilities,
    verifiedSettledRows
  } = deps;

  function fitTemperatureCalibration(rows) {
    const valid = (rows || [])
      .filter(row => ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row))
      .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
    const split = splitRollingValidation(valid);
    if (!split.ready) {
      return { active: false, temperature: 1, candidateTemperature: 1, sample: valid.length, trainSample: 0, validationSample: 0, validationWindows: [], baselineLogLoss: null, calibratedLogLoss: null, improvement: null, reason: 'Нужно минимум 80 доверенных матчей для двух последовательных окон отложенной выборки.' };
    }
  
    const { train, windows } = split;
  
    let bestTemperature = 1;
    let bestTrainLoss = Infinity;
    for (let t = 0.8; t <= 1.3501; t += 0.05) {
      const temperature = Math.round(t * 100) / 100;
      const loss = averageMetric(train, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), temperature), row.actual_outcome));
      if (Number.isFinite(loss) && loss < bestTrainLoss) {
        bestTrainLoss = loss;
        bestTemperature = temperature;
      }
    }
  
    const validationWindows = windows.map(window => {
      const baselineLogLoss = averageMetric(window, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
      const candidateLogLoss = averageMetric(window, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
      const baselineBrier = averageMetric(window, row => brierFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
      const candidateBrier = averageMetric(window, row => brierFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
      return {
        sample: window.length,
        from: window[0]?.kickoff_at || null,
        to: window.at(-1)?.kickoff_at || null,
        baselineBrier,
        candidateBrier,
        baselineLogLoss,
        candidateLogLoss,
      };
    });
    const gate = evaluatePromotionWindows(validationWindows);
    const validation = windows.flat();
    const baselineValidation = averageMetric(validation, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
    const candidateValidation = averageMetric(validation, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
    const gain = Number.isFinite(baselineValidation) && Number.isFinite(candidateValidation) ? baselineValidation - candidateValidation : 0;
    const active = Math.abs(bestTemperature - 1) >= 0.04 && gate.pass;
    return {
      active,
      temperature: active ? bestTemperature : 1,
      candidateTemperature: bestTemperature,
      sample: valid.length,
      trainSample: train.length,
      validationSample: validation.length,
      validationWindows: gate.windows,
      baselineLogLoss: Number.isFinite(baselineValidation) ? Math.round(baselineValidation * 1000) / 1000 : null,
      calibratedLogLoss: Number.isFinite(candidateValidation) ? Math.round(candidateValidation * 1000) / 1000 : null,
      improvement: Number.isFinite(baselineValidation) && baselineValidation > 0 ? Math.round((gain / baselineValidation) * 1000) / 10 : null,
      reason: gate.reason,
    };
  }
  
  function signalCalibrationStats(rows) {
    const names = Object.keys(MODEL_BASE_WEIGHTS);
    return names.map(name => {
      const samples = [];
      for (const row of rows || []) {
        const signalMap = parseJsonObject(row?.signal_probabilities);
        const probabilities = signalMap?.[name];
        if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(row?.actual_outcome || ''))) continue;
        samples.push({ probabilities, actualOutcome: String(row.actual_outcome) });
      }
      const briers = samples.map(x => brierFromProbabilities(x.probabilities, x.actualOutcome)).filter(Number.isFinite);
      const hits = samples.filter(x => predictedOutcomeForProbabilities(x.probabilities) === x.actualOutcome).length;
      const avgBrier = briers.length ? average(briers) : null;
      return {
        name,
        sample: samples.length,
        accuracy: pct(hits, samples.length),
        avgBrier: Number.isFinite(avgBrier) ? Math.round(avgBrier * 1000) / 1000 : null,
        baseWeight: MODEL_BASE_WEIGHTS[name],
      };
    });
  }
  
  function adaptiveSignalWeights(stats) {
    const eligible = (stats || []).filter(x => x.sample >= 30 && Number.isFinite(Number(x.avgBrier)));
    const active = eligible.length >= 2;
    if (!active) return { active: false, weights: { ...MODEL_BASE_WEIGHTS }, stats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] })) };
  
    const unnormalized = {};
    for (const item of stats || []) {
      const base = Number(MODEL_BASE_WEIGHTS[item.name] || 0);
      if (!base) continue;
      let adjusted = base;
      if (item.sample >= 30 && Number.isFinite(Number(item.avgBrier))) {
        // Uniform 1X2 has Brier ~= 0.222. Convert skill into a small, strongly capped weight adjustment.
        const qualityFactor = clamp(0.2222 / Math.max(0.12, Number(item.avgBrier)), 0.85, 1.15);
        const shrink = Math.min(1, item.sample / 100) * 0.65;
        adjusted = base * (1 + (qualityFactor - 1) * shrink);
        adjusted = clamp(adjusted, base * 0.88, base * 1.12);
      }
      unnormalized[item.name] = adjusted;
    }
    const sum = Object.values(unnormalized).reduce((acc, value) => acc + Number(value || 0), 0) || 1;
    const weights = Object.fromEntries(Object.entries(unnormalized).map(([name, value]) => [name, Number(value) / sum]));
    return {
      active: true,
      weights,
      stats: (stats || []).map(x => ({ ...x, currentWeight: Number(weights[x.name] ?? MODEL_BASE_WEIGHTS[x.name] ?? 0) })),
    };
  }
  
  
  function rowSignalBlendProbabilities(row, weightOverrides = MODEL_BASE_WEIGHTS) {
    const signalMap = parseJsonObject(row?.signal_probabilities);
    const configured = weightOverrides && typeof weightOverrides === 'object' ? weightOverrides : MODEL_BASE_WEIGHTS;
    const candidates = Object.keys(MODEL_BASE_WEIGHTS)
      .map(name => [name, signalMap?.[name], Number(configured[name] ?? MODEL_BASE_WEIGHTS[name])])
      .filter(([, probabilities, weight]) => validThreeProbabilities(probabilities) && Number.isFinite(weight) && weight > 0);
    if (candidates.length < 2) return null;
    const total = candidates.reduce((sum, row) => sum + row[2], 0);
    if (!(total > 0)) return null;
    let home = 0, draw = 0, away = 0;
    for (const [, probabilities, rawWeight] of candidates) {
      const weight = rawWeight / total;
      home += Number(probabilities.home) * weight;
      draw += Number(probabilities.draw) * weight;
      away += Number(probabilities.away) * weight;
    }
    return normalizeThree(home, draw, away);
  }
  
  function fitAdaptiveSignalWeightsHoldout(rows) {
    const valid = (rows || [])
      .filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')) && rowSignalBlendProbabilities(row, MODEL_BASE_WEIGHTS))
      .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
  
    const fallbackStats = signalCalibrationStats(valid);
    const split = splitRollingValidation(valid);
    if (!split.ready) {
      return {
        active: false,
        weights: { ...MODEL_BASE_WEIGHTS },
        candidateWeights: { ...MODEL_BASE_WEIGHTS },
        stats: fallbackStats.map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] || 0 })),
        sample: valid.length,
        trainSample: 0,
        validationSample: 0,
        baselineBrier: null,
        candidateBrier: null,
        baselineLogLoss: null,
        candidateLogLoss: null,
        brierGain: null,
        logLossGain: null,
        validationWindows: [],
        changedWeightL1: 0,
        reason: 'Нужно минимум 80 доверенных матчей для двух последовательных окон проверки весов.',
      };
    }
  
    const { train, windows } = split;
    const validation = windows.flat();
    const trainStats = signalCalibrationStats(train);
    const candidate = adaptiveSignalWeights(trainStats);
  
    if (!candidate.active) {
      return {
        active: false,
        weights: { ...MODEL_BASE_WEIGHTS },
        candidateWeights: candidate.weights || { ...MODEL_BASE_WEIGHTS },
        stats: candidate.stats || fallbackStats,
        sample: valid.length,
        trainSample: train.length,
        validationSample: validation.length,
        baselineBrier: null,
        candidateBrier: null,
        baselineLogLoss: null,
        candidateLogLoss: null,
        brierGain: null,
        logLossGain: null,
        validationWindows: [],
        changedWeightL1: 0,
        reason: 'Обучающая часть ещё не сформировала устойчивый кандидат весов.',
      };
    }
  
    const evaluateRows = source => source.map(row => ({
        source: row,
        actualOutcome: String(row.actual_outcome),
        baseline: rowSignalBlendProbabilities(row, MODEL_BASE_WEIGHTS),
        candidate: rowSignalBlendProbabilities(row, candidate.weights),
      })).filter(row => row.baseline && row.candidate);
    const evaluated = evaluateRows(validation);
    const validationWindows = windows.map(window => {
      const windowRows = evaluateRows(window);
      return {
        sample: windowRows.length,
        from: windowRows[0]?.source?.kickoff_at || null,
        to: windowRows.at(-1)?.source?.kickoff_at || null,
        baselineBrier: averageMetric(windowRows, row => brierFromProbabilities(row.baseline, row.actualOutcome)),
        candidateBrier: averageMetric(windowRows, row => brierFromProbabilities(row.candidate, row.actualOutcome)),
        baselineLogLoss: averageMetric(windowRows, row => logLossFromProbabilities(row.baseline, row.actualOutcome)),
        candidateLogLoss: averageMetric(windowRows, row => logLossFromProbabilities(row.candidate, row.actualOutcome)),
      };
    });
    const gate = evaluatePromotionWindows(validationWindows);
  
    const baselineBrier = averageMetric(evaluated, row => brierFromProbabilities(row.baseline, row.actualOutcome));
    const candidateBrier = averageMetric(evaluated, row => brierFromProbabilities(row.candidate, row.actualOutcome));
    const baselineLogLoss = averageMetric(evaluated, row => logLossFromProbabilities(row.baseline, row.actualOutcome));
    const candidateLogLoss = averageMetric(evaluated, row => logLossFromProbabilities(row.candidate, row.actualOutcome));
    const brierGain = Number.isFinite(baselineBrier) && Number.isFinite(candidateBrier) ? baselineBrier - candidateBrier : null;
    const logLossGain = Number.isFinite(baselineLogLoss) && Number.isFinite(candidateLogLoss) ? baselineLogLoss - candidateLogLoss : null;
    const changedWeightL1 = Object.keys(MODEL_BASE_WEIGHTS)
      .reduce((sum, name) => sum + Math.abs(Number(candidate.weights?.[name] || 0) - Number(MODEL_BASE_WEIGHTS[name] || 0)), 0);
  
    // RC30 gate: both sequential holdout windows must beat the baseline.
    const active = changedWeightL1 >= 0.01 && gate.pass;
  
    return {
      active,
      weights: active ? candidate.weights : { ...MODEL_BASE_WEIGHTS },
      candidateWeights: candidate.weights,
      stats: candidate.stats,
      sample: valid.length,
      trainSample: train.length,
      validationSample: evaluated.length,
      validationWindows: gate.windows,
      baselineBrier: Number.isFinite(baselineBrier) ? Math.round(baselineBrier * 10000) / 10000 : null,
      candidateBrier: Number.isFinite(candidateBrier) ? Math.round(candidateBrier * 10000) / 10000 : null,
      baselineLogLoss: Number.isFinite(baselineLogLoss) ? Math.round(baselineLogLoss * 1000) / 1000 : null,
      candidateLogLoss: Number.isFinite(candidateLogLoss) ? Math.round(candidateLogLoss * 1000) / 1000 : null,
      brierGain: Number.isFinite(brierGain) ? Math.round(brierGain * 10000) / 10000 : null,
      logLossGain: Number.isFinite(logLossGain) ? Math.round(logLossGain * 1000) / 1000 : null,
      changedWeightL1: Math.round(changedWeightL1 * 10000) / 10000,
      reason: active ? gate.reason : `Кандидат весов остаётся в тени: ${gate.reason}`,
    };
  }
  
  function calibrationPromotionSelfTest() {
    const signalFor = (actual, strength, wrong = false) => {
      const key = wrong ? (actual === 'home' ? 'away' : 'home') : actual;
      const draw = Math.round((100 - strength) * 0.3);
      return key === 'home'
        ? { home: strength, draw, away: 100 - strength - draw }
        : { home: 100 - strength - draw, draw, away: strength };
    };
    const makeRows = (overfit = false) => Array.from({ length: 80 }, (_, index) => {
      const actual = index % 2 === 0 ? 'home' : 'away';
      const validation = index >= 64;
      return {
        fixture_id: index + 1,
        kickoff_at: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        actual_outcome: actual,
        signal_probabilities: {
          // Train says market is strong and the other signals are weak.
          // Stable holdout keeps that relationship; overfit holdout flips it.
          market: signalFor(actual, 90, overfit && validation),
          apiPrediction: signalFor(actual, 70, true),
          recentForm: signalFor(actual, validation && overfit ? 90 : 75, !(validation && overfit)),
          h2h: signalFor(actual, 65, true),
        },
      };
    });
    const stable = fitAdaptiveSignalWeightsHoldout(makeRows(false));
    const overfit = fitAdaptiveSignalWeightsHoldout(makeRows(true));
    return {
      pass: stable.active &&
        stable.validationSample >= 12 &&
        Number(stable.brierGain) >= 0.001 &&
        Number(stable.logLossGain) >= 0 &&
        !overfit.active,
      stableActive: stable.active,
      stableValidation: stable.validationSample,
      stableBrierGain: stable.brierGain,
      stableLogLossGain: stable.logLossGain,
      overfitBlocked: !overfit.active,
      overfitBrierGain: overfit.brierGain,
      overfitLogLossGain: overfit.logLossGain,
    };
  }
  
  async function probeCalibrationPromotionSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/model_calibration_validations`);
      url.searchParams.set('select', 'candidate_fingerprint,profile_version,decision,validation_sample');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase calibration promotion schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error', detail: redactOpsString(error?.message || error, 140) };
    }
  }
  
  async function calibrationPromotionFingerprint(profile) {
    return await calibrationProfileFingerprint({
      ...profile,
      temperature: profile?.temperatureActive ? profile?.temperature : 1,
      signalWeights: profile?.weightsActive ? profile?.signalWeights : { ...MODEL_BASE_WEIGHTS },
    });
  }
  
  function calibrationMetricOrNull(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  }
  
  async function persistCalibrationPromotionValidation(cfg, profile) {
    if (!hasSupabase(cfg) || !profile?.promotionGate?.validationReady) return;
    const schema = await probeCalibrationPromotionSchema(cfg);
    if (!schema.ok) return;
    const weights = profile.weightsValidation || {};
    const temp = profile.temperatureValidation || {};
    const candidateFingerprint = await calibrationPromotionFingerprint(profile);
    await supaInsertIgnore(cfg, 'model_calibration_validations', {
      candidate_fingerprint: candidateFingerprint,
      profile_version: String(profile.version || CALIBRATION_PROFILE_VERSION),
      decision: String(profile.promotionGate.status || 'shadow'),
      trusted_sample: Number(profile.sample || 0),
      train_sample: Math.max(Number(weights.trainSample || 0), Number(temp.trainSample || 0)),
      validation_sample: Math.max(Number(weights.validationSample || 0), Number(temp.validationSample || 0)),
      temperature_candidate: Number(temp.candidateTemperature || 1),
      temperature_active: Boolean(profile.temperatureActive),
      candidate_weights: weights.candidateWeights || { ...MODEL_BASE_WEIGHTS },
      weights_active: Boolean(profile.weightsActive),
      baseline_brier: calibrationMetricOrNull(weights.baselineBrier),
      candidate_brier: calibrationMetricOrNull(weights.candidateBrier),
      baseline_log_loss: calibrationMetricOrNull(weights.baselineLogLoss) ?? calibrationMetricOrNull(temp.baselineLogLoss),
      candidate_log_loss: calibrationMetricOrNull(weights.candidateLogLoss) ?? calibrationMetricOrNull(temp.calibratedLogLoss),
      brier_gain: calibrationMetricOrNull(weights.brierGain),
      log_loss_gain: calibrationMetricOrNull(weights.logLossGain),
      detail: {
        promotionGate: profile.promotionGate,
        weightsReason: weights.reason || '',
        temperatureImprovementPct: temp.improvement ?? null,
        appVersion: APP_VERSION,
      },
    }, 'candidate_fingerprint');
  }
  
  async function probeCalibrationLifecycleSchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const [profiles, state, transitions] = await Promise.all([
        probeOptionalTable(cfg, 'model_calibration_profiles'),
        probeOptionalTable(cfg, 'model_calibration_state'),
        probeOptionalTable(cfg, 'model_calibration_transitions'),
      ]);
      return { ok: Boolean(profiles.ok && state.ok && transitions.ok), profiles, state, transitions };
    } catch (error) {
      return { ok: false, status: error?.code || 'error' };
    }
  }
  
  function lifecycleProfileFromRow(row) {
    if (!row) return null;
    const stored = parseJsonObject(row?.detail)?.profile || {};
    return {
      ...stored,
      version: String(row.profile_version || stored.version || CALIBRATION_PROFILE_VERSION),
      fingerprint: String(row.fingerprint || stored.fingerprint || ''),
      temperature: Number(row.temperature || stored.temperature || 1),
      temperatureActive: Boolean(row.temperature_active),
      weightsActive: Boolean(row.weights_active),
      signalWeights: parseJsonObject(row.signal_weights) || stored.signalWeights || { ...MODEL_BASE_WEIGHTS },
      sample: Number(row.trusted_sample || stored.sample || 0),
      mode: row.temperature_active || row.weights_active ? 'active' : 'baseline',
    };
  }
  
  async function persistCalibrationLifecycleProfile(cfg, profile, status = 'challenger') {
    const fingerprint = profile?.fingerprint || await calibrationPromotionFingerprint(profile);
    const weights = profile?.weightsValidation || {};
    const temp = profile?.temperatureValidation || {};
    await supaInsertIgnore(cfg, 'model_calibration_profiles', {
      fingerprint,
      profile_version: String(profile?.version || CALIBRATION_PROFILE_VERSION),
      status,
      temperature: Number(profile?.temperature || 1),
      temperature_active: Boolean(profile?.temperatureActive),
      signal_weights: profile?.signalWeights || { ...MODEL_BASE_WEIGHTS },
      weights_active: Boolean(profile?.weightsActive),
      trusted_sample: Number(profile?.sample || 0),
      train_sample: Math.max(Number(weights.trainSample || 0), Number(temp.trainSample || 0)),
      validation_sample: Math.max(Number(weights.validationSample || 0), Number(temp.validationSample || 0)),
      validation_windows: weights.validationWindows?.length ? weights.validationWindows : temp.validationWindows || [],
      baseline_brier: calibrationMetricOrNull(weights.baselineBrier),
      candidate_brier: calibrationMetricOrNull(weights.candidateBrier),
      baseline_log_loss: calibrationMetricOrNull(weights.baselineLogLoss) ?? calibrationMetricOrNull(temp.baselineLogLoss),
      candidate_log_loss: calibrationMetricOrNull(weights.candidateLogLoss) ?? calibrationMetricOrNull(temp.calibratedLogLoss),
      source_cutoff: profile?.generatedAt || new Date().toISOString(),
      detail: { profile: { ...profile, fingerprint }, appVersion: APP_VERSION },
    }, 'fingerprint');
    return fingerprint;
  }
  
  async function loadCalibrationLifecycleState(cfg) {
    const state = await supaSelectOne(cfg, 'model_calibration_state', { id: 'eq.global' });
    if (!state) return { state: null, active: null, previous: null };
    const [active, previous] = await Promise.all([
      state.active_fingerprint ? supaSelectOne(cfg, 'model_calibration_profiles', { fingerprint: `eq.${state.active_fingerprint}` }) : null,
      state.previous_fingerprint ? supaSelectOne(cfg, 'model_calibration_profiles', { fingerprint: `eq.${state.previous_fingerprint}` }) : null,
    ]);
    return { state, active: lifecycleProfileFromRow(active), previous: lifecycleProfileFromRow(previous) };
  }
  
  function probabilitiesForCalibrationProfile(row, profile) {
    const weights = profile?.weightsActive ? profile.signalWeights : MODEL_BASE_WEIGHTS;
    const blended = rowSignalBlendProbabilities(row, weights);
    if (!blended) return null;
    return profile?.temperatureActive ? temperatureScaleProbabilities(blended, profile.temperature) : blended;
  }
  
  function compareCalibrationProfiles(rows, champion, challenger) {
    const valid = (rows || []).filter(row => ['home','draw','away'].includes(String(row?.actual_outcome || '')));
    const split = splitRollingValidation(valid);
    if (!split.ready) return { pass: false, status: 'shadow', windows: [], reason: 'Недостаточно доверенных матчей для сравнения активной модели и кандидата.' };
    const windows = split.windows.map(window => {
      const evaluated = window.map(row => ({
        row,
        actual: String(row.actual_outcome),
        baseline: probabilitiesForCalibrationProfile(row, champion),
        candidate: probabilitiesForCalibrationProfile(row, challenger),
      })).filter(item => item.baseline && item.candidate);
      return {
        sample: evaluated.length,
        from: evaluated[0]?.row?.kickoff_at || null,
        to: evaluated.at(-1)?.row?.kickoff_at || null,
        baselineBrier: averageMetric(evaluated, item => brierFromProbabilities(item.baseline, item.actual)),
        candidateBrier: averageMetric(evaluated, item => brierFromProbabilities(item.candidate, item.actual)),
        baselineLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.baseline, item.actual)),
        candidateLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.candidate, item.actual)),
      };
    });
    return evaluatePromotionWindows(windows);
  }
  
  function evaluateActivePostPromotion(rows, active, previous) {
    if (!active?.fingerprint || !previous?.fingerprint) return evaluatePostPromotionRollback({ sample: 0 });
    const evaluated = (rows || []).filter(row =>
      String(row?.calibration_profile_fingerprint || '') === String(active.fingerprint)
      && ['home','draw','away'].includes(String(row?.actual_outcome || ''))
    ).map(row => ({
      actual: String(row.actual_outcome),
      active: rowFinalProbabilities(row),
      champion: probabilitiesForCalibrationProfile(row, previous),
    })).filter(item => item.active && item.champion);
    return evaluatePostPromotionRollback({
      sample: evaluated.length,
      activeBrier: averageMetric(evaluated, item => brierFromProbabilities(item.active, item.actual)),
      championBrier: averageMetric(evaluated, item => brierFromProbabilities(item.champion, item.actual)),
      activeLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.active, item.actual)),
      championLogLoss: averageMetric(evaluated, item => logLossFromProbabilities(item.champion, item.actual)),
    });
  }
  
  async function saveCalibrationLifecycleState(cfg, currentState, next = {}) {
    return await supaRpc(cfg, 'transition_model_calibration', {
      p_expected_revision: Math.max(0, Number(currentState?.revision || 0)),
      p_action: String(next.action || ''),
      p_target_fingerprint: next.targetFingerprint || null,
      p_reason: String(next.reason || 'Calibration lifecycle transition.'),
      p_actor_telegram_id: next.actorTelegramId ? Number(next.actorTelegramId) : null,
      p_metadata: safeOpsMetadata(next.metadata || {}),
    });
  }
  
  function isCalibrationRevisionConflict(error) {
    return String(error?.code || '') === '40001'
      || /revision conflict/i.test(String(error?.message || ''));
  }
  
  async function notifyCalibrationAdmins(cfg, action, detail = '') {
    if (!cfg.botToken || !(cfg.adminTelegramIds || []).length) return;
    const labels = {
      initialize: 'инициализирован',
      promote: 'активирована новая модель',
      rollback: 'выполнен автоматический откат',
      manual_rollback: 'выполнен ручной откат',
      freeze: 'жизненный цикл заморожен',
      unfreeze: 'жизненный цикл разморожен',
    };
    const text = `⚙️ Калибровка модели: ${labels[action] || action}.${detail ? `\n${String(detail).slice(0, 500)}` : ''}`;
    await Promise.allSettled((cfg.adminTelegramIds || []).map(id => sendTelegramMessage(id, text, cfg)));
  }
  
  async function resolveCalibrationLifecycle(cfg, candidate, trustedRows) {
    const fingerprint = await calibrationPromotionFingerprint(candidate);
    candidate.fingerprint = fingerprint;
    const schema = await probeCalibrationLifecycleSchema(cfg);
    if (!schema.ok) {
      const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
      baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
      return {
        ...baseline,
        lifecycle: { available: false, status: 'blocked', activeFingerprint: baseline.fingerprint, challengerFingerprint: fingerprint, reason: 'Нужен файл миграции supabase_migration_v6_10.sql; рабочая версия остаётся на базовом профиле.' },
      };
    }
  
    const eligible = candidate?.promotionGate?.status === 'promoted';
    await persistCalibrationLifecycleProfile(cfg, candidate, eligible ? 'challenger' : candidate?.promotionGate?.status === 'held' ? 'held' : 'challenger');
    let lifecycle = await loadCalibrationLifecycleState(cfg);
  
    if (!lifecycle.active) {
      const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
      baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
      await persistCalibrationLifecycleProfile(cfg, baseline, 'active');
      try {
        const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
          action: 'initialize',
          targetFingerprint: baseline.fingerprint,
          reason: 'Инициализация базового жизненного цикла модели.',
          metadata: { appVersion: APP_VERSION },
        });
        lifecycle = { state, active: baseline, previous: null };
        await notifyCalibrationAdmins(cfg, 'initialize', `Активный профиль: ${baseline.fingerprint.slice(0, 12)}`);
      } catch (error) {
        if (!isCalibrationRevisionConflict(error)) throw error;
        lifecycle = await loadCalibrationLifecycleState(cfg);
      }
    }
  
    const postPromotion = evaluateActivePostPromotion(trustedRows, lifecycle.active, lifecycle.previous);
    if (postPromotion.rollback && lifecycle.previous?.fingerprint && !lifecycle.state?.frozen) {
      const failedFingerprint = lifecycle.active.fingerprint;
      try {
        const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
          action: 'rollback',
          targetFingerprint: lifecycle.previous.fingerprint,
          reason: postPromotion.reason,
          metadata: { failedFingerprint, sample: postPromotion.sample, appVersion: APP_VERSION },
        });
        await recordOpsEvent(cfg, { severity: 'warning', source: 'model', eventType: 'calibration_rollback', code: 'CALIBRATION_AUTO_ROLLBACK', message: postPromotion.reason, meta: { failedFingerprint, restoredFingerprint: lifecycle.previous.fingerprint, sample: postPromotion.sample } });
        await notifyCalibrationAdmins(cfg, 'rollback', `${failedFingerprint.slice(0, 12)} → ${lifecycle.previous.fingerprint.slice(0, 12)}. ${postPromotion.reason}`);
        lifecycle = { state, active: lifecycle.previous, previous: null };
      } catch (error) {
        if (!isCalibrationRevisionConflict(error)) throw error;
        lifecycle = await loadCalibrationLifecycleState(cfg);
      }
    }
  
    let comparison = null;
    let promoted = false;
    if (eligible && fingerprint !== lifecycle.active.fingerprint && !lifecycle.state?.frozen) {
      comparison = compareCalibrationProfiles(trustedRows, lifecycle.active, candidate);
      if (comparison.pass) {
        const previousFingerprint = lifecycle.active.fingerprint;
        try {
          const state = await saveCalibrationLifecycleState(cfg, lifecycle.state, {
            action: 'promote',
            targetFingerprint: fingerprint,
            reason: comparison.reason,
            metadata: { previousFingerprint, appVersion: APP_VERSION },
          });
          await recordOpsEvent(cfg, { severity: 'info', source: 'model', eventType: 'calibration_promotion', code: 'CALIBRATION_PROMOTED', message: comparison.reason, meta: { fingerprint, previousFingerprint } });
          await notifyCalibrationAdmins(cfg, 'promote', `${previousFingerprint.slice(0, 12)} → ${fingerprint.slice(0, 12)}. ${comparison.reason}`);
          lifecycle = { state, active: candidate, previous: lifecycle.active };
          promoted = true;
        } catch (error) {
          if (!isCalibrationRevisionConflict(error)) throw error;
          lifecycle = await loadCalibrationLifecycleState(cfg);
        }
      }
    }
  
    const production = lifecycle.active || baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
    return {
      ...production,
      fingerprint: production.fingerprint,
      lifecycle: {
        available: true,
        status: lifecycle.state?.frozen ? 'frozen' : promoted ? 'promoted' : production.fingerprint === fingerprint ? 'active' : eligible ? 'held' : 'shadow',
        activeFingerprint: production.fingerprint,
        previousFingerprint: lifecycle.previous?.fingerprint || null,
        challengerFingerprint: fingerprint,
        revision: Number(lifecycle.state?.revision || 0),
        frozen: Boolean(lifecycle.state?.frozen),
        freezeReason: lifecycle.state?.freeze_reason || '',
        frozenAt: lifecycle.state?.frozen_at || null,
        lastTransition: lifecycle.state?.last_transition || '',
        comparison,
        postPromotion,
        candidate: {
          mode: candidate.mode,
          sample: candidate.sample,
          promotionGate: candidate.promotionGate,
          validationWindows: candidate.weightsValidation?.validationWindows || candidate.temperatureValidation?.validationWindows || [],
        },
      },
    };
  }
  
  function publicCalibrationControlState(lifecycle, transitions = []) {
    const state = lifecycle?.state || {};
    return {
      available: Boolean(state?.id),
      activeFingerprint: lifecycle?.active?.fingerprint || state.active_fingerprint || null,
      previousFingerprint: lifecycle?.previous?.fingerprint || state.previous_fingerprint || null,
      revision: Number(state.revision || 0),
      frozen: Boolean(state.frozen),
      freezeReason: state.freeze_reason || '',
      frozenAt: state.frozen_at || null,
      lastTransition: state.last_transition || '',
      lastTransitionReason: state.last_transition_reason || '',
      updatedAt: state.updated_at || null,
      transitions: (transitions || []).map(row => ({
        id: Number(row.id || 0),
        action: row.action || '',
        fromActiveFingerprint: row.from_active_fingerprint || null,
        toActiveFingerprint: row.to_active_fingerprint || null,
        fromPreviousFingerprint: row.from_previous_fingerprint || null,
        toPreviousFingerprint: row.to_previous_fingerprint || null,
        expectedRevision: Number(row.expected_revision || 0),
        resultingRevision: Number(row.resulting_revision || 0),
        reason: row.reason || '',
        createdAt: row.created_at || null,
      })),
    };
  }
  
  
  function baselineCalibrationProfile(sample = 0, stats = []) {
    return {
      version: CALIBRATION_PROFILE_VERSION,
      generatedAt: new Date().toISOString(),
      mode: sample >= 20 ? 'shadow' : 'baseline',
      sample,
      temperature: 1,
      temperatureActive: false,
      weightsActive: false,
      signalWeights: { ...MODEL_BASE_WEIGHTS },
      signalStats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] || 0 })),
      temperatureValidation: { sample, trainSample: 0, validationSample: 0, baselineLogLoss: null, calibratedLogLoss: null, improvement: null },
      weightsValidation: {
        active: false,
        weights: { ...MODEL_BASE_WEIGHTS },
        candidateWeights: { ...MODEL_BASE_WEIGHTS },
        sample,
        trainSample: 0,
        validationSample: 0,
        baselineBrier: null,
        candidateBrier: null,
        baselineLogLoss: null,
        candidateLogLoss: null,
        brierGain: null,
        logLossGain: null,
        changedWeightL1: 0,
        reason: 'Недостаточно доверенных матчей для отдельной проверки весов на отложенной выборке.',
      },
      promotionGate: {
        status: sample >= 20 ? 'shadow' : 'baseline',
        validationReady: false,
        trustedSample: sample,
        note: sample >= 20 ? 'Кандидат калибровки собирает доказательства в тени.' : 'Сначала нужно накопить достаточно доверенных завершённых прогнозов.',
      },
      note: sample >= 20 ? 'Калибратор собирает выборку в теневом режиме. Итоговые вероятности пока не меняются.' : 'Сначала нужно накопить завершённые предматчевые прогнозы.',
    };
  }
  
  function buildCalibrationProfile(rows) {
    const valid = verifiedSettledRows(rows);
    const signalStats = signalCalibrationStats(valid);
    const temperature = fitTemperatureCalibration(valid);
    const weights = fitAdaptiveSignalWeightsHoldout(valid);
    const active = Boolean(temperature.active || weights.active);
    const validationReady = Number(weights.validationSample || 0) >= 40 || Number(temperature.validationSample || 0) >= 40;
    const shadow = !active && (valid.length >= 20 || validationReady || signalStats.some(x => x.sample >= 10));
    const promotionStatus = active ? 'promoted' : validationReady ? 'held' : shadow ? 'shadow' : 'baseline';
    return {
      version: CALIBRATION_PROFILE_VERSION,
      generatedAt: new Date().toISOString(),
      mode: active ? 'active' : shadow ? 'shadow' : 'baseline',
      sample: valid.length,
      temperature: temperature.active ? temperature.temperature : 1,
      temperatureActive: Boolean(temperature.active),
      weightsActive: Boolean(weights.active),
      signalWeights: weights.active ? weights.weights : { ...MODEL_BASE_WEIGHTS },
      signalStats: (weights.stats || signalStats).map(x => ({
        ...x,
        currentWeight: Number((weights.active ? weights.weights : MODEL_BASE_WEIGHTS)[x.name] ?? MODEL_BASE_WEIGHTS[x.name] ?? 0),
      })),
      temperatureValidation: temperature,
      weightsValidation: weights,
      promotionGate: {
        status: promotionStatus,
        validationReady,
        trustedSample: valid.length,
        weightHoldoutSample: Number(weights.validationSample || 0),
        temperatureHoldoutSample: Number(temperature.validationSample || 0),
        note: active
          ? 'Автокалибровка прошла два последовательных окна доверенной отложенной выборки и готова к сравнению с активной моделью.'
          : validationReady
            ? 'Кандидат остаётся в режиме наблюдения: отложенная выборка ещё не подтвердила безопасное улучшение.'
            : 'Кандидат остаётся в режиме наблюдения до достаточной доверенной отложенной выборки.',
      },
      note: active
        ? 'Кандидат прошёл два окна отложенной выборки; постоянный жизненный цикл решает, можно ли заменить активную модель.'
        : shadow
          ? 'Кандидат измеряется в режиме наблюдения; рабочая система использует только подтверждённый активный профиль.'
          : 'Недостаточно доверенных прогнозов для безопасной автоматической калибровки.',
    };
  }
  
  async function getCalibrationProfile(cfg, { force = false } = {}) {
    if (!force) {
      try {
        const cached = await getCache(CALIBRATION_CACHE_KEY, cfg);
        if (cached?.version === CALIBRATION_PROFILE_VERSION) return cached;
      } catch {}
    }
  
    let rows = [];
    if (hasSupabase(cfg)) {
      try {
        const since = new Date(Date.now() - 365 * 86400_000).toISOString();
        rows = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' });
      } catch (error) {
        return baselineCalibrationProfile(0, []);
      }
    } else {
      rows = [...memory.modelPredictions.values()].filter(x => x.status === 'settled');
    }
    const candidate = buildCalibrationProfile(rows);
    try { await persistCalibrationPromotionValidation(cfg, candidate); } catch (error) {
      console.warn('calibration promotion audit skipped', error?.message || error);
    }
    const profile = hasSupabase(cfg)
      ? await resolveCalibrationLifecycle(cfg, candidate, verifiedSettledRows(rows)).catch(async error => {
          console.warn('calibration lifecycle fallback', error?.message || error);
          const baseline = baselineCalibrationProfile(candidate.sample, candidate.signalStats || []);
          baseline.fingerprint = await calibrationPromotionFingerprint(baseline);
          return { ...baseline, lifecycle: { available: false, status: 'fallback', activeFingerprint: baseline.fingerprint, challengerFingerprint: candidate.fingerprint || null, reason: 'Не удалось сохранить жизненный цикл модели; рабочая версия остаётся на базовом профиле.' } };
        })
      : { ...candidate, fingerprint: await calibrationPromotionFingerprint(candidate), lifecycle: { available: false, status: 'memory' } };
    try { await setCache(CALIBRATION_CACHE_KEY, 0, profile, cfg, CALIBRATION_CACHE_MINUTES); } catch {}
    return profile;
  }

  return {
    fitTemperatureCalibration,
    signalCalibrationStats,
    adaptiveSignalWeights,
    rowSignalBlendProbabilities,
    fitAdaptiveSignalWeightsHoldout,
    calibrationPromotionSelfTest,
    probeCalibrationPromotionSchema,
    calibrationPromotionFingerprint,
    calibrationMetricOrNull,
    persistCalibrationPromotionValidation,
    probeCalibrationLifecycleSchema,
    lifecycleProfileFromRow,
    persistCalibrationLifecycleProfile,
    loadCalibrationLifecycleState,
    probabilitiesForCalibrationProfile,
    compareCalibrationProfiles,
    evaluateActivePostPromotion,
    saveCalibrationLifecycleState,
    isCalibrationRevisionConflict,
    notifyCalibrationAdmins,
    resolveCalibrationLifecycle,
    publicCalibrationControlState,
    baselineCalibrationProfile,
    buildCalibrationProfile,
    getCalibrationProfile
  };
}
