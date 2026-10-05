export function bindAppEvents(deps = {}) {
  const {
    analysisHistoryForFixture,
    analyzeMatch,
    billingModule,
    bindGlobalSearchControls,
    bindRovingTabKeyboard,
    clearRecentTeams,
    copyMediaPublisherPost,
    dismissFirstRunGuide,
    forceFreshReload,
    generateMediaPublisherLink,
    handleBackNavigation,
    hideBootGate,
    loadAdvancedAdminTools,
    loadAiTrackRecord,
    loadBetaDashboard,
    loadCalibrationControl,
    loadDiagnostics,
    loadHistory,
    loadLaunchFunnel,
    loadMatches,
    loadModelQuality,
    loadModelRemediation,
    loadProductionReadiness,
    loadRcRegression,
    loadReleaseMonitor,
    loadReleaseReadiness,
    loadReminderHealth,
    loadRuntimeControlsAdmin,
    openHistoryAnalysis,
    openMatchCenter,
    openProfileView,
    optimizeImages,
    probeProvider,
    recoverActiveView,
    renderAiTrackRecord,
    renderGlobalSearch,
    renderHistory,
    renderMatches,
    renderMyTeams,
    resetSettlementCircuitFromUi,
    resolveSettlementDriftFromUi,
    restoreRuntimeDefaults,
    resumeLiveRefresh,
    runCalibrationControlAction,
    runGlobalSearch,
    runModelRemediation,
    runProviderCoverageAudit,
    runProviderE2E,
    runStartupSequence,
    saveInterfacePreference,
    savePreferencesFromUi,
    saveRuntimeControls,
    sendClientTelemetry,
    sendProductAction,
    sendReminderTest,
    setBetaFeedbackOpen,
    setNetworkMode,
    setTeamTab,
    setTournamentTab,
    showView,
    startFirstRunFavorite,
    startFirstRunSearch,
    state,
    submitBetaFeedback,
    suspendLiveRefresh,
    syncFilterButtons,
    telemetryViewName,
    tg,
    toast,
  } = deps;

  const imageObserver = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) optimizeImages(node);
  });
  imageObserver.observe(document.body, { childList: true, subtree: true });
  optimizeImages();
  
  function updateConnectionBanner() {
    const banner = $('connectionBanner');
    const title = $('connectionBannerTitle');
    const text = $('connectionBannerText');
    const icon = $('connectionBannerIcon');
    const retry = $('connectionRetryBtn');
    if (!banner || !title || !text || !icon || !retry) return;
  
    if (navigator.onLine === false) state.network.mode = 'offline';
    const mode = state.network.mode || 'online';
    const retryAt = Number(state.network.retryAt || 0);
    const retryRemaining = retryAt > Date.now() ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
    clearTimeout(updateConnectionBanner.retryTimer);
    banner.className = `connection-banner ${mode}`;
    retry.hidden = !['offline','degraded'].includes(mode) || navigator.onLine === false;
    retry.disabled = false;
    retry.textContent = 'Повторить';
  
    if (mode === 'offline') {
      banner.hidden = false;
      icon.textContent = '📴';
      title.textContent = 'Нет подключения';
      text.textContent = 'Оставляем доступные сохранённые данные на экране. После восстановления сети попробуем обновиться автоматически.';
      return;
    }
  
    if (mode === 'recovering') {
      banner.hidden = false;
      icon.textContent = '↻';
      title.textContent = 'Восстанавливаю данные';
      text.textContent = state.network.message || 'Проверяю соединение и текущий экран.';
      return;
    }
  
    if (mode === 'degraded') {
      banner.hidden = false;
      icon.textContent = state.network.category === 'rate_limit' ? '⏳' : '⚠️';
      title.textContent = state.network.category === 'rate_limit'
        ? 'Обновления временно на паузе'
        : 'Часть данных обновляется медленнее';
      if (state.network.category === 'rate_limit') {
        retry.hidden = false;
        retry.disabled = retryRemaining > 0;
        retry.textContent = retryRemaining > 0 ? `Повторить через ${retryRemaining} с` : 'Повторить';
        text.textContent = retryRemaining > 0
          ? `Показываем сохранённые данные. Новая попытка будет доступна через ${retryRemaining} с.`
          : 'Показываем сохранённые данные. Можно повторить обновление.';
        if (retryRemaining > 0) {
          updateConnectionBanner.retryTimer = setTimeout(updateConnectionBanner, Math.min(1000, retryRemaining * 1000));
        }
      } else {
        text.textContent = state.network.message || 'Сохранённые данные останутся доступны.';
      }
      return;
    }
  
    if (mode === 'online' && state.network.lastRecoveredAt) {
      banner.hidden = false;
      banner.classList.add('recovered');
      icon.textContent = '✓';
      title.textContent = 'Соединение восстановлено';
      text.textContent = 'Свежие данные снова доступны.';
      clearTimeout(updateConnectionBanner.hideTimer);
      updateConnectionBanner.hideTimer = setTimeout(() => {
        if (state.network.mode === 'online') banner.hidden = true;
      }, 1800);
      return;
    }
  
    banner.hidden = true;
  }
  
  
  function noteClientError(error) {
    const message = String(error?.message || error || 'Неизвестная ошибка').slice(0, 180);
    state.clientPerf.clientErrors += 1;
    state.clientPerf.lastError = message;
    sendClientTelemetry('client_error', {
      errorKind: String(error?.name || typeof error || 'runtime').slice(0, 50),
      view: telemetryViewName(),
    }, { once: true });
  }
  window.addEventListener('error', event => noteClientError(event?.error || event?.message));
  window.addEventListener('unhandledrejection', event => noteClientError(event?.reason));
  $('versionReloadBtn')?.addEventListener('click', forceFreshReload);
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.network.hiddenAt = Date.now();
      suspendLiveRefresh();
      return;
    }
  
    const hiddenForMs = state.network.hiddenAt ? Date.now() - Number(state.network.hiddenAt) : 0;
    state.network.hiddenAt = null;
    const fixtureId = Number(state.currentCenter?.match?.fixtureId || 0);
  
    resumeLiveRefresh();
  
    // Telegram can keep the WebView suspended for minutes. Refresh only the
    // current screen, never re-run a paid/limited pre-match analysis automatically.
    if (hiddenForMs >= 60000 && navigator.onLine !== false) {
      recoverActiveView({ automatic: true });
    }
  });
  
  window.addEventListener('offline', () => {
    setNetworkMode('offline', { category: 'offline', message: 'Нет подключения к интернету.' });
    toast('Нет подключения — сохранённые данные останутся доступны');
  });
  window.addEventListener('online', () => {
    setNetworkMode('recovering', { message: 'Соединение вернулось. Обновляю текущий экран…' });
    recoverActiveView({ automatic: true });
  });
  $('connectionRetryBtn')?.addEventListener('click', () => recoverActiveView({ automatic: false }));
  updateConnectionBanner();
  
  let matchSearchTimer = null;
  
  document.querySelectorAll('.date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.date-btn').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      state.offset = Number(btn.dataset.offset);
      loadMatches();
    });
  });
  
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      syncFilterButtons();
      renderMatches();
      const drawer = btn.closest('.league-filter-drawer');
      if (drawer) drawer.open = false;
    });
  });
  
  $('homePersonalMatchBtn')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const fixtureId = Number(button.dataset.personalFixture || 0);
    if (!fixtureId) return;
    const match = state.matches.find(item => Number(item.fixtureId) === fixtureId);
    if (!match) return;
    if (match.live) openMatchCenter(fixtureId, button);
    else {
      const saved = analysisHistoryForFixture(fixtureId);
      if (saved) openHistoryAnalysis(fixtureId, button);
      else analyzeMatch(fixtureId, button);
    }
  });
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.addEventListener('click', () => saveInterfacePreference('theme', button.dataset.themeChoice || 'system'));
  });
  document.querySelectorAll('[data-accent-choice]').forEach(button => {
    button.addEventListener('click', () => saveInterfacePreference('accent', button.dataset.accentChoice || 'system'));
  });
  document.querySelectorAll('[data-button-style-choice]').forEach(button => {
    button.addEventListener('click', () => saveInterfacePreference('buttonStyle', button.dataset.buttonStyleChoice || 'soft'));
  });
  
  document.querySelectorAll('[data-admin-target]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = $(button.dataset.adminTarget);
      if (!target) return;
      if (target.tagName === 'DETAILS') {
        target.open = true;
        await loadAdvancedAdminTools();
      }
      if (button.dataset.adminTarget === 'diagnosticsPanel' && !state.diagnosticsLoading) await loadDiagnostics(false);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  $('adminAdvancedTools')?.addEventListener('toggle', event => {
    if (event.currentTarget.open) loadAdvancedAdminTools();
  });
  $('betaDashboardRefreshBtn')?.addEventListener('click', () => loadBetaDashboard(true));
  $('betaDashboardPeriod')?.addEventListener('change', event => {
    state.betaDashboardDays=Number(event.target.value || 7);
    state.betaDashboard=null;
    loadBetaDashboard(true);
  });
  $('betaFeedbackOpenBtn')?.addEventListener('click', () => setBetaFeedbackOpen(true));
  $('betaFeedbackCancelBtn')?.addEventListener('click', () => setBetaFeedbackOpen(false));
  $('betaFeedbackSendBtn')?.addEventListener('click', submitBetaFeedback);
  
  $('matchSearch').addEventListener('input', e => {
    state.search = e.target.value || '';
    clearTimeout(matchSearchTimer);
    matchSearchTimer = setTimeout(renderMatches, 110);
  });
  
  bindGlobalSearchControls();
  $('clearRecentTeamsBtn')?.addEventListener('click', clearRecentTeams);
  $('refreshBtn').addEventListener('click', () => loadMatches({ force: true }));
  $('historyRefreshBtn').addEventListener('click', () => Promise.allSettled([loadHistory(true), loadAiTrackRecord(true)]));
  $('backBtn').addEventListener('click', handleBackNavigation);
  $('tournamentBackBtn')?.addEventListener('click', handleBackNavigation);
  $('teamBackBtn')?.addEventListener('click', handleBackNavigation);
  $('playerBackBtn')?.addEventListener('click', handleBackNavigation);
  const tournamentTabs = [...document.querySelectorAll('.tournament-tab')];
  tournamentTabs.forEach(btn => btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab || 'matches')));
  bindRovingTabKeyboard(tournamentTabs, 'tournamentTab', value => setTournamentTab(value));
  const teamTabs = [...document.querySelectorAll('.team-tab')];
  teamTabs.forEach(btn => btn.addEventListener('click', () => setTeamTab(btn.dataset.teamTab || 'overview')));
  bindRovingTabKeyboard(teamTabs, 'teamTab', value => setTeamTab(value));
  $('profileBtn').addEventListener('click', () => {
    billingModule?.clearPassContext();
    void openProfileView();
  });
  $('navMatches').addEventListener('click', () => {
    sendProductAction('matches_open', 'matchesView');
    showView('matchesView');
  });
  $('navMyTeams')?.addEventListener('click', () => {
    sendProductAction('matches_open', 'myTeamsView');
    renderMyTeams();
    showView('myTeamsView');
  });
  $('navHistory').addEventListener('click', async () => {
    sendProductAction('history_open', 'historyView');
    showView('historyView');
    const tasks=[];
    if (!state.historyLoaded) tasks.push(loadHistory(true)); else renderHistory();
    if (!state.aiTrackRecordLoaded) tasks.push(loadAiTrackRecord(false)); else renderAiTrackRecord();
    if (tasks.length) await Promise.allSettled(tasks);
  });
  $('navProfile').addEventListener('click', () => {
    billingModule?.clearPassContext();
    void openProfileView();
  });
  $('profileFavoriteTeamsBtn')?.addEventListener('click', () => {
    renderMyTeams();
    showView('myTeamsView');
  });
  $('profileRemindersBtn')?.addEventListener('click', () => {
    showView('matchesView');
  });
  $('myTeamsFindBtn')?.addEventListener('click', () => { showView('matchesView'); setTimeout(() => $('matchSearch')?.focus({ preventScroll:true }), 80); });
  $('homeSearchBtn')?.addEventListener('click', () => { const q=String($('matchSearch')?.value || '').trim(); state.globalSearch.query=q; if ($('globalSearchInput')) $('globalSearchInput').value=q; renderGlobalSearch(); showView('searchView'); if (q) runGlobalSearch(); });
  $('savePreferencesBtn')?.addEventListener('click', savePreferencesFromUi);
  $('modelQualityRefreshBtn')?.addEventListener('click', () => Promise.allSettled([loadModelQuality(true), loadCalibrationControl(true), loadModelRemediation(true)]));
  $('modelQualityPeriod')?.addEventListener('change', () => loadModelQuality(true));
  $('calibrationFreezeBtn')?.addEventListener('click', () => runCalibrationControlAction('freeze'));
  $('calibrationUnfreezeBtn')?.addEventListener('click', () => runCalibrationControlAction('unfreeze'));
  $('calibrationRollbackBtn')?.addEventListener('click', () => runCalibrationControlAction('manual_rollback'));
  $('modelRemediationDryRunBtn')?.addEventListener('click', () => loadModelRemediation(true));
  $('modelRemediationRunBtn')?.addEventListener('click', runModelRemediation);
  $('modelRemediationCircuitResetBtn')?.addEventListener('click', resetSettlementCircuitFromUi);
  $('modelRemediationDriftQueue')?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-drift-action]');
    if (!button || button.disabled) return;
    resolveSettlementDriftFromUi(Number(button.dataset.driftFixture || 0), String(button.dataset.driftAction || ''));
  });
  $('diagnosticsRefreshBtn')?.addEventListener('click', () => loadDiagnostics(true));
  $('productionReadinessRefreshBtn')?.addEventListener('click', () => loadProductionReadiness(true));
  $('releaseMonitorRefreshBtn')?.addEventListener('click', () => loadReleaseMonitor(true));
  $('releaseMonitorPeriod')?.addEventListener('change', () => { state.releaseMonitor = null; loadReleaseMonitor(true); });
  $('releaseMonitorDigestPeriod')?.addEventListener('change', () => { state.releaseMonitor = null; loadReleaseMonitor(true); });
  $('launchFunnelRefreshBtn')?.addEventListener('click', () => loadLaunchFunnel(true));
  $('launchFunnelPeriod')?.addEventListener('change', () => { state.launchFunnel = null; loadLaunchFunnel(true); });
  $('mediaPublisherGenerateBtn')?.addEventListener('click', generateMediaPublisherLink);
  $('mediaPublisherCopyBtn')?.addEventListener('click', copyMediaPublisherPost);
  $('mediaPublisherFixtureId')?.addEventListener('keydown', e => { if (e.key === 'Enter') generateMediaPublisherLink(); });
  $('reminderHealthRefreshBtn')?.addEventListener('click', () => loadReminderHealth(true));
  $('reminderTestBtn')?.addEventListener('click', () => sendReminderTest());
  $('runtimeControlsRefreshBtn')?.addEventListener('click', () => loadRuntimeControlsAdmin(true));
  $('runtimeSaveBtn')?.addEventListener('click', () => saveRuntimeControls());
  $('runtimeDefaultsBtn')?.addEventListener('click', () => restoreRuntimeDefaults());
  $('rcRunBtn')?.addEventListener('click', () => loadRcRegression(true));
  $('providerProbeBtn')?.addEventListener('click', () => probeProvider());
  $('providerAuditBtn')?.addEventListener('click', () => runProviderCoverageAudit(null, true));
  $('providerE2EBtn')?.addEventListener('click', () => runProviderE2E(null));
  $('providerAuditFixtureId')?.addEventListener('keydown', e => { if (e.key === 'Enter') runProviderCoverageAudit(null, true); });
  $('releaseRefreshBtn')?.addEventListener('click', () => loadReleaseReadiness(true));
  $('bootReloadBtn')?.addEventListener('click', forceFreshReload);
  $('bootRetryBtn')?.addEventListener('click', () => runStartupSequence());
  $('bootContinueBtn')?.addEventListener('click', hideBootGate);
  $('firstRunGuideSearch')?.addEventListener('click', startFirstRunSearch);
  $('firstRunGuideFavorite')?.addEventListener('click', startFirstRunFavorite);
  $('firstRunGuideDismiss')?.addEventListener('click', dismissFirstRunGuide);
  
  if (tg?.BackButton?.onClick) {
    try { tg.BackButton.onClick(handleBackNavigation); } catch {}
  }
}
