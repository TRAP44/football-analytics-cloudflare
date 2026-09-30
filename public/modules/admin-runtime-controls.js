// Admin-only runtime controls boundary.
// Loaded lazily after the server-authenticated admin role is confirmed.
export function createAdminRuntimeControlsModule(deps) {
  const {
    state, $, isAdmin, api, applyRuntimeUi, toast, renderAdminOverview,
    escapeHtml, dateTime, humanizeTechnicalText, relativeAge, SUPABASE_SCHEMA_HINT,
  } = deps;

  function runtimeControlsFormValue(id, fallback = true) {
    const el = $(id);
    return el ? Boolean(el.checked) : fallback;
  }
  
  
  function runtimeHistoryActionLabel(action) {
    return ({
      baseline: 'Базовое состояние',
      update: 'Изменение',
      defaults: 'Безопасные настройки',
      rollback: 'Откат',
    })[String(action || '')] || String(action || 'Изменение');
  }
  
  function runtimeHistorySummary(controls = {}) {
    const disabled = [];
    if (controls.maintenanceMode) disabled.push('обслуживание');
    if (controls.analysisEnabled === false) disabled.push('анализ');
    if (controls.searchEnabled === false) disabled.push('поиск');
    if (controls.liveEnabled === false) disabled.push('матч в реальном времени');
    if (controls.remindersEnabled === false) disabled.push('уведомления');
    if (controls.expandedDataEnabled === false) disabled.push('расширенные данные');
    const auto = controls.autoSettlementRecoveryEnabled ? ' · автовосстановление включено' : ' · автовосстановление: наблюдение';
    return disabled.length ? `Ограничения: ${disabled.join(', ')}${auto}` : `Основные функции включены${auto}`;
  }
  
  function renderRuntimeHistory() {
    if (!isAdmin()) return;
    const panel = state.runtimeControlsAdmin;
    const status = $('runtimeHistoryStatus');
    const list = $('runtimeHistoryList');
    if (!status || !list) return;
  
    if (!panel?.schemaReady) {
      status.textContent = 'Схема управления функциями недоступна.';
      list.innerHTML = '';
      return;
    }
  
    if (!panel.historyReady) {
      status.textContent = panel.historyReason || SUPABASE_SCHEMA_HINT;
      list.innerHTML = '<div class="data-notice stale">История и откат пока недоступны. Основное управление функциями продолжает работать.</div>';
      return;
    }
  
    const rows = Array.isArray(panel.history) ? panel.history : [];
    status.textContent = rows.length
      ? `Последние версии: ${rows.length}. Откат создаёт новую версию и не удаляет историю.`
      : 'История появится после первого изменения настроек функций.';
  
    if (!rows.length) {
      list.innerHTML = '<div class="empty compact-empty">Пока нет сохранённых точек восстановления.</div>';
      return;
    }
  
    const currentRevision = Number(panel.controls?.revision || 0);
    list.innerHTML = rows.map(row => {
      const isCurrent = Number(row.revision || 0) === currentRevision;
      return `<div class="runtime-history-row ${isCurrent ? 'current' : ''}">
        <div class="runtime-history-copy">
          <strong>версия ${Number(row.revision || 0)} · ${escapeHtml(runtimeHistoryActionLabel(row.action))}</strong>
          <span>${escapeHtml(runtimeHistorySummary(row.controls || {}))}</span>
          <small>${row.createdAt ? escapeHtml(dateTime(row.createdAt)) : '—'}${row.reason ? ` · ${escapeHtml(humanizeTechnicalText(row.reason))}` : ''}${row.sourceRevision ? ` · из версии ${Number(row.sourceRevision)}` : ''}</small>
        </div>
        ${isCurrent
          ? '<span class="runtime-history-current">АКТИВНО</span>'
          : `<button class="reminder-btn runtime-rollback-btn" type="button" data-history-id="${Number(row.id || 0)}" data-revision="${Number(row.revision || 0)}">Вернуть</button>`}
      </div>`;
    }).join('');
  
    list.querySelectorAll('.runtime-rollback-btn').forEach(button => {
      button.addEventListener('click', () => restoreRuntimeRevision(
        Number(button.dataset.historyId || 0),
        Number(button.dataset.revision || 0),
      ));
    });
  }
  
  async function restoreRuntimeRevision(historyId, sourceRevision) {
    if (!isAdmin() || state.runtimeControlsSaving) return;
    const current = state.runtimeControlsAdmin?.controls;
    if (!current || !historyId) return;
  
    const reasonInput = String($('runtimeChangeReason')?.value || '').trim();
    const reason = reasonInput || `Откат к версии ${Number(sourceRevision || 0)}`;
    if (!window.confirm(`Вернуть настройки функций к версии ${Number(sourceRevision || 0)}? Текущая версия ${Number(current.revision || 0)} останется в истории.`)) return;
  
    state.runtimeControlsSaving = true;
    renderRuntimeControls();
    try {
      const result = await api('/api/runtime-controls/rollback', {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: Number(current.revision || 0),
          historyId: Number(historyId),
          reason,
        }),
        retry: false,
        dedupe: false,
        timeoutMs: 12000,
      });
  
      state.runtimeControlsAdmin = {
        available: true,
        schemaReady: true,
        source: 'supabase',
        historyReady: Boolean(result.historyReady),
        historyReason: String(result.historyReason || ''),
        controls: result.controls,
        history: result.history || [],
      };
      state.runtimeStatus = result.controls;
      if ($('runtimeChangeReason')) $('runtimeChangeReason').value = '';
      applyRuntimeUi();
      toast(`Откат выполнен → версия ${Number(result.controls?.revision || 0)}`);
    } catch (e) {
      toast(e.message);
      state.runtimeControlsAdmin = null;
      await loadRuntimeControlsAdmin(true);
    } finally {
      state.runtimeControlsSaving = false;
      renderRuntimeControls();
    }
  }
  
  function renderRuntimeControls() {
    if (!isAdmin()) return;
    const badge = $('runtimeControlsBadge');
    const status = $('runtimeControlsStatus');
    const revision = $('runtimeControlsRevision');
    const saveBtn = $('runtimeSaveBtn');
    const defaultsBtn = $('runtimeDefaultsBtn');
    const refreshBtn = $('runtimeControlsRefreshBtn');
    const panel = state.runtimeControlsAdmin;
    if (!badge || !status || !revision || !saveBtn || !defaultsBtn || !refreshBtn) return;
  
    const busy = Boolean(state.runtimeControlsLoading || state.runtimeControlsSaving);
    saveBtn.disabled = busy;
    defaultsBtn.disabled = busy;
    refreshBtn.disabled = busy;
  
    if (busy) {
      badge.className = 'runtime-controls-badge running';
      badge.textContent = state.runtimeControlsSaving ? 'СОХР.' : 'ЗАГР.';
      status.textContent = state.runtimeControlsSaving ? 'Применяю настройки функций…' : 'Загружаю настройки функций…';
      return;
    }
  
    if (!panel) {
      badge.className = 'runtime-controls-badge';
      badge.textContent = 'ОЖИДАНИЕ';
      status.textContent = 'Настройки функций ещё не загружены.';
      return;
    }
  
    if (!panel.available || !panel.schemaReady) {
      badge.className = 'runtime-controls-badge blocked';
      badge.textContent = 'БД';
      status.textContent = panel.reason || SUPABASE_SCHEMA_HINT;
      revision.textContent = 'схема БД не готова';
      renderAdminOverview();
      return;
    }
  
    const c = panel.controls || {};
    badge.className = `runtime-controls-badge ${c.maintenanceMode ? 'maintenance' : 'healthy'}`;
    badge.textContent = c.maintenanceMode ? 'ОБСЛУЖ.' : 'АКТИВНО';
    status.textContent = c.maintenanceMode
      ? 'Режим технического обслуживания включён для обычных пользователей.'
      : 'Настройки функций активны. Изменения применяются без нового развёртывания.';
    revision.textContent = `версия ${Number(c.revision || 1)}${c.updatedAt ? ` · ${relativeAge(c.updatedAt)}` : ''}`;
  
    const map = [
      ['runtimeMaintenanceToggle', 'maintenanceMode'],
      ['runtimeAnalysisToggle', 'analysisEnabled'],
      ['runtimeSearchToggle', 'searchEnabled'],
      ['runtimeLiveToggle', 'liveEnabled'],
      ['runtimeRemindersToggle', 'remindersEnabled'],
      ['runtimeExpandedToggle', 'expandedDataEnabled'],
      ['runtimeAutoSettlementRecoveryToggle', 'autoSettlementRecoveryEnabled'],
    ];
    for (const [id, key] of map) if ($(id)) $(id).checked = Boolean(c[key]);
    if ($('runtimeMessage')) $('runtimeMessage').value = c.message || '';
    renderRuntimeHistory();
    renderAdminOverview();
  }
  
  async function loadRuntimeControlsAdmin(force = false) {
    if (!isAdmin() || state.runtimeControlsLoading) return;
    if (!force && state.runtimeControlsAdmin) { renderRuntimeControls(); return; }
    state.runtimeControlsLoading = true;
    renderRuntimeControls();
    try {
      state.runtimeControlsAdmin = await api(`/api/runtime-controls${force ? '?refresh=1' : ''}`, {
        retry: false,
        dedupe: !force,
        timeoutMs: 12000,
      });
      if (state.runtimeControlsAdmin?.controls) {
        state.runtimeStatus = state.runtimeControlsAdmin.controls;
        applyRuntimeUi();
      }
    } catch (e) {
      state.runtimeControlsAdmin = { available: false, schemaReady: false, reason: e.message };
    } finally {
      state.runtimeControlsLoading = false;
      renderRuntimeControls();
    }
  }
  
  function runtimeControlsPayload() {
    return {
      expectedRevision: Number(state.runtimeControlsAdmin?.controls?.revision || 0),
      maintenanceMode: runtimeControlsFormValue('runtimeMaintenanceToggle', false),
      analysisEnabled: runtimeControlsFormValue('runtimeAnalysisToggle', true),
      searchEnabled: runtimeControlsFormValue('runtimeSearchToggle', true),
      liveEnabled: runtimeControlsFormValue('runtimeLiveToggle', true),
      remindersEnabled: runtimeControlsFormValue('runtimeRemindersToggle', true),
      expandedDataEnabled: runtimeControlsFormValue('runtimeExpandedToggle', true),
      autoSettlementRecoveryEnabled: runtimeControlsFormValue('runtimeAutoSettlementRecoveryToggle', false),
      message: String($('runtimeMessage')?.value || '').trim().slice(0, 280),
      reason: String($('runtimeChangeReason')?.value || '').trim().slice(0, 240),
      action: 'update',
    };
  }
  
  async function saveRuntimeControls(payload = null, options = {}) {
    if (!isAdmin() || state.runtimeControlsSaving) return;
    const body = payload || runtimeControlsPayload();
    if (!Number(body.expectedRevision || 0)) {
      toast('Сначала обновите настройки функций.');
      return;
    }
  
    const disabling = body.maintenanceMode || !body.analysisEnabled || !body.searchEnabled || !body.liveEnabled || !body.remindersEnabled || !body.expandedDataEnabled;
    const enablingAutoRecovery = Boolean(body.autoSettlementRecoveryEnabled) && !Boolean(state.runtimeControlsAdmin?.controls?.autoSettlementRecoveryEnabled);
    if (!options.skipConfirm) {
      const message = enablingAutoRecovery
        ? 'Включить автоматическое восстановление результатов? Система сможет один раз в сутки сделать до 5 запросов к источнику данных и изменить только зависшие ожидающие записи с подтверждённым финальным счётом.'
        : disabling
          ? 'Применить ограничения сейчас? Они затронут обычных пользователей без нового развёртывания.'
          : 'Применить настройки функций?';
      if (!window.confirm(message)) return;
    }
  
    state.runtimeControlsSaving = true;
    renderRuntimeControls();
    try {
      const result = await api('/api/runtime-controls', {
        method: 'PATCH',
        body: JSON.stringify(body),
        retry: false,
        dedupe: false,
        timeoutMs: 12000,
      });
      state.runtimeControlsAdmin = {
        available: true,
        schemaReady: true,
        source: 'supabase',
        historyReady: Boolean(result.historyReady),
        historyReason: String(result.historyReason || ''),
        controls: result.controls,
        history: result.history || [],
      };
      state.runtimeStatus = result.controls;
      if ($('runtimeChangeReason')) $('runtimeChangeReason').value = '';
      applyRuntimeUi();
      toast('Настройки функций применены');
    } catch (e) {
      toast(e.message);
      state.runtimeControlsAdmin = null;
      await loadRuntimeControlsAdmin(true);
    } finally {
      state.runtimeControlsSaving = false;
      renderRuntimeControls();
    }
  }
  
  async function restoreRuntimeDefaults() {
    const current = state.runtimeControlsAdmin?.controls;
    if (!current) { await loadRuntimeControlsAdmin(true); return; }
    if (!window.confirm('Вернуть безопасные настройки: основные функции включены, техническое обслуживание выключено, автоматическое восстановление остаётся в режиме наблюдения?')) return;
    await saveRuntimeControls({
      expectedRevision: Number(current.revision || 0),
      maintenanceMode: false,
      analysisEnabled: true,
      searchEnabled: true,
      liveEnabled: true,
      remindersEnabled: true,
      expandedDataEnabled: true,
      autoSettlementRecoveryEnabled: false,
      message: '',
      reason: 'Администратор восстановил безопасные настройки.',
      action: 'defaults',
    }, { skipConfirm: true });
  }

  return Object.freeze({
    renderRuntimeControls,
    loadRuntimeControlsAdmin,
    saveRuntimeControls,
    restoreRuntimeDefaults,
  });
}
