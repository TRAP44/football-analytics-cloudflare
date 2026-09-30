export function createAdminModelRemediationViewModule({
  state,
  elementById,
  isAdmin,
  escapeHtml,
  humanizeTechnicalText,
  dateTime,
  outcomeShortLabel,
  schemaHint,
  api,
}) {
  if (
    !state ||
    typeof elementById !== 'function' ||
    typeof isAdmin !== 'function' ||
    typeof api !== 'function'
  ) {
    throw new TypeError('Admin Model Remediation view requires state, DOM, admin and API dependencies.');
  }

  const $ = elementById;

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
    if (!isAdmin()) return;
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
      ? `Предварительная проверка доступна, выполнение заблокировано: ${schemaHint}.`
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
      <div><span>Контроль результатов</span><strong>${watchdog.autoRecoveryEnabled ? 'АВТО' : 'НАБЛЮДЕНИЕ'}</strong><small>${watchdog.schemaReady ? `${escapeHtml(watchdog.scheduleUtc || '04:00')} по всемирному времени` : schemaHint}</small></div>
      <div><span>Защитный контур</span><strong>${reliability.circuitOpen ? 'ОТКРЫТА' : 'ЗАКРЫТА'}</strong><small>${reliability.schemaReady ? (reliability.circuitOpenUntil ? `до ${escapeHtml(dateTime(reliability.circuitOpenUntil))}` : `${Number(reliability.consecutiveFailures || 0)}/${Number(reliability.failureThreshold || 2)} ошибок`) : schemaHint}</small></div>
      <div><span>Журнал запусков</span><strong>${Number(runLedger.activeStarted || 0) ? 'ЗАНЯТО' : Number(runLedger.staleStarted || 0) ? 'ЗАВИСЛО' : 'ЧИСТО'}</strong><small>${runLedger.schemaReady ? `${Number(runLedger.activeStarted || 0)} активных · ${Number(runLedger.staleStarted || 0)} зависших · максимум ${Number(runLedger.maxAttempts || 3)} попытки` : schemaHint}</small></div>
      <div><span>Подтверждение результата</span><strong>${Number(finality.drift || 0) ? 'РАСХОЖДЕНИЕ' : Number(finality.unverified || 0) || Number(finality.verified || 0) ? 'ПРОВЕРКА' : 'ПОДТВЕРЖДЕНО'}</strong><small>${finality.schemaReady ? `${Number(finality.confirmed || 0)} подтверждено · ${Number(finality.verified || 0)} первично проверено · ${Number(finality.unverified || 0)} ожидают проверки · ${Number(finality.adjudicated || 0)} проверено вручную · ${Number(finality.drift || 0)} расхождений` : schemaHint}</small></div>
      <div><span>Доверенные метрики</span><strong>${Number(finality.trustedForMetrics || 0)}</strong><small>только подтверждённые и вручную проверенные</small></div>
      <div><span>Разбор расхождений</span><strong>${Number(driftReview.unresolved || 0) ? 'ТРЕБУЕТ ДЕЙСТВИЯ' : 'ЧИСТО'}</strong><small>${driftReview.schemaReady ? `${Number(driftReview.unresolved || 0)} неразобранных · требуется решение администратора` : schemaHint}</small></div>`;
  
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

  return Object.freeze({
    renderModelRemediation,
    loadModelRemediation,
  });
}
