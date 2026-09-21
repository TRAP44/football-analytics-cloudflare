const CLIENT_VERSION = '6.7.2-rc15';
const CLIENT_API_CONTRACT = 5;
const CLIENT_RELEASE_CHANNEL = 'rc15';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor('secondary_bg_color'); } catch {}
}

const state = {
  profile: null,
  offset: 0,
  matches: [],
  matchesMeta: { refreshedAt: null, stale: false, warning: '', retryAfter: 0, catalog: {}, integrity: null },
  history: [],
  favorites: [],
  reminders: [],
  preferences: { defaultFilter: 'top', reminderMinutes: 30, kickoffNotification: true, hideYouth: true, favoriteFirst: true },
  preferencesApplied: false,
  provider: null,
  providerTransition: null,
  providerBudget: null,
  providerAudit: null,
  providerE2E: null,
  providerAuditLoading: false,
  providerE2ELoading: false,
  dataCapabilities: null,
  billing: null,
  modelQuality: null,
  modelQualityLoading: false,
  modelQualityDays: 90,
  modelRemediation: null,
  modelRemediationLoading: false,
  modelRemediationRunning: false,
  diagnostics: null,
  diagnosticsLoading: false,
  releaseReadiness: null,
  releaseReadinessLoading: false,
  productionReadiness: null,
  productionReadinessLoading: false,
  rcRegression: null,
  rcRegressionLoading: false,
  releaseMonitor: null,
  releaseMonitorLoading: false,
  releaseMonitorHours: 24,
  reminderHealth: null,
  reminderHealthLoading: false,
  runtimeStatus: null,
  runtimeControlsAdmin: null,
  runtimeControlsLoading: false,
  runtimeControlsSaving: false,
  clientTelemetrySent: new Set(),
  appManifest: null,
  serverVersion: '',
  versionMismatch: false,
  compatibilityBlocked: false,
  compatibilityReason: '',
  startup: {
    startedAt: performance.now(),
    finishedAt: null,
    manifestOk: false,
    degraded: false,
    watchdogFired: false,
  },
  storageAvailable: true,
  liveRefreshWasActive: false,
  network: {
    mode: navigator.onLine === false ? 'offline' : 'online',
    lastSuccessAt: null,
    lastFailureAt: null,
    lastRecoveredAt: null,
    lastAutoRecoveryAt: 0,
    consecutiveFailures: 0,
    retryAfter: 0,
    category: '',
    message: '',
    hiddenAt: null,
  },
  filter: 'top',
  search: '',
  globalSearch: { query: '', remoteTeams: [], remoteCompetitions: [], loading: false, warning: '', searchedAt: null },
  currentAnalysis: null,
  currentAnalysisTab: 'brief',
  currentCenter: null,
  currentCenterTab: 'summary',
  currentTournament: null,
  tournamentBackView: 'matchesView',
  currentTeam: null,
  teamBackView: 'matchesView',
  teamCache: new Map(),
  teamIntelligenceCache: new Map(),
  teamSquadCache: new Map(),
  tournamentStandings: new Map(),
  liveRefreshTimer: null,
  liveRefreshRemaining: 0,
  favoritesLoaded: false,
  remindersLoaded: false,
  historyLoaded: false,
  providerLoaded: false,
  viewScroll: {},
  matchesLoadSeq: 0,
  clientPerf: { startedAt: new Date().toISOString(), requests: 0, completed: 0, failed: 0, deduped: 0, retries: 0, rateLimited: 0, timeouts: 0, recoveries: 0, degradedEvents: 0, manifestFailures: 0, bootMs: null, totalMs: 0, lastMs: null, clientErrors: 0, lastError: '' },
};

const inflightGetRequests = new Map();
const MATCH_SNAPSHOT_PREFIX = 'football-analytics:v4:matches:';
const MATCH_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;


const $ = id => document.getElementById(id);
const views = ['matchesView', 'searchView', 'tournamentView', 'teamView', 'analysisView', 'historyView', 'profileView'];

const VIEW_CHROME = {
  matchesView: ['Матчи', 'Сегодня, LIVE и предматчевая аналитика'],
  searchView: ['Поиск', 'Команды, турниры и быстрый доступ'],
  tournamentView: ['Турнир', 'Матчи, таблица и контекст соревнования'],
  teamView: ['Команда', 'Форма, состав и календарь клуба'],
  analysisView: ['Анализ матча', 'Бриф, вероятности, сценарии и ключевые факторы'],
  historyView: ['История', 'Недавно просмотренные анализы'],
  profileView: ['Профиль', 'Настройки, избранное и персонализация'],
};

function syncTopbar(id) {
  const [title, subtitle] = VIEW_CHROME[id] || VIEW_CHROME.matchesView;
  if ($('topbarTitle')) $('topbarTitle').textContent = title;
  if ($('topbarSubtitle')) $('topbarSubtitle').textContent = subtitle;
}

function stopLiveRefresh() {
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  state.liveRefreshRemaining = 0;
}

function showView(id, options = {}) {
  const current = activeViewId();
  syncTopbar(id);
  if (current && current !== id) state.viewScroll[current] = window.scrollY || 0;
  if (id !== 'analysisView') { stopLiveRefresh(); state.liveRefreshWasActive = false; }
  views.forEach(v => $(v).classList.toggle('active', v === id));
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'tournamentView' || id === 'teamView' || id === 'analysisView');
  $('navSearch')?.classList.toggle('active', id === 'searchView');
  $('navHistory').classList.toggle('active', id === 'historyView');
  $('navProfile').classList.toggle('active', id === 'profileView');
  document.querySelectorAll('.nav-item').forEach(btn => btn.removeAttribute('aria-current'));
  if (id === 'matchesView' || id === 'tournamentView' || id === 'teamView' || id === 'analysisView') $('navMatches')?.setAttribute('aria-current', 'page');
  if (id === 'searchView') $('navSearch')?.setAttribute('aria-current', 'page');
  if (id === 'historyView') $('navHistory')?.setAttribute('aria-current', 'page');
  if (id === 'profileView') $('navProfile')?.setAttribute('aria-current', 'page');
  const top = options.restore ? Number(state.viewScroll[id] || 0) : 0;
  requestAnimationFrame(() => window.scrollTo({ top, behavior: 'auto' }));
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

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
  const retryAfter = Number(error?.retryAfter || error?.payload?.retryAfter || 0);
  if (category === 'offline') return 'Нет подключения к интернету. Сохранённые данные останутся на экране.';
  if (error?.status === 426 || error?.payload?.category === 'compatibility') return 'Версия приложения устарела. Обновите приложение.';
  if (error?.payload?.category === 'maintenance') return error?.payload?.error || 'Football Manager временно на техническом обслуживании.';
  if (error?.payload?.category === 'feature_disabled') return error?.payload?.error || 'Эта функция временно приостановлена.';
  if (category === 'auth') return 'Сессия Telegram не подтверждена. Закройте приложение и откройте его снова из бота.';
  if (category === 'timeout') return 'Сервис отвечает медленнее обычного. Попробуйте обновить ещё раз.';
  if (category === 'rate_limit') return retryAfter
    ? `Слишком много запросов. Повторите примерно через ${retryAfter} сек.`
    : 'Сервис временно ограничил частоту обновлений. Попробуйте чуть позже.';
  if (category === 'integrity') return 'Данные этого матча сейчас перепроверяются. Попробуйте открыть его немного позже.';
  if (category === 'database') return 'Хранилище данных временно недоступно. Основные футбольные экраны продолжат работу через доступный кэш.';
  if (category === 'provider') return 'Футбольные данные временно недоступны. Если есть сохранённая версия, приложение оставит её на экране.';
  if (category === 'service') return 'Сервис временно недоступен. Попробуйте повторить действие через несколько секунд.';
  return error?.message || 'Не удалось получить данные. Попробуйте ещё раз.';
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
      manifestOk: meta.manifestOk,
      degraded: meta.degraded,
      blocking: meta.blocking,
      reason: meta.reason || '',
      errorKind: meta.errorKind || '',
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  fetch('/api/client-telemetry', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-init-data': tg.initData,
    },
    body: JSON.stringify(payload),
    keepalive: true,
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}

function setNetworkMode(mode, options = {}) {
  const previous = state.network.mode;
  state.network.mode = mode;
  state.network.category = options.category || '';
  state.network.message = options.message || '';
  state.network.retryAfter = Number(options.retryAfter || 0);
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
      const data = await api(`/api/match-center?fixtureId=${fixtureId}&recovery=${Date.now()}`, { dedupe: false });
      renderMatchCenter(data);
    } else if (view === 'historyView') {
      await loadHistory(false);
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
    text.textContent = state.compatibilityReason || 'Эта версия приложения несовместима с текущим сервером. Обновите приложение.';
    button.textContent = 'Обновить';
    return;
  }

  if (state.versionMismatch) {
    text.textContent = `Доступно обновление ${state.serverVersion || state.appManifest?.recommendedClientVersion || ''}. Текущая версия совместима, но лучше перезагрузить приложение.`;
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
    reason = `Нужна новая версия приложения: контракт API ${serverContract}, а интерфейс использует ${CLIENT_API_CONTRACT}.`;
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
  if (runtime.liveEnabled === false) items.push('LIVE-обновления');
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
  $('navSearch')?.classList.remove('feature-disabled');
  $('navSearch')?.removeAttribute('aria-disabled');
  if ($('globalSearchBtn')) $('globalSearchBtn').disabled = searchDisabled;

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
  sendClientTelemetry('boot_ok', {
    bootMs: state.clientPerf.bootMs,
    manifestOk: state.startup.manifestOk,
    degraded: state.startup.degraded,
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

  setBootStatus('Запускаю Football Manager', 'Проверяю совместимость версии…', 12);
  const manifest = await loadAppManifest();

  if (state.compatibilityBlocked) {
    showBootRecovery({
      blocking: true,
      title: 'Нужно обновить приложение',
      text: state.compatibilityReason,
    });
    return false;
  }

  setBootStatus(
    'Подключаю данные',
    manifest ? `${manifest.releaseCandidate || CLIENT_RELEASE_CHANNEL.toUpperCase()} · контракт API ${manifest.apiContract}` : 'Манифест временно недоступен — продолжаю в безопасном режиме.',
    38
  );

  await loadRuntimeStatus(false);
  await Promise.allSettled([loadProfile(), loadFavorites()]);
  renderProfile();
  applyRuntimeUi();

  if (isAdmin() || !state.runtimeStatus?.maintenanceMode) {
    await Promise.allSettled([loadMatches()]);
  } else {
    const snapshot = readMatchSnapshot(localDate(state.offset));
    if (snapshot) applyMatchPayload(snapshot, { snapshot: true });
    else if ($('matches')) {
      $('matches').innerHTML = `<div class="empty">${escapeHtml(state.runtimeStatus?.message || 'Football Manager временно находится на техническом обслуживании.')}</div>`;
      $('matches').setAttribute('aria-busy', 'false');
    }
  }

  const usable = Boolean(state.profile || state.matches.length || readMatchSnapshot(localDate(state.offset)));
  if (!usable && navigator.onLine === false) {
    showBootRecovery({
      blocking: false,
      title: 'Нет подключения к интернету',
      text: 'Подключитесь к сети и повторите запуск. Если сохранённые матчи появятся, можно продолжить в приложении.',
    });
    return false;
  }

  setBootStatus('Готово', state.startup.degraded ? 'Запуск выполнен с ограниченной проверкой версии.' : 'Версия и основные данные проверены.', 100);
  await new Promise(resolve => setTimeout(resolve, 120));
  hideBootGate();

  scheduleIdle(async () => {
    const tasks = [loadReminders()];
    if (isAdmin()) tasks.push(loadProvider());
    await Promise.allSettled(tasks);
  });
  return true;
}


function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function safeDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

function timeOf(iso) {
  const d = safeDate(iso);
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(d); } catch { return '—'; }
}

function dateTime(iso) {
  const d = safeDate(iso);
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); } catch { return ''; }
}

function dateOnly(iso) {
  const d = safeDate(iso);
  if (!d) return '';
  try { return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(d); } catch { return ''; }
}

function relativeAge(iso) {
  const ms = Date.now() - Date.parse(iso || '');
  if (!Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 15) return 'только что';
  if (sec < 60) return `${sec} сек. назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин. назад`;
  const h = Math.floor(min / 60);
  return `${h} ч. назад`;
}

function coverageLabel(tier) {
  if (tier === 'enhanced') return { text: 'Расширенное', cls: 'enhanced' };
  if (tier === 'basic') return { text: 'Базовое', cls: 'basic' };
  return { text: 'Стандартное', cls: 'standard' };
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const timeoutMs = Number(options.timeoutMs || 12000);
  const retryable = isGet && options.retry !== false;
  const dedupe = isGet && options.dedupe !== false;
  const requestKey = `${method}:${path}`;

  if (dedupe && inflightGetRequests.has(requestKey)) {
    state.clientPerf.deduped += 1;
    return inflightGetRequests.get(requestKey);
  }

  const task = (async () => {
    let attempt = 0;
    while (true) {
      const started = performance.now();
      state.clientPerf.requests += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
      const headers = new Headers(options.headers || {});
      headers.set('Content-Type', 'application/json');
      if (tg?.initData) headers.set('x-telegram-init-data', tg.initData);
      try {
        const { timeoutMs: _timeoutMs, retry: _retry, dedupe: _dedupe, ...fetchOptions } = options;
        const response = await fetch(path, { ...fetchOptions, method, headers, signal: controller.signal });
        const serverVersion = String(response.headers.get('x-app-version') || '');
        if (serverVersion) observeServerVersion(serverVersion, response);
        if (state.compatibilityBlocked) {
          showBootRecovery({ blocking: true, title: 'Нужно обновить приложение', text: state.compatibilityReason });
          throw Object.assign(new Error(state.compatibilityReason), { status: 426, payload: { category: 'compatibility' } });
        }
        const data = await response.json().catch(() => ({}));
        const runtimeFromPayload = data?.runtime || data?.dataCapabilities?.runtime || data?.features?.runtime || null;
        if (runtimeFromPayload) {
          state.runtimeStatus = runtimeFromPayload;
          applyRuntimeUi();
        }
        if (!response.ok) {
          const error = Object.assign(new Error(data.error || `HTTP ${response.status}`), {
            status: response.status,
            payload: data,
            retryAfter: Number(data.retryAfter || response.headers.get('retry-after') || 0),
          });
          if (response.status === 429) state.clientPerf.rateLimited += 1;
          if (retryable && attempt < 1 && [502, 503, 504].includes(response.status) && !['maintenance','feature_disabled'].includes(String(data.category || ''))) throw Object.assign(error, { transient: true });
          throw error;
        }
        const elapsed = Math.round(performance.now() - started);
        state.clientPerf.completed += 1;
        state.clientPerf.lastMs = elapsed;
        state.clientPerf.totalMs += elapsed;
        noteRequestSuccess();
        return data;
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        const transient = Boolean(error?.transient) || aborted || (!error?.status && navigator.onLine !== false);
        if (retryable && attempt < 1 && transient) {
          attempt += 1;
          state.clientPerf.retries += 1;
          await new Promise(resolve => setTimeout(resolve, 350 + Math.floor(Math.random() * 250)));
          continue;
        }
        state.clientPerf.failed += 1;
        let finalError = error;
        if (aborted) {
          state.clientPerf.timeouts += 1;
          finalError = Object.assign(new Error('Сервер отвечает слишком долго.'), { status: 408, payload: { category: 'timeout' } });
        } else if (navigator.onLine === false && !error?.status) {
          finalError = Object.assign(new Error('Нет подключения к интернету.'), { status: 0 });
        }
        finalError = normalizeApiError(finalError);
        noteRequestFailure(finalError);
        throw finalError;
      } finally {
        clearTimeout(timeout);
      }
    }
  })();

  if (dedupe) inflightGetRequests.set(requestKey, task);
  try { return await task; }
  finally { if (dedupe && inflightGetRequests.get(requestKey) === task) inflightGetRequests.delete(requestKey); }
}

async function loadProfile() {
  try {
    state.profile = await api('/api/me');
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
    toast(e.message);
  }
}

function isAdmin() {
  return Boolean(state.profile?.features?.isAdmin);
}

function applyAdminVisibility() {
  const admin = isAdmin();
  document.querySelectorAll('[data-admin-only]').forEach(el => { el.hidden = !admin; });
  const badge = $('adminRoleBadge');
  if (badge) badge.hidden = !admin;
}

function renderDataCapabilities() {
  const c = state.dataCapabilities || state.profile?.features?.dataCapabilities || {};
  const features = c.features || {};
  if ($('dataModeLabel')) $('dataModeLabel').textContent = c.label || (c.mode === 'expanded' ? 'Расширенное покрытие' : 'Стандартное покрытие');
  if ($('dataModeRefresh')) $('dataModeRefresh').textContent = features.liveRefresh === false || Number(c.refreshSeconds) === 0
    ? 'пауза'
    : Number(c.refreshSeconds || 60) <= 30 ? `${Number(c.refreshSeconds || 60)} сек.` : 'адаптивно';
  if ($('dataModeLineups')) $('dataModeLineups').textContent = features.lineupsFallback ? 'Расширенно' : 'По доступности';
  if ($('dataModePlayers')) $('dataModePlayers').textContent = features.playerStats ? 'Расширенно' : 'По доступности';
  if ($('dataModeOdds')) $('dataModeOdds').textContent = features.liveOdds ? 'Расширенно' : 'По доступности';
  if ($('dataModeNote')) $('dataModeNote').textContent = c.note || 'Покрытие зависит от турнира и доступности данных провайдера.';
}

function planLabel(plan) {
  const value = String(plan || '').toUpperCase();
  return ({ FREE: 'Бесплатный', PRO: 'PRO', PREMIUM: 'PREMIUM', ULTRA: 'ULTRA', MEGA: 'MEGA' })[value] || String(plan || '—');
}

function renderProfile() {
  if (!state.profile) return;
  const { user, quota, stats = {} } = state.profile;
  const profilePlanLabel = $('profileBtn')?.querySelector('span');
  if (profilePlanLabel) profilePlanLabel.textContent = planLabel(quota.plan);
  else if ($('profileBtn')) $('profileBtn').textContent = planLabel(quota.plan);
  $('quotaText').textContent = `Осталось анализов: ${quota.left} из ${quota.limit}`;
  $('profileName').textContent = user.firstName || 'Пользователь';
  $('profileUsername').textContent = user.username ? `@${user.username} · ID Telegram ${user.id}` : `ID Telegram ${user.id}`;
  $('profilePlan').textContent = planLabel(quota.plan);
  $('profileUsage').textContent = `${quota.used} / ${quota.limit}`;
  $('memberSince').textContent = user.createdAt ? `С нами с ${dateOnly(user.createdAt)}` : '';
  $('favoriteCount').textContent = String(stats.favorites ?? state.favorites.length);
  $('reminderCount').textContent = String(stats.reminders ?? state.reminders.length);
  const prefs = state.preferences || {};
  if ($('defaultFilterSelect')) $('defaultFilterSelect').value = prefs.defaultFilter || 'top';
  if ($('reminderMinutesSelect')) $('reminderMinutesSelect').value = String(prefs.reminderMinutes || 30);
  if ($('kickoffNotificationToggle')) $('kickoffNotificationToggle').checked = prefs.kickoffNotification !== false;
  if ($('hideYouthToggle')) $('hideYouthToggle').checked = prefs.hideYouth !== false;
  if ($('favoriteFirstToggle')) $('favoriteFirstToggle').checked = prefs.favoriteFirst !== false;
  renderFavoriteTeams();
  renderReminderList();
  renderBilling();
  applyAdminVisibility();
  if (state.profile?.features?.runtime) state.runtimeStatus = state.profile.features.runtime;
  renderDataCapabilities();
  applyRuntimeUi();
}


function qualityPct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
}

function qualityNum(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
}

function signalLabel(name) {
  const labels = { market: 'Рынок', apiPrediction: 'API prediction', recentForm: 'Форма', h2h: 'H2H' };
  return labels[String(name || '')] || String(name || 'Сигнал');
}

function outcomeShortLabel(key) {
  return key === 'home' ? 'П1' : key === 'away' ? 'П2' : key === 'draw' ? 'X' : '—';
}

function renderModelQuality() {
  const status = $('modelQualityStatus');
  const badge = $('modelQualitySampleBadge');
  const headline = $('modelQualityHeadline');
  const calibration = $('modelQualityCalibration');
  const engine = $('modelQualityEngine');
  const confidence = $('modelQualityConfidence');
  const secondary = $('modelQualitySecondary');
  const dashboard = $('modelQualityDashboard');
  const recent = $('modelQualityRecent');
  if (!status || !badge || !headline || !calibration || !engine || !confidence || !secondary || !dashboard || !recent) return;

  const q = state.modelQuality;
  if (state.modelQualityLoading) {
    status.textContent = 'Загружаю историческую проверку…';
    badge.textContent = 'Загрузка';
    [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
    return;
  }
  if (!q) {
    status.textContent = 'Данные ещё не загружены.';
    badge.textContent = 'Нет данных';
    [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
    return;
  }
  if (q.available === false) {
    status.textContent = q.reason || 'Историческая проверка пока недоступна.';
    badge.textContent = 'Нужна миграция';
    [headline, calibration, engine, confidence, secondary, dashboard, recent].forEach(x => x.hidden = true);
    return;
  }

  const sample = q.sample || {};
  const h = q.headline || {};
  const excludedText = Number(sample.excluded || 0) > 0 ? ` · ${Number(sample.excluded)} исключено проверкой целостности` : '';
  badge.textContent = sample.ready ? `${sample.settled || 0} матчей` : `${sample.settled || 0} / 20 матчей`;
  badge.classList.toggle('ready', Boolean(sample.ready));
  status.textContent = sample.settled
    ? `${sample.settled} проверенных прогнозов · ${sample.pending || 0} ожидают результата${excludedText}${sample.calibrationReady ? ' · калибровка уже информативнее' : ''}`
    : `Пока нет проверенных завершённых прогнозов${excludedText}. Новые предматчевые анализы будут автоматически попадать в историческую проверку.`;

  headline.hidden = false;
  headline.innerHTML = `
    <div><span>Точность 1X2</span><strong>${qualityPct(h.accuracy)}</strong><small>максимальная вероятность</small></div>
    <div><span>Brier score</span><strong>${qualityNum(h.avgBrier)}</strong><small>ниже — лучше</small></div>
    <div><span>Log loss</span><strong>${qualityNum(h.avgLogLoss)}</strong><small>штраф за уверенные ошибки</small></div>
    <div><span>Средний top %</span><strong>${qualityPct(h.avgTopProbability)}</strong><small>уверенность лидера</small></div>`;

  calibration.hidden = false;
  calibration.innerHTML = `
    <div class="quality-block-head"><strong>Калибровка вероятностей</strong><span>прогноз vs факт</span></div>
    <div class="quality-calibration-list">${(q.calibration || []).map(x => `
      <div class="quality-cal-row">
        <span>${escapeHtml(x.label)}</span>
        <div class="quality-cal-bars"><i style="--w:${Math.max(0, Math.min(100, Number(x.avgPredicted || 0)))}%"></i><b style="--w:${Math.max(0, Math.min(100, Number(x.hitRate || 0)))}%"></b></div>
        <strong>${x.sample ? `${qualityPct(x.hitRate)} · n=${x.sample}` : '—'}</strong>
      </div>`).join('')}</div>
    ${q.methodology?.warning ? `<p class="quality-warning">⚠️ ${escapeHtml(q.methodology.warning)}</p>` : ''}`;

  const ce = q.calibrationEngine || {};
  const impact = q.calibrationImpact || {};
  const modeLabel = ce.mode === 'active' ? 'Активен' : ce.mode === 'shadow' ? 'Тень' : 'База';
  const signalRows = (q.signalPerformance || []).some(x => Number(x.sample || 0) > 0) ? (q.signalPerformance || []) : (q.signals || []);
  engine.hidden = false;
  engine.innerHTML = `
    <div class="quality-block-head"><strong>⚙️ Калибратор v3.7</strong><span class="calibration-mode ${escapeHtml(ce.mode || 'baseline')}">${modeLabel}</span></div>
    <div class="calibration-engine-grid">
      <div><span>Режим</span><strong>${modeLabel}</strong><small>${ce.mode === 'active' ? 'коррекции разрешены защитными правилами' : ce.mode === 'shadow' ? 'измеряет, но не меняет прогноз' : 'базовые веса'}</small></div>
      <div><span>Temperature</span><strong>${Number.isFinite(Number(ce.temperature)) ? Number(ce.temperature).toFixed(2) : '1.00'}</strong><small>1.00 = без сжатия вероятностей</small></div>
      <div><span>Backtest</span><strong>${Number(ce.sample || 0)}</strong><small>завершённых snapshot</small></div>
      <div><span>Holdout</span><strong>${Number(ce.temperatureValidation?.validationSample || 0)}</strong><small>${Number.isFinite(Number(ce.temperatureValidation?.improvement)) ? `${Number(ce.temperatureValidation.improvement).toFixed(1)}% log loss` : 'ещё нет проверки'}</small></div>
    </div>
    <div class="calibration-weights">
      ${(ce.signalStats || []).map(x => {
        const base = Number(x.baseWeight || 0) * 100;
        const current = Number(x.currentWeight ?? x.baseWeight ?? 0) * 100;
        return `<div class="calibration-weight-row"><span>${escapeHtml(signalLabel(x.name))}</span><div><i style="--w:${Math.max(0, Math.min(100, current))}%"></i></div><strong>${base.toFixed(0)} → ${current.toFixed(1)}%</strong><small>n=${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · Brier ${qualityNum(x.avgBrier)}` : ''}</small></div>`;
      }).join('')}
    </div>
    ${Number(impact.sample || 0) ? `<div class="calibration-impact"><span>Проверка v3.7: n=${Number(impact.sample || 0)}</span><strong>Brier ${qualityNum(impact.rawBrier)} → ${qualityNum(impact.finalBrier)}</strong><small>${Number(impact.brierDelta || 0) > 0 ? 'улучшение' : Number(impact.brierDelta || 0) < 0 ? 'ухудшение — автоматика будет видна в исторической проверке' : 'без изменения'}</small></div>` : '<p class="quality-engine-note">Эффект v3.7 появится после завершения первых матчей, рассчитанных этой версией.</p>'}
    <p class="quality-engine-note">${escapeHtml(ce.note || 'Автокалибровка включается только после достаточной выборки.')}</p>`;

  confidence.hidden = false;
  confidence.innerHTML = `
    <div class="quality-block-head"><strong>По уверенности модели</strong><span>не рейтинг, а диагностика</span></div>
    <div class="quality-mini-grid">${(q.confidence || []).map(x => `
      <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>n=${Number(x.sample || 0)} · Brier ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
    <div class="quality-signal-grid">${signalRows.map(x => `
      <div><span>${escapeHtml(signalLabel(x.name))}</span><strong>${qualityPct(x.accuracy)}</strong><small>n=${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · Brier ${qualityNum(x.avgBrier)}` : ''}</small></div>`).join('')}</div>`;

  const sec = q.secondary || {};
  secondary.hidden = false;
  secondary.innerHTML = `
    <div class="quality-block-head"><strong>Дополнительные рынки модели</strong><span>порог 50%</span></div>
    <div class="quality-secondary-grid">
      <div><span>ТБ 2.5</span><strong>${qualityPct(sec.over25?.accuracy)}</strong><small>n=${Number(sec.over25?.sample || 0)}</small></div>
      <div><span>Обе забьют</span><strong>${qualityPct(sec.btts?.accuracy)}</strong><small>n=${Number(sec.btts?.sample || 0)}</small></div>
    </div>`;

  const db = q.dashboard || {};
  dashboard.hidden = false;
  if (!db.overview || !Number(db.overview.sample || 0)) {
    dashboard.innerHTML = '<div class="empty compact-empty">Панель модели заполнится после завершения первых прогнозов.</div>';
  } else {
    const ov = db.overview || {};
    const trendMaxSample = Math.max(1, ...(db.trend || []).map(x => Number(x.sample || 0)));
    const leagues = db.leagues || [];
    dashboard.innerHTML = `
      <div class="quality-block-head"><strong>📊 Model Dashboard 2.0</strong><span>${Number(db.periodDays || q.periodDays || 90)} дней</span></div>

      <div class="model-dash-kpis">
        <div><span>Snapshot</span><strong>${Number(ov.sample || 0)}</strong><small>settled</small></div>
        <div><span>Точность</span><strong>${qualityPct(ov.accuracy)}</strong><small>1X2</small></div>
        <div><span>Brier</span><strong>${qualityNum(ov.avgBrier)}</strong><small>ниже лучше</small></div>
        <div><span>Gap</span><strong>${Number.isFinite(Number(ov.calibrationGap)) ? `${Number(ov.calibrationGap).toFixed(1)} п.п.` : '—'}</strong><small>top % − accuracy</small></div>
        <div><span>Cal error</span><strong>${Number.isFinite(Number(q.calibrationDiagnostics?.weightedTopCalibrationError)) ? `${Number(q.calibrationDiagnostics.weightedTopCalibrationError).toFixed(1)} п.п.` : '—'}</strong><small>weighted · 5 buckets</small></div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Тренд по неделям</strong><span>accuracy + размер выборки; Brier указан текстом</span></div>
        ${(db.trend || []).length ? `<div class="model-trend-chart">${db.trend.map(x => {
          const acc = Math.max(2, Math.min(100, Number(x.accuracy || 0)));
          const sampleH = Math.max(8, Math.round(Number(x.sample || 0) / trendMaxSample * 100));
          return `<div class="model-trend-col" title="${escapeHtml(x.label)} · n=${Number(x.sample || 0)} · ${qualityPct(x.accuracy)}">
            <div class="model-trend-bars"><i style="height:${acc}%"></i><b style="height:${sampleH}%"></b></div>
            <strong>${qualityPct(x.accuracy)}</strong>
            <span>${escapeHtml(x.label)}</span>
            <small>n=${Number(x.sample || 0)} · B ${qualityNum(x.avgBrier)}</small>
          </div>`;
        }).join('')}</div>` : '<div class="empty compact-empty">Пока недостаточно недельных данных.</div>'}
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Confidence bands</strong><span>проверяем, растёт ли качество с confidence</span></div>
        <div class="model-band-list">${(db.confidence || []).map(x => `
          <div class="model-band-row">
            <span>${escapeHtml(x.label)}</span>
            <div><i style="--w:${Math.max(0, Math.min(100, Number(x.accuracy || 0)))}%"></i></div>
            <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
            <small>n=${Number(x.sample || 0)} · B ${qualityNum(x.avgBrier)}</small>
          </div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Полнота данных</strong><span>влияет ли богатство входных данных</span></div>
        <div class="model-dash-mini-grid">${(db.completeness || []).map(x => `
          <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>n=${Number(x.sample || 0)} · Brier ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Лиги</strong><span>сортировка по размеру выборки</span></div>
        ${leagues.length ? `<div class="model-league-table">${leagues.map(x => `
          <div class="model-league-row">
            <div><strong>${escapeHtml(x.leagueName || x.label)}</strong><small>n=${Number(x.sample || 0)} · confidence ${qualityPct(x.avgConfidence)}</small></div>
            <span>${qualityPct(x.accuracy)}</span>
            <span>B ${qualityNum(x.avgBrier)}</span>
            <em>${Number.isFinite(Number(x.calibrationGap)) ? `${Number(x.calibrationGap) >= 0 ? '+' : ''}${Number(x.calibrationGap).toFixed(1)} п.п.` : '—'}</em>
          </div>`).join('')}</div>` : '<div class="empty compact-empty">Лиг для сравнения пока нет.</div>'}
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Исходы модели</strong><span>описательный срез П1 / X / П2</span></div>
        <div class="model-dash-mini-grid">${(db.outcomes || []).map(x => `
          <div>
            <span>${escapeHtml(x.label)}</span>
            <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
            <small>n=${Number(x.sample || 0)} · Brier ${qualityNum(x.avgBrier)}</small>
          </div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Сравнение версий</strong><span>без рейтинга и автоматического promotion</span></div>
        ${(db.versions || []).length ? `<div class="model-version-table">${db.versions.map(x => `
          <div class="model-version-row">
            <div>
              <strong>${escapeHtml(x.version || 'legacy / unknown')}</strong>
              <small>n=${Number(x.sample || 0)} · ${x.firstKickoffAt ? escapeHtml(dateTime(x.firstKickoffAt)) : '—'} → ${x.lastKickoffAt ? escapeHtml(dateTime(x.lastKickoffAt)) : '—'}</small>
            </div>
            <div><span>Accuracy</span><b>${qualityPct(x.accuracy)}</b></div>
            <div><span>Brier</span><b>${qualityNum(x.avgBrier)}</b></div>
            <div><span>Log loss</span><b>${qualityNum(x.avgLogLoss)}</b></div>
            <div><span>Cal error</span><b>${Number.isFinite(Number(x.calibrationError)) ? `${Number(x.calibrationError).toFixed(1)} п.п.` : '—'}</b></div>
            <div><span>Сигналы</span><b>${qualityPct(x.signalSnapshotCoverage)}</b></div>
          </div>`).join('')}</div>` : '<div class="empty compact-empty">Сравнение версий пока не сформировано.</div>'}
        <p class="quality-engine-note">Разрез показывает исторические cohorts версия анализа. Различия могут быть связаны с периодом, лигами и составом данных; интерфейс не выбирает победителя.</p>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Signal-level performance</strong><span>источник сам по себе vs итоговый blend</span></div>
        <div class="model-signal-table">${(db.signals || []).map(x => `
          <div class="model-signal-row">
            <div><strong>${escapeHtml(signalLabel(x.name))}</strong><small>n=${Number(x.sample || 0)} · базовый вес ${Number(x.baseWeight || 0).toFixed(0)}%</small></div>
            <div><span>Источник</span><b>${qualityPct(x.signalAccuracy)}</b><small>B ${qualityNum(x.signalBrier)}</small></div>
            <div><span>Blend</span><b>${qualityPct(x.finalAccuracy)}</b><small>B ${qualityNum(x.finalBrier)}</small></div>
            <em class="${Number(x.brierDeltaVsBlend || 0) <= 0 ? 'good' : 'watch'}">${Number.isFinite(Number(x.brierDeltaVsBlend)) ? `${Number(x.brierDeltaVsBlend) >= 0 ? '+' : ''}${Number(x.brierDeltaVsBlend).toFixed(3)}` : '—'}</em>
          </div>`).join('')}</div>
      </div>

      ${(db.calibrationModes || []).length ? `<div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Режимы калибратора</strong><span>описательный срез, версии модели различаются</span></div>
        <div class="model-dash-mini-grid">${db.calibrationModes.map(x => `<div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>n=${Number(x.sample || 0)} · Brier ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
      </div>` : ''}

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>🧪 Prediction Integrity</strong><span>${escapeHtml(q.integrity?.label || 'нет данных')}</span></div>
        <div class="model-integrity-summary ${escapeHtml(q.integrity?.status || 'clean')}">
          <div><span>Loaded</span><strong>${Number(q.integrity?.loadedRows || 0)}</strong><small>settled + pending</small></div>
          <div><span>Severe</span><strong>${Number(q.integrity?.severeIssues || 0)}</strong><small>probability / timing / consistency</small></div>
          <div><span>Warning</span><strong>${Number(q.integrity?.warningIssues || 0)}</strong><small>settlement / outcome</small></div>
          <div><span>Info</span><strong>${Number(q.integrity?.informationalIssues || 0)}</strong><small>устаревшие метаданные</small></div>
        </div>
        <div class="model-integrity-list">${(q.integrity?.checks || []).map(x => `
          <div class="${escapeHtml(x.state || 'info')}">
            <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : x.state === 'warn' ? '!' : 'i'}</i>
            <span><strong>${escapeHtml(x.label || '')}</strong><small>${escapeHtml(x.detail || '')}</small></span>
            <em>${Number(x.count || 0)}</em>
          </div>`).join('')}</div>
        ${q.integrity?.truncatedPotentially ? '<div class="data-notice stale">Выборка достигла лимита административного запроса: проверка целостности относится к загруженным строкам, а не ко всей истории.</div>' : ''}
        <p class="quality-engine-note">${escapeHtml(q.integrity?.note || '')}</p>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Наблюдения для проверки</strong><span>ничего не меняют автоматически</span></div>
        <div class="model-observations">${(db.observations || []).map(x => `
          <div class="${escapeHtml(x.level || 'info')}"><span>${x.level === 'good' ? '✓' : x.level === 'warn' ? '!' : x.level === 'watch' ? '↗' : 'i'}</span><div><strong>${escapeHtml(x.title || '')}</strong><p>${escapeHtml(x.text || '')}</p></div></div>`).join('')}</div>
        <p class="quality-engine-note">${escapeHtml(db.note || '')}</p>
      </div>`;
  }

  recent.hidden = false;
  if (!(q.recent || []).length) {
    recent.innerHTML = '<div class="empty compact-empty">Завершённых прогнозов пока нет.</div>';
  } else {
    recent.innerHTML = `
      <div class="quality-block-head"><strong>Последние проверки</strong><span>${Number(q.periodDays || state.modelQualityDays)} дней</span></div>
      <div class="quality-recent-list">${q.recent.map(x => `
        <div class="quality-recent-row ${x.correct ? 'hit' : 'miss'}">
          <div><strong>${escapeHtml(x.home)} — ${escapeHtml(x.away)}</strong><span>${escapeHtml(x.league || '')}${x.kickoffAt ? ` · ${escapeHtml(dateTime(x.kickoffAt))}` : ''}${x.analysisVersion ? ` · ${escapeHtml(x.analysisVersion)}` : ''}</span></div>
          <div class="quality-result"><b>${escapeHtml(x.score)}</b><small>${escapeHtml(x.predictedLabel || outcomeShortLabel(x.predictedOutcome))} · ${qualityPct(x.topProbability)}</small></div>
          <em>${x.correct ? '✓' : '×'}</em>
        </div>`).join('')}</div>`;
  }
}

async function loadModelQuality(force = false) {
  if (!isAdmin()) return;
  if (state.modelQualityLoading) return;
  const days = Number($('modelQualityPeriod')?.value || state.modelQualityDays || 90);
  state.modelQualityDays = days;
  if (!force && state.modelQuality && Number(state.modelQuality.periodDays || days) === days) {
    renderModelQuality();
    return;
  }
  state.modelQualityLoading = true;
  renderModelQuality();
  try {
    state.modelQuality = await api(`/api/model-quality?days=${days}${force ? '&refresh=1' : ''}`);
  } catch (e) {
    state.modelQuality = { available: false, reason: e.message || 'Не удалось загрузить историческую проверку.' };
  } finally {
    state.modelQualityLoading = false;
    renderModelQuality();
  }
}

function remediationActionLabel(action) {
  if (action?.status === 'started') return 'Запущено';
  if (action?.status === 'completed') return 'Выполнено';
  if (action?.status === 'partial') return 'Частично';
  if (action?.status === 'failed') return 'Ошибка';
  if (action?.status === 'interrupted') return 'Прервано';
  return 'Нет статуса';
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
    ? 'Нужна supabase_migration_v6_1.sql: предварительная проверка доступна, выполнение заблокировано.'
    : Number(driftReview.unresolved || 0)
      ? `Требуют ручного разбора: ${Number(driftReview.unresolved)} расхождений. Зависших ожиданий: ${Number(recovery.stalePending || 0)}.`
      : recovery.stalePending
        ? `Найдено зависших ожиданий: ${Number(recovery.stalePending)}; безопасный пакет — ${Number(recovery.selectedCount || 0)}.`
        : 'Зависшие ожидания и неразобранные расхождения не обнаружены.';
  summary.innerHTML = `
    <div><span>Просканировано</span><strong>${Number(scan.loadedRows || 0)}</strong><small>${scan.truncated ? `лимит ${Number(scan.maxRows || 0)}` : 'полная выборка'}</small></div>
    <div><span>Зависшие ожидания</span><strong>${Number(recovery.stalePending || 0)}</strong><small>старше 36 часов</small></div>
    <div><span>В пакете</span><strong>${Number(recovery.selectedCount || 0)}</strong><small>до ${Number(recovery.maxFixturesPerRun || 20)} fixture</small></div>
    <div><span>Запросы API</span><strong>${Number(recovery.estimatedProviderCalls || 0)}</strong><small>по уникальным датам</small></div>
    <div><span>Контроль результатов</span><strong>${watchdog.autoRecoveryEnabled ? 'АВТО' : 'НАБЛЮДЕНИЕ'}</strong><small>${watchdog.schemaReady ? `${escapeHtml(watchdog.scheduleUtc || '04:00')} UTC` : 'нужна миграция v6.2'}</small></div>
    <div><span>Защитный контур</span><strong>${reliability.circuitOpen ? 'ОТКРЫТА' : 'ЗАКРЫТА'}</strong><small>${reliability.schemaReady ? (reliability.circuitOpenUntil ? `до ${escapeHtml(dateTime(reliability.circuitOpenUntil))}` : `${Number(reliability.consecutiveFailures || 0)}/${Number(reliability.failureThreshold || 2)} ошибок`) : 'нужна миграция v6.3'}</small></div>
    <div><span>Журнал запусков</span><strong>${Number(runLedger.activeStarted || 0) ? 'ЗАНЯТО' : Number(runLedger.staleStarted || 0) ? 'ЗАВИСЛО' : 'ЧИСТО'}</strong><small>${runLedger.schemaReady ? `${Number(runLedger.activeStarted || 0)} активных · ${Number(runLedger.staleStarted || 0)} зависших · максимум ${Number(runLedger.maxAttempts || 3)} попытки` : 'нужна миграция v6.4'}</small></div>
    <div><span>Подтверждение результата</span><strong>${Number(finality.drift || 0) ? 'РАСХОЖДЕНИЕ' : Number(finality.unverified || 0) || Number(finality.verified || 0) ? 'ПРОВЕРКА' : 'ПОДТВЕРЖДЕНО'}</strong><small>${finality.schemaReady ? `${Number(finality.confirmed || 0)} confirmed · ${Number(finality.verified || 0)} first-pass · ${Number(finality.unverified || 0)} pending · ${Number(finality.adjudicated || 0)} adjudicated · ${Number(finality.drift || 0)} drift` : 'нужна миграция v6.7'}</small></div>
    <div><span>Доверенные метрики</span><strong>${Number(finality.trustedForMetrics || 0)}</strong><small>только confirmed + adjudicated</small></div>
    <div><span>Разбор расхождений</span><strong>${Number(driftReview.unresolved || 0) ? 'ТРЕБУЕТ ДЕЙСТВИЯ' : 'ЧИСТО'}</strong><small>${driftReview.schemaReady ? `${Number(driftReview.unresolved || 0)} неразобранных · требуется решение администратора` : 'нужна миграция v6.6'}</small></div>`;

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
           <div class="settlement-drift-copy"><strong>${escapeHtml(item.home || '—')} — ${escapeHtml(item.away || '—')}</strong><small>${escapeHtml(item.league || '')} · #${Number(item.fixtureId || 0)} · ${item.observedAt ? escapeHtml(dateTime(item.observedAt)) : '—'}</small><span>сохранено ${escapeHtml(storedScore)} ${escapeHtml(stored.outcome || '')} → провайдер ${escapeHtml(providerScore)} ${escapeHtml(provider.outcome || '')} · ${escapeHtml(provider.status || '')}</span><em>${escapeHtml(item.driftReason || 'расхождение данных провайдера')}${locked ? ` · locked: ${escapeHtml(locked)}` : ''}</em></div>
           <div class="settlement-drift-actions">
             <button class="reminder-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="keep_stored" ${locked && locked !== 'keep_stored' ? 'disabled' : ''}>Оставить сохранённое</button>
             <button class="primary-setting-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="accept_provider" ${!item.providerAcceptable || (locked && locked !== 'accept_provider') ? 'disabled' : ''}>Принять данные провайдера</button>
             <button class="reminder-btn" type="button" data-drift-fixture="${Number(item.fixtureId || 0)}" data-drift-action="void_prediction" ${locked && locked !== 'void_prediction' ? 'disabled' : ''}>Исключить из метрик</button>
           </div>
         </div>`;
       }).join('')}</div>`
    : '<p class="tiny quality-method-note">Неразобранных расхождений нет.</p>';

  const actions = r.recentActions || [];
  history.innerHTML = actions.length
    ? `<div class="model-remediation-history-head"><strong>Последние действия</strong><span>admin ID скрыт</span></div>
       <div class="model-remediation-action-list">${actions.map(action => `
         <div class="${escapeHtml(action.status || 'failed')}"><span><strong>${escapeHtml(remediationActionLabel(action))}${action.actionType === 'auto_recover' ? ' · АВТО' : action.actionType === 'circuit_reset' ? ' · СБРОС ЗАЩИТЫ' : ''}</strong><small>${escapeHtml(action.reason || 'Без комментария')} · ${action.createdAt ? escapeHtml(dateTime(action.createdAt)) : '—'}${action.triggerSource ? ` · ${escapeHtml(action.triggerSource)}` : ''}${action.attemptNo ? ` · попытка ${Number(action.attemptNo)}` : ''}${action.retryOfActionId ? ' · повтор' : ''}</small></span><em>${Number(action.settledCount || 0)} закрыто · ${Number(action.skippedCount || 0)} пропущено</em></div>`).join('')}</div>`
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
  const confirmed = window.confirm(`Повторно проверить ${Number(recovery.selectedCount || 0)} ожидающих прогнозов? Ожидается до ${Number(recovery.estimatedProviderCalls || 0)} запросов API-Football.`);
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
    await loadModelQuality(true);
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
    accept_provider: 'принять исправление провайдера и пересчитать метрики результата',
    void_prediction: 'исключить прогноз из исторических метрик',
  };
  if (!labels[action]) return;
  if (!window.confirm(`Матч #${Number(item.fixtureId)}: ${labels[action]}? Действие будет записано в неизменяемый журнал.`)) return;

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
      ? 'Исправление провайдера принято и записано в журнал.'
      : action === 'void_prediction'
        ? 'Прогноз исключён из исторических метрик и записан в журнал.'
        : 'Сохранённый результат подтверждён администратором и записан в журнал.');
    await loadModelQuality(true);
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
  if (!window.confirm('Закрыть защитный контур и снова разрешить автоматическое восстановление при следующей проверке?')) return;
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

async function openProfileView() {
  showView('profileView');
  const lastFixture = Number(state.currentCenter?.match?.fixtureId || state.currentAnalysis?.match?.fixtureId || 0);
  if (lastFixture && $('providerAuditFixtureId') && !$('providerAuditFixtureId').value) $('providerAuditFixtureId').value = String(lastFixture);
  const essentials = [];
  if (!state.favoritesLoaded) essentials.push(loadFavorites());
  if (!state.remindersLoaded) essentials.push(loadReminders());
  if (isAdmin()) {
    if (!state.providerLoaded) essentials.push(loadProvider());
    essentials.push(loadRuntimeControlsAdmin(false), loadModelQuality(false), loadModelRemediation(false), loadReleaseReadiness(false), loadProductionReadiness(false), loadReleaseMonitor(false), loadReminderHealth(false));
  }
  await Promise.allSettled(essentials);
}


function releaseStateLabel(value) {
  const map = { ready: 'Готово', warning: 'Почти готово', blocked: 'Блокировано' };
  return map[String(value || '')] || 'Нет данных';
}

function renderReleaseReadiness() {
  const root = $('releaseStatus');
  const badge = $('releaseBadge');
  const checksEl = $('releaseChecks');
  const meta = $('releaseMeta');
  if (!root || !badge || !checksEl) return;
  if (state.releaseReadinessLoading) {
    badge.textContent = 'Проверка'; badge.className = 'release-badge waiting';
    root.textContent = 'Проверяю обязательные зависимости ядра…';
    checksEl.innerHTML = '';
    if (meta) meta.textContent = '';
    return;
  }
  const r = state.releaseReadiness;
  if (!r?.available) {
    badge.textContent = 'Нет данных'; badge.className = 'release-badge';
    root.textContent = r?.reason || 'Проверка ещё не запускалась.';
    checksEl.innerHTML = '';
    return;
  }
  badge.textContent = releaseStateLabel(r.status);
  badge.className = `release-badge ${escapeHtml(r.status || '')}`;
  root.textContent = r.label || 'Проверка завершена.';
  if (meta) meta.textContent = `${Number(r.score || 0)}% · ${relativeAge(r.generatedAt)}`;
  checksEl.innerHTML = (r.checks || []).map(x => `
    <div class="release-check ${escapeHtml(x.state || 'warn')}">
      <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</i>
      <span><strong>${escapeHtml(x.label || '')}</strong><small>${escapeHtml(x.detail || '')}</small></span>
    </div>`).join('') || '<div class="empty compact-empty">Нет результатов проверки.</div>';
}

async function loadReleaseReadiness(force = false) {
  if (!isAdmin()) return;
  if (state.releaseReadinessLoading) return;
  if (!force && state.releaseReadiness) { renderReleaseReadiness(); return; }
  state.releaseReadinessLoading = true;
  renderReleaseReadiness();
  try {
    state.releaseReadiness = await api(`/api/release-readiness${force ? '?refresh=1' : ''}`);
    if (state.releaseReadiness?.diagnostics) {
      state.diagnostics = state.releaseReadiness.diagnostics;
      if (state.diagnostics?.provider) { state.provider = state.diagnostics.provider; renderProvider(); }
      renderDiagnostics();
    }
  } catch (e) {
    state.releaseReadiness = { available: false, reason: e.message || 'Не удалось выполнить проверку готовности.' };
  } finally {
    state.releaseReadinessLoading = false;
    renderReleaseReadiness();
  }
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


function productionStateLabel(stateValue) {
  if (stateValue === 'ready') return 'ГОТОВО';
  if (stateValue === 'warning') return 'ПРОВЕРИТЬ';
  if (stateValue === 'blocked') return 'ЗАБЛОКИРОВАНО';
  return '—';
}

function renderProductionReadiness() {
  if (!isAdmin()) return;
  const root = $('productionReadinessStatus');
  const badge = $('productionReadinessBadge');
  const score = $('productionReadinessScore');
  const checks = $('productionReadinessChecks');
  const runtime = $('productionReadinessRuntime');
  if (!root || !badge || !score || !checks || !runtime) return;

  if (state.productionReadinessLoading) {
    root.textContent = 'Проверяю объединение запросов, частотную защиту, тайм-ауты и ограничение памяти…';
    badge.textContent = 'RUN';
    badge.className = 'production-badge running';
    score.textContent = '—';
    checks.innerHTML = '';
    runtime.innerHTML = '';
    return;
  }

  const r = state.productionReadiness;
  if (!r) {
    root.textContent = 'Проверка производственной безопасности ещё не запускалась.';
    badge.textContent = 'ОЖИДАНИЕ';
    badge.className = 'production-badge';
    score.textContent = '—';
    checks.innerHTML = '';
    runtime.innerHTML = '';
    return;
  }

  root.textContent = r.label || 'Проверка завершена.';
  badge.textContent = productionStateLabel(r.status);
  badge.className = `production-badge ${escapeHtml(r.status || '')}`;
  score.textContent = `${Number(r.score || 0)}%`;

  checks.innerHTML = (r.checks || []).map(x => `
    <div class="production-check ${escapeHtml(x.state || '')}">
      <span>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</span>
      <div><strong>${escapeHtml(x.label || '')}</strong><small>${escapeHtml(x.detail || '')}</small></div>
      <em>${x.blocking ? 'обязательно' : 'защита'}</em>
    </div>`).join('');

  const s = r.safety || {};
  runtime.innerHTML = `
    <div class="production-runtime-grid">
      <div><span>Объединено одинаковых запросов</span><strong>${Number(s.singleflight?.joins || 0)}</strong><small>${Number(s.singleflight?.active || 0)} сейчас</small></div>
      <div><span>Блокировки частых запросов</span><strong>${Number(s.burstGuard?.blocked || 0)}</strong><small>${Number(s.burstGuard?.activeBuckets || 0)} bucket</small></div>
      <div><span>Upstream timeout</span><strong>${Number(s.upstream?.timeouts || 0)}</strong><small>DB ${Number(s.upstream?.supabaseTimeoutMs || 0)/1000}с · API ${Number(s.upstream?.apiFootballTimeoutMs || 0)/1000}с</small></div>
      <div><span>L1 cache</span><strong>${Number(s.memory?.cacheEntries || 0)}</strong><small>soft limit ${Number(s.memory?.cacheSoftLimit || 0)}</small></div>
      <div><span>User sync cache</span><strong>${Number(s.memory?.userSyncEntries || 0)}</strong><small>${Math.round(Number(s.memory?.userSyncTtlSeconds || 0)/60)} мин.</small></div>
      <div><span>Memory prune</span><strong>${Number(s.memory?.pruned || 0)}</strong><small>в этом isolate</small></div>
    </div>
    <p class="tiny">${escapeHtml(r.policy?.note || '')}</p>`;
}

async function loadProductionReadiness(force = false) {
  if (!isAdmin()) return;
  if (state.productionReadinessLoading) return;
  if (!force && state.productionReadiness) { renderProductionReadiness(); return; }
  state.productionReadinessLoading = true;
  renderProductionReadiness();
  try {
    state.productionReadiness = await api(`/api/production-readiness${force ? '?refresh=1' : ''}`, {
      retry: false,
      timeoutMs: 15000,
    });
  } catch (e) {
    state.productionReadiness = {
      status: 'blocked',
      label: e.message || 'Проверка производственной безопасности не выполнена.',
      score: 0,
      checks: [],
      safety: {},
      policy: {},
    };
  } finally {
    state.productionReadinessLoading = false;
    renderProductionReadiness();
  }
}


function runClientContractSmoke() {
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass: Boolean(pass), detail: String(detail || '') });

  const requiredIds = [
    'matchesView','searchView','tournamentView','teamView','analysisView','historyView','profileView',
    'navMatches','navSearch','navHistory','navProfile',
    'connectionBanner','connectionRetryBtn','toast',
    'modelQualityStatus','modelRemediationStatus','modelRemediationDryRunBtn','modelRemediationRunBtn','modelRemediationCircuitResetBtn','modelRemediationDriftQueue','providerAuditStatus','releaseStatus','productionReadinessStatus','diagnosticsStatus',
  ];
  const missing = requiredIds.filter(id => !$(id));
  add('required_dom', 'Основные DOM-контракты', missing.length === 0, missing.length ? `Нет: ${missing.join(', ')}` : `${requiredIds.length}/${requiredIds.length} элементов.`);

  const allIds = [...document.querySelectorAll('[id]')].map(el => el.id);
  const duplicates = allIds.filter((id, i) => allIds.indexOf(id) !== i);
  add('unique_ids', 'Уникальные HTML id', duplicates.length === 0, duplicates.length ? `Дубликаты: ${[...new Set(duplicates)].join(', ')}` : `${allIds.length} id без дублей.`);

  const adminSections = [...document.querySelectorAll('[data-admin-only]')];
  add('admin_sections', 'Разметка интерфейса администратора', adminSections.length >= 6, `${adminSections.length} технических секций доступны только администратору.`);

  const cssLink = document.querySelector('link[href*="styles.css?v=6.7.2"]');
  const appScript = document.querySelector('script[src*="app.js?v=6.7.2"]');
  add('cache_bust', 'Версии файлов интерфейса', Boolean(cssLink && appScript), `CSS ${cssLink ? 'OK' : 'MISS'} · JS ${appScript ? 'OK' : 'MISS'}.`);

  add('client_version', 'Версия клиента', CLIENT_VERSION === '6.7.2-rc15', CLIENT_VERSION);
  add('telegram_sdk', 'Telegram WebApp SDK', Boolean(window.Telegram?.WebApp), window.Telegram?.WebApp ? 'SDK доступен.' : 'В обычном браузере SDK может отсутствовать; в Telegram должен быть доступен.');

  const navButtons = ['navMatches','navSearch','navHistory','navProfile'].filter(id => $(id));
  add('navigation', 'Нижняя навигация', navButtons.length === 4, `${navButtons.length}/4 кнопки.`);

  const recoveryIds = ['connectionBannerIcon','connectionBannerTitle','connectionBannerText','connectionRetryBtn'];
  add('recovery_contract', 'Контракт восстановления интерфейса', recoveryIds.every(id => $(id)), `${recoveryIds.filter(id => $(id)).length}/${recoveryIds.length} элементов.`);

  const bootIds = ['bootGate','bootTitle','bootText','bootProgressFill','bootReloadBtn','versionBanner','versionReloadBtn'];
  add('startup_contract', 'Контракт запуска и отката', bootIds.every(id => $(id)), `${bootIds.filter(id => $(id)).length}/${bootIds.length} элементов.`);
  const runtimeIds = ['runtimeBanner','runtimeBannerTitle','runtimeBannerText','runtimeControlsStatus','runtimeSaveBtn','runtimeHistoryList','runtimeChangeReason','runtimeAutoSettlementRecoveryToggle'];
  add('runtime_controls_contract', 'Контракт управления функциями и отката', runtimeIds.every(id => $(id)), `${runtimeIds.filter(id => $(id)).length}/${runtimeIds.length} элементов.`);
  add('api_contract', 'Клиентский контракт API', CLIENT_API_CONTRACT === 5, `contract ${CLIENT_API_CONTRACT} · ${CLIENT_RELEASE_CHANNEL}`);

  return {
    version: CLIENT_VERSION,
    generatedAt: new Date().toISOString(),
    total: checks.length,
    passed: checks.filter(x => x.pass).length,
    failed: checks.filter(x => !x.pass).length,
    checks,
  };
}

function rcStateText(status) {
  if (status === 'rc_ready') return 'RC15 ГОТОВ';
  if (status === 'rc_with_holds') return 'RC С ОГРАНИЧЕНИЯМИ';
  if (status === 'blocked') return 'ЗАБЛОКИРОВАНО';
  return 'ОЖИДАНИЕ';
}

function renderRcRegression() {
  if (!isAdmin()) return;
  const badge = $('rcBadge');
  const status = $('rcStatus');
  const meta = $('rcMeta');
  const summary = $('rcSummary');
  const groups = $('rcGroups');
  const client = $('rcClient');
  const checks = $('rcChecks');
  const btn = $('rcRunBtn');
  if (!badge || !status || !meta || !summary || !groups || !client || !checks || !btn) return;

  btn.disabled = Boolean(state.rcRegressionLoading);
  if (state.rcRegressionLoading) {
    badge.className = 'rc-badge running';
    badge.textContent = 'RUN';
    status.textContent = 'Запускаю безопасную регрессионную проверку…';
    meta.textContent = 'API-Football не расходуется';
    summary.innerHTML = '';
    groups.innerHTML = '';
    client.innerHTML = '';
    checks.innerHTML = '';
    return;
  }

  const r = state.rcRegression;
  if (!r) {
    badge.className = 'rc-badge';
    badge.textContent = 'RC15';
    status.textContent = 'Полная регрессионная проверка ещё не запускалась.';
    meta.textContent = 'Тест безопасный: без полного анализа, без изменения пользовательских данных и без расхода API-Football.';
    summary.innerHTML = '';
    groups.innerHTML = '';
    client.innerHTML = '';
    checks.innerHTML = '';
    return;
  }

  const cls = r.status === 'rc_ready' ? 'ready' : r.status === 'blocked' ? 'blocked' : 'warning';
  badge.className = `rc-badge ${cls}`;
  badge.textContent = rcStateText(r.status);
  status.textContent = r.label || 'Регрессионная проверка завершена.';
  meta.textContent = `${Number(r.score || 0)}% сервер · ${relativeAge(r.generatedAt)} · ${Number(r.durationMs || 0)} мс`;

  summary.innerHTML = `
    <div class="rc-summary-grid">
      <div><span>Всего</span><strong>${Number(r.summary?.total || 0)}</strong></div>
      <div><span>PASS</span><strong>${Number(r.summary?.passed || 0)}</strong></div>
      <div><span>WARN/HOLD</span><strong>${Number(r.summary?.warnings || 0)}</strong></div>
      <div><span>BLOCK</span><strong>${Number(r.summary?.blockers || 0)}</strong></div>
    </div>`;

  const groupLabels = {
    runtime:'Runtime', security:'Security', database:'Supabase schema',
    user_routes:'User routes', gates:'Release gates', provider:'Провайдер', safety:'Безопасность',
  };
  groups.innerHTML = `<div class="rc-group-grid">${Object.entries(r.groups || {}).map(([key,g]) => `
    <div class="${Number(g.fail || 0) ? 'fail' : Number(g.warn || 0) ? 'warn' : 'pass'}">
      <span>${escapeHtml(groupLabels[key] || key)}</span>
      <strong>${Number(g.pass || 0)}/${Number(g.total || 0)}</strong>
      <small>${Number(g.warn || 0)} предупреждений · ${Number(g.fail || 0)} ошибок</small>
    </div>`).join('')}</div>`;

  const cs = r.clientContract || runClientContractSmoke();
  client.innerHTML = `
    <div class="rc-client-head"><strong>📱 Проверка клиентского контракта</strong><span>${Number(cs.passed || 0)}/${Number(cs.total || 0)}</span></div>
    <div class="rc-client-checks">${(cs.checks || []).map(x => `
      <div class="${x.pass ? 'pass' : 'fail'}"><i>${x.pass ? '✓' : '×'}</i><span><strong>${escapeHtml(x.label || '')}</strong><small>${escapeHtml(x.detail || '')}</small></span></div>`).join('')}</div>`;

  checks.innerHTML = `<details class="rc-details"><summary>Все серверные проверки · ${Number(r.summary?.total || 0)}</summary>
    <div class="rc-check-list">${(r.checks || []).map(x => `
      <div class="${escapeHtml(x.state || 'warn')}">
        <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</i>
        <span><strong>${escapeHtml(x.label || '')}</strong><small>${escapeHtml(x.detail || '')}</small></span>
        <em>${x.blocking ? 'обязательно' : (groupLabels[x.group] || x.group)}</em>
      </div>`).join('')}</div>
  </details>
  <p class="tiny">${escapeHtml(r.policy?.note || '')}</p>`;
}

async function loadRcRegression(force = true) {
  if (!isAdmin() || state.rcRegressionLoading) return;
  if (!force && state.rcRegression) { renderRcRegression(); return; }

  state.rcRegressionLoading = true;
  renderRcRegression();
  try {
    const result = await api(`/api/rc-regression${force ? '?refresh=1' : ''}`, {
      retry: false,
      timeoutMs: 45000,
      dedupe: false,
    });
    result.clientContract = runClientContractSmoke();
    state.rcRegression = result;
    const clientFailed = Number(result.clientContract?.failed || 0);
    toast(result.status === 'blocked' || clientFailed ? 'Регрессионная проверка RC: есть пункты для проверки' : 'Регрессионная проверка RC завершена');
  } catch (e) {
    state.rcRegression = {
      status: 'blocked',
      label: e.message || 'Регрессионная проверка RC не выполнена.',
      score: 0,
      summary: { total: 0, passed: 0, warnings: 0, blockers: 1 },
      groups: {},
      checks: [],
      clientContract: runClientContractSmoke(),
      policy: {},
    };
  } finally {
    state.rcRegressionLoading = false;
    renderRcRegression();
  }
}




function runtimeControlsFormValue(id, fallback = true) {
  const el = $(id);
  return el ? Boolean(el.checked) : fallback;
}


function runtimeHistoryActionLabel(action) {
  return ({
    baseline: 'Baseline',
    update: 'Изменение',
    defaults: 'Safe defaults',
    rollback: 'Rollback',
  })[String(action || '')] || String(action || 'Изменение');
}

function runtimeHistorySummary(controls = {}) {
  const disabled = [];
  if (controls.maintenanceMode) disabled.push('maintenance');
  if (controls.analysisEnabled === false) disabled.push('analysis');
  if (controls.searchEnabled === false) disabled.push('search');
  if (controls.liveEnabled === false) disabled.push('live');
  if (controls.remindersEnabled === false) disabled.push('reminders');
  if (controls.expandedDataEnabled === false) disabled.push('expanded');
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
    status.textContent = panel.historyReason || 'Нужна supabase_migration_v5_8.sql для истории и отката.';
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
        <strong>revision ${Number(row.revision || 0)} · ${escapeHtml(runtimeHistoryActionLabel(row.action))}</strong>
        <span>${escapeHtml(runtimeHistorySummary(row.controls || {}))}</span>
        <small>${row.createdAt ? escapeHtml(dateTime(row.createdAt)) : '—'}${row.reason ? ` · ${escapeHtml(row.reason)}` : ''}${row.sourceRevision ? ` · из версии ${Number(row.sourceRevision)}` : ''}</small>
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
      historyReady: true,
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
    badge.textContent = state.runtimeControlsSaving ? 'SAVE' : 'RUN';
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
    badge.textContent = 'SQL';
    status.textContent = panel.reason || 'Нужна supabase_migration_v5_7.sql.';
    revision.textContent = 'schema missing';
    return;
  }

  const c = panel.controls || {};
  badge.className = `runtime-controls-badge ${c.maintenanceMode ? 'maintenance' : 'healthy'}`;
  badge.textContent = c.maintenanceMode ? 'MAINT' : 'LIVE';
  status.textContent = c.maintenanceMode
    ? 'Режим технического обслуживания включён для обычных пользователей.'
    : 'Настройки функций активны. Изменения применяются без нового развёртывания.';
  revision.textContent = `revision ${Number(c.revision || 1)}${c.updatedAt ? ` · ${relativeAge(c.updatedAt)}` : ''}`;

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
      ? 'Включить автоматическое восстановление результатов? Система сможет один раз в сутки сделать до 5 запросов провайдера и изменить только зависшие ожидающие записи с подтверждённым финальным счётом.'
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
    reason: 'Safe defaults restored by administrator.',
    action: 'defaults',
  }, { skipConfirm: true });
}

function renderReminderHealth() {
  if (!isAdmin()) return;
  const badge = $('reminderHealthBadge');
  const status = $('reminderHealthStatus');
  const kpis = $('reminderHealthKpis');
  const recent = $('reminderHealthRecent');
  const refresh = $('reminderHealthRefreshBtn');
  const test = $('reminderTestBtn');
  if (!badge || !status || !kpis || !recent || !refresh || !test) return;

  refresh.disabled = Boolean(state.reminderHealthLoading);
  test.disabled = Boolean(state.reminderHealthLoading);

  if (state.reminderHealthLoading) {
    badge.className = 'reminder-health-badge running';
    badge.textContent = 'RUN';
    status.textContent = 'Проверяю расписание и фиксацию задач доставки…';
    kpis.innerHTML = '';
    recent.innerHTML = '';
    return;
  }

  const r = state.reminderHealth;
  if (!r) {
    badge.className = 'reminder-health-badge';
    badge.textContent = 'ОЖИДАНИЕ';
    status.textContent = 'Состояние доставки ещё не загружено.';
    kpis.innerHTML = '';
    recent.innerHTML = '';
    return;
  }

  if (!r.available) {
    badge.className = 'reminder-health-badge blocked';
    badge.textContent = 'SQL';
    status.textContent = r.reason || 'Нужна миграция v5.6.';
    kpis.innerHTML = '<div class="data-notice stale">Перед проверкой уведомлений запустите <b>supabase_migration_v5_6.sql</b>.</div>';
    recent.innerHTML = '';
    return;
  }

  const healthy = r.health?.state === 'healthy';
  badge.className = `reminder-health-badge ${healthy ? 'healthy' : 'watch'}`;
  badge.textContent = healthy ? 'OK' : 'WATCH';
  status.textContent = `${r.health?.label || 'Состояние доставки'} · проверка каждые ${Number(r.scheduler?.cadenceMinutes || 5)} мин.`;

  const s = r.summary || {};
  kpis.innerHTML = `<div class="reminder-health-grid">
    <div><span>Активные</span><strong>${Number(s.activeUpcoming || 0)}</strong><small>будущие матчи</small></div>
    <div><span>До 90 мин.</span><strong>${Number(s.dueNext90Minutes || 0)}</strong><small>скоро к отправке</small></div>
    <div><span>Pre-match 24ч</span><strong>${Number(s.prematchSent24h || 0)}</strong><small>доставлено</small></div>
    <div><span>Kickoff 24ч</span><strong>${Number(s.kickoffSent24h || 0)}</strong><small>доставлено</small></div>
    <div><span>Ошибки 24ч</span><strong>${Number(s.failed24h || 0)}</strong><small>видны в Monitor</small></div>
    <div><span>Claims</span><strong>${Number(s.activeClaims || 0)}</strong><small>${Number(s.staleClaims || 0)} stale</small></div>
  </div>`;

  recent.innerHTML = (r.recent || []).length
    ? `<div class="reminder-health-list">${r.recent.map(x => `
      <div class="${x.hasError ? 'error' : 'ok'}">
        <div><strong>${escapeHtml(x.match || `Матч #${x.fixtureId}`)}</strong><small>${x.fixtureDate ? dateTime(x.fixtureDate) : ''}</small></div>
        <span>${escapeHtml(x.state || '')}</span>
        <em>${Number(x.prematchAttempts || 0)} + ${Number(x.kickoffAttempts || 0)} попыт.</em>
      </div>`).join('')}</div><p class="tiny">${escapeHtml(r.note || '')}</p>`
    : '<div class="empty compact-empty">Недавних попыток доставки пока нет.</div>';
}

async function loadReminderHealth(force = false) {
  if (!isAdmin() || state.reminderHealthLoading) return;
  if (!force && state.reminderHealth) { renderReminderHealth(); return; }
  state.reminderHealthLoading = true;
  renderReminderHealth();
  try {
    state.reminderHealth = await api('/api/reminder-health', { retry: false, timeoutMs: 12000 });
  } catch (e) {
    state.reminderHealth = { available: false, reason: e.message };
  } finally {
    state.reminderHealthLoading = false;
    renderReminderHealth();
  }
}

async function sendReminderTest() {
  if (!isAdmin() || state.reminderHealthLoading) return;
  state.reminderHealthLoading = true;
  renderReminderHealth();
  try {
    const result = await api('/api/reminder-health', {
      method: 'POST',
      body: JSON.stringify({ action: 'test' }),
      retry: false,
      dedupe: false,
      timeoutMs: 12000,
    });
    toast(result.message || 'Тест отправлен');
    state.reminderHealth = null;
  } catch (e) {
    toast(e.message);
  } finally {
    state.reminderHealthLoading = false;
    await loadReminderHealth(true);
  }
}

function releaseMonitorStateLabel(stateValue) {
  return stateValue === 'healthy' ? 'STABLE' : stateValue === 'watch' ? 'WATCH' : stateValue === 'incident' ? 'INCIDENT' : 'WAIT';
}

function releaseMonitorDelta(value) {
  const n = Number(value || 0);
  if (!n) return '0';
  return `${n > 0 ? '+' : ''}${n}`;
}

function renderReleaseMonitor() {
  if (!isAdmin()) return;
  const badge = $('releaseMonitorBadge');
  const title = $('releaseMonitorStatus');
  const meta = $('releaseMonitorMeta');
  const kpis = $('releaseMonitorKpis');
  const client = $('releaseMonitorClient');
  const issues = $('releaseMonitorIssues');
  const incidents = $('releaseMonitorIncidents');
  if (!badge || !title || !meta || !kpis || !client || !issues || !incidents) return;

  if (state.releaseMonitorLoading) {
    badge.className = 'release-monitor-badge running';
    badge.textContent = 'RUN';
    title.textContent = 'Собираю операционные события…';
    meta.textContent = 'Без API-Football';
    kpis.innerHTML = client.innerHTML = issues.innerHTML = incidents.innerHTML = '';
    return;
  }

  const r = state.releaseMonitor;
  if (!r?.available) {
    badge.className = 'release-monitor-badge';
    badge.textContent = 'ОЖИДАНИЕ';
    title.textContent = 'Мониторинг выпуска ещё не запускался.';
    meta.textContent = 'Показывает ошибки, восстановление клиента и операционные лимиты.';
    kpis.innerHTML = client.innerHTML = issues.innerHTML = incidents.innerHTML = '';
    return;
  }

  const health = r.health || {};
  badge.className = `release-monitor-badge ${escapeHtml(health.state || '')}`;
  badge.textContent = releaseMonitorStateLabel(health.state);
  title.textContent = health.label || 'Мониторинг выпуска';
  meta.textContent = `${Number(health.score || 0)}% · ${Number(r.hours || 24)}ч · ${r.persistent ? 'журнал событий' : 'память процесса'} · ${relativeAge(r.generatedAt)}`;

  const c = r.current || {};
  const p = r.previous || {};
  const budget = c.operationalBudget || {};
  kpis.innerHTML = `<div class="release-monitor-kpis">
    <div><span>Ошибки</span><strong>${Number(c.errorLike || 0)}</strong><small>${releaseMonitorDelta(r.trend?.errorsDelta)} к прошлому периоду</small></div>
    <div><span>Warnings</span><strong>${Number(c.warningLike || 0)}</strong><small>${releaseMonitorDelta(r.trend?.warningsDelta)} к прошлому периоду</small></div>
    <div><span>Ops budget</span><strong>${Number(budget.remaining || 0)}/${Number(budget.allowance || 0)}</strong><small>${budget.exhausted ? 'превышен' : 'остаток событий'}</small></div>
    <div><span>Событий</span><strong>${Number(c.total || 0)}</strong><small>предыдущий период ${Number(p.total || 0)}</small></div>
  </div>`;

  const cc = c.client || {};
  client.innerHTML = `<div class="release-monitor-section-head"><strong>📱 Client telemetry</strong><span>allowlist · без пользовательского контента</span></div>
    <div class="release-client-grid">
      <div><span>Boot OK</span><strong>${Number(cc.bootOk || 0)}</strong></div>
      <div><span>Boot recovery</span><strong>${Number(cc.bootRecovery || 0)}</strong></div>
      <div><span>Compatibility block</span><strong>${Number(cc.compatibilityBlocks || 0)}</strong></div>
      <div><span>Client errors</span><strong>${Number(cc.clientErrors || 0)}</strong></div>
      <div><span>Network recovery</span><strong>${Number(cc.networkRecovery || 0)}</strong></div>
    </div>`;

  const codes = c.topCodes || [];
  issues.innerHTML = `<div class="release-monitor-section-head"><strong>Главные сигналы</strong><span>warning/error/critical</span></div>
    ${codes.length ? `<div class="release-issue-list">${codes.map(x => `<div><strong>${escapeHtml(x.key)}</strong><span>${Number(x.count || 0)}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Ошибок и предупреждений за период нет.</div>'}`;

  const rows = r.incidents || [];
  incidents.innerHTML = `<details class="release-incidents"><summary>Последние события · ${rows.length}</summary>
    <div>${rows.length ? rows.map(x => `<article class="${escapeHtml(x.severity || 'warning')}">
      <div><strong>${escapeHtml(x.code || x.source || '')}</strong><span>${escapeHtml(dateTime(x.createdAt))}</span></div>
      <p>${escapeHtml(x.message || '')}</p>
      <small>${escapeHtml(x.source || '')}${x.endpoint ? ` · ${escapeHtml(x.endpoint)}` : ''}</small>
    </article>`).join('') : '<div class="empty compact-empty">Нет событий.</div>'}</div>
  </details>
  <p class="tiny">${escapeHtml(r.policy?.note || '')}</p>`;
}

async function loadReleaseMonitor(force = false) {
  if (!isAdmin() || state.releaseMonitorLoading) return;
  if (!force && state.releaseMonitor) { renderReleaseMonitor(); return; }
  state.releaseMonitorLoading = true;
  renderReleaseMonitor();
  try {
    const hours = Number($('releaseMonitorPeriod')?.value || state.releaseMonitorHours || 24);
    state.releaseMonitorHours = hours;
    state.releaseMonitor = await api(`/api/release-monitor?hours=${hours}${force ? '&refresh=1' : ''}`, {
      retry: false,
      timeoutMs: 12000,
    });
  } catch (e) {
    state.releaseMonitor = { available: false, reason: e.message };
    toast(e.message);
  } finally {
    state.releaseMonitorLoading = false;
    renderReleaseMonitor();
  }
}

function renderDiagnostics() {
  const root = $('diagnosticsStatus');
  if (!root) return;
  const d = state.diagnostics;
  const badge = $('diagnosticsBadge');
  const updated = $('diagnosticsUpdated');
  const provider = $('diagnosticsProvider');
  const database = $('diagnosticsDatabase');
  const runtime = $('diagnosticsRuntime');
  const client = $('diagnosticsClient');
  const integrity = $('diagnosticsIntegrity');
  const events = $('diagnosticsEvents');
  const recommendations = $('diagnosticsRecommendations');
  if (state.diagnosticsLoading) {
    root.textContent = 'Проверяю сервер, Supabase, кэш и API-Football…';
    if (badge) { badge.textContent = 'Проверка'; badge.className = 'diagnostics-badge waiting'; }
    [provider, database, runtime, client, integrity, events, recommendations].forEach(x => { if (x) x.hidden = true; });
    return;
  }
  if (!d) {
    root.textContent = 'Диагностика ещё не загружена.';
    if (badge) { badge.textContent = 'Нет данных'; badge.className = 'diagnostics-badge'; }
    return;
  }

  const overall = d.overall || {};
  root.textContent = overall.label || 'Состояние системы получено.';
  if (badge) {
    badge.textContent = diagnosticsStateLabel(overall.state);
    badge.className = `diagnostics-badge ${escapeHtml(overall.state || '')}`;
  }
  if (updated) updated.textContent = d.generatedAt ? `Проверено ${relativeAge(d.generatedAt)}` : '';

  const p = d.provider || {};
  if (provider) {
    provider.hidden = false;
    provider.innerHTML = `
      <div class="diagnostics-block-head"><strong>API-Football</strong><span>${escapeHtml(p.health || 'waiting')}</span></div>
      <div class="diagnostics-grid">
        <div><span>План</span><strong>${escapeHtml(p.plan || 'UNKNOWN')}</strong><small>${p.lastStatus ? `HTTP ${Number(p.lastStatus)}` : 'ответ ещё не получен'}</small></div>
        <div><span>Сегодня использовано</span><strong>${Number.isFinite(Number(p.dailyUsed)) && Number.isFinite(Number(p.dailyLimit)) ? `${Number(p.dailyUsed)} / ${Number(p.dailyLimit)}` : '—'}</strong><small>${diagPct(p.dailyUsedPct)}</small></div>
        <div><span>Минутное окно</span><strong>${Number.isFinite(Number(p.minuteUsed)) && Number.isFinite(Number(p.minuteLimit)) ? `${Number(p.minuteUsed)} / ${Number(p.minuteLimit)}` : '—'}</strong><small>${diagPct(p.minuteUsedPct)}</small></div>
        <div><span>Последний ответ</span><strong>${Number.isFinite(Number(p.lastLatencyMs)) ? `${Number(p.lastLatencyMs)} мс` : '—'}</strong><small>${p.lastSuccessAt ? relativeAge(p.lastSuccessAt) : (p.lastError || 'нет данных')}</small></div>
      </div>
      ${p.cooldownActive ? `<p class="diagnostics-warning">⏳ Пауза из-за лимита запросов активна до ${escapeHtml(dateTime(p.cooldownUntil))}.</p>` : ''}`;
  }

  const db = d.supabase || {};
  const cache = db.cache || {};
  const obs = d.observability || {};
  if (database) {
    database.hidden = false;
    database.innerHTML = `
      <div class="diagnostics-block-head"><strong>Supabase + cache</strong><span>${db.ok ? 'online' : escapeHtml(db.status || 'offline')}</span></div>
      <div class="diagnostics-grid">
        <div><span>PostgREST</span><strong>${db.ok ? 'OK' : 'Ошибка'}</strong><small>${Number.isFinite(Number(db.latencyMs)) ? `${Number(db.latencyMs)} мс` : '—'}</small></div>
        <div><span>Записей cache</span><strong>${Number.isFinite(Number(cache.total)) ? Number(cache.total) : '—'}</strong><small>выборка ${Number(cache.sampled || 0)}</small></div>
        <div><span>Свежие / stale</span><strong>${Number(cache.freshInSample || 0)} / ${Number(cache.staleInSample || 0)}</strong><small>в диагностической выборке</small></div>
        <div><span>Журнал ошибок</span><strong>${obs.persistent ? 'Supabase' : 'Memory'}</strong><small>${obs.migrationReady ? `хранение ${Number(obs.retentionDays || 14)} дн.` : 'нужна миграция v3.8'}</small></div>
      </div>`;
  }

  const rt = d.runtime || {};
  if (runtime) {
    runtime.hidden = false;
    runtime.innerHTML = `
      <div class="diagnostics-block-head"><strong>Текущий Worker</strong><span>runtime</span></div>
      <div class="diagnostics-grid">
        <div><span>API запросов</span><strong>${Number(rt.apiRequests || 0)}</strong><small>успех ${diagPct(rt.apiSuccessRate)}</small></div>
        <div><span>Cache hit</span><strong>${diagPct(rt.cacheHitRate)}</strong><small>${Number(rt.cacheHits || 0)} hit · ${Number(rt.cacheMisses || 0)} miss</small></div>
        <div><span>Rate limits</span><strong>${Number(rt.rateLimits || 0)}</strong><small>${Number(rt.quotaBlocks || 0)} запроса остановлено quota guard</small></div>
        <div><span>Burst guard</span><strong>${Number(rt.burstBlocks || 0)}</strong><small>${Number(rt.singleflightJoins || 0)} singleflight joins</small></div>
        <div><span>Upstream timeout</span><strong>${Number(rt.upstreamTimeouts || 0)}</strong><small>${Number(rt.userSyncSkips || 0)} user sync записей пропущено</small></div>
        <div><span>L1 cache</span><strong>${Number(rt.l1CacheEntries || 0)}</strong><small>${Number(rt.memoryPrunes || 0)} memory prune</small></div>
        <div><span>Ошибки маршрутов</span><strong>${Number(rt.routeErrors || 0)}</strong><small>uptime ${escapeHtml(diagDuration(rt.uptimeSeconds))}</small></div>
      </div>
      <p class="tiny diagnostics-note">Счётчики runtime относятся только к текущему экземпляру Cloudflare Worker. Дневной и минутный расход выше берётся непосредственно из заголовков API-Football.</p>`;
  }

  if (client) {
    const cp = state.clientPerf || {};
    const avg = Number(cp.completed || 0) > 0 ? Math.round(Number(cp.totalMs || 0) / Number(cp.completed)) : null;
    client.hidden = false;
    client.innerHTML = `<div class="diagnostics-block-head"><strong>📱 Клиент Mini App</strong><span>v5.1</span></div><div class="diagnostics-grid">
      <div><span>Сеть</span><strong>${navigator.onLine === false ? 'Offline' : 'Online'}</strong><small>${navigator.connection?.effectiveType ? escapeHtml(navigator.connection.effectiveType) : 'тип сети —'}</small></div>
      <div><span>Средний API</span><strong>${avg !== null ? `${avg} мс` : '—'}</strong><small>последний ${cp.lastMs !== null ? `${cp.lastMs} мс` : '—'}</small></div>
      <div><span>Запросы</span><strong>${Number(cp.requests || 0)}</strong><small>${Number(cp.completed || 0)} успешно · ${Number(cp.failed || 0)} ошибок</small></div>
      <div><span>Оптимизация</span><strong>${Number(cp.deduped || 0)} dedupe</strong><small>${Number(cp.retries || 0)} авто-повторов</small></div>
      <div><span>Защита клиента</span><strong>${Number(cp.rateLimited || 0)} × 429</strong><small>${Number(cp.timeouts || 0)} timeout</small></div>
      <div><span>Recovery UX</span><strong>${Number(cp.recoveries || 0)} recovery</strong><small>${Number(cp.degradedEvents || 0)} degraded events</small></div>
      <div><span>Состояние сети</span><strong>${escapeHtml(state.network.mode || 'online')}</strong><small>${state.network.lastRecoveredAt ? `recovered ${escapeHtml(relativeAge(state.network.lastRecoveredAt))}` : 'без восстановлений'}</small></div>
      <div><span>Startup</span><strong>${Number.isFinite(Number(cp.bootMs)) ? `${Number(cp.bootMs)} мс` : '—'}</strong><small>${state.startup.manifestOk ? 'manifest OK' : `${Number(cp.manifestFailures || 0)} manifest fail`}</small></div>
      <div><span>API contract</span><strong>${CLIENT_API_CONTRACT}</strong><small>${escapeHtml(state.appManifest?.releaseChannel || CLIENT_RELEASE_CHANNEL)} · min ${escapeHtml(state.appManifest?.minClientVersion || '—')}</small></div>
    </div>`;
  }

  const integrityData = d.integrity || {};
  const integrityRun = integrityData.lastRun || {};
  const integrityIssues = integrityData.recentIssues || [];
  if (integrity) {
    integrity.hidden = false;
    integrity.innerHTML = `
      <div class="diagnostics-block-head"><strong>Целостность матчей</strong><span>${escapeHtml(integrityRun.health || (integrityData.migrationReady ? 'waiting' : 'migration'))}</span></div>
      <div class="diagnostics-grid">
        <div><span>Проверено</span><strong>${integrityRun.inspected ?? '—'}</strong><small>${integrityRun.observedAt ? relativeAge(integrityRun.observedAt) : 'ещё нет запуска'}</small></div>
        <div><span>Quality score</span><strong>${Number.isFinite(Number(integrityRun.qualityScore)) ? `${Math.round(Number(integrityRun.qualityScore))}%` : '—'}</strong><small>${Number(integrityRun.clean || 0)} без замечаний</small></div>
        <div><span>Скрыто guard</span><strong>${Number(integrityRun.quarantined || 0)}</strong><small>${Number(integrityRun.duplicates || 0)} дубликатов</small></div>
        <div><span>Предупреждения</span><strong>${Number(integrityRun.warnings || 0)}</strong><small>${Number(integrityRun.errors || 0)} ошибок</small></div>
      </div>
      ${!integrityData.migrationReady ? '<p class="diagnostics-warning">Нужна миграция v3.9 для постоянного журнала целостности данных.</p>' : ''}
      ${integrityIssues.length ? `<div class="integrity-issue-list">${integrityIssues.slice(0,5).map(item => `<div><b>${escapeHtml(item.issue_code || item.code || 'DATA')}</b><span>${escapeHtml(item.message || '')}</span><small>${escapeHtml([item.home_name || item.home, item.away_name || item.away].filter(Boolean).join(' — '))}${item.fixture_id || item.fixtureId ? ` · #${Number(item.fixture_id || item.fixtureId)}` : ''}</small></div>`).join('')}</div>` : ''}`;
  }

  const recent = obs.recentEvents || [];
  if (events) {
    events.hidden = false;
    events.innerHTML = `
      <div class="diagnostics-block-head"><strong>Последние события</strong><span>${recent.length}</span></div>
      <div class="diagnostics-events">${recent.length ? recent.slice(0, 8).map(item => `
        <div class="diagnostics-event ${escapeHtml(item.severity || 'info')}">
          <i></i><div><strong>${escapeHtml(item.code || item.event_type || 'EVENT')}</strong><span>${escapeHtml(item.message || 'Без описания')}</span><small>${escapeHtml(item.source || 'worker')}${item.endpoint ? ` · ${escapeHtml(item.endpoint)}` : ''} · ${item.created_at ? escapeHtml(relativeAge(item.created_at)) : ''}</small></div>
        </div>`).join('') : '<div class="empty compact-empty">Ошибок и предупреждений пока нет.</div>'}</div>`;
  }

  if (recommendations) {
    recommendations.hidden = false;
    recommendations.innerHTML = `
      <div class="diagnostics-block-head"><strong>Что делать</strong><span>автопроверка</span></div>
      <ul class="diagnostics-actions">${(d.recommendations || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
  }
}

async function loadDiagnostics(force = false) {
  if (!isAdmin()) return;
  if (state.diagnosticsLoading) return;
  state.diagnosticsLoading = true;
  renderDiagnostics();
  try {
    state.diagnostics = await api(`/api/diagnostics${force ? '?refresh=1' : ''}`);
    if (state.diagnostics?.provider) {
      state.provider = state.diagnostics.provider;
      renderProvider();
    }
  } catch (e) {
    state.diagnostics = { overall: { state: 'critical', label: e.message || 'Не удалось загрузить диагностику.' }, recommendations: ['Повторите проверку после обновления приложения.'] };
  } finally {
    state.diagnosticsLoading = false;
    renderDiagnostics();
  }
}

function renderBilling() {
  if (!$('billingStatus')) return;
  const b = state.billing;
  const quota = state.profile?.quota || {};
  const currentPlan = String(b?.current?.plan || quota.plan || 'FREE').toUpperCase();
  const currentUntil = b?.current?.subscriptionUntil || state.profile?.billing?.subscriptionUntil || null;
  const canceled = Boolean(b?.current?.canceled ?? state.profile?.billing?.canceled);

  document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
    card.classList.toggle('current', card.dataset.plan === currentPlan);
  });

  const pro = b?.plans?.PRO || { stars: 199, dailyLimit: 20 };
  const premium = b?.plans?.PREMIUM || { stars: 399, dailyLimit: 100 };
  if ($('proPrice')) $('proPrice').textContent = `${pro.stars} ⭐ / 30 дней`;
  if ($('premiumPrice')) $('premiumPrice').textContent = `${premium.stars} ⭐ / 30 дней`;
  if ($('proLimit')) $('proLimit').textContent = `${pro.dailyLimit} анализов / день`;
  if ($('premiumLimit')) $('premiumLimit').textContent = `${premium.dailyLimit} анализов / день`;

  const ready = Boolean(b?.ready);
  $('billingStatus').className = `billing-status ${ready ? 'ready' : 'waiting'}`;
  $('billingStatus').textContent = ready
    ? '⭐ Telegram Stars подключены. Оплата и автопродление готовы.'
    : '⚙️ Telegram Stars подготовлены, но обработчик платежей ещё не активирован.';

  const proBtn = $('proBtn');
  const premiumBtn = $('premiumBtn');
  [proBtn, premiumBtn].forEach(btn => { if (btn) btn.disabled = !ready; });
  if (proBtn) proBtn.textContent = currentPlan === 'PRO' ? 'Текущий PRO' : `Подключить за ${pro.stars} ⭐`;
  if (premiumBtn) premiumBtn.textContent = currentPlan === 'PREMIUM' ? 'Текущий PREMIUM' : `Подключить за ${premium.stars} ⭐`;
  if (proBtn && currentPlan === 'PRO') proBtn.disabled = true;
  if (premiumBtn && currentPlan === 'PREMIUM') premiumBtn.disabled = true;

  const details = $('subscriptionDetails');
  const manage = $('subscriptionManageBtn');
  if (currentPlan !== 'FREE' && currentUntil) {
    details.hidden = false;
    details.innerHTML = `<strong>${escapeHtml(currentPlan)}</strong><span>Активен до ${escapeHtml(dateTime(currentUntil))}${canceled ? ' · автопродление отключено' : ' · автопродление включено'}</span>`;
    manage.hidden = false;
    manage.textContent = canceled ? '↻ Возобновить автопродление' : 'Отключить автопродление';
    manage.dataset.action = canceled ? 'resume' : 'cancel';
  } else {
    details.hidden = true;
    manage.hidden = true;
  }
}

async function loadBilling() {
  try {
    state.billing = await api('/api/billing/plans');
    renderBilling();
  } catch (e) {
    state.billing = { ready: false };
    renderBilling();
  }
}

async function syncBilling(showToast = true) {
  try {
    const result = await api('/api/billing/sync', { method: 'POST', body: '{}' });
    await loadProfile();
    await loadBilling();
    if (showToast) toast(result.synced ? 'Подписка синхронизирована' : 'Новых платежей не найдено');
  } catch (e) { if (showToast) toast(e.message); }
}

async function buyPlan(plan) {
  if (!state.billing?.ready) {
    toast('Оплата ещё не активирована администратором.');
    return;
  }
  if (!tg?.openInvoice) {
    toast('Оплата доступна только внутри Telegram.');
    return;
  }
  try {
    const invoice = await api('/api/billing/invoice', { method: 'POST', body: JSON.stringify({ plan }) });
    tg.openInvoice(invoice.invoiceUrl, async status => {
      const value = typeof status === 'string' ? status : status?.status;
      if (value === 'paid') {
        toast('Платёж принят. Активируем подписку…');
        await new Promise(resolve => setTimeout(resolve, 700));
        await syncBilling(false);
        toast(`${plan} активирован`);
      } else if (value === 'pending') {
        toast('Платёж обрабатывается. Нажмите «Проверить оплату» через несколько секунд.');
      } else if (value === 'failed') {
        toast('Telegram не смог завершить платёж.');
      }
    });
  } catch (e) { toast(e.message); }
}

async function manageSubscription(action) {
  try {
    const data = await api('/api/billing/subscription', { method: 'POST', body: JSON.stringify({ action }) });
    await loadProfile();
    await loadBilling();
    toast(data.canceled ? 'Автопродление отключено' : 'Автопродление включено');
  } catch (e) { toast(e.message); }
}

function providerAuditStateLabel(stateValue) {
  return ({
    available: 'Данные',
    empty: 'Пусто',
    error: 'Ошибка',
    preview: 'После повышения тарифа',
    not_applicable: 'Не нужно',
  })[stateValue] || '—';
}

function renderProviderAudit() {
  if (!isAdmin()) return;
  const transition = state.providerTransition || {};
  const audit = state.providerAudit;
  const status = $('providerAuditStatus');
  const result = $('providerAuditResult');
  const runBtn = $('providerAuditBtn');
  const probeBtn = $('providerProbeBtn');

  if ($('providerTransitionMode')) $('providerTransitionMode').textContent = transition.label || 'Ожидаем тариф';
  if ($('providerRefreshCadence')) $('providerRefreshCadence').textContent = transition.liveRefreshSeconds ? `${transition.liveRefreshSeconds} сек.` : '—';
  if ($('providerExpectedDaily')) $('providerExpectedDaily').textContent = transition.expected?.daily ? String(transition.expected.daily) : '—';
  if ($('providerExpectedMinute')) $('providerExpectedMinute').textContent = transition.expected?.minute ? String(transition.expected.minute) : '—';

  const budget = state.providerBudget || {};
  if ($('quotaBudgetMode')) $('quotaBudgetMode').textContent = budget.label || 'Ожидаем данные';
  if ($('quotaBudgetDaily')) $('quotaBudgetDaily').textContent = Number.isFinite(Number(budget.daily?.remaining))
    ? `${budget.daily.remaining} · резерв ${Number(budget.daily?.reserve || 0)}` : '—';
  if ($('quotaBudgetMinute')) $('quotaBudgetMinute').textContent = Number.isFinite(Number(budget.minute?.remaining))
    ? `${budget.minute.remaining} · резерв ${Number(budget.minute?.reserve || 0)}` : '—';
  if ($('quotaFeatureApi')) $('quotaFeatureApi').textContent = String(Number(budget.counters?.api || 0));
  if ($('quotaFeatureCache')) $('quotaFeatureCache').textContent = String(Number(budget.counters?.cache || 0));
  if ($('quotaFeatureStale')) $('quotaFeatureStale').textContent = String(Number(budget.counters?.stale || 0));
  if ($('quotaFeatureSkipped')) $('quotaFeatureSkipped').textContent = String(Number(budget.counters?.skipped || 0));
  if ($('quotaBudgetNote')) $('quotaBudgetNote').textContent = budget.note || 'Кэш отдельных функций активен.';

  const featureList = $('quotaFeatureList');
  if (featureList) {
    const rows = Object.entries(budget.counters?.byFeature || {});
    featureList.innerHTML = rows.length ? rows.map(([name, c]) => `
      <div class="quota-feature-row">
        <strong>${escapeHtml(name)}</strong>
        <span>API ${Number(c.api || 0)}</span>
        <span>cache ${Number(c.cache || 0)}</span>
        <span>stale ${Number(c.stale || 0)}</span>
        <span>skip ${Number(c.skipped || 0)}</span>
      </div>`).join('') : '<div class="empty compact-empty">Счётчики появятся после Match Center.</div>';
  }

  if (runBtn) runBtn.disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);
  if (probeBtn) probeBtn.disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);
  if ($('providerE2EBtn')) $('providerE2EBtn').disabled = Boolean(state.providerAuditLoading || state.providerE2ELoading);

  if (!status || !result) return;
  if (state.providerAuditLoading) {
    status.textContent = '⏳ Выполняю контролируемую проверку источников данных…';
    result.hidden = true;
    return;
  }
  if (!audit) {
    status.textContent = transition.paid
      ? 'Тариф обнаружен. Укажите ID матча и запустите проверку.'
      : 'Сначала обновите тариф. На бесплатном плане полная проверка будет заблокирована для экономии квоты.';
    result.hidden = true;
    return;
  }

  result.hidden = false;
  const summary = audit.summary || {};
  const blocked = Boolean(audit.blocked);
  status.textContent = blocked
    ? (audit.note || 'Полная проверка заблокирована защитой квоты.')
    : `${summary.label || 'Проверка завершена'} · ${Number(summary.score || 0)}% · ${Number(audit.durationMs || 0)} мс`;

  const fixture = audit.fixture || {};
  const endpoints = audit.endpoints || [];
  result.innerHTML = `
    <div class="provider-audit-head">
      <div><strong>${escapeHtml(fixture.home || '—')} — ${escapeHtml(fixture.away || '—')}</strong><span>Матч #${Number(fixture.fixtureId || 0)} · ${escapeHtml(fixture.status || '')}</span></div>
      <span class="provider-audit-score ${blocked ? 'blocked' : Number(summary.score || 0) >= 80 ? 'good' : 'warn'}">${blocked ? 'ЗАЩИТА' : `${Number(summary.score || 0)}%`}</span>
    </div>
    <div class="provider-audit-cost">
      <span>Запросов этого запуска</span><strong>${Number(audit.cost?.usedNow || 0)}</strong>
      <small>полная проверка максимум ${Number(audit.cost?.maxFullAudit || 0)}</small>
    </div>
    <div class="provider-endpoint-grid">${endpoints.map(x => `
      <div class="provider-endpoint-row ${escapeHtml(x.state || '')}">
        <div><strong>${escapeHtml(x.label || x.key || '')}</strong><small>${escapeHtml(x.note || '')}</small></div>
        <span>${providerAuditStateLabel(x.state)}</span>
        <em>${Number.isFinite(Number(x.latencyMs)) ? `${Number(x.latencyMs)} мс` : ''}</em>
      </div>`).join('')}</div>
    <p class="tiny">${escapeHtml(audit.note || '')}</p>`;
}


function e2eStepIcon(stateValue) {
  return stateValue === 'pass' ? '✓'
    : stateValue === 'fail' ? '×'
      : stateValue === 'warn' ? '!'
        : stateValue === 'hold' ? '⏸' : '•';
}

function e2eStepLabel(stateValue) {
  return stateValue === 'pass' ? 'OK'
    : stateValue === 'fail' ? 'Ошибка'
      : stateValue === 'warn' ? 'Проверить'
        : stateValue === 'hold' ? 'Ожидание' : '—';
}

function renderExpandedDataReleaseGate() {
  if (!isAdmin()) return;
  const result = state.providerE2E;
  const transition = state.providerTransition || {};
  const budget = state.providerBudget || {};
  const badge = $('expandedGateBadge');
  const title = $('expandedGateTitle');
  const meta = $('expandedGateMeta');
  const stepsEl = $('expandedGateSteps');
  const details = $('expandedGateDetails');
  const btn = $('providerE2EBtn');

  if (btn) btn.disabled = Boolean(state.providerE2ELoading || state.providerAuditLoading);
  if (!badge || !title || !meta || !stepsEl || !details) return;

  if (state.providerE2ELoading) {
    badge.className = 'expanded-gate-badge running';
    badge.textContent = 'ВЫП.';
    title.textContent = 'Выполняется сквозная проверка расширенных данных…';
    meta.textContent = 'На повышенной квоте проверка может занять несколько десятков секунд.';
    stepsEl.innerHTML = '<div class="empty compact-empty">Проверяю провайдера → покрытие → центр матча → повторное использование кэша.</div>';
    details.hidden = true;
    return;
  }

  if (!result) {
    const paid = Boolean(transition.paid);
    badge.className = `expanded-gate-badge ${paid ? 'ready' : 'hold'}`;
    badge.textContent = paid ? 'ГОТОВ?' : 'ОЖИДАНИЕ';
    title.textContent = paid ? 'Тариф обнаружен — можно запускать сквозную проверку' : 'Сквозная проверка расширенных данных';
    meta.textContent = paid
      ? `${planLabel(transition.plan || 'PAID')} · ${budget.label || 'режим не определён'}`
      : `${planLabel(transition.plan || 'FREE')} · полная проверка не тратит квоту до повышения тарифа`;
    stepsEl.innerHTML = `
      <div class="expanded-gate-empty">
        <strong>${paid ? 'Запустите финальную проверку на реальном матче.' : 'На бесплатном плане проверка безопасно остановится после одного запроса состояния.'}</strong>
        <p>Пользовательская монетизация остаётся выключенной.</p>
      </div>`;
    details.hidden = true;
    return;
  }

  const status = result.status || {};
  const cls = status.code === 'READY' ? 'ready'
    : status.code === 'READY_WITH_LIMITATIONS' ? 'warn'
      : status.code === 'NEEDS_ATTENTION' ? 'fail' : 'hold';
  badge.className = `expanded-gate-badge ${cls}`;
  badge.textContent = status.code === 'READY' ? 'ГОТОВО'
    : status.code === 'READY_WITH_LIMITATIONS' ? 'ОГРАН.'
      : status.code === 'NEEDS_ATTENTION' ? 'ПРОВЕРИТЬ' : 'ОЖИДАНИЕ';
  title.textContent = status.label || 'Сквозная проверка расширенных данных';
  meta.textContent = `Матч #${Number(result.fixtureId || 0)} · ${dateTime(result.generatedAt)} · ${Number(result.durationMs || 0)} мс`;

  stepsEl.innerHTML = (result.steps || []).map(step => `
    <div class="expanded-gate-step ${escapeHtml(step.state || '')}">
      <span>${e2eStepIcon(step.state)}</span>
      <div><strong>${escapeHtml(step.label || '')}</strong><small>${escapeHtml(step.note || '')}</small></div>
      <em>${e2eStepLabel(step.state)}</em>
    </div>`).join('');

  details.hidden = false;
  const coverage = result.coverageAudit?.summary;
  const freshness = result.matchCenter?.dataFreshness || {};
  const sourceCounts = Object.values(freshness).reduce((acc, x) => {
    const key = x?.source || 'other';
    acc[key] = Number(acc[key] || 0) + 1;
    return acc;
  }, {});
  details.innerHTML = `
    <div class="expanded-gate-metrics">
      <div><span>План</span><strong>${escapeHtml(result.transition?.plan || '—')}</strong></div>
      <div><span>Покрытие</span><strong>${coverage ? `${Number(coverage.score || 0)}%` : '—'}</strong></div>
      <div><span>Повтор из кэша</span><strong>${result.cacheVerification?.cached ? 'PASS' : result.blocked ? '—' : 'CHECK'}</strong></div>
      <div><span>Daily cost</span><strong>${Number.isFinite(Number(result.requestCost?.observedDailyDelta)) ? Number(result.requestCost.observedDailyDelta) : '—'}</strong></div>
    </div>
    ${result.matchCenter?.fixture ? `<div class="expanded-gate-fixture">
      <strong>${escapeHtml(result.matchCenter.fixture.home?.name || '')} — ${escapeHtml(result.matchCenter.fixture.away?.name || '')}</strong>
      <span>${escapeHtml(result.matchCenter.mode || '')} · first ${Number(result.matchCenter.firstResponseMs || 0)} мс · second ${Number(result.cacheVerification?.secondResponseMs || 0)} мс</span>
    </div>` : ''}
    ${Object.keys(sourceCounts).length ? `<div class="expanded-gate-sources">${Object.entries(sourceCounts).map(([key,value]) => `<span>${escapeHtml(key)} <b>${Number(value)}</b></span>`).join('')}</div>` : ''}
    <p class="tiny">${escapeHtml(result.note || '')}</p>`;
}

async function runProviderE2E(fixtureId) {
  if (!isAdmin() || state.providerE2ELoading || state.providerAuditLoading) return;
  const id = Number(fixtureId || $('providerAuditFixtureId')?.value || 0);
  if (!id) { toast('Укажите ID матча'); return; }
  if ($('providerAuditFixtureId')) $('providerAuditFixtureId').value = String(id);

  state.providerE2ELoading = true;
  renderExpandedDataReleaseGate();
  try {
    const data = await api(`/api/provider/e2e-validation?fixtureId=${id}`, {
      retry: false,
      dedupe: false,
      timeoutMs: 60000,
    });
    state.providerE2E = data;
    state.provider = data.provider || state.provider;
    state.providerTransition = data.transition || state.providerTransition;
    state.providerBudget = data.budget || state.providerBudget;
    if (data.coverageAudit) state.providerAudit = { ...data.coverageAudit, fixture: data.coverageAudit.fixture || state.providerAudit?.fixture };
    toast(data.status?.ready ? 'Сквозная проверка расширенных данных пройдена' : (data.status?.label || 'Сквозная проверка завершена'));
  } catch (e) {
    toast(e.message);
  } finally {
    state.providerE2ELoading = false;
    renderProvider();
  }
}

function renderProvider() {
  if (!isAdmin()) return;
  const p = state.provider || {};
  if (!$('providerPlan')) return;
  $('providerPlan').textContent = p.plan && p.plan !== 'UNKNOWN' ? p.plan : 'Определяется';
  $('providerDaily').textContent = Number.isFinite(Number(p.dailyRemaining)) && Number.isFinite(Number(p.dailyLimit))
    ? `${p.dailyRemaining} / ${p.dailyLimit}` : '—';
  $('providerMinute').textContent = Number.isFinite(Number(p.minuteRemaining)) && Number.isFinite(Number(p.minuteLimit))
    ? `${p.minuteRemaining} / ${p.minuteLimit}` : '—';
  $('providerLiveOdds').textContent = p.liveOddsReady ? 'Авто · расширенный режим' : 'Экономный режим';
  if ($('providerPlayerStats')) $('providerPlayerStats').textContent = p.playerStatsReady ? 'Авто · расширенный' : 'По требованию';
  if ($('providerOddsMovement')) $('providerOddsMovement').textContent = p.oddsMovementReady ? 'История включена' : 'Экономный режим';
  renderProviderAudit();
  renderExpandedDataReleaseGate();
}

async function loadProvider() {
  if (!isAdmin()) return;
  try {
    const data = await api('/api/provider');
    state.provider = data.provider || state.provider;
    state.providerTransition = data.transition || state.providerTransition;
    state.providerBudget = data.budget || state.providerBudget;
    state.providerAudit = data.lastAudit || state.providerAudit;
    state.providerE2E = data.lastE2E || state.providerE2E;
    state.providerLoaded = true;
    renderProvider();
  } catch {}
}

async function probeProvider() {
  if (!isAdmin() || state.providerAuditLoading) return;
  state.providerAuditLoading = true;
  renderProviderAudit();
  try {
    const data = await api('/api/provider/probe?refresh=1', { retry: false, dedupe: false });
    state.provider = data.provider || state.provider;
    state.providerTransition = data.transition || state.providerTransition;
    try {
      const budgetData = await api('/api/provider/budget', { retry: false });
      state.providerBudget = budgetData.budget || state.providerBudget;
    } catch {}
    toast(data.probe?.ok ? 'Тариф и квоты обновлены' : (data.probe?.note || 'Проверка тарифа завершена'));
  } catch (e) {
    toast(e.message);
  } finally {
    state.providerAuditLoading = false;
    renderProvider();
  }
}

async function runProviderCoverageAudit(fixtureId, force = true) {
  if (!isAdmin() || state.providerAuditLoading) return;
  const id = Number(fixtureId || $('providerAuditFixtureId')?.value || 0);
  if (!id) { toast('Укажите ID матча'); return; }
  if ($('providerAuditFixtureId')) $('providerAuditFixtureId').value = String(id);
  state.providerAuditLoading = true;
  renderProviderAudit();
  try {
    const data = await api(`/api/provider/coverage-audit?fixtureId=${id}${force ? '&refresh=1' : ''}`, {
      retry: false,
      dedupe: false,
      timeoutMs: 30000,
    });
    state.providerAudit = data;
    state.provider = data.provider || state.provider;
    state.providerTransition = data.transition || state.providerTransition;
    try {
      const budgetData = await api('/api/provider/budget', { retry: false });
      state.providerBudget = budgetData.budget || state.providerBudget;
    } catch {}
    toast(data.blocked ? 'Защита не дала потратить лишнюю квоту' : 'Проверка покрытия завершена');
  } catch (e) {
    toast(e.message);
  } finally {
    state.providerAuditLoading = false;
    renderProvider();
  }
}

async function loadFavorites() {
  try {
    const data = await api('/api/favorites');
    state.favorites = data.items || [];
    state.favoritesLoaded = true;
    renderFavoriteTeams();
    if (state.matches.length) renderMatches();
    renderDiscoveryHome();
  } catch (e) {
    toast(e.message);
  }
}

async function loadReminders() {
  try {
    const data = await api('/api/reminders');
    state.reminders = data.items || [];
    state.remindersLoaded = true;
    renderReminderList();
  } catch (e) {
    toast(e.message);
  }
}

function reminderDeliveryBadge(item) {
  const status = String(item?.deliveryStatus || 'scheduled');
  if (status === 'kickoff_sent') return '<span class="reminder-delivery-badge sent">✓ Старт отправлен</span>';
  if (status === 'prematch_sent') return '<span class="reminder-delivery-badge sent">✓ Предматчевое отправлено</span>';
  if (status === 'retry_pending') return '<span class="reminder-delivery-badge retry">↻ Повтор доставки</span>';
  return '<span class="reminder-delivery-badge scheduled">● Запланировано</span>';
}

function renderReminderList() {
  const el = $('reminderList');
  if (!el) return;
  if (!state.reminders.length) {
    el.innerHTML = '<div class="empty compact-empty">Активных напоминаний пока нет.</div>';
    return;
  }
  const rows = [...state.reminders].sort((a, b) => Date.parse(a.fixtureDate || 0) - Date.parse(b.fixtureDate || 0));
  el.innerHTML = rows.map(x => `
    <div class="reminder-row">
      <div>
        <strong>${escapeHtml(x.homeName)} — ${escapeHtml(x.awayName)}</strong>
        <span>${dateTime(x.fixtureDate)} · за ${Number(x.remindBeforeMinutes || 30)} мин.${x.kickoffNotify ? ' · + старт' : ''}</span>
        ${reminderDeliveryBadge(x)}
      </div>
      <button class="reminder-remove" type="button" data-fixture-id="${Number(x.fixtureId)}">Отключить</button>
    </div>`).join('');
  document.querySelectorAll('.reminder-remove').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/reminders?fixtureId=${Number(btn.dataset.fixtureId)}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== Number(btn.dataset.fixtureId));
      renderReminderList();
      if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
      await loadProfile();
      toast('Напоминание отключено');
    } catch (e) { toast(e.message); }
  }));
}

async function savePreferencesFromUi() {
  const payload = {
    defaultFilter: $('defaultFilterSelect')?.value || 'top',
    reminderMinutes: Number($('reminderMinutesSelect')?.value || 30),
    kickoffNotification: Boolean($('kickoffNotificationToggle')?.checked),
    hideYouth: Boolean($('hideYouthToggle')?.checked),
    favoriteFirst: Boolean($('favoriteFirstToggle')?.checked),
  };
  try {
    const data = await api('/api/preferences', { method: 'PUT', body: JSON.stringify(payload) });
    state.preferences = { ...state.preferences, ...(data.preferences || payload) };
    state.profile = state.profile ? { ...state.profile, preferences: state.preferences } : state.profile;
    state.filter = state.preferences.defaultFilter || state.filter;
    syncFilterButtons();
    renderMatches();
    renderProfile();
    toast('Настройки сохранены');
  } catch (e) { toast(e.message); }
}

function favoriteSet() {
  return new Set(state.favorites.map(x => Number(x.teamId)));
}

function isFavorite(teamId) {
  return favoriteSet().has(Number(teamId));
}

async function toggleFavorite(team) {
  const active = isFavorite(team.id);
  try {
    if (active) {
      await api(`/api/favorites?teamId=${Number(team.id)}`, { method: 'DELETE' });
      state.favorites = state.favorites.filter(x => Number(x.teamId) !== Number(team.id));
      toast(`${team.name}: удалено из избранного`);
    } else {
      const data = await api('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ teamId: Number(team.id), teamName: team.name, teamLogo: team.logo || '' }),
      });
      state.favorites = [data.item, ...state.favorites.filter(x => Number(x.teamId) !== Number(team.id))];
      toast(`${team.name}: добавлено в избранное`);
    }
    await loadProfile();
    renderMatches();
    if (state.currentTournament) renderTournamentMatches();
    renderFavoriteTeams();
    renderDiscoveryHome();
  } catch (e) {
    toast(e.message);
  }
}

function renderFavoriteTeams() {
  const el = $('favoriteTeams');
  if (!el) return;
  if (!state.favorites.length) {
    el.innerHTML = '<div class="empty compact-empty">Добавьте любимые команды звёздочкой в списке матчей.</div>';
    return;
  }
  el.innerHTML = state.favorites.map(x => `
    <div class="favorite-team-row">
      <button class="favorite-team-main team-open-link" type="button" data-open-team="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}" data-team-logo="${escapeHtml(x.teamLogo || '')}">
        ${x.teamLogo ? `<img src="${safeUrl(x.teamLogo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
        <strong>${escapeHtml(x.teamName)}</strong>
      </button>
      <button class="favorite-remove" type="button" data-team-id="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}">Удалить</button>
    </div>
  `).join('');
  document.querySelectorAll('.favorite-remove').forEach(btn => btn.addEventListener('click', () => {
    const item = state.favorites.find(x => Number(x.teamId) === Number(btn.dataset.teamId));
    if (item) toggleFavorite({ id: item.teamId, name: item.teamName, logo: item.teamLogo });
  }));
  el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}


function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch { state.storageAvailable = false; return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { state.storageAvailable = false; return false; }
}
function storageRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch { state.storageAvailable = false; return false; }
}

const RECENT_TEAMS_KEY = 'football_recent_teams_v1';

function getRecentTeams() {
  try {
    const rows = JSON.parse(storageGet(RECENT_TEAMS_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(x => Number(x?.id) > 0 && x?.name).slice(0, 10) : [];
  } catch { return []; }
}

function rememberTeam(team) {
  if (!team?.id || !team?.name) return;
  try {
    const row = { id: Number(team.id), name: String(team.name), logo: String(team.logo || ''), country: String(team.country || ''), viewedAt: new Date().toISOString() };
    const next = [row, ...getRecentTeams().filter(x => Number(x.id) !== row.id)].slice(0, 10);
    storageSet(RECENT_TEAMS_KEY, JSON.stringify(next));
  } catch {}
}

function clearRecentTeams() {
  storageRemove(RECENT_TEAMS_KEY)
  renderDiscoveryHome();
}

function discoveryTeamCard(team, badge = '') {
  return `<button class="discovery-team-card" type="button" data-search-team="${Number(team.id)}" data-team-name="${escapeHtml(team.name || '')}" data-team-logo="${escapeHtml(team.logo || '')}" data-team-country="${escapeHtml(team.country || '')}">
    <span class="discovery-team-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</span>
    <span class="discovery-team-copy"><strong>${escapeHtml(team.name || 'Команда')}</strong><small>${escapeHtml(team.country || badge || '')}${team.national ? ' · сборная' : ''}</small></span>
    ${badge ? `<i>${escapeHtml(badge)}</i>` : '<b>›</b>'}
  </button>`;
}

function discoveryCompetitionCard(comp, badge = '') {
  return `<button class="discovery-competition-card" type="button" data-search-competition="${Number(comp.leagueId)}" data-season="${Number(comp.season || new Date().getFullYear())}" data-comp-name="${escapeHtml(comp.name || comp.shortName || 'Турнир')}" data-comp-short="${escapeHtml(comp.shortName || comp.name || 'Турнир')}" data-comp-country="${escapeHtml(comp.country || '')}" data-comp-category="${escapeHtml(comp.category || '')}" data-comp-tier="${escapeHtml(comp.tier || 'standard')}">
    <span class="discovery-comp-icon">🏆</span><span><strong>${escapeHtml(comp.shortName || comp.name || 'Турнир')}</strong><small>${escapeHtml(comp.country || '')}${badge ? ` · ${escapeHtml(badge)}` : ''}</small></span><b>›</b>
  </button>`;
}

function bindDiscoveryActions(root = document) {
  root.querySelectorAll?.('[data-search-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
    id: Number(btn.dataset.searchTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '', country: btn.dataset.teamCountry || '',
  })));
  root.querySelectorAll?.('[data-search-competition]').forEach(btn => btn.addEventListener('click', () => openTournamentMeta({
    leagueId: Number(btn.dataset.searchCompetition), season: Number(btn.dataset.season || new Date().getFullYear()), name: btn.dataset.compName || 'Турнир', shortName: btn.dataset.compShort || btn.dataset.compName || 'Турнир', country: btn.dataset.compCountry || '', category: btn.dataset.compCategory || '', tier: btn.dataset.compTier || 'standard', logo: '',
  })));
}

function localDiscoveryResults(query) {
  const q = String(query || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return { teams: [], competitions: [] };
  const teams = new Map(), competitions = new Map();
  for (const m of state.matches) {
    for (const team of [m.home, m.away]) {
      if (!team?.id || !team?.name) continue;
      const hay = `${team.name} ${m.country || ''}`.toLowerCase().replace(/ё/g, 'е');
      if (hay.includes(q) && !teams.has(Number(team.id))) teams.set(Number(team.id), { ...team, country: m.country || '' });
    }
    const chay = `${m.league || ''} ${m.leagueOriginal || ''} ${m.leagueShort || ''} ${m.country || ''}`.toLowerCase().replace(/ё/g, 'е');
    if (Number(m.leagueId) > 0 && chay.includes(q) && !competitions.has(Number(m.leagueId))) competitions.set(Number(m.leagueId), {
      leagueId: Number(m.leagueId), season: Number(m.season || new Date().getFullYear()), name: m.league || m.leagueOriginal || 'Турнир', shortName: m.leagueShort || m.league || 'Турнир', country: m.country || '', category: m.category || '', tier: m.competition?.tier || 'standard', logo: m.leagueLogo || '',
    });
  }
  return { teams: [...teams.values()].slice(0, 10), competitions: [...competitions.values()].slice(0, 8) };
}

function mergeById(first = [], second = [], idKey = 'id') {
  const seen = new Set(), out = [];
  for (const row of [...first, ...second]) {
    const id = Number(row?.[idKey] || 0);
    if (!id || seen.has(id)) continue;
    seen.add(id); out.push(row);
  }
  return out;
}

function renderDiscoveryHome() {
  const recentEl = $('searchRecent');
  const favEl = $('searchFavorites');
  const compEl = $('searchCompetitions');
  if (recentEl) {
    const rows = getRecentTeams();
    recentEl.innerHTML = rows.length ? rows.map(x => discoveryTeamCard(x, 'Недавно')).join('') : '<div class="empty compact-empty">Открытые команды появятся здесь.</div>';
  }
  if (favEl) {
    favEl.innerHTML = state.favorites.length ? state.favorites.slice(0, 10).map(x => discoveryTeamCard({ id:x.teamId, name:x.teamName, logo:x.teamLogo }, 'Избранное')).join('') : '<div class="empty compact-empty">Добавьте команду в избранное — она появится здесь.</div>';
  }
  if (compEl) {
    const seen = new Set();
    const comps = state.matches.filter(m => Number(m.leagueId) > 0 && !m.lowPriority).sort((a,b) => Number(b.competition?.priority||0)-Number(a.competition?.priority||0)).filter(m => { const id=Number(m.leagueId); if(seen.has(id)) return false; seen.add(id); return true; }).slice(0,8);
    compEl.innerHTML = comps.length ? comps.map(m => `<button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}<span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>${m.live ? '<b>LIVE</b>' : ''}</button>`).join('') : '<div class="empty compact-empty">Сначала загрузите список матчей.</div>';
    compEl.querySelectorAll?.('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  }
  bindDiscoveryActions($('searchRecent'));
  bindDiscoveryActions($('searchFavorites'));
}

function renderGlobalSearch() {
  const query = String(state.globalSearch.query || '').trim();
  const wrap = $('searchResultsWrap'), out = $('searchResults'), meta = $('searchResultsMeta'), status = $('searchStatus');
  if (!wrap || !out) return;
  if (!query) {
    wrap.hidden = true;
    if (status) status.innerHTML = '';
    renderDiscoveryHome();
    return;
  }
  const local = localDiscoveryResults(query);
  const teams = mergeById(local.teams, state.globalSearch.remoteTeams, 'id');
  const comps = mergeById(local.competitions, state.globalSearch.remoteCompetitions, 'leagueId');
  wrap.hidden = false;
  if (meta) meta.textContent = `${teams.length} команд · ${comps.length} турниров`;
  if (status) {
    status.innerHTML = state.globalSearch.loading ? '<div class="data-notice">🔎 Ищу по футбольному каталогу…</div>' : state.globalSearch.warning ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.globalSearch.warning)}</div>` : '';
  }
  const teamHtml = teams.length ? `<section class="panel search-result-block"><div class="mini-section-head"><strong>Команды</strong><span>${teams.length}</span></div><div class="discovery-grid">${teams.slice(0,16).map(x => discoveryTeamCard(x, x.youthReserve ? 'Youth/Reserve' : '')).join('')}</div></section>` : '';
  const compHtml = comps.length ? `<section class="panel search-result-block"><div class="mini-section-head"><strong>Турниры</strong><span>${comps.length}</span></div><div class="discovery-grid">${comps.slice(0,10).map(x => discoveryCompetitionCard(x)).join('')}</div></section>` : '';
  out.innerHTML = teamHtml + compHtml || `<div class="empty">Ничего не найдено. Для команды вне сегодняшнего списка введите минимум 3 символа и нажмите «Найти».</div>`;
  bindDiscoveryActions(out);
}

async function runGlobalSearch() {
  const input = $('globalSearchInput');
  const query = String(input?.value || '').trim();
  state.globalSearch.query = query;
  state.globalSearch.warning = '';
  if (!runtimeAllows('searchEnabled')) {
    state.globalSearch.remoteTeams = [];
    state.globalSearch.remoteCompetitions = [];
    state.globalSearch.warning = 'Удалённый поиск временно приостановлен. Используйте локальный каталог матчей.';
    renderGlobalSearch();
    return;
  }
  if (query.length < 3) { state.globalSearch.remoteTeams = []; state.globalSearch.remoteCompetitions = []; renderGlobalSearch(); return; }
  state.globalSearch.loading = true; renderGlobalSearch();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.globalSearch.remoteTeams = data.teams || [];
    state.globalSearch.remoteCompetitions = data.competitions || [];
    state.globalSearch.warning = data.warning || data.hint || '';
    state.globalSearch.searchedAt = data.refreshedAt || new Date().toISOString();
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
  } catch (e) {
    state.globalSearch.warning = e.message;
  } finally {
    state.globalSearch.loading = false; renderGlobalSearch();
  }
}

function openTournamentMeta(meta) {
  const current = activeViewId(); if (current !== 'tournamentView') state.tournamentBackView = current;
  const existing = state.matches.find(m => Number(m.leagueId) === Number(meta?.leagueId));
  if (existing) return openTournament(Number(meta.leagueId));
  if (!meta?.leagueId) return;
  state.currentTournament = {
    leagueId:Number(meta.leagueId), season:Number(meta.season || new Date().getFullYear()), name:meta.name || 'Турнир', shortName:meta.shortName || meta.name || 'Турнир', country:meta.country || '', logo:meta.logo || '', category:meta.category || '', tier:meta.tier || 'standard',
  };
  renderTournamentHero(); renderTournamentMatches(); setTournamentTab('matches', false); showView('tournamentView');
}

function matchSkeletonHtml(count = 4) {
  return `<div class="skeleton-stack" aria-hidden="true">${Array.from({ length: count }, () => '<div class="skeleton-card"><i></i><b></b><b></b><span></span></div>').join('')}</div>`;
}

function matchSnapshotKey(date) { return `${MATCH_SNAPSHOT_PREFIX}${date}`; }

function readMatchSnapshot(date) {
  try {
    const raw = storageGet(matchSnapshotKey(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - Number(parsed.savedAt) > MATCH_SNAPSHOT_MAX_AGE_MS) {
      storageRemove(matchSnapshotKey(date));
      return null;
    }
    return parsed;
  } catch { return null; }
}

function writeMatchSnapshot(date, data) {
  try {
    storageSet(matchSnapshotKey(date), JSON.stringify({
      savedAt: Date.now(),
      matches: data.matches || [],
      refreshedAt: data.refreshedAt || new Date().toISOString(),
      catalog: data.catalog || {},
      integrity: data.integrity || null,
    }));
  } catch {}
}

function applyMatchPayload(data, { snapshot = false } = {}) {
  state.matches = data.matches || [];
  state.matchesMeta = {
    refreshedAt: data.refreshedAt || null,
    stale: Boolean(data.stale || snapshot),
    warning: data.warning || (snapshot ? 'Мгновенно показана сохранённая копия. Идёт фоновое обновление.' : ''),
    retryAfter: Number(data.retryAfter || 0),
    catalog: data.catalog || {},
    integrity: data.integrity || null,
    localSnapshot: snapshot,
  };
  if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
  if (state.filter === 'top' && !state.matches.some(x => x.featured || (Number(x.interestScore || 0) >= 68 && !x.lowPriority))) state.filter = 'all';
  syncFilterButtons();
  renderMatches();
  renderDiscoveryHome();
  $('matches')?.setAttribute('aria-busy', snapshot ? 'true' : 'false');
}

async function loadMatches(options = {}) {
  const force = Boolean(options.force);
  const silent = Boolean(options.silent);
  const seq = ++state.matchesLoadSeq;
  const date = localDate(state.offset);
  const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
  $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';
  $('matches')?.setAttribute('aria-busy', 'true');

  let snapshot = null;
  if (!force) snapshot = readMatchSnapshot(date);
  const canReuseCurrent = state.matches.length && state.matchesMeta?.date === date;
  if (snapshot && !canReuseCurrent) {
    applyMatchPayload(snapshot, { snapshot: true });
    state.matchesMeta.date = date;
  } else if (!silent && !canReuseCurrent) {
    state.matches = [];
    $('matches').innerHTML = matchSkeletonHtml();
    $('matchesCount').textContent = '';
    if ($('dataNotice')) $('dataNotice').innerHTML = '';
  }

  try {
    const data = await api(`/api/matches?date=${date}`, { timeoutMs: 10000 });
    if (seq !== state.matchesLoadSeq) return;
    data.refreshedAt ||= new Date().toISOString();
    writeMatchSnapshot(date, data);
    applyMatchPayload(data, { snapshot: false });
    state.matchesMeta.date = date;
  } catch (e) {
    if (seq !== state.matchesLoadSeq) return;
    const retry = Number(e.payload?.retryAfter || 0);
    if (state.matches.length && (snapshot || state.matchesMeta?.date === date)) {
      state.matchesMeta.stale = true;
      state.matchesMeta.warning = e.message || 'Не удалось обновить данные. Показана последняя сохранённая версия.';
      state.matchesMeta.retryAfter = retry;
      renderMatches();
      $('matches')?.setAttribute('aria-busy', 'false');
      return;
    }
    const suffix = retry ? `<br><span class="tiny">Повторите примерно через ${retry} сек.</span>` : '';
    $('matches').innerHTML = `<div class="empty error-state"><strong>Не удалось загрузить матчи</strong><span>${escapeHtml(e.message)}${suffix}</span><button id="matchesRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
    $('matchesRetryBtn')?.addEventListener('click', () => loadMatches({ force: true }));
    $('matches')?.setAttribute('aria-busy', 'false');
  }
}

function syncFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === state.filter));
}

function filteredMatches() {
  const q = state.search.trim().toLowerCase();
  const fav = favoriteSet();
  const prefs = state.preferences || {};
  const list = state.matches.filter(m => {
    const isFavMatch = fav.has(Number(m.home?.id)) || fav.has(Number(m.away?.id));
    if (prefs.hideYouth !== false && m.youthReserve && state.filter !== 'favorites') return false;
    let byFilter = state.filter === 'all';
    if (state.filter === 'top') byFilter = Boolean(m.featured) || (Number(m.interestScore || 0) >= 68 && !m.lowPriority);
    if (state.filter === 'live') byFilter = Boolean(m.live);
    if (state.filter === 'cups') byFilter = ['cup', 'continental', 'national', 'international'].includes(String(m.category || ''));
    if (state.filter === 'international') byFilter = ['continental', 'national', 'international'].includes(String(m.category || '')) || m.group === 'international';
    if (['england', 'spain', 'italy', 'germany', 'france'].includes(state.filter)) byFilter = m.group === state.filter;
    if (state.filter === 'favorites') byFilter = isFavMatch;
    if (!byFilter) return false;
    if (!q) return true;
    return [m.home?.name, m.away?.name, m.league, m.leagueOriginal, m.leagueShort, m.country, m.countryRaw, m.round, m.roundLabel]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
  list.sort((a, b) => {
    const af = fav.has(Number(a.home?.id)) || fav.has(Number(a.away?.id)) ? 1 : 0;
    const bf = fav.has(Number(b.home?.id)) || fav.has(Number(b.away?.id)) ? 1 : 0;
    if (prefs.favoriteFirst !== false && state.filter !== 'favorites' && af !== bf) return bf - af;
    if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
    if (Boolean(a.featured) !== Boolean(b.featured)) return a.featured ? -1 : 1;
    const ap = Number(a.competition?.priority || 0), bp = Number(b.competition?.priority || 0);
    if (ap !== bp) return bp - ap;
    const ai = Number(a.interestScore || 0), bi = Number(b.interestScore || 0);
    if (ai !== bi) return bi - ai;
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
  return list;
}

function categoryLabel(category) {
  const labels = {
    league: 'Лига', cup: 'Кубок', continental: 'Еврокубок', national: 'Сборные', international: 'Международный',
    women: 'Женский футбол', friendly: 'Товарищеский', youth: 'Молодёжный', lower: 'Низшая лига',
  };
  return labels[String(category || '')] || '';
}

function categoryClass(category) {
  const c = String(category || 'other').replace(/[^a-z]/g, '');
  return `cat-${c || 'other'}`;
}

function matchCenter(m) {
  if (m.finished && m.score?.home !== null && m.score?.away !== null) return `${m.score.home} : ${m.score.away}`;
  if (m.live) {
    const minute = Number(m.elapsed || 0) > 0 ? ` · ${Number(m.elapsed)}′` : '';
    return `${m.score?.home ?? 0}:${m.score?.away ?? 0} · LIVE${minute}`;
  }
  return timeOf(m.date);
}

function interestLabel(score) {
  const n = Number(score || 0);
  if (n >= 80) return '🔥 Очень высокий';
  if (n >= 65) return '⭐ Высокий';
  if (n >= 45) return 'Средний';
  return 'Обычный';
}

function competitionGroups(list) {
  const groups = new Map();
  for (const m of list) {
    const key = Number(m.leagueId || 0) || `${m.league || ''}:${m.country || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.values()].sort((a, b) => {
    const aLive = a.some(x => x.live) ? 1 : 0;
    const bLive = b.some(x => x.live) ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const ap = Math.max(...a.map(x => Number(x.competition?.priority || 0)));
    const bp = Math.max(...b.map(x => Number(x.competition?.priority || 0)));
    if (ap !== bp) return bp - ap;
    const ai = Math.max(...a.map(x => Number(x.interestScore || 0)));
    const bi = Math.max(...b.map(x => Number(x.interestScore || 0)));
    if (ai !== bi) return bi - ai;
    return String(a[0]?.date || '').localeCompare(String(b[0]?.date || ''));
  });
}

function renderPopularCompetitions() {
  const wrap = $('popularCompetitionsWrap');
  const el = $('popularCompetitions');
  if (!wrap || !el) return;
  const seen = new Set();
  const rows = state.matches
    .filter(m => Number(m.leagueId) > 0 && !m.youthReserve && !m.lowPriority)
    .sort((a, b) => {
      if (Boolean(a.live) !== Boolean(b.live)) return a.live ? -1 : 1;
      const ap = Number(a.competition?.priority || 0), bp = Number(b.competition?.priority || 0);
      if (ap !== bp) return bp - ap;
      return Number(b.interestScore || 0) - Number(a.interestScore || 0);
    })
    .filter(m => {
      const id = Number(m.leagueId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 7);
  if (!rows.length) {
    wrap.hidden = true;
    el.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  el.innerHTML = rows.map(m => `
    <button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">
      ${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}
      <span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>
      ${m.live ? '<b>LIVE</b>' : ''}
    </button>`).join('');
  el.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
}

function matchCardHtml(m, { grouped = false } = {}) {
  const interest = Math.max(0, Math.min(100, Number(m.interestScore || 0)));
  const cardState = m.live ? 'is-live' : m.finished ? 'is-finished' : 'is-upcoming';
  return `
    <article class="match-card ${Number(m.interestScore || 0) >= 50 ? 'top-match' : ''} ${cardState}">
      ${grouped ? '' : `<div class="match-meta"><span class="competition-name">${m.featured ? '<b class="top-tag">ГЛАВНЫЙ</b> ' : ''}${escapeHtml(m.league || 'Турнир')}</span><span>${escapeHtml(m.country || '')}</span></div>`}
      <div class="catalog-row">
        ${m.category ? `<span class="competition-chip ${categoryClass(m.category)}">${escapeHtml(categoryLabel(m.category))}</span>` : ''}
        ${m.roundLabel ? `<span class="round-chip">${escapeHtml(m.roundLabel)}</span>` : ''}
        <span class="coverage-mini">Покрытие: ${escapeHtml(coverageLabel(m.coverageTier).text)}</span>
        ${m.integrity?.state === 'warning' ? `<span class="integrity-mini warning" title="${escapeHtml((m.integrity?.issues || []).map(x => x.message).join(' · '))}">⚠ данные</span>` : ''}
      </div>
      <div class="interest-row">
        <span>Интерес</span>
        <div class="interest-meter" aria-hidden="true"><i style="--interest:${interest}%"></i></div>
        <strong>${interest}/100 · ${interestLabel(m.interestScore)}</strong>
      </div>
      <div class="team-row">
        <div class="team">
          <button class="fav-star ${isFavorite(m.home?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-label="Избранное">${isFavorite(m.home?.id) ? '★' : '☆'}</button>
          <button class="team-open-link match-team-open" type="button" data-open-team="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}">
            ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
            <span class="match-team-copy"><strong>${escapeHtml(m.home?.name || '')}</strong><small>Хозяева</small></span>
          </button>
        </div>
        <div class="kickoff ${m.live ? 'live-kickoff' : ''}">${escapeHtml(matchCenter(m))}</div>
        <div class="team away">
          <button class="team-open-link match-team-open away-open" type="button" data-open-team="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}">
            <span class="match-team-copy"><strong>${escapeHtml(m.away?.name || '')}</strong><small>Гости</small></span>
            ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
          </button>
          <button class="fav-star ${isFavorite(m.away?.id) ? 'active' : ''}" type="button" data-team-id="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-label="Избранное">${isFavorite(m.away?.id) ? '★' : '☆'}</button>
        </div>
      </div>
      ${m.live
        ? `<button class="analyze-btn live-center-btn" data-center="${Number(m.fixtureId)}">${m.youthReserve ? '🔴 LIVE-счёт' : '🔴 LIVE-центр'}</button>`
        : m.finished
          ? `<button class="analyze-btn finished-btn" data-center="${Number(m.fixtureId)}">📋 Итоги матча</button>`
          : `<button class="analyze-btn" data-fixture="${Number(m.fixtureId)}">🧠 Предматчевый анализ</button>`}
    </article>`;
}

function bindMatchActions(root = document) {
  root.querySelectorAll('.analyze-btn[data-fixture]').forEach(btn => {
    btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
  });
  root.querySelectorAll('.analyze-btn[data-center]').forEach(btn => {
    btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn));
  });
  root.querySelectorAll('.fav-star').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
    id: Number(btn.dataset.teamId), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}

function renderMatches() {
  const list = filteredMatches();
  const age = relativeAge(state.matchesMeta?.refreshedAt);
  const catalog = state.matchesMeta?.catalog || {};
  const groups = competitionGroups(list);
  const integrity = state.matchesMeta?.integrity || {};
  const summaryBits = [
    `<span class="summary-pill"><b>${list.length}</b> из ${state.matches.length}</span>`,
    groups.length ? `<span class="summary-pill"><b>${groups.length}</b> турниров</span>` : '',
    Number(catalog.live || 0) > 0 ? `<span class="summary-pill live"><b>${Number(catalog.live)}</b> LIVE</span>` : '',
    Number.isFinite(Number(integrity.qualityScore)) ? `<span class="summary-pill quality">данные <b>${Math.round(Number(integrity.qualityScore))}%</b></span>` : '',
    age ? `<span class="summary-pill muted-pill">↻ ${escapeHtml(age)}</span>` : '',
  ].filter(Boolean);
  $('matchesCount').innerHTML = summaryBits.join('');
  renderPopularCompetitions();
  if ($('dataNotice')) {
    const notices = [];
    if (state.matchesMeta?.stale) notices.push(`<div class="data-notice stale">⚠️ ${escapeHtml(state.matchesMeta.warning || 'Показаны последние сохранённые данные.')}</div>`);
    if (Number(integrity.quarantined || 0) > 0 || Number(integrity.warnings || 0) > 0) {
      notices.push(`<div class="data-notice integrity-notice">🛡️ Проверка данных: ${Number(integrity.inspected || 0)} проверено · ${Number(integrity.quarantined || 0)} скрыто · ${Number(integrity.warnings || 0)} предупрежд.</div>`);
    }
    $('dataNotice').innerHTML = notices.join('');
  }
  if (!list.length) {
    const extra = state.filter !== 'all' ? '<button id="showAllBtn" class="secondary-btn" type="button">Показать все матчи</button>' : '';
    $('matches').innerHTML = `<div class="empty">По выбранному фильтру матчей не найдено.${extra}</div>`;
    $('showAllBtn')?.addEventListener('click', () => { state.filter = 'all'; syncFilterButtons(); renderMatches(); });
    return;
  }

  $('matches').innerHTML = groups.map(rows => {
    const first = rows[0];
    const liveCount = rows.filter(x => x.live).length;
    return `<section class="competition-group">
      <button class="competition-group-head" type="button" data-open-tournament="${Number(first.leagueId)}">
        <span class="competition-group-logo">${first.leagueLogo ? `<img src="${safeUrl(first.leagueLogo)}" alt="">` : '🏆'}</span>
        <span class="competition-group-main"><strong>${escapeHtml(first.league || 'Турнир')}</strong><small>${escapeHtml(first.country || '')}${first.season ? ` · сезон ${Number(first.season)}` : ''}</small></span>
        <span class="competition-group-count">${liveCount ? `<b>${liveCount} LIVE</b>` : ''}<small>${rows.length} ${rows.length === 1 ? 'матч' : 'матчей'}</small><i>›</i></span>
      </button>
      <div class="competition-group-matches">${rows.map(m => matchCardHtml(m, { grouped: true })).join('')}</div>
    </section>`;
  }).join('');
  bindMatchActions($('matches'));
}

function currentTournamentMatches(leagueId = state.currentTournament?.leagueId) {
  return state.matches.filter(m => Number(m.leagueId) === Number(leagueId));
}

function tournamentKey(t) {
  return `${Number(t?.leagueId || 0)}:${Number(t?.season || 0)}`;
}

function openTournament(leagueId) {
  const current = activeViewId(); if (current !== 'tournamentView') state.tournamentBackView = current;
  const rows = currentTournamentMatches(leagueId);
  const source = rows[0] || state.matches.find(m => Number(m.leagueId) === Number(leagueId));
  if (!source) {
    toast('Турнир не найден в текущем списке матчей.');
    return;
  }
  state.currentTournament = {
    leagueId: Number(source.leagueId),
    season: Number(source.season || new Date().getFullYear()),
    name: source.league || source.leagueOriginal || 'Турнир',
    shortName: source.leagueShort || source.league || 'Турнир',
    country: source.country || '',
    logo: source.leagueLogo || '',
    category: source.category || '',
    tier: source.competition?.tier || 'standard',
  };
  renderTournamentHero();
  renderTournamentMatches();
  setTournamentTab('matches', false);
  showView('tournamentView');
}

function renderTournamentHero() {
  const t = state.currentTournament;
  if (!t) return;
  const rows = currentTournamentMatches(t.leagueId);
  const live = rows.filter(x => x.live).length;
  $('tournamentHero').innerHTML = `<section class="panel tournament-hero">
    <div class="tournament-identity">
      <div class="tournament-logo">${t.logo ? `<img src="${safeUrl(t.logo)}" alt="">` : '🏆'}</div>
      <div><span>${escapeHtml(t.country || '')}</span><h2>${escapeHtml(t.name)}</h2><p>Сезон ${Number(t.season)} · ${escapeHtml(categoryLabel(t.category) || 'Турнир')}</p></div>
    </div>
    <div class="tournament-summary">
      <div><span>Матчей в выбранный день</span><strong>${rows.length}</strong></div>
      <div><span>LIVE сейчас</span><strong>${live}</strong></div>
      <div><span>Покрытие</span><strong>${escapeHtml(t.tier === 'elite' ? 'Высокое' : t.tier === 'major' ? 'Хорошее' : 'Стандарт')}</strong></div>
    </div>
  </section>`;
}

function renderTournamentMatches() {
  const t = state.currentTournament;
  if (!t) return;
  const rows = currentTournamentMatches(t.leagueId);
  const el = $('tournamentMatches');
  if (!rows.length) {
    el.innerHTML = '<div class="empty">В выбранный день матчей этого турнира нет.</div>';
    return;
  }
  el.innerHTML = `<div class="tournament-day-note">Матчи на ${escapeHtml(dateOnly(localDate(state.offset)))}</div><div class="tournament-match-list">${rows.map(m => matchCardHtml(m, { grouped: true })).join('')}</div>`;
  bindMatchActions(el);
}

function standingFormHtml(form = '') {
  const chars = String(form || '').toUpperCase().split('').filter(x => ['W','D','L'].includes(x)).slice(-5);
  if (!chars.length) return '<span class="standings-form-empty">—</span>';
  return `<span class="standings-form">${chars.map(x => `<i class="${x === 'W' ? 'win' : x === 'D' ? 'draw' : 'loss'}">${x === 'W' ? 'В' : x === 'D' ? 'Н' : 'П'}</i>`).join('')}</span>`;
}

function renderTournamentStandings(data) {
  const el = $('tournamentTable');
  const t = state.currentTournament;
  if (!el || !t) return;
  if (!data?.available || !data?.groups?.length) {
    el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Таблица турнира сейчас недоступна.')}${data?.warning ? `<br><span class="tiny">${escapeHtml(data.warning)}</span>` : ''}</div>`;
    return;
  }
  const currentIds = new Set(currentTournamentMatches(t.leagueId).flatMap(m => [Number(m.home?.id), Number(m.away?.id)]));
  el.innerHTML = `${data.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показана сохранённая таблица.')}</div>` : ''}${data.groups.map((group, gi) => `
    <section class="panel standings-panel">
      ${group.name ? `<h2>${escapeHtml(group.name)}</h2>` : `<h2>Турнирная таблица</h2>`}
      <div class="standings-scroll"><table class="standings-table">
        <thead><tr><th>#</th><th>Команда</th><th>И</th><th class="wide-stat">В</th><th class="wide-stat">Н</th><th class="wide-stat">П</th><th>М</th><th>+/-</th><th>О</th><th>Форма</th></tr></thead>
        <tbody>${group.rows.map(row => `<tr class="${currentIds.has(Number(row.team?.id)) ? 'today-team' : ''}">
          <td><b>${Number(row.rank)}</b></td>
          <td><button class="standing-team team-open-link" type="button" data-open-team="${Number(row.team?.id)}" data-team-name="${escapeHtml(row.team?.name || '')}" data-team-logo="${escapeHtml(row.team?.logo || '')}">${row.team?.logo ? `<img src="${safeUrl(row.team.logo)}" alt="">` : ''}<strong>${escapeHtml(row.team?.name || '')}</strong></button></td>
          <td>${Number(row.played)}</td><td class="wide-stat">${Number(row.win)}</td><td class="wide-stat">${Number(row.draw)}</td><td class="wide-stat">${Number(row.lose)}</td>
          <td>${Number(row.goalsFor)}:${Number(row.goalsAgainst)}</td><td class="${Number(row.goalsDiff) > 0 ? 'positive' : Number(row.goalsDiff) < 0 ? 'negative' : ''}">${Number(row.goalsDiff) > 0 ? '+' : ''}${Number(row.goalsDiff)}</td><td><b>${Number(row.points)}</b></td><td>${standingFormHtml(row.form)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny table-note">Таблица загружается только при открытии этой вкладки и кэшируется на 6 часов, чтобы не расходовать бесплатную квоту API.</p>
    </section>`).join('')}`;
  el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}

async function loadTournamentStandings(force = false) {
  const t = state.currentTournament;
  if (!t) return;
  const key = tournamentKey(t);
  const el = $('tournamentTable');
  if (!force && state.tournamentStandings.has(key)) {
    renderTournamentStandings(state.tournamentStandings.get(key));
    return;
  }
  el.innerHTML = '<div class="loader">Загружаю таблицу турнира…</div>';
  try {
    const data = await api(`/api/tournament?leagueId=${Number(t.leagueId)}&season=${Number(t.season)}`);
    state.tournamentStandings.set(key, data);
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    renderTournamentStandings(data);
} catch (e) {
    const cached = state.tournamentStandings.get(key);
    if (cached) {
      renderTournamentStandings(cached);
      el.insertAdjacentHTML('afterbegin', `<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показана последняя сохранённая таблица.</div>`);
      return;
    }
    el.innerHTML = recoveryCardHtml({ title: 'Таблица временно недоступна', message: e.message, retryId: 'tournamentStandingsRetry', compact: true });
    $('tournamentStandingsRetry')?.addEventListener('click', () => loadTournamentStandings(true));
  }
}

function setTournamentTab(tab, load = true) {
  document.querySelectorAll('.tournament-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tournamentTab === tab));
  $('tournamentMatchesPanel').classList.toggle('active', tab === 'matches');
  $('tournamentTablePanel').classList.toggle('active', tab === 'table');
  if (tab === 'table' && load) loadTournamentStandings(false);
}


function activeViewId() { return document.querySelector('.view.active')?.id || 'matchesView'; }
function teamResultBadge(result) {
  const r = String(result || '').toUpperCase();
  if (!['W','D','L'].includes(r)) return '';
  return `<span class="team-result ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}">${r === 'W' ? 'В' : r === 'D' ? 'Н' : 'П'}</span>`;
}
function teamMatchRow(m) {
  const center = m.live ? `<button class="mini-match-action live" type="button" data-center="${Number(m.fixtureId)}">LIVE</button>` : m.finished ? `<span class="team-score">${m.score?.home ?? '—'} : ${m.score?.away ?? '—'}</span>` : `<button class="mini-match-action" type="button" data-fixture="${Number(m.fixtureId)}">Анализ</button>`;
  return `<article class="team-fixture-row"><div class="team-fixture-date"><strong>${escapeHtml(dateTime(m.date))}</strong><small>${escapeHtml(m.roundLabel || m.league || '')}</small></div><div class="team-fixture-opponent">${m.opponent?.logo ? `<img src="${safeUrl(m.opponent.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.opponent?.name || '')}</strong><small>${m.venue === 'home' ? 'Дома' : 'В гостях'} · ${escapeHtml(m.league || '')}</small></div></div><div class="team-fixture-outcome">${teamResultBadge(m.result)}${center}</div></article>`;
}
function bindTeamFixtureActions(root) {
  root.querySelectorAll('[data-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
  root.querySelectorAll('[data-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn)));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', openTournamentFromTeam));
}

function teamPercent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
}
function teamDecimal(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : String(Math.round(Number(value) * 100) / 100);
}
function teamFormBadges(form='') {
  return String(form || '').slice(-12).split('').map(teamResultBadge).join('') || '<span class="muted">—</span>';
}
function seasonSplitCard(label, played, wins, draws, losses, ppg, gf, ga) {
  return `<div class="season-split-card"><div class="mini-section-head"><strong>${escapeHtml(label)}</strong><span>${Number(played || 0)} игр</span></div><div class="season-split-line"><span>В / Н / П</span><b>${Number(wins||0)} / ${Number(draws||0)} / ${Number(losses||0)}</b></div><div class="season-split-line"><span>Очки / матч</span><b>${teamDecimal(ppg)}</b></div><div class="season-split-line"><span>Голы</span><b>${Number(gf||0)} : ${Number(ga||0)}</b></div></div>`;
}
function renderTeamIntelligence(data) {
  const el = $('teamIntelligence'); if (!el) return;
  if (!data?.available || !data?.stats?.available) {
    el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Сезонная статистика для этой команды сейчас недоступна.')}</div>`;
    return;
  }
  const s=data.stats, f=s.fixtures||{}, d=s.derived||{}, g=s.goals||{}, b=s.biggest||{};
  const warning=data.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показана сохранённая сезонная статистика.')}</div>` : '';
  const leagueTitle=[s.league?.name, s.league?.season].filter(Boolean).join(' · ');
  const goalDiff=Number(g.difference||0);
  el.innerHTML = `${warning}
    <section class="panel intelligence-hero">
      <div class="mini-section-head"><strong>📊 Сезонная статистика</strong><span>${escapeHtml(leagueTitle)}</span></div>
      <div class="intelligence-kpis">
        <div><span>Матчи</span><strong>${Number(f.played?.total||0)}</strong></div>
        <div><span>Очки / матч</span><strong>${teamDecimal(d.ppg)}</strong></div>
        <div><span>Победы</span><strong>${teamPercent(d.winRate)}</strong></div>
        <div><span>Разница</span><strong class="${goalDiff>0?'positive':goalDiff<0?'negative':''}">${goalDiff>0?'+':''}${goalDiff}</strong></div>
      </div>
      <div class="team-season-form"><span>Форма сезона</span><div>${teamFormBadges(s.form)}</div></div>
    </section>
    <section class="panel">
      <h2>🏠 Дома / ✈️ В гостях</h2>
      <div class="season-split-grid">
        ${seasonSplitCard('Дома',f.played?.home,f.wins?.home,f.draws?.home,f.losses?.home,d.homePpg,g.for?.home,g.against?.home)}
        ${seasonSplitCard('В гостях',f.played?.away,f.wins?.away,f.draws?.away,f.losses?.away,d.awayPpg,g.for?.away,g.against?.away)}
      </div>
    </section>
    <section class="panel">
      <h2>⚽ Атака и оборона</h2>
      <div class="team-kpi-grid intelligence-detail-grid">
        <div><span>Забито / матч</span><strong>${teamDecimal(d.goalsForPerMatch)}</strong></div>
        <div><span>Пропущено / матч</span><strong>${teamDecimal(d.goalsAgainstPerMatch)}</strong></div>
        <div><span>Сухие матчи</span><strong>${teamPercent(d.cleanSheetRate)}</strong></div>
        <div><span>Без гола</span><strong>${teamPercent(d.failedToScoreRate)}</strong></div>
        <div><span>Всего голов</span><strong>${Number(g.for?.total||0)} : ${Number(g.against?.total||0)}</strong></div>
        <div><span>Схема</span><strong>${escapeHtml(s.mostUsedLineup?.formation || '—')}</strong></div>
      </div>
    </section>
    <section class="panel season-records">
      <h2>📌 Максимумы сезона</h2>
      <div class="season-record-grid">
        <div><span>Крупнейшая победа дома</span><strong>${escapeHtml(b.winHome || '—')}</strong></div>
        <div><span>Крупнейшая победа в гостях</span><strong>${escapeHtml(b.winAway || '—')}</strong></div>
        <div><span>Крупнейшее поражение дома</span><strong>${escapeHtml(b.lossHome || '—')}</strong></div>
        <div><span>Крупнейшее поражение в гостях</span><strong>${escapeHtml(b.lossAway || '—')}</strong></div>
      </div>
      <p class="tiny">Данные этой вкладки загружаются только при открытии и кэшируются на 6 часов.</p>
    </section>`;
}
async function loadTeamIntelligence(force=false) {
  const team=state.currentTeam, comp=team?.data?.primaryCompetition, el=$('teamIntelligence');
  if(!team?.id || !el) return;
  if(!comp?.leagueId || !comp?.season){ el.innerHTML='<div class="empty compact-empty">Сначала нужно определить основной турнир команды.</div>'; return; }
  const key=`${Number(team.id)}:${Number(comp.leagueId)}:${Number(comp.season)}`;
  if(!force && state.teamIntelligenceCache.has(key)){ renderTeamIntelligence(state.teamIntelligenceCache.get(key)); return; }
  el.innerHTML='<div class="loader">Загружаю сезонную статистику…</div>';
  const q=new URLSearchParams({teamId:String(Number(team.id)),leagueId:String(Number(comp.leagueId)),season:String(Number(comp.season)),teamName:team.name||'',teamLogo:team.logo||'',leagueName:comp.name||'',leagueLogo:comp.logo||'',country:comp.country||''});
  try{const data=await api(`/api/team/intelligence?${q.toString()}`);state.teamIntelligenceCache.set(key,data);if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}renderTeamIntelligence(data);}catch(e){
    const cached=state.teamIntelligenceCache.get(key);
    if(cached){renderTeamIntelligence(cached);el.insertAdjacentHTML('afterbegin',`<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показаны сохранённые показатели.</div>`);}
    else{el.innerHTML=recoveryCardHtml({title:'Статистика команды временно недоступна',message:e.message,retryId:'teamIntelligenceRetry',compact:true});$('teamIntelligenceRetry')?.addEventListener('click',()=>loadTeamIntelligence(true));}
  }
}
function playerCard(p) {
  return `<div class="squad-player">${p.photo?`<img src="${safeUrl(p.photo)}" alt="">`:'<span class="squad-avatar">👤</span>'}<div><strong>${escapeHtml(p.name||'')}</strong><small>${p.number?`№${Number(p.number)} · `:''}${p.age?`${Number(p.age)} лет`:'Возраст —'}</small></div></div>`;
}
function renderTeamSquad(data) {
  const el=$('teamSquad'); if(!el) return;
  if(!data?.available || !data?.groups?.length){el.innerHTML=`<div class="empty compact-empty">${escapeHtml(data?.reason||'Состав команды сейчас недоступен.')}</div>`;return;}
  const sm=data.summary||{};
  const warning=data.stale?`<div class="data-notice stale">⚠️ ${escapeHtml(data.warning||'Показан сохранённый состав.')}</div>`:'';
  el.innerHTML=`${warning}<section class="panel squad-summary-panel"><div class="mini-section-head"><strong>👥 Состав команды</strong><span>${Number(sm.total||0)} игроков</span></div><div class="squad-summary-grid"><div><span>Средний возраст</span><strong>${sm.averageAge??'—'}</strong></div><div><span>Вратари</span><strong>${Number(sm.goalkeepers||0)}</strong></div><div><span>Защитники</span><strong>${Number(sm.defenders||0)}</strong></div><div><span>Полузащитники</span><strong>${Number(sm.midfielders||0)}</strong></div><div><span>Нападающие</span><strong>${Number(sm.attackers||0)}</strong></div></div></section>${data.groups.map(group=>`<section class="panel squad-group"><div class="mini-section-head"><strong>${escapeHtml(group.label||'Игроки')}</strong><span>${group.players?.length||0}</span></div><div class="squad-player-grid">${(group.players||[]).map(playerCard).join('')}</div></section>`).join('')}<p class="tiny squad-cache-note">Состав загружается только при открытии вкладки и кэшируется на 12 часов. Статистика отдельных игроков будет подключена после перехода на расширенный API-план.</p>`;
}
async function loadTeamSquad(force=false) {
  const team=state.currentTeam, el=$('teamSquad'); if(!team?.id||!el) return;
  const key=String(Number(team.id)); if(!force&&state.teamSquadCache.has(key)){renderTeamSquad(state.teamSquadCache.get(key));return;}
  el.innerHTML='<div class="loader">Загружаю состав…</div>';
  try{const data=await api(`/api/team/squad?teamId=${Number(team.id)}`);state.teamSquadCache.set(key,data);if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}renderTeamSquad(data);}catch(e){
    const cached=state.teamSquadCache.get(key);
    if(cached){renderTeamSquad(cached);el.insertAdjacentHTML('afterbegin',`<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показан сохранённый состав.</div>`);}
    else{el.innerHTML=recoveryCardHtml({title:'Состав временно недоступен',message:e.message,retryId:'teamSquadRetry',compact:true});$('teamSquadRetry')?.addEventListener('click',()=>loadTeamSquad(true));}
  }
}

function renderTeamHub(data) {
  const team = data?.team || state.currentTeam || {}; state.currentTeam = { ...state.currentTeam, ...team, data };
  const fav = isFavorite(team.id), comp = data?.primaryCompetition, standing = data?.standing, form = data?.form, next = data?.liveNow || data?.nextMatch;
  const stale = data?.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показаны сохранённые данные команды.')}</div>` : '';
  $('teamHero').innerHTML = `${stale}<section class="panel team-hero"><div class="team-hero-main"><div class="team-hero-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</div><div class="team-hero-copy"><span>СТРАНИЦА КОМАНДЫ</span><h2>${escapeHtml(team.name || 'Команда')}</h2><p>${comp ? `${escapeHtml(comp.name)} · ${escapeHtml(comp.country || '')}` : 'Турнир определяется по последним матчам'}</p></div><button id="teamFavoriteBtn" class="team-favorite-big ${fav ? 'active' : ''}" type="button">${fav ? '★' : '☆'}</button></div><div class="team-hero-stats"><div><span>Форма</span><strong>${form?.form ? escapeHtml(form.form.replace(/W/g,'В').replace(/D/g,'Н').replace(/L/g,'П')) : '—'}</strong></div><div><span>Очки / матч</span><strong>${form?.ppg ?? '—'}</strong></div><div><span>Голы</span><strong>${form ? `${form.gfAvg} / ${form.gaAvg}` : '—'}</strong></div><div><span>Место</span><strong>${standing?.rank ? `${standing.rank}` : '—'}</strong></div></div>${comp ? `<button id="teamTournamentBtn" class="secondary-btn team-tournament-btn" type="button">🏆 ${escapeHtml(comp.shortName || comp.name)} · открыть турнир</button>` : ''}</section>`;
  $('teamFavoriteBtn')?.addEventListener('click', async () => { await toggleFavorite({ id:Number(team.id), name:team.name||'', logo:team.logo||'' }); renderTeamHub(state.currentTeam?.data || data); });
  $('teamTournamentBtn')?.addEventListener('click', openTournamentFromTeam);
  const formHtml = form ? `<section class="panel team-form-panel"><h2>📈 Последние ${Number(form.sample || 0)} матчей</h2><div class="team-form-line">${String(form.form || '').split('').map(teamResultBadge).join('')}</div><div class="team-kpi-grid"><div><span>Победы</span><strong>${Number(form.wins||0)}</strong></div><div><span>Ничьи</span><strong>${Number(form.draws||0)}</strong></div><div><span>Поражения</span><strong>${Number(form.losses||0)}</strong></div><div><span>Забивает</span><strong>${form.gfAvg ?? '—'}</strong></div><div><span>Пропускает</span><strong>${form.gaAvg ?? '—'}</strong></div><div><span>ОЗ</span><strong>${form.bttsPct ?? '—'}%</strong></div></div></section>` : '<section class="panel"><div class="empty compact-empty">Пока недостаточно завершённых матчей для формы.</div></section>';
  const nextHtml = next ? `<section class="panel next-team-match"><div class="mini-section-head"><strong>${next.live ? '🔴 Матч идёт' : '⏭ Ближайший матч'}</strong><span>${escapeHtml(dateTime(next.date))}</span></div>${teamMatchRow(next)}</section>` : '<section class="panel"><div class="empty compact-empty">Ближайший матч в доступном окне не найден.</div></section>';
  const positionHtml = standing ? `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><div class="team-standing-summary"><strong>${Number(standing.rank)} место</strong><span>${Number(standing.points)} очков · ${Number(standing.played)} матчей · ${Number(standing.goalsFor)}:${Number(standing.goalsAgainst)}</span></div></section>` : `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><p class="muted">Позиция появится после загрузки таблицы турнира. Так мы не расходуем отдельный API-запрос автоматически.</p>${comp ? '<button class="secondary-btn" type="button" data-open-tournament="1">Открыть турнир и таблицу</button>' : ''}</section>`;
  $('teamOverview').innerHTML = `${nextHtml}${formHtml}${positionHtml}`; bindTeamFixtureActions($('teamOverview'));
  $('teamResults').innerHTML = data?.recent?.length ? `<div class="team-fixtures-list">${data.recent.map(teamMatchRow).join('')}</div>` : '<div class="empty">Завершённых матчей в доступном окне нет.</div>';
  $('teamSchedule').innerHTML = data?.upcoming?.length ? `<div class="team-fixtures-list">${data.upcoming.map(teamMatchRow).join('')}</div>` : '<div class="empty">Предстоящих матчей в доступном окне нет.</div>';
  bindTeamFixtureActions($('teamResults')); bindTeamFixtureActions($('teamSchedule'));
}
async function loadTeamHub(team, force=false) {
  const key=String(Number(team?.id||0)); if (!key || key==='0') return;
  const cached=state.teamCache.get(key); if (cached && !force) { renderTeamHub(cached); return; }
  if (!cached) {
    $('teamHero').innerHTML='<div class="loader">Загружаю страницу команды…</div>'; $('teamOverview').innerHTML=''; $('teamIntelligence').innerHTML='<div class="empty compact-empty">Откройте вкладку «Статистика», чтобы загрузить сезонные данные.</div>'; $('teamSquad').innerHTML='<div class="empty compact-empty">Откройте вкладку «Состав», чтобы загрузить игроков.</div>'; $('teamResults').innerHTML=''; $('teamSchedule').innerHTML='';
  }
  try {
    const q=new URLSearchParams({teamId:String(Number(team.id)),name:team.name||'',logo:team.logo||''});
    const data=await api(`/api/team?${q.toString()}`);
    state.teamCache.set(key,data);
    if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
    renderTeamHub(data);
  } catch(e) {
    if (cached) {
      renderTeamHub(cached);
      $('teamHero')?.insertAdjacentHTML('afterbegin', `<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показана последняя открытая версия команды.</div>`);
      return;
    }
    $('teamHero').innerHTML=recoveryCardHtml({ title:'Страница команды временно недоступна', message:e.message, retryId:'teamHubRetry' });
    $('teamHubRetry')?.addEventListener('click', () => loadTeamHub(team, true));
  }
}
function openTeam(team) {
  if(!team?.id) return; rememberTeam(team); renderDiscoveryHome(); const current=activeViewId(); if(current!=='teamView') state.teamBackView=current;
  state.currentTeam={id:Number(team.id),name:team.name||'',logo:team.logo||'',data:null}; setTeamTab('overview'); showView('teamView'); loadTeamHub(state.currentTeam,false);
}
function setTeamTab(tab) {
  document.querySelectorAll('.team-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.teamTab===tab));
  $('teamOverviewPanel')?.classList.toggle('active',tab==='overview');
  $('teamIntelligencePanel')?.classList.toggle('active',tab==='intelligence');
  $('teamSquadPanel')?.classList.toggle('active',tab==='squad');
  $('teamResultsPanel')?.classList.toggle('active',tab==='results');
  $('teamSchedulePanel')?.classList.toggle('active',tab==='schedule');
  if(tab==='intelligence') loadTeamIntelligence(false);
  if(tab==='squad') loadTeamSquad(false);
}
function openTournamentFromTeam() {
  state.tournamentBackView = 'teamView';
  const comp=state.currentTeam?.data?.primaryCompetition; if(!comp?.leagueId) return toast('Основной турнир команды пока не определён.');
  const existing=state.matches.find(m=>Number(m.leagueId)===Number(comp.leagueId)); if(existing) return openTournament(Number(comp.leagueId));
  state.currentTournament={leagueId:Number(comp.leagueId),season:Number(comp.season||new Date().getFullYear()),name:comp.name||'Турнир',shortName:comp.shortName||comp.name||'Турнир',country:comp.country||'',logo:comp.logo||'',category:comp.category||'',tier:comp.tier||'standard'};
  renderTournamentHero(); renderTournamentMatches(); setTournamentTab('table',true); showView('tournamentView');
}

function statValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  return escapeHtml(String(v));
}

function minuteLabel(event) {
  const base = Number(event.minute || 0);
  const extra = Number(event.extra || 0);
  return `${base}${extra > 0 ? `+${extra}` : ''}′`;
}

function liveEventsHtml(events = []) {
  if (!events.length) return '<div class="empty compact-empty">События пока не доступны для этого матча.</div>';
  return `<div class="live-events">${events.map(e => `
    <div class="live-event ${escapeHtml(e.side || '')}">
      <span class="event-minute">${minuteLabel(e)}</span>
      <div class="event-main">
        <strong>${escapeHtml(e.label || 'Событие')}</strong>
        <span>${escapeHtml(e.player || e.teamName || '')}${e.assist ? ` · ${escapeHtml(e.assist)}` : ''}</span>
      </div>
      <span class="event-team">${escapeHtml(e.teamName || '')}</span>
    </div>`).join('')}</div>`;
}

function liveStatsHtml(stats, match) {
  const items = stats?.items || [];
  if (!items.length) return '<div class="empty compact-empty">Детальная статистика недоступна для этого матча.</div>';
  return `<div class="live-stats">
    <div class="live-stat-head"><strong>${escapeHtml(match.home?.name || '')}</strong><span></span><strong>${escapeHtml(match.away?.name || '')}</strong></div>
    ${items.map(x => `<div class="live-stat-row"><strong>${statValue(x.home)}</strong><span>${escapeHtml(x.label)}</span><strong>${statValue(x.away)}</strong></div>`).join('')}
  </div>`;
}

function lineupPlayerName(p) {
  return typeof p === 'string' ? p : (p?.name || 'Игрок');
}

function lineupPlayerNumber(p) {
  if (typeof p === 'string') return '';
  return p?.number ?? '';
}

function lineupPlayerGrid(p) {
  if (typeof p === 'string') return '';
  return String(p?.grid || '');
}

function shortPlayerName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return escapeHtml(parts.length > 1 ? parts[parts.length - 1] : (parts[0] || 'Игрок'));
}

function lineupPitchHtml(lineup, title) {
  if (!lineup?.startXI?.length) return '<div class="empty compact-empty">Стартовый состав ещё не опубликован.</div>';
  const players = lineup.startXI || [];
  const parsed = players.map((p, i) => {
    const bits = lineupPlayerGrid(p).split(':').map(Number);
    return { p, row: Number.isFinite(bits[0]) ? bits[0] : null, col: Number.isFinite(bits[1]) ? bits[1] : null, i };
  });
  const hasGrid = parsed.filter(x => x.row && x.col).length >= 8;
  if (!hasGrid) {
    return `<div class="lineup-fallback">${players.map((p, i) => `<div class="lineup-fallback-row"><b>${lineupPlayerNumber(p) || i + 1}</b><span>${escapeHtml(lineupPlayerName(p))}</span></div>`).join('')}</div>`;
  }
  const maxRow = Math.max(...parsed.filter(x => x.row).map(x => x.row), 4);
  const rowCounts = {};
  parsed.forEach(x => { if (x.row) rowCounts[x.row] = Math.max(rowCounts[x.row] || 0, x.col || 1); });
  return `<div class="formation-pitch" aria-label="${escapeHtml(title)}">
    <div class="pitch-half-line"></div><div class="pitch-circle"></div>
    ${parsed.map(({p,row,col,i}) => {
      const safeRow = row || Math.min(maxRow, i < 1 ? 1 : 2 + Math.floor((i-1)/4));
      const count = Math.max(1, rowCounts[safeRow] || 1);
      const safeCol = col || ((i % count) + 1);
      const x = count === 1 ? 50 : 12 + ((safeCol - 1) / Math.max(1, count - 1)) * 76;
      const y = maxRow <= 1 ? 50 : 91 - ((safeRow - 1) / (maxRow - 1)) * 82;
      return `<div class="pitch-player" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%">
        <span>${lineupPlayerNumber(p) || '•'}</span><small>${shortPlayerName(lineupPlayerName(p))}</small>
      </div>`;
    }).join('')}
  </div>`;
}

function lineupTeamHtml(lineup, title) {
  if (!lineup) return `<div class="center-lineup-team"><h3>${escapeHtml(title)}</h3><div class="empty compact-empty">Состав не опубликован.</div></div>`;
  const subs = lineup.substitutes || [];
  return `<div class="center-lineup-team">
    <div class="center-lineup-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(lineup.formation || 'Схема —')}</span></div><div class="coach-chip">👔 ${escapeHtml(lineup.coach || 'Тренер —')}</div></div>
    ${lineupPitchHtml(lineup, title)}
    <details class="bench-details"><summary>Запасные · ${subs.length}</summary>
      <div class="bench-grid">${subs.length ? subs.map(p => `<span><b>${lineupPlayerNumber(p) || '•'}</b>${escapeHtml(lineupPlayerName(p))}</span>`).join('') : '<i>Нет данных</i>'}</div>
    </details>
  </div>`;
}

function lineupLiveHtml(lineups, match) {
  const home = lineups?.home;
  const away = lineups?.away;
  if (!home && !away) return '<div class="empty compact-empty">Составы не опубликованы или не входят в покрытие турнира.</div>';
  return `<div class="center-lineups-grid">${lineupTeamHtml(home, match.home?.name || 'Хозяева')}${lineupTeamHtml(away, match.away?.name || 'Гости')}</div>`;
}

function updateLiveCountdown() {
  const el = $('liveRefreshText');
  if (!el || !state.currentCenter || state.currentCenter.mode !== 'live') return;
  el.textContent = `Автообновление через ${Math.max(0, state.liveRefreshRemaining)} сек.`;
}

function startLiveRefresh(fixtureId) {
  stopLiveRefresh();
  if (!runtimeAllows('liveEnabled')) {
    state.liveRefreshWasActive = false;
    const el = $('liveRefreshText');
    if (el) el.textContent = 'Автообновление LIVE временно приостановлено.';
    return;
  }
  state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
  if (document.hidden) {
    state.liveRefreshWasActive = true;
    updateLiveCountdown();
    return;
  }
  state.liveRefreshWasActive = true;
  updateLiveCountdown();
  state.liveRefreshTimer = setInterval(async () => {
    state.liveRefreshRemaining -= 1;
    updateLiveCountdown();
    if (state.liveRefreshRemaining <= 0) {
      state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
      try {
        const data = await api(`/api/match-center?fixtureId=${Number(fixtureId)}&t=${Date.now()}`);
        state.currentCenter = data;
        renderMatchCenter(data);
        if (data.mode !== 'live') stopLiveRefresh();
      } catch (e) {
        state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
        toast(e.message);
      }
    }
  }, 1000);
}


function signedPp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} п.п.`;
}

function oddsMovementHtml(move) {
  if (!move?.baseline || !move?.probabilityChange) return '<p class="muted">История движения появится после нескольких LIVE-снимков.</p>';
  const row = (label, key) => {
    const d = Number(move.probabilityChange?.[key] || 0);
    const cls = d > .4 ? 'up' : d < -.4 ? 'down' : 'flat';
    const arrow = d > .4 ? '↑' : d < -.4 ? '↓' : '→';
    return `<div class="odds-move-row ${cls}"><span>${label}</span><strong>${move.baseline?.[key] ?? '—'} → ${move.current?.[key] ?? '—'}</strong><b>${arrow} ${signedPp(d)}</b></div>`;
  };
  return `<div class="odds-movement-grid">${row('П1','home')}${row('X','draw')}${row('П2','away')}</div><p class="tiny">Сравнение с самым ранним сохранённым LIVE-снимком${move.from ? ` · ${dateTime(move.from)}` : ''}. Изменение указано в расчётной вероятности.</p>`;
}

function livePressureHtml(p, m) {
  if (!p) return '';
  const home = Math.max(0, Math.min(100, Number(p.home || 0)));
  const away = 100 - home;
  const lead = p.leader === 'home' ? m.home?.name : p.leader === 'away' ? m.away?.name : 'Баланс';
  return `<section class="panel pulse-panel"><h2>⚡ Пульс матча</h2><div class="pulse-names"><span>${escapeHtml(m.home?.name || '')}</span><strong>${escapeHtml(lead || 'Баланс')}</strong><span>${escapeHtml(m.away?.name || '')}</span></div><div class="pulse-bar"><i style="width:${home}%"></i><b style="width:${away}%"></b></div><div class="pulse-values"><span>${home}</span><span>${away}</span></div><p class="tiny">${escapeHtml(p.note || '')}</p></section>`;
}

function playerMetricText(p) {
  const bits = [];
  if (Number(p.goals)) bits.push(`${p.goals} гол`);
  if (Number(p.assists)) bits.push(`${p.assists} ассист`);
  if (Number(p.saves)) bits.push(`${p.saves} сейв`);
  if (Number(p.shotsOn)) bits.push(`${p.shotsOn} в створ`);
  if (Number(p.keyPasses)) bits.push(`${p.keyPasses} ключ. пас`);
  if (!bits.length && Number(p.minutes)) bits.push(`${p.minutes} мин`);
  return bits.join(' · ') || '—';
}

function playerLeadersHtml(leaders, m) {
  const side = (title, list) => `<div class="player-leader-side"><h3>${escapeHtml(title)}</h3>${list?.length ? list.map((p,i) => `<div class="player-leader-row">${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span class="player-photo-placeholder">👤</span>'}<div><strong>${i+1}. ${escapeHtml(p.name)}</strong><small>${escapeHtml(playerMetricText(p))}</small></div><b>${p.rating ? p.rating.toFixed(1) : '—'}</b></div>`).join('') : '<p class="muted">Статистика игроков недоступна.</p>'}</div>`;
  return `<div class="player-leaders-grid">${side(m.home?.name || 'Хозяева', leaders?.home || [])}${side(m.away?.name || 'Гости', leaders?.away || [])}</div>`;
}

function liveAbsencesHtml(absences, match) {
  const side = (title, rows = []) => `<div class="absence-live-side"><h3>${escapeHtml(title)}</h3>${rows.length
    ? rows.map(x => `<div class="absence-live-row"><strong>${escapeHtml(x.name || 'Игрок')}</strong><span>${escapeHtml(x.reason || x.type || 'Недоступен')}</span></div>`).join('')
    : '<p class="muted">Нет подтверждённых данных.</p>'}</div>`;
  return `<div class="absence-live-grid">${side(match.home?.name || 'Хозяева', absences?.home || [])}${side(match.away?.name || 'Гости', absences?.away || [])}</div>`;
}


function centerStatNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace('%','').replace(',','.'));
  return Number.isFinite(n) ? n : null;
}

function centerStatRow(stats, key) {
  return (stats?.items || []).find(x => x.key === key) || null;
}

function centerCompareRow(label, homeValue, awayValue, suffix = '') {
  const hn = centerStatNumber(homeValue);
  const an = centerStatNumber(awayValue);
  const total = Math.max(0.001, (hn || 0) + (an || 0));
  const hp = hn === null ? 50 : Math.max(6, Math.min(94, (hn / total) * 100));
  const ap = 100 - hp;
  const fmt = v => v === null || v === undefined || v === '' ? '—' : `${escapeHtml(String(v))}${suffix && !String(v).includes(suffix) ? suffix : ''}`;
  return `<div class="center-stat-visual">
    <div class="center-stat-values"><strong>${fmt(homeValue)}</strong><span>${escapeHtml(label)}</span><strong>${fmt(awayValue)}</strong></div>
    <div class="center-stat-bar"><i style="width:${hp}%"></i><b style="width:${ap}%"></b></div>
  </div>`;
}

function centerKeyStatsHtml(stats) {
  const rows = [
    ['expected_goals','xG'],
    ['Shots on Goal','В створ'],
    ['Total Shots','Удары'],
    ['Ball Possession','Владение'],
    ['Corner Kicks','Угловые'],
  ].map(([key,label]) => [centerStatRow(stats,key), label]).filter(([row]) => row);
  if (!rows.length) return '<div class="empty compact-empty">Ключевая статистика пока недоступна.</div>';
  return `<div class="center-key-stats">${rows.slice(0,5).map(([r,l]) => centerCompareRow(l,r.home,r.away)).join('')}</div>`;
}

function centerAllStatsHtml(stats) {
  const items = stats?.items || [];
  if (!items.length) return '<div class="empty compact-empty">Детальная статистика пока недоступна.</div>';
  return `<div class="center-all-stats">${items.map(x => centerCompareRow(x.label, x.home, x.away)).join('')}</div>`;
}

function timelineEventsHtml(events = [], match = {}) {
  if (!events.length) return '<div class="empty compact-empty">События матча пока не доступны.</div>';
  let hs = 0, as = 0;
  const enriched = events.map(e => {
    const isGoal = String(e.type || '').toLowerCase() === 'goal' && !String(e.detail || '').toLowerCase().includes('missed');
    if (isGoal) {
      if (e.side === 'home') hs += 1;
      if (e.side === 'away') as += 1;
    }
    return { ...e, goalScore: isGoal ? `${hs}:${as}` : '' };
  });
  return `<div class="center-timeline">
    <div class="timeline-club-head"><span>${escapeHtml(match.home?.name || 'Хозяева')}</span><b>Хронология</b><span>${escapeHtml(match.away?.name || 'Гости')}</span></div>
    ${enriched.map(e => `<div class="timeline-row ${escapeHtml(e.side || 'neutral')} ${String(e.type).toLowerCase()==='goal'?'goal':''}">
      <div class="timeline-home">${e.side==='home' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(e.label || '')}</span>` : ''}</div>
      <div class="timeline-minute"><b>${minuteLabel(e)}</b>${e.goalScore ? `<em>${e.goalScore}</em>` : ''}</div>
      <div class="timeline-away">${e.side==='away' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(e.label || '')}</span>` : ''}</div>
    </div>`).join('')}
  </div>`;
}

function centerPlayersHtml(leaders, match) {
  const side = (title, list = []) => `<div class="center-player-team"><h3>${escapeHtml(title)}</h3>${list.length ? list.map((p,i)=>`
    <div class="center-player-row">
      <div class="center-player-rank">${i+1}</div>
      ${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span class="center-player-avatar">👤</span>'}
      <div class="center-player-info"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(playerMetricText(p))}</small></div>
      <div class="center-player-rating">${p.rating ? p.rating.toFixed(1) : '—'}</div>
    </div>`).join('') : '<div class="empty compact-empty">Статистика игроков недоступна.</div>'}</div>`;
  return `<div class="center-players-grid">${side(match.home?.name || 'Хозяева', leaders?.home || [])}${side(match.away?.name || 'Гости', leaders?.away || [])}</div>`;
}


function freshnessSourceLabel(source) {
  return ({
    embedded: 'fixture',
    api: 'API',
    cache: 'cache',
    stale: 'stale',
    skipped: 'skip',
    error: 'error',
  })[source] || source || '—';
}

function freshnessAgeLabel(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return `${Math.max(0, Math.round(s))}с`;
  if (s < 3600) return `${Math.round(s / 60)}м`;
  return `${Math.round(s / 3600)}ч`;
}

function centerFreshnessHtml(d) {
  const rows = Object.entries(d.dataFreshness || {});
  if (!rows.length) return '';
  const names = { events:'События', statistics:'Статистика', players:'Игроки', lineups:'Составы', injuries:'Потери', liveOdds:'LIVE odds' };
  return `<div class="center-freshness">
    ${rows.map(([key, meta]) => `<div class="${escapeHtml(meta?.source || '')}">
      <span>${escapeHtml(names[key] || key)}</span>
      <strong>${escapeHtml(freshnessSourceLabel(meta?.source))}</strong>
      <small>${freshnessAgeLabel(meta?.ageSeconds)}${meta?.policy?.ttlSeconds ? ` · TTL ${Math.round(Number(meta.policy.ttlSeconds)/60*10)/10}м` : ''}</small>
    </div>`).join('')}
  </div>`;
}

function centerCoverageHtml(d) {
  const cells = [
    ['События', d.availability?.events],
    ['Статистика', d.availability?.statistics],
    ['Составы', d.availability?.lineups],
    ['Игроки', d.availability?.players],
    ['Потери', d.availability?.injuries],
    ['Рынок', Boolean(d.liveOdds)],
  ];
  return `<div class="center-coverage">${cells.map(([label,ok])=>`<span class="${ok?'ok':''}">${ok?'✓':'·'} ${label}</span>`).join('')}</div>`;
}

function centerMarketHtml(d) {
  if (!d.liveOdds) return `<div class="empty compact-empty">LIVE-рынок 1X2 сейчас недоступен. Покрытие зависит от турнира и режима данных.</div>`;
  return `<div class="center-market">
    <div class="odds-grid">
      <div><span>П1</span><strong>${d.liveOdds.odds?.home ?? '—'}</strong></div>
      <div><span>X</span><strong>${d.liveOdds.odds?.draw ?? '—'}</strong></div>
      <div><span>П2</span><strong>${d.liveOdds.odds?.away ?? '—'}</strong></div>
    </div>
    <p class="tiny">Источников: ${Number(d.liveOdds.sources || 0)}${d.liveOdds.updatedAt ? ` · ${escapeHtml(String(d.liveOdds.updatedAt))}` : ''}</p>
    <div class="odds-movement-wrap"><h3>Движение рынка</h3>${oddsMovementHtml(d.oddsMovement)}</div>
  </div>`;
}

function centerAbsenceSummary(absences, match) {
  const hc = absences?.home?.length || 0;
  const ac = absences?.away?.length || 0;
  if (!hc && !ac) return '';
  return `<div class="center-absence-summary">
    <div><span>${escapeHtml(match.home?.name || 'Хозяева')}</span><strong>${hc}</strong><small>потерь</small></div>
    <div><span>${escapeHtml(match.away?.name || 'Гости')}</span><strong>${ac}</strong><small>потерь</small></div>
  </div>`;
}

function setMatchCenterTab(tab, scroll = false) {
  state.currentCenterTab = tab || 'summary';
  document.querySelectorAll('.center-tab-btn').forEach(btn => {
    const active = btn.dataset.centerTab === state.currentCenterTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.center-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.centerPanel === state.currentCenterTab));
  if (scroll) document.querySelector('.center-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindMatchCenterTabs() {
  document.querySelectorAll('.center-tab-btn').forEach(btn => btn.addEventListener('click', () => setMatchCenterTab(btn.dataset.centerTab, false)));
  setMatchCenterTab(state.currentCenterTab || 'summary');
}


function insightSideLabel(side, match) {
  if (side === 'home') return match.home?.name || 'Хозяева';
  if (side === 'away') return match.away?.name || 'Гости';
  return 'Матч';
}

function smartInsightCardHtml(insight, match) {
  const sideClass = insight.side === 'home' ? 'home' : insight.side === 'away' ? 'away' : 'neutral';
  const metrics = Array.isArray(insight.metrics) && insight.metrics.length
    ? `<div class="insight-metrics">${insight.metrics.map(m => `<span>${escapeHtml(m.label || '')}: <b>${m.home ?? '—'} — ${m.away ?? '—'}</b></span>`).join('')}</div>`
    : '';
  return `<article class="smart-insight-card ${sideClass} ${escapeHtml(insight.importance || 'medium')}">
    <div class="smart-insight-icon">${escapeHtml(insight.icon || '💡')}</div>
    <div class="smart-insight-body">
      <div class="smart-insight-kicker">${escapeHtml(insightSideLabel(insight.side, match))}</div>
      <h3>${escapeHtml(insight.title || 'Наблюдение')}</h3>
      <p>${escapeHtml(insight.text || '')}</p>
      ${metrics}
    </div>
  </article>`;
}

function smartInsightsHeroHtml(si, match) {
  if (!si?.available) {
    return `<section class="panel smart-story-panel is-empty">
      <div class="center-section-title"><div><h2>🧠 Умные инсайты</h2><p>Автоматическое объяснение происходящего</p></div></div>
      <div class="empty compact-empty">Пока недостаточно статистики и событий для содержательного вывода.</div>
    </section>`;
  }
  const first = si.insights?.[0];
  return `<section class="panel smart-story-panel">
    <div class="smart-story-top">
      <div><span class="smart-story-label">🧠 КАРТИНА МАТЧА</span><h2>${escapeHtml(si.headline || '')}</h2></div>
      <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(si.dataLabel || 'Покрытие')}</span></div>
    </div>
    <p class="smart-story-summary">${escapeHtml(si.summary || '')}</p>
    ${first ? `<div class="smart-story-focus"><span>${escapeHtml(first.icon || '💡')}</span><b>${escapeHtml(insightSideLabel(first.side, match))}</b><small>${escapeHtml(first.importance === 'high' ? 'Сильный сигнал' : first.importance === 'medium' ? 'Заметный сигнал' : 'Наблюдение')}</small></div>` : ''}
    <button class="text-btn smart-open-insights" type="button">Все инсайты →</button>
  </section>`;
}

function smartInsightsFullHtml(si, match) {
  if (!si?.available) {
    return `<div class="empty"><strong>Недостаточно данных</strong><p>Когда появятся статистика и события, здесь будут автоматические выводы по ходу матча.</p></div>`;
  }
  return `<div class="smart-insights-full">
    <section class="panel smart-insight-summary-panel">
      <div class="smart-story-top">
        <div><span class="smart-story-label">ТЕКУЩАЯ КАРТИНА</span><h2>${escapeHtml(si.headline || '')}</h2></div>
        <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(si.dataLabel || '')}</span></div>
      </div>
      <p>${escapeHtml(si.summary || '')}</p>
    </section>
    <div class="smart-insight-list">${(si.insights || []).map(x => smartInsightCardHtml(x, match)).join('')}</div>
    <section class="panel smart-methodology"><strong>Как это считается</strong><p>${escapeHtml(si.methodology || '')}</p></section>
  </div>`;
}

function renderMatchCenter(d) {
  const previousFixture = Number(state.currentCenter?.match?.fixtureId || 0);
  state.currentCenter = d;
  if (isAdmin() && d?.provider?.visibility === 'admin') { state.provider = d.provider; renderProvider(); }
  state.currentAnalysis = null;
  const m = d.match || {};
  if (previousFixture && previousFixture !== Number(m.fixtureId || 0)) state.currentCenterTab = 'summary';

  const live = d.mode === 'live';
  const finished = d.mode === 'finished';
  const upcoming = d.mode === 'upcoming';
  const score = m.score || {};
  const scoreText = upcoming ? timeOf(m.date) : `${score.home ?? 0} : ${score.away ?? 0}`;
  const statusText = live ? '● LIVE' : finished ? '✓ ЗАВЕРШЁН' : 'ПРЕДСТОИТ';
  const latestEvents = (d.events || []).slice(-3).reverse();

  $('analysis').innerHTML = `
    <section class="panel center-hero ${live ? 'is-live' : ''}">
      <div class="center-hero-top">
        <span class="live-pill ${live ? 'active' : finished ? 'finished' : ''}">${statusText}</span>
        <span class="center-competition">${escapeHtml(m.league || '')}${m.round ? ` · ${escapeHtml(m.round)}` : ''}</span>
      </div>

      <div class="center-scoreboard">
        <button class="center-team-card" type="button" data-center-team="${Number(m.home?.id || 0)}">
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span class="center-logo-fallback">⚽</span>'}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
          <small>Хозяева</small>
        </button>
        <div class="center-score-core">
          <strong>${escapeHtml(scoreText)}</strong>
          <span>${escapeHtml(m.statusLabel || '')}</span>
          ${live ? `<small id="liveRefreshText">Обновление через ${Number(d.refreshSeconds || 60)} сек.</small>` : `<small>${upcoming ? dateTime(m.date) : `Обновлено ${dateTime(d.generatedAt)}`}</small>`}
        </div>
        <button class="center-team-card away" type="button" data-center-team="${Number(m.away?.id || 0)}">
          ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span class="center-logo-fallback">⚽</span>'}
          <strong>${escapeHtml(m.away?.name || '')}</strong>
          <small>Гости</small>
        </button>
      </div>

      <div class="center-meta-line">
        ${m.venue ? `<span>🏟 ${escapeHtml(m.venue)}</span>` : ''}
        ${m.city ? `<span>📍 ${escapeHtml(m.city)}</span>` : ''}
        ${m.referee ? `<span>🧑‍⚖️ ${escapeHtml(m.referee)}</span>` : ''}
      </div>

      <div class="center-hero-actions ${isAdmin() ? 'has-admin-audit' : ''}">
        <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить</button>
        ${upcoming ? `<button id="centerAnalyzeBtn" class="primary-btn center-analyze-inline" type="button">🧠 Полный анализ</button>` : ''}
        ${isAdmin() ? `<button id="centerCoverageAuditBtn" class="reminder-btn admin-audit-btn" type="button">🧪 Покрытие</button>` : ''}
        ${isAdmin() ? `<button id="centerE2EBtn" class="reminder-btn admin-e2e-btn" type="button">🚦 E2E</button>` : ''}
      </div>
    </section>

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Показан последний сохранённый снимок</strong><p>${escapeHtml(d.warning || 'Провайдер временно ограничил запросы.')}</p></section>` : ''}
    ${d.note ? `<section class="panel center-note"><p class="tiny warning">${escapeHtml(d.note)}</p></section>` : ''}

    <div class="center-tabs-wrap">
      <div class="center-tabs" role="tablist" aria-label="Разделы матча">
        <button class="center-tab-btn" data-center-tab="summary" type="button">Обзор</button>
        <button class="center-tab-btn" data-center-tab="insights" type="button">Инсайты</button>
        <button class="center-tab-btn" data-center-tab="timeline" type="button">Хронология</button>
        <button class="center-tab-btn" data-center-tab="stats" type="button">Статистика</button>
        <button class="center-tab-btn" data-center-tab="lineups" type="button">Составы</button>
        <button class="center-tab-btn" data-center-tab="players" type="button">Игроки</button>
        <button class="center-tab-btn" data-center-tab="market" type="button">Рынок</button>
      </div>
    </div>

    <div class="center-tab-panel" data-center-panel="summary">
      ${smartInsightsHeroHtml(d.smartInsights, m)}
      ${livePressureHtml(d.livePressure, m)}
      <section class="panel">
        <div class="center-section-title"><div><h2>Ключевые показатели</h2><p>Самые полезные метрики в одном экране</p></div><span class="coverage-badge">${escapeHtml(d.dataCapabilities?.label || 'Покрытие данных')}</span></div>
        ${centerKeyStatsHtml(d.statistics)}
      </section>

      ${latestEvents.length ? `<section class="panel"><div class="center-section-title"><div><h2>Последние события</h2><p>Что произошло недавно</p></div></div>${liveEventsHtml(latestEvents)}</section>` : ''}

      ${(d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><div class="center-section-title"><div><h2>🩺 Потери состава</h2><p>Подтверждённые недоступные игроки</p></div></div>${centerAbsenceSummary(d.absences,m)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}

      <section class="panel coverage-panel">
        <div class="center-section-title"><div><h2>Покрытие и свежесть</h2><p>${d.cached ? 'Данные из общего кэша' : 'Свежий ответ провайдера'} · ${dateTime(d.generatedAt)}</p></div></div>
        ${centerCoverageHtml(d)}
        ${centerFreshnessHtml(d)}
        ${d.quotaMode ? `<div class="quota-public-chip">${escapeHtml(d.quotaMode.label || '')} · обновление ${Number(d.quotaMode.liveRefreshSeconds || d.refreshSeconds || 0)} сек.</div>` : ''}
        ${d.availability?.limitedCoverage ? '<div class="coverage-badge limited">Ограниченное покрытие · экономим API-лимит</div>' : ''}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="insights">
      ${smartInsightsFullHtml(d.smartInsights, m)}
    </div>

    <div class="center-tab-panel" data-center-panel="timeline">
      <section class="panel">
        <div class="center-section-title"><div><h2>⚡ Хронология матча</h2><p>Голы, карточки, замены и VAR</p></div></div>
        ${timelineEventsHtml(d.events, m)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="stats">
      <section class="panel">
        <div class="center-section-title"><div><h2>📊 Статистика матча</h2><p>Сравнение команд по доступным показателям</p></div></div>
        ${centerAllStatsHtml(d.statistics)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="lineups">
      <section class="panel">
        <div class="center-section-title"><div><h2>👥 Составы и схема</h2><p>Стартовые XI, формации и запасные</p></div></div>
        ${lineupLiveHtml(d.lineups, m)}
      </section>
      ${(d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><h2>🩺 Недоступные игроки</h2>${liveAbsencesHtml(d.absences,m)}</section>` : ''}
    </div>

    <div class="center-tab-panel" data-center-panel="players">
      <section class="panel">
        <div class="center-section-title"><div><h2>⭐ Игроки матча</h2><p>Лучшие доступные player stats и рейтинг</p></div></div>
        ${centerPlayersHtml(d.playerLeaders, m)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="market">
      <section class="panel">
        <div class="center-section-title"><div><h2>💹 LIVE-рынок</h2><p>1X2 и движение implied probability</p></div></div>
        ${centerMarketHtml(d)}
      </section>
    </div>
  `;

  bindMatchCenterTabs();
  document.querySelectorAll('.smart-open-insights').forEach(btn => btn.addEventListener('click', () => setMatchCenterTab('insights', true)));

  document.querySelectorAll('[data-center-team]').forEach(btn => btn.addEventListener('click', () => {
    const teamId = Number(btn.dataset.centerTeam || 0);
    if (!teamId) return;
    openTeam(teamId, btn);
  }));

  $('centerAnalyzeBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget));
  $('centerCoverageAuditBtn')?.addEventListener('click', async () => {
    await runProviderCoverageAudit(Number(m.fixtureId), true);
    await openProfileView();
    setTimeout(() => $('providerAuditResult')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  });
  $('centerE2EBtn')?.addEventListener('click', async () => {
    await runProviderE2E(Number(m.fixtureId));
    await openProfileView();
    setTimeout(() => $('expandedGateSteps')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  });

  $('centerRefreshBtn')?.addEventListener('click', async () => {
    const btn = $('centerRefreshBtn');
    btn.disabled = true; btn.textContent = '⏳ Обновляю…';
    try {
      const data = await api(`/api/match-center?fixtureId=${Number(m.fixtureId)}&t=${Date.now()}`);
      state.currentCenter = data;
      renderMatchCenter(data);
    } catch (e) {
      toast(e.message);
      btn.disabled = false; btn.textContent = '↻ Обновить';
    }
  });

  if (live) startLiveRefresh(m.fixtureId); else stopLiveRefresh();
}

async function openMatchCenter(fixtureId, btn) {
  if (Number(state.currentCenter?.match?.fixtureId || 0) !== Number(fixtureId)) state.currentCenterTab = 'summary';
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю матч…'; }
  try {
    const data = await api(`/api/match-center?fixtureId=${Number(fixtureId)}`);
    renderMatchCenter(data);
    showView('analysisView');
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function analyzeMatch(fixtureId, btn) {
  if (!runtimeAllows('analysisEnabled')) {
    toast(state.runtimeStatus?.message || 'Полный анализ временно приостановлен.');
    return;
  }
  stopLiveRefresh();
  state.currentCenter = null;
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Собираю данные…'; }
  try {
    const data = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ fixtureId }) });
    state.currentAnalysis = data;
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    renderAnalysis(data);
    if (state.profile && data.quota) {
      state.profile.quota = data.quota;
      renderProfile();
    }
    await Promise.all([loadHistory(false), loadReminders()]);
    showView('analysisView');
  } catch (e) {
    if (e.status === 429 && String(e.payload?.code || '').startsWith('FOOTBALL_')) {
      toast(e.payload?.retryAfter ? `Футбольный API на паузе. Повторите через ~${e.payload.retryAfter} сек.` : e.message);
    } else if (e.status === 429) toast('Дневной лимит анализов исчерпан.');
    else toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function loadHistory(showLoader = true) {
  if (showLoader) $('history').innerHTML = '<div class="loader">Загружаю историю…</div>';
  try {
    const data = await api('/api/history');
    state.history = data.items || [];
    state.historyLoaded = true;
    renderHistory();
} catch (e) {
    if (state.historyLoaded && state.history.length) {
      renderHistory();
      $('history')?.insertAdjacentHTML('afterbegin', `<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показана последняя загруженная история.</div>`);
      return;
    }
    $('history').innerHTML = recoveryCardHtml({ title: 'История временно недоступна', message: e.message, retryId: 'historyRecoveryRetry' });
    $('historyRecoveryRetry')?.addEventListener('click', () => loadHistory(true));
  }
}

function renderHistory() {
  if (!state.history.length) {
    $('history').innerHTML = '<div class="empty">История пока пуста. Сделайте первый полный анализ матча.</div>';
    return;
  }
  $('history').innerHTML = state.history.map(item => `
    <article class="history-item">
      <div class="history-logos">
        ${item.homeLogo ? `<img src="${safeUrl(item.homeLogo)}" alt="">` : ''}
        <span>—</span>
        ${item.awayLogo ? `<img src="${safeUrl(item.awayLogo)}" alt="">` : ''}
      </div>
      <div class="history-main">
        <strong>${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}</strong>
        <span>${escapeHtml(item.leagueName || '')}${item.fixtureDate ? ` · ${dateTime(item.fixtureDate)}` : ''}</span>
      </div>
      <button class="history-open" data-fixture="${Number(item.fixtureId)}" type="button">Открыть</button>
    </article>
  `).join('');
  document.querySelectorAll('.history-open').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
}

function pct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'; }

function formSequence(form) {
  if (!form) return '—';
  return String(form).split('').map(x => x === 'W' ? 'П' : x === 'D' ? 'Н' : x === 'L' ? 'ПР' : x).join(' · ');
}

function formCard(title, form) {
  const o = form?.overall;
  const v = form?.venue;
  if (!o?.sample) return `<div class="form-team-card"><strong>${escapeHtml(title)}</strong><p class="muted">Недостаточно данных по последним матчам.</p></div>`;
  return `<div class="form-team-card">
    <strong>${escapeHtml(title)}</strong>
    <div class="form-sequence">${escapeHtml(formSequence(o.form))}</div>
    <div class="mini-metrics">
      <span><b>${o.ppg}</b><small>очки/матч</small></span>
      <span><b>${o.gfAvg}</b><small>забито</small></span>
      <span><b>${o.gaAvg}</b><small>пропущено</small></span>
      <span><b>${o.over25Pct}%</b><small>ТБ 2.5</small></span>
    </div>
    ${v?.sample ? `<p class="muted">${form.preferredVenue === 'home' ? 'Дома' : 'В гостях'}: ${v.ppg} очка/матч · выборка ${v.sample}</p>` : ''}
  </div>`;
}

function modelWeightsText(weights = {}) {
  const names = { market: 'рынок', apiPrediction: 'API', recentForm: 'форма', h2h: 'H2H' };
  const parts = Object.entries(weights).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${names[k] || k} ${Number(v).toFixed(0)}%`);
  return parts.length ? parts.join(' · ') : 'Недостаточно сигналов';
}

function bullets(items = [], empty = 'Нет существенных факторов.') {
  if (!items?.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<ul class="list analysis-list">${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
}

function absenceList(title, items) {
  if (!items?.length) return `<div class="data-card"><span>${escapeHtml(title)}</span><strong>Нет данных</strong></div>`;
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><ul class="list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong>${x.reason ? ` — ${escapeHtml(x.reason)}` : ''}${x.type ? ` (${escapeHtml(x.type)})` : ''}</li>`).join('')}</ul></div>`;
}

function reminderFor(fixtureId) {
  return state.reminders.find(x => Number(x.fixtureId) === Number(fixtureId)) || null;
}

function hasReminder(fixtureId) {
  return Boolean(reminderFor(fixtureId));
}

async function toggleReminder(match) {
  if (!match?.fixtureId) return;
  const active = hasReminder(match.fixtureId);
  if (!active && !runtimeAllows('remindersEnabled')) {
    toast('Новые уведомления временно приостановлены.');
    return;
  }
  try {
    if (active) {
      await api(`/api/reminders?fixtureId=${Number(match.fixtureId)}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== Number(match.fixtureId));
      toast('Напоминание отключено');
    } else {
      await api('/api/reminders', {
        method: 'POST',
        body: JSON.stringify({
          fixtureId: Number(match.fixtureId),
          homeName: match.home?.name || '',
          awayName: match.away?.name || '',
          leagueName: match.league || '',
          fixtureDate: match.date || '',
          reminderMinutes: Number(state.preferences?.reminderMinutes || 30),
          kickoffNotify: state.preferences?.kickoffNotification !== false,
        }),
      });
      await loadReminders();
      toast(`Напомним примерно за ${Number(state.preferences?.reminderMinutes || 30)} минут до матча${state.preferences?.kickoffNotification !== false ? ' и около старта' : ''}`);
    }
    await loadProfile();
    renderAnalysis(state.currentAnalysis);
  } catch (e) {
    toast(e.message);
  }
}

function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function qualityInfo(completeness = {}) {
  const score = Number(completeness.score || 0);
  const max = Math.max(1, Number(completeness.max || 10));
  const ratio = score / max;
  if (ratio >= .8) return { label: 'Высокая полнота', cls: 'good' };
  if (ratio >= .55) return { label: 'Средняя полнота', cls: 'medium' };
  return { label: 'Ограниченные данные', cls: 'low' };
}

function probabilityStrip(p = {}) {
  const home = clampPercent(p.home);
  const draw = clampPercent(p.draw);
  const away = clampPercent(p.away);
  const total = home + draw + away || 1;
  const h = home / total * 100;
  const d = draw / total * 100;
  const a = away / total * 100;
  return `<div class="probability-strip" aria-label="Вероятности исхода">
    <span class="prob-segment home" style="width:${h.toFixed(2)}%"></span>
    <span class="prob-segment draw" style="width:${d.toFixed(2)}%"></span>
    <span class="prob-segment away" style="width:${a.toFixed(2)}%"></span>
  </div>`;
}

function analysisSourceStatus(d) {
  const parts = [];
  if (d.market) parts.push('Рынок');
  if (d.apiPrediction) parts.push('API');
  if (d.recentForm?.home?.overall?.sample || d.recentForm?.away?.overall?.sample) parts.push('Форма');
  if ((d.h2h?.homeWins || 0) + (d.h2h?.awayWins || 0) + (d.h2h?.draws || 0) > 0) parts.push('H2H');
  if (d.news?.answer) parts.push('Новости');
  return parts.length ? parts.join(' · ') : 'Базовые данные';
}

function compactAbsence(title, items) {
  if (!items?.length) return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><p class="muted">Заявленных потерь нет или данные недоступны.</p></div>`;
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><ul class="compact-list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml([x.reason, x.type].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul></div>`;
}

function lineupBlock(title, lineup) {
  const players = lineup?.startXI || [];
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)} <span>${escapeHtml(lineup?.formation || '')}</span></div>${players.length ? `<div class="lineup-list">${players.map((x,i) => `<span><b>${lineupPlayerNumber(x) || i+1}</b>${escapeHtml(lineupPlayerName(x))}</span>`).join('')}</div>` : '<p class="muted">Стартовый состав ещё не опубликован.</p>'}</div>`;
}

async function shareAnalysis(d) {
  const m = d?.match || {};
  const p = d?.probabilities || {};
  const text = [
    `⚽ ${m.home?.name || ''} — ${m.away?.name || ''}`,
    `${m.league || ''}${m.date ? ` · ${dateTime(m.date)}` : ''}`,
    `П1 ${pct(p.home)} · X ${pct(p.draw)} · П2 ${pct(p.away)}`,
    `Наиболее вероятно: ${d?.likelyOutcome || '—'}`,
    `Уверенность: ${d?.confidence?.score ?? '—'}/100`,
    '',
    'Football Analytics · аналитическая оценка, не гарантия результата.'
  ].join('\n');
  try {
    if (navigator.share) {
      await navigator.share({ title: `${m.home?.name || ''} — ${m.away?.name || ''}`, text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Краткий анализ скопирован');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Не удалось поделиться анализом');
  }
}

function setAnalysisTab(tab, scroll = false) {
  state.currentAnalysisTab = tab || 'brief';
  const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
  const panels = [...document.querySelectorAll('.analysis-tab-panel')];
  buttons.forEach(btn => {
    const active = btn.dataset.tab === state.currentAnalysisTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  panels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === state.currentAnalysisTab));
  if (scroll) document.querySelector('.analysis-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function bindAnalysisTabs() {
  const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
  buttons.forEach(btn => btn.addEventListener('click', () => setAnalysisTab(btn.dataset.tab, true)));
  setAnalysisTab(state.currentAnalysisTab || 'brief', false);
}


function comparisonValue(metric, side) {
  const value = Number(metric?.[side === 'home' ? 'homeValue' : 'awayValue']);
  if (!Number.isFinite(value)) return '—';
  if (metric.format === 'percent') return `${Math.round(value)}%`;
  if (metric.format === 'rank') return `${Math.round(value)} место`;
  if (metric.format === 'integer') return String(Math.round(value));
  return value.toFixed(1);
}

function comparisonMetricRow(metric) {
  const edge = metric?.edge || 'even';
  const edgeLabel = edge === 'home' ? '← преимущество' : edge === 'away' ? 'преимущество →' : '≈ близко';
  return `<div class="comparison-row ${escapeHtml(edge)}">
    <div class="comparison-values"><strong>${comparisonValue(metric,'home')}</strong><span>${escapeHtml(metric.label || '')}</span><strong>${comparisonValue(metric,'away')}</strong></div>
    <div class="comparison-track"><i class="home"></i><b>${escapeHtml(edgeLabel)}</b><i class="away"></i></div>
    ${metric.note ? `<small>${escapeHtml(metric.note)}</small>` : ''}
  </div>`;
}

function comparisonAdvantages(title, items = [], side = '') {
  return `<div class="comparison-advantages-card ${side}"><strong>${escapeHtml(title)}</strong>${items.length
    ? `<ul>${items.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    : '<p>Явного перевеса по доступным метрикам нет.</p>'}</div>`;
}

function comparisonTeamHeader(team, side, edges) {
  return `<button class="comparison-team-head ${side}" type="button" data-open-team="${Number(team?.id || 0)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${safeUrl(team?.logo || '')}">
    ${team?.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '<span class="comparison-logo-placeholder">⚽</span>'}
    <span><strong>${escapeHtml(team?.name || '')}</strong><small>${Number(edges || 0)} метрик с преимуществом</small></span>
  </button>`;
}


function prematchOutcomeName(key, match) {
  if (key === 'home') return match.home?.name || 'П1';
  if (key === 'away') return match.away?.name || 'П2';
  if (key === 'draw') return 'Ничья';
  return '—';
}

function prematchUncertaintyClass(level) {
  return level === 'low' ? 'good' : level === 'high' ? 'low' : 'medium';
}

function prematchDriverCard(driver, match) {
  const sideName = driver.side === 'home' ? match.home?.name : driver.side === 'away' ? match.away?.name : '';
  const strengthText = driver.strength === 'high' ? 'сильный фактор' : driver.strength === 'low' ? 'контекст' : 'заметный фактор';
  return `<article class="prematch-driver ${escapeHtml(driver.side || 'neutral')} ${escapeHtml(driver.strength || 'medium')}">
    <div class="prematch-driver-icon">${escapeHtml(driver.icon || '•')}</div>
    <div class="prematch-driver-body">
      <div class="prematch-driver-kicker">${sideName ? `${escapeHtml(sideName)} · ` : ''}${escapeHtml(strengthText)}</div>
      <h3>${escapeHtml(driver.title || 'Фактор')}</h3>
      <p>${escapeHtml(driver.text || '')}</p>
      ${Number.isFinite(Number(driver.weight)) ? `<div class="driver-weight"><span>Вес в blend</span><strong>${Number(driver.weight).toFixed(1)}%</strong></div>` : ''}
    </div>
  </article>`;
}

function prematchScenarioCard(scenario) {
  return `<article class="prematch-scenario ${escapeHtml(scenario.tone || 'balanced')}">
    <div class="prematch-scenario-top"><span>${escapeHtml(scenario.icon || '•')}</span><small>${escapeHtml(scenario.relevance || '')}</small></div>
    <h3>${escapeHtml(scenario.title || '')}</h3>
    <p>${escapeHtml(scenario.text || '')}</p>
  </article>`;
}

function prematchSourceRow(row, match) {
  const finalKey = state.currentAnalysis?.preMatchIntelligence?.leader?.key || '';
  return `<div class="prematch-source-row ${row.agreesWithFinal ? 'agree' : 'disagree'}">
    <div class="prematch-source-main">
      <span class="prematch-source-icon">${escapeHtml(row.icon || '•')}</span>
      <div><strong>${escapeHtml(row.label || '')}</strong><small>Вес ${Number(row.weight || 0).toFixed(1)}%</small></div>
    </div>
    <div class="prematch-source-result">
      <strong>${escapeHtml(row.leader || '—')}</strong>
      <span>${Number(row.leaderProbability || 0).toFixed(1)}%</span>
    </div>
    <div class="prematch-source-status">${row.agreesWithFinal ? '✓ согласен' : '↔ расходится'}</div>
  </div>`;
}

function prematchBriefHtml(pm, match, probabilities) {
  if (!pm) {
    return `<section class="panel"><div class="empty"><strong>Бриф недоступен</strong><p>Пересчитайте анализ после обновления приложения.</p></div></section>`;
  }
  const uncertainty = pm.uncertainty || {};
  const leader = pm.leader || {};
  const dataScore = Number(pm.dataScore || 0);
  return `
    <section class="panel prematch-brief-hero">
      <div class="prematch-brief-top">
        <div>
          <span class="prematch-brief-label">🧠 MATCH BRIEF</span>
          <h2>${escapeHtml(pm.headline || 'Предматчевый бриф')}</h2>
        </div>
        <div class="prematch-data-score"><strong>${dataScore}%</strong><span>полнота данных</span></div>
      </div>
      <p class="prematch-brief-summary">${escapeHtml(pm.summary || '')}</p>

      <div class="prematch-brief-kpis">
        <div><span>Главный сценарий</span><strong>${escapeHtml(leader.label || prematchOutcomeName(leader.key, match))}</strong><small>${Number(leader.probability || 0).toFixed(1)}%</small></div>
        <div><span>Отрыв</span><strong>${Number(leader.gap || 0).toFixed(1)} п.п.</strong><small>от второго исхода</small></div>
        <div><span>Неопределённость</span><strong>${Number(uncertainty.score || 0)}/100</strong><small>${escapeHtml(uncertainty.label || '')}</small></div>
      </div>

      <div class="prematch-hero-probs">
        <div><span>${escapeHtml(match.home?.name || 'П1')}</span><strong>${pct(probabilities?.home)}</strong></div>
        <div><span>Ничья</span><strong>${pct(probabilities?.draw)}</strong></div>
        <div><span>${escapeHtml(match.away?.name || 'П2')}</span><strong>${pct(probabilities?.away)}</strong></div>
      </div>
      ${probabilityStrip(probabilities)}
    </section>

    <section class="panel">
      <div class="prematch-section-head"><div><h2>Почему модель пришла к этим процентам</h2><p>Факторы отсортированы по полезности и весу источников</p></div><span>${(pm.drivers || []).length} факторов</span></div>
      <div class="prematch-driver-list">${(pm.drivers || []).length ? pm.drivers.map(x => prematchDriverCard(x, match)).join('') : '<div class="empty compact-empty">Сильных факторов пока недостаточно.</div>'}</div>
    </section>

    <section class="panel">
      <div class="prematch-section-head"><div><h2>Сценарии матча</h2><p>Не новые прогнозы, а интерпретация уже рассчитанных сигналов</p></div></div>
      <div class="prematch-scenarios">${(pm.scenarios || []).length ? pm.scenarios.map(prematchScenarioCard).join('') : '<div class="empty compact-empty">Сценарии не сформированы из-за ограниченных данных.</div>'}</div>
    </section>

    <section class="panel">
      <div class="prematch-section-head"><div><h2>Что может изменить оценку до старта</h2><p>Факторы, за которыми стоит следить перед матчем</p></div></div>
      ${(pm.watch || []).length ? `<div class="prematch-watch-list">${pm.watch.map((x,i)=>`<div><b>${i+1}</b><span>${escapeHtml(x)}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Критичных ожидаемых изменений по доступным данным нет.</div>'}
    </section>

    <section class="panel">
      <div class="prematch-section-head"><div><h2>Как голосуют источники</h2><p>Каждый источник имеет собственную оценку и вес в объединении</p></div></div>
      <div class="prematch-source-table">${(pm.sourceRows || []).length ? pm.sourceRows.map(x => prematchSourceRow(x, match)).join('') : '<div class="empty compact-empty">Детальные signal-level данные пока недоступны.</div>'}</div>
      <p class="tiny warning">${escapeHtml(pm.methodology || '')}</p>
    </section>`;
}

function renderAnalysis(d) {
  if (!d) return;
  const previousFixture = Number(state.currentAnalysis?.match?.fixtureId || 0);
  const nextFixture = Number(d?.match?.fixtureId || 0);
  if (previousFixture && nextFixture && previousFixture !== nextFixture) state.currentAnalysisTab = 'brief';
  state.currentAnalysis = d;
  const p = d.probabilities || {};
  const m = d.match || {};
  const market = d.market;
  const pred = d.apiPrediction;
  const h2h = d.h2h || {};
  const news = d.news || {};
  const homeLine = d.lineups?.home;
  const awayLine = d.lineups?.away;
  const activeReminder = reminderFor(m.fixtureId);
  const reminderActive = Boolean(activeReminder);
  const confidence = d.confidence || {};
  const goal = d.goalModel;
  const recent = d.recentForm || {};
  const comparison = d.comparison || { metrics: [], advantages: { home: [], away: [] }, score: { home: 0, away: 0, even: 0 }, dataReuse: {} };
  const quality = qualityInfo(d.completeness);
  const confidenceScore = clampPercent(confidence.score);

  $('analysis').innerHTML = `
    <section class="panel match-experience-hero">
      <div class="match-experience-meta">
        <span>${escapeHtml(m.league || 'Турнир')}${m.country ? ` · ${escapeHtml(m.country)}` : ''}</span>
        <span>${dateTime(m.date)}</span>
      </div>

      <div class="match-experience-teams">
        <div class="experience-team">
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
          <small>Хозяева</small>
        </div>
        <div class="experience-vs">
          <span>VS</span>
          ${m.venue ? `<small>${escapeHtml(m.venue)}</small>` : ''}
        </div>
        <div class="experience-team">
          ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
          <strong>${escapeHtml(m.away?.name || '')}</strong>
          <small>Гости</small>
        </div>
      </div>

      <div class="experience-callout">
        <span>Наиболее вероятный исход</span>
        <strong>${escapeHtml(d.likelyOutcome || 'Недостаточно данных')}</strong>
      </div>

      ${d.preMatchIntelligence ? `<button class="prematch-brief-jump" id="openPrematchBrief" type="button">
        <span>🧠 Предматчевый бриф</span>
        <strong>${escapeHtml(d.preMatchIntelligence.headline || '')}</strong>
        <small>Открыть причины, сценарии и риски →</small>
      </button>` : ''}

      <div class="experience-prob-labels">
        <div><span>П1</span><strong>${pct(p.home)}</strong></div>
        <div><span>X</span><strong>${pct(p.draw)}</strong></div>
        <div><span>П2</span><strong>${pct(p.away)}</strong></div>
      </div>
      ${probabilityStrip(p)}

      <div class="experience-health-row">
        <span class="quality-pill ${quality.cls}">● ${quality.label}</span>
        <span>${d.stale ? '⚠️ Устаревший кэш' : d.cached ? '⚡ Кэш' : '🆕 Свежий'} · ${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</span>
        <span>Обновлено ${d.generatedAt ? `${timeOf(d.generatedAt)} · ${relativeAge(d.generatedAt)}` : '—'}</span>
      </div>

      <div class="experience-actions">
        <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''}" type="button">${reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
        <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться</button>
      </div>
    </section>

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Использован последний сохранённый анализ</strong><p>${escapeHtml(d.warning || 'Свежие данные временно недоступны из-за ограничения провайдера.')}</p></section>` : ''}

    <div class="analysis-tabs" role="tablist">
      <button class="analysis-tab-btn" data-tab="brief" type="button">Бриф</button>
      <button class="analysis-tab-btn" data-tab="overview" type="button">Обзор</button>
      <button class="analysis-tab-btn" data-tab="form" type="button">Форма</button>
      <button class="analysis-tab-btn" data-tab="comparison" type="button">Сравнение</button>
      <button class="analysis-tab-btn" data-tab="market" type="button">Рынок</button>
      <button class="analysis-tab-btn" data-tab="squads" type="button">Составы</button>
      <button class="analysis-tab-btn" data-tab="context" type="button">Контекст</button>
    </div>

    <div class="analysis-tab-panel" data-panel="brief">
      ${prematchBriefHtml(d.preMatchIntelligence, m, p)}
    </div>

    <div class="analysis-tab-panel" data-panel="overview">
      <section class="panel experience-dashboard">
        <div class="dashboard-metric confidence-metric">
          <span>Уверенность модели</span>
          <strong>${confidence.score ?? '—'}/100</strong>
          <small>${escapeHtml(confidence.label || '—')}</small>
          <div class="confidence-bar"><span style="width:${confidenceScore}%"></span></div>
        </div>
        <div class="dashboard-metric">
          <span>Источники</span>
          <strong>${escapeHtml(analysisSourceStatus(d))}</strong>
          <small>Сигналы объединяются динамически</small>
        </div>
        <div class="dashboard-metric">
          <span>Расхождение</span>
          <strong>${Number.isFinite(Number(confidence.disagreement)) ? `${Number(confidence.disagreement).toFixed(1)} п.п.` : '—'}</strong>
          <small>Чем меньше, тем согласованнее источники</small>
        </div>
      </section>

      <section class="panel">
        <h2>🧩 Почему такая оценка</h2>
        ${bullets(d.insights, 'Пока нет сильных дополнительных факторов.')}
      </section>

      <section class="panel goal-visual-panel">
        <h2>⚽ Голевая модель</h2>
        ${goal ? `<div class="goal-score-visual">
          <div><span>${escapeHtml(m.home?.name || 'Хозяева')}</span><strong>${goal.homeExpected}</strong></div>
          <div class="goal-divider">:</div>
          <div><span>${escapeHtml(m.away?.name || 'Гости')}</span><strong>${goal.awayExpected}</strong></div>
        </div>
        <div class="goal-market-grid">
          <div><span>ТБ 2.5</span><strong>${pct(goal.over25)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.over25)}%"></i></div></div>
          <div><span>Обе забьют</span><strong>${pct(goal.btts)}</strong><div class="mini-progress"><i style="width:${clampPercent(goal.btts)}%"></i></div></div>
        </div>
        <p class="muted">Poisson-эвристика по недавней результативности. Это не официальный xG.</p>` : '<p class="muted">Недостаточно недавних матчей для голевой модели.</p>'}
      </section>

      <section class="panel risk-panel">
        <h2>⚠️ Риски и ограничения</h2>
        ${bullets(d.risks, 'Критичных ограничений по доступным данным не найдено.')}
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="form">
      <section class="panel">
        <h2>📈 Форма команд</h2>
        <div class="form-grid experience-form-grid">
          ${formCard(m.home?.name || 'Хозяева', recent.home)}
          ${formCard(m.away?.name || 'Гости', recent.away)}
        </div>
      </section>
      <section class="panel">
        <h2>🤝 Последние очные встречи</h2>
        <div class="h2h-visual">
          <div><strong>${h2h.homeWins ?? 0}</strong><span>${escapeHtml(m.home?.name || '')}</span></div>
          <div class="h2h-draw"><strong>${h2h.draws ?? 0}</strong><span>Ничьи</span></div>
          <div><strong>${h2h.awayWins ?? 0}</strong><span>${escapeHtml(m.away?.name || '')}</span></div>
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="comparison">
      <section class="panel comparison-hero-panel">
        <div class="comparison-heads">
          ${comparisonTeamHeader(m.home, 'home', comparison.score?.home)}
          <div class="comparison-score"><span>МЕТРИКИ</span><strong>${Number(comparison.score?.home || 0)} : ${Number(comparison.score?.away || 0)}</strong><small>${Number(comparison.score?.even || 0)} близких</small></div>
          ${comparisonTeamHeader(m.away, 'away', comparison.score?.away)}
        </div>
        <div class="comparison-balance">${escapeHtml(comparison.balanceLabel || 'Сравнение строится по доступным данным')}</div>
      </section>

      <section class="panel">
        <div class="comparison-section-head"><h2>⚖️ Команда к команде</h2><span>${comparison.metrics?.length || 0} метрик</span></div>
        ${comparison.metrics?.length ? `<div class="comparison-metrics">${comparison.metrics.map(comparisonMetricRow).join('')}</div>` : '<div class="empty compact-empty">Недостаточно сопоставимых данных для детального сравнения.</div>'}
      </section>

      <section class="panel">
        <h2>🔎 Ключевые преимущества</h2>
        <div class="comparison-advantages-grid">
          ${comparisonAdvantages(m.home?.name || 'Хозяева', comparison.advantages?.home || [], 'home')}
          ${comparisonAdvantages(m.away?.name || 'Гости', comparison.advantages?.away || [], 'away')}
        </div>
      </section>

      <section class="panel comparison-reuse-panel">
        <div class="comparison-section-head"><h2>♻️ Переиспользование данных</h2><span>+${Number(comparison.dataReuse?.separateApiRequests || 0)} API</span></div>
        <p>${escapeHtml(comparison.dataReuse?.note || 'Сравнение использует уже загруженные данные.')}</p>
        <div class="reuse-chips">${(comparison.dataReuse?.sources || []).map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>
        <div class="reuse-status"><span>${comparison.dataReuse?.seasonStatsCached ? '✓' : '—'} Сезонная статистика из кэша</span><span>${comparison.dataReuse?.standingsCached ? '✓' : '—'} Таблица из кэша</span></div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="market">
      <section class="panel">
        <h2>💹 Рынок 1X2</h2>
        <div class="odds-grid">
          <div><span>П1</span><strong>${market?.odds?.home ?? '—'}</strong></div>
          <div><span>X</span><strong>${market?.odds?.draw ?? '—'}</strong></div>
          <div><span>П2</span><strong>${market?.odds?.away ?? '—'}</strong></div>
        </div>
        <p class="muted">Букмекеров в выборке: ${market?.bookmakers ?? '—'}. Коэффициенты отражают рынок, а не гарантированный исход.</p>
      </section>
      <section class="panel">
        <h2>🧠 Состав модели</h2>
        <p class="muted">${escapeHtml(d.modelBreakdown?.method || 'Модель объединяет доступные статистические сигналы.')}</p>
        <div class="model-weights">${escapeHtml(modelWeightsText(d.modelBreakdown?.weights || {}))}</div>
        ${d.modelCalibration ? `<div class="analysis-calibration-card ${escapeHtml(d.modelCalibration.mode || 'baseline')}"><span>Калибровка v${escapeHtml(d.modelCalibration.version || '3.7')}</span><strong>${d.modelCalibration.mode === 'active' ? 'Активна' : d.modelCalibration.mode === 'shadow' ? 'Теневой режим' : 'Базовый режим'}</strong><small>n=${Number(d.modelCalibration.sample || 0)} · T=${Number(d.modelCalibration.temperature || 1).toFixed(2)}${d.modelCalibration.weightsActive ? ' · адаптивные веса' : ''}</small></div>` : ''}
        <div class="model-api-card">
          <span>API-Football</span>
          <strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong>
          <small>${escapeHtml(pred?.advice || 'Подсказка недоступна')}</small>
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="squads">
      <section class="panel">
        <h2>🚑 Потери</h2>
        <div class="squad-grid">
          ${compactAbsence(m.home?.name || 'Хозяева', d.absences?.home)}
          ${compactAbsence(m.away?.name || 'Гости', d.absences?.away)}
        </div>
      </section>
      <section class="panel">
        <h2>👥 Стартовые составы</h2>
        <div class="squad-grid">
          ${lineupBlock(m.home?.name || 'Хозяева', homeLine)}
          ${lineupBlock(m.away?.name || 'Гости', awayLine)}
        </div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="context">
      <section class="panel">
        <h2>🌐 Свежий веб-контекст</h2>
        <p class="context-answer">${escapeHtml(news.answer || 'Tavily не подключён или свежая сводка не найдена.')}</p>
        ${news.results?.length ? `<div class="news-links">${news.results.slice(0, 5).map(r => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(r.title || 'Источник')}</a>`).join('')}</div>` : ''}
      </section>
      <section class="panel data-transparency-panel">
        <h2>🔎 Прозрачность данных</h2>
        <div class="transparency-grid">
          <div><span>Полнота</span><strong>${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</strong></div>
          <div><span>Анализ</span><strong>v${escapeHtml(d.analysisVersion || '—')}</strong></div>
          <div><span>Статус</span><strong>${d.stale ? 'Устаревший кэш' : d.cached ? 'Кэш' : 'Свежий'}</strong></div>
          <div><span>Режим данных</span><strong>${escapeHtml(d.dataPolicy?.mode || 'standard')}</strong></div>
        </div>
        ${d.dataPolicy?.skipped?.length ? `<div class="policy-list"><strong>Что было пропущено для экономии/качества:</strong><ul>${d.dataPolicy.skipped.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
        <p class="tiny warning">${escapeHtml(d.disclaimer || '')}</p>
      </section>
    </div>
  `;

  $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
  $('shareAnalysisBtn')?.addEventListener('click', () => shareAnalysis(d));
  $('openPrematchBrief')?.addEventListener('click', () => setAnalysisTab('brief', true));
  $('analysis')?.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({
    id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
  bindAnalysisTabs();
}

function safeUrl(url) {
  try {
    const u = new URL(url, location.origin);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function optimizeImages(root = document) {
  root.querySelectorAll?.('img').forEach(img => {
    if (!img.hasAttribute('decoding')) img.decoding = 'async';
    if (!img.closest('.analysis-hero, .team-hero, .tournament-hero') && !img.hasAttribute('loading')) img.loading = 'lazy';
  });
}

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
  banner.className = `connection-banner ${mode}`;
  retry.hidden = !['offline','degraded'].includes(mode) || navigator.onLine === false;

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
    title.textContent = state.network.category === 'rate_limit' ? 'Обновления временно ограничены' : 'Часть данных обновляется медленнее';
    text.textContent = state.network.message || 'Сохранённые данные останутся доступны.';
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
    if (state.liveRefreshTimer) { stopLiveRefresh(); state.liveRefreshWasActive = true; }
    return;
  }

  const hiddenForMs = state.network.hiddenAt ? Date.now() - Number(state.network.hiddenAt) : 0;
  state.network.hiddenAt = null;
  const fixtureId = Number(state.currentCenter?.match?.fixtureId || 0);

  if (fixtureId && state.currentCenter?.mode === 'live' && activeViewId() === 'analysisView' && state.liveRefreshWasActive) {
    startLiveRefresh(fixtureId);
  }

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
  });
});

$('matchSearch').addEventListener('input', e => {
  state.search = e.target.value || '';
  clearTimeout(matchSearchTimer);
  matchSearchTimer = setTimeout(renderMatches, 110);
});

$('globalSearchBtn')?.addEventListener('click', runGlobalSearch);
$('globalSearchInput')?.addEventListener('input', e => { state.globalSearch.query = e.target.value || ''; state.globalSearch.remoteTeams = []; state.globalSearch.remoteCompetitions = []; state.globalSearch.warning = ''; renderGlobalSearch(); });
$('globalSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); } });
$('clearRecentTeamsBtn')?.addEventListener('click', clearRecentTeams);
$('refreshBtn').addEventListener('click', () => loadMatches({ force: true }));
$('historyRefreshBtn').addEventListener('click', () => loadHistory(true));
$('backBtn').addEventListener('click', () => showView('matchesView', { restore: true }));
$('tournamentBackBtn')?.addEventListener('click', () => showView(state.tournamentBackView || 'matchesView', { restore: true }));
$('teamBackBtn')?.addEventListener('click', () => showView(state.teamBackView || 'matchesView', { restore: true }));
document.querySelectorAll('.tournament-tab').forEach(btn => btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab || 'matches')));
document.querySelectorAll('.team-tab').forEach(btn => btn.addEventListener('click', () => setTeamTab(btn.dataset.teamTab || 'overview')));
$('profileBtn').addEventListener('click', openProfileView);
$('navMatches').addEventListener('click', () => showView('matchesView'));
$('navSearch')?.addEventListener('click', () => { renderDiscoveryHome(); renderGlobalSearch(); showView('searchView'); setTimeout(() => $('globalSearchInput')?.focus(), 80); });
$('navHistory').addEventListener('click', async () => { showView('historyView'); if (!state.historyLoaded) await loadHistory(true); else renderHistory(); });
$('navProfile').addEventListener('click', openProfileView);
$('proBtn')?.addEventListener('click', () => buyPlan('PRO'));
$('premiumBtn')?.addEventListener('click', () => buyPlan('PREMIUM'));
$('billingSyncBtn')?.addEventListener('click', () => syncBilling(true));
$('subscriptionManageBtn')?.addEventListener('click', () => manageSubscription($('subscriptionManageBtn').dataset.action || 'cancel'));
$('savePreferencesBtn')?.addEventListener('click', savePreferencesFromUi);
$('modelQualityRefreshBtn')?.addEventListener('click', () => Promise.allSettled([loadModelQuality(true), loadModelRemediation(true)]));
$('modelQualityPeriod')?.addEventListener('change', () => loadModelQuality(true));
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

async function scheduleIdle(task) {
  if ('requestIdleCallback' in window) return new Promise(resolve => requestIdleCallback(async () => { try { await task(); } finally { resolve(); } }, { timeout: 1800 }));
  return new Promise(resolve => setTimeout(async () => { try { await task(); } finally { resolve(); } }, 250));
}

syncTopbar('matchesView');

// v6.7 RC15: settlement watchdog with runtime-gated automatic catch-up and cron audit trail.
// The boot watchdog never leaves the user behind an endless splash screen.
const startupWatchdog = setTimeout(() => {
  if (!$('bootGate')?.hidden && !state.compatibilityBlocked) {
    state.startup.watchdogFired = true;
    showBootRecovery({
      blocking: false,
      title: 'Запуск занимает больше обычного',
      text: 'Можно повторить проверку или открыть интерфейс с уже доступными данными.',
    });
  }
}, 10000);

try {
  await runStartupSequence();
} finally {
  clearTimeout(startupWatchdog);
}
