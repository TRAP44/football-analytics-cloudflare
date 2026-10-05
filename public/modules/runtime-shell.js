export function createRuntimeShellModule(deps = {}) {
  const {
    CANONICAL_HOME_VIEW,
    CLIENT_API_CONTRACT,
    CLIENT_RELEASE_CHANNEL,
    CLIENT_VERSION,
    PHASE5_SESSION_TOKEN,
    PUBLIC_VIEW_IDS,
    activeViewId,
    analysisController,
    analysisControllerPromise,
    api,
    applyInterfacePreferences,
    applyLaunchIntent,
    backTargetForView,
    billingModule,
    buildAnalysisAccessUsage,
    createApiClient,
    createFirstRunGuideController,
    createInterfacePreferencesController,
    createNavigationShell,
    createPlayerFollowModule,
    createViewChromeController,
    digestSettingsModule,
    digestSettingsModulePromise,
    dismissFirstRunGuide,
    escapeHtml,
    handleBackNavigation,
    hasDirectLaunchIntent,
    hideQuotaPaywall,
    inflightGetRequests,
    isAdmin,
    loadAiTrackRecord,
    loadFavoritePlayers,
    loadFavorites,
    loadHistory,
    loadMatches,
    loadProfile,
    loadProvider,
    loadReminders,
    loadTeamHub,
    loadTournamentStandings,
    matchCenterController,
    matchCenterControllerPromise,
    matchCenterExtras,
    matchCenterExtrasPromise,
    navigationShell,
    planLabel,
    playerFollowModule,
    rememberHistoryAnalysis,
    renderAnalysis,
    renderDiscoveryHome,
    renderFirstRunGuide,
    renderGlobalSearch,
    renderJourneyState,
    renderMatchCenter,
    renderPlayerHub,
    renderProfile,
    renderProvider,
    renderTournamentHero,
    renderTournamentMatches,
    requestMatchCenter,
    saveInterfacePreference,
    scheduleIdle,
    showQuotaPaywallForFixture,
    showView,
    smartNotificationsModule,
    smartNotificationsModulePromise,
    startFirstRunFavorite,
    startFirstRunSearch,
    state,
    syncAnalysisBusyUi,
    syncBackButtons,
    syncTelegramBackButton,
    syncTopbar,
    telegramBackButtonVisible,
    tg,
    updateConnectionBanner,
  } = deps;

  function syncBootVersion() {
    const el = $('publicAppVersion');
    if (el) el.textContent = CLIENT_VERSION.split('-')[0];
  }
  
  const {
    hasDirectLaunchIntent,
    renderFirstRunGuide,
    dismissFirstRunGuide,
    startFirstRunSearch,
    startFirstRunFavorite,
  } = createFirstRunGuideController({
    window,
    tg,
    state,
    storage: localStorage,
    elementById: $,
    sendProductAction,
    renderGlobalSearch: () => renderGlobalSearch(),
    showView: (id, options) => showView(id, options),
  });
  
  function stopLiveRefresh() {
    matchCenterController?.stopLiveRefresh();
  }
  
  function deactivateLiveRefresh() {
    matchCenterController?.deactivateLiveRefresh();
  }
  
  function suspendLiveRefresh() {
    return matchCenterController?.suspendLiveRefresh() || false;
  }
  
  function resumeLiveRefresh() {
    return matchCenterController?.resumeLiveRefresh() || false;
  }
  
  function viewBackTarget(id = activeViewId()) {
    return backTargetForView(id, state);
  }
  
  const {
    syncTopbar,
    syncBackButtons,
    syncTelegramBackButton,
  } = createViewChromeController({
    elementById: $,
    telegramWebApp: tg,
    resolveBackTarget: id => viewBackTarget(id),
    isTelegramBackVisible: id => telegramBackButtonVisible(id),
  });
  
  const navigationShell = createNavigationShell({
    window,
    document,
    elementById: $,
    viewIds: PUBLIC_VIEW_IDS,
    homeView: CANONICAL_HOME_VIEW,
    resolveBackTarget: id => viewBackTarget(id),
    syncTopbar,
    syncBackButtons,
    syncTelegramBackButton,
    onLeaveView: ({ from, to, options }) => {
      if (from === 'historyView' && to !== 'historyView' && !options.fromHistoryOpen) {
        state.historyOpenRequestSeq += 1;
      }
      if (from === 'analysisView' && to !== 'analysisView' && state.analysisActionPending) {
        state.analysisRequestSeq += 1;
      }
      if (to !== 'analysisView') deactivateLiveRefresh();
    },
    onEffectError: (error, context) => {
      console.error('Navigation lifecycle effect failed', context, error);
    },
  });
  
  const { activeViewId, handleBackNavigation, showView } = navigationShell;
  
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  
  const {
    applyInterfacePreferences,
    saveInterfacePreference,
  } = createInterfacePreferencesController({
    document,
    window,
    tg,
    state,
    storage: localStorage,
    toast,
  });
  
  
  function apiErrorCategory(error) {
    if (navigator.onLine === false || error?.status === 0) return 'offline';
    if (error?.payload?.category === 'maintenance') return 'maintenance';
    if (error?.payload?.category === 'feature_disabled') return 'feature_disabled';
    if (error?.status === 401) return 'auth';
    if (error?.status === 408 || error?.status === 504 || error?.payload?.category === 'timeout' || error?.payload?.code === 'UPSTREAM_TIMEOUT') return 'timeout';
    if (error?.status === 429 || error?.payload?.category === 'rate_limit') return 'rate_limit';
    if (error?.status === 409 && error?.payload?.code === 'MATCH_DATA_INVALID') return 'integrity';
    if (error?.payload?.category === 'database') return 'database';
    if (error?.payload?.category === 'provider' || String(error?.payload?.code || '').startsWith('FOOTBALL_')) return 'provider';
    if ([502, 503].includes(Number(error?.status))) return 'service';
    return 'generic';
  }
  
  function friendlyErrorMessage(error) {
    const category = apiErrorCategory(error);
    if (category === 'offline') return 'Нет подключения к интернету. Сохранённые данные останутся на экране.';
    if (error?.status === 426 || error?.payload?.category === 'compatibility') return 'Версия приложения устарела. Обновите приложение.';
    if (error?.payload?.category === 'maintenance') return 'Приложение временно на техническом обслуживании.';
    if (error?.payload?.category === 'feature_disabled') return 'Эта функция временно приостановлена.';
    if (category === 'auth') return 'Сессия Telegram не подтверждена. Закройте приложение и откройте его снова из бота.';
    if (category === 'timeout') return 'Сервис отвечает медленнее обычного. Попробуйте обновить ещё раз.';
    if (category === 'rate_limit') return 'Обновления временно на паузе. Уже загруженные данные доступны.';
    if (category === 'integrity') return 'Данные этого матча сейчас перепроверяются. Попробуйте открыть его немного позже.';
    if (category === 'database') return 'Хранилище данных временно недоступно. Основные футбольные экраны продолжат работу через доступные сохранённые данные.';
    if (category === 'provider') return 'Футбольные данные временно недоступны. Если есть сохранённая версия, приложение оставит её на экране.';
    if (category === 'service') return 'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.';
    return 'Не удалось получить данные. Попробуйте ещё раз.';
  }
  
  function normalizeApiError(error) {
    const message = friendlyErrorMessage(error);
    return Object.assign(new Error(message), {
      status: Number(error?.status || 0),
      payload: error?.payload || null,
      retryAfter: Number(error?.retryAfter || error?.payload?.retryAfter || 0),
      category: apiErrorCategory(error),
      cause: error,
    });
  }
  
  
  function telemetryViewName() {
    try { return activeViewId() || 'unknown'; } catch { return 'unknown'; }
  }
  
  function sendClientTelemetry(event, meta = {}, { once = false } = {}) {
    const key = `${event}:${meta.reason || meta.errorKind || meta.view || ''}`;
    if (once && state.clientTelemetrySent.has(key)) return;
    if (!tg?.initData || navigator.onLine === false) return;
    if (once) state.clientTelemetrySent.add(key);
  
    const payload = {
      event,
      meta: {
        clientVersion: CLIENT_VERSION,
        apiContract: CLIENT_API_CONTRACT,
        releaseChannel: CLIENT_RELEASE_CHANNEL,
        view: meta.view || telemetryViewName(),
        networkMode: meta.networkMode || state.network.mode || 'online',
        bootMs: meta.bootMs,
        durationMs: meta.durationMs,
        moduleReadyMs: meta.moduleReadyMs,
        navigationReadyMs: meta.navigationReadyMs,
        responseEndMs: meta.responseEndMs,
        domContentLoadedMs: meta.domContentLoadedMs,
        firstContentfulPaintMs: meta.firstContentfulPaintMs,
        manifestMs: meta.manifestMs,
        identityMs: meta.identityMs,
        feedMs: meta.feedMs,
        revealDelayMs: meta.revealDelayMs,
        viewportWidth: meta.viewportWidth,
        matchMode: meta.matchMode,
        lineupsAvailable: meta.lineupsAvailable,
        injuriesAvailable: meta.injuriesAvailable,
        statisticsAvailable: meta.statisticsAvailable,
        xgAvailable: meta.xgAvailable,
        oddsAvailable: meta.oddsAvailable,
        manifestOk: meta.manifestOk,
        degraded: meta.degraded,
        blocking: meta.blocking,
        reason: meta.reason || '',
        errorKind: meta.errorKind || '',
        startParam: meta.startParam || '',
      },
    };
  
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    fetch('/api/client-telemetry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-init-data': tg.initData,
        ...(PHASE5_SESSION_TOKEN ? { 'x-phase5-session': PHASE5_SESSION_TOKEN } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: controller.signal,
    }).catch(() => {}).finally(() => clearTimeout(timer));
  }
  
  function sendProductAction(reason, view = telemetryViewName()) {
    try {
      sendClientTelemetry('product_action', { reason: String(reason || '').slice(0, 40), view }, { once: true });
    } catch {}
  }
  
  function sendActionError(reason, error, view = telemetryViewName()) {
    sendClientTelemetry('action_error', {
      reason: String(reason || '').slice(0, 40),
      errorKind: String(error?.category || apiErrorCategory(error) || 'unknown').slice(0, 40),
      view,
    }, { once: true });
  }
  
  function sendOperationTiming(reason, startedAt, view = telemetryViewName()) {
    const durationMs = Math.max(0, Math.round(performance.now() - Number(startedAt || performance.now())));
    if (!['search', 'match', 'ai', 'live'].includes(String(reason || '')) || !Number.isFinite(durationMs)) return;
    sendClientTelemetry('operation_timing', { reason, durationMs, view }, { once: false });
  }
  
  function sendMatchDataCoverage(data, view = telemetryViewName()) {
    if (!data || typeof data !== 'object') return;
    const lineupsObserved=Boolean(
      data?.lineupQuality?.observed
      || (Array.isArray(data?.lineups) && data.lineups.length>0)
      || data?.lineups?.home?.startXI?.length
      || data?.lineups?.away?.startXI?.length
    );
    const injuriesObserved=Boolean(
      data?.availabilityQuality?.observed
      || data?.absences?.home?.length
      || data?.absences?.away?.length
    );
    const statisticsObserved=Boolean(
      data?.statisticsQuality?.observed
      || (Array.isArray(data?.statistics) && data.statistics.length>0)
    );
    const xgObserved=Boolean(data?.xgQuality?.observed);
    const oddsObserved=Boolean(data?.liveOddsQuality?.observed || data?.liveOdds);
    sendClientTelemetry('data_coverage',{
      view,
      matchMode:['upcoming','live','finished'].includes(String(data?.mode || '')) ? String(data.mode) : 'upcoming',
      lineupsAvailable:lineupsObserved,
      injuriesAvailable:injuriesObserved,
      statisticsAvailable:statisticsObserved,
      xgAvailable:xgObserved,
      oddsAvailable:oddsObserved,
    },{once:false});
  }
  
  function setNetworkMode(mode, options = {}) {
    const previous = state.network.mode;
    const retryAfter = Math.max(0, Number(options.retryAfter || 0));
    state.network.mode = mode;
    state.network.category = options.category || '';
    state.network.message = options.message || '';
    state.network.retryAfter = retryAfter;
    state.network.retryAt = retryAfter > 0 ? Date.now() + retryAfter * 1000 : 0;
    if (mode === 'degraded' && previous !== 'degraded') state.clientPerf.degradedEvents += 1;
    if (mode === 'online' && ['offline', 'degraded', 'recovering'].includes(previous)) {
      state.network.lastRecoveredAt = new Date().toISOString();
      state.clientPerf.recoveries += 1;
      sendClientTelemetry('network_recovery', { reason: previous, networkMode: mode }, { once: false });
    }
    updateConnectionBanner();
  }
  
  function noteRequestSuccess() {
    state.network.lastSuccessAt = new Date().toISOString();
    state.network.consecutiveFailures = 0;
    state.network.retryAfter = 0;
    state.network.retryAt = 0;
    if (navigator.onLine !== false && ['degraded', 'recovering'].includes(state.network.mode)) {
      setNetworkMode('online');
    }
  }
  
  function noteRequestFailure(error) {
    state.network.lastFailureAt = new Date().toISOString();
    state.network.consecutiveFailures += 1;
    const category = apiErrorCategory(error);
    const retryAfter = Number(error?.retryAfter || error?.payload?.retryAfter || 0);
    if (category === 'offline') {
      setNetworkMode('offline', { category, message: friendlyErrorMessage(error), retryAfter });
      return;
    }
    if (['timeout', 'rate_limit', 'provider', 'database', 'service'].includes(category)) {
      setNetworkMode('degraded', { category, message: friendlyErrorMessage(error), retryAfter });
    }
  }
  
  function recoveryCardHtml({ title = 'Не удалось обновить данные', message = '', retryId = '', compact = false } = {}) {
    return `<div class="recovery-card ${compact ? 'compact' : ''}">
      <div class="recovery-card-icon">↻</div>
      <div class="recovery-card-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message || 'Попробуйте ещё раз.')}</span></div>
      ${retryId ? `<button id="${escapeHtml(retryId)}" class="secondary-btn recovery-retry-btn" type="button">Повторить</button>` : ''}
    </div>`;
  }
  
  function bindCooldownRetry(button, retryAfterSeconds = 0, onRetry = null) {
    if (!button || typeof onRetry !== 'function') return;
    const retryAt = Date.now() + Math.max(0, Number(retryAfterSeconds || 0)) * 1000;
    let timer = null;
    const sync = () => {
      const remaining = retryAt > Date.now() ? Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)) : 0;
      button.disabled = remaining > 0;
      button.textContent = remaining > 0 ? `Повторить через ${remaining} с` : 'Повторить';
      clearTimeout(timer);
      if (remaining > 0) timer = setTimeout(sync, Math.min(1000, remaining * 1000));
    };
    button.addEventListener('click', () => {
      if (button.disabled) return;
      clearTimeout(timer);
      onRetry();
    }, { once:true });
    sync();
  }
  
  async function recoverActiveView({ automatic = false } = {}) {
    if (navigator.onLine === false) {
      setNetworkMode('offline', { category: 'offline', message: 'Нет подключения к интернету.' });
      return;
    }
  
    const now = Date.now();
    if (automatic && now - Number(state.network.lastAutoRecoveryAt || 0) < 15000) return;
    if (automatic) state.network.lastAutoRecoveryAt = now;
    setNetworkMode('recovering', { message: 'Проверяю свежие данные…' });
  
    try {
      await loadRuntimeStatus(true);
      const view = activeViewId();
      if (view === 'matchesView') {
        await loadMatches({ force: true, silent: true });
      } else if (view === 'teamView' && state.currentTeam?.id) {
        await loadTeamHub(state.currentTeam, true);
      } else if (view === 'tournamentView') {
        await loadMatches({ force: true, silent: true });
        renderTournamentHero();
        renderTournamentMatches();
        if ($('tournamentTablePanel')?.classList.contains('active')) await loadTournamentStandings(true);
      } else if (view === 'analysisView' && state.currentCenter?.match?.fixtureId) {
        const fixtureId = Number(state.currentCenter.match.fixtureId);
        const data = await requestMatchCenter(fixtureId, { recovery: Date.now() }, { dedupe: false });
        if (data) renderMatchCenter(data);
      } else if (view === 'historyView') {
        await Promise.allSettled([loadHistory(false),loadAiTrackRecord(false)]);
      } else if (view === 'profileView') {
        await loadProfile();
      } else {
        await api('/api/health', { retry: false, timeoutMs: 6000 });
      }
      // api() itself moves the connection back to online only after a real
      // successful request. Some screen loaders intentionally catch errors to
      // keep stale content visible, so do not overwrite their degraded state here.
      if (state.network.mode === 'online' && !automatic) toast('Данные обновлены');
    } catch (error) {
      noteRequestFailure(error);
      if (!automatic) toast(friendlyErrorMessage(error));
    }
  }
  
  function versionTuple(value) {
    const core = String(value || '').trim().replace(/^v/i, '').split('-')[0];
    const parts = core.split('.').map(x => Number.parseInt(x, 10));
    return [0, 1, 2].map(i => Number.isFinite(parts[i]) ? parts[i] : 0);
  }
  
  function compareVersions(a, b) {
    const av = versionTuple(a), bv = versionTuple(b);
    for (let i = 0; i < 3; i += 1) {
      if (av[i] > bv[i]) return 1;
      if (av[i] < bv[i]) return -1;
    }
    return 0;
  }
  
  function forceFreshReload() {
    const url = new URL(location.href);
    url.searchParams.set('_app_reload', String(Date.now()));
    location.replace(url.toString());
  }
  
  function renderVersionCompatibility() {
    const banner = $('versionBanner');
    const text = $('versionBannerText');
    const button = $('versionReloadBtn');
    if (!banner || !text || !button) return;
  
    banner.classList.toggle('blocking', Boolean(state.compatibilityBlocked));
    banner.hidden = !(state.compatibilityBlocked || state.versionMismatch);
  
    if (state.compatibilityBlocked) {
      text.textContent = 'Приложение нужно обновить, чтобы продолжить.';
      button.textContent = 'Обновить';
      return;
    }
  
    if (state.versionMismatch) {
      text.textContent = 'Доступно обновление приложения. Перезагрузите, чтобы получить последнюю версию.';
      button.textContent = 'Обновить';
      return;
    }
  
    text.textContent = '';
  }
  
  function evaluateCompatibility(manifest = state.appManifest, headerContract = null, headerMinClient = '') {
    const serverContract = Number(headerContract || manifest?.apiContract || 0);
    const minClient = String(headerMinClient || manifest?.minClientVersion || '');
    const recommended = String(manifest?.recommendedClientVersion || manifest?.version || state.serverVersion || '');
  
    let blocked = false;
    let reason = '';
  
    if (serverContract && serverContract !== CLIENT_API_CONTRACT) {
      blocked = true;
      reason = `Нужна новая версия приложения: сервер использует версию обмена данными ${serverContract}, а интерфейс — ${CLIENT_API_CONTRACT}.`;
    } else if (minClient && compareVersions(CLIENT_VERSION, minClient) < 0) {
      blocked = true;
      reason = `Версия интерфейса ${CLIENT_VERSION} устарела. Минимальная совместимая версия — ${minClient}.`;
    }
  
    state.compatibilityBlocked = blocked;
    state.compatibilityReason = reason;
    state.serverVersion = String(manifest?.version || state.serverVersion || '');
    state.versionMismatch = Boolean(!blocked && recommended && recommended !== CLIENT_VERSION);
    renderVersionCompatibility();
    return !blocked;
  }
  
  function observeServerVersion(serverVersion, response = null) {
    state.serverVersion = String(serverVersion || state.serverVersion || '');
    const contract = response ? response.headers.get('x-api-contract') : null;
    const minClient = response ? response.headers.get('x-min-client-version') : '';
    evaluateCompatibility(state.appManifest, contract, minClient);
  }
  
  async function loadAppManifest() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), 6000);
    try {
      const response = await fetch('/api/app-manifest', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const manifest = await response.json().catch(() => null);
      if (!response.ok || !manifest?.version) throw new Error('Манифест приложения недоступен');
      state.appManifest = manifest;
      state.startup.manifestOk = true;
      state.serverVersion = String(manifest.version || '');
      if (manifest.runtime) state.runtimeStatus = manifest.runtime;
      evaluateCompatibility(manifest);
      applyRuntimeUi();
      return manifest;
    } catch (error) {
      state.clientPerf.manifestFailures += 1;
      state.startup.degraded = true;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  
  
  function runtimeAllows(key) {
    const runtime = state.runtimeStatus || state.profile?.features?.runtime || {};
    return runtime?.[key] !== false;
  }
  
  function runtimeDisabledLabels(runtime = state.runtimeStatus || {}) {
    const items = [];
    if (runtime.analysisEnabled === false) items.push('анализ');
    if (runtime.searchEnabled === false) items.push('поиск');
    if (runtime.liveEnabled === false) items.push('обновления матча в реальном времени');
    if (runtime.remindersEnabled === false) items.push('новые уведомления');
    if (runtime.expandedDataEnabled === false) items.push('расширенные данные');
    return items;
  }
  
  function applyRuntimeUi() {
    const runtime = state.runtimeStatus || state.profile?.features?.runtime || null;
    const banner = $('runtimeBanner');
    const icon = $('runtimeBannerIcon');
    const title = $('runtimeBannerTitle');
    const text = $('runtimeBannerText');
  
    if (!runtime) {
      if (banner) banner.hidden = true;
      return;
    }
  
    state.runtimeStatus = runtime;
    const disabled = runtimeDisabledLabels(runtime);
    if (banner && icon && title && text) {
      if (runtime.maintenanceMode) {
        banner.hidden = false;
        banner.className = 'runtime-banner maintenance';
        icon.textContent = '🛠';
        title.textContent = 'Техническое обслуживание';
        text.textContent = runtime.message || 'Часть футбольных функций временно приостановлена.';
      } else if (disabled.length) {
        banner.hidden = false;
        banner.className = 'runtime-banner limited';
        icon.textContent = '⚙️';
        title.textContent = 'Часть функций временно ограничена';
        text.textContent = disabled.join(' · ');
      } else {
        banner.hidden = true;
      }
    }
  
    const searchDisabled = !runtimeAllows('searchEnabled');
  
    if ($('globalSearchBtn')) {
      $('globalSearchBtn').disabled = searchDisabled || Boolean(state.globalSearch.loading);
      $('globalSearchBtn').textContent = state.globalSearch.loading ? 'Ищу…' : 'Найти';
    }
  
    if (!runtimeAllows('liveEnabled')) stopLiveRefresh();
  }
  
  async function loadRuntimeStatus(force = false) {
    try {
      const data = await api(`/api/runtime-status${force ? `?t=${Date.now()}` : ''}`, {
        retry: false,
        dedupe: !force,
        timeoutMs: 7000,
      });
      state.runtimeStatus = data.runtime || state.runtimeStatus;
      applyRuntimeUi();
      return state.runtimeStatus;
    } catch (error) {
      // Manifest may carry a recent safe snapshot, so startup does not fail only
      // because the dedicated runtime endpoint is temporarily unavailable.
      if (!state.runtimeStatus && state.appManifest?.runtime) state.runtimeStatus = state.appManifest.runtime;
      applyRuntimeUi();
      return state.runtimeStatus;
    }
  }
  
  function setBootStatus(title, text = '', progress = null) {
    if ($('bootTitle')) $('bootTitle').textContent = title;
    if ($('bootText')) $('bootText').textContent = text;
    if ($('bootProgressFill') && Number.isFinite(Number(progress))) {
      $('bootProgressFill').style.width = `${Math.max(0, Math.min(100, Number(progress)))}%`;
    }
  }
  
  function hideBootGate() {
    const gate = $('bootGate');
    if (!gate) return;
    gate.classList.add('done');
    state.startup.finishedAt = performance.now();
    state.clientPerf.bootMs = Math.round(state.startup.finishedAt - state.startup.startedAt);
    const navigation = performance.getEntriesByType?.('navigation')?.[0] || null;
    const firstContentfulPaint = (performance.getEntriesByType?.('paint') || [])
      .find(entry => entry?.name === 'first-contentful-paint') || null;
    sendClientTelemetry('boot_ok', {
      bootMs: state.clientPerf.bootMs,
      moduleReadyMs: Math.max(0, Math.round(state.startup.startedAt)),
      navigationReadyMs: Math.max(0, Math.round(state.startup.finishedAt)),
      responseEndMs: Number.isFinite(Number(navigation?.responseEnd)) ? Math.max(0, Math.round(Number(navigation.responseEnd))) : null,
      domContentLoadedMs: Number.isFinite(Number(navigation?.domContentLoadedEventEnd)) ? Math.max(0, Math.round(Number(navigation.domContentLoadedEventEnd))) : null,
      firstContentfulPaintMs: Number.isFinite(Number(firstContentfulPaint?.startTime)) ? Math.max(0, Math.round(Number(firstContentfulPaint.startTime))) : null,
      manifestMs: state.startup.timings.manifestMs,
      identityMs: state.startup.timings.identityMs,
      feedMs: state.startup.timings.feedMs,
      revealDelayMs: state.startup.timings.revealDelayMs,
      viewportWidth: Math.max(0, Math.round(Number(window.innerWidth || 0))),
      manifestOk: state.startup.manifestOk,
      degraded: state.startup.degraded,
      startParam: tg?.initDataUnsafe?.start_param || '',
    }, { once: true });
    setTimeout(() => { gate.hidden = true; gate.classList.remove('done'); }, 220);
  }
  
  function showBootRecovery({ blocking = false, title = '', text = '' } = {}) {
    const gate = $('bootGate');
    if (!gate) return;
    gate.hidden = false;
    gate.classList.toggle('blocking', Boolean(blocking));
    setBootStatus(title || (blocking ? 'Нужно обновить приложение' : 'Не удалось завершить запуск'), text, 100);
    if ($('bootRetryBtn')) $('bootRetryBtn').hidden = Boolean(blocking);
    if ($('bootContinueBtn')) $('bootContinueBtn').hidden = Boolean(blocking);
    if ($('bootReloadBtn')) $('bootReloadBtn').hidden = false;
    sendClientTelemetry(blocking ? 'compatibility_block' : 'boot_recovery', {
      blocking: Boolean(blocking),
      reason: blocking ? 'compatibility' : (state.network.mode || 'startup'),
      manifestOk: state.startup.manifestOk,
      degraded: state.startup.degraded,
    }, { once: true });
  }
  
  async function runStartupSequence() {
    const gate = $('bootGate');
    if (gate) {
      gate.hidden = false;
      gate.classList.remove('blocking', 'done');
    }
    if ($('bootRetryBtn')) $('bootRetryBtn').hidden = true;
    if ($('bootContinueBtn')) $('bootContinueBtn').hidden = true;
    if ($('bootReloadBtn')) $('bootReloadBtn').hidden = true;
  
    setBootStatus('MatchRadar', 'Загружаем матчи…', 12);
    let phaseStartedAt = performance.now();
    const manifest = await loadAppManifest();
    state.startup.timings.manifestMs = Math.max(0, Math.round(performance.now() - phaseStartedAt));
  
    if (state.compatibilityBlocked) {
      showBootRecovery({
        blocking: true,
        title: 'Нужно обновить приложение',
        text: 'Обновите приложение и откройте его снова.',
      });
      return false;
    }
  
    setBootStatus('MatchRadar', 'Загружаем матчи…', 38);
  
    // Runtime and identity are independent, but personal/feed reads must stay
    // behind the access decision. This removes one network waterfall without
    // weakening the strict-beta authorization boundary.
    phaseStartedAt = performance.now();
    await Promise.allSettled([
      loadRuntimeStatus(false),
      loadProfile().catch(()=>null),
    ]);
    state.startup.timings.identityMs = Math.max(0, Math.round(performance.now() - phaseStartedAt));
  
    if (state.closedBetaBlocked) return false;
    renderProfile();
    applyRuntimeUi();
    const admin=isAdmin();
    if ($('profileBtn')) $('profileBtn').hidden=false;
    if ($('navProfile')) $('navProfile').hidden=false;
    if ($('navMatches')) $('navMatches').hidden=false;
  
    phaseStartedAt = performance.now();
    const startupTasks = [loadFavorites(), loadMatches({ snapshotFastPath:true })];
    await Promise.allSettled(startupTasks);
    state.startup.timings.feedMs = Math.max(0, Math.round(performance.now() - phaseStartedAt));
    void loadFavoritePlayers();
  
    const usable = Boolean(state.profile || admin || navigator.onLine !== false);
    if (!usable && navigator.onLine === false) {
      showBootRecovery({
        blocking: false,
        title: 'Нет подключения к интернету',
        text: 'Подключитесь к сети и повторите запуск. Если сохранённые матчи появятся, можно продолжить в приложении.',
      });
      return false;
    }
  
    applyLaunchIntent();
    if (!hasDirectLaunchIntent()) showView('matchesView');
    sendProductAction('open', 'matchesView');
    setBootStatus('MatchRadar', 'Загружаем матчи…', 100);
    phaseStartedAt = performance.now();
    await new Promise(resolve => setTimeout(resolve, 120));
    state.startup.timings.revealDelayMs = Math.max(0, Math.round(performance.now() - phaseStartedAt));
    hideBootGate();
  
    scheduleIdle(async () => {
      const tasks = [loadHistory(false)];
      if (isAdmin()) {
        tasks.push(loadProvider());
        if (!state.remindersLoaded) tasks.push(loadReminders());
      }
      await Promise.allSettled(tasks);
    });
    return true;
  }
  
  
  const api = createApiClient({ state, tg, inflightGetRequests, observeServerVersion, showBootRecovery, applyRuntimeUi, normalizeApiError, noteRequestSuccess, noteRequestFailure });
  
  async function ensureMatchCenterController() {
    if (matchCenterController) return matchCenterController;
    if (!matchCenterControllerPromise) {
      matchCenterControllerPromise = import('./modules/match-center-controller.js')
        .then(({ createMatchCenterController }) => {
          matchCenterController = createMatchCenterController({
            state,
            documentRef: document,
            elementById: $,
            activeViewId,
            showView,
            api,
            runtimeAllows,
            ensureMatchCenterExtras,
            renderMatchCenter,
            renderJourneyState,
            sendProductAction,
            sendMatchDataCoverage,
            sendOperationTiming,
            sendActionError,
            apiErrorCategory,
            friendlyErrorMessage,
            toast,
            performanceNow: () => performance.now(),
          });
          return matchCenterController;
        })
        .catch(error => {
          matchCenterControllerPromise = null;
          throw error;
        });
    }
    return matchCenterControllerPromise;
  }
  
  async function ensureAnalysisController() {
    if (analysisController) return analysisController;
    if (!analysisControllerPromise) {
      analysisControllerPromise = import('./modules/analysis-controller.js')
        .then(({ createAnalysisController }) => {
          analysisController = createAnalysisController({
            state,
            documentRef: document,
            activeViewId,
            showView,
            api,
            runtimeAllows,
            stopLiveRefresh,
            hideQuotaPaywall,
            showQuotaPaywallForFixture,
            syncAnalysisBusyUi,
            renderJourneyState,
            renderAnalysis,
            renderMatchCenter,
            rememberHistoryAnalysis,
            renderProfile,
            renderProvider,
            renderDiscoveryHome,
            renderGlobalSearch,
            loadHistory,
            loadReminders,
            loadFavorites,
            buildAnalysisAccessUsage,
            refreshPassAccess: fixtureId => billingModule?.loadPassAccess({ fixtureId, force: true }),
            isAdmin,
            sendProductAction,
            sendOperationTiming,
            sendActionError,
            apiErrorCategory,
            toast,
            performanceNow: () => performance.now(),
          });
          return analysisController;
        })
        .catch(error => {
          analysisControllerPromise = null;
          throw error;
        });
    }
    return analysisControllerPromise;
  }
  
  const playerFollowModule = createPlayerFollowModule({
    state,
    api,
    toast,
    onChange: () => {
      if (state.currentPlayer) renderPlayerHub(state.currentPlayer);
      if (state.profile) renderProfile();
    },
  });
  const { loadFavoritePlayers } = playerFollowModule;
  
  let digestSettingsModule = null;
  let digestSettingsModulePromise = null;
  async function ensureDigestSettingsModule() {
    if (digestSettingsModule) return digestSettingsModule;
    if (!digestSettingsModulePromise) {
      digestSettingsModulePromise = import('./modules/digest-settings.js').then(({ createDigestSettingsModule }) => {
        digestSettingsModule = createDigestSettingsModule({
          elementById: $,
          api,
          escapeHtml,
          planLabel,
          toast,
        });
        return digestSettingsModule;
      }).catch(error => {
        digestSettingsModulePromise = null;
        throw error;
      });
    }
    return digestSettingsModulePromise;
  }
  function renderDigestSettings() {
    return digestSettingsModule?.renderDigestSettings();
  }
  async function loadDigestSettings(...args) {
    const module = await ensureDigestSettingsModule();
    return module?.loadDigestSettings(...args);
  }
  
  let smartNotificationsModule = null;
  let smartNotificationsModulePromise = null;
  async function ensureSmartNotificationsModule() {
    if (smartNotificationsModule) return smartNotificationsModule;
    if (!smartNotificationsModulePromise) {
      smartNotificationsModulePromise = import('./modules/smart-notifications.js').then(({ createSmartNotificationsModule }) => {
        smartNotificationsModule = createSmartNotificationsModule({
          elementById: $,
          api,
          escapeHtml,
          toast,
        });
        return smartNotificationsModule;
      }).catch(error => {
        smartNotificationsModulePromise = null;
        throw error;
      });
    }
    return smartNotificationsModulePromise;
  }
  function renderSmartNotifications() {
    return smartNotificationsModule?.render();
  }
  async function loadSmartNotifications(...args) {
    const module = await ensureSmartNotificationsModule();
    return module?.load(...args);
  }
  
  let matchCenterExtras = null;
  let matchCenterExtrasPromise = null;
  async function ensureMatchCenterExtras() {
    if (matchCenterExtras) return matchCenterExtras;
    if (!matchCenterExtrasPromise) {
      matchCenterExtrasPromise = Promise.all([
        import('./modules/match-pulse.js'),
        import('./modules/ai-timeline.js'),
      ]).then(([pulse, timeline]) => {
        matchCenterExtras = Object.freeze({
          renderMatchPulse: pulse.renderMatchPulse,
          renderAiTimelineCompact: timeline.renderAiTimelineCompact,
          renderAiTimelineDetails: timeline.renderAiTimelineDetails,
        });
        return matchCenterExtras;
      }).catch(error => {
        matchCenterExtrasPromise = null;
        throw error;
      });
    }
    return matchCenterExtrasPromise;
  }

  return {
    syncBootVersion,
    stopLiveRefresh,
    deactivateLiveRefresh,
    suspendLiveRefresh,
    resumeLiveRefresh,
    viewBackTarget,
    toast,
    apiErrorCategory,
    friendlyErrorMessage,
    normalizeApiError,
    telemetryViewName,
    sendClientTelemetry,
    sendProductAction,
    sendActionError,
    sendOperationTiming,
    sendMatchDataCoverage,
    setNetworkMode,
    noteRequestSuccess,
    noteRequestFailure,
    recoveryCardHtml,
    bindCooldownRetry,
    recoverActiveView,
    versionTuple,
    compareVersions,
    forceFreshReload,
    renderVersionCompatibility,
    evaluateCompatibility,
    observeServerVersion,
    loadAppManifest,
    runtimeAllows,
    runtimeDisabledLabels,
    applyRuntimeUi,
    loadRuntimeStatus,
    setBootStatus,
    hideBootGate,
    showBootRecovery,
    runStartupSequence,
    ensureMatchCenterController,
    ensureAnalysisController,
    ensureDigestSettingsModule,
    renderDigestSettings,
    loadDigestSettings,
    ensureSmartNotificationsModule,
    renderSmartNotifications,
    loadSmartNotifications,
    ensureMatchCenterExtras,
  };
}
