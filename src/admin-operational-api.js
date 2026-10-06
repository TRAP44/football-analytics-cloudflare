// Admin operational API boundary extracted from worker.js.
// Core probes, safety decisions and persistence capabilities stay injected by the composition root.
export function createAdminOperationalApi(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Admin operational API dependencies are required.');
  }
  const {
    API_CONTRACT_VERSION,
    APP_VERSION,
    DEVELOPMENT_TELEGRAM_ID,
    MIN_CLIENT_VERSION,
    PROVIDER_FEATURE_TTLS,
    RC_NAME,
    RELEASE_CHANNEL,
    SUPABASE_SCHEMA_GUIDANCE,
    analysisFreshnessDrill,
    analysisQualityGateSelfTest,
    apiFavoritePlayers,
    apiFavorites,
    apiFootball,
    apiHistory,
    apiMatchCenter,
    apiMe,
    apiPreferences,
    apiProductionReadiness,
    apiReminders,
    appManifest,
    average,
    averageMetric,
    baselineCalibrationProfile,
    brierFromProbabilities,
    buildModelDashboard,
    buildModelRemediationReport,
    buildPredictionIntegrity,
    calibrationPromotionSelfTest,
    collectDiagnostics,
    fixtureIdentity,
    fixtureStatusShort,
    freeQuotaHealthy,
    getCache,
    getCalibrationProfile,
    hasSupabase,
    isAdminUser,
    isCalibrationRevisionConflict,
    isFinishedStatus,
    isFootballRateLimitError,
    json,
    loadCalibrationLifecycleState,
    loadLastProviderE2E,
    loadProviderFixturesForDate,
    loadRuntimeControls,
    logLossFromProbabilities,
    memory,
    modelIntegritySelfTest,
    modelRemediationSelfTest,
    modelVersionName,
    noteSettlementWatchdogOutcome,
    notifyCalibrationAdmins,
    pct,
    predictionOutcomeLabel,
    probeCalibrationLifecycleSchema,
    probeCalibrationPromotionSchema,
    probeOptionalTable,
    probeReminderReliabilitySchema,
    probeRuntimeHistorySchema,
    probeSettlementAdjudicationSchema,
    probeSettlementFinalitySchema,
    probeSettlementReliabilitySchema,
    probeSettlementRunLedgerSchema,
    probeSettlementTrustSchema,
    probeSettlementWatchdogSchema,
    probeSupabaseSchemaDriftConfirmed,
    productionSafetySnapshot,
    providerAuditCall,
    providerAuditEndpointPlan,
    providerAuditScore,
    providerBudgetProfile,
    providerDataReliabilitySelfTest,
    providerEndpointLabel,
    providerFeatureFetch,
    providerFeatureSourcesSummary,
    providerSnapshot,
    providerTransitionProfile,
    providerValidationStatus,
    providerValidationStep,
    publicCalibrationControlState,
    qualityBucket,
    rcCheck,
    rcReadRoute,
    readBackendSecurityContract,
    recordOpsEvent,
    recordRemediationAction,
    redactOpsString,
    releaseCheck,
    reminderDeliveryStatus,
    resetSettlementCircuit,
    resolveSettlementDrift,
    responseJsonSafe,
    rowFinalProbabilities,
    rowRawProbabilities,
    runProductionMonitor,
    saveCalibrationLifecycleState,
    saveProviderE2E,
    sendTelegramMessage,
    setCache,
    settlePredictionsFromFixtures,
    settlementDriftAdjudicationSelfTest,
    settlementFinalitySelfTest,
    settlementRunLedgerSelfTest,
    settlementWatchdogSelfTest,
    signalCalibrationStats,
    supaSelectMany,
    supabaseProbeConfirmationSelfTest,
    supabaseSchemaDriftSelfTest,
    supabaseSchemaProbeConfirmationSelfTest,
    telegramDedupeObservabilitySelfTest,
    telegramMiniAppE2EDrill,
    telegramPersistentDedupeSelfTest,
    topProbabilityValue,
    trustedMetricsGateSelfTest,
    verifiedBrierScore,
    verifiedSettledRows,
    weightedTopCalibrationError,
  } = deps;

  function positiveSafeIntegerQueryParam(url, name) {
    const raw = url.searchParams.get(name);
    if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
    const value = Number(raw.trim());
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  async function apiCalibrationControl(request, cfg, user) {
    const schema = await probeCalibrationLifecycleSchema(cfg);
    if (!schema.ok) return json({ available: false, reason: SUPABASE_SCHEMA_GUIDANCE }, 503);
  
    let lifecycle = await loadCalibrationLifecycleState(cfg);
    if (request.method === 'GET') {
      const transitions = await supaSelectMany(cfg, 'model_calibration_transitions', {}, { limit: 20, order: 'created_at.desc' });
      return json(publicCalibrationControlState(lifecycle, transitions));
    }
    if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
  
    let body = {};
    try { body = await request.json(); } catch {}
    const action = String(body.action || '').trim().toLowerCase();
    if (!['freeze','unfreeze','manual_rollback'].includes(action)) {
      return json({ error: 'Доступны действия: заморозить, разморозить или выполнить ручной откат.' }, 400);
    }
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) return json({ error: 'Укажите причину действия — минимум 5 символов.' }, 400);
    if (action === 'manual_rollback' && !lifecycle.previous?.fingerprint) {
      return json({ error: 'Предыдущая активная модель отсутствует; ручной откат невозможен.' }, 409);
    }
  
    try {
      await saveCalibrationLifecycleState(cfg, lifecycle.state, {
        action,
        targetFingerprint: action === 'manual_rollback' ? lifecycle.previous.fingerprint : null,
        reason,
        actorTelegramId: user.id,
        metadata: { source: 'admin_ui', appVersion: APP_VERSION },
      });
    } catch (error) {
      if (isCalibrationRevisionConflict(error)) {
        return json({ error: 'Состояние уже изменилось другим процессом. Обновите данные и повторите действие.', code: 'CALIBRATION_REVISION_CONFLICT' }, 409);
      }
      throw error;
    }
  
    await recordOpsEvent(cfg, {
      severity: action === 'manual_rollback' ? 'warning' : 'info',
      source: 'model',
      eventType: `calibration_${action}`,
      code: `CALIBRATION_${action.toUpperCase()}`,
      message: reason,
      meta: { revision: Number(lifecycle.state?.revision || 0), actorTelegramId: Number(user.id) },
    });
    await notifyCalibrationAdmins(cfg, action, reason);
  
    lifecycle = await loadCalibrationLifecycleState(cfg);
    const transitions = await supaSelectMany(cfg, 'model_calibration_transitions', {}, { limit: 20, order: 'created_at.desc' });
    return json({ ok: true, ...publicCalibrationControlState(lifecycle, transitions) });
  }

  function buildModelQuality(settledRows, pendingRows, days, calibrationProfile = null) {
    const rows = verifiedSettledRows(settledRows, pendingRows);
    const evaluated = rows.length;
    const excluded = Math.max(0, (settledRows || []).length - evaluated);
    const correct = rows.filter(x => x.correct === true).length;
    const brier = average(rows.map(verifiedBrierScore).filter(Number.isFinite));
    const logLossValues = rows.map(row => {
      const key = String(row.actual_outcome || '');
      const p = Math.max(0.01, Math.min(0.99, Number(row[`${key}_prob`] || 0) / 100));
      return -Math.log(p);
    });
    const avgLogLoss = average(logLossValues);
  
    const calibrationDefs = [
      ['34–44%', 34, 45], ['45–54%', 45, 55], ['55–64%', 55, 65], ['65–74%', 65, 75], ['75%+', 75, 101],
    ];
    const calibration = calibrationDefs.map(([label, min, max]) => {
      const group = rows.filter(x => { const p = topProbabilityValue(x); return p >= min && p < max; });
      return {
        label, sample: group.length,
        avgPredicted: group.length ? Math.round((average(group.map(topProbabilityValue)) || 0) * 10) / 10 : null,
        hitRate: pct(group.filter(x => x.correct === true).length, group.length),
      };
    });
  
    const confidence = [
      qualityBucket(rows.filter(x => Number(x.confidence_score || 0) < 55), 'Низкая'),
      qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 55 && Number(x.confidence_score || 0) < 72), 'Средняя'),
      qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 72), 'Высокая'),
    ];
  
    const outcome = ['home','draw','away'].map(key => {
      const group = rows.filter(x => String(x.predicted_outcome || '') === key);
      return { key, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length) };
    });
  
    const signalNames = ['market','apiPrediction','recentForm','h2h'];
    const signals = signalNames.map(name => {
      const group = rows.filter(x => Array.isArray(x.signal_names) && x.signal_names.includes(name));
      return { name, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length), avgBrier: group.length ? Math.round((average(group.map(verifiedBrierScore).filter(Number.isFinite)) || 0) * 1000) / 1000 : null };
    });
  
    const signalPerformance = signalCalibrationStats(rows);
    const v37Rows = rows.filter(row => /^(?:3\.(?:[7-9]|[1-9]\d)|[4-9]\.)/.test(String(row.analysis_version || '')) && ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row));
    const rawBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
    const finalBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
    const rawLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
    const finalLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
    const calibrationImpact = {
      sample: v37Rows.length,
      rawBrier: Number.isFinite(rawBrier) ? Math.round(rawBrier * 1000) / 1000 : null,
      finalBrier: Number.isFinite(finalBrier) ? Math.round(finalBrier * 1000) / 1000 : null,
      brierDelta: Number.isFinite(rawBrier) && Number.isFinite(finalBrier) ? Math.round((rawBrier - finalBrier) * 1000) / 1000 : null,
      rawLogLoss: Number.isFinite(rawLogLoss) ? Math.round(rawLogLoss * 1000) / 1000 : null,
      finalLogLoss: Number.isFinite(finalLogLoss) ? Math.round(finalLogLoss * 1000) / 1000 : null,
      logLossDelta: Number.isFinite(rawLogLoss) && Number.isFinite(finalLogLoss) ? Math.round((rawLogLoss - finalLogLoss) * 1000) / 1000 : null,
    };
  
    const over25Rows = rows.filter(x => typeof x.over25_correct === 'boolean');
    const bttsRows = rows.filter(x => typeof x.btts_correct === 'boolean');
    const recent = rows.slice(0, 12).map(row => ({
      fixtureId: Number(row.fixture_id), kickoffAt: row.kickoff_at, league: row.league_name || '',
      home: row.home_name || '', away: row.away_name || '',
      score: `${Number(row.actual_home_goals)}:${Number(row.actual_away_goals)}`,
      predictedOutcome: row.predicted_outcome || '', actualOutcome: row.actual_outcome || '',
      predictedLabel: predictionOutcomeLabel(row.predicted_outcome, row.home_name, row.away_name),
      topProbability: Math.round(topProbabilityValue(row) * 10) / 10,
      correct: row.correct === true, brier: verifiedBrierScore(row), confidence: Number(row.confidence_score || 0) || null,
      analysisVersion: modelVersionName(row),
    }));
  
    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      queryLimitPerStatus: 500,
      sample: { settled: evaluated, excluded, loadedSettled: (settledRows || []).length, pending: (pendingRows || []).length, ready: evaluated >= 20, calibrationReady: evaluated >= 50 },
      headline: {
        accuracy: pct(correct, evaluated),
        avgBrier: brier === null ? null : Math.round(brier * 1000) / 1000,
        avgLogLoss: avgLogLoss === null ? null : Math.round(avgLogLoss * 1000) / 1000,
        avgTopProbability: evaluated ? Math.round((average(rows.map(topProbabilityValue)) || 0) * 10) / 10 : null,
      },
      calibration,
      confidence,
      outcome,
      signals,
      signalPerformance,
      dashboard: buildModelDashboard(rows, days),
      integrity: buildPredictionIntegrity(settledRows, pendingRows),
      calibrationDiagnostics: {
        weightedTopCalibrationError: weightedTopCalibrationError(rows),
        label: 'Взвешенная ошибка калибровки максимальной вероятности',
        note: 'Средневзвешенный абсолютный разрыв между средней максимальной вероятностью и фактической точностью по пяти диапазонам вероятности; меньше — лучше. Текущая версия не использует эту метрику отдельно: продвижение требует двух окон отложенной выборки и сравнения с активной моделью.',
      },
      calibrationEngine: calibrationProfile || baselineCalibrationProfile(evaluated, signalPerformance),
      calibrationImpact,
      secondary: {
        over25: { sample: over25Rows.length, accuracy: pct(over25Rows.filter(x => x.over25_correct === true).length, over25Rows.length) },
        btts: { sample: bttsRows.length, accuracy: pct(bttsRows.filter(x => x.btts_correct === true).length, bttsRows.length) },
      },
      recent,
      methodology: {
        snapshot: 'Для каждого матча сохраняется первый расчёт, сделанный до стартового свистка. Поздние перерасчёты не перезаписывают его.',
        outcome: 'Точность исхода = доля матчей, где максимальная вероятность 1X2 совпала с фактическим исходом.',
        brier: 'Ошибка Брайера учитывает все три вероятности 1X2; ниже — лучше. В интерфейсе он показан вместе с размером выборки.',
        versionCohorts: 'Сравнение версий анализа является описательным и не используется для автоматического выбора/продвижения версии.',
        integrity: 'В качество модели и калибровку входят только доверенные завершённые записи: подтверждённые после двух проверок источника данных либо вручную разобранные администратором. Непроверенные, первично проверенные, записи с расхождением и аннулированные исключаются.',
        warning: evaluated < 20 ? 'Выборка пока мала: цифры считаются технической диагностикой, а не доказанной точностью модели.' : '',
      },
    };
  }

  async function apiModelQuality(request, cfg) {
    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get('days') || 90);
    const days = [30, 90, 180, 365].includes(requestedDays) ? requestedDays : 90;
    const forceCalibration = url.searchParams.get('refresh') === '1';
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    let settled = [], pending = [];
    if (hasSupabase(cfg)) {
      try {
        [settled, pending] = await Promise.all([
          supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
          supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
        ]);
      } catch (error) {
        return json({ available: false, reason: `Таблица исторической проверки ещё не создана. ${SUPABASE_SCHEMA_GUIDANCE}`, detail: redactOpsString(error?.message || error, 180) });
      }
    } else {
      const all = [...memory.modelPredictions.values()].filter(x => Date.parse(x.kickoff_at || '') >= Date.parse(since));
      settled = all.filter(x => x.status === 'settled').sort((a,b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at));
      pending = all.filter(x => x.status === 'pending');
    }
    const calibrationProfile = await getCalibrationProfile(cfg, { force: forceCalibration }).catch(() => baselineCalibrationProfile(settled.length));
    return json({ available: true, ...buildModelQuality(settled, pending, days, calibrationProfile) });
  }

  async function apiModelRemediation(request, cfg, user) {
    if (request.method === 'GET') return json(await buildModelRemediationReport(cfg));
    if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
    const body = await request.json().catch(() => ({}));
    const requestedAction = String(body?.action || '').trim().toLowerCase();
    const reason = redactOpsString(body?.reason || '', 220).trim();
    if (reason.length < 5) return json({ error: 'Укажите причину действия (минимум 5 символов).' }, 400);
    if (requestedAction === 'reset_circuit') {
      const schema = await probeSettlementReliabilitySchema(cfg);
      if (!schema.ok) return json({ error: SUPABASE_SCHEMA_GUIDANCE, code: 'SETTLEMENT_RELIABILITY_SCHEMA' }, 409);
      const reset = await resetSettlementCircuit(cfg, user, reason);
      const report = await buildModelRemediationReport(cfg).catch(() => null);
      return json({ ok: true, reset, report });
    }
    if (requestedAction === 'resolve_drift') {
      try {
        const resolution = await resolveSettlementDrift(cfg, user, {
          fixtureId: body?.fixtureId,
          eventId: body?.eventId,
          resolutionAction: body?.resolutionAction,
          resolutionToken: body?.resolutionToken,
          reason,
        });
        const report = await buildModelRemediationReport(cfg).catch(() => null);
        return json({ ok: true, resolution, report });
      } catch (error) {
        const status = ['SETTLEMENT_DRIFT_STALE','SETTLEMENT_DRIFT_EVENT_STALE','SETTLEMENT_DRIFT_TOKEN_STALE','SETTLEMENT_DRIFT_ALREADY_LOCKED'].includes(String(error?.code || '')) ? 409 : 400;
        return json({ error: error?.message || 'Ручной разбор расхождения не выполнен.', code: error?.code || 'SETTLEMENT_DRIFT' }, status);
      }
    }
    if (requestedAction !== 'recover') return json({ error: 'Поддерживаются восстановление ожидающих записей, сброс защиты и ручной разбор расхождения.' }, 400);
  
    const report = await buildModelRemediationReport(cfg);
    if (!report.available) return json(report, 503);
    if (!report.schemaReady) return json({ error: SUPABASE_SCHEMA_GUIDANCE, code: 'MODEL_REMEDIATION_SCHEMA', report }, 409);
    const requestedIds = [...new Set((Array.isArray(body?.fixtureIds) ? body.fixtureIds : []).map(Number).filter(x => Number.isInteger(x) && x > 0))].sort((a, b) => a - b);
    const currentIds = [...(report.recovery?.fixtureIds || [])].map(Number).sort((a, b) => a - b);
    if (!report.recovery?.candidateToken || String(body?.candidateToken || '') !== report.recovery.candidateToken ||
        requestedIds.join(',') !== currentIds.join(',')) {
      return json({ error: 'Список кандидатов изменился. Обновите предварительную проверку перед восстановлением.', code: 'REMEDIATION_STALE', report }, 409);
    }
    if (!currentIds.length) return json({ ok: true, execution: { status: 'nothing_to_do', settled: 0, skipped: 0 }, report });
    if (!freeQuotaHealthy(10, 3)) {
      return json({ error: 'Недостаточно безопасного остатка квоты API-Football. Повторите позже.', code: 'REMEDIATION_QUOTA', report }, 429);
    }
  
    const candidateMap = new Map((report.recovery?.candidates || []).map(row => [Number(row.fixtureId), row]));
    const dates = [...new Set([...candidateMap.values()].map(row => String(row.kickoffAt || '').slice(0, 10)).filter(Boolean))];
    const fixtureSet = new Set(currentIds);
    const fixtures = [];
    const actionId = crypto.randomUUID();
    try {
      for (const date of dates) {
        const rows = await loadProviderFixturesForDate(date, cfg);
        fixtures.push(...rows.filter(fixture => fixtureSet.has(fixtureIdentity(fixture))));
      }
      const settlement = await settlePredictionsFromFixtures(fixtures, cfg);
      const after = hasSupabase(cfg)
        ? await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${currentIds.join(',')})` }, { limit: currentIds.length + 2 })
        : currentIds.map(id => memory.modelPredictions.get(id)).filter(Boolean);
      const settledCount = after.filter(row => row.status === 'settled').length;
      const skippedCount = Math.max(0, currentIds.length - settledCount);
      const status = skippedCount ? 'partial' : 'completed';
      const action = await recordRemediationAction(cfg, user, {
        actionId,
        actionType: 'recover',
        status,
        reason,
        candidateCount: report.recovery.stalePending,
        inspectedCount: currentIds.length,
        settledCount,
        skippedCount,
        fixtureIds: currentIds,
        detail: { providerCalls: dates.length, finishedFixtures: fixtures.filter(f => isFinishedStatus(fixtureStatusShort(f))).length, settlementChecked: settlement.checked },
      });
      memory.modelRemediation.lastRun = action;
      await noteSettlementWatchdogOutcome(cfg, status, { actionId }).catch(() => null);
      await recordOpsEvent(cfg, {
        severity: skippedCount ? 'warning' : 'info', source: 'model', eventType: 'prediction_remediation',
        code: skippedCount ? 'REMEDIATION_PARTIAL' : 'REMEDIATION_COMPLETED', message: reason,
        meta: { actionId, inspectedCount: currentIds.length, settledCount, skippedCount, providerCalls: dates.length },
      }).catch(() => null);
      const refreshedReport = await buildModelRemediationReport(cfg).catch(() => null);
      return json({ ok: true, execution: action, report: refreshedReport || report });
    } catch (error) {
      await recordRemediationAction(cfg, user, {
        actionId,
        actionType: 'recover',
        status: 'failed',
        reason,
        candidateCount: report.recovery.stalePending,
        inspectedCount: currentIds.length,
        settledCount: 0,
        skippedCount: currentIds.length,
        fixtureIds: currentIds,
        detail: { providerCalls: dates.length, error: redactOpsString(error?.message || error, 180) },
      }).catch(() => null);
      throw error;
    }
  }

  async function getReminderHealth(cfg) {
    const schema = await probeReminderReliabilitySchema(cfg);
    if (!schema.ok) {
      return {
        available: false,
        migrationReady: false,
        reason: SUPABASE_SCHEMA_GUIDANCE,
        scheduler: { cadenceMinutes: 5 },
      };
    }
  
    const now = Date.now();
    const fromIso = new Date(now - 24 * 3600_000).toISOString();
    let rows = [];
  
    try {
      rows = await supaSelectMany(cfg, 'match_reminders', {
        fixture_date: `gte.${fromIso}`,
      }, { limit: 500, order: 'fixture_date.asc' });
    } catch (error) {
      return {
        available: false,
        migrationReady: true,
        reason: redactOpsString(error?.message || 'Не удалось прочитать напоминания.', 180),
        scheduler: { cadenceMinutes: 5 },
      };
    }
  
    const active = rows.filter(x => x.enabled !== false);
    const upcoming = active.filter(x => Date.parse(x.fixture_date || '') >= now);
    const dueSoon = upcoming.filter(x => Date.parse(x.fixture_date || '') <= now + 90 * 60_000);
    const prematchSent24h = rows.filter(x => Date.parse(x.notified_at || '') >= now - 24 * 3600_000).length;
    const kickoffSent24h = rows.filter(x => Date.parse(x.kickoff_notified_at || '') >= now - 24 * 3600_000).length;
  
    const failed24h = rows.filter(x =>
      x.delivery_last_error &&
      Date.parse(x.delivery_last_attempt_at || '') >= now - 24 * 3600_000
    );
  
    const staleClaims = rows.filter(x =>
      [x.prematch_claimed_at, x.kickoff_claimed_at].some(value => {
        const t = Date.parse(value || '');
        return Number.isFinite(t) && now - t > 20 * 60_000;
      })
    );
  
    const activeClaims = rows.filter(x =>
      [x.prematch_claimed_at, x.kickoff_claimed_at].some(value => {
        const t = Date.parse(value || '');
        return Number.isFinite(t) && now - t <= 20 * 60_000;
      })
    );
  
    const recent = [...rows]
      .filter(x => x.delivery_last_attempt_at || x.delivery_last_success_at)
      .sort((a, b) =>
        Date.parse(b.delivery_last_attempt_at || b.delivery_last_success_at || 0) -
        Date.parse(a.delivery_last_attempt_at || a.delivery_last_success_at || 0)
      )
      .slice(0, 12)
      .map(x => ({
        fixtureId: Number(x.fixture_id || 0),
        match: `${x.home_name || ''} — ${x.away_name || ''}`.trim(),
        fixtureDate: x.fixture_date || null,
        state: reminderDeliveryStatus(x),
        enabled: x.enabled !== false,
        prematchAttempts: Number(x.prematch_attempts || 0),
        kickoffAttempts: Number(x.kickoff_attempts || 0),
        lastAttemptAt: x.delivery_last_attempt_at || null,
        lastSuccessAt: x.delivery_last_success_at || null,
        hasError: Boolean(x.delivery_last_error),
        disabledReason: x.delivery_disabled_reason || null,
      }));
  
    return {
      available: true,
      migrationReady: true,
      generatedAt: new Date().toISOString(),
      scheduler: {
        cadenceMinutes: 5,
        claimTimeoutMinutes: 20,
        nextRunMaximumDelayMinutes: 5,
      },
      summary: {
        activeUpcoming: upcoming.length,
        dueNext90Minutes: dueSoon.length,
        prematchSent24h,
        kickoffSent24h,
        failed24h: failed24h.length,
        activeClaims: activeClaims.length,
        staleClaims: staleClaims.length,
        disabled24h: rows.filter(x => x.enabled === false && x.delivery_disabled_reason).length,
      },
      recent,
      health: staleClaims.length || failed24h.length >= 3
        ? { state: 'watch', label: 'Нужен контроль доставки' }
        : { state: 'healthy', label: 'Доставка выглядит штатно' },
      note: 'Блокировка доставки предотвращает параллельную отправку одного уведомления. Если Telegram отклоняет доставку, конкретное недоставляемое напоминание отключается.',
    };
  }

  async function apiReminderHealth(request, cfg, user) {
    if (request.method === 'GET') return json(await getReminderHealth(cfg));
  
    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      if (body?.action !== 'test') return json({ error: 'Неизвестное действие.' }, 400);
  
      const result = await sendTelegramMessage(
        user.id,
        `✅ Футбольная аналитика\n\nТест уведомлений ${APP_VERSION} прошёл. Если вы видите это сообщение, доставка через Telegram работает.`,
        cfg
      );
  
      await recordOpsEvent(cfg, {
        severity: result.ok ? 'info' : 'warning',
        source: 'reminders',
        eventType: 'reminder_test',
        code: result.ok ? 'REMINDER_TEST_OK' : 'REMINDER_TEST_FAILED',
        message: result.ok ? 'Admin reminder test delivered.' : `Admin reminder test failed: ${result.description || 'unknown'}`,
        endpoint: '/api/reminder-health',
        status: Number(result.status || 0) || null,
        meta: {
          telegramStatus: Number(result.status || 0) || null,
          errorCode: Number(result.errorCode || 0) || null,
        },
      }).catch(() => {});
  
      return json({
        ok: result.ok,
        message: result.ok ? 'Тестовое Telegram-уведомление отправлено.' : 'Telegram не принял тестовое уведомление.',
        telegramStatus: Number(result.status || 0) || null,
        retryAfter: Number(result.retryAfter || 0) || null,
      }, result.ok ? 200 : 502);
    }
  
    return json({ error: 'Метод не поддерживается.' }, 405);
  }

  async function apiProviderE2EValidation(request, cfg) {
    const url = new URL(request.url);
    const fixtureId = positiveSafeIntegerQueryParam(url, 'fixtureId');
    if (fixtureId === null) return json({ error: 'Укажите корректный положительный целый номер матча для сквозной проверки.' }, 400);
  
    const startedAt = Date.now();
    const steps = [];
    const before = providerSnapshot();
  
    // Step 1: refresh real provider headers. One request even on FREE.
    let probeOk = false;
    try {
      await apiFootball('/status', {}, cfg, { responseType: 'any' });
      probeOk = true;
    } catch (error) {
      steps.push(providerValidationStep(
        'provider_probe',
        'Связь с API-Football',
        'fail',
        redactOpsString(error?.message || 'Состояние источника данных недоступно.', 180),
      ));
    }
  
    const transition = providerTransitionProfile();
    const budget = providerBudgetProfile();
    const afterProbe = providerSnapshot();
  
    if (probeOk) {
      steps.push(providerValidationStep(
        'provider_probe',
        'Связь с API-Football',
        'pass',
        `Источник данных отвечает. Определён тариф ${transition.plan === 'FREE' ? 'Бесплатный' : transition.plan}.`,
        { plan: transition.plan },
      ));
    }
  
    steps.push(providerValidationStep(
      'paid_plan',
      'Расширенная квота',
      transition.paid ? 'pass' : 'hold',
      transition.paid
        ? `${transition.plan}: расширенный режим доступен.`
        : `${transition.plan === 'FREE' ? 'Бесплатный тариф' : transition.plan}: полная сквозная проверка намеренно не запускается на бесплатном тарифе.`,
      { plan: transition.plan, paid: transition.paid },
    ));
  
    steps.push(providerValidationStep(
      'quota_budget',
      'Защитный резерв квоты',
      budget.mode === 'emergency' ? 'fail' : budget.mode === 'conserve' ? 'warn' : transition.paid ? 'pass' : 'hold',
      `${budget.label}. Daily: ${budget.daily?.remaining ?? '—'} / ${budget.daily?.limit ?? '—'}, minute: ${budget.minute?.remaining ?? '—'} / ${budget.minute?.limit ?? '—'}.`,
      { mode: budget.mode },
    ));
  
    steps.push(providerValidationStep(
      'monetization',
      'Оплата пользователей',
      cfg.monetizationEnabled ? 'fail' : 'pass',
      cfg.monetizationEnabled
        ? 'Флаг монетизации включён — для текущего этапа это преждевременно.'
        : 'Монетизация остаётся на паузе, как запланировано.',
    ));
  
    // Important: FREE / reserve modes stop here. No audit or Match Center burst.
    if (!transition.paid || budget.mode === 'emergency') {
      const status = providerValidationStatus(steps);
      const result = {
        version: '5.0',
        generatedAt: new Date().toISOString(),
        fixtureId,
        blocked: true,
        reason: !transition.paid ? 'paid_plan_required' : 'quota_reserve',
        status,
        steps,
        provider: afterProbe,
        transition,
        budget,
        coverageAudit: null,
        matchCenter: null,
        cacheVerification: null,
        requestCost: {
          estimated: 1,
          observedDailyDelta: Number.isFinite(Number(before.dailyRemaining)) && Number.isFinite(Number(afterProbe.dailyRemaining))
            ? Math.max(0, Number(before.dailyRemaining) - Number(afterProbe.dailyRemaining))
            : null,
        },
        durationMs: Date.now() - startedAt,
        note: !transition.paid
          ? 'На бесплатном тарифе выполняется только проверка состояния. Полная сквозная проверка станет доступна после обнаружения повышенной квоты.'
          : 'E2E остановлен защитным резервом квоты.',
      };
      await saveProviderE2E(result, fixtureId, cfg);
      await recordOpsEvent(cfg, {
        severity: 'info',
        source: 'provider',
        eventType: 'expanded_data_e2e',
        code: 'E2E_HOLD',
        message: result.note,
        meta: { fixtureId, plan: transition.plan, mode: budget.mode, status: status.code },
      }).catch(() => {});
      return json(result);
    }
  
    if (budget.mode === 'conserve') {
      steps.push(providerValidationStep(
        'e2e_execution',
        'Полный E2E запуск',
        'warn',
        'Управление квотой работает в экономном режиме. Проверка продолжится, но результат будет помечен как ограниченный.',
      ));
    }
  
    // Step 2: real endpoint coverage. Reuse recent cached audit when available.
    let audit = null;
    try {
      const auditResponse = await apiProviderCoverageAudit(
        new Request(`https://internal/api/provider/coverage-audit?fixtureId=${fixtureId}`),
        cfg
      );
      audit = await responseJsonSafe(auditResponse);
    } catch (error) {
      audit = { error: error?.message || String(error), summary: { errors: 1, score: 0 } };
    }
  
    if (audit?.blocked) {
      steps.push(providerValidationStep(
        'coverage_audit',
        'Проверка покрытия методов API',
        'hold',
        audit.note || 'Проверка покрытия остановлена защитным правилом.',
      ));
    } else if (audit?.summary) {
      const errors = Number(audit.summary.errors || 0);
      const score = Number(audit.summary.score || 0);
      const state = errors > 1 || score < 45 ? 'fail' : errors > 0 || score < 75 ? 'warn' : 'pass';
      steps.push(providerValidationStep(
        'coverage_audit',
        'Проверка покрытия методов API',
        state,
        `${audit.summary.label || 'Coverage'} · ${score}% · ошибок ${errors}.`,
        { score, errors, available: Number(audit.summary.available || 0), empty: Number(audit.summary.empty || 0) },
      ));
    } else {
      steps.push(providerValidationStep(
        'coverage_audit',
        'Проверка покрытия методов API',
        'fail',
        audit?.error || 'Проверка покрытия не вернула результат.',
      ));
    }
  
    // Step 3: actual product path. First call may populate cache, second must reuse Match Center cache.
    let firstCenter = null;
    let secondCenter = null;
    let firstMs = null;
    let secondMs = null;
    try {
      const firstStarted = Date.now();
      const firstResponse = await apiMatchCenter(
        new Request(`https://internal/api/match-center?fixtureId=${fixtureId}`),
        cfg
      );
      firstMs = Date.now() - firstStarted;
      firstCenter = await responseJsonSafe(firstResponse);
  
      const secondStarted = Date.now();
      const secondResponse = await apiMatchCenter(
        new Request(`https://internal/api/match-center?fixtureId=${fixtureId}`),
        cfg
      );
      secondMs = Date.now() - secondStarted;
      secondCenter = await responseJsonSafe(secondResponse);
    } catch (error) {
      firstCenter = { error: error?.message || String(error) };
    }
  
    const matchCenterOk = Boolean(
      firstCenter?.match?.fixtureId === fixtureId &&
      firstCenter?.match?.home?.name &&
      firstCenter?.match?.away?.name &&
      firstCenter?.mode
    );
    steps.push(providerValidationStep(
      'match_center',
      'Сквозная проверка центра матча',
      matchCenterOk ? 'pass' : 'fail',
      matchCenterOk
        ? `${firstCenter.match.home.name} — ${firstCenter.match.away.name}; режим=${firstCenter.mode}; первый ответ ${firstMs} мс.`
        : (firstCenter?.error || 'Центр матча не вернул корректный ответ.'),
      { firstMs, mode: firstCenter?.mode || null },
    ));
  
    const cacheOk = Boolean(secondCenter?.cached);
    steps.push(providerValidationStep(
      'cache_reuse',
      'Повторный запрос без лишнего API',
      cacheOk ? 'pass' : 'warn',
      cacheOk
        ? `Повторный запрос центра матча обслужен общими сохранёнными данными за ${secondMs} мс.`
        : 'Повторный ответ не был помечен как сохранённый — стоит проверить общее хранилище.',
      { secondMs, cached: cacheOk },
    ));
  
    const sources = providerFeatureSourcesSummary(firstCenter?.dataFreshness || {});
    const featureCount = Object.values(sources).reduce((sum, value) => sum + Number(value || 0), 0);
    steps.push(providerValidationStep(
      'feature_pipeline',
      'Expanded feature pipeline',
      !matchCenterOk ? 'fail' : sources.error > 0 ? 'warn' : featureCount > 0 ? 'pass' : 'warn',
      featureCount
        ? `Источники: запросы ${sources.api}, сохранённые данные ${sources.cache}, встроенные данные матча ${sources.embedded}, резерв ${sources.stale}, пропуск ${sources.skipped}, ошибки ${sources.error}.`
        : 'Матч не потребовал дополнительных запросов по отдельным функциям либо данные были недоступны.',
      sources,
    ));
  
    const after = providerSnapshot();
    const budgetAfter = providerBudgetProfile();
    const observedDailyDelta =
      Number.isFinite(Number(before.dailyRemaining)) && Number.isFinite(Number(after.dailyRemaining))
        ? Math.max(0, Number(before.dailyRemaining) - Number(after.dailyRemaining))
        : null;
  
    steps.push(providerValidationStep(
      'post_run_quota',
      'Квота после теста',
      budgetAfter.mode === 'emergency' ? 'fail' : budgetAfter.mode === 'conserve' ? 'warn' : 'pass',
      `${budgetAfter.label}. Остаток на день ${budgetAfter.daily?.remaining ?? '—'}, на минуту ${budgetAfter.minute?.remaining ?? '—'}.`,
      { mode: budgetAfter.mode },
    ));
  
    const status = providerValidationStatus(steps);
    const result = {
      version: '5.0',
      generatedAt: new Date().toISOString(),
      fixtureId,
      blocked: false,
      status,
      steps,
      provider: after,
      transition: providerTransitionProfile(),
      budget: budgetAfter,
      coverageAudit: audit ? {
        blocked: Boolean(audit.blocked),
        fixture: audit.fixture || null,
        summary: audit.summary || null,
        cost: audit.cost || null,
        endpoints: (audit.endpoints || []).map(x => ({
          key: x.key, label: x.label, state: x.state, results: x.results ?? null,
          latencyMs: x.latencyMs ?? null, note: x.note || '',
        })),
      } : null,
      matchCenter: matchCenterOk ? {
        fixture: firstCenter.match,
        mode: firstCenter.mode,
        availability: firstCenter.availability || {},
        quotaMode: firstCenter.quotaMode || null,
        dataFreshness: firstCenter.dataFreshness || {},
        firstResponseMs: firstMs,
      } : { error: firstCenter?.error || 'invalid_payload', firstResponseMs: firstMs },
      cacheVerification: {
        cached: cacheOk,
        secondResponseMs: secondMs,
      },
      requestCost: {
        estimatedMax: 16,
        observedDailyDelta,
        note: 'Изменение расхода берётся из заголовков лимитов и может быть недоступно, если источник данных не прислал оба значения.',
      },
      durationMs: Date.now() - startedAt,
      note: status.ready
        ? 'Путь расширенных данных прошёл проверку релиза. Пользовательская монетизация при этом не включается.'
        : 'Проверка релиза нашла пункт, который нужно исправить до полноценного расширенного режима.',
    };
  
    await saveProviderE2E(result, fixtureId, cfg);
    await recordOpsEvent(cfg, {
      severity: status.code === 'NEEDS_ATTENTION' ? 'warning' : 'info',
      source: 'provider',
      eventType: 'expanded_data_e2e',
      code: `E2E_${status.code}`,
      message: result.note,
      meta: {
        fixtureId,
        plan: result.transition?.plan || 'UNKNOWN',
        status: status.code,
        coverageScore: result.coverageAudit?.summary?.score ?? null,
        cacheReuse: cacheOk,
        observedDailyDelta,
        durationMs: result.durationMs,
      },
    }).catch(() => {});
    return json(result);
  }

  async function apiProviderBudget(request, cfg) {
    return json({
      provider: providerSnapshot(),
      budget: providerBudgetProfile(),
      transition: providerTransitionProfile(),
      featureTtls: PROVIDER_FEATURE_TTLS,
    });
  }

  async function apiProviderProbe(request, cfg) {
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    if (!force && memory.provider?.updatedAt && Date.now() - Date.parse(memory.provider.updatedAt) < 30000) {
      return json({
        provider: providerSnapshot(),
        transition: providerTransitionProfile(),
        cached: true,
      });
    }
  
    // /status is deliberately admin-only and called only on explicit request.
    // We use it to refresh subscription/quota headers without exposing account data.
    let statusOk = false;
    let statusNote = '';
    try {
      await apiFootball('/status', {}, cfg, { responseType: 'any' });
      statusOk = true;
      statusNote = 'Тариф и квоты обновлены через /status.';
      const snapshot=providerSnapshot();
      const quotaComplete=String(snapshot.plan || 'UNKNOWN')!=='UNKNOWN'
        && [snapshot.dailyLimit,snapshot.dailyRemaining,snapshot.minuteLimit,snapshot.minuteRemaining]
          .every(value=>Number.isFinite(Number(value)));
      await recordOpsEvent(cfg,{
        severity:quotaComplete ? 'info' : 'warning',
        source:'provider',
        eventType:'quota_probe',
        code:quotaComplete ? 'PROVIDER_QUOTA_CONFIRMED' : 'PROVIDER_QUOTA_INCOMPLETE',
        message:quotaComplete ? 'API-Football quota headers confirmed.' : 'API-Football /status responded without complete quota headers.',
        endpoint:'/status',
        meta:{
          plan:String(snapshot.plan || 'UNKNOWN').slice(0,20),
          dailyLimit:Number.isFinite(Number(snapshot.dailyLimit)) ? Number(snapshot.dailyLimit) : null,
          dailyRemaining:Number.isFinite(Number(snapshot.dailyRemaining)) ? Number(snapshot.dailyRemaining) : null,
          minuteLimit:Number.isFinite(Number(snapshot.minuteLimit)) ? Number(snapshot.minuteLimit) : null,
          minuteRemaining:Number.isFinite(Number(snapshot.minuteRemaining)) ? Number(snapshot.minuteRemaining) : null,
        },
      }).catch(()=>null);
    } catch (error) {
      statusNote = redactOpsString(error?.message || 'Не удалось обновить состояние источника данных.', 160);
    }
  
    return json({
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
      probe: { ok: statusOk, note: statusNote, costRequests: 1 },
      cached: false,
    });
  }

  async function apiProviderCoverageAudit(request, cfg) {
    const url = new URL(request.url);
    const fixtureId = positiveSafeIntegerQueryParam(url, 'fixtureId');
    const force = url.searchParams.get('refresh') === '1';
    if (fixtureId === null) return json({ error: 'Укажите корректный положительный целый номер матча для проверки покрытия.' }, 400);
  
    const cacheKey = `provider-coverage-audit:${fixtureId}:v4.8`;
    if (!force) {
      const cached = await getCache(cacheKey, cfg).catch(() => null);
      if (cached) return json({ ...cached, cached: true });
    }
  
    const startedAt = Date.now();
    let fixture = null;
    try {
      fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0] || null;
    } catch (error) {
      return json({
        error: error?.message || 'Не удалось загрузить матч для проверки.',
        code: error?.code || 'AUDIT_FIXTURE',
        provider: providerSnapshot(),
        transition: providerTransitionProfile(),
      }, isFootballRateLimitError(error) ? 429 : 502);
    }
    if (!fixture) return json({ error: 'Матч не найден у API-Football.' }, 404);
  
    const transition = providerTransitionProfile();
    const status = String(fixture.fixture?.status?.short || '').toUpperCase();
    const fixtureSummary = {
      fixtureId,
      date: fixture.fixture?.date || '',
      status,
      league: fixture.league?.name || '',
      home: fixture.teams?.home?.name || '',
      away: fixture.teams?.away?.name || '',
    };
    const plan = providerAuditEndpointPlan(fixture);
  
    if (!transition.paid || !transition.safety.fullCoverageAuditAllowed) {
      const preview = {
        available: true,
        blocked: true,
        reason: transition.paid ? 'quota_guard' : 'paid_plan_required',
        generatedAt: new Date().toISOString(),
        fixture: fixtureSummary,
        provider: providerSnapshot(),
        transition,
        cost: { usedNow: 1, maxFullAudit: 1 + plan.filter(x => x.applicable).length },
        endpoints: plan.map(x => ({
          key: x.key,
          label: providerEndpointLabel(x.key),
          state: x.applicable ? 'preview' : 'not_applicable',
          note: x.applicable ? 'Будет проверен после активации расширенного режима.' : 'Не применяется к текущему статусу матча.',
        })),
        note: transition.paid
          ? 'Полная проверка не запущена: защита квоты считает остаток лимита недостаточным.'
          : 'На бесплатном тарифе выполнен только запрос матча. Полная проверка намеренно не тратит оставшийся лимит.',
      };
      memory.providerAudit.last = preview;
      memory.providerAudit.byFixture.set(fixtureId, preview);
      return json(preview);
    }
  
    const results = [];
    for (const item of plan) {
      results.push(await providerAuditCall(item, cfg));
      // Conservative pacing for PRO and shared Worker bursts.
      if (item.applicable) await new Promise(resolve => setTimeout(resolve, 230));
    }
  
    const relevant = results.filter(x => x.state !== 'not_applicable');
    const errors = relevant.filter(x => x.state === 'error').length;
    const available = relevant.filter(x => x.state === 'available').length;
    const empty = relevant.filter(x => x.state === 'empty').length;
    const score = providerAuditScore(results);
    const audit = {
      available: true,
      blocked: false,
      generatedAt: new Date().toISOString(),
      fixture: fixtureSummary,
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
      cost: {
        usedNow: 1 + plan.filter(x => x.applicable).length,
        maxFullAudit: 1 + plan.filter(x => x.applicable).length,
      },
      summary: {
        score,
        label: errors ? 'Есть ошибки методов API' : score >= 80 ? 'Покрытие хорошее' : score >= 55 ? 'Покрытие частичное' : 'Покрытие ограниченное',
        checked: relevant.length,
        available,
        empty,
        errors,
      },
      endpoints: results,
      durationMs: Date.now() - startedAt,
      note: 'Пустой ответ не всегда означает проблему: составы, коэффициенты, травмы и коэффициенты в реальном времени зависят от турнира, статуса и момента времени.',
    };
  
    memory.providerAudit.last = audit;
    memory.providerAudit.byFixture.set(fixtureId, audit);
    await setCache(cacheKey, fixtureId, audit, cfg, 15).catch(() => null);
    return json(audit);
  }

  async function apiProductionMonitor(request, cfg) {
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    if (!force && memory.productionMonitor?.value && Date.now() - Number(memory.productionMonitor.at || 0) < 30000) {
      return json({ ...memory.productionMonitor.value, cached: true });
    }
    return json(await runProductionMonitor(cfg, new Date(), { record: false }));
  }

  async function apiDiagnostics(request, cfg) {
    return json(await collectDiagnostics(cfg));
  }

  async function apiReleaseReadiness(request, cfg) {
    const now = Date.now();
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    if (!force && memory.releaseReadiness?.value && now - Number(memory.releaseReadiness.at || 0) < 30000) {
      return json({ ...memory.releaseReadiness.value, cached: true });
    }
  
    const [diagnostics, modelTable, remediationTable, runtimeTable, runtimeHistoryTable] = await Promise.all([
      collectDiagnostics(cfg),
      probeOptionalTable(cfg, 'model_predictions'),
      probeOptionalTable(cfg, 'prediction_integrity_actions'),
      probeOptionalTable(cfg, 'runtime_controls'),
      probeOptionalTable(cfg, 'runtime_control_history'),
    ]);
    const [runtimeState, watchdogSchema, runLedgerSchema, finalitySchema, adjudicationSchema, trustSchema, calibrationPromotionSchema, calibrationLifecycleSchema, backendSecurity, schemaDrift] = await Promise.all([
      loadRuntimeControls(cfg, { force: true }),
      probeSettlementWatchdogSchema(cfg),
      probeSettlementRunLedgerSchema(cfg),
      probeSettlementFinalitySchema(cfg),
      probeSettlementAdjudicationSchema(cfg),
      probeSettlementTrustSchema(cfg),
      probeCalibrationPromotionSchema(cfg),
      probeCalibrationLifecycleSchema(cfg),
      readBackendSecurityContract(cfg),
      probeSupabaseSchemaDriftConfirmed(cfg),
    ]);
    const productionMonitor = await runProductionMonitor(cfg, new Date(), { record: false });
    const runtime = runtimeState.value;
    const provider = diagnostics.provider || {};
    const watchdogSelfTest = settlementWatchdogSelfTest();
    const modelIntegrityCheck = modelIntegritySelfTest();
    const settlementRunLedgerCheck = settlementRunLedgerSelfTest();
    const settlementFinalityCheck = settlementFinalitySelfTest();
    const settlementAdjudicationCheck = settlementDriftAdjudicationSelfTest();
    const trustedMetricsCheck = trustedMetricsGateSelfTest();
    const calibrationPromotionCheck = calibrationPromotionSelfTest();
    const schemaDriftSelfTest = supabaseSchemaDriftSelfTest();
    const providerReliabilitySelfTest = providerDataReliabilitySelfTest();
    const analysisFreshnessSelfTest = typeof analysisFreshnessDrill === 'function'
      ? analysisFreshnessDrill()
      : { pass:false, cases:0 };
    const aiQualityGateSelfTest = analysisQualityGateSelfTest();
    const telegramMiniAppE2ESelfTest = telegramMiniAppE2EDrill();
    const telegramPersistentDedupeCheck = telegramPersistentDedupeSelfTest();
    const telegramDedupeObservabilityCheck = telegramDedupeObservabilitySelfTest();
    const supabaseProbeConfirmationCheck = supabaseProbeConfirmationSelfTest();
    const supabaseSchemaProbeConfirmationCheck = supabaseSchemaProbeConfirmationSelfTest();
    const checks = [
      releaseCheck('football_api', 'Ключ API-Football', cfg.apiFootballKey ? 'pass' : 'fail', cfg.apiFootballKey ? 'Ключ доступен серверному обработчику.' : 'Ключ API-Football отсутствует.', true),
      releaseCheck('supabase_config', 'Настройка Supabase', hasSupabase(cfg) ? 'pass' : 'fail', hasSupabase(cfg) ? 'Адрес и сервисный ключ доступны серверу.' : 'Не хватает адреса Supabase или сервисного ключа.', true),
      releaseCheck('supabase_online', 'Supabase/PostgREST', diagnostics.supabase?.ok ? 'pass' : 'fail',
        diagnostics.supabase?.ok
          ? `Ответ ${Number(diagnostics.supabase?.latencyMs || 0)} мс · attempts=${Number(diagnostics.supabase?.attempts || 1)}${diagnostics.supabase?.recovered ? ' · transient recovered' : ''}.`
          : `Статус: ${diagnostics.supabase?.status || 'offline'} · attempts=${Number(diagnostics.supabase?.attempts || 1)}.`, true),
      releaseCheck('supabase_probe_confirmation', 'Подтверждение сбоя Supabase probe',
        supabaseProbeConfirmationCheck.pass ? 'pass' : 'fail',
        supabaseProbeConfirmationCheck.pass
          ? 'Одиночный сбой подтверждается вторым probe; восстановившийся retry не создаёт ложный incident.'
          : 'Самопроверка confirmation guard не прошла.', true),
      releaseCheck('supabase_schema_probe_confirmation', 'Подтверждение schema drift',
        supabaseSchemaProbeConfirmationCheck.pass ? 'pass' : 'fail',
        supabaseSchemaProbeConfirmationCheck.pass
          ? 'Одиночный сбой schema probe подтверждается повторной проверкой; transient recovery не блокирует релиз.'
          : 'Самопроверка schema confirmation guard не прошла.', true),
      releaseCheck('supabase_schema_drift', 'Контракт актуальной схемы Supabase', schemaDrift.ok ? 'pass' : 'fail',
        schemaDrift.ok
          ? `Проверено ${schemaDrift.checked} обязательных участков схемы v6.17; drift не обнаружен · attempts=${Number(schemaDrift.attempts || 1)}${schemaDrift.recovered ? ' · transient recovered' : ''}.`
          : schemaDrift.failureMode === 'unavailable'
            ? `Schema probe недоступен после ${Number(schemaDrift.attempts || 1)} попыток: ${(schemaDrift.unavailable || []).join(', ') || 'обязательные проверки'}. Release остаётся fail-closed, но потеря схемы не утверждается.`
            : schemaDrift.failureMode === 'mixed'
              ? `Schema probe частично недоступен, при этом подтверждён drift: ${(schemaDrift.missing || []).join(', ') || 'обязательные объекты'}; недоступны ${(schemaDrift.unavailable || []).join(', ') || 'другие проверки'}.`
              : `Schema drift: отсутствуют или несовместимы ${schemaDrift.missing.join(', ') || 'обязательные объекты'}; подтверждено после ${Number(schemaDrift.attempts || 1)} probe.`, true),
      releaseCheck('supabase_schema_drift_selftest', 'Самопроверка Schema Drift Guard', schemaDriftSelfTest.pass ? 'pass' : 'fail',
        schemaDriftSelfTest.pass ? 'Drift корректно переводит release gate в блокирующее состояние.' : 'Самопроверка Schema Drift Guard не прошла.', true),
      releaseCheck('provider_data_reliability_selftest', 'Самопроверка надёжности API-Football', providerReliabilitySelfTest.pass ? 'pass' : 'fail',
        providerReliabilitySelfTest.pass
          ? `empty=${providerReliabilitySelfTest.empty}; skipped=${providerReliabilitySelfTest.skipped}; plan=${providerReliabilitySelfTest.limited}; trustCap=${providerReliabilitySelfTest.trustCap}.`
          : 'Классификация пустых, ограниченных и ошибочных ответов API-Football не прошла самопроверку.', true),
      releaseCheck('ai_analysis_quality_gate_selftest', 'Самопроверка AI Quality Gate', aiQualityGateSelfTest.pass ? 'pass' : 'fail',
        aiQualityGateSelfTest.pass
          ? `ready=${aiQualityGateSelfTest.ready}; hold=${aiQualityGateSelfTest.hold}; причины hold: ${aiQualityGateSelfTest.holdReasons.join(', ')}.`
          : 'AI Quality Gate не удерживает слабый сигнал fail-closed.', true),
      releaseCheck('ai_analysis_freshness_selftest', 'Самопроверка свежести AI', analysisFreshnessSelfTest.pass ? 'pass' : 'fail',
        analysisFreshnessSelfTest.pass
          ? `Проверено ${Number(analysisFreshnessSelfTest.cases || 0)} сценария свежести: near-kickoff, fresh, far-away и некорректное время снимка.`
          : 'AI Freshness Guard не прошёл детерминированную самопроверку и release остаётся fail-closed.', true),
      releaseCheck('telegram_miniapp_e2e_selftest', 'Telegram → Mini App E2E', telegramMiniAppE2ESelfTest.pass ? 'pass' : 'fail',
        telegramMiniAppE2ESelfTest.pass
          ? `Проверено ${telegramMiniAppE2ESelfTest.cases} переходов: поиск → матч → Quick AI → полный анализ → избранное.`
          : 'Серверный Telegram/Mini App handoff-контракт нарушен.', true),
      releaseCheck('telegram_webhook_persistent_dedupe', 'Persistent dedupe Telegram webhook',
        telegramPersistentDedupeCheck.pass && !schemaDrift.missing.includes('telegram_update_claims') ? 'pass' : 'fail',
        telegramPersistentDedupeCheck.pass && !schemaDrift.missing.includes('telegram_update_claims')
          ? 'Update ID защищён атомарным claim в Supabase; memory-dedupe остаётся быстрым первым слоем и fallback.'
          : 'Не готова таблица/RPC persistent dedupe Telegram webhook.', true),
      releaseCheck('telegram_webhook_dedupe_observability', 'Наблюдаемость Telegram webhook dedupe',
        !telegramDedupeObservabilityCheck.pass || !diagnostics.telegramWebhook?.available
          ? 'fail'
          : diagnostics.telegramWebhook?.state === 'incident'
            ? 'fail'
            : diagnostics.telegramWebhook?.state === 'watch'
              ? 'warn'
              : 'pass',
        diagnostics.telegramWebhook?.available
          ? `state=${diagnostics.telegramWebhook.state}; claims=${Number(diagnostics.telegramWebhook.claimsRecent || 0)}; duplicates=${Number(diagnostics.telegramWebhook.duplicateAttemptsRetained || 0)}; stale=${Number(diagnostics.telegramWebhook.staleProcessing || 0)}; failed=${Number(diagnostics.telegramWebhook.failedCurrent || 0)}.`
          : `Health RPC недоступен. ${SUPABASE_SCHEMA_GUIDANCE}`,
        true),
      releaseCheck('backend_security_contract', 'Контракт безопасности Supabase', backendSecurity.ok ? 'pass' : 'fail',
        backendSecurity.ok
          ? 'Все публичные таблицы защищены правилами доступа; анонимный и авторизованный клиент не имеют прямых прав; серверные процедуры закрыты.'
          : `Контракт безопасности текущей версии: ${backendSecurity.status || 'ошибка'}.`, true),
      releaseCheck('model_backtest', 'Схема исторической проверки', modelTable.ok ? 'pass' : 'fail', modelTable.ok ? 'Таблица прогнозов модели доступна.' : `model_predictions: ${modelTable.status}.`, true),
      releaseCheck('prediction_integrity', 'Самопроверка целостности прогнозов', modelIntegrityCheck.pass ? 'pass' : 'fail',
        modelIntegrityCheck.pass ? 'Вероятности, время снимка и согласованность результата проходят синтетическую самопроверку.' : 'Самопроверка целостности прогнозов не прошла.', true),
      releaseCheck('prediction_remediation', 'Восстановление прогнозов v6.1', remediationTable.ok ? 'pass' : 'fail',
        remediationTable.ok ? 'Журнал действий восстановления доступен.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('settlement_watchdog_schema', 'Схема контроля результатов v6.4', watchdogSchema.ok ? 'pass' : 'fail',
        watchdogSchema.ok ? 'Переключатель автоматического восстановления и источник запуска по расписанию доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('settlement_watchdog_selftest', 'Самопроверка контроля результатов', watchdogSelfTest.pass ? 'pass' : 'fail',
        watchdogSelfTest.pass ? `shadow=${watchdogSelfTest.shadow}, runtime=${watchdogSelfTest.runtime}, quota=${watchdogSelfTest.quota}, active=${watchdogSelfTest.active}.` : 'Самопроверка решения контролёра результатов не прошла.', true),
      releaseCheck('settlement_run_ledger_schema', 'Схема журнала запусков v6.4', runLedgerSchema.ok ? 'pass' : 'fail',
        runLedgerSchema.ok ? 'Время прерванных запусков, счётчик попыток и связь повторных запусков доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('settlement_run_ledger_selftest', 'Самопроверка журнала запусков', settlementRunLedgerCheck.pass ? 'pass' : 'fail',
        settlementRunLedgerCheck.pass ? 'Fresh=1, interrupted retry=2, attempt 3 exhausts lineage, different batch starts fresh.' : 'Самопроверка журнала запусков не прошла.', true),
      releaseCheck('settlement_finality_schema', 'Схема подтверждения результата v6.5', finalitySchema.ok ? 'pass' : 'fail',
        finalitySchema.ok ? 'Состояние проверки и журнал расхождений доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('settlement_finality_selftest', 'Самопроверка подтверждения результата', settlementFinalityCheck.pass ? 'pass' : 'fail',
        settlementFinalityCheck.pass ? 'First matching pass verifies; second matching pass confirms; late score/status changes become drift.' : 'Самопроверка окончательности результата не прошла.', true),
      releaseCheck('settlement_adjudication_schema', 'Схема разбора расхождений v6.6', adjudicationSchema.ok ? 'pass' : 'fail',
        adjudicationSchema.ok ? 'Журнал решений и поля разрешения модели доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('settlement_adjudication_selftest', 'Самопроверка разбора расхождений', settlementAdjudicationCheck.pass ? 'pass' : 'fail',
        settlementAdjudicationCheck.pass ? 'Keep/accept/void transitions valid; unsafe provider acceptance blocked.' : 'Самопроверка ручного разбора результатов не прошла.', true),
      releaseCheck('settlement_trust_schema', 'Схема доверенных метрик v6.7', trustSchema.ok ? 'pass' : 'fail',
        trustSchema.ok ? 'Количество проверок и время первой проверки доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('trusted_metrics_gate_selftest', 'Самопроверка доверенных метрик', trustedMetricsCheck.pass ? 'pass' : 'fail',
        trustedMetricsCheck.pass ? 'В метрики и калибровку допускаются только подтверждённые или вручную разобранные завершённые записи.' : 'Самопроверка допуска доверенных метрик не прошла.', true),
      releaseCheck('calibration_promotion_schema', 'Схема продвижения калибровки v6.8', calibrationPromotionSchema.ok ? 'pass' : 'fail',
        calibrationPromotionSchema.ok ? 'Журнал решений по отложенной выборке доступен.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('calibration_promotion_selftest', 'Самопроверка продвижения калибровки', calibrationPromotionCheck.pass ? 'pass' : 'fail',
        calibrationPromotionCheck.pass ? 'Устойчивое улучшение проходит проверку, синтетическое переобучение блокируется.' : 'Самопроверка продвижения калибровки не прошла.', true),
      releaseCheck('calibration_lifecycle_schema', 'Atomic calibration lifecycle v6.10', calibrationLifecycleSchema.ok ? 'pass' : 'fail',
        calibrationLifecycleSchema.ok ? 'Атомарное состояние, журнал переходов и состояние отката доступны.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('automatic_settlement_recovery', 'Автоматическое восстановление результатов', 'pass',
        runtime.autoSettlementRecoveryEnabled ? 'Автовосстановление включено: запуск по расписанию разрешён защитными правилами.' : 'Автовосстановление выключено: контролёр результатов работает в режиме наблюдения и только сигнализирует.', false),
      releaseCheck('runtime_controls_schema', 'Схема управления функциями', runtimeTable.ok ? 'pass' : 'fail', runtimeTable.ok ? 'Таблица runtime_controls доступна.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('runtime_history_schema', 'История откатов', runtimeHistoryTable.ok ? 'pass' : 'fail', runtimeHistoryTable.ok ? 'История управления функциями доступна.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('runtime_controls_state', 'Состояние управления функциями', runtime.maintenanceMode ? 'warn' : 'pass', runtime.maintenanceMode ? `Техническое обслуживание включено${runtime.message ? `: ${runtime.message}` : '.'}` : `Revision ${Number(runtime.revision || 1)} · рабочий режим.`, false),
      releaseCheck('observability', 'Схема журнала событий', diagnostics.observability?.migrationReady ? 'pass' : 'warn', diagnostics.observability?.migrationReady ? 'Постоянный журнал операционных событий доступен.' : 'Журнал работает только в памяти серверного обработчика.', false),
      releaseCheck('integrity', 'Схема целостности данных', diagnostics.integrity?.migrationReady ? 'pass' : 'fail', diagnostics.integrity?.migrationReady ? 'История проверок целостности доступна.' : SUPABASE_SCHEMA_GUIDANCE, true),
      releaseCheck('provider_health', 'Состояние API-Football', provider.health === 'critical' ? 'fail' : provider.health === 'warning' || provider.health === 'waiting' ? 'warn' : 'pass', provider.health === 'waiting' ? 'После старта серверного обработчика ещё не было успешного запроса к источнику данных.' : `Health: ${provider.health || 'unknown'}.`, provider.health === 'critical'),
      releaseCheck('provider_transition', 'Provider transition', providerTransitionProfile().paid ? 'pass' : 'warn', providerTransitionProfile().paid ? `${providerTransitionProfile().plan}: расширенный режим активен.` : `${providerTransitionProfile().plan}: приложение остаётся в экономном режиме до увеличения квоты.`, false),
      releaseCheck('quota_orchestrator', 'Quota Orchestrator', providerBudgetProfile().mode === 'emergency' ? 'warn' : 'pass', `${providerBudgetProfile().label}; feature cache api/cache=${Number(memory.providerFeatureFetch?.api || 0)}/${Number(memory.providerFeatureFetch?.cache || 0)}.`, false),
      releaseCheck(
        'expanded_e2e',
        'Сквозная проверка расширенных данных',
        memory.providerE2E?.last?.status?.ready ? 'pass' : memory.providerE2E?.last?.status?.code === 'NEEDS_ATTENTION' ? 'warn' : 'warn',
        memory.providerE2E?.last
          ? `${memory.providerE2E.last.status?.label || 'Нет статуса'} · матч ${memory.providerE2E.last.fixtureId || '—'}.`
          : 'Сквозная проверка ещё не запускалась. На бесплатном тарифе это ожидаемо.',
        false
      ),
      releaseCheck('telegram', 'Telegram bot runtime', cfg.botToken ? 'pass' : 'warn', cfg.botToken ? 'Токен Telegram-бота доступен.' : 'Без токена бота не будут работать уведомления Telegram.', false),
      releaseCheck('production_mode', 'Production mode', cfg.devMode ? 'warn' : 'pass', cfg.devMode ? 'Режим разработки включён — перед релизом его нужно выключить.' : 'DEV_MODE=false.', false),
      releaseCheck('load_safety', 'Защита от нагрузки', memory.productionReadiness?.value?.status === 'blocked' ? 'fail' : memory.productionReadiness?.value ? 'pass' : 'warn',
        memory.productionReadiness?.value ? `${memory.productionReadiness.value.label} · ${memory.productionReadiness.value.score}%.` : 'Проверка производственной безопасности ещё не запускалась.', false),
      releaseCheck('rc_regression', 'Регрессионная проверка кандидата на выпуск', memory.rcRegression?.value?.status === 'blocked' ? 'fail' : memory.rcRegression?.value ? 'pass' : 'warn',
        memory.rcRegression?.value ? `${memory.rcRegression.value.label} · ${memory.rcRegression.value.score}%.` : 'Регрессионная проверка RC ещё не запускалась.', false),
      releaseCheck('release_monitor', 'Мониторинг релиза', memory.releaseMonitor?.h24?.value?.health?.state === 'incident' ? 'warn' : memory.releaseMonitor?.h24?.value ? 'pass' : 'warn',
        memory.releaseMonitor?.h24?.value ? `${memory.releaseMonitor.h24.value.health.label} · ${memory.releaseMonitor.h24.value.health.score}%.` : 'Мониторинг релиза ещё не запускался.', false),
      releaseCheck('production_monitor', 'Production monitor', productionMonitor.state === 'incident' ? 'fail' : productionMonitor.state === 'watch' ? 'warn' : 'pass',
        `${productionMonitor.label} · release score ${Number(productionMonitor.release?.score || 0)}%.`, productionMonitor.state === 'incident'),
      releaseCheck('monetization', 'Монетизация', cfg.monetizationEnabled ? 'warn' : 'pass', cfg.monetizationEnabled ? 'Монетизация включена, хотя текущий план проекта — запускать её в финале.' : 'Оплата корректно остаётся на паузе.', false),
      releaseCheck('integrity_last_run', 'Последняя проверка матчей', diagnostics.integrity?.lastRun?.health === 'critical' ? 'warn' : 'pass', diagnostics.integrity?.lastRun ? `Состояние: ${diagnostics.integrity.lastRun.health || 'норма'}, качество ${Number(diagnostics.integrity.lastRun.qualityScore || 0)}%.` : 'Проверка появится после загрузки каталога матчей.', false),
    ];
  
    const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
    const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
    const passed = checks.filter(x => x.state === 'pass').length;
    const score = Math.round((passed / checks.length) * 100);
    const status = blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready';
    const label = blockers.length ? 'Есть блокирующие проверки' : warnings.length ? 'Ядро готово, есть предупреждения' : 'Ядро кандидата на выпуск готово';
  
    const value = {
      available: true,
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      status,
      label,
      score,
      checks,
      blockers: blockers.map(x => x.id),
      warnings: warnings.map(x => x.id),
      diagnostics,
      policy: {
        monetizationExpected: 'paused',
        paymentTestingRequiredNow: false,
        providerUpgradeRequiredNow: false,
        note: 'Текущая версия использует ежедневный контроль результатов и безопасное восстановление. Предматчевые снимки не перезаписываются, пользовательская оплата остаётся выключенной.',
      },
    };
    memory.releaseReadiness = { at: now, value };
    return json(value);
  }

  async function apiRcRegression(request, cfg, user) {
    const url = new URL(request.url);
    const force = url.searchParams.get('refresh') === '1';
    const now = Date.now();
  
    if (!force && memory.rcRegression?.value && now - Number(memory.rcRegression.at || 0) < 30000) {
      return json({ ...memory.rcRegression.value, cached: true });
    }
  
    const checks = [];
    const startedAt = Date.now();
  
    // 1) Core runtime / security configuration.
    const releaseMetadataOk = APP_VERSION.endsWith(`-${RELEASE_CHANNEL}`) && RELEASE_CHANNEL === RC_NAME.toLowerCase();
    checks.push(rcCheck('version', 'runtime', 'Согласованность версии RC', releaseMetadataOk ? 'pass' : 'fail',
      `Сервер: ${APP_VERSION}; канал ${RELEASE_CHANNEL}; кандидат ${RC_NAME}.`, true));
    checks.push(rcCheck('api_contract', 'runtime', 'Контракт обмена данными', API_CONTRACT_VERSION === 5 ? 'pass' : 'fail',
      `Версия контракта ${API_CONTRACT_VERSION}; минимальный клиент ${MIN_CLIENT_VERSION}.`, true));
    checks.push(rcCheck('app_manifest', 'runtime', 'Публичный манифест приложения', appManifest(cfg)?.version === APP_VERSION ? 'pass' : 'fail',
      `Канал ${RELEASE_CHANNEL}; версия манифеста ${appManifest(cfg)?.version || '—'}.`, true));
    checks.push(rcCheck('production_mode', 'runtime', 'Режим разработки выключен', cfg.devMode ? 'fail' : 'pass',
      cfg.devMode ? 'Режим разработки включён.' : 'Режим разработки выключен.', true));
    checks.push(rcCheck('monetization_paused', 'runtime', 'Монетизация на паузе', cfg.monetizationEnabled ? 'fail' : 'pass',
      cfg.monetizationEnabled ? 'MONETIZATION_ENABLED=true.' : 'Платёжный контур не активирован.', true));
    checks.push(rcCheck('telegram_runtime', 'runtime', 'Интеграция Telegram', cfg.botToken ? 'pass' : 'fail',
      cfg.botToken ? 'Токен бота доступен серверному обработчику.' : 'Токен Telegram-бота отсутствует.', true));
    checks.push(rcCheck('football_key', 'runtime', 'Ключ API-Football', cfg.apiFootballKey ? 'pass' : 'fail',
      cfg.apiFootballKey ? 'Ключ API доступен серверному обработчику.' : 'Ключ API-Football отсутствует.', true));
    checks.push(rcCheck('supabase_runtime', 'runtime', 'Подключение Supabase', hasSupabase(cfg) ? 'pass' : 'fail',
      hasSupabase(cfg) ? 'Адрес и сервисный ключ доступны.' : 'Отсутствует адрес Supabase или сервисный ключ.', true));
  
    const backendSecurity = await readBackendSecurityContract(cfg);
    checks.push(rcCheck(
      'backend_security_contract',
      'security',
      'Контракт минимальных привилегий Supabase',
      backendSecurity.ok ? 'pass' : 'fail',
      backendSecurity.ok
        ? 'Правила доступа включены; прямые права анонимного и авторизованного клиента, а также публичный запуск процедур отсутствуют.'
        : `Контракт безопасности: ${backendSecurity.status || 'ошибка'}. ${SUPABASE_SCHEMA_GUIDANCE}`,
      true
    ));
  
    const currentAdminOk = isAdminUser(user, cfg);
    const failClosedOk = !cfg.devMode && !isAdminUser({ id: 0 }, cfg);
    const devIsolationOk = !isAdminUser({ id: 5195504559 }, { ...cfg, devMode: true, adminTelegramIds: [] })
      && isAdminUser({ id: DEVELOPMENT_TELEGRAM_ID, __developmentIdentity: true }, { ...cfg, devMode: true, adminTelegramIds: [] });
    checks.push(rcCheck('admin_current', 'security', 'Текущий пользователь — администратор', currentAdminOk ? 'pass' : 'fail',
      currentAdminOk ? 'Серверная проверка данных запуска Telegram пройдена, идентификатор разрешён.' : 'Текущий пользователь не проходит проверку администратора.', true));
    checks.push(rcCheck('admin_fail_closed', 'security', 'Защита доступа администратора', failClosedOk ? 'pass' : 'fail',
      failClosedOk ? 'Неизвестный идентификатор Telegram не получает роль администратора.' : 'Проверьте режим разработки и правила доступа администратора.', true));
    checks.push(rcCheck('admin_dev_isolation', 'security', 'Режим разработки не повышает права реальных пользователей', devIsolationOk ? 'pass' : 'fail',
      devIsolationOk ? 'Только серверная тестовая учётная запись получает роль администратора в режиме разработки.' : 'Изоляция администратора в режиме разработки нарушена.', true));
    checks.push(rcCheck('admin_list', 'security', 'Список администраторов настроен', cfg.adminTelegramIds?.length ? 'pass' : 'fail',
      cfg.adminTelegramIds?.length ? `Настроено идентификаторов: ${cfg.adminTelegramIds.length}. Значения не раскрываются.` : 'Список администраторов пуст.', true));
  
    // 2) Persistence schema regression.
    const requiredTables = [
      ['users', 'Пользователи', true],
      ['usage_daily', 'Дневные лимиты', true],
      ['analysis_cache', 'Общие сохранённые данные', true],
      ['analysis_history', 'История анализов', true],
      ['favorites', 'Избранное', true],
      ['user_preferences', 'Настройки пользователя', true],
      ['match_reminders', 'Напоминания', true],
      ['runtime_controls', 'Управление функциями', true],
      ['runtime_control_history', 'История откатов функций', true],
      ['model_predictions', 'Прогнозы модели', true],
      ['model_calibration_validations', 'Аудит продвижения калибровки', true],
      ['model_calibration_profiles', 'Реестр профилей калибровки', true],
      ['model_calibration_state', 'Активное состояние калибровки', true],
      ['model_calibration_transitions', 'Аудит атомарных переходов калибровки', true],
      ['prediction_integrity_actions', 'Аудит восстановления прогнозов', true],
      ['ops_events', 'Операционный журнал', false],
      ['match_integrity_runs', 'Запуски проверки целостности', true],
      ['match_integrity_events', 'События целостности', true],
      ['odds_snapshots', 'История коэффициентов', false],
      ['billing_payments', 'Хранилище платежей (на паузе)', false],
    ];
  
    const tableResults = await Promise.all(requiredTables.map(async ([table, label, blocking]) => {
      const result = await probeOptionalTable(cfg, table);
      return { table, label, blocking, ...result };
    }));
  
    for (const table of tableResults) {
      const state = table.ok ? 'pass' : table.blocking ? 'fail' : 'warn';
      checks.push(rcCheck(
        `table_${table.table}`,
        'database',
        table.label,
        state,
        table.ok ? `${table.table}: доступна.` : `${table.table}: ${table.status || 'ошибка'}.`,
        table.blocking
      ));
    }
  
    const runtimeState = await loadRuntimeControls(cfg, { force: true });
    checks.push(rcCheck(
      'runtime_controls_state',
      'runtime',
      'Управление функциями',
      runtimeState.schemaReady ? 'pass' : 'fail',
      runtimeState.schemaReady
        ? `Версия ${Number(runtimeState.value?.revision || 1)} · ${runtimeState.value?.maintenanceMode ? 'обслуживание ВКЛ' : 'обычный режим'} · автовосстановление ${runtimeState.value?.autoSettlementRecoveryEnabled ? 'ВКЛ' : 'наблюдение'}.`
        : SUPABASE_SCHEMA_GUIDANCE,
      true
    ));
  
    const watchdogSchema = await probeSettlementWatchdogSchema(cfg);
    checks.push(rcCheck(
      'settlement_watchdog_schema',
      'database',
      'Схема контроля результатов v6.4',
      watchdogSchema.ok ? 'pass' : 'fail',
      watchdogSchema.ok ? 'Переключатель среды и источник запуска доступны.' : SUPABASE_SCHEMA_GUIDANCE,
      true
    ));
  
    const runtimeHistorySchema = await probeRuntimeHistorySchema(cfg);
    checks.push(rcCheck(
      'runtime_history_schema',
      'database',
      'История откатов',
      runtimeHistorySchema.ok ? 'pass' : 'fail',
      runtimeHistorySchema.ok ? 'История версий и откат доступны.' : SUPABASE_SCHEMA_GUIDANCE,
      true
    ));
  
    const reminderSchema = await probeReminderReliabilitySchema(cfg);
    checks.push(rcCheck(
      'reminder_delivery_schema',
      'database',
      'Схема доставки уведомлений',
      reminderSchema.ok ? 'pass' : 'fail',
      reminderSchema.ok ? 'Поля атомарной блокировки доставки доступны.' : SUPABASE_SCHEMA_GUIDANCE,
      true
    ));
  
    const calibrationSelfTest = calibrationPromotionSelfTest();
    checks.push(rcCheck(
      'calibration_promotion_selftest',
      'safety',
      'Самопроверка продвижения калибровки',
      calibrationSelfTest.pass ? 'pass' : 'fail',
      calibrationSelfTest.pass
        ? `stableActive=${calibrationSelfTest.stableActive}; holdout=${calibrationSelfTest.stableValidation}; overfitBlocked=${calibrationSelfTest.overfitBlocked}.`
        : 'Самопроверка продвижения калибровки не прошла.',
      true
    ));
  
    // 3) Read-only user route regression. No mutation and no API-Football usage.
    const readRoutes = await Promise.all([
      rcReadRoute('Профиль', () => apiMe(request, cfg, user)),
      rcReadRoute('Избранное', () => apiFavorites(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
      rcReadRoute('Игроки', () => apiFavoritePlayers(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
      rcReadRoute('Напоминания', () => apiReminders(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
      rcReadRoute('Настройки', () => apiPreferences(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
      rcReadRoute('История', () => apiHistory(new Request(request.url, { method: 'GET', headers: request.headers }), cfg, user)),
    ]);
  
    for (const route of readRoutes) {
      checks.push(rcCheck(
        `read_${route.label.toLowerCase()}`,
        'user_routes',
        `${route.label} GET`,
        route.ok ? 'pass' : 'fail',
        route.ok
          ? `Ответ ${route.status} · ${route.latencyMs} мс · поля: ${route.shape.join(', ') || 'объект'}.`
          : `Ответ ${route.status || '—'} · ${route.error || 'маршрут не выполнен'}.`,
        true
      ));
    }
  
    // 4) Existing release/safety gates.
    let release = null;
    let production = null;
    try { release = await responseJsonSafe(await apiReleaseReadiness(new Request(`${url.origin}/api/release-readiness?refresh=1`), cfg)); } catch {}
    try { production = await responseJsonSafe(await apiProductionReadiness(new Request(`${url.origin}/api/production-readiness?refresh=1`), cfg)); } catch {}
  
    checks.push(rcCheck(
      'release_gate',
      'gates',
      'Готовность ядра к выпуску',
      release?.status === 'blocked' ? 'fail' : release?.available ? (release?.status === 'ready' ? 'pass' : 'warn') : 'fail',
      release?.available ? `${release.label || release.status} · ${Number(release.score || 0)}%.` : 'Проверка готовности выпуска недоступна.',
      true
    ));
    checks.push(rcCheck(
      'production_gate',
      'gates',
      'Защита от нагрузки',
      production?.status === 'blocked' ? 'fail' : production?.available ? (production?.status === 'ready' ? 'pass' : 'warn') : 'fail',
      production?.available ? `${production.label || production.status} · ${Number(production.score || 0)}%.` : 'Проверка производственной безопасности недоступна.',
      true
    ));
  
    const transition = providerTransitionProfile();
    const budget = providerBudgetProfile();
    const lastE2E = await loadLastProviderE2E(cfg);
  
    checks.push(rcCheck(
      'provider_mode',
      'provider',
      'Режим источника данных',
      budget.mode === 'emergency' ? 'warn' : 'pass',
      `${transition.plan} · ${budget.label}.`,
      false
    ));
    checks.push(rcCheck(
      'expanded_e2e',
      'provider',
      'Сквозная проверка расширенных данных',
      transition.paid
        ? (lastE2E?.status?.ready ? 'pass' : 'warn')
        : 'warn',
      transition.paid
        ? (lastE2E?.status?.ready ? `${lastE2E.status.label} · матч ${lastE2E.fixtureId}.` : 'Расширенный тариф обнаружен, но сквозная проверка ещё не подтверждена.')
        : 'Бесплатный режим с ожиданием допустим для ядра RC; полная сквозная проверка расширенных данных выполняется после увеличения квоты.',
      false
    ));
  
    // 5) Static server-side invariants.
    const integritySelfTest = modelIntegritySelfTest();
    checks.push(rcCheck(
      'prediction_integrity_selftest',
      'safety',
      'Самопроверка целостности прогнозов',
      integritySelfTest.pass ? 'pass' : 'fail',
      integritySelfTest.pass
        ? 'Синтетическая проверка корректно обнаруживает отсутствующие и некорректные вероятности, ошибки времени, зависшие ожидания и несогласованный исход.'
        : 'Самопроверка целостности прогнозов не прошла.',
      true
    ));
  
    const remediationSelfTest = modelRemediationSelfTest();
    checks.push(rcCheck(
      'prediction_remediation_selftest',
      'safety',
      'Самопроверка восстановления прогнозов',
      remediationSelfTest.pass ? 'pass' : 'fail',
      remediationSelfTest.pass
        ? `${remediationSelfTest.candidates} stale candidates → ${remediationSelfTest.selected} selected across ${remediationSelfTest.dates} date batch(es).`
        : 'Самопроверка выбора прогнозов для восстановления не прошла.',
      true
    ));
  
    const watchdogSelfTest = settlementWatchdogSelfTest();
    checks.push(rcCheck(
      'settlement_watchdog_selftest',
      'safety',
      'Самопроверка контроля результатов',
      watchdogSelfTest.pass ? 'pass' : 'fail',
      watchdogSelfTest.pass
        ? `shadow=${watchdogSelfTest.shadow}; runtime=${watchdogSelfTest.runtime}; quota=${watchdogSelfTest.quota}; active=${watchdogSelfTest.active}; clean=${watchdogSelfTest.clean}.`
        : 'Самопроверка решения контролёра результатов не прошла.',
      true
    ));
  
    const safety = productionSafetySnapshot();
    checks.push(rcCheck('singleflight', 'safety', 'Объединение одинаковых запросов', 'pass',
      `${Number(safety.singleflight?.joins || 0)} joins; ${Number(safety.singleflight?.active || 0)} active.`, true));
    checks.push(rcCheck('burst_guard', 'safety', 'Защита от всплесков запросов', Number(safety.burstGuard?.policies?.length || 0) >= 8 ? 'pass' : 'fail',
      `${Number(safety.burstGuard?.policies?.length || 0)} route policies.`, true));
    checks.push(rcCheck('telegram_webhook_guard', 'safety', 'Защита Telegram webhook', Number(safety.telegramWebhook?.policies?.length || 0) >= 3 ? 'pass' : 'fail',
      `${Number(safety.telegramWebhook?.policies?.length || 0)} policies; ${Number(safety.telegramWebhook?.duplicateUpdates || 0)} duplicate updates ignored.`, true));
    checks.push(rcCheck('timeouts', 'safety', 'Тайм-ауты внешних сервисов', 'pass',
      `Supabase ${Number(safety.upstream?.supabaseTimeoutMs || 0)} мс; API-Football ${Number(safety.upstream?.apiFootballTimeoutMs || 0)} мс.`, true));
    checks.push(rcCheck('l1_bounds', 'safety', 'Ограниченное быстрое хранилище', Number(safety.memory?.cacheEntries || 0) <= 600 ? 'pass' : 'warn',
      `${Number(safety.memory?.cacheEntries || 0)} entries; soft limit ${Number(safety.memory?.cacheSoftLimit || 500)}.`, false));
  
    const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
    const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
    const passed = checks.filter(x => x.state === 'pass').length;
    const score = Math.round((passed / Math.max(1, checks.length)) * 100);
    const status = blockers.length ? 'blocked' : warnings.length ? 'rc_with_holds' : 'rc_ready';
  
    const groups = {};
    for (const check of checks) {
      groups[check.group] ||= { total: 0, pass: 0, warn: 0, fail: 0 };
      groups[check.group].total += 1;
      groups[check.group][check.state] = Number(groups[check.group][check.state] || 0) + 1;
    }
  
    const value = {
      available: true,
      releaseCandidate: RC_NAME,
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      status,
      label: blockers.length
        ? 'Кандидат на выпуск заблокирован: есть обязательные ошибки'
        : warnings.length
          ? `${RC_NAME} готов к проверке, есть ожидаемые ограничения или предупреждения`
          : `${RC_NAME}: регрессионная проверка пройдена`,
      score,
      summary: {
        total: checks.length,
        passed,
        warnings: warnings.length,
        blockers: blockers.length,
      },
      groups,
      checks,
      readRoutes,
      tableResults: tableResults.map(x => ({ table: x.table, ok: x.ok, status: x.status, blocking: x.blocking })),
      provider: {
        plan: transition.plan,
        mode: budget.mode,
        expandedE2E: lastE2E?.status?.code || (transition.paid ? 'NOT_RUN' : 'HOLD_FREE'),
      },
      policy: {
        mutatesUserData: false,
        consumesFootballApi: false,
        sqlRequired: false,
        payments: 'paused',
        note: 'Регрессионная проверка RC проверяет среду выполнения, схему базы, пользовательские маршруты только для чтения, безопасность и защитные проверки. Она не запускает полный анализ и не расходует API-Football.',
      },
    };
  
    memory.rcRegression = { at: now, value };
    await recordOpsEvent(cfg, {
      severity: blockers.length ? 'error' : warnings.length ? 'warning' : 'info',
      source: 'release',
      eventType: 'rc_regression',
      code: blockers.length ? 'RC_BLOCKED' : warnings.length ? 'RC_WITH_HOLDS' : 'RC_READY',
      message: value.label,
      meta: {
        releaseCandidate: RC_NAME,
        score,
        blockers: blockers.map(x => x.id),
        warnings: warnings.map(x => x.id),
        durationMs: value.durationMs,
      },
    }).catch(() => {});
  
    return json(value);
  }

  return Object.freeze({
    apiCalibrationControl,
    apiDiagnostics,
    apiModelQuality,
    apiModelRemediation,
    apiProductionMonitor,
    apiProviderBudget,
    apiProviderCoverageAudit,
    apiProviderE2EValidation,
    apiProviderProbe,
    apiRcRegression,
    apiReleaseReadiness,
    apiReminderHealth,
  });
}
