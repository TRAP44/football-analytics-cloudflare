export function createAdminBootstrapModule(deps = {}) {
  const {
    CLIENT_API_CONTRACT,
    CLIENT_RELEASE_CHANNEL,
    CLIENT_VERSION,
    SUPABASE_SCHEMA_HINT,
    activeViewId,
    adminCalibrationControlModule,
    adminCalibrationControlModulePromise,
    adminDiagnosticsModule,
    adminDiagnosticsModulePromise,
    adminLaunchFunnelModule,
    adminLaunchFunnelModulePromise,
    adminMediaPublisherModule,
    adminMediaPublisherModulePromise,
    adminModelQualityModule,
    adminModelQualityModulePromise,
    adminModelRemediationModule,
    adminModelRemediationModulePromise,
    adminProductionReadinessModule,
    adminProductionReadinessModulePromise,
    adminProviderModule,
    adminProviderModulePromise,
    adminRcRegressionModule,
    adminRcRegressionModulePromise,
    adminReleaseMonitorModule,
    adminReleaseMonitorModulePromise,
    adminReleaseReadinessModule,
    adminReleaseReadinessModulePromise,
    adminReminderHealthModule,
    adminReminderHealthModulePromise,
    adminRuntimeControlsModule,
    adminRuntimeControlsModulePromise,
    api,
    applyRuntimeUi,
    billingModule,
    billingModulePromise,
    dateTime,
    digestSettingsModule,
    ensureDigestSettingsModule,
    ensureSmartNotificationsModule,
    escapeHtml,
    freshnessSourceLabel,
    humanizeTechnicalText,
    isAdmin,
    loadAdminBillingRefund,
    loadDigestSettings,
    loadFavoritePlayers,
    loadProfile,
    loadSmartNotifications,
    planLabel,
    relativeAge,
    renderAdminOverview,
    renderAnalysis,
    renderDiscoveryHome,
    renderFavoriteTeams,
    renderMatches,
    renderMyTeams,
    renderProfile,
    renderProfileAccessState,
    renderRadarFeed,
    renderReminderList,
    renderTournamentMatches,
    russianCountLabel,
    sendActionError,
    sendProductAction,
    showView,
    smartNotificationsModule,
    state,
    syncAllQuickReminderButtons,
    syncFilterButtons,
    syncReminderMutationUi,
    technicalStateLabel,
    tg,
    toast,
  } = deps;

  function outcomeShortLabel(key) {
    return key === 'home' ? 'П1' : key === 'away' ? 'П2' : key === 'draw' ? 'Н' : '—';
  }
  
  let adminModelQualityModule = null;
  let adminModelQualityModulePromise = null;
  async function ensureAdminModelQualityModule() {
    if (!isAdmin()) return null;
    if (adminModelQualityModule) return adminModelQualityModule;
    if (!adminModelQualityModulePromise) {
      adminModelQualityModulePromise = import('./modules/admin-model-quality.js').then(({ createAdminModelQualityModule }) => {
        adminModelQualityModule = createAdminModelQualityModule({
          state,
          elementById: $,
          isAdmin,
          escapeHtml,
          humanizeTechnicalText,
          technicalStateLabel,
          russianCountLabel,
          dateTime,
          outcomeShortLabel,
          api,
        });
        return adminModelQualityModule;
      });
    }
    return adminModelQualityModulePromise;
  }
  
  function renderModelQuality() {
    if (adminModelQualityModule) return adminModelQualityModule.renderModelQuality();
    void ensureAdminModelQualityModule().then(module => module?.renderModelQuality());
  }
  
  async function loadModelQuality(...args) {
    const module = await ensureAdminModelQualityModule();
    return module?.loadModelQuality(...args);
  }
  
  let adminCalibrationControlModule = null;
  let adminCalibrationControlModulePromise = null;
  async function ensureAdminCalibrationControlModule() {
    if (!isAdmin()) return null;
    if (adminCalibrationControlModule) return adminCalibrationControlModule;
    if (!adminCalibrationControlModulePromise) {
      adminCalibrationControlModulePromise = import('./modules/admin-calibration-control.js').then(({ createAdminCalibrationControlModule }) => {
        adminCalibrationControlModule = createAdminCalibrationControlModule({
          state,
          elementById: $,
          isAdmin,
          escapeHtml,
          humanizeTechnicalText,
          relativeAge,
          api,
          toast,
          confirmAction: message => window.confirm(message),
          refreshModelQuality: (...args) => loadModelQuality(...args),
        });
        return adminCalibrationControlModule;
      });
    }
    return adminCalibrationControlModulePromise;
  }
  
  function renderCalibrationControl() {
    if (adminCalibrationControlModule) return adminCalibrationControlModule.renderCalibrationControl();
    void ensureAdminCalibrationControlModule().then(module => module?.renderCalibrationControl());
  }
  
  async function loadCalibrationControl(...args) {
    const module = await ensureAdminCalibrationControlModule();
    return module?.loadCalibrationControl(...args);
  }
  
  async function runCalibrationControlAction(...args) {
    const module = await ensureAdminCalibrationControlModule();
    return module?.runCalibrationControlAction(...args);
  }
  
  let adminModelRemediationModule = null;
  let adminModelRemediationModulePromise = null;
  async function ensureAdminModelRemediationModule() {
    if (!isAdmin()) return null;
    if (adminModelRemediationModule) return adminModelRemediationModule;
    if (!adminModelRemediationModulePromise) {
      adminModelRemediationModulePromise = import('./modules/admin-model-remediation.js').then(({ createAdminModelRemediationModule }) => {
        adminModelRemediationModule = createAdminModelRemediationModule({
          state,
          elementById: $,
          isAdmin,
          SUPABASE_SCHEMA_HINT,
          escapeHtml,
          dateTime,
          outcomeShortLabel,
          humanizeTechnicalText,
          api,
          toast,
          confirmAction: message => window.confirm(message),
          loadModelQuality,
        });
        return adminModelRemediationModule;
      });
    }
    return adminModelRemediationModulePromise;
  }
  
  function renderModelRemediation() {
    if (adminModelRemediationModule) return adminModelRemediationModule.renderModelRemediation();
    void ensureAdminModelRemediationModule().then(module => module?.renderModelRemediation());
  }
  
  async function loadModelRemediation(...args) {
    const module = await ensureAdminModelRemediationModule();
    return module?.loadModelRemediation(...args);
  }
  
  async function runModelRemediation(...args) {
    const module = await ensureAdminModelRemediationModule();
    return module?.runModelRemediation(...args);
  }
  
  async function resolveSettlementDriftFromUi(...args) {
    const module = await ensureAdminModelRemediationModule();
    return module?.resolveSettlementDriftFromUi(...args);
  }
  
  async function resetSettlementCircuitFromUi(...args) {
    const module = await ensureAdminModelRemediationModule();
    return module?.resetSettlementCircuitFromUi(...args);
  }
  
  async function openProfileView() {
    showView('profileView');
    sendProductAction('profile_open', 'profileView');
    if (!state.profile) {
      renderProfileAccessState('loading');
      await loadProfile();
    }
    if (!state.profile) {
      renderProfileAccessState('error', state.profileLoadError || 'Не удалось загрузить профиль. Проверьте соединение и повторите.');
      return;
    }
    renderProfileAccessState('ready');
    try {
      await Promise.all([
        ensureBillingModule(),
        ensureDigestSettingsModule(),
        ensureSmartNotificationsModule(),
      ]);
    } catch (error) {
      sendActionError('profile_modules', error, 'profileView');
      renderProfileAccessState('error', 'Не удалось загрузить дополнительные модули профиля. Повторите открытие профиля.');
      return;
    }
    renderProfile();
    const lastFixture = Number(state.currentCenter?.match?.fixtureId || state.currentAnalysis?.match?.fixtureId || 0);
    if (lastFixture && $('providerAuditFixtureId') && !$('providerAuditFixtureId').value) $('providerAuditFixtureId').value = String(lastFixture);
    const essentials = [];
    const billingState = billingModule.snapshot();
    if (!billingState.loaded || !billingState.passLoaded) essentials.push(loadBilling());
    if (!state.favoritesLoaded) essentials.push(loadFavorites());
    if (!state.favoritePlayersLoaded) essentials.push(loadFavoritePlayers());
    if (!state.remindersLoaded) essentials.push(loadReminders());
    if (!digestSettingsModule.loaded) essentials.push(loadDigestSettings());
    if (!smartNotificationsModule.snapshot().loaded) essentials.push(loadSmartNotifications());
    if (isAdmin()) {
      if (!state.providerLoaded) essentials.push(loadProvider());
      essentials.push(loadRuntimeControlsAdmin(false));
      essentials.push(loadDiagnostics(false));
      essentials.push(loadReminderHealth(false));
      essentials.push(loadAdminBillingRefund(false));
    }
    await Promise.allSettled(essentials);
    if (isAdmin()) renderAdminOverview();
  }
  
  
  let adminReleaseReadinessModule = null;
  let adminReleaseReadinessModulePromise = null;
  async function ensureAdminReleaseReadinessModule() {
    if (!isAdmin()) return null;
    if (adminReleaseReadinessModule) return adminReleaseReadinessModule;
    if (!adminReleaseReadinessModulePromise) {
      adminReleaseReadinessModulePromise = import('./modules/admin-release-readiness.js').then(({ createAdminReleaseReadinessModule }) => {
        adminReleaseReadinessModule = createAdminReleaseReadinessModule({
          state,
          elementById: $,
          isAdmin,
          escapeHtml,
          humanizeTechnicalText,
          relativeAge,
          api,
          renderProvider,
          renderDiagnostics,
        });
        return adminReleaseReadinessModule;
      });
    }
    return adminReleaseReadinessModulePromise;
  }
  
  function renderReleaseReadiness() {
    if (adminReleaseReadinessModule) return adminReleaseReadinessModule.renderReleaseReadiness();
    void ensureAdminReleaseReadinessModule().then(module => module?.renderReleaseReadiness());
  }
  
  async function loadReleaseReadiness(...args) {
    const module = await ensureAdminReleaseReadinessModule();
    return module?.loadReleaseReadiness(...args);
  }
  
  
  function diagPct(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  }
  
  function diagDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return '—';
    if (value < 60) return `${Math.floor(value)} сек`;
    if (value < 3600) return `${Math.floor(value / 60)} мин`;
    return `${Math.floor(value / 3600)} ч ${Math.floor((value % 3600) / 60)} мин`;
  }
  
  function diagnosticsStateLabel(stateValue) {
    const map = { ok: 'Норма', warning: 'Предупреждение', critical: 'Проблема', waiting: 'Ожидание' };
    return map[String(stateValue || '')] || 'Неизвестно';
  }
  
  
  let adminProductionReadinessModule = null;
  let adminProductionReadinessModulePromise = null;
  async function ensureAdminProductionReadinessModule() {
    if (!isAdmin()) return null;
    if (adminProductionReadinessModule) return adminProductionReadinessModule;
    if (!adminProductionReadinessModulePromise) {
      adminProductionReadinessModulePromise = import('./modules/admin-production-readiness.js').then(({ createAdminProductionReadinessModule }) => {
        adminProductionReadinessModule = createAdminProductionReadinessModule({
          state,
          elementById: $,
          isAdmin,
          escapeHtml,
          humanizeTechnicalText,
          api,
        });
        return adminProductionReadinessModule;
      });
    }
    return adminProductionReadinessModulePromise;
  }
  
  function renderProductionReadiness() {
    if (adminProductionReadinessModule) return adminProductionReadinessModule.renderProductionReadiness();
    void ensureAdminProductionReadinessModule().then(module => module?.renderProductionReadiness());
  }
  
  async function loadProductionReadiness(...args) {
    const module = await ensureAdminProductionReadinessModule();
    return module?.loadProductionReadiness(...args);
  }
  
  function runClientContractSmoke() {
    const checks = [];
    const add = (id, label, pass, detail) => checks.push({ id, label, pass: Boolean(pass), detail: String(detail || '') });
  
    const surface = document.querySelector('meta[name="matchradar-surface"]')?.content || 'public';
    const requiredIds = [
      'matchesView','searchView','myTeamsView','tournamentView','teamView','playerView','analysisView','historyView','profileView',
      'navMatches','navMyTeams','navHistory','navProfile','aiTrackRecord','playerHub',
      'connectionBanner','connectionRetryBtn','toast',
      ...(surface === 'admin' ? [
        'modelQualityStatus','modelRemediationStatus','modelRemediationDryRunBtn','modelRemediationRunBtn','modelRemediationCircuitResetBtn','modelRemediationDriftQueue',
        'providerAuditStatus','releaseStatus','productionReadinessStatus','diagnosticsStatus','mediaPublisherFixtureId','mediaPublisherGenerateBtn','mediaPublisherResult',
      ] : []),
    ];
    const missing = requiredIds.filter(id => !$(id));
    add('required_dom', 'Основные элементы интерфейса', missing.length === 0, missing.length ? `Нет: ${missing.join(', ')}` : `${requiredIds.length}/${requiredIds.length} элементов.`);
  
    const allIds = [...document.querySelectorAll('[id]')].map(el => el.id);
    const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    add('unique_ids', 'Уникальные идентификаторы элементов', duplicates.length === 0, duplicates.length ? `Дубликаты: ${[...new Set(duplicates)].join(', ')}` : `${allIds.length} идентификаторов без дублей.`);
  
    const adminSections = [...document.querySelectorAll('[data-admin-only]')];
    add('admin_sections', 'Разметка интерфейса администратора', adminSections.length >= 6, `${adminSections.length} технических секций доступны только администратору.`);
  
    const assetVersion = CLIENT_VERSION.split('-')[0];
    const cssLink = document.querySelector(`link[href*="styles.css?v=${assetVersion}"]`);
    const appScript = document.querySelector(`script[src*="app.js?v=${assetVersion}"]`);
    add('cache_bust', 'Версии файлов интерфейса', Boolean(cssLink && appScript), `Стили: ${cssLink ? 'найдены' : 'не найдены'} · скрипт: ${appScript ? 'найден' : 'не найден'}.`);
  
    const versionCoherent = CLIENT_VERSION.endsWith(`-${CLIENT_RELEASE_CHANNEL}`);
    add('client_version', 'Согласованность версии клиента', versionCoherent, CLIENT_VERSION);
    add('telegram_sdk', 'Модуль Telegram Mini App', Boolean(window.Telegram?.WebApp), window.Telegram?.WebApp ? 'Модуль доступен.' : 'В обычном браузере модуль может отсутствовать; внутри Telegram он должен быть доступен.');
  
    const navButtons = ['navMatches','navMyTeams','navHistory','navProfile'].filter(id => $(id));
    add('navigation', 'Нижняя навигация', navButtons.length === 4, `${navButtons.length}/4 кнопки.`);
  
    const recoveryIds = ['connectionBannerIcon','connectionBannerTitle','connectionBannerText','connectionRetryBtn'];
    add('recovery_contract', 'Контракт восстановления интерфейса', recoveryIds.every(id => $(id)), `${recoveryIds.filter(id => $(id)).length}/${recoveryIds.length} элементов.`);
  
    const bootIds = ['bootGate','bootTitle','bootText','bootProgressFill','bootReloadBtn','versionBanner','versionReloadBtn'];
    add('startup_contract', 'Проверка запуска и восстановления', bootIds.every(id => $(id)), `${bootIds.filter(id => $(id)).length}/${bootIds.length} элементов.`);
    const runtimeIds = ['runtimeBanner','runtimeBannerTitle','runtimeBannerText','runtimeControlsStatus','runtimeSaveBtn','runtimeHistoryList','runtimeChangeReason','runtimeAutoSettlementRecoveryToggle'];
    add('runtime_controls_contract', 'Проверка управления функциями и отката', runtimeIds.every(id => $(id)), `${runtimeIds.filter(id => $(id)).length}/${runtimeIds.length} элементов.`);
    add('api_contract', 'Контракт обмена данными', CLIENT_API_CONTRACT === 5, `версия ${CLIENT_API_CONTRACT} · канал ${CLIENT_RELEASE_CHANNEL}`);
  
    return {
      version: CLIENT_VERSION,
      generatedAt: new Date().toISOString(),
      total: checks.length,
      passed: checks.filter(x => x.pass).length,
      failed: checks.filter(x => !x.pass).length,
      checks,
    };
  }
  
  let adminRcRegressionModule = null;
  let adminRcRegressionModulePromise = null;
  async function ensureAdminRcRegressionModule() {
    if (!isAdmin()) return null;
    if (adminRcRegressionModule) return adminRcRegressionModule;
    if (!adminRcRegressionModulePromise) {
      adminRcRegressionModulePromise = import('./modules/admin-rc-regression.js').then(({ createAdminRcRegressionModule }) => {
        adminRcRegressionModule = createAdminRcRegressionModule({
          state,
          elementById: $,
          isAdmin,
          runClientContractSmoke,
          relativeAge,
          escapeHtml,
          humanizeTechnicalText,
          api,
          toast,
        });
        return adminRcRegressionModule;
      });
    }
    return adminRcRegressionModulePromise;
  }
  
  function renderRcRegression() {
    if (adminRcRegressionModule) return adminRcRegressionModule.renderRcRegression();
    void ensureAdminRcRegressionModule().then(module => module?.renderRcRegression());
  }
  
  async function loadRcRegression(...args) {
    const module = await ensureAdminRcRegressionModule();
    return module?.loadRcRegression(...args);
  }
  
  let adminRuntimeControlsModule = null;
  let adminRuntimeControlsModulePromise = null;
  async function ensureAdminRuntimeControlsModule() {
    if (!isAdmin()) return null;
    if (adminRuntimeControlsModule) return adminRuntimeControlsModule;
    if (!adminRuntimeControlsModulePromise) {
      adminRuntimeControlsModulePromise = import('./modules/admin-runtime-controls.js').then(({ createAdminRuntimeControlsModule }) => {
        adminRuntimeControlsModule = createAdminRuntimeControlsModule({
          state, $, isAdmin, api, applyRuntimeUi, toast, renderAdminOverview,
          escapeHtml, dateTime, humanizeTechnicalText, relativeAge, SUPABASE_SCHEMA_HINT,
        });
        return adminRuntimeControlsModule;
      });
    }
    return adminRuntimeControlsModulePromise;
  }
  function renderRuntimeControls() {
    if (adminRuntimeControlsModule) return adminRuntimeControlsModule.renderRuntimeControls();
    void ensureAdminRuntimeControlsModule().then(module => module?.renderRuntimeControls());
  }
  async function loadRuntimeControlsAdmin(...args) {
    const module = await ensureAdminRuntimeControlsModule();
    return module?.loadRuntimeControlsAdmin(...args);
  }
  async function saveRuntimeControls(...args) {
    const module = await ensureAdminRuntimeControlsModule();
    return module?.saveRuntimeControls(...args);
  }
  async function restoreRuntimeDefaults(...args) {
    const module = await ensureAdminRuntimeControlsModule();
    return module?.restoreRuntimeDefaults(...args);
  }
  
  let adminReminderHealthModule = null;
  let adminReminderHealthModulePromise = null;
  async function ensureAdminReminderHealthModule() {
    if (!isAdmin()) return null;
    if (adminReminderHealthModule) return adminReminderHealthModule;
    if (!adminReminderHealthModulePromise) {
      adminReminderHealthModulePromise = import('./modules/admin-reminder-health.js').then(({ createAdminReminderHealthModule }) => {
        adminReminderHealthModule = createAdminReminderHealthModule({
          state, $, isAdmin, SUPABASE_SCHEMA_HINT, escapeHtml, dateTime,
          technicalStateLabel, humanizeTechnicalText, api, toast,
        });
        return adminReminderHealthModule;
      });
    }
    return adminReminderHealthModulePromise;
  }
  function renderReminderHealth() {
    if (adminReminderHealthModule) return adminReminderHealthModule.renderReminderHealth();
    void ensureAdminReminderHealthModule().then(module => module?.renderReminderHealth());
  }
  async function loadReminderHealth(...args) {
    const module = await ensureAdminReminderHealthModule();
    const result = await module?.loadReminderHealth(...args);
    renderAdminOverview();
    return result;
  }
  async function sendReminderTest(...args) {
    const module = await ensureAdminReminderHealthModule();
    return module?.sendReminderTest(...args);
  }
  
  let adminReleaseMonitorModule = null;
  let adminReleaseMonitorModulePromise = null;
  async function ensureAdminReleaseMonitorModule() {
    if (!isAdmin()) return null;
    if (adminReleaseMonitorModule) return adminReleaseMonitorModule;
    if (!adminReleaseMonitorModulePromise) {
      adminReleaseMonitorModulePromise = import('./modules/admin-release-monitor.js').then(({ createAdminReleaseMonitorModule }) => {
        adminReleaseMonitorModule = createAdminReleaseMonitorModule({
          state, $, isAdmin, escapeHtml, relativeAge, humanizeTechnicalText,
          dateTime, toast, api,
        });
        return adminReleaseMonitorModule;
      });
    }
    return adminReleaseMonitorModulePromise;
  }
  function renderReleaseMonitor() {
    if (adminReleaseMonitorModule) return adminReleaseMonitorModule.renderReleaseMonitor();
    void ensureAdminReleaseMonitorModule().then(module => module?.renderReleaseMonitor());
  }
  async function loadReleaseMonitor(...args) {
    const module = await ensureAdminReleaseMonitorModule();
    return module?.loadReleaseMonitor(...args);
  }
  async function transitionPostDeployRegressionResponse(...args) {
    const module = await ensureAdminReleaseMonitorModule();
    return module?.transitionPostDeployRegressionResponse(...args);
  }
  
  let adminMediaPublisherModule = null;
  let adminMediaPublisherModulePromise = null;
  async function ensureAdminMediaPublisherModule() {
    if (!isAdmin()) return null;
    if (adminMediaPublisherModule) return adminMediaPublisherModule;
    if (!adminMediaPublisherModulePromise) {
      adminMediaPublisherModulePromise = import('./modules/admin-media-publisher.js').then(({ createAdminMediaPublisherModule }) => {
        adminMediaPublisherModule = createAdminMediaPublisherModule({
          $, isAdmin, toast, api, escapeHtml, tg,
        });
        return adminMediaPublisherModule;
      });
    }
    return adminMediaPublisherModulePromise;
  }
  async function generateMediaPublisherLink(...args) {
    const module = await ensureAdminMediaPublisherModule();
    return module?.generateMediaPublisherLink(...args);
  }
  async function copyMediaPublisherPost(...args) {
    const module = await ensureAdminMediaPublisherModule();
    return module?.copyMediaPublisherPost(...args);
  }
  
  let adminLaunchFunnelModule = null;
  let adminLaunchFunnelModulePromise = null;
  async function ensureAdminLaunchFunnelModule() {
    if (!isAdmin()) return null;
    if (adminLaunchFunnelModule) return adminLaunchFunnelModule;
    if (!adminLaunchFunnelModulePromise) {
      adminLaunchFunnelModulePromise = import('./modules/admin-launch-funnel.js').then(({ createAdminLaunchFunnelModule }) => {
        adminLaunchFunnelModule = createAdminLaunchFunnelModule({
          state, $, isAdmin, escapeHtml, api, toast, dateTime,
        });
        return adminLaunchFunnelModule;
      });
    }
    return adminLaunchFunnelModulePromise;
  }
  function renderLaunchFunnel() {
    if (adminLaunchFunnelModule) return adminLaunchFunnelModule.renderLaunchFunnel();
    void ensureAdminLaunchFunnelModule().then(module => module?.renderLaunchFunnel());
  }
  async function acknowledgeRecoveryIncident(...args) {
    const module = await ensureAdminLaunchFunnelModule();
    return module?.acknowledgeRecoveryIncident(...args);
  }
  async function loadLaunchFunnel(...args) {
    const module = await ensureAdminLaunchFunnelModule();
    return module?.loadLaunchFunnel(...args);
  }
  
  let adminDiagnosticsModule = null;
  let adminDiagnosticsModulePromise = null;
  async function ensureAdminDiagnosticsModule() {
    if (!isAdmin()) return null;
    if (adminDiagnosticsModule) return adminDiagnosticsModule;
    if (!adminDiagnosticsModulePromise) {
      adminDiagnosticsModulePromise = import('./modules/admin-diagnostics.js').then(({ createAdminDiagnosticsModule }) => {
        adminDiagnosticsModule = createAdminDiagnosticsModule({
          state, $, isAdmin, api, renderProvider,
          diagnosticsStateLabel, relativeAge, escapeHtml, technicalStateLabel,
          planLabel, diagPct, humanizeTechnicalText, dateTime, diagDuration,
          CLIENT_VERSION, CLIENT_API_CONTRACT, CLIENT_RELEASE_CHANNEL, SUPABASE_SCHEMA_HINT,
        });
        return adminDiagnosticsModule;
      });
    }
    return adminDiagnosticsModulePromise;
  }
  function renderDiagnostics() {
    if (adminDiagnosticsModule) return adminDiagnosticsModule.renderDiagnostics();
    void ensureAdminDiagnosticsModule().then(module => module?.renderDiagnostics());
  }
  async function loadDiagnostics(...args) {
    const module = await ensureAdminDiagnosticsModule();
    const result = await module?.loadDiagnostics(...args);
    renderAdminOverview();
    return result;
  }
  
  function openActivePassMatches(passType = 'DAY_PASS') {
    const label = String(passType || '').toUpperCase() === 'WEEKEND_PASS' ? 'Weekend Pass' : 'Day Pass';
    showView('matchesView');
    renderMatches();
    requestAnimationFrame(() => {
      const action = document.querySelector('.match-card.is-upcoming .analyze-btn[data-fixture]');
      if (action) {
        action.scrollIntoView({ block:'center', behavior:'smooth' });
        action.focus();
        toast(label + ' активен. Выберите будущий матч и нажмите «Разобрать матч».');
        return;
      }
      toast(label + ' активен, но сейчас нет будущих матчей для разбора.');
    });
  }
  
  let billingModule = null;
  let billingModulePromise = null;
  async function ensureBillingModule() {
    if (billingModule) return billingModule;
    if (!billingModulePromise) {
      billingModulePromise = import('./modules/billing.js').then(({ createBillingModule }) => {
        billingModule = createBillingModule({
          state,
          elementById: $,
          api,
          toast,
          telegram: tg,
          dateTime,
          reloadProfile: () => loadProfile(),
          openProfile: () => openProfileView(),
          openPassMatches: passType => openActivePassMatches(passType),
        });
        billingModule.bind();
        return billingModule;
      }).catch(error => {
        billingModulePromise = null;
        throw error;
      });
    }
    return billingModulePromise;
  }
  function renderBilling() {
    return billingModule?.render();
  }
  async function loadBilling(...args) {
    const module = await ensureBillingModule();
    return module?.load(...args);
  }
  function showQuotaPaywall(fixtureId = 0) {
    if (billingModule) return billingModule.showQuotaPaywall(fixtureId);
    void ensureBillingModule()
      .then(module => module?.showQuotaPaywall(fixtureId))
      .catch(error => {
        sendActionError('billing_ui', error, activeViewId());
        toast('Не удалось открыть варианты доступа. Повторите попытку.');
      });
  }
  function showQuotaPaywallForFixture(fixtureId = 0) {
    return showQuotaPaywall(fixtureId);
  }
  function hideQuotaPaywall() {
    if (billingModule) return billingModule.hideQuotaPaywall();
    const panel = $('analysisQuotaPaywall');
    if (panel) panel.hidden = true;
  }
  async function openPassStoreForFixture(fixtureId = 0) {
    try {
      const module = await ensureBillingModule();
      return await module?.openPassStoreForFixture(fixtureId);
    } catch (error) {
      sendActionError('billing_ui', error, activeViewId());
      toast('Не удалось открыть Match Pass. Повторите попытку.');
    }
  }
  
  let adminProviderModule = null;
  let adminProviderModulePromise = null;
  async function ensureAdminProviderModule() {
    if (!isAdmin()) return null;
    if (adminProviderModule) return adminProviderModule;
    if (!adminProviderModulePromise) {
      adminProviderModulePromise = import('./modules/admin-provider.js').then(({ createAdminProviderModule }) => {
        adminProviderModule = createAdminProviderModule({
          state, $, isAdmin, humanizeTechnicalText, escapeHtml, planLabel, dateTime,
          technicalStateLabel, freshnessSourceLabel, toast, api, renderAdminOverview,
        });
        return adminProviderModule;
      });
    }
    return adminProviderModulePromise;
  }
  function renderProvider() { adminProviderModule?.renderProvider(); }
  function renderProviderAudit() { adminProviderModule?.renderProviderAudit(); }
  function renderExpandedDataReleaseGate() { adminProviderModule?.renderExpandedDataReleaseGate(); }
  async function loadProvider(...args) { const m = await ensureAdminProviderModule(); return m?.loadProvider(...args); }
  async function probeProvider(...args) { const m = await ensureAdminProviderModule(); return m?.probeProvider(...args); }
  async function runProviderCoverageAudit(...args) { const m = await ensureAdminProviderModule(); return m?.runProviderCoverageAudit(...args); }
  async function runProviderE2E(...args) { const m = await ensureAdminProviderModule(); return m?.runProviderE2E(...args); }
  
  async function loadFavorites() {
    if (state.favoritesLoading) return;
    const revisionAtStart = state.favoritesRevision;
    state.favoritesLoading = true;
    state.favoritesLoadError = '';
    renderFavoriteTeams();
    try {
      const data = await api('/api/favorites');
      if (revisionAtStart !== state.favoritesRevision) return;
      state.favorites = data.items || [];
      state.favoritesLoaded = true;
      state.favoritesLoadError = '';
      if (state.matches.length) renderMatches();
      renderDiscoveryHome();
      renderMyTeams();
    } catch (e) {
      if (revisionAtStart !== state.favoritesRevision) return;
      state.favoritesLoadError = e.message || 'Не удалось загрузить избранное.';
      if (state.favoritesLoaded) toast('Избранное временно не обновилось — показаны последние данные.');
    } finally {
      state.favoritesLoading = false;
      renderFavoriteTeams();
    }
  }
  
  async function loadReminders() {
    if (state.remindersLoading) return;
    const revisionAtStart = state.remindersRevision;
    state.remindersLoading = true;
    state.remindersLoadError = '';
    renderReminderList();
    try {
      const data = await api('/api/reminders');
      if (revisionAtStart !== state.remindersRevision) return;
      state.reminders = data.items || [];
      state.remindersLoaded = true;
      state.remindersLoadError = '';
    } catch (e) {
      if (revisionAtStart !== state.remindersRevision) return;
      state.remindersLoadError = e.message || 'Не удалось загрузить напоминания.';
      if (state.remindersLoaded) toast('Напоминания временно не обновились — показаны последние данные.');
    } finally {
      state.remindersLoading = false;
      renderReminderList();
      syncAllQuickReminderButtons();
      if (state.matches.length) renderRadarFeed();
    }
  }
  
  async function handleReminderRemove(fixtureId) {
    fixtureId = Number(fixtureId);
    if (!fixtureId || state.reminderMutations.has(fixtureId)) return;
    state.reminderMutations.add(fixtureId);
    syncReminderMutationUi(fixtureId);
    try {
      await api(`/api/reminders?fixtureId=${fixtureId}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== fixtureId);
      state.remindersLoaded = true;
      state.remindersRevision += 1;
      if (state.profile) {
        state.profile = {
          ...state.profile,
          stats: { ...(state.profile.stats || {}), reminders: state.reminders.length },
        };
      }
      renderReminderList();
      if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
      if (state.profile) renderProfile();
      toast('Напоминание отключено');
    } catch (e) {
      toast(e.message);
    } finally {
      state.reminderMutations.delete(fixtureId);
      syncReminderMutationUi(fixtureId);
    }
  }
  
  async function savePreferencesFromUi() {
    if (state.preferencesSaving) return;
    const payload = {
      defaultFilter: $('defaultFilterSelect')?.value || 'top',
      reminderMinutes: Number($('reminderMinutesSelect')?.value || 30),
      kickoffNotification: Boolean($('kickoffNotificationToggle')?.checked),
      hideYouth: Boolean($('hideYouthToggle')?.checked),
      favoriteFirst: Boolean($('favoriteFirstToggle')?.checked),
    };
    state.preferencesSaving = true;
    const saveButton = $('savePreferencesBtn');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Сохраняю…'; }
    try {
      const data = await api('/api/preferences', { method: 'PUT', body: JSON.stringify(payload) });
      state.preferences = { ...state.preferences, ...(data.preferences || payload) };
      state.profile = state.profile ? { ...state.profile, preferences: state.preferences } : state.profile;
      state.filter = state.preferences.defaultFilter || state.filter;
      syncFilterButtons();
      renderMatches();
      renderProfile();
      toast('Настройки сохранены');
    } catch (e) {
      if (state.profile) renderProfile();
      toast(`${e.message} Настройки на экране возвращены к последней сохранённой версии.`);
    } finally {
      state.preferencesSaving = false;
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Сохранить настройки'; }
    }
  }
  
  function favoriteSet() {
    return new Set(state.favorites.map(x => Number(x.teamId)));
  }
  
  function isFavorite(teamId) {
    return favoriteSet().has(Number(teamId));
  }
  
  function favoriteMutationSelector(teamId) {
    const id = Number(teamId);
    return `.fav-star[data-team-id="${id}"], .favorite-remove[data-team-id="${id}"], #teamFavoriteBtn[data-team-id="${id}"]`;
  }
  
  function syncFavoriteMutationUi(teamId) {
    const pending = state.favoriteMutations.has(Number(teamId));
    document.querySelectorAll(favoriteMutationSelector(teamId)).forEach(button => {
      button.disabled = pending;
      button.classList.toggle('is-pending', pending);
    });
  }
  
  async function toggleFavorite(team) {
    const teamId = Number(team?.id || 0);
    if (!teamId || state.favoriteMutations.has(teamId)) return;
    const active = isFavorite(teamId);
    state.favoritesLoadError = '';
    state.favoriteMutations.add(teamId);
    syncFavoriteMutationUi(teamId);
    try {
      if (active) {
        await api(`/api/favorites?teamId=${teamId}`, { method: 'DELETE' });
        state.favorites = state.favorites.filter(x => Number(x.teamId) !== teamId);
        state.favoritesLoaded = true;
        state.favoritesRevision += 1;
        toast(`${team.name}: удалено из избранного`);
      } else {
        const data = await api('/api/favorites', {
          method: 'POST',
          body: JSON.stringify({ teamId, teamName: team.name, teamLogo: team.logo || '' }),
        });
        state.favorites = [data.item, ...state.favorites.filter(x => Number(x.teamId) !== teamId)];
        state.favoritesLoaded = true;
        state.favoritesRevision += 1;
        toast(`${team.name}: добавлено в избранное`);
      }
      if (state.profile) {
        state.profile = {
          ...state.profile,
          stats: { ...(state.profile.stats || {}), favorites: state.favorites.length },
        };
        renderProfile();
      }
      renderMatches();
      if (state.currentTournament) renderTournamentMatches();
      renderFavoriteTeams();
      renderDiscoveryHome();
      renderMyTeams();
      if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
    } catch (e) {
      toast(e.message);
    } finally {
      state.favoriteMutations.delete(teamId);
      syncFavoriteMutationUi(teamId);
    }
  }

  return {
    outcomeShortLabel,
    ensureAdminModelQualityModule,
    renderModelQuality,
    loadModelQuality,
    ensureAdminCalibrationControlModule,
    renderCalibrationControl,
    loadCalibrationControl,
    runCalibrationControlAction,
    ensureAdminModelRemediationModule,
    renderModelRemediation,
    loadModelRemediation,
    runModelRemediation,
    resolveSettlementDriftFromUi,
    resetSettlementCircuitFromUi,
    openProfileView,
    ensureAdminReleaseReadinessModule,
    renderReleaseReadiness,
    loadReleaseReadiness,
    diagPct,
    diagDuration,
    diagnosticsStateLabel,
    ensureAdminProductionReadinessModule,
    renderProductionReadiness,
    loadProductionReadiness,
    runClientContractSmoke,
    ensureAdminRcRegressionModule,
    renderRcRegression,
    loadRcRegression,
    ensureAdminRuntimeControlsModule,
    renderRuntimeControls,
    loadRuntimeControlsAdmin,
    saveRuntimeControls,
    restoreRuntimeDefaults,
    ensureAdminReminderHealthModule,
    renderReminderHealth,
    loadReminderHealth,
    sendReminderTest,
    ensureAdminReleaseMonitorModule,
    renderReleaseMonitor,
    loadReleaseMonitor,
    transitionPostDeployRegressionResponse,
    ensureAdminMediaPublisherModule,
    generateMediaPublisherLink,
    copyMediaPublisherPost,
    ensureAdminLaunchFunnelModule,
    renderLaunchFunnel,
    acknowledgeRecoveryIncident,
    loadLaunchFunnel,
    ensureAdminDiagnosticsModule,
    renderDiagnostics,
    loadDiagnostics,
    openActivePassMatches,
    ensureBillingModule,
    renderBilling,
    loadBilling,
    showQuotaPaywall,
    showQuotaPaywallForFixture,
    hideQuotaPaywall,
    openPassStoreForFixture,
    ensureAdminProviderModule,
    renderProvider,
    renderProviderAudit,
    renderExpandedDataReleaseGate,
    loadProvider,
    probeProvider,
    runProviderCoverageAudit,
    runProviderE2E,
    loadFavorites,
    loadReminders,
    handleReminderRemove,
    savePreferencesFromUi,
    favoriteSet,
    isFavorite,
    favoriteMutationSelector,
    syncFavoriteMutationUi,
    toggleFavorite,
  };
}
