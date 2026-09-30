export function createAdminModelRemediationModule({
  state,
  elementById,
  isAdmin,
  SUPABASE_SCHEMA_HINT,
  escapeHtml,
  dateTime,
  outcomeShortLabel,
  humanizeTechnicalText,
  api,
  toast,
  confirmAction,
  loadModelQuality,
}) {
  if (!state || typeof elementById !== 'function' || typeof isAdmin !== 'function') {
    throw new TypeError('Admin Model Remediation requires state, elementById and isAdmin.');
  }

  const $ = elementById;
  const confirm = typeof confirmAction === 'function' ? confirmAction : () => false;
  const refreshModelQuality = typeof loadModelQuality === 'function' ? loadModelQuality : async () => {};

  function remediationActionLabel(action) {
    if (action?.status === 'started') return 'Запущено';
    if (action?.status === 'completed') return 'Выполнено';
    if (action?.status === 'partial') return 'Частично';
    if (action?.status === 'failed') return 'Ошибка';
    if (action?.status === 'interrupted') return 'Прервано';
    return 'Нет статуса';
  }
  
  function remediationActionCodeLabel(value) {
    return ({
      keep_stored: 'оставить сохранённое',
      accept_provider: 'принять данные источника',
      void_prediction: 'исключить из метрик',
      recover: 'восстановить',
      auto_recover: 'автовосстановление',
      circuit_reset: 'сброс защиты',
    })[String(value || '')] || humanizeTechnicalText(value || '—');
  }
  
  function renderModelRemediation() {
    const root = $('modelRemediation');
    const status = $('modelRemediationStatus');
    const summary = $('modelRemediationSummary');
    const candidates = $('modelRemediationCandidates');
    const history = $('modelRemediationHistory');
    const driftQueue = $('modelRemediationDriftQueue');
    const dryBtn = $('modelRemediationDryRunBtn');
    const runBtn = $('modelRemediationRunBtn');
    if (!root || !status || !summary || !candidates || !history || !driftQueue || !dryBtn || !runBtn) return;
    root.hidden = false;
    dryBtn.disabled = Boolean(state.modelRemediationLoading || state.modelRemediationRunning);
    runBtn.disabled = true;
  
    if (state.modelRemediationLoading) {
      status.textContent = 'Сканирую историю прогнозов без внешних запросов…';
      summary.innerHTML = '';
      candidates.innerHTML = '';
      history.innerHTML = '';
      driftQueue.innerHTML = '';
      return;
    }
    const r = state.modelRemediation;
    if (!r) {
      status.textContent = 'Предварительная проверка ещё не выполнена.';
      summary.innerHTML = '';
      candidates.innerHTML = '';
      history.innerHTML = '';
      driftQueue.innerHTML = '';
      return;
    }
    if (r.available === false) {
      status.textContent = r.reason || 'Восстановление недоступно.';
      summary.innerHTML = '';
      candidates.innerHTML = '';
      history.innerHTML = '';
      driftQueue.innerHTML = '';
      return;
    }
  
    const scan = r.scan || {};
    const recovery = r.recovery || {};
    const watchdog = r.watchdog || {};
    const reliability = watchdog.reliability || {};
    const runLedger = watchdog.runLedger || {};
    const finality = watchdog.finality || {};
    const driftReview = r.driftReview || {};
    const resetBtn = $('modelRemediationCircuitResetBtn');
    if (resetBtn) {
      resetBtn.hidden = !reliability.circuitOpen;
      resetBtn.disabled = Boolean(state.modelRemediationLoading || state.modelRemediationRunning || !reliability.schemaReady);
    }
    status.textContent = !r.schemaReady
      ? `Предварительная проверка доступна, выполнение заблокировано: ${SUPABASE_SCHEMA_HINT}.`
      : Number(driftReview.unresolved || 0)
        ? `Требуют ручного разбора: ${Number(driftReview.unresolved)} расхождений. Зависших ожиданий: ${Number(recovery.stalePending || 0)}.`
        : recovery.stalePending
          ? `Найдено зависших ожиданий: ${Number(recovery.stalePending)}; безопасный пакет — ${Number(recovery.selectedCount || 0)}.`
          : 'Зависшие ожидания и неразобранные расхождения не обнаружены.';
    summary.innerHTML = `
      <div><span>Просканировано</span><strong>${Number(scan.loadedRows || 0)}</strong><small>${scan.truncated ? `лимит ${Number(scan.maxRows || 0)}` : 'полная выборка'}</small></div>
      <div><span>Зависшие ожидания</span><strong>${Number(recovery.stalePending || 0)}</strong><small>старше 36 часов</small></div>
      <div><span>В пакете</span><strong>${Number(recovery.selectedCount || 0)}</strong><small>до ${Number(recovery.maxFixturesPerRun || 20)} матчей</small></div>
      <div><span>Запросы к источнику</span><strong>${Number(recovery.estimatedProviderCalls || 0)}</strong><small>по уникальным датам</small></div>
      <div><span>Контроль результатов</span><strong>${watchdog.autoRecoveryEnabled ? 'АВТО' : 'НАБЛЮДЕНИЕ'}</strong><small>${watchdog.schemaReady ? `${escapeHtml(watchdog.scheduleUtc || '04:00')} по всемирному времени` : SUPABASE_SCHEMA_HINT}</small></div>
      <div><span>Защитный контур</span><strong>${reliability.circuitOpen ? 'ОТКРЫТА' : 'ЗАКРЫТА'}</strong><small>${reliability.schemaReady ? (reliability.circuitOpenUntil ? `до ${escapeHtml(dateTime(reliability.circuitOpenUntil))}` : `${Number(reliability.consecutiveFailures || 0)}/${Number(reliability.failureThreshold || 2)} ошибок`) : SUPABASE_SCHEMA_HINT}</small></div>
      <div><span>Журнал запусков</span><strong>${Number(runLedger.activeStarted || 0) ? 'ЗАНЯТО' : Number(runLedger.staleStarted || 0) ? 'ЗАВИСЛО' : 'ЧИСТО'}</strong><small>${runLedger.schemaReady ? `${Number(runLedger.activeStarted || 0)} активных · ${Number(runLedger.staleStarted || 0)} зависших · максимум ${Number(runLedger.maxAttempts || 3)} попытки` : SUPABASE_SCHEMA_HINT}</small></div>
      <div><span>Подтверждение результата</span><strong>${Number(finality.drift || 0) ? 'РАСХОЖДЕНИЕ' : Number(finality.unverified || 0) || Number(finality.verified || 0) ? 'ПРОВЕРКА' : 'ПОДТВЕРЖДЕНО'}</strong><small>${finality.schemaReady ? `${Number(finality.confirmed || 0)} подтверждено · ${Number(finality.verified || 0)} первично проверено · ${Number(finality.unverified || 0)} ожидают проверки · ${Number(finality.adjudicated || 0)} проверено вручную · ${Number(finality.drift || 0)} расхождений` : SUPABASE_SCHEMA_HINT}</small></div>
      <div><span>Доверенные метрики</span><strong>${Number(finality.trustedForMetrics || 0)}</strong><small>только подтверждённые и вручную проверенные</small></div>
      <div><span>Разбор расхождений</span><strong>${Number(driftReview.unresolved || 0) ? 'ТРЕБУЕТ ДЕЙСТВИЯ' : 'ЧИСТО'}</strong><small>${driftReview.schemaReady ? `${Number(driftReview.unresolved || 0)} неразобранных · требуется решение администратора` : SUPABASE_SCHEMA_HINT}</small></div>`;
  
    candidates.innerHTML = (recovery.candidates || []).length
      ? `<div class="model-remediation-list">${recovery.candidates.map(item => `
          <div><span><strong>${escapeHtml(item.home || '—')} — ${escapeHtml(item.away || '—')}</strong><small>${escapeHtml(item.league || '')} · ${item.kickoffAt ? escapeHtml(dateTime(item.kickoffAt)) : '—'}</small></span><em>#${Number(item.fixtureId || 0)} · ${Number(item.ageHours || 0)}ч</em></div>`).join('')}</div>`
      : '<div class="empty compact-empty">Кандидатов для восстановления нет.</div>';
  
    const driftItems = driftReview.items || [];
    driftQueue.innerHTML = driftItems.length
      ? `<div class="model-remediation-history-head"><strong>Разбор расхождений результатов</strong><span>причина + явное решение</span></div>
         <div class="settlement-drift-list">${driftItems.map(item => {
           const stored = item.stored || {};
           const provider = item.provider || {};
           const locked = String(item.lockedAction || '');
           const storedScore = Number.isFinite(Number(stored.homeGoals)) && Number.isFinite(Number(stored.awayGoals)) ? `${Number(stored.homeGoals)}:${Number(stored.awayGoals)}` : '—';
           const providerScore = Number.isFinite(Number(provider.homeGoals)) && Number.isFinite(Number(provider.awayGoals)) ? `${Number(provider.homeGoals)}:${Number(provider.awayGoals)}` : '—';
           return `<div class="settlement-drift-item">
             <div class="settlement-drift-copy"><strong>${escapeHtml(item.home || '—')} — ${escapeHtml(item.away || '—')}</strong><small>${escapeHtml(item.league || '')} · #${Number(item.fixtureId || 0)} · ${item.observedAt ? escapeHtml(dateTime(item.observedAt)) : '—'}</small><span>сохранено ${escapeHtml(storedScore)} ${escapeHtml(outcomeShortLabel(stored.outcome))} → источник ${escapeHtml(providerScore)} ${escapeHtml(outcomeShortLabel(provider.outcome))} · ${escapeHtml(humanizeTechnicalText(provider.status || ''))}</span><em>${escapeHtml(humanizeTechnicalText(item.driftReason || 'расхождение данных источника'))}${locked ? ` · решение: ${escapeHtml(remediationActionCodeLabel(locked))}` : ''}</em></div>
             <div class="settlement-drift-actions">
               <button class="reminder-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="keep_stored" ${locked && locked !== 'keep_stored' ? 'disabled' : ''}>Оставить сохранённое</button>
               <button class="primary-setting-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="accept_provider" ${!item.providerAcceptable || (locked && locked !== 'accept_provider') ? 'disabled' : ''}>Принять данные источника</button>
               <button class="reminder-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="void_prediction" ${locked && locked !== 'void_prediction' ? 'disabled' : ''}>Исключить из метрик</button>
             </div>
           </div>`;
         }).join('')}</div>`
      : '<p class="tiny quality-method-note">Неразобранных расхождений нет.</p>';
  
    const actions = r.recentActions || [];
    history.innerHTML = actions.length
      ? `<div class="model-remediation-history-head"><strong>Последние действия</strong><span>идентификатор администратора скрыт</span></div>
         <div class="model-remediation-action-list">${actions.map(action => `
           <div class="${escapeHtml(action.status || 'failed')}"><span><strong>${escapeHtml(remediationActionLabel(action))}${action.actionType === 'auto_recover' ? ' · АВТО' : action.actionType === 'circuit_reset' ? ' · СБРОС ЗАЩИТЫ' : ''}</strong><small>${escapeHtml(humanizeTechnicalText(action.reason || 'Без комментария'))} · ${action.createdAt ? escapeHtml(dateTime(action.createdAt)) : '—'}${action.triggerSource ? ` · источник: ${escapeHtml(humanizeTechnicalText(action.triggerSource))}` : ''}${action.attemptNo ? ` · попытка ${Number(action.attemptNo)}` : ''}${action.retryOfActionId ? ' · повтор' : ''}</small></span><em>${Number(action.settledCount || 0)} закрыто · ${Number(action.skippedCount || 0)} пропущено</em></div>`).join('')}</div>`
      : '<p class="tiny quality-method-note">Журнал действий пока пуст.</p>';
  
    runBtn.textContent = state.modelRemediationRunning ? 'Восстанавливаю…' : 'Восстановить ожидающие';
    runBtn.disabled = Boolean(state.modelRemediationRunning || !r.schemaReady || !recovery.candidateToken || !Number(recovery.selectedCount || 0));
  }
  
  async function loadModelRemediation(force = false) {
    if (!isAdmin() || state.modelRemediationLoading || state.modelRemediationRunning) return;
    if (!force && state.modelRemediation) { renderModelRemediation(); return; }
    state.modelRemediationLoading = true;
    renderModelRemediation();
    try {
      state.modelRemediation = await api('/api/model-remediation', { retry: false, timeoutMs: 45000, dedupe: false });
    } catch (error) {
      state.modelRemediation = { available: false, reason: error.message || 'Не удалось выполнить предварительную проверку восстановления.' };
    } finally {
      state.modelRemediationLoading = false;
      renderModelRemediation();
    }
  }
  
  async function runModelRemediation() {
    if (!isAdmin() || state.modelRemediationRunning) return;
    const report = state.modelRemediation;
    const recovery = report?.recovery || {};
    const reason = String($('modelRemediationReason')?.value || '').trim();
    if (reason.length < 5) return toast('Укажите причину восстановления — минимум 5 символов.');
    if (!report?.schemaReady || !recovery.candidateToken || !(recovery.fixtureIds || []).length) return toast('Сначала выполните актуальную предварительную проверку.');
    const confirmed = confirm(`Повторно проверить ${Number(recovery.selectedCount || 0)} ожидающих прогнозов? Ожидается до ${Number(recovery.estimatedProviderCalls || 0)} запросов к источнику данных.`);
    if (!confirmed) return;
  
    state.modelRemediationRunning = true;
    renderModelRemediation();
    try {
      const result = await api('/api/model-remediation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'recover',
          reason,
          candidateToken: recovery.candidateToken,
          fixtureIds: recovery.fixtureIds,
        }),
        retry: false,
        timeoutMs: 60000,
        dedupe: false,
      });
      state.modelRemediation = result.report || state.modelRemediation;
      state.modelQuality = null;
      toast(result.execution?.status === 'completed'
        ? `Восстановление завершено: закрыто ${Number(result.execution?.settledCount || 0)}.`
        : `Восстановление завершено частично: закрыто ${Number(result.execution?.settledCount || 0)}, пропущено ${Number(result.execution?.skippedCount || 0)}.`);
      if ($('modelRemediationReason')) $('modelRemediationReason').value = '';
      await refreshModelQuality(true);
    } catch (error) {
      toast(error.message || 'Восстановление не выполнено. Обновите предварительную проверку.');
      state.modelRemediationRunning = false;
      state.modelRemediation = null;
      await loadModelRemediation(true);
    } finally {
      state.modelRemediationRunning = false;
      renderModelRemediation();
    }
  }
  
  
  async function resolveSettlementDriftFromUi(fixtureId, action) {
    if (!isAdmin() || state.modelRemediationRunning) return;
    const review = state.modelRemediation?.driftReview || {};
    const item = (review.items || []).find(row => Number(row.fixtureId) === Number(fixtureId));
    if (!item) return toast('Данные расхождения устарели. Обновите предварительную проверку.');
    const reason = String($('modelRemediationReason')?.value || '').trim();
    if (reason.length < 5) return toast('Укажите причину разбора — минимум 5 символов.');
    if (item.lockedAction && String(item.lockedAction) !== String(action)) {
      return toast(`Для этого расхождения уже зафиксировано действие: ${item.lockedAction}.`);
    }
    const labels = {
      keep_stored: 'оставить сохранённый результат',
      accept_provider: 'принять исправление источника и пересчитать метрики результата',
      void_prediction: 'исключить прогноз из исторических метрик',
    };
    if (!labels[action]) return;
    if (!confirm(`Матч #${Number(item.fixtureId)}: ${labels[action]}? Действие будет записано в неизменяемый журнал.`)) return;
  
    state.modelRemediationRunning = true;
    renderModelRemediation();
    try {
      const result = await api('/api/model-remediation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'resolve_drift',
          resolutionAction: action,
          fixtureId: Number(item.fixtureId),
          eventId: Number(item.eventId),
          resolutionToken: String(item.resolutionToken || ''),
          reason,
        }),
        retry: false,
        timeoutMs: 30000,
        dedupe: false,
      });
      state.modelRemediation = result.report || null;
      state.modelQuality = null;
      if ($('modelRemediationReason')) $('modelRemediationReason').value = '';
      toast(action === 'accept_provider'
        ? 'Исправление источника данных принято и записано в журнал.'
        : action === 'void_prediction'
          ? 'Прогноз исключён из исторических метрик и записан в журнал.'
          : 'Сохранённый результат подтверждён администратором и записан в журнал.');
      await refreshModelQuality(true);
    } catch (error) {
      toast(error.message || 'Разбор расхождения не выполнен.');
      state.modelRemediation = null;
      await loadModelRemediation(true);
    } finally {
      state.modelRemediationRunning = false;
      renderModelRemediation();
    }
  }
  
  async function resetSettlementCircuitFromUi() {
    if (!isAdmin() || state.modelRemediationRunning) return;
    const reliability = state.modelRemediation?.watchdog?.reliability || {};
    if (!reliability.circuitOpen) return toast('Защитный контур уже закрыт.');
    const reason = String($('modelRemediationReason')?.value || '').trim();
    if (reason.length < 5) return toast('Укажите причину сброса защиты — минимум 5 символов.');
    if (!confirm('Закрыть защитный контур и снова разрешить автоматическое восстановление при следующей проверке?')) return;
    state.modelRemediationRunning = true;
    renderModelRemediation();
    try {
      const result = await api('/api/model-remediation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reset_circuit', reason }),
        retry: false,
        timeoutMs: 20000,
        dedupe: false,
      });
      state.modelRemediation = result.report || state.modelRemediation;
      if ($('modelRemediationReason')) $('modelRemediationReason').value = '';
      toast('Защитный контур закрыт. Сброс записан в журнал.');
    } catch (error) {
      toast(error.message || 'Не удалось сбросить защитный контур.');
      state.modelRemediation = null;
      await loadModelRemediation(true);
    } finally {
      state.modelRemediationRunning = false;
      renderModelRemediation();
    }
  }

  return Object.freeze({
    renderModelRemediation,
    loadModelRemediation,
    runModelRemediation,
    resolveSettlementDriftFromUi,
    resetSettlementCircuitFromUi,
  });
}
