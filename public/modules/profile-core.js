export function createProfileCoreModule(deps = {}) {
  const {
    $,
    CLIENT_VERSION,
    adminBetaDashboardModule,
    adminBetaDashboardModulePromise,
    adminBillingRefundModule,
    adminBillingRefundModulePromise,
    adminOverviewModule,
    adminOverviewModulePromise,
    api,
    applyInterfacePreferences,
    applyRuntimeUi,
    betaFeedbackModule,
    betaFeedbackModulePromise,
    escapeHtml,
    loadCalibrationControl,
    loadDiagnostics,
    loadLaunchFunnel,
    loadModelQuality,
    loadModelRemediation,
    loadProductionReadiness,
    loadProvider,
    loadReleaseMonitor,
    loadReleaseReadiness,
    loadReminderHealth,
    loadRuntimeControlsAdmin,
    relativeAge,
    renderBilling,
    renderDataCapabilities,
    renderDigestSettings,
    renderDiscoveryHome,
    renderFavoriteTeams,
    renderMatches,
    renderMyTeams,
    renderProfileSummary,
    renderReminderList,
    renderSmartNotifications,
    sendActionError,
    state,
    syncFilterButtons,
    toast,
  } = deps;

  async function loadProfile() {
    const previousProfile = state.profile;
    try {
      state.profile = await api('/api/me');
      state.profileStale = false;
      state.profileLoadError = '';
      state.dataCapabilities = state.profile?.features?.dataCapabilities || state.dataCapabilities;
      if (state.profile?.preferences) {
        state.preferences = { ...state.preferences, ...state.profile.preferences };
        if (!state.preferencesApplied) {
          state.filter = state.preferences.defaultFilter || 'top';
          state.preferencesApplied = true;
          syncFilterButtons();
          if (state.matches.length) renderMatches();
        }
      }
      renderProfile();
  renderDiscoveryHome();
    } catch (e) {
      const authFailure = Number(e?.status || 0) === 401 || e?.category === 'auth';
      if (previousProfile && !authFailure) {
        state.profile = previousProfile;
        state.profileStale = true;
        state.profileLoadError = '';
        renderProfile();
        toast('Профиль временно не обновился — показаны последние данные.');
        return;
      }
      state.profile = null;
      state.profileStale = false;
      state.profileLoadError = e.message || 'Не удалось загрузить профиль.';
      applyAdminVisibility();
      sendActionError('profile', e, 'profileView');
      toast(e.message);
    }
  }
  
  function isAdmin() {
    return state.profile?.features?.isAdmin === true
      && state.profile?.features?.role === 'admin';
  }
  
  let adminBillingRefundModule = null;
  let adminBillingRefundModulePromise = null;
  async function ensureAdminBillingRefundModule() {
    if (!isAdmin()) return null;
    if (adminBillingRefundModule) return adminBillingRefundModule;
    if (!adminBillingRefundModulePromise) {
      adminBillingRefundModulePromise = import('./modules/admin-billing-refund.js').then(({ createAdminBillingRefundModule, mountAdminBillingRefundPanel }) => {
        if (!$('adminBillingRefundPanel')) mountAdminBillingRefundPanel(document);
        if (!$('adminBillingRefundPanel')) return null;
        adminBillingRefundModule = createAdminBillingRefundModule({
          state,
          elementById: $,
          api,
          escapeHtml,
          toast,
          isAdmin,
          confirmAction: message => window.confirm(message),
          reloadProfile: () => loadProfile(),
        });
        adminBillingRefundModule.bind();
        return adminBillingRefundModule;
      });
    }
    return adminBillingRefundModulePromise;
  }
  function renderAdminBillingRefund() {
    adminBillingRefundModule?.render();
  }
  async function loadAdminBillingRefund(...args) {
    const module = await ensureAdminBillingRefundModule();
    return module?.load(...args);
  }
  
  
  let adminBetaDashboardModule = null;
  let adminBetaDashboardModulePromise = null;
  async function ensureAdminBetaDashboardModule() {
    if (!isAdmin()) return null;
    if (adminBetaDashboardModule) return adminBetaDashboardModule;
    if (!adminBetaDashboardModulePromise) {
      adminBetaDashboardModulePromise = import('./modules/admin-beta-dashboard.js').then(({ createAdminBetaDashboardModule }) => {
        adminBetaDashboardModule = createAdminBetaDashboardModule({
          state,
          elementById: $,
          isAdmin,
          escapeHtml,
          humanizeTechnicalText,
          relativeAge,
          api,
        });
        return adminBetaDashboardModule;
      });
    }
    return adminBetaDashboardModulePromise;
  }
  
  function renderBetaDashboard() {
    if (adminBetaDashboardModule) return adminBetaDashboardModule.renderBetaDashboard();
    void ensureAdminBetaDashboardModule().then(module => module?.renderBetaDashboard());
  }
  
  async function loadBetaDashboard(...args) {
    const module = await ensureAdminBetaDashboardModule();
    return module?.loadBetaDashboard(...args);
  }
  
  let betaFeedbackModule = null;
  let betaFeedbackModulePromise = null;
  async function ensureBetaFeedbackModule() {
    if (betaFeedbackModule) return betaFeedbackModule;
    if (!betaFeedbackModulePromise) {
      betaFeedbackModulePromise = import('./modules/beta-feedback.js').then(({ createBetaFeedbackModule }) => {
        betaFeedbackModule = createBetaFeedbackModule({
          state,
          elementById: $,
          api,
          schedule: (fn, ms) => setTimeout(fn, ms),
        });
        return betaFeedbackModule;
      });
    }
    return betaFeedbackModulePromise;
  }
  
  function setBetaFeedbackOpen(...args) {
    if (betaFeedbackModule) return betaFeedbackModule.setBetaFeedbackOpen(...args);
    void ensureBetaFeedbackModule().then(module => module?.setBetaFeedbackOpen(...args));
  }
  
  async function submitBetaFeedback(...args) {
    const module = await ensureBetaFeedbackModule();
    return module?.submitBetaFeedback(...args);
  }
  
  let adminOverviewModule = null;
  let adminOverviewModulePromise = null;
  async function ensureAdminOverviewModule() {
    if (!isAdmin()) return null;
    if (adminOverviewModule) return adminOverviewModule;
    if (!adminOverviewModulePromise) {
      adminOverviewModulePromise = import('./modules/admin-overview.js').then(({ createAdminOverviewModule }) => {
        adminOverviewModule = createAdminOverviewModule({
          state,
          elementById: $,
          isAdmin,
          planLabel,
          clientVersion: CLIENT_VERSION,
        });
        return adminOverviewModule;
      });
    }
    return adminOverviewModulePromise;
  }
  
  function renderAdminOverview() {
    if (adminOverviewModule) return adminOverviewModule.renderAdminOverview();
    void ensureAdminOverviewModule().then(module => module?.renderAdminOverview());
  }
  
  function applyAdminVisibility() {
    const admin = isAdmin();
    document.querySelectorAll('[data-admin-only]').forEach(el => {
      el.hidden = !admin;
      el.toggleAttribute('inert', !admin);
      el.setAttribute('aria-hidden', admin ? 'false' : 'true');
    });
    const badge = $('adminRoleBadge');
    if (badge) {
      badge.hidden = !admin;
      badge.setAttribute('aria-hidden', admin ? 'false' : 'true');
      badge.textContent = admin ? '🔐 Администратор' : '';
    }
    if (admin) renderAdminOverview();
  }
  
  function organizeAdminConsole() {
    const content = $('adminAdvancedContent');
    if (!content || content.dataset.ready === 'true') return;
    [
      '#betaHealthPanel',
      '#betaDashboardPanel',
      '.runtime-controls-panel',
      '.provider-status-panel',
      '.diagnostics-panel',
      '.model-quality-panel',
      '.provider-audit-panel',
      '.reminder-health-panel',
      '.release-monitor-panel',
      '.launch-funnel-panel',
      '.rc-panel',
      '.release-panel',
      '.production-readiness-panel',
    ].forEach(selector => {
      const panel = document.querySelector(selector);
      if (panel) content.append(panel);
    });
    content.dataset.ready = 'true';
  }
  
  async function loadAdvancedAdminTools() {
    if (!isAdmin()) return;
    await Promise.allSettled([
      loadBetaDashboard(false),
      loadProvider(),
      loadRuntimeControlsAdmin(false),
      loadDiagnostics(false),
      loadModelQuality(false),
      loadCalibrationControl(false),
      loadModelRemediation(false),
      loadReleaseReadiness(false),
      loadProductionReadiness(false),
      loadReleaseMonitor(false),
      loadLaunchFunnel(false),
      loadReminderHealth(false),
    ]);
    renderAdminOverview();
  }
  
  function planLabel(plan) {
    const value = String(plan || '').toUpperCase();
    return ({ FREE: 'Бесплатный', PRO: 'PRO', PREMIUM: 'PREMIUM', ULTRA: 'ULTRA', MEGA: 'MEGA' })[value] || String(plan || '—');
  }
  
  function technicalStateLabel(value) {
    const key = String(value || '').toLowerCase();
    return ({
      healthy:'норма', ok:'норма', waiting:'ожидание', warning:'предупреждение', critical:'проблема',
      online:'в сети', offline:'нет связи', scheduled:'запланировано', prematch_sent:'предматчевое отправлено',
      kickoff_sent:'старт отправлен', retry_pending:'ожидает повторной доставки', sent:'отправлено', failed:'ошибка',
      active:'активно', shadow:'наблюдение', baseline:'базовый режим', enabled:'включено', disabled:'выключено',
      full:'полный режим', 'balanced-free':'сбалансированный режим', 'quota-saver':'экономный режим',
      expanded:'расширенный режим', standard:'стандартный режим', embedded:'данные матча',
      api:'источник данных', cache:'сохранённые данные', stale:'резервные сохранённые данные', skipped:'пропущено', error:'ошибка',
      memory:'временное хранилище', supabase:'Supabase',
      clean:'норма', watch:'требует внимания', migration:'нужна миграция', fallback:'резервный режим',
      running:'выполняется', completed:'завершено', partial:'частично', blocked:'заблокировано',
      unknown:'не определено', info:'информация',
    })[key] || humanizeTechnicalText(value || '—');
  }
  
  function humanizeTechnicalText(value) {
    let text = String(value ?? '');
    const exact = {
      PASS: 'ПРОЙДЕНО', FAIL: 'ОШИБКА', WARN: 'ПРЕДУПРЕЖДЕНИЕ', HOLD: 'ОЖИДАНИЕ',
      READY: 'ГОТОВО', READY_WITH_LIMITATIONS: 'ГОТОВО С ОГРАНИЧЕНИЯМИ',
      NEEDS_ATTENTION: 'ТРЕБУЕТ ПРОВЕРКИ', NOT_RUN: 'НЕ ЗАПУСКАЛОСЬ',
      ACTIVE: 'АКТИВНО', SHADOW: 'НАБЛЮДЕНИЕ', BASELINE: 'БАЗОВЫЙ РЕЖИМ',
      RUNNING: 'ВЫПОЛНЯЕТСЯ', COMPLETED: 'ЗАВЕРШЕНО', PARTIAL: 'ЧАСТИЧНО',
      BLOCKED: 'ЗАБЛОКИРОВАНО', UNKNOWN: 'НЕ ОПРЕДЕЛЕНО', MIGRATION: 'НУЖНА МИГРАЦИЯ',
    };
    if (exact[text]) return exact[text];
    const rules = [
      [/\bCore release candidate\b/gi, 'ядро кандидата на выпуск'],
      [/\bRelease Monitor\b/gi, 'мониторинг релиза'],
      [/\bRelease Gate\b/gi, 'проверка релиза'],
      [/\bProduction Safety Gate\b/gi, 'проверка производственной безопасности'],
      [/\bProduction[- ]ready\b/gi, 'рабочая среда готова'],
      [/\bproduction\b/gi, 'рабочая среда'],
      [/\bruntime\b/gi, 'среда выполнения'],
      [/\bschema\b/gi, 'схема данных'],
      [/\bread-only\b/gi, 'только чтение'],
      [/\buser routes?\b/gi, 'пользовательские маршруты'],
      [/\bsafety gates?\b/gi, 'защитные проверки'],
      [/\bsmoke[- ]test\b/gi, 'регрессионная проверка'],
      [/\bself[- ]test\b/gi, 'самопроверка'],
      [/\bCoverage Audit\b/gi, 'проверка покрытия'],
      [/\bendpoint\b/gi, 'метод API'],
      [/\bProvider\b/gi, 'источник данных'],
      [/\bMatch Center\b/gi, 'центр матча'],
      [/\bSingleFlight\b/gi, 'объединение одинаковых запросов'],
      [/\bguardrails?\b/gi, 'защитные правила'],
      [/\bquota guard\b/gi, 'защита квоты'],
      [/\bfeature-level\b/gi, 'по отдельным функциям'],
      [/\benrichment\b/gi, 'обогащение данных'],
      [/\bholdout\b/gi, 'отложенная выборка'],
      [/\btrusted\b/gi, 'доверенные'],
      [/\bActive champion\b/gi, 'активная модель'],
      [/\bBaseline champion\b/gi, 'базовая активная модель'],
      [/\bchampion\b/gi, 'активная модель'],
      [/\bchallenger\b/gi, 'кандидат'],
      [/\bbaseline\b/gi, 'базовый профиль'],
      [/\bshadow\b/gi, 'режим наблюдения'],
      [/\blifecycle\b/gi, 'жизненный цикл'],
      [/\brollback\b/gi, 'откат'],
      [/\brevision\b/gi, 'версия'],
      [/\bsettlement\b/gi, 'фиксация результата'],
      [/\bpending\b/gi, 'ожидающие'],
      [/\bsettled\b/gi, 'завершённые'],
      [/\bconfirmed\b/gi, 'подтверждённые'],
      [/\badjudicated\b/gi, 'вручную проверенные'],
      [/\bunverified\b/gi, 'непроверенные'],
      [/\bdrift\b/gi, 'расхождение'],
      [/\bdry-run\b/gi, 'предварительная проверка'],
      [/\bfixture\b/gi, 'матч'],
      [/\bstale\b/gi, 'устаревшие данные'],
      [/\bcache\b/gi, 'сохранённые данные'],
      [/\bworker\b/gi, 'серверный обработчик'],
      [/\bhealth\b/gi, 'состояние'],
      [/\bconfidence\b/gi, 'уверенность'],
      [/\bBrier\s+score\b/gi, 'ошибка Брайера'],
      [/\bBrier\b/gi, 'ошибка Брайера'],
      [/\bsignal-level\b/gi, 'по отдельным сигналам'],
      [/\bblend\b/gi, 'общая модель'],
      [/\bLIVE odds\b/gi, 'коэффициенты в реальном времени'],
      [/\bTTL\b/g, 'срок обновления'],
      [/\bH2H\b/g, 'очные встречи'],
      [/Safe defaults restored by administrator\./gi, 'Администратор восстановил безопасные настройки.'],
      [/\bFREE\b/g, 'Бесплатный'],
      [/\bHOLD\b/g, 'ОЖИДАНИЕ'],
      [/\bHTTP\b/g, 'код ответа'],
      [/\bE2E\b/g, 'сквозная проверка'],
      [/\banon\/authenticated\b/gi, 'анонимный/авторизованный клиент'],
      [/\bfirst-pass\b/gi, 'первичная проверка'],
      [/\bserver\b/gi, 'сервер'],
      [/\brelease\b/gi, 'релиз'],
      [/\bsecurity\b/gi, 'безопасность'],
      [/\bdatabase\b/gi, 'база данных'],
      [/\bmodel\b/gi, 'модель'],
      [/\bprediction\b/gi, 'прогноз'],
      [/\bremediation\b/gi, 'восстановление'],
      [/\bmonitor\b/gi, 'мониторинг'],
      [/\btelemetry\b/gi, 'телеметрия'],
      [/\bnetwork\b/gi, 'сеть'],
      [/\bboot\b/gi, 'запуск'],
      [/\bcompatibility\b/gi, 'совместимость'],
      [/\btimeout\b/gi, 'тайм-аут'],
      [/\brate[-_ ]?limit\b/gi, 'ограничение частоты'],
      [/\bblocked\b/gi, 'заблокировано'],
      [/\bcompleted\b/gi, 'завершено'],
      [/\bpartial\b/gi, 'частично'],
      [/\bwarning\b/gi, 'предупреждение'],
      [/\berror\b/gi, 'ошибка'],
      [/\broute\b/gi, 'маршрут'],
      [/\bclient\b/gi, 'клиент'],
      [/\bactive\b/gi, 'активный'],
      [/\bstatus\b/gi, 'статус'],
      [/\bmode\b/gi, 'режим'],
      [/\bwatch\b/gi, 'наблюдение'],
      [/\bclean\b/gi, 'норма'],
      [/\bunknown\b/gi, 'не определено'],
      [/\bavailable\b/gi, 'доступно'],
      [/\bunavailable\b/gi, 'недоступно'],
      [/\bstored\b/gi, 'сохранённый'],
      [/\bincomplete\b/gi, 'неполный'],
      [/\bscore\b/gi, 'счёт'],
      [/\boutcome\b/gi, 'исход'],
      [/\bchanged\b/gi, 'изменён'],
      [/\bfinal\b/gi, 'финальный'],
      [/\bmatch\b/gi, 'совпадение'],
      [/\bsecond[- ]pass\b/gi, 'повторная проверка'],
    ];
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
    return text.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  
  function publicText(value) {
    const raw = String(value ?? '');
    const exact = {
      high: 'высокий', medium: 'средний', low: 'низкий',
      'shots on goal': 'Удары в створ',
      'shots off goal': 'Удары мимо',
      'total shots': 'Все удары',
      'blocked shots': 'Заблокированные удары',
      'shots insidebox': 'Удары из штрафной',
      'shots outsidebox': 'Удары из-за штрафной',
      'ball possession': 'Владение мячом',
      'corner kicks': 'Угловые',
      'offsides': 'Офсайды',
      'fouls': 'Фолы',
      'yellow cards': 'Жёлтые карточки',
      'red cards': 'Красные карточки',
      'goalkeeper saves': 'Сейвы вратаря',
      'total passes': 'Передачи',
      'passes accurate': 'Точные передачи',
      'passes %': 'Точность передач',
      'expected_goals': 'Ожидаемые голы',
      'expected goals': 'Ожидаемые голы',
      'goals prevented': 'Предотвращённые голы',
      active: 'активно', shadow: 'режим наблюдения', baseline: 'базовый режим',
      full: 'полный режим', 'balanced-free': 'сбалансированный режим', 'quota-saver': 'экономный режим',
      expanded: 'расширенный режим', standard: 'стандартный режим',
      fixture: 'данные матча', embedded: 'данные матча', cache: 'сохранённые данные',
      stale: 'резервные сохранённые данные', skipped: 'пропущено', error: 'ошибка',
    };
    const key = raw.trim().toLowerCase();
    if (exact[key]) return exact[key];
    return humanizeTechnicalText(raw)
      .replace(/\bsignal-level\b/gi, 'по отдельным сигналам')
      .replace(/\bH2H\b/g, 'очные встречи')
      .replace(/\bblend\b/gi, 'общая модель');
  }
  
  function dataPolicyModeLabel(value) {
    const key = String(value || '').toLowerCase();
    return ({
      full: 'Полный режим',
      'balanced-free': 'Сбалансированный режим',
      'quota-saver': 'Экономный режим',
      expanded: 'Расширенный режим',
      standard: 'Стандартный режим',
    })[key] || publicText(value || 'Стандартный режим');
  }
  
  function calibrationModeLabel(value) {
    const key = String(value || '').toLowerCase();
    return key === 'active' ? 'Активная модель'
      : key === 'shadow' ? 'Кандидат в режиме наблюдения'
        : 'Базовая модель';
  }
  
  function predictionAdviceLabel(value) {
    let text = String(value || '');
    const rules = [
      [/\bDouble chance\s*:/gi, 'Двойной шанс:'],
      [/\bCombo Winner\s*:/gi, 'Комбинация — победитель:'],
      [/\bWinner\s*:/gi, 'Победитель:'],
      [/\bHome or Draw\b/gi, 'хозяева или ничья'],
      [/\bAway or Draw\b/gi, 'гости или ничья'],
      [/\bHome or Away\b/gi, 'хозяева или гости'],
      [/\band \+([0-9.]+) goals\b/gi, 'и тотал больше $1'],
      [/\band -([0-9.]+) goals\b/gi, 'и тотал меньше $1'],
      [/\bgoals\b/gi, 'голов'],
      [/\bNo prediction\b/gi, 'Прогноз недоступен'],
    ];
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
    return publicText(text);
  }
  
  function renderProfile() {
    if (!state.profile) return;
    renderProfileSummary();
    const prefs = state.preferences || {};
    if ($('defaultFilterSelect')) $('defaultFilterSelect').value = prefs.defaultFilter || 'top';
    if ($('reminderMinutesSelect')) $('reminderMinutesSelect').value = String(prefs.reminderMinutes || 30);
    if ($('kickoffNotificationToggle')) $('kickoffNotificationToggle').checked = prefs.kickoffNotification !== false;
    if ($('hideYouthToggle')) $('hideYouthToggle').checked = prefs.hideYouth !== false;
    if ($('favoriteFirstToggle')) $('favoriteFirstToggle').checked = prefs.favoriteFirst !== false;
    applyInterfacePreferences();
    renderFavoriteTeams();
    renderMyTeams();
    renderReminderList();
    renderBilling();
    renderDigestSettings();
    renderSmartNotifications();
    renderAdminBillingRefund();
    applyAdminVisibility();
    if (state.profile?.features?.runtime) state.runtimeStatus = state.profile.features.runtime;
    renderDataCapabilities();
    applyRuntimeUi();
    renderAdminOverview();
  }

  return {
    loadProfile,
    isAdmin,
    ensureAdminBillingRefundModule,
    renderAdminBillingRefund,
    loadAdminBillingRefund,
    ensureAdminBetaDashboardModule,
    renderBetaDashboard,
    loadBetaDashboard,
    ensureBetaFeedbackModule,
    setBetaFeedbackOpen,
    submitBetaFeedback,
    ensureAdminOverviewModule,
    renderAdminOverview,
    applyAdminVisibility,
    organizeAdminConsole,
    loadAdvancedAdminTools,
    planLabel,
    technicalStateLabel,
    humanizeTechnicalText,
    publicText,
    dataPolicyModeLabel,
    calibrationModeLabel,
    predictionAdviceLabel,
    renderProfile,
  };
}
