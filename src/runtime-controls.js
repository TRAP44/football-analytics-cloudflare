import {
  failClosedRuntimeControls,
  isSecurityLockdownControls,
  runtimeLockdownDecision,
} from './runtime-lockdown.js';

// Bounded runtime-controls domain extracted from worker.js.
// DB/network/clock/response dependencies are injected by the composition root.
export function createRuntimeControlsRuntime({
  memory,
  DEFAULT_RUNTIME_CONTROLS,
  RUNTIME_CONTROLS_CACHE_MS,
  SUPABASE_SCHEMA_GUIDANCE,
  APP_VERSION,
  hasSupabase,
  supaSelectOne,
  supaInsertIgnore,
  supaSelectMany,
  fetchWithTimeout,
  supaHeaders,
  recordOpsEvent,
  redactOpsString,
  json,
  isAdminUser,
  clock = () => Date.now(),
}) {
  function runtimeControlsSnapshot() {
    return memory.runtimeControls?.value || { ...DEFAULT_RUNTIME_CONTROLS };
  }
  
  function normalizeRuntimeControls(row = {}) {
    return {
      maintenanceMode: Boolean(row.maintenance_mode ?? row.maintenanceMode ?? DEFAULT_RUNTIME_CONTROLS.maintenanceMode),
      analysisEnabled: (row.analysis_enabled ?? row.analysisEnabled) !== false,
      searchEnabled: (row.search_enabled ?? row.searchEnabled) !== false,
      liveEnabled: (row.live_enabled ?? row.liveEnabled) !== false,
      remindersEnabled: (row.reminders_enabled ?? row.remindersEnabled) !== false,
      expandedDataEnabled: (row.expanded_data_enabled ?? row.expandedDataEnabled) !== false,
      autoSettlementRecoveryEnabled: Boolean(row.auto_settlement_recovery_enabled ?? row.autoSettlementRecoveryEnabled ?? DEFAULT_RUNTIME_CONTROLS.autoSettlementRecoveryEnabled),
      message: String(row.message || '').slice(0, 280),
      revision: Math.max(1, Number(row.revision || 1)),
      updatedAt: row.updated_at || row.updatedAt || null,
    };
  }
  
  function publicRuntimeControls(value = runtimeControlsSnapshot()) {
    return {
      maintenanceMode: Boolean(value.maintenanceMode),
      analysisEnabled: value.analysisEnabled !== false,
      searchEnabled: value.searchEnabled !== false,
      liveEnabled: value.liveEnabled !== false,
      remindersEnabled: value.remindersEnabled !== false,
      expandedDataEnabled: value.expandedDataEnabled !== false,
      autoSettlementRecoveryEnabled: Boolean(value.autoSettlementRecoveryEnabled),
      securityLockdown: isSecurityLockdownControls(value),
      controlPlaneFailClosed: Boolean(value.controlPlaneFailClosed),
      message: String(value.message || '').slice(0, 280),
      revision: Number(value.revision || 1),
      updatedAt: value.updatedAt || null,
    };
  }
  
  async function loadRuntimeControls(cfg, options = {}) {
    const force = Boolean(options.force);
    const now = clock();
    if (!force && memory.runtimeControls?.value && now - Number(memory.runtimeControls.loadedAt || 0) < RUNTIME_CONTROLS_CACHE_MS) {
      return { ...memory.runtimeControls, cached: true };
    }
  
    const activateFailClosed = (reason, error = null) => {
      const previous = memory.runtimeControls?.value;
      const value = failClosedRuntimeControls(previous, reason);
      memory.runtimeControls = {
        value,
        loadedAt: now,
        source: 'fail_closed',
        schemaReady: false,
        failClosed: true,
        ...(error ? { error: redactOpsString(error?.message || error, 160) } : {}),
      };
      return { ...memory.runtimeControls, cached: false };
    };
  
    if (!hasSupabase(cfg)) {
      return activateFailClosed('supabase_not_configured');
    }
  
    try {
      const row = await supaSelectOne(cfg, 'runtime_controls', { id: 'eq.global' });
      if (!row) return activateFailClosed('runtime_controls_missing');
      const value = normalizeRuntimeControls(row);
      memory.runtimeControls = { value, loadedAt: now, source: 'supabase', schemaReady: true, failClosed: false };
      return { ...memory.runtimeControls, cached: false };
    } catch (error) {
      return activateFailClosed('runtime_controls_unavailable', error);
    }
  }
  
  
  function runtimeHistorySnapshot(value) {
    const c = publicRuntimeControls(value);
    return {
      maintenanceMode: c.maintenanceMode,
      analysisEnabled: c.analysisEnabled,
      searchEnabled: c.searchEnabled,
      liveEnabled: c.liveEnabled,
      remindersEnabled: c.remindersEnabled,
      expandedDataEnabled: c.expandedDataEnabled,
      autoSettlementRecoveryEnabled: c.autoSettlementRecoveryEnabled,
      securityLockdown: Boolean(c.securityLockdown),
      message: c.message,
      revision: c.revision,
      updatedAt: c.updatedAt,
    };
  }
  
  async function probeRuntimeHistorySchema(cfg) {
    if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
    try {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_control_history`);
      url.searchParams.set('select', 'id,revision,action,reason,snapshot,app_version,source_revision,created_at');
      url.searchParams.set('limit', '1');
      const r = await fetchWithTimeout(url, { headers: supaHeaders(cfg) }, 7000, 'Supabase runtime history schema');
      return { ok: r.ok, status: r.ok ? 'ok' : `http_${r.status}` };
    } catch (error) {
      return { ok: false, status: error?.code || 'error' };
    }
  }
  
  async function ensureRuntimeHistoryBaseline(cfg, value, user) {
    const snapshot = runtimeHistorySnapshot(value);
    await supaInsertIgnore(cfg, 'runtime_control_history', {
      revision: Number(snapshot.revision || 1),
      action: 'baseline',
      reason: 'Базовое состояние сохранено перед первым изменением настроек функций.',
      snapshot,
      app_version: APP_VERSION,
      changed_by: Number(user?.id || 0) || null,
      source_revision: null,
      created_at: snapshot.updatedAt || new Date(clock()).toISOString(),
    }, 'revision');
  }
  
  async function appendRuntimeHistory(cfg, value, user, meta = {}) {
    const snapshot = runtimeHistorySnapshot(value);
    await supaInsertIgnore(cfg, 'runtime_control_history', {
      revision: Number(snapshot.revision || 1),
      action: String(meta.action || 'update').slice(0, 40),
      reason: String(meta.reason || '').trim().slice(0, 240),
      snapshot,
      app_version: APP_VERSION,
      changed_by: Number(user?.id || 0) || null,
      source_revision: Number(meta.sourceRevision || 0) || null,
      created_at: new Date(clock()).toISOString(),
    }, 'revision');
  }
  
  async function listRuntimeHistory(cfg, limit = 12) {
    const rows = await supaSelectMany(cfg, 'runtime_control_history', {}, {
      limit: Math.max(1, Math.min(30, Number(limit || 12))),
      order: 'revision.desc',
    });
  
    return (rows || []).map(row => {
      const snapshot = normalizeRuntimeControls(row.snapshot || {});
      return {
        id: Number(row.id || 0),
        revision: Number(row.revision || snapshot.revision || 0),
        action: String(row.action || 'update'),
        reason: String(row.reason || '').slice(0, 240),
        appVersion: String(row.app_version || ''),
        sourceRevision: Number(row.source_revision || 0) || null,
        createdAt: row.created_at || null,
        controls: publicRuntimeControls(snapshot),
      };
    });
  }
  
  async function rollbackRuntimeControls(cfg, user, body = {}) {
    const historySchema = await probeRuntimeHistorySchema(cfg);
    if (!historySchema.ok) {
      const historyReason = 'Журнал изменений недоступен. Откат не выполнен, чтобы не создавать неаудируемую версию.';
      void recordOpsEvent(cfg, {
        severity: 'error',
        source: 'release',
        eventType: 'runtime_history',
        code: 'RUNTIME_HISTORY_REQUIRED',
        message: historyReason,
        endpoint: '/api/runtime-controls/rollback',
        meta: { schemaStatus: String(historySchema.status || 'unknown') },
      }).catch(() => {});
      return {
        error: historyReason,
        code: 'RUNTIME_HISTORY_REQUIRED',
        status: 503,
        historyReady: false,
        historyReason,
      };
    }
  
    const expectedRevision = Number(body.expectedRevision || 0);
    const historyId = Number(body.historyId || 0);
    if (!expectedRevision || !historyId) {
      return { error: 'Не хватает номера текущей версии или идентификатора точки восстановления для отката.', code: 'RUNTIME_ROLLBACK_INPUT', status: 400 };
    }
  
    const row = await supaSelectOne(cfg, 'runtime_control_history', { id: `eq.${historyId}` });
    if (!row?.snapshot) {
      return { error: 'Точка восстановления настроек функций не найдена.', code: 'RUNTIME_ROLLBACK_NOT_FOUND', status: 404 };
    }
  
    const target = normalizeRuntimeControls(row.snapshot);
    if (Number(target.revision || 0) === expectedRevision) {
      return { error: 'Выбрана уже активная версия.', code: 'RUNTIME_ROLLBACK_SAME_REVISION', status: 409 };
    }
  
    return await saveRuntimeControls(cfg, user, {
      expectedRevision,
      maintenanceMode: target.maintenanceMode,
      analysisEnabled: target.analysisEnabled,
      searchEnabled: target.searchEnabled,
      liveEnabled: target.liveEnabled,
      remindersEnabled: target.remindersEnabled,
      expandedDataEnabled: target.expandedDataEnabled,
      autoSettlementRecoveryEnabled: target.autoSettlementRecoveryEnabled,
      message: target.message,
      reason: String(body.reason || `Rollback to revision ${Number(row.revision || target.revision || 0)}`).slice(0, 240),
      action: 'rollback',
      sourceRevision: Number(row.revision || target.revision || 0),
    });
  }

  async function saveRuntimeControls(cfg, user, body = {}) {
    const currentState = await loadRuntimeControls(cfg, { force: true });
    if (!currentState.schemaReady) {
      return {
        error: SUPABASE_SCHEMA_GUIDANCE,
        code: 'RUNTIME_CONTROLS_SCHEMA',
        status: 503,
        current: publicRuntimeControls(currentState.value),
      };
    }

    const current = currentState.value;
    const expectedRevision = Number(body.expectedRevision || 0);
    if (!expectedRevision || expectedRevision !== Number(current.revision || 1)) {
      return {
        error: 'Настройки уже изменились в другой сессии. Обновите панель и повторите.',
        code: 'RUNTIME_CONTROLS_CONFLICT',
        status: 409,
        current: publicRuntimeControls(current),
      };
    }

    const historySchema = await probeRuntimeHistorySchema(cfg);
    if (!historySchema.ok) {
      const historyReason = 'Журнал изменений недоступен. Настройки не применены, чтобы не создавать неаудируемую версию.';
      void recordOpsEvent(cfg, {
        severity: 'error',
        source: 'release',
        eventType: 'runtime_history',
        code: 'RUNTIME_HISTORY_REQUIRED',
        message: historyReason,
        endpoint: '/api/runtime-controls',
        meta: { revision: Number(current.revision || 0), schemaStatus: String(historySchema.status || 'unknown') },
      }).catch(() => {});
      return {
        error: historyReason,
        code: 'RUNTIME_HISTORY_REQUIRED',
        status: 503,
        current: publicRuntimeControls(current),
        historyReady: false,
        historyReason,
      };
    }

    try {
      await ensureRuntimeHistoryBaseline(cfg, current, user);
    } catch (error) {
      const historyReason = 'Журнал изменений недоступен: базовая точка не сохранена. Настройки не применены.';
      void recordOpsEvent(cfg, {
        severity: 'error',
        source: 'release',
        eventType: 'runtime_history',
        code: 'RUNTIME_HISTORY_BASELINE_WRITE_FAILED',
        message: error?.message || error,
        endpoint: '/api/runtime-controls',
        meta: { revision: Number(current.revision || 0) },
      }).catch(() => {});
      return {
        error: historyReason,
        code: 'RUNTIME_HISTORY_BASELINE_WRITE_FAILED',
        status: 503,
        current: publicRuntimeControls(current),
        historyReady: false,
        historyReason,
      };
    }

    const historyReady = true;
    const historyReason = '';
    const requestedAction = String(body.action || 'update').trim();
    const changeAction = ['update', 'defaults', 'rollback', 'lockdown', 'lockdown_release'].includes(requestedAction) ? requestedAction : 'update';
    const sourceRevision = Number(body.sourceRevision || 0) || null;
    const wasSecurityLockdown = isSecurityLockdownControls(current);
    const lockdownRequested = changeAction === 'lockdown';
    const lockdownReleaseRequested = changeAction === 'lockdown_release';
    const proposed = {
      maintenanceMode: lockdownRequested ? true : lockdownReleaseRequested ? false : Boolean(body.maintenanceMode),
      analysisEnabled: lockdownRequested ? false : lockdownReleaseRequested ? true : body.analysisEnabled !== false,
      searchEnabled: lockdownRequested ? false : lockdownReleaseRequested ? true : body.searchEnabled !== false,
      liveEnabled: lockdownRequested ? false : lockdownReleaseRequested ? true : body.liveEnabled !== false,
      remindersEnabled: lockdownRequested ? false : lockdownReleaseRequested ? true : body.remindersEnabled !== false,
      expandedDataEnabled: lockdownRequested ? false : lockdownReleaseRequested ? true : body.expandedDataEnabled !== false,
      autoSettlementRecoveryEnabled: lockdownRequested || lockdownReleaseRequested ? false : Boolean(body.autoSettlementRecoveryEnabled),
    };
  
    if (wasSecurityLockdown && changeAction === 'update' && !isSecurityLockdownControls(proposed)) {
      return {
        error: 'Аварийный Security Lockdown можно снять только явным восстановлением, откатом или безопасными настройками.',
        code: 'SECURITY_LOCKDOWN_EXPLICIT_RELEASE_REQUIRED',
        status: 409,
        current: publicRuntimeControls(current),
      };
    }
  
    const changeReason = String(
      body.reason
        || (lockdownRequested ? 'Аварийный Security Lockdown включён администратором.'
          : lockdownReleaseRequested ? 'Аварийный Security Lockdown снят администратором.'
            : '')
    ).trim().slice(0, 240);
  
    const next = {
      maintenance_mode: proposed.maintenanceMode,
      analysis_enabled: proposed.analysisEnabled,
      search_enabled: proposed.searchEnabled,
      live_enabled: proposed.liveEnabled,
      reminders_enabled: proposed.remindersEnabled,
      expanded_data_enabled: proposed.expandedDataEnabled,
      auto_settlement_recovery_enabled: proposed.autoSettlementRecoveryEnabled,
      message: lockdownRequested
        ? String(body.message || 'Аварийный режим безопасности активен. Изменения временно недоступны.').trim().slice(0, 280)
        : lockdownReleaseRequested ? '' : String(body.message || '').trim().slice(0, 280),
      revision: expectedRevision + 1,
      updated_at: new Date(clock()).toISOString(),
      updated_by: Number(user?.id || 0) || null,
    };
  
    const reasonHex = Array.from(
      new TextEncoder().encode(changeReason),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('');
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/runtime_controls`);
    url.searchParams.set('id', 'eq.global');
    url.searchParams.set('revision', `eq.${expectedRevision}`);
    const response = await fetchWithTimeout(url, {
      method: 'PATCH',
      headers: supaHeaders(cfg, {
        Prefer: 'return=representation',
        'X-Runtime-Action': changeAction,
        'X-Runtime-Reason-Hex': reasonHex,
        'X-Runtime-App-Version': String(APP_VERSION || '').slice(0, 120),
        ...(sourceRevision ? { 'X-Runtime-Source-Revision': String(sourceRevision) } : {}),
      }),
      body: JSON.stringify(next),
    }, 7000, 'Supabase atomic runtime controls');

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      const failureReason = 'Настройки не применены: состояние и журнал не удалось сохранить одной транзакцией.';
      void recordOpsEvent(cfg, {
        severity: 'error',
        source: 'release',
        eventType: 'runtime_history',
        code: 'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED',
        message: redactOpsString(responseText || `HTTP ${response.status}`, 160),
        endpoint: '/api/runtime-controls',
        status: response.status,
        meta: { revision: expectedRevision, action: changeAction, sourceRevision },
      }).catch(() => {});
      return {
        error: failureReason,
        code: 'RUNTIME_CONTROLS_ATOMIC_COMMIT_FAILED',
        status: 503,
        current: publicRuntimeControls(current),
        historyReady: false,
        historyReason: failureReason,
      };
    }

    const rows = await response.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length !== 1) {
      return {
        error: 'Настройки изменились до сохранения. Обновите панель и повторите.',
        code: 'RUNTIME_CONTROLS_CONFLICT',
        status: 409,
        current: publicRuntimeControls((await loadRuntimeControls(cfg, { force: true })).value),
      };
    }

    const value = normalizeRuntimeControls(rows[0]);
    if (Number(value.revision || 0) !== expectedRevision + 1) {
      const failureReason = 'Настройки не применены: база данных вернула некорректную версию состояния.';
      return {
        error: failureReason,
        code: 'RUNTIME_CONTROLS_ATOMIC_COMMIT_INVALID',
        status: 503,
        current: publicRuntimeControls(current),
        historyReady: false,
        historyReason: failureReason,
      };
    }
    memory.runtimeControls = { value, loadedAt: clock(), source: 'supabase', schemaReady: true };

    const securityLockdown = isSecurityLockdownControls(value);
    const lockdownTransition = !wasSecurityLockdown && securityLockdown
      ? 'enabled'
      : wasSecurityLockdown && !securityLockdown ? 'released' : '';
  
    await recordOpsEvent(cfg, {
      severity: securityLockdown ? 'critical' : value.maintenanceMode ? 'warning' : 'info',
      source: 'release',
      eventType: lockdownTransition ? 'security_lockdown' : 'runtime_controls',
      code: lockdownTransition === 'enabled'
        ? 'SECURITY_LOCKDOWN_ENABLED'
        : lockdownTransition === 'released'
          ? 'SECURITY_LOCKDOWN_RELEASED'
          : value.maintenanceMode ? 'MAINTENANCE_ENABLED' : 'RUNTIME_CONTROLS_UPDATED',
      message: lockdownTransition === 'enabled'
        ? `Аварийный Security Lockdown включён на версии ${value.revision}.`
        : lockdownTransition === 'released'
          ? `Аварийный Security Lockdown снят на версии ${value.revision}.`
          : `Настройки функций обновлены до версии ${value.revision}.`,
      endpoint: '/api/runtime-controls',
      meta: {
        revision: value.revision,
        maintenanceMode: value.maintenanceMode,
        analysisEnabled: value.analysisEnabled,
        searchEnabled: value.searchEnabled,
        liveEnabled: value.liveEnabled,
        remindersEnabled: value.remindersEnabled,
        expandedDataEnabled: value.expandedDataEnabled,
        autoSettlementRecoveryEnabled: value.autoSettlementRecoveryEnabled,
        securityLockdown,
        action: changeAction,
        reason: changeReason,
        sourceRevision,
        historyReady,
      },
    }).catch(() => {});
    return { value, status: 200, historyReady, historyReason };
  }
  
  function runtimeFeatureResponse(code, message, runtime, status = 503) {
    const category = String(code || '').startsWith('SECURITY_LOCKDOWN_')
      ? 'security_lockdown'
      : code === 'MAINTENANCE_MODE' ? 'maintenance' : 'feature_disabled';
    return json({
      error: message,
      code,
      category,
      recoverable: true,
      runtime: publicRuntimeControls(runtime),
    }, status);
  }
  
  function runtimeGuard(request, user, cfg, runtime) {
    const admin = isAdminUser(user, cfg);
    const lockdown = runtimeLockdownDecision(request, { runtime, isAdmin: admin });
    if (lockdown.blocked) {
      const url = new URL(request.url);
      const minuteBucket = new Date(clock()).toISOString().slice(0, 16);
      void recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'release',
        eventType: 'security_lockdown_block',
        code: lockdown.code,
        message: 'Запрос остановлен активным аварийным режимом безопасности.',
        endpoint: url.pathname,
        status: lockdown.status,
        transitionKey: `security-lockdown:${lockdown.code}:${url.pathname}:${minuteBucket}`,
        meta: {
          method: String(request.method || 'GET').toUpperCase(),
          admin,
          providerFanout: Boolean(lockdown.providerFanout),
          controlPlaneFailClosed: Boolean(lockdown.controlPlaneFailClosed),
          minuteBucket,
        },
      }).catch(() => {});
      return runtimeFeatureResponse(lockdown.code, lockdown.message, runtime, lockdown.status);
    }
  
    if (admin) return null;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
  
    const footballRoutes = new Set([
      '/api/matches', '/api/search', '/api/tournament', '/api/team', '/api/team/intelligence',
      '/api/team/squad', '/api/match-center', '/api/analyze'
    ]);
  
    if (runtime.maintenanceMode && footballRoutes.has(path)) {
      return runtimeFeatureResponse(
        'MAINTENANCE_MODE',
        runtime.message || 'Приложение временно находится на техническом обслуживании. Попробуйте позже.',
        runtime,
        503,
      );
    }
    if (path === '/api/analyze' && method === 'POST' && runtime.analysisEnabled === false) {
      return runtimeFeatureResponse('ANALYSIS_DISABLED', 'Полный анализ временно приостановлен администратором.', runtime, 503);
    }
    if (path === '/api/search' && runtime.searchEnabled === false) {
      return runtimeFeatureResponse('SEARCH_DISABLED', 'Удалённый поиск временно приостановлен. Локальный каталог остаётся доступен.', runtime, 503);
    }
    if (path === '/api/reminders' && method === 'POST' && runtime.remindersEnabled === false) {
      return runtimeFeatureResponse('REMINDERS_DISABLED', 'Новые уведомления временно приостановлены. Уже созданные можно удалить.', runtime, 503);
    }
    return null;
  }
  
  async function apiRuntimeControls(request, cfg, user) {
    if (request.method === 'GET') {
      const state = await loadRuntimeControls(cfg, { force: new URL(request.url).searchParams.get('refresh') === '1' });
      const historySchema = await probeRuntimeHistorySchema(cfg);
      let history = [];
      let historyReady = Boolean(historySchema.ok);
      let historyReason = historySchema.ok ? '' : SUPABASE_SCHEMA_GUIDANCE;
      if (historySchema.ok) {
        try {
          history = await listRuntimeHistory(cfg, 12);
        } catch (error) {
          historyReady = false;
          historyReason = 'История изменений временно недоступна. Обновите панель позже.';
          void recordOpsEvent(cfg, {
            severity: 'warning',
            source: 'release',
            eventType: 'runtime_history',
            code: 'RUNTIME_HISTORY_READ_FAILED',
            message: error?.message || error,
            endpoint: '/api/runtime-controls',
          }).catch(() => {});
        }
      }
      return json({
        available: Boolean(state.schemaReady),
        source: state.source,
        schemaReady: Boolean(state.schemaReady),
        historyReady,
        controls: publicRuntimeControls(state.value),
        history,
        cacheSeconds: Math.round(RUNTIME_CONTROLS_CACHE_MS / 1000),
        reason: state.schemaReady ? '' : SUPABASE_SCHEMA_GUIDANCE,
        historyReason,
      });
    }
  
    if (request.method === 'PATCH' || request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch {}
      const result = await saveRuntimeControls(cfg, user, body);
      if (result.error) return json({ error: result.error, code: result.code, current: result.current }, result.status || 400);
  
      let history = [];
      let historyReady = Boolean(result.historyReady);
      let historyReason = String(result.historyReason || '');
      if (historyReady) {
        try {
          history = await listRuntimeHistory(cfg, 12);
        } catch (error) {
          historyReady = false;
          historyReason = 'Настройки применены, но журнал изменений временно не удалось перечитать.';
          void recordOpsEvent(cfg, {
            severity: 'warning',
            source: 'release',
            eventType: 'runtime_history',
            code: 'RUNTIME_HISTORY_POST_WRITE_READ_FAILED',
            message: error?.message || error,
            endpoint: '/api/runtime-controls',
            meta: { revision: Number(result.value?.revision || 0) },
          }).catch(() => {});
        }
      }
      return json({
        ok: true,
        controls: publicRuntimeControls(result.value),
        historyReady,
        historyReason,
        history,
      });
    }
  
    return json({ error: 'Метод не поддерживается.' }, 405);
  }
  
  async function apiRuntimeRollback(request, cfg, user) {
    if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
  
    let body = {};
    try { body = await request.json(); } catch {}
    const result = await rollbackRuntimeControls(cfg, user, body);
    if (result.error) {
      return json({
        error: result.error,
        code: result.code,
        current: result.current,
      }, result.status || 400);
    }
  
    let history = [];
    let historyReady = Boolean(result.historyReady);
    let historyReason = String(result.historyReason || '');
    if (historyReady) {
      try {
        history = await listRuntimeHistory(cfg, 12);
      } catch (error) {
        historyReady = false;
        historyReason = 'Откат выполнен, но журнал изменений временно не удалось перечитать.';
        void recordOpsEvent(cfg, {
          severity: 'warning',
          source: 'release',
          eventType: 'runtime_history',
          code: 'RUNTIME_HISTORY_ROLLBACK_READ_FAILED',
          message: error?.message || error,
          endpoint: '/api/runtime-controls/rollback',
          meta: { revision: Number(result.value?.revision || 0) },
        }).catch(() => {});
      }
    }
    return json({
      ok: true,
      controls: publicRuntimeControls(result.value),
      historyReady,
      historyReason,
      history,
    });
  }

  return {
    runtimeControlsSnapshot,
    normalizeRuntimeControls,
    publicRuntimeControls,
    loadRuntimeControls,
    runtimeHistorySnapshot,
    probeRuntimeHistorySchema,
    ensureRuntimeHistoryBaseline,
    appendRuntimeHistory,
    listRuntimeHistory,
    rollbackRuntimeControls,
    saveRuntimeControls,
    runtimeFeatureResponse,
    runtimeGuard,
    apiRuntimeControls,
    apiRuntimeRollback,
  };
}
