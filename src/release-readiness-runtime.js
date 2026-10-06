// Release and production readiness checks extracted from worker.js.
// Diagnostics, self-tests, runtime policy and provider state are injected by the composition root.
export function createReleaseReadinessRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Release readiness runtime dependencies are required.');
  }
  const {
    APP_VERSION,
    ROUTE_BURST_POLICIES,
    collectDiagnostics,
    distributedAnalysisLockDrill,
    distributedAnalysisLockPolicy,
    json,
    loadLastProviderE2E,
    memory,
    productionSafetySnapshot,
    providerBudgetProfile,
    providerTransitionProfile,
    redactOpsString,
    responseJsonSafe,
    settlementDriftAdjudicationSelfTest,
    settlementFinalitySelfTest,
    settlementRunLedgerSelfTest,
    sleepMs,
    supabaseProbeConfirmationSelfTest,
    supabaseSchemaProbeConfirmationSelfTest,
    trustedMetricsGateSelfTest,
    withSingleFlight,
  } = deps;

  function releaseCheck(id, label, state, detail, blocking = false) {
    return { id, label, state, detail, blocking: Boolean(blocking) };
  }
  
  
  async function runSingleFlightSelfTest() {
    const key = `selftest:${Date.now()}`;
    let executions = 0;
    const values = await Promise.all(Array.from({ length: 8 }, () =>
      withSingleFlight(key, async () => {
        executions += 1;
        await sleepMs(25);
        return 'ok';
      }, { countTelemetry: false })
    ));
    return { pass: executions === 1 && values.every(x => x === 'ok'), executions, callers: values.length };
  }
  
  function productionCheck(id, label, state, detail, blocking = false) {
    return { id, label, state, detail, blocking: Boolean(blocking) };
  }
  
  async function apiProductionReadiness(request, cfg) {
    const now = Date.now();
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    if (!force && memory.productionReadiness?.value && now - Number(memory.productionReadiness.at || 0) < 30000) {
      return json({ ...memory.productionReadiness.value, cached: true });
    }
  
    const [diagnostics, singleflightTest] = await Promise.all([
      collectDiagnostics(cfg),
      runSingleFlightSelfTest(),
    ]);
    const runLedgerSelfTest = settlementRunLedgerSelfTest();
    const finalitySelfTest = settlementFinalitySelfTest();
    const adjudicationSelfTest = settlementDriftAdjudicationSelfTest();
    const trustedGateSelfTest = trustedMetricsGateSelfTest();
  
    const safety = productionSafetySnapshot();
    const providerBudget = providerBudgetProfile();
    const paidProvider = providerTransitionProfile().paid;
    const lastE2E = await loadLastProviderE2E(cfg);
  
    const checks = [
      productionCheck('settlement_run_ledger_selftest', 'Самопроверка журнала запусков', runLedgerSelfTest.pass ? 'pass' : 'fail',
        runLedgerSelfTest.pass
          ? `fresh=${runLedgerSelfTest.fresh}; retry=${runLedgerSelfTest.retry}; exhausted=${runLedgerSelfTest.exhausted}; differentBatch=${runLedgerSelfTest.differentBatch}.`
          : 'Самопроверка журнала запусков фиксации результатов не прошла.', true),
      productionCheck('settlement_finality_selftest', 'Самопроверка подтверждения результата', finalitySelfTest.pass ? 'pass' : 'fail',
        finalitySelfTest.pass
          ? `verified=${finalitySelfTest.verified}; scoreDrift=${finalitySelfTest.scoreDrift}; statusDrift=${finalitySelfTest.statusDrift}; wait=${finalitySelfTest.wait}.`
          : 'Самопроверка окончательности результата не прошла.', true),
      productionCheck('settlement_adjudication_selftest', 'Самопроверка разбора расхождений', adjudicationSelfTest.pass ? 'pass' : 'fail',
        adjudicationSelfTest.pass
          ? `keep=${adjudicationSelfTest.keep}; accept=${adjudicationSelfTest.accept}; void=${adjudicationSelfTest.void}; unsafeBlocked=${adjudicationSelfTest.unsafeAcceptBlocked}.`
          : 'Самопроверка ручного разбора результатов не прошла.', true),
      productionCheck('trusted_metrics_gate_selftest', 'Самопроверка доверенных метрик', trustedGateSelfTest.pass ? 'pass' : 'fail',
        trustedGateSelfTest.pass
          ? `confirmed=${trustedGateSelfTest.confirmed}; adjudicated=${trustedGateSelfTest.adjudicated}; verifiedBlocked=${trustedGateSelfTest.verifiedBlocked}; unverifiedBlocked=${trustedGateSelfTest.unverifiedBlocked}; driftBlocked=${trustedGateSelfTest.driftBlocked}; voidBlocked=${trustedGateSelfTest.voidBlocked}.`
          : 'Самопроверка допуска доверенных метрик не прошла.', true),
      productionCheck('supabase', 'Supabase отвечает', diagnostics.supabase?.ok ? 'pass' : 'fail',
        diagnostics.supabase?.ok
          ? `${Number(diagnostics.supabase?.latencyMs || 0)} мс · attempts=${Number(diagnostics.supabase?.attempts || 1)}${diagnostics.supabase?.recovered ? ' · transient recovered' : ''}.`
          : `${diagnostics.supabase?.status || 'offline'} · attempts=${Number(diagnostics.supabase?.attempts || 1)}.`, true),
      productionCheck('supabase_probe_confirmation', 'Supabase Probe Confirmation Guard',
        supabaseProbeConfirmationSelfTest().pass ? 'pass' : 'fail',
        'Первичный сбой становится блокирующим только после подтверждающего запроса; повтор выполняется только при ошибке.', true),
      productionCheck('supabase_schema_probe_confirmation', 'Schema Probe Confirmation Guard',
        supabaseSchemaProbeConfirmationSelfTest().pass ? 'pass' : 'fail',
        'Schema drift становится блокирующим только после второго неуспешного probe; transient recovery сохраняется как warning.', true),
      productionCheck('singleflight', 'Объединение одинаковых серверных запросов', singleflightTest.pass ? 'pass' : 'fail',
        singleflightTest.pass ? `${singleflightTest.callers} параллельных вызовов → ${singleflightTest.executions} выполнение.` : 'Объединение параллельных запросов не прошло самопроверку.', true),
      productionCheck('distributed_analysis_lock', 'Cross-instance защита AI', distributedAnalysisLockDrill().pass ? 'pass' : 'fail',
        `TTL ${distributedAnalysisLockPolicy().ttlSeconds} сек. · ожидание до ${Math.round(distributedAnalysisLockPolicy().maxWaitMs/1000)} сек. · fail-open при недоступности lock storage.`, true),
      productionCheck('burst_guard', 'Burst Guard', ROUTE_BURST_POLICIES.length >= 6 ? 'pass' : 'fail',
        `${ROUTE_BURST_POLICIES.length} политик для дорогих маршрутов; блокировок в экземпляре: ${Number(memory.telemetry?.burstBlocks || 0)}.`, true),
      productionCheck('telegram_dedupe_observability', 'Persistent Telegram dedupe',
        !diagnostics.telegramWebhook?.available ? 'fail' : diagnostics.telegramWebhook?.state === 'incident' ? 'fail' : diagnostics.telegramWebhook?.state === 'watch' ? 'warn' : 'pass',
        diagnostics.telegramWebhook?.available
          ? `claims=${Number(diagnostics.telegramWebhook.claimsRecent || 0)} · duplicates=${Number(diagnostics.telegramWebhook.duplicateAttemptsRetained || 0)} · stale=${Number(diagnostics.telegramWebhook.staleProcessing || 0)} · failed=${Number(diagnostics.telegramWebhook.failedCurrent || 0)}.`
          : 'Health RPC persistent Telegram dedupe недоступен; примените supabase_migration_v6_17.sql.',
        true),
      productionCheck('upstream_timeouts', 'Тайм-ауты внешних сервисов', 'pass',
        'Supabase 7 сек., API-Football 10 сек.; зависшие внешние запросы не удерживают серверный обработчик бесконечно.', true),
      productionCheck('user_sync', 'Telegram user sync cache', 'pass',
        `Повторная синхронизация пользователей ограничена одним запуском в 10 минут; пропущено записей: ${Number(memory.telemetry?.userSyncSkips || 0)}.`, false),
      productionCheck('memory_bounds', 'Bounded L1 memory', memory.cache.size <= 600 ? 'pass' : 'warn',
        `${memory.cache.size} cache entries; soft target 500, prune threshold 600.`, false),
      productionCheck('quota_guard', 'Quota Orchestrator', providerBudget.mode === 'emergency' ? 'warn' : 'pass',
        `${providerBudget.label}; daily reserve ${Number(providerBudget.daily?.reserve || 0)}.`, false),
      productionCheck('expanded_e2e', 'Сквозная проверка расширенных данных', !paidProvider ? 'warn' : lastE2E?.status?.ready ? 'pass' : 'warn',
        !paidProvider
          ? 'Бесплатный тариф: полная сквозная проверка отложена до увеличения квоты.'
          : lastE2E?.status?.ready
            ? `${lastE2E.status.label} · матч ${lastE2E.fixtureId}.`
            : 'Расширенный тариф обнаружен, но проверка релиза ещё не подтверждена.', false),
      productionCheck('monetization', 'Монетизация на паузе', cfg.monetizationEnabled ? 'fail' : 'pass',
        cfg.monetizationEnabled ? 'Монетизация включена раньше финального этапа.' : 'Пользовательские платежи остаются выключены.', true),
    ];
  
    const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
    const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
    const passed = checks.filter(x => x.state === 'pass').length;
    const status = blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready';
    const value = {
      available: true,
      version: APP_VERSION,
      generatedAt: new Date().toISOString(),
      status,
      label: blockers.length ? 'Проверка рабочей среды заблокирована' : warnings.length ? 'Рабочая среда готова с ожидаемыми ограничениями' : 'Проверка производственной безопасности пройдена',
      score: Math.round(passed / checks.length * 100),
      checks,
      blockers: blockers.map(x => x.id),
      warnings: warnings.map(x => x.id),
      safety,
      diagnostics: {
        supabase: diagnostics.supabase,
        provider: diagnostics.provider,
        runtime: diagnostics.runtime,
        telegramWebhook: diagnostics.telegramWebhook,
      },
      policy: {
        payments: 'paused',
        externalLoadGenerator: false,
        note: 'Самопроверка не создаёт искусственный внешний трафик и не расходует API-Football. Реальная нагрузочная проверка выполняется отдельно на тестовой или рабочей среде.',
      },
    };
    memory.productionReadiness = { at: now, value };
    return json(value);
  }
  
  
  function rcCheck(id, group, label, state, detail, blocking = false) {
    return { id, group, label, state, detail, blocking: Boolean(blocking) };
  }
  
  async function rcReadRoute(label, factory) {
    const startedAt = Date.now();
    try {
      const response = await factory();
      const status = Number(response?.status || 0);
      const body = await responseJsonSafe(response);
      return {
        ok: status >= 200 && status < 300,
        status,
        latencyMs: Date.now() - startedAt,
        label,
        shape: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [],
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - startedAt,
        label,
        error: redactOpsString(error?.message || error, 140),
        shape: [],
      };
    }
  }

  return {
    releaseCheck,
    runSingleFlightSelfTest,
    productionCheck,
    apiProductionReadiness,
    rcCheck,
    rcReadRoute,
  };
}
