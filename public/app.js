const CLIENT_VERSION = '6.69.0-rc77';
const CLIENT_API_CONTRACT = 5;
const CLIENT_RELEASE_CHANNEL = 'rc77';

const UI_PREFERENCES_KEY = 'football-analytics:ui:v1';
const FIRST_RUN_GUIDE_KEY = 'football-analytics:first-run-guide:v1';
const DEFAULT_UI_PREFERENCES = { theme: 'system', buttonStyle: 'soft' };
function readUiPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_PREFERENCES_KEY) || '{}');
    return {
      theme: ['system', 'dark', 'light', 'ocean'].includes(saved.theme) ? saved.theme : DEFAULT_UI_PREFERENCES.theme,
      buttonStyle: ['soft', 'compact'].includes(saved.buttonStyle) ? saved.buttonStyle : DEFAULT_UI_PREFERENCES.buttonStyle,
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}
const initialUiPreferences = readUiPreferences();
document.documentElement.dataset.theme = initialUiPreferences.theme;
document.documentElement.dataset.buttonStyle = initialUiPreferences.buttonStyle;

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
  uiPreferences: initialUiPreferences,
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
  calibrationControl: null,
  calibrationControlLoading: false,
  calibrationControlSaving: false,
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
  launchFunnel: null,
  launchFunnelLoading: false,
  launchFunnelDays: 7,
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
  globalSearch: { query: '', mode: 'all', remoteTeams: [], knownTeams: [], remoteCompetitions: [], remoteMatches: [], matchSourceTeam: '', matchDiscovery: null, primaryFixtureId: null, loading: false, warning: '', searchedAt: null, requestSeq: 0 },
  currentAnalysis: null,
  currentAnalysisTab: 'brief',
  analysisBackView: 'matchesView',
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
  teamHubRequestSeq: 0,
  teamIntelligenceRequestSeq: 0,
  teamSquadRequestSeq: 0,
  tournamentStandingsRequestSeq: 0,
  liveRefreshTimer: null,
  liveRefreshRemaining: 0,
  favoritesLoaded: false,
  favoritesLoading: false,
  favoritesLoadError: '',
  favoritesRevision: 0,
  remindersLoaded: false,
  remindersLoading: false,
  remindersLoadError: '',
  remindersRevision: 0,
  historyLoaded: false,
  historyLoading: false,
  historyLoadError: '',
  historyRevision: 0,
  aiTrackRecord: null,
  aiTrackRecordLoaded: false,
  aiTrackRecordLoading: false,
  aiTrackRecordError: '',
  historyOpenRequestSeq: 0,
  providerLoaded: false,
  viewScroll: {},
  matchesLoadSeq: 0,
  matchCenterRequestSeq: 0,
  analysisActionPending: false,
  favoriteMutations: new Set(),
  reminderMutations: new Set(),
  preferencesSaving: false,
  profileStale: false,
  clientPerf: { startedAt: new Date().toISOString(), requests: 0, completed: 0, failed: 0, deduped: 0, retries: 0, rateLimited: 0, timeouts: 0, recoveries: 0, degradedEvents: 0, manifestFailures: 0, bootMs: null, totalMs: 0, lastMs: null, clientErrors: 0, lastError: '' },
};

const inflightGetRequests = new Map();
const MATCH_SNAPSHOT_PREFIX = 'football-analytics:v4:matches:';
const MATCH_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;


const $ = id => document.getElementById(id);
const views = ['matchesView', 'searchView', 'tournamentView', 'teamView', 'analysisView', 'historyView', 'profileView'];

function applyInterfacePreferences({ announce = false } = {}) {
  const prefs = state.uiPreferences || DEFAULT_UI_PREFERENCES;
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.buttonStyle = prefs.buttonStyle;
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    const active = button.dataset.themeChoice === prefs.theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-button-style-choice]').forEach(button => {
    const active = button.dataset.buttonStyleChoice === prefs.buttonStyle;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  requestAnimationFrame(() => {
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    try { tg?.setHeaderColor(background); } catch {}
    try { tg?.setBackgroundColor(background); } catch {}
  });
  if (announce) toast('Оформление применено');
}

function renderFirstRunGuide() {
  const guide = $('firstRunGuide');
  if (!guide) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(FIRST_RUN_GUIDE_KEY) === '1'; } catch {}
  guide.hidden = dismissed;
}

function dismissFirstRunGuide() {
  const guide = $('firstRunGuide');
  try { localStorage.setItem(FIRST_RUN_GUIDE_KEY, '1'); } catch {}
  if (guide) guide.hidden = true;
}

function saveInterfacePreference(key, value) {
  state.uiPreferences = { ...state.uiPreferences, [key]: value };
  try { localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(state.uiPreferences)); } catch {}
  applyInterfacePreferences({ announce: true });
}

const VIEW_CHROME = {
  matchesView: ['Служебная лента', 'Матчи и системные данные'],
  searchView: ['AI-анализ матча', 'Найдите клуб или матч — остальное объяснит FM AI'],
  tournamentView: ['Турнир', 'Служебный просмотр соревнования'],
  teamView: ['Команда', 'Служебный просмотр данных клуба'],
  analysisView: ['AI-разбор', 'Вердикт, причины, составы, судья, рынок и риски'],
  historyView: ['История AI', 'Ваши последние сохранённые разборы'],
  profileView: ['Администрирование', 'Служебные настройки проекта'],
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

const BACK_VIEW_LABELS = Object.freeze({
  matchesView: 'К матчам',
  searchView: 'К поиску',
  historyView: 'К истории',
  profileView: 'К профилю',
  tournamentView: 'К турниру',
  teamView: 'К команде',
});

function viewBackTarget(id = activeViewId()) {
  if (id === 'analysisView') return state.analysisBackView || 'searchView';
  if (id === 'teamView') return state.teamBackView || 'searchView';
  if (id === 'tournamentView') return state.tournamentBackView || 'searchView';
  return 'searchView';
}

function syncBackButtons() {
  const bindings = [
    ['backBtn', state.analysisBackView || 'searchView'],
    ['teamBackBtn', state.teamBackView || 'searchView'],
    ['tournamentBackBtn', state.tournamentBackView || 'searchView'],
  ];
  bindings.forEach(([id, target]) => {
    const button = $(id);
    if (button) button.textContent = `← ${BACK_VIEW_LABELS[target] || 'Назад'}`;
  });
}

function syncTelegramBackButton(id = activeViewId()) {
  if (!tg?.BackButton) return;
  try {
    if (['analysisView', 'teamView', 'tournamentView'].includes(id)) tg.BackButton.show();
    else tg.BackButton.hide();
  } catch {}
}

function handleBackNavigation() {
  const current = activeViewId();
  if (!['analysisView', 'teamView', 'tournamentView'].includes(current)) return false;
  showView(viewBackTarget(current), { restore: true });
  return true;
}

function showView(id, options = {}) {
  if (!views.includes(id) || !$(id)) id = 'searchView';
  const current = activeViewId();
  if (current === 'historyView' && id !== 'historyView' && !options.fromHistoryOpen) {
    state.historyOpenRequestSeq += 1;
  }
  syncTopbar(id);
  if (current && current !== id) state.viewScroll[current] = window.scrollY || 0;
  if (id !== 'analysisView') { stopLiveRefresh(); state.liveRefreshWasActive = false; }
  views.forEach(v => {
    const view = $(v);
    if (!view) return;
    const active = v === id;
    view.classList.toggle('active', active);
    view.hidden = !active;
    view.toggleAttribute('inert', !active);
    view.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  $('navMatches').classList.toggle('active', id === 'matchesView' || id === 'tournamentView' || id === 'teamView' || id === 'analysisView');
  $('navSearch')?.classList.toggle('active', id === 'searchView');
  $('navHistory').classList.toggle('active', id === 'historyView');
  $('navProfile').classList.toggle('active', id === 'profileView');
  document.querySelectorAll('.nav-item').forEach(btn => btn.removeAttribute('aria-current'));
  if (id === 'matchesView' || id === 'tournamentView' || id === 'teamView' || id === 'analysisView') $('navMatches')?.setAttribute('aria-current', 'page');
  if (id === 'searchView') $('navSearch')?.setAttribute('aria-current', 'page');
  if (id === 'historyView') $('navHistory')?.setAttribute('aria-current', 'page');
  if (id === 'profileView') $('navProfile')?.setAttribute('aria-current', 'page');
  syncBackButtons();
  syncTelegramBackButton(id);
  const top = options.restore ? Number(state.viewScroll[id] || 0) : 0;
  requestAnimationFrame(() => {
    window.scrollTo({ top, behavior: 'auto' });
    if (options.focusHeading === true) $('topbarTitle')?.focus({ preventScroll: true });
  });
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
  if (error?.payload?.category === 'maintenance') return error?.payload?.error || 'Приложение временно на техническом обслуживании.';
  if (error?.payload?.category === 'feature_disabled') return error?.payload?.error || 'Эта функция временно приостановлена.';
  if (category === 'auth') return 'Сессия Telegram не подтверждена. Закройте приложение и откройте его снова из бота.';
  if (category === 'timeout') return 'Сервис отвечает медленнее обычного. Попробуйте обновить ещё раз.';
  if (category === 'rate_limit') return retryAfter
    ? `Слишком много запросов. Повторите примерно через ${retryAfter} сек.`
    : 'Сервис временно ограничил частоту обновлений. Попробуйте чуть позже.';
  if (category === 'integrity') return 'Данные этого матча сейчас перепроверяются. Попробуйте открыть его немного позже.';
  if (category === 'database') return 'Хранилище данных временно недоступно. Основные футбольные экраны продолжат работу через доступные сохранённые данные.';
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
  $('navSearch')?.classList.remove('feature-disabled');
  $('navSearch')?.removeAttribute('aria-disabled');
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
  sendClientTelemetry('boot_ok', {
    bootMs: state.clientPerf.bootMs,
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

  setBootStatus('Запускаю FM AI', 'Проверяю версию и готовлю AI-поиск матчей…', 12);
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
    'Собираю футбольный контекст',
    manifest ? `${manifest.releaseCandidate || CLIENT_RELEASE_CHANNEL.toUpperCase()} · версия обмена данными ${manifest.apiContract}` : 'Манифест временно недоступен — продолжаю в безопасном режиме.',
    38
  );

  await loadRuntimeStatus(false);
  await loadProfile().catch(()=>null);
  renderProfile();
  applyRuntimeUi();
  const admin=isAdmin();
  if ($('profileBtn')) $('profileBtn').hidden=!admin;
  if ($('navProfile')) $('navProfile').hidden=!admin;
  if ($('navMatches')) $('navMatches').hidden=!admin;
  if (admin) await Promise.allSettled([loadFavorites(), loadMatches()]);

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
  setBootStatus('FM AI готов', state.startup.degraded ? 'AI-поиск доступен, часть фоновых проверок завершится позже.' : 'Найдите матч — AI соберёт форму, составы, судью, рынок и риски.', 100);
  await new Promise(resolve => setTimeout(resolve, 120));
  hideBootGate();

  scheduleIdle(async () => {
    const tasks = [loadHistory(false)];
    if (isAdmin()) tasks.push(loadProvider(),loadReminders());
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
  if (h < 24) return `${h} ч. назад`;
  const days = Math.floor(h / 24);
  return `${days} дн. назад`;
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
  const previousProfile = state.profile;
  try {
    state.profile = await api('/api/me');
    state.profileStale = false;
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
      renderProfile();
      toast('Профиль временно не обновился — показаны последние данные.');
      return;
    }
    state.profile = null;
    state.profileStale = false;
    applyAdminVisibility();
    toast(e.message);
  }
}

function isAdmin() {
  return state.profile?.features?.isAdmin === true
    && state.profile?.features?.role === 'admin';
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
}

function organizeAdminConsole() {
  const content = $('adminAdvancedContent');
  if (!content || content.dataset.ready === 'true') return;
  [
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
    loadModelQuality(false),
    loadCalibrationControl(false),
    loadModelRemediation(false),
    loadReleaseReadiness(false),
    loadProductionReadiness(false),
    loadReleaseMonitor(false),
    loadLaunchFunnel(false),
    loadReminderHealth(false),
  ]);
}

function renderDataCapabilities() {
  const c = state.dataCapabilities || state.profile?.features?.dataCapabilities || {};
  const features = c.features || {};
  if ($('dataModeLabel')) $('dataModeLabel').textContent = c.label || (c.mode === 'expanded' ? 'Расширенное покрытие' : 'Стандартное покрытие');
  if ($('dataModeSummary')) $('dataModeSummary').textContent = c.mode === 'expanded' ? 'Расширенный режим' : 'Стандартный режим';
  if ($('dataModeRefresh')) $('dataModeRefresh').textContent = features.liveRefresh === false || Number(c.refreshSeconds) === 0
    ? 'пауза'
    : Number(c.refreshSeconds || 60) <= 30 ? `${Number(c.refreshSeconds || 60)} сек.` : 'адаптивно';
  if ($('dataModeLineups')) $('dataModeLineups').textContent = features.lineupsFallback ? 'Расширенно' : 'По доступности';
  if ($('dataModePlayers')) $('dataModePlayers').textContent = features.playerStats ? 'Расширенно' : 'По доступности';
  if ($('dataModeOdds')) $('dataModeOdds').textContent = features.liveOdds ? 'Расширенно' : 'По доступности';
  if ($('dataModeNote')) $('dataModeNote').textContent = c.note || 'Покрытие зависит от турнира и доступности источника данных.';
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
  const { user, quota, stats = {} } = state.profile;
  const profilePlanLabel = $('profileBtn')?.querySelector('span');
  if (profilePlanLabel) profilePlanLabel.textContent = planLabel(quota.plan);
  else if ($('profileBtn')) $('profileBtn').textContent = planLabel(quota.plan);
  const quotaText = $('quotaText');
  if (quotaText) {
    const showQuota = Number(quota.left) <= 3 || state.profileStale;
    quotaText.hidden = !showQuota;
    quotaText.textContent = state.profileStale
      ? 'Показаны сохранённые данные профиля'
      : `Осталось анализов: ${quota.left} из ${quota.limit}`;
  }
  $('profileName').textContent = user.firstName || 'Пользователь';
  const avatar = $('avatar');
  if (avatar) {
    const photoUrl = safeUrl(user.photoUrl);
    avatar.classList.remove('has-photo');
    avatar.textContent = '⚽';
    if (photoUrl) {
      const img = document.createElement('img');
      img.src = photoUrl;
      img.alt = user.firstName ? `Фото профиля ${user.firstName}` : 'Фото профиля';
      img.loading = 'eager';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => avatar.classList.add('has-photo'), { once: true });
      img.addEventListener('error', () => {
        avatar.classList.remove('has-photo');
        avatar.textContent = '⚽';
      }, { once: true });
      avatar.replaceChildren(img);
    }
  }
  $('profileUsername').textContent = user.username ? `@${user.username}` : '';
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
  applyInterfacePreferences();
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
  const labels = { market: 'Рынок', apiPrediction: 'Прогноз источника данных', recentForm: 'Форма', h2h: 'Очные встречи' };
  return labels[String(name || '')] || String(name || 'Сигнал');
}

function outcomeShortLabel(key) {
  return key === 'home' ? 'П1' : key === 'away' ? 'П2' : key === 'draw' ? 'Н' : '—';
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
  badge.textContent = sample.ready ? russianCountLabel(sample.settled || 0, 'матч', 'матча', 'матчей') : `${sample.settled || 0} / 20 матчей`;
  badge.classList.toggle('ready', Boolean(sample.ready));
  status.textContent = sample.settled
    ? `${sample.settled} проверенных прогнозов · ${sample.pending || 0} ожидают результата${excludedText}${sample.calibrationReady ? ' · калибровка уже информативнее' : ''}`
    : `Пока нет проверенных завершённых прогнозов${excludedText}. Новые предматчевые анализы будут автоматически попадать в историческую проверку.`;

  headline.hidden = false;
  headline.innerHTML = `
    <div><span>Точность П1 / Н / П2</span><strong>${qualityPct(h.accuracy)}</strong><small>максимальная вероятность</small></div>
    <div><span>Ошибка Брайера</span><strong>${qualityNum(h.avgBrier)}</strong><small>ниже — лучше</small></div>
    <div><span>Логарифмическая ошибка</span><strong>${qualityNum(h.avgLogLoss)}</strong><small>штраф за уверенные ошибки</small></div>
    <div><span>Средняя уверенность</span><strong>${qualityPct(h.avgTopProbability)}</strong><small>уверенность лидера</small></div>`;

  calibration.hidden = false;
  calibration.innerHTML = `
    <div class="quality-block-head"><strong>Калибровка вероятностей</strong><span>прогноз и факт</span></div>
    <div class="quality-calibration-list">${(q.calibration || []).map(x => `
      <div class="quality-cal-row">
        <span>${escapeHtml(x.label)}</span>
        <div class="quality-cal-bars"><i style="--w:${Math.max(0, Math.min(100, Number(x.avgPredicted || 0)))}%"></i><b style="--w:${Math.max(0, Math.min(100, Number(x.hitRate || 0)))}%"></b></div>
        <strong>${x.sample ? `${qualityPct(x.hitRate)} · выборка ${x.sample}` : '—'}</strong>
      </div>`).join('')}</div>
    ${q.methodology?.warning ? `<p class="quality-warning">⚠️ ${escapeHtml(humanizeTechnicalText(q.methodology.warning))}</p>` : ''}`;

  const ce = q.calibrationEngine || {};
  const impact = q.calibrationImpact || {};
  const modeLabel = ce.mode === 'active' ? 'Активен' : ce.mode === 'shadow' ? 'Наблюдение' : 'Базовый';
  const weightValidation = ce.weightsValidation || {};
  const promotion = ce.promotionGate || {};
  const lifecycle = ce.lifecycle || {};
  const lifecycleLabel = lifecycle.status === 'frozen'
    ? 'ЗАМОРОЖЕНО'
    : lifecycle.status === 'promoted'
    ? 'НОВАЯ АКТИВНАЯ МОДЕЛЬ'
    : lifecycle.status === 'active'
      ? 'АКТИВНА'
      : lifecycle.status === 'held'
        ? 'КАНДИДАТ УДЕРЖАН'
        : lifecycle.status === 'shadow'
          ? 'КАНДИДАТ В ТЕНИ'
          : lifecycle.available === false
            ? 'НУЖНА МИГРАЦИЯ'
            : 'БАЗОВАЯ';
  const promotionLabel = promotion.status === 'promoted'
    ? 'РАЗРЕШЕНО'
    : promotion.status === 'held'
      ? 'УДЕРЖАНО'
      : promotion.status === 'shadow'
        ? 'НАБЛЮДЕНИЕ'
        : 'БАЗОВЫЙ';
  const signalRows = (q.signalPerformance || []).some(x => Number(x.sample || 0) > 0) ? (q.signalPerformance || []) : (q.signals || []);
  engine.hidden = false;
  engine.innerHTML = `
    <div class="quality-block-head"><strong>⚙️ Калибратор вероятностей</strong><span class="calibration-mode ${escapeHtml(ce.mode || 'baseline')}">${modeLabel}</span></div>
    <div class="calibration-engine-grid">
      <div><span>Режим</span><strong>${modeLabel}</strong><small>${ce.mode === 'active' ? 'коррекции разрешены защитными правилами' : ce.mode === 'shadow' ? 'измеряет, но не меняет прогноз' : 'базовые веса'}</small></div>
      <div><span>Температура</span><strong>${Number.isFinite(Number(ce.temperature)) ? Number(ce.temperature).toFixed(2) : '1.00'}</strong><small>1.00 = без сжатия вероятностей</small></div>
      <div><span>Историческая проверка</span><strong>${Number(ce.sample || 0)}</strong><small>завершённых снимков</small></div>
      <div><span>Отложенная выборка температуры</span><strong>${Number(ce.temperatureValidation?.validationSample || 0)}</strong><small>${Number.isFinite(Number(ce.temperatureValidation?.improvement)) ? `${Number(ce.temperatureValidation.improvement).toFixed(1)}% логарифмической ошибки` : 'ещё нет проверки'}</small></div>
      <div><span>Отложенная выборка весов</span><strong>${Number(weightValidation.validationSample || 0)}</strong><small>${Number.isFinite(Number(weightValidation.brierGain)) ? `Δ Брайер ${Number(weightValidation.brierGain).toFixed(4)}` : 'ещё нет проверки'}</small></div>
      <div><span>Продвижение</span><strong>${promotionLabel}</strong><small>только доверенная отложенная выборка</small></div>
      <div><span>Жизненный цикл</span><strong>${lifecycleLabel}</strong><small>версия ${Number(lifecycle.revision || 0)}</small></div>
      <div><span>Отпечаток активной модели</span><strong>${escapeHtml(String(lifecycle.activeFingerprint || ce.fingerprint || '—').slice(0, 10))}</strong><small>${lifecycle.previousFingerprint ? `откат → ${escapeHtml(String(lifecycle.previousFingerprint).slice(0, 10))}` : 'предыдущей активной модели нет'}</small></div>
    </div>
    <div class="calibration-promotion-note"><strong>Защитная проверка:</strong> кандидат проходит два последовательных окна доверенной отложенной выборки, затем атомарно сравнивается с активной моделью. ${lifecycle.frozen ? `Жизненный цикл заморожен: ${escapeHtml(lifecycle.freezeReason || 'причина указана в административном журнале')}.` : 'После продвижения отдельная когорта может автоматически вернуть предыдущий профиль.'}</div>
    <div class="calibration-weights">
      ${(ce.signalStats || []).map(x => {
        const base = Number(x.baseWeight || 0) * 100;
        const current = Number(x.currentWeight ?? x.baseWeight ?? 0) * 100;
        return `<div class="calibration-weight-row"><span>${escapeHtml(signalLabel(x.name))}</span><div><i style="--w:${Math.max(0, Math.min(100, current))}%"></i></div><strong>${base.toFixed(0)} → ${current.toFixed(1)}%</strong><small>выборка ${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · ошибка Брайера ${qualityNum(x.avgBrier)}` : ''}</small></div>`;
      }).join('')}
    </div>
    ${Number(impact.sample || 0) ? `<div class="calibration-impact"><span>Проверка v3.7: выборка ${Number(impact.sample || 0)}</span><strong>Ошибка Брайера ${qualityNum(impact.rawBrier)} → ${qualityNum(impact.finalBrier)}</strong><small>${Number(impact.brierDelta || 0) > 0 ? 'улучшение' : Number(impact.brierDelta || 0) < 0 ? 'ухудшение — автоматика будет видна в исторической проверке' : 'без изменения'}</small></div>` : '<p class="quality-engine-note">Эффект v3.7 появится после завершения первых матчей, рассчитанных этой версией.</p>'}
    <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(ce.note || 'Автокалибровка включается только после достаточной выборки.'))}</p>`;

  confidence.hidden = false;
  confidence.innerHTML = `
    <div class="quality-block-head"><strong>По уверенности модели</strong><span>не рейтинг, а диагностика</span></div>
    <div class="quality-mini-grid">${(q.confidence || []).map(x => `
      <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
    <div class="quality-signal-grid">${signalRows.map(x => `
      <div><span>${escapeHtml(signalLabel(x.name))}</span><strong>${qualityPct(x.accuracy)}</strong><small>выборка ${Number(x.sample || 0)}${Number.isFinite(Number(x.avgBrier)) ? ` · ошибка Брайера ${qualityNum(x.avgBrier)}` : ''}</small></div>`).join('')}</div>`;

  const sec = q.secondary || {};
  secondary.hidden = false;
  secondary.innerHTML = `
    <div class="quality-block-head"><strong>Дополнительные рынки модели</strong><span>порог 50%</span></div>
    <div class="quality-secondary-grid">
      <div><span>ТБ 2.5</span><strong>${qualityPct(sec.over25?.accuracy)}</strong><small>матчей: ${Number(sec.over25?.sample || 0)}</small></div>
      <div><span>Обе забьют</span><strong>${qualityPct(sec.btts?.accuracy)}</strong><small>матчей: ${Number(sec.btts?.sample || 0)}</small></div>
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
      <div class="quality-block-head"><strong>📊 Панель качества модели</strong><span>${Number(db.periodDays || q.periodDays || 90)} дней</span></div>

      <div class="model-dash-kpis">
        <div><span>Снимки</span><strong>${Number(ov.sample || 0)}</strong><small>завершено</small></div>
        <div><span>Точность</span><strong>${qualityPct(ov.accuracy)}</strong><small>П1 / Н / П2</small></div>
        <div><span>Ошибка Брайера</span><strong>${qualityNum(ov.avgBrier)}</strong><small>ниже лучше</small></div>
        <div><span>Разрыв</span><strong>${Number.isFinite(Number(ov.calibrationGap)) ? `${Number(ov.calibrationGap).toFixed(1)} п.п.` : '—'}</strong><small>уверенность − точность</small></div>
        <div><span>Ошибка калибровки</span><strong>${Number.isFinite(Number(q.calibrationDiagnostics?.weightedTopCalibrationError)) ? `${Number(q.calibrationDiagnostics.weightedTopCalibrationError).toFixed(1)} п.п.` : '—'}</strong><small>взвешенно · 5 групп</small></div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Тренд по неделям</strong><span>точность + размер выборки; ошибка Брайера указана текстом</span></div>
        ${(db.trend || []).length ? `<div class="model-trend-chart">${db.trend.map(x => {
          const acc = Math.max(2, Math.min(100, Number(x.accuracy || 0)));
          const sampleH = Math.max(8, Math.round(Number(x.sample || 0) / trendMaxSample * 100));
          return `<div class="model-trend-col" title="${escapeHtml(x.label)} · выборка ${Number(x.sample || 0)} · ${qualityPct(x.accuracy)}">
            <div class="model-trend-bars"><i style="height:${acc}%"></i><b style="height:${sampleH}%"></b></div>
            <strong>${qualityPct(x.accuracy)}</strong>
            <span>${escapeHtml(x.label)}</span>
            <small>выборка ${Number(x.sample || 0)} · Ошибка Брайера ${qualityNum(x.avgBrier)}</small>
          </div>`;
        }).join('')}</div>` : '<div class="empty compact-empty">Пока недостаточно недельных данных.</div>'}
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Диапазоны уверенности</strong><span>проверяем, растёт ли качество с уверенностью</span></div>
        <div class="model-band-list">${(db.confidence || []).map(x => `
          <div class="model-band-row">
            <span>${escapeHtml(x.label)}</span>
            <div><i style="--w:${Math.max(0, Math.min(100, Number(x.accuracy || 0)))}%"></i></div>
            <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
            <small>выборка ${Number(x.sample || 0)} · Ошибка Брайера ${qualityNum(x.avgBrier)}</small>
          </div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Полнота данных</strong><span>влияет ли богатство входных данных</span></div>
        <div class="model-dash-mini-grid">${(db.completeness || []).map(x => `
          <div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Лиги</strong><span>сортировка по размеру выборки</span></div>
        ${leagues.length ? `<div class="model-league-table">${leagues.map(x => `
          <div class="model-league-row">
            <div><strong>${escapeHtml(x.leagueName || x.label)}</strong><small>матчей: ${Number(x.sample || 0)} · уверенность ${qualityPct(x.avgConfidence)}</small></div>
            <span>${qualityPct(x.accuracy)}</span>
            <span>Ошибка Брайера ${qualityNum(x.avgBrier)}</span>
            <em>${Number.isFinite(Number(x.calibrationGap)) ? `${Number(x.calibrationGap) >= 0 ? '+' : ''}${Number(x.calibrationGap).toFixed(1)} п.п.` : '—'}</em>
          </div>`).join('')}</div>` : '<div class="empty compact-empty">Лиг для сравнения пока нет.</div>'}
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Исходы модели</strong><span>описательный срез П1 / X / П2</span></div>
        <div class="model-dash-mini-grid">${(db.outcomes || []).map(x => `
          <div>
            <span>${escapeHtml(x.label)}</span>
            <strong>${x.sample ? qualityPct(x.accuracy) : '—'}</strong>
            <small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small>
          </div>`).join('')}</div>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Сравнение версий</strong><span>без рейтинга и автоматического продвижения</span></div>
        ${(db.versions || []).length ? `<div class="model-version-table">${db.versions.map(x => `
          <div class="model-version-row">
            <div>
              <strong>${escapeHtml(x.version || 'старая / неизвестная')}</strong>
              <small>матчей: ${Number(x.sample || 0)} · ${x.firstKickoffAt ? escapeHtml(dateTime(x.firstKickoffAt)) : '—'} → ${x.lastKickoffAt ? escapeHtml(dateTime(x.lastKickoffAt)) : '—'}</small>
            </div>
            <div><span>Точность</span><b>${qualityPct(x.accuracy)}</b></div>
            <div><span>Ошибка Брайера</span><b>${qualityNum(x.avgBrier)}</b></div>
            <div><span>Логарифмическая ошибка</span><b>${qualityNum(x.avgLogLoss)}</b></div>
            <div><span>Ошибка калибровки</span><b>${Number.isFinite(Number(x.calibrationError)) ? `${Number(x.calibrationError).toFixed(1)} п.п.` : '—'}</b></div>
            <div><span>Сигналы</span><b>${qualityPct(x.signalSnapshotCoverage)}</b></div>
          </div>`).join('')}</div>` : '<div class="empty compact-empty">Сравнение версий пока не сформировано.</div>'}
        <p class="quality-engine-note">Разрез показывает исторические когорты версия анализа. Различия могут быть связаны с периодом, лигами и составом данных; интерфейс не выбирает победителя.</p>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Качество отдельных сигналов</strong><span>источник отдельно и итоговая смесь</span></div>
        <div class="model-signal-table">${(db.signals || []).map(x => `
          <div class="model-signal-row">
            <div><strong>${escapeHtml(signalLabel(x.name))}</strong><small>выборка ${Number(x.sample || 0)} · базовый вес ${Number(x.baseWeight || 0).toFixed(0)}%</small></div>
            <div><span>Источник</span><b>${qualityPct(x.signalAccuracy)}</b><small>Брайер ${qualityNum(x.signalBrier)}</small></div>
            <div><span>Итог</span><b>${qualityPct(x.finalAccuracy)}</b><small>Брайер ${qualityNum(x.finalBrier)}</small></div>
            <em class="${Number(x.brierDeltaVsBlend || 0) <= 0 ? 'good' : 'watch'}">${Number.isFinite(Number(x.brierDeltaVsBlend)) ? `${Number(x.brierDeltaVsBlend) >= 0 ? '+' : ''}${Number(x.brierDeltaVsBlend).toFixed(3)}` : '—'}</em>
          </div>`).join('')}</div>
      </div>

      ${(db.calibrationModes || []).length ? `<div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Режимы калибратора</strong><span>описательный срез, версии модели различаются</span></div>
        <div class="model-dash-mini-grid">${db.calibrationModes.map(x => `<div><span>${escapeHtml(x.label)}</span><strong>${qualityPct(x.accuracy)}</strong><small>матчей: ${Number(x.sample || 0)} · ошибка Брайера ${qualityNum(x.avgBrier)}</small></div>`).join('')}</div>
      </div>` : ''}

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>🧪 Целостность прогнозов</strong><span>${escapeHtml(technicalStateLabel(q.integrity?.label || 'нет данных'))}</span></div>
        <div class="model-integrity-summary ${escapeHtml(q.integrity?.status || 'clean')}">
          <div><span>Загружено</span><strong>${Number(q.integrity?.loadedRows || 0)}</strong><small>завершённые + ожидающие</small></div>
          <div><span>Критические</span><strong>${Number(q.integrity?.severeIssues || 0)}</strong><small>вероятности / время / согласованность</small></div>
          <div><span>Предупреждения</span><strong>${Number(q.integrity?.warningIssues || 0)}</strong><small>фиксация результата / исход</small></div>
          <div><span>Информация</span><strong>${Number(q.integrity?.informationalIssues || 0)}</strong><small>устаревшие метаданные</small></div>
        </div>
        <div class="model-integrity-list">${(q.integrity?.checks || []).map(x => `
          <div class="${escapeHtml(x.state || 'info')}">
            <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : x.state === 'warn' ? '!' : 'i'}</i>
            <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
            <em>${Number(x.count || 0)}</em>
          </div>`).join('')}</div>
        ${q.integrity?.truncatedPotentially ? '<div class="data-notice stale">Выборка достигла лимита административного запроса: проверка целостности относится к загруженным строкам, а не ко всей истории.</div>' : ''}
        <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(q.integrity?.note || ''))}</p>
      </div>

      <div class="model-dash-section">
        <div class="model-dash-section-head"><strong>Наблюдения для проверки</strong><span>ничего не меняют автоматически</span></div>
        <div class="model-observations">${(db.observations || []).map(x => `
          <div class="${escapeHtml(x.level || 'info')}"><span>${x.level === 'good' ? '✓' : x.level === 'warn' ? '!' : x.level === 'watch' ? '↗' : 'i'}</span><div><strong>${escapeHtml(humanizeTechnicalText(x.title || ''))}</strong><p>${escapeHtml(humanizeTechnicalText(x.text || ''))}</p></div></div>`).join('')}</div>
        <p class="quality-engine-note">${escapeHtml(humanizeTechnicalText(db.note || ''))}</p>
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

function calibrationTransitionLabel(action) {
  return ({
    initialize: 'Инициализация',
    promote: 'Новая активная модель',
    rollback: 'Автооткат',
    manual_rollback: 'Ручной откат',
    freeze: 'Заморозка',
    unfreeze: 'Разморозка',
  })[String(action || '')] || String(action || 'Переход');
}

function shortFingerprint(value) {
  return value ? String(value).slice(0, 12) : '—';
}

function renderCalibrationControl() {
  const status = $('calibrationControlStatus');
  const summary = $('calibrationControlSummary');
  const history = $('calibrationControlHistory');
  const freezeBtn = $('calibrationFreezeBtn');
  const unfreezeBtn = $('calibrationUnfreezeBtn');
  const rollbackBtn = $('calibrationRollbackBtn');
  if (!status || !summary || !history || !freezeBtn || !unfreezeBtn || !rollbackBtn) return;

  const saving = state.calibrationControlSaving;
  const data = state.calibrationControl;
  if (state.calibrationControlLoading) {
    status.textContent = 'Загружаю состояние жизненного цикла…';
    summary.innerHTML = '';
    history.innerHTML = '';
  } else if (!data?.available) {
    status.textContent = data?.reason || 'Жизненный цикл пока недоступен.';
    summary.innerHTML = '';
    history.innerHTML = '';
  } else {
    status.textContent = data.frozen
      ? `Переходы заморожены${data.freezeReason ? `: ${data.freezeReason}` : '.'}`
      : 'Автоматическое продвижение и откат разрешены.';
    summary.innerHTML = `
      <div><span>Состояние</span><strong>${data.frozen ? 'ЗАМОРОЖЕНО' : 'АКТИВНО'}</strong><small>версия ${Number(data.revision || 0)}</small></div>
      <div><span>Активная модель</span><strong>${escapeHtml(shortFingerprint(data.activeFingerprint))}</strong><small>активный отпечаток</small></div>
      <div><span>Предыдущий</span><strong>${escapeHtml(shortFingerprint(data.previousFingerprint))}</strong><small>цель отката</small></div>`;
    history.innerHTML = (data.transitions || []).length
      ? `<div class="model-remediation-history-head"><strong>Последние переходы</strong><span>идентификатор оператора скрыт</span></div>${data.transitions.slice(0, 8).map(row => `
          <div class="model-remediation-history-row">
            <div><strong>${escapeHtml(calibrationTransitionLabel(row.action))}</strong><span>${escapeHtml(humanizeTechnicalText(row.reason || ''))}</span></div>
            <small>r${Number(row.expectedRevision || 0)} → r${Number(row.resultingRevision || 0)} · ${escapeHtml(relativeAge(row.createdAt))}</small>
          </div>`).join('')}`
      : '<div class="empty compact-empty">Переходов пока нет.</div>';
  }

  const frozen = Boolean(data?.frozen);
  freezeBtn.hidden = frozen;
  unfreezeBtn.hidden = !frozen;
  freezeBtn.disabled = saving || !data?.available;
  unfreezeBtn.disabled = saving || !data?.available;
  rollbackBtn.disabled = saving || !data?.available || !data?.previousFingerprint;
}

async function loadCalibrationControl(force = false) {
  if (!isAdmin() || state.calibrationControlLoading) return;
  if (!force && state.calibrationControl) return renderCalibrationControl();
  state.calibrationControlLoading = true;
  renderCalibrationControl();
  try {
    state.calibrationControl = await api('/api/calibration-control');
  } catch (error) {
    state.calibrationControl = { available: false, reason: error.message || 'Не удалось загрузить состояние жизненного цикла.' };
  } finally {
    state.calibrationControlLoading = false;
    renderCalibrationControl();
  }
}

async function runCalibrationControlAction(action) {
  if (!isAdmin() || state.calibrationControlSaving) return;
  const reason = String($('calibrationControlReason')?.value || '').trim();
  if (reason.length < 5) return toast('Укажите причину действия — минимум 5 символов.');
  const labels = { freeze: 'заморозить автоматические переходы', unfreeze: 'разморозить автоматические переходы', manual_rollback: 'вернуть предыдущую активную модель' };
  if (!window.confirm(`Подтвердить действие: ${labels[action] || action}?`)) return;
  state.calibrationControlSaving = true;
  renderCalibrationControl();
  try {
    state.calibrationControl = await api('/api/calibration-control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, reason }),
      retry: false,
      dedupe: false,
    });
    if ($('calibrationControlReason')) $('calibrationControlReason').value = '';
    toast('Состояние калибровки обновлено атомарно.');
    await loadModelQuality(true);
  } catch (error) {
    toast(error.message || 'Не удалось изменить состояние калибровки.');
    state.calibrationControl = null;
    await loadCalibrationControl(true);
  } finally {
    state.calibrationControlSaving = false;
    renderCalibrationControl();
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
    ? 'Нужен файл миграции supabase_migration_v6_1.sql: предварительная проверка доступна, выполнение заблокировано.'
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
    <div><span>Контроль результатов</span><strong>${watchdog.autoRecoveryEnabled ? 'АВТО' : 'НАБЛЮДЕНИЕ'}</strong><small>${watchdog.schemaReady ? `${escapeHtml(watchdog.scheduleUtc || '04:00')} по всемирному времени` : 'нужна миграция v6.2'}</small></div>
    <div><span>Защитный контур</span><strong>${reliability.circuitOpen ? 'ОТКРЫТА' : 'ЗАКРЫТА'}</strong><small>${reliability.schemaReady ? (reliability.circuitOpenUntil ? `до ${escapeHtml(dateTime(reliability.circuitOpenUntil))}` : `${Number(reliability.consecutiveFailures || 0)}/${Number(reliability.failureThreshold || 2)} ошибок`) : 'нужна миграция v6.3'}</small></div>
    <div><span>Журнал запусков</span><strong>${Number(runLedger.activeStarted || 0) ? 'ЗАНЯТО' : Number(runLedger.staleStarted || 0) ? 'ЗАВИСЛО' : 'ЧИСТО'}</strong><small>${runLedger.schemaReady ? `${Number(runLedger.activeStarted || 0)} активных · ${Number(runLedger.staleStarted || 0)} зависших · максимум ${Number(runLedger.maxAttempts || 3)} попытки` : 'нужна миграция v6.4'}</small></div>
    <div><span>Подтверждение результата</span><strong>${Number(finality.drift || 0) ? 'РАСХОЖДЕНИЕ' : Number(finality.unverified || 0) || Number(finality.verified || 0) ? 'ПРОВЕРКА' : 'ПОДТВЕРЖДЕНО'}</strong><small>${finality.schemaReady ? `${Number(finality.confirmed || 0)} подтверждено · ${Number(finality.verified || 0)} первично проверено · ${Number(finality.unverified || 0)} ожидают проверки · ${Number(finality.adjudicated || 0)} проверено вручную · ${Number(finality.drift || 0)} расхождений` : 'нужна миграция v6.7'}</small></div>
    <div><span>Доверенные метрики</span><strong>${Number(finality.trustedForMetrics || 0)}</strong><small>только подтверждённые и вручную проверенные</small></div>
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
  const confirmed = window.confirm(`Повторно проверить ${Number(recovery.selectedCount || 0)} ожидающих прогнозов? Ожидается до ${Number(recovery.estimatedProviderCalls || 0)} запросов к источнику данных.`);
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
    accept_provider: 'принять исправление источника и пересчитать метрики результата',
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
      ? 'Исправление источника данных принято и записано в журнал.'
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
    essentials.push(loadRuntimeControlsAdmin(false));
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
      <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
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
    badge.textContent = 'ПРОВЕРКА';
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
      <div><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></div>
      <em>${x.blocking ? 'обязательно' : 'защита'}</em>
    </div>`).join('');

  const s = r.safety || {};
  runtime.innerHTML = `
    <div class="production-runtime-grid">
      <div><span>Объединено одинаковых запросов</span><strong>${Number(s.singleflight?.joins || 0)}</strong><small>${Number(s.singleflight?.active || 0)} сейчас</small></div>
      <div><span>Блокировки частых запросов</span><strong>${Number(s.burstGuard?.blocked || 0)}</strong><small>${Number(s.burstGuard?.activeBuckets || 0)} активных групп</small></div>
      <div><span>Тайм-ауты источников</span><strong>${Number(s.upstream?.timeouts || 0)}</strong><small>БД ${Number(s.upstream?.supabaseTimeoutMs || 0)/1000}с · источник данных ${Number(s.upstream?.apiFootballTimeoutMs || 0)/1000}с</small></div>
      <div><span>Быстрые сохранённые данные</span><strong>${Number(s.memory?.cacheEntries || 0)}</strong><small>мягкий лимит ${Number(s.memory?.cacheSoftLimit || 0)}</small></div>
      <div><span>Сохранённые данные профилей</span><strong>${Number(s.memory?.userSyncEntries || 0)}</strong><small>${Math.round(Number(s.memory?.userSyncTtlSeconds || 0)/60)} мин.</small></div>
      <div><span>Очистка памяти</span><strong>${Number(s.memory?.pruned || 0)}</strong><small>в этом экземпляре</small></div>
    </div>
    <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
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
    'navMatches','navSearch','navHistory','navProfile','aiTrackRecord',
    'connectionBanner','connectionRetryBtn','toast',
    'modelQualityStatus','modelRemediationStatus','modelRemediationDryRunBtn','modelRemediationRunBtn','modelRemediationCircuitResetBtn','modelRemediationDriftQueue','providerAuditStatus','releaseStatus','productionReadinessStatus','diagnosticsStatus','mediaPublisherFixtureId','mediaPublisherGenerateBtn','mediaPublisherResult',
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

  const navButtons = ['navMatches','navSearch','navHistory','navProfile'].filter(id => $(id));
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

function rcStateText(status) {
  if (status === 'rc_ready') return 'ГОТОВО';
  if (status === 'rc_with_holds') return 'ЕСТЬ ОГРАНИЧЕНИЯ';
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
    badge.textContent = 'ПРОВЕРКА';
    status.textContent = 'Запускаю безопасную регрессионную проверку…';
    meta.textContent = 'Лимит API-Football не расходуется';
    summary.innerHTML = '';
    groups.innerHTML = '';
    client.innerHTML = '';
    checks.innerHTML = '';
    return;
  }

  const r = state.rcRegression;
  if (!r) {
    badge.className = 'rc-badge';
    badge.textContent = 'Версия';
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
      <div><span>ПРОЙДЕНО</span><strong>${Number(r.summary?.passed || 0)}</strong></div>
      <div><span>ПРЕДУПРЕЖДЕНИЕ/ОГРАНИЧЕНИЕ</span><strong>${Number(r.summary?.warnings || 0)}</strong></div>
      <div><span>БЛОКИРОВКА</span><strong>${Number(r.summary?.blockers || 0)}</strong></div>
    </div>`;

  const groupLabels = {
    runtime:'Среда', security:'Безопасность', database:'Схема Supabase',
    user_routes:'Маршруты пользователя', gates:'Проверки выпуска', provider:'Источник данных', safety:'Безопасность',
  };
  groups.innerHTML = `<div class="rc-group-grid">${Object.entries(r.groups || {}).map(([key,g]) => `
    <div class="${Number(g.fail || 0) ? 'fail' : Number(g.warn || 0) ? 'warn' : 'pass'}">
      <span>${escapeHtml(groupLabels[key] || humanizeTechnicalText(key))}</span>
      <strong>${Number(g.pass || 0)}/${Number(g.total || 0)}</strong>
      <small>${Number(g.warn || 0)} предупреждений · ${Number(g.fail || 0)} ошибок</small>
    </div>`).join('')}</div>`;

  const cs = r.clientContract || runClientContractSmoke();
  client.innerHTML = `
    <div class="rc-client-head"><strong>📱 Проверка клиентского контракта</strong><span>${Number(cs.passed || 0)}/${Number(cs.total || 0)}</span></div>
    <div class="rc-client-checks">${(cs.checks || []).map(x => `
      <div class="${x.pass ? 'pass' : 'fail'}"><i>${x.pass ? '✓' : '×'}</i><span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span></div>`).join('')}</div>`;

  checks.innerHTML = `<details class="rc-details"><summary>Все серверные проверки · ${Number(r.summary?.total || 0)}</summary>
    <div class="rc-check-list">${(r.checks || []).map(x => `
      <div class="${escapeHtml(x.state || 'warn')}">
        <i>${x.state === 'pass' ? '✓' : x.state === 'fail' ? '×' : '!'}</i>
        <span><strong>${escapeHtml(humanizeTechnicalText(x.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.detail || ''))}</small></span>
        <em>${x.blocking ? 'обязательно' : (groupLabels[x.group] || humanizeTechnicalText(x.group))}</em>
      </div>`).join('')}</div>
  </details>
  <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
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
    status.textContent = panel.historyReason || 'Нужен файл миграции supabase_migration_v5_8.sql для истории и отката.';
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
    status.textContent = panel.reason || 'Нужен файл миграции supabase_migration_v5_7.sql.';
    revision.textContent = 'схема БД не готова';
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
    badge.textContent = 'ПРОВЕРКА';
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
    badge.textContent = 'БД';
    status.textContent = r.reason || 'Нужна миграция v5.6.';
    kpis.innerHTML = '<div class="data-notice stale">Перед проверкой уведомлений запустите <b>supabase_migration_v5_6.sql</b>.</div>';
    recent.innerHTML = '';
    return;
  }

  const healthy = r.health?.state === 'healthy';
  badge.className = `reminder-health-badge ${healthy ? 'healthy' : 'watch'}`;
  badge.textContent = healthy ? 'НОРМА' : 'КОНТРОЛЬ';
  status.textContent = `${r.health?.label || 'Состояние доставки'} · проверка каждые ${Number(r.scheduler?.cadenceMinutes || 5)} мин.`;

  const s = r.summary || {};
  kpis.innerHTML = `<div class="reminder-health-grid">
    <div><span>Активные</span><strong>${Number(s.activeUpcoming || 0)}</strong><small>будущие матчи</small></div>
    <div><span>До 90 мин.</span><strong>${Number(s.dueNext90Minutes || 0)}</strong><small>скоро к отправке</small></div>
    <div><span>До матча · 24ч</span><strong>${Number(s.prematchSent24h || 0)}</strong><small>доставлено</small></div>
    <div><span>Старт · 24ч</span><strong>${Number(s.kickoffSent24h || 0)}</strong><small>доставлено</small></div>
    <div><span>Ошибки 24ч</span><strong>${Number(s.failed24h || 0)}</strong><small>видны в мониторинге</small></div>
    <div><span>В обработке</span><strong>${Number(s.activeClaims || 0)}</strong><small>${Number(s.staleClaims || 0)} зависших</small></div>
  </div>`;

  recent.innerHTML = (r.recent || []).length
    ? `<div class="reminder-health-list">${r.recent.map(x => `
      <div class="${x.hasError ? 'error' : 'ok'}">
        <div><strong>${escapeHtml(x.match || `Матч #${x.fixtureId}`)}</strong><small>${x.fixtureDate ? dateTime(x.fixtureDate) : ''}</small></div>
        <span>${escapeHtml(technicalStateLabel(x.state || ''))}</span>
        <em>${Number(x.prematchAttempts || 0)} + ${Number(x.kickoffAttempts || 0)} попыт.</em>
      </div>`).join('')}</div><p class="tiny">${escapeHtml(humanizeTechnicalText(r.note || ''))}</p>`
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
  return stateValue === 'healthy' ? 'СТАБИЛЬНО' : stateValue === 'watch' ? 'КОНТРОЛЬ' : stateValue === 'incident' ? 'ИНЦИДЕНТ' : 'ОЖИДАНИЕ';
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
    badge.textContent = 'ПРОВЕРКА';
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
    <div><span>Предупреждения</span><strong>${Number(c.warningLike || 0)}</strong><small>${releaseMonitorDelta(r.trend?.warningsDelta)} к прошлому периоду</small></div>
    <div><span>Лимит событий</span><strong>${Number(budget.remaining || 0)}/${Number(budget.allowance || 0)}</strong><small>${budget.exhausted ? 'превышен' : 'остаток событий'}</small></div>
    <div><span>Событий</span><strong>${Number(c.total || 0)}</strong><small>предыдущий период ${Number(p.total || 0)}</small></div>
  </div>`;

  const cc = c.client || {};
  client.innerHTML = `<div class="release-monitor-section-head"><strong>📱 Телеметрия клиента</strong><span>только разрешённые поля · без пользовательского контента</span></div>
    <div class="release-client-grid">
      <div><span>Успешный запуск</span><strong>${Number(cc.bootOk || 0)}</strong></div>
      <div><span>Восстановление запуска</span><strong>${Number(cc.bootRecovery || 0)}</strong></div>
      <div><span>Блокировка версии</span><strong>${Number(cc.compatibilityBlocks || 0)}</strong></div>
      <div><span>Ошибки клиента</span><strong>${Number(cc.clientErrors || 0)}</strong></div>
      <div><span>Восстановление сети</span><strong>${Number(cc.networkRecovery || 0)}</strong></div>
    </div>`;

  const codes = c.topCodes || [];
  issues.innerHTML = `<div class="release-monitor-section-head"><strong>Главные сигналы</strong><span>предупреждение/ошибка/критическая</span></div>
    ${codes.length ? `<div class="release-issue-list">${codes.map(x => `<div><strong>${escapeHtml(humanizeTechnicalText(x.key))}</strong><span>${Number(x.count || 0)}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Ошибок и предупреждений за период нет.</div>'}`;

  const rows = r.incidents || [];
  incidents.innerHTML = `<details class="release-incidents"><summary>Последние события · ${rows.length}</summary>
    <div>${rows.length ? rows.map(x => `<article class="${escapeHtml(x.severity || 'warning')}">
      <div><strong>${escapeHtml(humanizeTechnicalText(x.code || x.source || ''))}</strong><span>${escapeHtml(dateTime(x.createdAt))}</span></div>
      <p>${escapeHtml(humanizeTechnicalText(x.message || ''))}</p>
      <small>${escapeHtml(x.source === 'worker' ? 'сервер' : x.source === 'release' ? 'релиз' : humanizeTechnicalText(x.source || ''))}${x.endpoint ? ` · ${escapeHtml(x.endpoint)}` : ''}</small>
    </article>`).join('') : '<div class="empty compact-empty">Нет событий.</div>'}</div>
  </details>
  <p class="tiny">${escapeHtml(humanizeTechnicalText(r.policy?.note || ''))}</p>`;
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


let mediaPublisherPayload = null;

function mediaPublisherValue(id, fallback = '') {
  return String($(id)?.value || fallback).trim();
}

async function generateMediaPublisherLink() {
  if (!isAdmin()) return;
  const fixtureId=Number(mediaPublisherValue('mediaPublisherFixtureId'));
  if (!Number.isSafeInteger(fixtureId) || fixtureId<=0) return toast('Укажите корректный fixture ID.');
  const button=$('mediaPublisherGenerateBtn');
  const result=$('mediaPublisherResult');
  if (button) button.disabled=true;
  if (result) {
    result.hidden=false;
    result.innerHTML='<div class="loader compact-loader">Создаю ссылку и текст публикации…</div>';
  }
  try {
    mediaPublisherPayload=await api('/api/media-publisher-link',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        fixtureId,
        source:mediaPublisherValue('mediaPublisherSource','media'),
        campaign:mediaPublisherValue('mediaPublisherCampaign','launch'),
        content:mediaPublisherValue('mediaPublisherContent','article1'),
      }),
      retry:false,
      dedupe:false,
      timeoutMs:9000,
    });
    if (result) result.innerHTML=`
      <div class="media-publisher-link-row"><span>Deep-link</span><code>${escapeHtml(mediaPublisherPayload.deepLink || '')}</code></div>
      <div class="media-publisher-link-row"><span>Start param</span><code>${escapeHtml(mediaPublisherPayload.startParam || '')}</code></div>
      <textarea class="media-publisher-copy" readonly>${escapeHtml(mediaPublisherPayload.copy?.body || '')}</textarea>
      <div class="media-publisher-result-actions">
        <button id="mediaPublisherTelegramBtn" class="secondary-btn" type="button">Открыть Telegram Share</button>
      </div>`;
    if ($('mediaPublisherCopyBtn')) $('mediaPublisherCopyBtn').disabled=false;
    $('mediaPublisherTelegramBtn')?.addEventListener('click',()=>{
      const url=String(mediaPublisherPayload?.telegramShareUrl || '');
      if (!url) return;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url,'_blank','noopener,noreferrer');
    });
    toast('Ссылка для публикации готова');
  } catch (error) {
    mediaPublisherPayload=null;
    if (result) result.innerHTML=`<div class="data-notice error">Не удалось создать ссылку: ${escapeHtml(error.message || 'ошибка')}</div>`;
    if ($('mediaPublisherCopyBtn')) $('mediaPublisherCopyBtn').disabled=true;
  } finally {
    if (button) button.disabled=false;
  }
}

async function copyMediaPublisherPost() {
  const text=String(mediaPublisherPayload?.copy?.body || '');
  if (!text) return toast('Сначала создайте ссылку.');
  try {
    await navigator.clipboard.writeText(text);
    toast('Текст публикации скопирован');
  } catch {
    toast('Не удалось скопировать текст');
  }
}

function launchFunnelPct(value) {
  const n=Number(value || 0);
  return Number.isFinite(n) ? `${n.toFixed(n % 1 ? 1 : 0)}%` : '0%';
}

function renderLaunchFunnel() {
  if (!isAdmin()) return;
  const status=$('launchFunnelStatus');
  const meta=$('launchFunnelMeta');
  const kpis=$('launchFunnelKpis');
  const stages=$('launchFunnelStages');
  const campaigns=$('launchFunnelCampaigns');
  const mediaCampaigns=$('launchFunnelMediaCampaigns');
  if (!status || !meta || !kpis || !stages || !campaigns || !mediaCampaigns) return;

  if (state.launchFunnelLoading) {
    status.textContent='Собираю first-party воронку…';
    meta.textContent='Только агрегированные данные';
    kpis.innerHTML=stages.innerHTML=campaigns.innerHTML=mediaCampaigns.innerHTML='';
    return;
  }

  const d=state.launchFunnel;
  if (!d?.available) {
    status.textContent=d?.reason || 'Воронка запуска ещё не загружена.';
    meta.textContent='Нужна миграция v6.15 и события пользователей.';
    kpis.innerHTML=stages.innerHTML=campaigns.innerHTML=mediaCampaigns.innerHTML='';
    return;
  }

  status.textContent=`Launch funnel · ${Number(d.days || 7)} дн.`;
  meta.textContent=`${Number(d.uniqueUsers || 0)} пользователей · ${Number(d.events || 0)} событий · хранение ${Number(d.retentionDays || 90)} дней`;
  const first=d.funnel?.[0] || {};
  const last=d.funnel?.at?.(-1) || d.funnel?.[d.funnel.length-1] || {};
  const handoff=d.handoff || {};
  const rechecks=d.rechecks || {};
  const media=d.mediaLoop || {};
  const impactActions=d.newsImpactActionSummary || {};
  const impactFunnel=Array.isArray(d.newsImpactActionFunnel) ? d.newsImpactActionFunnel : [];
  const impactBottleneck=d.newsImpactActionBottleneck || null;
  const impactConfidenceGuard=d.newsImpactActionConfidenceGuard || {minUsers:10,stableUsers:30};
  const impactAttributionGuard=d.newsImpactActionAttributionGuard || {actionWindowMinutes:30,maturationMinutes:30};
  const impactTrend=Array.isArray(d.newsImpactActionTrend) ? d.newsImpactActionTrend : [];
  const impactTrendGuard=d.newsImpactActionTrendGuard || {comparisonDays:Number(d.days || 7)};
  kpis.innerHTML=`<div class="release-monitor-kpis">
    <div><span>Входы</span><strong>${Number(first.users || 0)}</strong><small>bot + Mini App</small></div>
    <div><span>Полный AI</span><strong>${Number(last.users || 0)}</strong><small>${launchFunnelPct(last.fromEntryPct)} от входов</small></div>
    <div><span>Кампаний</span><strong>${Number(d.campaigns?.length || 0)}</strong><small>source + campaign</small></div>
    <div><span>Материалов СМИ</span><strong>${Number(d.mediaSummary?.materials || 0)}</strong><small>${Number(d.mediaSummary?.linksCreated || 0)} ссылок создано</small></div>
    <div><span>One‑tap → полный AI</span><strong>${Number(handoff.fullAiUsers || 0)}</strong><small>${launchFunnelPct(handoff.conversionPct)} от AI-handoff</small></div>
    <div><span>AI перепроверки</span><strong>${Number(rechecks.total || 0)}</strong><small>${Number(rechecks.free || 0)} без списания · ${Number(rechecks.material || 0)} со значимыми изменениями</small></div>
    <div><span>Новости → AI</span><strong>${Number(d.returnLoop?.aiIntent || 0)}</strong><small>${launchFunnelPct(d.returnLoop?.intentPct)} нажали AI · ${Number(d.returnLoop?.smartFixtureIntent || 0)} через smart fixture · News Impact: ${Number(d.returnLoop?.impactCompared || 0)} сравнений / ${Number(d.returnLoop?.impactMaterial || 0)} существенных · решения: 🔴 ${Number(d.newsImpactDecisionSummary?.material || 0)} · 🟡 ${Number(d.newsImpactDecisionSummary?.detail || 0)} · 🟢 ${Number(d.newsImpactDecisionSummary?.stable || 0)} · действия: полный AI ${Number(impactActions.fullAi || 0)} · составы ${Number(impactActions.squads || 0)} · рынок ${Number(impactActions.market || 0)} · перепроверка ${Number(impactActions.recheck || 0)} · новости ${Number(impactActions.news || 0)} · поделились ${Number(impactActions.share || 0)} · Возврат из новостей: ${Number(d.returnLoop?.newsReturn || 0)} до матча</small></div>
    <div><span>Media deep-link → AI</span><strong>${Number(media.aiUsers || 0)}</strong><small>${Number(media.deepLinkUsers || 0)} открыли · ${launchFunnelPct(media.conversionPct)} получили AI</small></div>
  </div>`;

  const rows=d.funnel || [];
  const bottleneck=d.bottleneck;
  const searchQuality=d.searchQuality || {};
  stages.innerHTML=`<div class="release-monitor-section-head"><strong>Воронка</strong><span>уникальные пользователи</span></div>
    ${bottleneck ? `<div class="data-notice">🎯 Узкое место: <strong>${escapeHtml(bottleneck.label || '')}</strong> · теряется ${launchFunnelPct(bottleneck.dropPct)} пользователей перехода.</div>` : ''}
    ${impactBottleneck && Number(impactBottleneck.users || 0) ? `<div class="data-notice">🧭 После News Impact: самая низкая конверсия при достаточной выборке у состояния <strong>${escapeHtml(impactBottleneck.label || impactBottleneck.code || '')}</strong> · ${Number(impactBottleneck.actedUsers || 0)} из ${Number(impactBottleneck.users || 0)} продолжили · ${launchFunnelPct(impactBottleneck.conversionPct)} · 95% ДИ ${launchFunnelPct(impactBottleneck.confidence?.lowerPct)}–${launchFunnelPct(impactBottleneck.confidence?.upperPct)}.</div>` : impactFunnel.some(x=>Number(x.users || 0)>0) ? `<div class="data-notice">🧪 News Impact: данных пока мало для определения узкого места. Нужно минимум <strong>${Number(impactConfidenceGuard.minUsers || 10)}</strong> пользователей в одном состоянии решения.</div>` : ''}
    ${impactFunnel.some(x=>Number(x.observedUsers || 0)>0) ? `<div class="data-notice">⏱ Атрибуция действий: действие считается только после Decision Card и в течение <strong>${Number(impactAttributionGuard.actionWindowMinutes || 30)} мин.</strong>; решения младше ${Number(impactAttributionGuard.maturationMinutes || 30)} мин. ещё не входят в конверсию.</div>` : ''}
    ${Number(rechecks.total || 0) ? `<div class="data-notice">🕒 Freshness guard: <strong>${Number(rechecks.total || 0)}</strong> перепроверок · ${Number(rechecks.material || 0)} со значимыми изменениями · ${Number(rechecks.stable || 0)} без значимых изменений.</div>` : ''}
    ${Number(handoff.users || 0) ? `<div class="data-notice">⚡ One‑tap AI: <strong>${Number(handoff.users || 0)}</strong> пользователей получили Telegram‑бриф · ${Number(handoff.fullAiUsers || 0)} дошли до полного AI · конверсия ${launchFunnelPct(handoff.conversionPct)}.</div>` : ''}
    ${Number(media.deepLinkOpens || 0) ? `<div class="data-notice">📣 Media loop: <strong>${Number(media.shareEvents || 0)}</strong> созданных share-ссылок · ${Number(media.deepLinkOpens || 0)} открытий fixture deep-link · ${Number(media.aiUsers || 0)} пользователей получили AI без повторного поиска.</div>` : ''}
    ${Number(searchQuality.attempts || 0) ? `<div class="data-notice">🔎 Качество поиска: <strong>${launchFunnelPct(searchQuality.matchPct)}</strong> поисков сразу дали матч · матч ${Number(searchQuality.match || 0)} · клуб распознан без матча ${Number(searchQuality.recognizedNoMatch || 0)} · не найдено ${Number(searchQuality.notFound || 0)} · спасено последним матчем ${Number(searchQuality.recoveredRecent || 0)}.</div>` : ''}
    <div class="launch-funnel-stages">${rows.map((x,index)=>`<div>
      <span>${index+1}. ${escapeHtml(x.label || x.key || '')}</span>
      <strong>${Number(x.users || 0)}</strong>
      <small>${index ? `${launchFunnelPct(x.fromPreviousPct)} от предыдущего · ${launchFunnelPct(x.fromEntryPct)} от входа` : 'точка входа'}</small>
    </div>`).join('')}</div>
    ${impactFunnel.some(x=>Number(x.users || 0)>0) ? `<div class="release-monitor-section-head"><strong>News Impact → действие</strong><span>по состояниям решения</span></div>
      <div class="launch-campaign-list">${impactFunnel.filter(x=>Number(x.users || 0)>0).map(x=>`<div>
        <span><b>${escapeHtml(x.label || x.code || '')}</b></span>
        <strong>${Number(x.actedUsers || 0)} / ${Number(x.users || 0)}</strong>
        <small>${launchFunnelPct(x.conversionPct)} продолжили · 95% ДИ ${launchFunnelPct(x.confidence?.lowerPct)}–${launchFunnelPct(x.confidence?.upperPct)} · ${escapeHtml(x.confidence?.label || 'мало данных')} · ${Number(x.immatureUsers || 0) ? `${Number(x.immatureUsers || 0)} свежих решений ещё не вошли · ` : ''}чаще: ${escapeHtml(x.topAction?.label || 'нет действий')}</small>
      </div>`).join('')}</div>` : ''}
    ${impactTrend.some(x=>Number(x.currentUsers || 0)>0 || Number(x.previousUsers || 0)>0) ? `<div class="release-monitor-section-head"><strong>Динамика News Impact</strong><span>текущие ${Number(impactTrendGuard.comparisonDays || d.days || 7)} дн. vs предыдущие</span></div>
      <div class="launch-campaign-list">${impactTrend.filter(x=>Number(x.currentUsers || 0)>0 || Number(x.previousUsers || 0)>0).map(x=>{
        const signal=x.signal==='improved' ? '↗ подтверждённый рост'
          : x.signal==='weakened' ? '↘ подтверждённое снижение'
            : x.signal==='insufficient' ? '◌ мало данных'
              : '≈ изменение не подтверждено';
        return `<div>
          <span><b>${escapeHtml(x.label || x.code || '')}</b></span>
          <strong>${launchFunnelPct(x.previousPct)} → ${launchFunnelPct(x.currentPct)}</strong>
          <small>${escapeHtml(signal)} · Δ ${Number(x.deltaPctPoints || 0)>0?'+':''}${Number(x.deltaPctPoints || 0).toFixed(1)} п.п. · выборка ${Number(x.previousUsers || 0)} → ${Number(x.currentUsers || 0)}</small>
        </div>`;
      }).join('')}</div>` : (!d.trendAvailable ? '<div class="data-notice">Динамика News Impact временно недоступна; текущий период продолжает работать.</div>' : '')}`;

  const sources=d.campaigns || [];
  campaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Источники и кампании</strong><span>без Telegram ID</span></div>
    ${sources.length ? `<div class="launch-campaign-list">${sources.map(x=>`<div>
      <span><b>${escapeHtml(x.source || 'telegram')}</b> · ${escapeHtml(x.campaign || 'direct')}</span>
      <strong>${Number(x.entries || 0)} → ${Number(x.fullAi || 0)}</strong>
      <small>AI conversion ${launchFunnelPct(x.conversionPct)} · ${Number(x.events || 0)} событий</small>
    </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет атрибутированных входов.</div>'}
    <p class="tiny">${escapeHtml(d.privacy || '')}</p>`;

  const mediaRows=d.mediaCampaigns || [];
  const mediaSummary=d.mediaSummary || {};
  mediaCampaigns.innerHTML=`<div class="release-monitor-section-head"><strong>Материалы СМИ</strong><span>source · campaign · content</span></div>
    <div class="media-campaign-summary">
      <span>Создано ссылок <strong>${Number(mediaSummary.linksCreated || 0)}</strong></span>
      <span>Входы <strong>${Number(mediaSummary.entries || 0)}</strong></span>
      <span>Quick AI <strong>${Number(mediaSummary.quickAi || 0)}</strong></span>
      <span>Полный AI <strong>${Number(mediaSummary.fullAi || 0)}</strong></span>
      <span>Конверсия <strong>${launchFunnelPct(mediaSummary.conversionPct)}</strong></span>
    </div>
    ${mediaRows.length ? `<div class="media-campaign-list">${mediaRows.map(x=>`<div class="media-campaign-row">
      <div class="media-campaign-name"><strong>${escapeHtml(x.content || 'default')}</strong><small>${escapeHtml(x.source || 'media')} · ${escapeHtml(x.campaign || 'launch')}</small></div>
      <div class="media-campaign-flow"><span>${Number(x.entries || 0)} входов</span><b>→</b><span>${Number(x.fullAi || 0)} полный AI</span></div>
      <div class="media-campaign-metrics"><span>${Number(x.deepLinkOpens || 0)} deep-link</span><span>${Number(x.quickAi || 0)} quick AI</span><span>${launchFunnelPct(x.fullAiConversionPct)} конверсия</span><span>${Number(x.linksCreated || 0)} ссылок</span></div>
    </div>`).join('')}</div>` : '<div class="empty compact-empty">Пока нет данных по отдельным материалам СМИ.</div>'}
    <p class="tiny">Статистика агрегируется по first-party attribution. Telegram ID пользователей не отображаются.</p>`;

}

async function loadLaunchFunnel(force=false) {
  if (!isAdmin() || state.launchFunnelLoading) return;
  if (!force && state.launchFunnel) { renderLaunchFunnel(); return; }
  state.launchFunnelLoading=true;
  renderLaunchFunnel();
  try {
    const days=Number($('launchFunnelPeriod')?.value || state.launchFunnelDays || 7);
    state.launchFunnelDays=days;
    state.launchFunnel=await api(`/api/launch-funnel?days=${days}`,{retry:false,timeoutMs:10000});
  } catch (e) {
    state.launchFunnel={available:false,reason:e.message};
    toast(e.message);
  } finally {
    state.launchFunnelLoading=false;
    renderLaunchFunnel();
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
    root.textContent = 'Проверяю сервер, Supabase, сохранённые данные и API-Football…';
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
      <div class="diagnostics-block-head"><strong>Источник данных API-Football</strong><span>${escapeHtml(technicalStateLabel(p.health || 'waiting'))}</span></div>
      <div class="diagnostics-grid">
        <div><span>Тариф</span><strong>${escapeHtml(p.plan && p.plan !== 'UNKNOWN' ? planLabel(p.plan) : 'не определён')}</strong><small>${p.lastStatus ? `код ответа ${Number(p.lastStatus)}` : 'ответ ещё не получен'}</small></div>
        <div><span>Сегодня использовано</span><strong>${Number.isFinite(Number(p.dailyUsed)) && Number.isFinite(Number(p.dailyLimit)) ? `${Number(p.dailyUsed)} / ${Number(p.dailyLimit)}` : '—'}</strong><small>${diagPct(p.dailyUsedPct)}</small></div>
        <div><span>Минутное окно</span><strong>${Number.isFinite(Number(p.minuteUsed)) && Number.isFinite(Number(p.minuteLimit)) ? `${Number(p.minuteUsed)} / ${Number(p.minuteLimit)}` : '—'}</strong><small>${diagPct(p.minuteUsedPct)}</small></div>
        <div><span>Последний ответ</span><strong>${Number.isFinite(Number(p.lastLatencyMs)) ? `${Number(p.lastLatencyMs)} мс` : '—'}</strong><small>${p.lastSuccessAt ? relativeAge(p.lastSuccessAt) : humanizeTechnicalText(p.lastError || 'нет данных')}</small></div>
      </div>
      ${p.cooldownActive ? `<p class="diagnostics-warning">⏳ Пауза из-за лимита запросов активна до ${escapeHtml(dateTime(p.cooldownUntil))}.</p>` : ''}`;
  }

  const db = d.supabase || {};
  const cache = db.cache || {};
  const obs = d.observability || {};
  if (database) {
    database.hidden = false;
    database.innerHTML = `
      <div class="diagnostics-block-head"><strong>База данных Supabase и сохранённые данные</strong><span>${db.ok ? 'в сети' : (String(db.status || '').toLowerCase() === 'offline' ? 'нет связи' : escapeHtml(technicalStateLabel(db.status || 'offline')))}</span></div>
      <div class="diagnostics-grid">
        <div><span>Доступ к базе данных</span><strong>${db.ok ? 'Норма' : 'Ошибка'}</strong><small>${Number.isFinite(Number(db.latencyMs)) ? `${Number(db.latencyMs)} мс` : '—'}</small></div>
        <div><span>Сохранённых записей</span><strong>${Number.isFinite(Number(cache.total)) ? Number(cache.total) : '—'}</strong><small>выборка ${Number(cache.sampled || 0)}</small></div>
        <div><span>Свежие / устаревшие</span><strong>${Number(cache.freshInSample || 0)} / ${Number(cache.staleInSample || 0)}</strong><small>в диагностической выборке</small></div>
        <div><span>Журнал ошибок</span><strong>${obs.persistent ? 'Supabase' : 'Память'}</strong><small>${obs.migrationReady ? `хранение ${Number(obs.retentionDays || 14)} дн.` : 'нужна миграция v3.8'}</small></div>
      </div>`;
  }

  const rt = d.runtime || {};
  if (runtime) {
    runtime.hidden = false;
    runtime.innerHTML = `
      <div class="diagnostics-block-head"><strong>Текущий обработчик Cloudflare</strong><span>среда</span></div>
      <div class="diagnostics-grid">
        <div><span>Запросов к серверу</span><strong>${Number(rt.apiRequests || 0)}</strong><small>успех ${diagPct(rt.apiSuccessRate)}</small></div>
        <div><span>Использование сохранённых данных</span><strong>${diagPct(rt.cacheHitRate)}</strong><small>${Number(rt.cacheHits || 0)} попаданий · ${Number(rt.cacheMisses || 0)} промахов</small></div>
        <div><span>Ограничения частоты</span><strong>${Number(rt.rateLimits || 0)}</strong><small>${Number(rt.quotaBlocks || 0)} запроса остановлено защитой квоты</small></div>
        <div><span>Защита от всплесков</span><strong>${Number(rt.burstBlocks || 0)}</strong><small>${Number(rt.singleflightJoins || 0)} объединений запросов</small></div>
        <div><span>Тайм-ауты источников</span><strong>${Number(rt.upstreamTimeouts || 0)}</strong><small>${Number(rt.userSyncSkips || 0)} синхронизаций пользователя пропущено</small></div>
        <div><span>Быстрые сохранённые данные</span><strong>${Number(rt.l1CacheEntries || 0)}</strong><small>${Number(rt.memoryPrunes || 0)} очисток памяти</small></div>
        <div><span>Ошибки маршрутов</span><strong>${Number(rt.routeErrors || 0)}</strong><small>работает ${escapeHtml(diagDuration(rt.uptimeSeconds))}</small></div>
      </div>
      <p class="tiny diagnostics-note">Счётчики среды выполнения относятся только к текущему экземпляру серверного обработчика Cloudflare. Дневной и минутный расход выше берётся непосредственно из заголовков API-Football.</p>`;
  }

  if (client) {
    const cp = state.clientPerf || {};
    const avg = Number(cp.completed || 0) > 0 ? Math.round(Number(cp.totalMs || 0) / Number(cp.completed)) : null;
    client.hidden = false;
    client.innerHTML = `<div class="diagnostics-block-head"><strong>📱 Клиент мини-приложения</strong><span>${escapeHtml(CLIENT_VERSION)}</span></div><div class="diagnostics-grid">
      <div><span>Сеть</span><strong>${navigator.onLine === false ? 'Нет сети' : 'В сети'}</strong><small>${navigator.connection?.effectiveType ? `тип сети: ${escapeHtml(navigator.connection.effectiveType)}` : 'тип сети —'}</small></div>
      <div><span>Средний ответ сервера</span><strong>${avg !== null ? `${avg} мс` : '—'}</strong><small>последний ${cp.lastMs !== null ? `${cp.lastMs} мс` : '—'}</small></div>
      <div><span>Запросы</span><strong>${Number(cp.requests || 0)}</strong><small>${Number(cp.completed || 0)} успешно · ${Number(cp.failed || 0)} ошибок</small></div>
      <div><span>Оптимизация</span><strong>${Number(cp.deduped || 0)} объединено</strong><small>${Number(cp.retries || 0)} авто-повторов</small></div>
      <div><span>Защита клиента</span><strong>${Number(cp.rateLimited || 0)} ограничений</strong><small>${Number(cp.timeouts || 0)} тайм-аутов</small></div>
      <div><span>Восстановление интерфейса</span><strong>${Number(cp.recoveries || 0)} восстановлений</strong><small>${Number(cp.degradedEvents || 0)} событий ухудшения</small></div>
      <div><span>Состояние сети</span><strong>${escapeHtml(technicalStateLabel(state.network.mode || 'online'))}</strong><small>${state.network.lastRecoveredAt ? `восстановлено ${escapeHtml(relativeAge(state.network.lastRecoveredAt))}` : 'без восстановлений'}</small></div>
      <div><span>Запуск</span><strong>${Number.isFinite(Number(cp.bootMs)) ? `${Number(cp.bootMs)} мс` : '—'}</strong><small>${state.startup.manifestOk ? 'манифест загружен' : `ошибок манифеста: ${Number(cp.manifestFailures || 0)}`}</small></div>
      <div><span>Контракт обмена данными</span><strong>${CLIENT_API_CONTRACT}</strong><small>канал ${escapeHtml(String(state.appManifest?.releaseChannel || CLIENT_RELEASE_CHANNEL).toUpperCase())} · минимум ${escapeHtml(state.appManifest?.minClientVersion || '—')}</small></div>
    </div>`;
  }

  const integrityData = d.integrity || {};
  const integrityRun = integrityData.lastRun || {};
  const integrityIssues = integrityData.recentIssues || [];
  if (integrity) {
    integrity.hidden = false;
    integrity.innerHTML = `
      <div class="diagnostics-block-head"><strong>Целостность матчей</strong><span>${escapeHtml(technicalStateLabel(integrityRun.health || (integrityData.migrationReady ? 'waiting' : 'migration')))}</span></div>
      <div class="diagnostics-grid">
        <div><span>Проверено</span><strong>${integrityRun.inspected ?? '—'}</strong><small>${integrityRun.observedAt ? relativeAge(integrityRun.observedAt) : 'ещё нет запуска'}</small></div>
        <div><span>Оценка качества</span><strong>${Number.isFinite(Number(integrityRun.qualityScore)) ? `${Math.round(Number(integrityRun.qualityScore))}%` : '—'}</strong><small>${Number(integrityRun.clean || 0)} без замечаний</small></div>
        <div><span>Скрыто защитой</span><strong>${Number(integrityRun.quarantined || 0)}</strong><small>${Number(integrityRun.duplicates || 0)} дубликатов</small></div>
        <div><span>Предупреждения</span><strong>${Number(integrityRun.warnings || 0)}</strong><small>${Number(integrityRun.errors || 0)} ошибок</small></div>
      </div>
      ${!integrityData.migrationReady ? '<p class="diagnostics-warning">Нужна миграция v3.9 для постоянного журнала целостности данных.</p>' : ''}
      ${integrityIssues.length ? `<div class="integrity-issue-list">${integrityIssues.slice(0,5).map(item => `<div><b>${escapeHtml(humanizeTechnicalText(item.issue_code || item.code || 'ДАННЫЕ'))}</b><span>${escapeHtml(humanizeTechnicalText(item.message || ''))}</span><small>${escapeHtml([item.home_name || item.home, item.away_name || item.away].filter(Boolean).join(' — '))}${item.fixture_id || item.fixtureId ? ` · #${Number(item.fixture_id || item.fixtureId)}` : ''}</small></div>`).join('')}</div>` : ''}`;
  }

  const recent = obs.recentEvents || [];
  if (events) {
    events.hidden = false;
    events.innerHTML = `
      <div class="diagnostics-block-head"><strong>Последние события</strong><span>${recent.length}</span></div>
      <div class="diagnostics-events">${recent.length ? recent.slice(0, 8).map(item => `
        <div class="diagnostics-event ${escapeHtml(item.severity || 'info')}">
          <i></i><div><strong>${escapeHtml(humanizeTechnicalText(item.code || item.event_type || 'СОБЫТИЕ'))}</strong><span>${escapeHtml(humanizeTechnicalText(item.message || 'Без описания'))}</span><small>${escapeHtml(item.source === 'worker' ? 'сервер' : item.source === 'release' ? 'релиз' : humanizeTechnicalText(item.source || 'сервер'))}${item.endpoint ? ` · ${escapeHtml(item.endpoint)}` : ''} · ${item.created_at ? escapeHtml(relativeAge(item.created_at)) : ''}</small></div>
        </div>`).join('') : '<div class="empty compact-empty">Ошибок и предупреждений пока нет.</div>'}</div>`;
  }

  if (recommendations) {
    recommendations.hidden = false;
    recommendations.innerHTML = `
      <div class="diagnostics-block-head"><strong>Что делать</strong><span>автопроверка</span></div>
      <ul class="diagnostics-actions">${(d.recommendations || []).map(x => `<li>${escapeHtml(humanizeTechnicalText(x))}</li>`).join('')}</ul>`;
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

  if ($('providerTransitionMode')) $('providerTransitionMode').textContent = humanizeTechnicalText(transition.label || 'Ожидаем тариф');
  if ($('providerRefreshCadence')) $('providerRefreshCadence').textContent = transition.liveRefreshSeconds ? `${transition.liveRefreshSeconds} сек.` : '—';
  if ($('providerExpectedDaily')) $('providerExpectedDaily').textContent = transition.expected?.daily ? String(transition.expected.daily) : '—';
  if ($('providerExpectedMinute')) $('providerExpectedMinute').textContent = transition.expected?.minute ? String(transition.expected.minute) : '—';

  const budget = state.providerBudget || {};
  if ($('quotaBudgetMode')) $('quotaBudgetMode').textContent = humanizeTechnicalText(budget.label || 'Ожидаем данные');
  if ($('quotaBudgetDaily')) $('quotaBudgetDaily').textContent = Number.isFinite(Number(budget.daily?.remaining))
    ? `${budget.daily.remaining} · резерв ${Number(budget.daily?.reserve || 0)}` : '—';
  if ($('quotaBudgetMinute')) $('quotaBudgetMinute').textContent = Number.isFinite(Number(budget.minute?.remaining))
    ? `${budget.minute.remaining} · резерв ${Number(budget.minute?.reserve || 0)}` : '—';
  if ($('quotaFeatureApi')) $('quotaFeatureApi').textContent = String(Number(budget.counters?.api || 0));
  if ($('quotaFeatureCache')) $('quotaFeatureCache').textContent = String(Number(budget.counters?.cache || 0));
  if ($('quotaFeatureStale')) $('quotaFeatureStale').textContent = String(Number(budget.counters?.stale || 0));
  if ($('quotaFeatureSkipped')) $('quotaFeatureSkipped').textContent = String(Number(budget.counters?.skipped || 0));
  if ($('quotaBudgetNote')) $('quotaBudgetNote').textContent = humanizeTechnicalText(budget.note || 'Сохранение данных по функциям активно.');

  const featureList = $('quotaFeatureList');
  if (featureList) {
    const rows = Object.entries(budget.counters?.byFeature || {});
    featureList.innerHTML = rows.length ? rows.map(([name, c]) => `
      <div class="quota-feature-row">
        <strong>${escapeHtml(humanizeTechnicalText(name))}</strong>
        <span>источник ${Number(c.api || 0)}</span>
        <span>сохранено ${Number(c.cache || 0)}</span>
        <span>резерв ${Number(c.stale || 0)}</span>
        <span>пропуск ${Number(c.skipped || 0)}</span>
      </div>`).join('') : '<div class="empty compact-empty">Счётчики появятся после открытия центра матча.</div>';
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
      ? 'Тариф обнаружен. Укажите номер матча и запустите проверку.'
      : 'Сначала обновите тариф. На бесплатном плане полная проверка будет заблокирована для экономии квоты.';
    result.hidden = true;
    return;
  }

  result.hidden = false;
  const summary = audit.summary || {};
  const blocked = Boolean(audit.blocked);
  status.textContent = blocked
    ? humanizeTechnicalText(audit.note || 'Полная проверка заблокирована защитой квоты.')
    : `${humanizeTechnicalText(summary.label || 'Проверка завершена')} · ${Number(summary.score || 0)}% · ${Number(audit.durationMs || 0)} мс`;

  const fixture = audit.fixture || {};
  const endpoints = audit.endpoints || [];
  result.innerHTML = `
    <div class="provider-audit-head">
      <div><strong>${escapeHtml(fixture.home || '—')} — ${escapeHtml(fixture.away || '—')}</strong><span>Матч #${Number(fixture.fixtureId || 0)} · ${escapeHtml(humanizeTechnicalText(fixture.status || ''))}</span></div>
      <span class="provider-audit-score ${blocked ? 'blocked' : Number(summary.score || 0) >= 80 ? 'good' : 'warn'}">${blocked ? 'ЗАЩИТА' : `${Number(summary.score || 0)}%`}</span>
    </div>
    <div class="provider-audit-cost">
      <span>Запросов этого запуска</span><strong>${Number(audit.cost?.usedNow || 0)}</strong>
      <small>полная проверка максимум ${Number(audit.cost?.maxFullAudit || 0)}</small>
    </div>
    <div class="provider-endpoint-grid">${endpoints.map(x => `
      <div class="provider-endpoint-row ${escapeHtml(x.state || '')}">
        <div><strong>${escapeHtml(humanizeTechnicalText(x.label || x.key || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(x.note || ''))}</small></div>
        <span>${providerAuditStateLabel(x.state)}</span>
        <em>${Number.isFinite(Number(x.latencyMs)) ? `${Number(x.latencyMs)} мс` : ''}</em>
      </div>`).join('')}</div>
    <p class="tiny">${escapeHtml(humanizeTechnicalText(audit.note || ''))}</p>`;
}


function e2eStepIcon(stateValue) {
  return stateValue === 'pass' ? '✓'
    : stateValue === 'fail' ? '×'
      : stateValue === 'warn' ? '!'
        : stateValue === 'hold' ? '⏸' : '•';
}

function e2eStepLabel(stateValue) {
  return stateValue === 'pass' ? 'Готово'
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
    stepsEl.innerHTML = '<div class="empty compact-empty">Проверяю источник данных → покрытие → центр матча → повторное использование сохранённых данных.</div>';
    details.hidden = true;
    return;
  }

  if (!result) {
    const paid = Boolean(transition.paid);
    badge.className = `expanded-gate-badge ${paid ? 'ready' : 'hold'}`;
    badge.textContent = paid ? 'ГОТОВ?' : 'ОЖИДАНИЕ';
    title.textContent = paid ? 'Тариф обнаружен — можно запускать сквозную проверку' : 'Сквозная проверка расширенных данных';
    meta.textContent = paid
      ? `${planLabel(transition.plan || 'PAID')} · ${humanizeTechnicalText(budget.label || 'режим не определён')}`
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
  title.textContent = humanizeTechnicalText(status.label || 'Сквозная проверка расширенных данных');
  meta.textContent = `Матч #${Number(result.fixtureId || 0)} · ${dateTime(result.generatedAt)} · ${Number(result.durationMs || 0)} мс`;

  stepsEl.innerHTML = (result.steps || []).map(step => `
    <div class="expanded-gate-step ${escapeHtml(step.state || '')}">
      <span>${e2eStepIcon(step.state)}</span>
      <div><strong>${escapeHtml(humanizeTechnicalText(step.label || ''))}</strong><small>${escapeHtml(humanizeTechnicalText(step.note || ''))}</small></div>
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
      <div><span>Тариф</span><strong>${escapeHtml(planLabel(result.transition?.plan || '—'))}</strong></div>
      <div><span>Покрытие</span><strong>${coverage ? `${Number(coverage.score || 0)}%` : '—'}</strong></div>
      <div><span>Повтор из сохранённых данных</span><strong>${result.cacheVerification?.cached ? 'Да' : result.blocked ? '—' : 'Проверить'}</strong></div>
      <div><span>Расход за день</span><strong>${Number.isFinite(Number(result.requestCost?.observedDailyDelta)) ? Number(result.requestCost.observedDailyDelta) : '—'}</strong></div>
    </div>
    ${result.matchCenter?.fixture ? `<div class="expanded-gate-fixture">
      <strong>${escapeHtml(result.matchCenter.fixture.home?.name || '')} — ${escapeHtml(result.matchCenter.fixture.away?.name || '')}</strong>
      <span>${escapeHtml(technicalStateLabel(result.matchCenter.mode || 'waiting'))} · первый ответ ${Number(result.matchCenter.firstResponseMs || 0)} мс · повтор из сохранённых данных ${Number(result.cacheVerification?.secondResponseMs || 0)} мс</span>
    </div>` : ''}
    ${Object.keys(sourceCounts).length ? `<div class="expanded-gate-sources">${Object.entries(sourceCounts).map(([key,value]) => `<span>${escapeHtml(freshnessSourceLabel(key))} <b>${Number(value)}</b></span>`).join('')}</div>` : ''}
    <p class="tiny">${escapeHtml(humanizeTechnicalText(result.note || ''))}</p>`;
}

async function runProviderE2E(fixtureId) {
  if (!isAdmin() || state.providerE2ELoading || state.providerAuditLoading) return;
  const id = Number(fixtureId || $('providerAuditFixtureId')?.value || 0);
  if (!id) { toast('Укажите номер матча'); return; }
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
  $('providerPlan').textContent = p.plan && p.plan !== 'UNKNOWN' ? planLabel(p.plan) : 'Определяется';
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
  if (!id) { toast('Укажите номер матча'); return; }
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
  if (state.remindersLoading && !state.remindersLoaded) {
    el.innerHTML = '<div class="loader compact-loader">Загружаю напоминания…</div>';
    return;
  }
  if (state.remindersLoadError && !state.remindersLoaded) {
    el.innerHTML = recoveryCardHtml({ title:'Напоминания временно недоступны', message:state.remindersLoadError, retryId:'remindersRetry', compact:true });
    $('remindersRetry')?.addEventListener('click', loadReminders);
    return;
  }
  if (!state.reminders.length) {
    const warning = state.remindersLoadError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.remindersLoadError)} Последний загруженный список напоминаний был пуст.</div>`
      : '';
    const retry = state.remindersLoadError
      ? '<button id="remindersEmptyRetry" class="secondary-btn" type="button">Обновить</button>'
      : '';
    el.innerHTML = `${warning}<div class="empty compact-empty profile-empty-state">
      <strong>Активных напоминаний пока нет</strong>
      <p>Откройте матч и включите напоминание перед началом.</p>
      <div class="empty-actions">${retry}<button id="remindersEmptyMatches" class="secondary-btn" type="button">Перейти к матчам</button></div>
    </div>`;
    $('remindersEmptyRetry')?.addEventListener('click', loadReminders);
    $('remindersEmptyMatches')?.addEventListener('click', () => showView('matchesView'));
    return;
  }
  const rows = [...state.reminders].sort((a, b) => Date.parse(a.fixtureDate || 0) - Date.parse(b.fixtureDate || 0));
  const staleNotice = state.remindersLoadError ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.remindersLoadError)} Показаны последние загруженные напоминания.</div>` : '';
  el.innerHTML = staleNotice + rows.map(x => `
    <div class="reminder-row">
      <div>
        <strong>${escapeHtml(x.homeName)} — ${escapeHtml(x.awayName)}</strong>
        <span>${dateTime(x.fixtureDate)} · за ${Number(x.remindBeforeMinutes || 30)} мин.${x.kickoffNotify ? ' · + старт' : ''}</span>
        ${reminderDeliveryBadge(x)}
      </div>
      <button class="reminder-remove" type="button" data-fixture-id="${Number(x.fixtureId)}" ${state.reminderMutations.has(Number(x.fixtureId)) ? 'disabled' : ''}>Отключить</button>
    </div>`).join('');
  document.querySelectorAll('.reminder-remove').forEach(btn => btn.addEventListener('click', async () => {
    const fixtureId = Number(btn.dataset.fixtureId);
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
  }));
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
  } catch (e) {
    toast(e.message);
  } finally {
    state.favoriteMutations.delete(teamId);
    syncFavoriteMutationUi(teamId);
  }
}

function renderFavoriteTeams() {
  const el = $('favoriteTeams');
  if (!el) return;
  if (state.favoritesLoading && !state.favoritesLoaded) {
    el.innerHTML = '<div class="loader compact-loader">Загружаю избранное…</div>';
    return;
  }
  if (state.favoritesLoadError && !state.favoritesLoaded) {
    el.innerHTML = recoveryCardHtml({ title:'Избранное временно недоступно', message:state.favoritesLoadError, retryId:'favoritesRetry', compact:true });
    $('favoritesRetry')?.addEventListener('click', loadFavorites);
    return;
  }
  if (!state.favorites.length) {
    const warning = state.favoritesLoadError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.favoritesLoadError)} Последний загруженный список избранного был пуст.</div>`
      : '';
    const retry = state.favoritesLoadError
      ? '<button id="favoritesEmptyRetry" class="secondary-btn" type="button">Обновить</button>'
      : '';
    el.innerHTML = `${warning}<div class="empty compact-empty profile-empty-state">
      <strong>Избранных команд пока нет</strong>
      <p>Добавьте команду звёздочкой в списке матчей.</p>
      <div class="empty-actions">${retry}<button id="favoritesEmptyMatches" class="secondary-btn" type="button">Перейти к матчам</button></div>
    </div>`;
    $('favoritesEmptyRetry')?.addEventListener('click', loadFavorites);
    $('favoritesEmptyMatches')?.addEventListener('click', () => showView('matchesView'));
    return;
  }
  const staleNotice = state.favoritesLoadError ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.favoritesLoadError)} Показано последнее загруженное избранное.</div>` : '';
  el.innerHTML = staleNotice + state.favorites.map(x => `
    <div class="favorite-team-row">
      <button class="favorite-team-main team-open-link" type="button" data-open-team="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}" data-team-logo="${escapeHtml(x.teamLogo || '')}">
        ${x.teamLogo ? `<img src="${safeUrl(x.teamLogo)}" alt="">` : '<span class="team-placeholder">⚽</span>'}
        <strong>${escapeHtml(x.teamName)}</strong>
      </button>
      <button class="favorite-remove" type="button" data-team-id="${Number(x.teamId)}" data-team-name="${escapeHtml(x.teamName)}" ${state.favoriteMutations.has(Number(x.teamId)) ? 'disabled' : ''}>Удалить</button>
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

function searchTeamSummaryCard(team) {
  return `<button class="search-entity-summary search-team-summary" type="button" data-search-team="${Number(team.id)}" data-team-name="${escapeHtml(team.name || '')}" data-team-logo="${escapeHtml(team.logo || '')}" data-team-country="${escapeHtml(team.country || '')}" aria-label="Открыть ${escapeHtml(team.name || 'команду')}">
    <span class="discovery-team-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</span>
    <span><small>КОМАНДА НАЙДЕНА</small><strong>${escapeHtml(team.name || 'Команда')}</strong><em>${escapeHtml(team.country || '')}${team.national ? ' · сборная' : ''}</em></span>
    <b>Открыть →</b>
  </button>`;
}

function knownTeamSummaryCard(team) {
  return `<button class="search-entity-summary known-team-summary" type="button" data-known-team-query="${escapeHtml(team.name || '')}" aria-label="Повторить поиск ${escapeHtml(team.name || 'команды')}">
    <span class="discovery-team-logo">✓</span>
    <span><small>КЛУБ РАСПОЗНАН</small><strong>${escapeHtml(team.name || 'Команда')}</strong><em>${escapeHtml(team.country || '')} · источник пока не вернул календарь</em></span>
    <b>Повторить →</b>
  </button>`;
}

function searchCompetitionSummaryCard(comp) {
  return `<div class="search-entity-summary">
    <span class="discovery-team-logo">🏆</span>
    <span><small>ТУРНИР НАЙДЕН</small><strong>${escapeHtml(comp.shortName || comp.name || 'Турнир')}</strong><em>${escapeHtml(comp.country || '')}</em></span>
  </div>`;
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
  root.querySelectorAll?.('[data-known-team-query]').forEach(btn => btn.addEventListener('click', () => {
    const query=String(btn.dataset.knownTeamQuery || '').trim();
    const input=$('globalSearchInput');
    if (!query || !input) return;
    input.value=query;
    state.globalSearch.query=query;
    void runGlobalSearch();
  }));
}

function localDiscoveryResults(query) {
  const q = String(query || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!q) return { teams: [], competitions: [], matches: [] };
  const teams = new Map(), competitions = new Map(), matches = [];
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
    const mhay = `${m.home?.name || ''} ${m.away?.name || ''} ${m.league || ''} ${m.leagueOriginal || ''} ${m.country || ''}`.toLowerCase().replace(/ё/g, 'е');
    if (mhay.includes(q) && Number(m.fixtureId) > 0) matches.push(m);
  }
  return { teams: [...teams.values()].slice(0, 10), competitions: [...competitions.values()].slice(0, 8), matches: matches.slice(0, 20) };
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
    compEl.innerHTML = comps.length ? comps.map(m => `<button class="competition-shortcut" type="button" data-open-tournament="${Number(m.leagueId)}">${m.leagueLogo ? `<img src="${safeUrl(m.leagueLogo)}" alt="">` : '<span class="competition-logo-placeholder">🏆</span>'}<span><strong>${escapeHtml(m.leagueShort || m.league || 'Турнир')}</strong><small>${escapeHtml(m.country || '')}</small></span>${m.live ? '<b>ИДЁТ</b>' : ''}</button>`).join('') : '<div class="empty compact-empty">Сначала загрузите список матчей.</div>';
    compEl.querySelectorAll?.('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  }
  bindDiscoveryActions($('searchRecent'));
  bindDiscoveryActions($('searchFavorites'));
}

function russianCountLabel(value, one, few, many) {
  const n = Math.max(0, Math.trunc(Number(value) || 0));
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? few
      : many;
  return `${n} ${word}`;
}

function searchMatchCard(match) {
  const finished = Boolean(match?.finished);
  const primary=Boolean(match?.selection?.primary || Number(match?.fixtureId || 0)===Number(state.globalSearch.primaryFixtureId || 0));
  const live = Boolean(match?.live);
  const score = finished || live ? `${match?.score?.home ?? '—'} : ${match?.score?.away ?? '—'}` : '';
  const status = live ? (match.statusLabel || 'Матч идёт') : finished ? 'Завершён' : dateTime(match.date);
  const action = finished || live
    ? `<button class="search-match-action" type="button" data-search-center="${Number(match.fixtureId)}">${finished ? 'Итоги' : 'Центр матча'}</button>`
    : `<button class="search-match-action" type="button" data-search-fixture="${Number(match.fixtureId)}">Преданализ</button>`;
  const primaryLabel=primary ? `<div class="search-match-primary"><b>⭐ ОСНОВНОЙ МАТЧ</b><span>${escapeHtml(match?.selection?.reason || state.globalSearch.matchDiscovery?.primaryReason || 'Основной выбор FM AI для анализа')}</span></div>` : '';
  return `<article class="search-match-card ${live ? 'is-live' : finished ? 'is-finished' : 'is-upcoming'} ${primary ? 'is-primary' : ''}">${primaryLabel}
    <div class="search-match-meta"><span>${escapeHtml(match.league || match.competition?.name || 'Матч')}</span><small>${escapeHtml(status)}</small></div>
    <div class="search-match-teams">
      <span>${match.home?.logo ? `<img src="${safeUrl(match.home.logo)}" alt="">` : '⚽'}<strong>${escapeHtml(match.home?.name || 'Хозяева')}</strong></span>
      <b>${score || '—'}</b>
      <span>${match.away?.logo ? `<img src="${safeUrl(match.away.logo)}" alt="">` : '⚽'}<strong>${escapeHtml(match.away?.name || 'Гости')}</strong></span>
    </div>
    <div class="search-match-footer">${action}</div>
  </article>`;
}

function bindSearchMatchActions(root) {
  root?.querySelectorAll?.('[data-search-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.searchFixture), btn)));
  root?.querySelectorAll?.('[data-search-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.searchCenter), btn)));
}

function setGlobalSearchMode(mode) {
  state.globalSearch.mode = ['all','teams','competitions','upcoming','finished'].includes(mode) ? mode : 'all';
  document.querySelectorAll('[data-search-mode]').forEach(btn => {
    const active = btn.dataset.searchMode === state.globalSearch.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  renderGlobalSearch();
}

function renderGlobalSearch() {
  const query = String(state.globalSearch.query || '').trim();
  const wrap = $('searchResultsWrap'), out = $('searchResults'), meta = $('searchResultsMeta'), status = $('searchStatus');
  const searchButton = $('globalSearchBtn');
  if (searchButton) {
    searchButton.disabled = Boolean(state.globalSearch.loading);
    searchButton.textContent = state.globalSearch.loading ? 'Ищу…' : 'Найти';
  }
  if (!wrap || !out) return;
  document.querySelectorAll('[data-search-mode]').forEach(btn => {
    const active = btn.dataset.searchMode === state.globalSearch.mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (!query) {
    wrap.hidden = true;
    if (status) status.innerHTML = '';
    renderDiscoveryHome();
    return;
  }

  const local = localDiscoveryResults(query);
  const teams = mergeById(local.teams, state.globalSearch.remoteTeams, 'id');
  const knownTeams = state.globalSearch.knownTeams || [];
  const comps = mergeById(local.competitions, state.globalSearch.remoteCompetitions, 'leagueId');
  const matches = mergeById(state.globalSearch.remoteMatches, local.matches, 'fixtureId');
  const upcoming = matches.filter(x => !x.finished).sort((a,b) => Number(a?.selection?.rank || 999)-Number(b?.selection?.rank || 999) || Date.parse(a.date || 0)-Date.parse(b.date || 0));
  const finished = matches.filter(x => x.finished).sort((a,b) => Number(a?.selection?.rank || 999)-Number(b?.selection?.rank || 999) || Date.parse(b.date || 0)-Date.parse(a.date || 0));
  const mode = state.globalSearch.mode || 'all';

  wrap.hidden = false;
  if (meta) meta.textContent = `${russianCountLabel(teams.length || knownTeams.length, 'команда', 'команды', 'команд')} · ${russianCountLabel(comps.length, 'лига', 'лиги', 'лиг')} · ${russianCountLabel(matches.length, 'матч', 'матча', 'матчей')}`;
  if (status) {
    const resolvedNote = state.globalSearch.resolvedQuery
      ? `<div class="data-notice">🌍 Распознано глобально: <strong>${escapeHtml(state.globalSearch.resolvedQuery)}</strong></div>`
      : '';
    const discovery=state.globalSearch.matchDiscovery;
    const sourceNote = state.globalSearch.matchSourceTeam && matches.length
      ? discovery?.mode === 'recent'
        ? `<div class="data-notice">🕘 ${escapeHtml(state.globalSearch.matchSourceTeam)}: ближайших матчей сейчас нет — показываю последние завершённые игры.</div>`
        : `<div class="data-notice">⚽ Матчи: ${escapeHtml(state.globalSearch.matchSourceTeam)} · ближайшие и последние игры</div>`
      : '';
    const selectionNote = Number(state.globalSearch.primaryFixtureId || 0) && discovery?.primaryReason
      ? `<div class="data-notice primary-selection-note">⭐ FM AI выбрал основной матч: <strong>${escapeHtml(discovery.primaryReason)}</strong>.</div>`
      : '';
    const emptyCalendarNote = state.globalSearch.matchSourceTeam && discovery?.mode === 'empty'
      ? `<div class="data-notice">🗓 ${escapeHtml(state.globalSearch.matchSourceTeam)} найден. В окне ${Number(discovery.windowPastDays || 30)} дней назад / ${Number(discovery.windowFutureDays || 120)} дней вперёд календарь не вернулся — откройте карточку команды или повторите поиск позже.</div>`
      : '';
    const knownNote = !teams.length && knownTeams.length
      ? `<div class="data-notice">✅ Клуб распознан глобальным каталогом. Матчи появятся здесь, как только источник данных вернёт доступный календарь.</div>`
      : '';
    status.innerHTML = state.globalSearch.loading
      ? '<div class="data-notice">🔎 Ищу команды, лиги и матчи…</div>'
      : state.globalSearch.warning
        ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.globalSearch.warning)}</div>${resolvedNote}${knownNote}${selectionNote}${emptyCalendarNote}${sourceNote}`
        : `${resolvedNote}${knownNote}${selectionNote}${emptyCalendarNote}${sourceNote}`;
  }

  const sections = [];
  if ((mode === 'all' || mode === 'teams') && teams.length) {
    sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Команда</strong><span>${teams.length}</span></div><div class="search-entity-list">${teams.slice(0,5).map(searchTeamSummaryCard).join('')}</div></section>`);
  }
  if ((mode === 'all' || mode === 'teams') && !teams.length && knownTeams.length) {
    sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Распознано</strong><span>${knownTeams.length}</span></div><div class="search-entity-list">${knownTeams.slice(0,5).map(knownTeamSummaryCard).join('')}</div></section>`);
  }
  if ((mode === 'all' || mode === 'competitions') && comps.length) {
    sections.push(`<section class="panel search-result-block compact-entity-results"><div class="mini-section-head"><strong>Турнир</strong><span>${comps.length}</span></div><div class="search-entity-list">${comps.slice(0,3).map(searchCompetitionSummaryCard).join('')}</div></section>`);
  }
  if ((mode === 'all' || mode === 'upcoming') && upcoming.length) {
    sections.push(`<section class="panel search-result-block"><div class="mini-section-head"><strong>Предстоящие матчи</strong><span>${upcoming.length}</span></div><div class="search-match-list">${upcoming.slice(0,12).map(searchMatchCard).join('')}</div></section>`);
  }
  if ((mode === 'all' || mode === 'finished') && finished.length) {
    sections.push(`<section class="panel search-result-block"><div class="mini-section-head"><strong>Завершённые матчи</strong><span>${finished.length}</span></div><div class="search-match-list">${finished.slice(0,12).map(searchMatchCard).join('')}</div></section>`);
  }

  out.innerHTML = sections.join('') || `<div class="empty search-empty-state">
    <strong>Ничего не найдено в этом разделе</strong>
    <p>Попробуйте другое название команды или лиги либо переключите фильтр поиска.</p>
    <div class="empty-actions"><button id="searchEmptyAll" class="secondary-btn" type="button">Показать всё</button></div>
  </div>`;
  bindDiscoveryActions(out);
  bindSearchMatchActions(out);
  $('searchEmptyAll')?.addEventListener('click', () => setGlobalSearchMode('all'));
}

async function runGlobalSearch() {
  const input = $('globalSearchInput');
  const query = String(input?.value || '').trim();
  const seq = ++state.globalSearch.requestSeq;
  state.globalSearch.query = query;
  state.globalSearch.warning = '';
  state.globalSearch.resolvedQuery = '';
  state.globalSearch.remoteMatches = [];
  state.globalSearch.knownTeams = [];
  state.globalSearch.matchSourceTeam = '';
  state.globalSearch.matchDiscovery = null;
  state.globalSearch.primaryFixtureId = null;

  if (query.length < 2 || !runtimeAllows('searchEnabled')) {
    state.globalSearch.loading = false;
    state.globalSearch.remoteTeams = [];
    state.globalSearch.remoteCompetitions = [];
    if (!runtimeAllows('searchEnabled')) state.globalSearch.warning = 'Удалённый поиск временно приостановлен. Поиск по уже загруженным матчам остаётся доступен.';
    renderGlobalSearch();
    return;
  }

  state.globalSearch.loading = true;
  renderGlobalSearch();
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (seq !== state.globalSearch.requestSeq || query !== String(state.globalSearch.query || '').trim()) return;
    state.globalSearch.remoteTeams = data.teams || [];
    state.globalSearch.knownTeams = data.knownTeams || [];
    state.globalSearch.remoteCompetitions = data.competitions || [];
    state.globalSearch.resolvedQuery = data.resolvedQuery || '';
    state.globalSearch.remoteMatches = data.matches || [];
    state.globalSearch.matchSourceTeam = data.matchSource?.name || '';
    state.globalSearch.matchDiscovery = data.matchDiscovery || null;
    state.globalSearch.primaryFixtureId = Number(data.primaryFixtureId || data.matchDiscovery?.primaryFixtureId || 0) || null;
    state.globalSearch.warning = data.warning || data.hint || '';
    state.globalSearch.searchedAt = data.refreshedAt || new Date().toISOString();
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
  } catch (e) {
    if (seq !== state.globalSearch.requestSeq) return;
    state.globalSearch.warning = e.message;
  } finally {
    if (seq === state.globalSearch.requestSeq) {
      state.globalSearch.loading = false;
      renderGlobalSearch();
    }
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
  if (state.filter === 'top' && !state.matches.some(x => personalMatchInsight(x).recommended)) state.filter = 'all';
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
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const active = btn.dataset.filter === state.filter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const drawer = document.querySelector('.league-filter-drawer');
  if (drawer) {
    const leagueFilters = ['international', 'cups', 'england', 'spain', 'italy', 'germany', 'france'];
    const activeLeagueFilter = leagueFilters.includes(state.filter);
    drawer.classList.toggle('has-active-filter', activeLeagueFilter);
    const summaryValue = drawer.querySelector('summary span');
    const labels = {
      international: 'Международные',
      cups: 'Кубки',
      england: 'Англия',
      spain: 'Испания',
      italy: 'Италия',
      germany: 'Германия',
      france: 'Франция',
    };
    if (summaryValue) summaryValue.textContent = activeLeagueFilter ? labels[state.filter] : 'Выбрать';
  }
}

function normalizedSignalText(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function personalContextSignals() {
  const viewedTeams = new Set();
  const viewedLeagues = new Set();
  for (const item of state.history.slice(0, 20)) {
    const home = normalizedSignalText(item.homeName);
    const away = normalizedSignalText(item.awayName);
    const league = normalizedSignalText(item.leagueName);
    if (home) viewedTeams.add(home);
    if (away) viewedTeams.add(away);
    if (league) viewedLeagues.add(league);
  }
  return {
    favoriteTeams: favoriteSet(),
    viewedTeams,
    viewedLeagues,
    hasPersonalData: state.favorites.length > 0 || viewedTeams.size > 0,
  };
}

function personalMatchInsight(match, signals = personalContextSignals()) {
  const homeId = Number(match.home?.id || 0);
  const awayId = Number(match.away?.id || 0);
  const homeName = normalizedSignalText(match.home?.name);
  const awayName = normalizedSignalText(match.away?.name);
  const leagueName = normalizedSignalText(match.league || match.leagueOriginal);
  const favorite = signals.favoriteTeams.has(homeId) || signals.favoriteTeams.has(awayId);
  const viewedTeam = signals.viewedTeams.has(homeName) || signals.viewedTeams.has(awayName);
  const viewedLeague = signals.viewedLeagues.has(leagueName);
  let score = Math.min(34, Number(match.interestScore || 0) * .34) + Math.min(26, Number(match.competition?.priority || 0) * 3);
  if (favorite) score += 150;
  if (viewedTeam) score += 72;
  else if (viewedLeague) score += 18;
  if (match.live) score += 48;
  if (match.featured) score += 34;
  if (match.lowPriority) score -= 55;
  if (match.youthReserve) score -= 80;

  let reason = '';
  if (favorite) reason = 'Любимая команда';
  else if (viewedTeam) reason = 'Вы смотрели эту команду';
  else if (match.live) reason = 'Сейчас в эфире';
  else if (match.featured) reason = 'Главный матч';
  else if (viewedLeague) reason = 'Знакомый турнир';
  else if (Number(match.interestScore || 0) >= 80) reason = 'Высокий интерес';

  const baseline = Boolean(match.featured) || (Number(match.interestScore || 0) >= 68 && !match.lowPriority);
  const recommended = signals.hasPersonalData
    ? Boolean(favorite || viewedTeam || match.live || match.featured || (!match.lowPriority && Number(match.interestScore || 0) >= 74))
    : baseline;
  return { score, reason, favorite, viewedTeam, viewedLeague, recommended };
}

function renderDailyOverview() {
  const title = $('dailyOverviewTitle');
  const text = $('dailyOverviewText');
  const kicker = $('dailyOverviewKicker');
  if (!title || !text) return;
  if (kicker) kicker.textContent = state.offset < 0 ? 'ВЧЕРА ДЛЯ ВАС' : state.offset > 0 ? 'ЗАВТРА ДЛЯ ВАС' : 'СЕГОДНЯ ДЛЯ ВАС';
  const favorites = favoriteSet();
  const visible = state.matches.filter(match => state.preferences?.hideYouth === false || !match.youthReserve);
  const live = visible.filter(match => match.live).length;
  const favoriteMatches = visible.filter(match => favorites.has(Number(match.home?.id)) || favorites.has(Number(match.away?.id))).length;
  const signals = personalContextSignals();
  const recommended = visible.filter(match => personalMatchInsight(match, signals).recommended).length;
  if ($('overviewLiveCount')) $('overviewLiveCount').textContent = String(live);
  if ($('overviewFavoriteCount')) $('overviewFavoriteCount').textContent = String(favoriteMatches);
  if ($('overviewRecommendedCount')) $('overviewRecommendedCount').textContent = String(recommended);
  if (live > 0) {
    title.textContent = 'Сейчас в эфире';
    text.textContent = favoriteMatches ? `И ещё ${russianCountLabel(favoriteMatches, 'матч любимой команды', 'матча любимых команд', 'матчей любимых команд')} в вашем списке.` : `${russianCountLabel(recommended, 'рекомендация собрана', 'рекомендации собраны', 'рекомендаций собрано')} для вас.`;
  } else if (favoriteMatches > 0) {
    title.textContent = 'Матчи ваших команд';
    text.textContent = `${russianCountLabel(favoriteMatches, 'важный матч', 'важных матча', 'важных матчей')} — без поиска по всему расписанию.`;
  } else if (visible.length > 0) {
    title.textContent = 'Рекомендации для вас';
    text.textContent = `${russianCountLabel(recommended, 'матч подобран', 'матча подобраны', 'матчей подобрано')} из ${visible.length} доступных — с учётом ваших интересов.`;
  } else {
    title.textContent = 'Матчи скоро появятся';
    text.textContent = 'Свежие матчи появятся здесь сразу после загрузки.';
  }
}

function filteredMatches() {
  const q = state.search.trim().toLowerCase();
  const fav = favoriteSet();
  const prefs = state.preferences || {};
  const signals = personalContextSignals();
  const list = state.matches.filter(m => {
    const isFavMatch = fav.has(Number(m.home?.id)) || fav.has(Number(m.away?.id));
    if (prefs.hideYouth !== false && m.youthReserve && state.filter !== 'favorites') return false;
    let byFilter = state.filter === 'all';
    if (state.filter === 'top') byFilter = personalMatchInsight(m, signals).recommended;
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
    if (state.filter === 'top') {
      const personalDelta = personalMatchInsight(b, signals).score - personalMatchInsight(a, signals).score;
      if (personalDelta) return personalDelta;
    }
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
    return `${m.score?.home ?? 0}:${m.score?.away ?? 0} · идёт матч${minute}`;
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
    .slice(0, 5);
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
      ${m.live ? '<b>ИДЁТ</b>' : ''}
    </button>`).join('');
  el.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
}

function matchCardHtml(m, { grouped = false } = {}) {
  const interest = Math.max(0, Math.min(100, Number(m.interestScore || 0)));
  const aiHistory = analysisHistoryForFixture(m.fixtureId);
  const cardState = m.live ? 'is-live' : m.finished ? 'is-finished' : 'is-upcoming';
  const personalInsight = personalMatchInsight(m);
  const signal = state.filter === 'top' && personalInsight.reason
    ? personalInsight.reason
    : m.featured ? 'Матч дня' : interest >= 80 ? 'Высокий интерес' : interest >= 65 ? 'Стоит внимания' : '';
  const signalIcon = personalInsight.favorite ? '★' : personalInsight.viewedTeam ? '↺' : m.live ? '●' : m.featured ? '✦' : '🔥';
  const reminderActive = hasReminder(m.fixtureId);
  const reminderPending = state.reminderMutations.has(Number(m.fixtureId));
  const reminderMinutes = Number(state.preferences?.reminderMinutes || 30);
  return `
    <article class="match-card ${Number(m.interestScore || 0) >= 50 ? 'top-match' : ''} ${cardState}">
      ${grouped ? '' : `<div class="match-meta"><span class="competition-name">${m.featured ? '<b class="top-tag">ГЛАВНЫЙ</b> ' : ''}${escapeHtml(m.league || 'Турнир')}</span><span>${escapeHtml(m.country || '')}</span></div>`}
      <div class="catalog-row">
        ${m.category ? `<span class="competition-chip ${categoryClass(m.category)}">${escapeHtml(categoryLabel(m.category))}</span>` : ''}
        ${m.roundLabel ? `<span class="round-chip">${escapeHtml(m.roundLabel)}</span>` : ''}
        ${signal ? `<span class="match-signal ${personalInsight.favorite ? 'favorite-signal' : ''}">${signalIcon} ${signal}</span>` : ''}
        ${m.integrity?.state === 'warning' ? '<span class="integrity-mini warning">⚠ проверяем данные</span>' : ''}
      </div>
      ${matchAiSnapshotHtml(m)}
      <div class="team-row">
        <div class="team">
          <button class="fav-star ${isFavorite(m.home?.id) ? 'active' : ''} ${state.favoriteMutations.has(Number(m.home?.id)) ? 'is-pending' : ''}" type="button" data-team-id="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-pressed="${isFavorite(m.home?.id) ? 'true' : 'false'}" aria-label="${isFavorite(m.home?.id) ? 'Удалить из избранного' : 'Добавить в избранное'}: ${escapeHtml(m.home?.name || '')}" ${state.favoriteMutations.has(Number(m.home?.id)) ? 'disabled' : ''}>${isFavorite(m.home?.id) ? '★' : '☆'}</button>
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
          <button class="fav-star ${isFavorite(m.away?.id) ? 'active' : ''} ${state.favoriteMutations.has(Number(m.away?.id)) ? 'is-pending' : ''}" type="button" data-team-id="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-pressed="${isFavorite(m.away?.id) ? 'true' : 'false'}" aria-label="${isFavorite(m.away?.id) ? 'Удалить из избранного' : 'Добавить в избранное'}: ${escapeHtml(m.away?.name || '')}" ${state.favoriteMutations.has(Number(m.away?.id)) ? 'disabled' : ''}>${isFavorite(m.away?.id) ? '★' : '☆'}</button>
        </div>
      </div>
      <div class="match-card-actions ${m.live || m.finished ? 'single' : ''}">
        ${m.live
          ? `<button class="analyze-btn live-center-btn" type="button" data-center="${Number(m.fixtureId)}">${m.youthReserve ? '🔴 Счёт матча' : '🔴 Центр матча'}</button>`
          : m.finished
            ? `<button class="analyze-btn finished-btn" type="button" data-center="${Number(m.fixtureId)}">📋 Итоги матча</button>`
            : aiHistory
              ? `<button class="analyze-btn analyzed-btn" type="button" data-history-analysis="${Number(m.fixtureId)}">🧠 Открыть AI-разбор</button>`
              : `<button class="analyze-btn" type="button" data-fixture="${Number(m.fixtureId)}">🧠 Предматчевый анализ</button>`}
        ${!m.live && !m.finished ? `<button class="quick-reminder-btn ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" data-quick-reminder="${Number(m.fixtureId)}" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderActive ? '🔔 Напоминание включено' : `🔔 Напомнить за ${reminderMinutes} мин.`}</button>` : ''}
      </div>
    </article>`;
}

function bindMatchActions(root = document) {
  root.querySelectorAll('.analyze-btn[data-fixture]').forEach(btn => {
    btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn));
  });
  root.querySelectorAll('.analyze-btn[data-center]').forEach(btn => {
    btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn));
  });
  root.querySelectorAll('.analyze-btn[data-history-analysis]').forEach(btn => {
    btn.addEventListener('click', () => openHistoryAnalysis(Number(btn.dataset.historyAnalysis), btn));
  });
  root.querySelectorAll('.fav-star').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
    id: Number(btn.dataset.teamId), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '',
  })));
  root.querySelectorAll('[data-quick-reminder]').forEach(btn => btn.addEventListener('click', () => {
    const fixtureId = Number(btn.dataset.quickReminder);
    const match = state.matches.find(item => Number(item.fixtureId) === fixtureId);
    if (match) toggleReminder(match);
  }));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournament(Number(btn.dataset.openTournament))));
  root.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}


function analysisHistoryForFixture(fixtureId) {
  const id = Number(fixtureId || 0);
  if (!id) return null;
  return state.history.find(item => Number(item.fixtureId) === id && item.aiSignalLabel) || null;
}

function matchAiSnapshotHtml(match) {
  const item = analysisHistoryForFixture(match?.fixtureId);
  if (!item) return '';
  const skip = item.aiSignalCode === 'skip';
  const confidence = Number.isFinite(Number(item.aiConfidence)) ? `${Math.round(Number(item.aiConfidence))}/100` : '—';
  return `<div class="match-ai-snapshot ${skip ? 'skip' : 'active'}"><span>AI</span><strong>${escapeHtml(item.aiSignalLabel || 'Разбор готов')}</strong><small>${item.aiOutcome ? `Исход ${escapeHtml(item.aiOutcome)} · ` : ''}уверенность ${confidence}${item.aiRisk ? ` · риск ${escapeHtml(String(item.aiRisk).toLowerCase())}` : ''}</small></div>`;
}

function renderAiCenterSummary() {
  const wrap = $('aiCenterSummary');
  if (!wrap) return;
  const upcoming = state.matches.filter(m => !m.live && !m.finished);
  const analyzed = upcoming.map(match => ({ match, history:analysisHistoryForFixture(match.fixtureId) })).filter(x => x.history);
  if (!analyzed.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  const signals = analyzed.filter(x => x.history.aiSignalCode !== 'skip');
  const skips = analyzed.filter(x => x.history.aiSignalCode === 'skip');
  const highRisk = analyzed.filter(x => String(x.history.aiRisk || '').toLowerCase() === 'высокий');
  const strongest = [...signals].sort((a,b) => Number(b.history.aiConfidence || 0) - Number(a.history.aiConfidence || 0))[0] || null;
  const cautionPool = [...skips, ...highRisk.filter(x => !skips.some(s => Number(s.match.fixtureId) === Number(x.match.fixtureId)))];
  const caution = cautionPool.sort((a,b) => {
    const aSkip = a.history.aiSignalCode === 'skip' ? 1 : 0;
    const bSkip = b.history.aiSignalCode === 'skip' ? 1 : 0;
    return bSkip - aSkip || Number(a.history.aiConfidence || 0) - Number(b.history.aiConfidence || 0);
  })[0] || null;
  const featureButton = (item, kind) => {
    if (!item) return '';
    const h = item.history, m = item.match;
    const label = kind === 'caution' ? '⚠️ Лучше пропустить' : '🧠 Сильнейший разбор';
    const featureClass = kind === 'caution' ? 'ai-center-feature caution' : 'ai-center-feature';
    const detail = kind === 'caution'
      ? `${escapeHtml(h.aiSignalLabel || 'Высокий риск')} · ${escapeHtml(h.aiRisk || 'риск повышен')}`
      : `${escapeHtml(h.aiSignalLabel || 'AI-разбор')} · уверенность ${Math.round(Number(h.aiConfidence || 0))}/100`;
    return `<button class="${featureClass}" type="button" data-ai-center-history="${Number(m.fixtureId)}"><span>${label}</span><strong>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</strong><small>${detail}</small></button>`;
  };
  wrap.hidden = false;
  wrap.innerHTML = `<div class="ai-center-head"><div><span>AI-ЦЕНТР</span><strong>Уже разобранные матчи</strong></div><small>Повторное открытие не тратит новый анализ</small></div><div class="ai-center-metrics"><div><b>${signals.length}</b><span>сигналов</span></div><div><b>${skips.length}</b><span>лучше пропустить</span></div><div><b>${highRisk.length}</b><span>высокий риск</span></div></div><div class="ai-center-features">${featureButton(strongest,'strong')}${featureButton(caution,'caution')}</div>`;
  wrap.querySelectorAll('[data-ai-center-history]').forEach(button => button.addEventListener('click', event => openHistoryAnalysis(Number(event.currentTarget.dataset.aiCenterHistory), event.currentTarget)));
}
function renderAiFocus() {
  const wrap = $('aiFocus');
  if (!wrap) return;
  const signals = personalContextSignals();
  const candidates = state.matches
    .filter(m => !m.live && !m.finished && !m.youthReserve)
    .map(m => ({ match:m, insight:personalMatchInsight(m, signals) }))
    .sort((a,b) => b.insight.score - a.insight.score || Number(b.match.interestScore || 0) - Number(a.match.interestScore || 0));
  if (!candidates.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
  const preferred = candidates.filter(x => x.insight.recommended);
  const ranked = (preferred.length ? preferred : candidates).slice(0,3);
  const rowHtml = (item, index) => {
    const m = item.match;
    const saved = analysisHistoryForFixture(m.fixtureId);
    const reason = item.insight.reason || (m.featured ? 'Главный матч дня' : Number(m.interestScore || 0) >= 75 ? 'Высокий интерес' : 'Подходит по контексту');
    const action = saved
      ? `<button type="button" data-ai-rank-history="${Number(m.fixtureId)}">Открыть разбор</button>`
      : `<button type="button" data-ai-rank-fixture="${Number(m.fixtureId)}" data-ai-focus-fixture="${Number(m.fixtureId)}">Разобрать</button>`;
    return `<article class="ai-rank-row"><b class="ai-rank-number">${index + 1}</b><div class="ai-rank-teams">${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.home?.name || '')} — ${escapeHtml(m.away?.name || '')}</strong><small>${escapeHtml(reason)} · ${timeOf(m.date)}${m.league ? ` · ${escapeHtml(m.league)}` : ''}</small></div>${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span>⚽</span>'}</div>${action}</article>`;
  };
  wrap.hidden = false;
  wrap.innerHTML = `<div class="ai-rank-head"><div><span>AI-РЕЙТИНГ ДНЯ</span><strong>Матчи, которые заслуживают внимания</strong></div><small>Рейтинг по интересу, избранному и вашей истории. Это ещё не прогноз исхода. Полный вывод появится после анализа.</small></div><div class="ai-rank-list">${ranked.map(rowHtml).join('')}</div>`;
  wrap.querySelectorAll('[data-ai-rank-fixture]').forEach(button => button.addEventListener('click', event => analyzeMatch(Number(event.currentTarget.dataset.aiRankFixture), event.currentTarget)));
  wrap.querySelectorAll('[data-ai-rank-history]').forEach(button => button.addEventListener('click', event => openHistoryAnalysis(Number(event.currentTarget.dataset.aiRankHistory), event.currentTarget)));
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
    Number(catalog.live || 0) > 0 ? `<span class="summary-pill live"><b>${Number(catalog.live)}</b> сейчас идут</span>` : '',
    age ? `<span class="summary-pill muted-pill">↻ ${escapeHtml(age)}</span>` : '',
  ].filter(Boolean);
  $('matchesCount').innerHTML = summaryBits.join('');
  renderDailyOverview();
  renderAiFocus();
  renderAiCenterSummary();
  renderPopularCompetitions();
  if ($('dataNotice')) {
    const notices = [];
    if (state.matchesMeta?.stale) notices.push(`<div class="data-notice stale">⚠️ ${escapeHtml(state.matchesMeta.warning || 'Показаны последние сохранённые данные.')}</div>`);
    if (Number(integrity.quarantined || 0) > 0) notices.push('<div class="data-notice integrity-notice">🛡️ Несколько матчей временно скрыты, пока мы проверяем данные.</div>');
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
        <span class="competition-group-count">${liveCount ? `<b>${liveCount} сейчас</b>` : ''}<small>${russianCountLabel(rows.length, 'матч', 'матча', 'матчей')}</small><i>›</i></span>
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
      <div><span>Сейчас идут</span><strong>${live}</strong></div>
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
      <p class="tiny table-note">Таблица загружается только при открытии этой вкладки и сохраняется на 6 часов, чтобы не расходовать бесплатную квоту источника данных.</p>
    </section>`).join('')}`;
  el.querySelectorAll('[data-open-team]').forEach(btn => btn.addEventListener('click', () => openTeam({ id: Number(btn.dataset.openTeam), name: btn.dataset.teamName || '', logo: btn.dataset.teamLogo || '' })));
}

async function loadTournamentStandings(force = false) {
  const t = state.currentTournament;
  if (!t) return;
  const key = tournamentKey(t);
  const seq = ++state.tournamentStandingsRequestSeq;
  const el = $('tournamentTable');
  if (!force && state.tournamentStandings.has(key)) {
    if (key === tournamentKey(state.currentTournament)) renderTournamentStandings(state.tournamentStandings.get(key));
    return;
  }
  el.innerHTML = '<div class="loader">Загружаю таблицу турнира…</div>';
  try {
    const data = await api(`/api/tournament?leagueId=${Number(t.leagueId)}&season=${Number(t.season)}`);
    state.tournamentStandings.set(key, data);
    if (seq !== state.tournamentStandingsRequestSeq || key !== tournamentKey(state.currentTournament)) return;
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    renderTournamentStandings(data);
  } catch (e) {
    if (seq !== state.tournamentStandingsRequestSeq || key !== tournamentKey(state.currentTournament)) return;
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
  const buttons = [...document.querySelectorAll('.tournament-tab')];
  const panels = [['tournamentMatchesPanel', 'matches'], ['tournamentTablePanel', 'table']];
  buttons.forEach(btn => {
    const active = btn.dataset.tournamentTab === tab;
    const name = btn.dataset.tournamentTab || 'matches';
    btn.id = `tournament-tab-${name}`;
    btn.classList.toggle('active', active);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `tournament-panel-${name}`);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });
  panels.forEach(([id, key]) => {
    const panel = $(id);
    if (!panel) return;
    const active = tab === key;
    panel.id = `tournament-panel-${key}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.toggleAttribute('inert', !active);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tournament-tab-${key}`);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (tab === 'table' && load) loadTournamentStandings(false);
}


function activeViewId() { return document.querySelector('.view.active')?.id || 'matchesView'; }
function teamResultBadge(result) {
  const r = String(result || '').toUpperCase();
  if (!['W','D','L'].includes(r)) return '';
  return `<span class="team-result ${r === 'W' ? 'win' : r === 'D' ? 'draw' : 'loss'}">${r === 'W' ? 'В' : r === 'D' ? 'Н' : 'П'}</span>`;
}
function teamMatchRow(m) {
  const center = m.live ? `<button class="mini-match-action live" type="button" data-center="${Number(m.fixtureId)}">Сейчас</button>` : m.finished ? `<span class="team-score">${m.score?.home ?? '—'} : ${m.score?.away ?? '—'}</span>` : `<button class="mini-match-action" type="button" data-fixture="${Number(m.fixtureId)}">Анализ</button>`;
  return `<article class="team-fixture-row"><div class="team-fixture-date"><strong>${escapeHtml(dateTime(m.date))}</strong><small>${escapeHtml(m.roundLabel || m.league || '')}</small></div><div class="team-fixture-opponent">${m.opponent?.logo ? `<img src="${safeUrl(m.opponent.logo)}" alt="">` : '<span>⚽</span>'}<div><strong>${escapeHtml(m.opponent?.name || '')}</strong><small>${m.venue === 'home' ? 'Дома' : 'В гостях'} · ${escapeHtml(m.league || '')}</small></div></div><div class="team-fixture-outcome">${teamResultBadge(m.result)}${center}</div></article>`;
}
function bindTeamFixtureActions(root) {
  root.querySelectorAll('[data-fixture]').forEach(btn => btn.addEventListener('click', () => analyzeMatch(Number(btn.dataset.fixture), btn)));
  root.querySelectorAll('[data-center]').forEach(btn => btn.addEventListener('click', () => openMatchCenter(Number(btn.dataset.center), btn)));
  root.querySelectorAll('[data-open-tournament]').forEach(btn => btn.addEventListener('click', () => openTournamentFromTeam(false)));
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
      <p class="tiny">Данные этой вкладки загружаются только при открытии и сохраняются на 6 часов.</p>
    </section>`;
}
async function loadTeamIntelligence(force=false) {
  const team=state.currentTeam, comp=team?.data?.primaryCompetition, el=$('teamIntelligence');
  if(!team?.id || !el) return;
  if(!comp?.leagueId || !comp?.season){ el.innerHTML='<div class="empty compact-empty">Сначала нужно определить основной турнир команды.</div>'; return; }
  const key=`${Number(team.id)}:${Number(comp.leagueId)}:${Number(comp.season)}`;
  const seq=++state.teamIntelligenceRequestSeq;
  if(!force && state.teamIntelligenceCache.has(key)){
    if(Number(state.currentTeam?.id)===Number(team.id)) renderTeamIntelligence(state.teamIntelligenceCache.get(key));
    return;
  }
  el.innerHTML='<div class="loader">Загружаю сезонную статистику…</div>';
  const q=new URLSearchParams({teamId:String(Number(team.id)),leagueId:String(Number(comp.leagueId)),season:String(Number(comp.season)),teamName:team.name||'',teamLogo:team.logo||'',leagueName:comp.name||'',leagueLogo:comp.logo||'',country:comp.country||''});
  try{
    const data=await api(`/api/team/intelligence?${q.toString()}`);
    state.teamIntelligenceCache.set(key,data);
    if(seq!==state.teamIntelligenceRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
    if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
    renderTeamIntelligence(data);
  }catch(e){
    if(seq!==state.teamIntelligenceRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
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
  el.innerHTML=`${warning}<section class="panel squad-summary-panel"><div class="mini-section-head"><strong>👥 Состав команды</strong><span>${Number(sm.total||0)} игроков</span></div><div class="squad-summary-grid"><div><span>Средний возраст</span><strong>${sm.averageAge??'—'}</strong></div><div><span>Вратари</span><strong>${Number(sm.goalkeepers||0)}</strong></div><div><span>Защитники</span><strong>${Number(sm.defenders||0)}</strong></div><div><span>Полузащитники</span><strong>${Number(sm.midfielders||0)}</strong></div><div><span>Нападающие</span><strong>${Number(sm.attackers||0)}</strong></div></div></section>${data.groups.map(group=>`<section class="panel squad-group"><div class="mini-section-head"><strong>${escapeHtml(group.label||'Игроки')}</strong><span>${group.players?.length||0}</span></div><div class="squad-player-grid">${(group.players||[]).map(playerCard).join('')}</div></section>`).join('')}<p class="tiny squad-cache-note">Состав загружается только при открытии вкладки и сохраняется на 12 часов. Статистика отдельных игроков будет подключена после перехода на расширенный тариф источника данных.</p>`;
}
async function loadTeamSquad(force=false) {
  const team=state.currentTeam, el=$('teamSquad'); if(!team?.id||!el) return;
  const key=String(Number(team.id));
  const seq=++state.teamSquadRequestSeq;
  if(!force&&state.teamSquadCache.has(key)){
    if(Number(state.currentTeam?.id)===Number(team.id)) renderTeamSquad(state.teamSquadCache.get(key));
    return;
  }
  el.innerHTML='<div class="loader">Загружаю состав…</div>';
  try{
    const data=await api(`/api/team/squad?teamId=${Number(team.id)}`);
    state.teamSquadCache.set(key,data);
    if(seq!==state.teamSquadRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
    if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
    renderTeamSquad(data);
  }catch(e){
    if(seq!==state.teamSquadRequestSeq || Number(state.currentTeam?.id)!==Number(team.id)) return;
    const cached=state.teamSquadCache.get(key);
    if(cached){renderTeamSquad(cached);el.insertAdjacentHTML('afterbegin',`<div class="data-notice stale">⚠️ ${escapeHtml(e.message)} Показан сохранённый состав.</div>`);}
    else{el.innerHTML=recoveryCardHtml({title:'Состав временно недоступен',message:e.message,retryId:'teamSquadRetry',compact:true});$('teamSquadRetry')?.addEventListener('click',()=>loadTeamSquad(true));}
  }
}

function renderTeamHub(data) {
  const team = data?.team || state.currentTeam || {}; state.currentTeam = { ...state.currentTeam, ...team, data };
  const fav = isFavorite(team.id), favoritePending = state.favoriteMutations.has(Number(team.id)), comp = data?.primaryCompetition, standing = data?.standing, form = data?.form, next = data?.liveNow || data?.nextMatch;
  const stale = data?.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(data.warning || 'Показаны сохранённые данные команды.')}</div>` : '';
  $('teamHero').innerHTML = `${stale}<section class="panel team-hero"><div class="team-hero-main"><div class="team-hero-logo">${team.logo ? `<img src="${safeUrl(team.logo)}" alt="">` : '⚽'}</div><div class="team-hero-copy"><span>СТРАНИЦА КОМАНДЫ</span><h2>${escapeHtml(team.name || 'Команда')}</h2><p>${comp ? `${escapeHtml(comp.name)} · ${escapeHtml(comp.country || '')}` : 'Турнир определяется по последним матчам'}</p></div><button id="teamFavoriteBtn" class="team-favorite-big ${fav ? 'active' : ''} ${favoritePending ? 'is-pending' : ''}" type="button" data-team-id="${Number(team.id)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'Удалить команду из избранного' : 'Добавить команду в избранное'}" ${favoritePending ? 'disabled' : ''}>${fav ? '★' : '☆'}</button></div><div class="team-hero-stats"><div><span>Форма</span><strong>${form?.form ? escapeHtml(form.form.replace(/W/g,'В').replace(/D/g,'Н').replace(/L/g,'П')) : '—'}</strong></div><div><span>Очки / матч</span><strong>${form?.ppg ?? '—'}</strong></div><div><span>Голы</span><strong>${form ? `${form.gfAvg} / ${form.gaAvg}` : '—'}</strong></div><div><span>Место</span><strong>${standing?.rank ? `${standing.rank}` : '—'}</strong></div></div>${comp ? `<button id="teamTournamentBtn" class="secondary-btn team-tournament-btn" type="button">🏆 ${escapeHtml(comp.shortName || comp.name)} · открыть турнир</button>` : ''}</section>`;
  $('teamFavoriteBtn')?.addEventListener('click', async () => { await toggleFavorite({ id:Number(team.id), name:team.name||'', logo:team.logo||'' }); renderTeamHub(state.currentTeam?.data || data); });
  $('teamTournamentBtn')?.addEventListener('click', () => openTournamentFromTeam(false));
  const formHtml = form ? `<section class="panel team-form-panel"><h2>📈 Последние ${russianCountLabel(form.sample || 0, 'матч', 'матча', 'матчей')}</h2><div class="team-form-line">${String(form.form || '').split('').map(teamResultBadge).join('')}</div><div class="team-kpi-grid"><div><span>Победы</span><strong>${Number(form.wins||0)}</strong></div><div><span>Ничьи</span><strong>${Number(form.draws||0)}</strong></div><div><span>Поражения</span><strong>${Number(form.losses||0)}</strong></div><div><span>Забивает</span><strong>${form.gfAvg ?? '—'}</strong></div><div><span>Пропускает</span><strong>${form.gaAvg ?? '—'}</strong></div><div><span>ОЗ</span><strong>${form.bttsPct ?? '—'}%</strong></div></div></section>` : '<section class="panel"><div class="empty compact-empty">Пока недостаточно завершённых матчей для формы.</div></section>';
  const nextHtml = next ? `<section class="panel next-team-match"><div class="mini-section-head"><strong>${next.live ? '🔴 Матч идёт' : '⏭ Ближайший матч'}</strong><span>${escapeHtml(dateTime(next.date))}</span></div>${teamMatchRow(next)}</section>` : '<section class="panel"><div class="empty compact-empty">Ближайший матч в доступном окне не найден.</div></section>';
  const positionHtml = standing ? `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><div class="team-standing-summary"><strong>${Number(standing.rank)} место</strong><span>${Number(standing.points)} очков · ${russianCountLabel(standing.played, 'матч', 'матча', 'матчей')} · ${Number(standing.goalsFor)}:${Number(standing.goalsAgainst)}</span></div></section>` : `<section class="panel team-standing-card"><h2>🏆 Положение в турнире</h2><p class="muted">Позиция появится после загрузки таблицы турнира. Так мы не делаем отдельный запрос к источнику данных автоматически.</p>${comp ? '<button id="teamStandingTableBtn" class="secondary-btn" type="button">Открыть турнирную таблицу</button>' : ''}</section>`;
  $('teamOverview').innerHTML = `${nextHtml}${formHtml}${positionHtml}`;
  bindTeamFixtureActions($('teamOverview'));
  $('teamStandingTableBtn')?.addEventListener('click', () => openTournamentFromTeam(true));
  $('teamResults').innerHTML = data?.recent?.length ? `<div class="team-fixtures-list">${data.recent.map(teamMatchRow).join('')}</div>` : '<div class="empty">Завершённых матчей в доступном окне нет.</div>';
  $('teamSchedule').innerHTML = data?.upcoming?.length ? `<div class="team-fixtures-list">${data.upcoming.map(teamMatchRow).join('')}</div>` : '<div class="empty">Предстоящих матчей в доступном окне нет.</div>';
  bindTeamFixtureActions($('teamResults')); bindTeamFixtureActions($('teamSchedule'));
}
async function loadTeamHub(team, force=false) {
  const key=String(Number(team?.id||0)); if (!key || key==='0') return;
  const seq=++state.teamHubRequestSeq;
  const cached=state.teamCache.get(key);
  if (cached && !force) {
    if(String(Number(state.currentTeam?.id||0))===key) renderTeamHub(cached);
    return;
  }
  if (!cached && String(Number(state.currentTeam?.id||0))===key) {
    $('teamHero').innerHTML='<div class="loader">Загружаю страницу команды…</div>'; $('teamOverview').innerHTML=''; $('teamIntelligence').innerHTML='<div class="empty compact-empty">Откройте вкладку «Статистика», чтобы загрузить сезонные данные.</div>'; $('teamSquad').innerHTML='<div class="empty compact-empty">Откройте вкладку «Состав», чтобы загрузить игроков.</div>'; $('teamResults').innerHTML=''; $('teamSchedule').innerHTML='';
  }
  try {
    const q=new URLSearchParams({teamId:String(Number(team.id)),name:team.name||'',logo:team.logo||''});
    const data=await api(`/api/team?${q.toString()}`);
    state.teamCache.set(key,data);
    if(seq!==state.teamHubRequestSeq || String(Number(state.currentTeam?.id||0))!==key) return;
    if(isAdmin() && data.provider?.visibility==='admin'){state.provider=data.provider;renderProvider();}
    renderTeamHub(data);
  } catch(e) {
    if(seq!==state.teamHubRequestSeq || String(Number(state.currentTeam?.id||0))!==key) return;
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
  const buttons = [...document.querySelectorAll('.team-tab')];
  buttons.forEach(btn => {
    const active = btn.dataset.teamTab === tab;
    const name = btn.dataset.teamTab || 'overview';
    btn.id = `team-tab-${name}`;
    btn.classList.toggle('active', active);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `team-panel-${name}`);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });
  const panels = [
    ['teamOverviewPanel', 'overview'],
    ['teamIntelligencePanel', 'intelligence'],
    ['teamSquadPanel', 'squad'],
    ['teamResultsPanel', 'results'],
    ['teamSchedulePanel', 'schedule'],
  ];
  panels.forEach(([id, key]) => {
    const panel = $(id);
    if (!panel) return;
    const active = tab === key;
    panel.id = `team-panel-${key}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.toggleAttribute('inert', !active);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `team-tab-${key}`);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if(tab==='intelligence') loadTeamIntelligence(false);
  if(tab==='squad') loadTeamSquad(false);
}
function openTournamentFromTeam(openTable = false) {
  state.tournamentBackView = 'teamView';
  const comp=state.currentTeam?.data?.primaryCompetition;
  if(!comp?.leagueId) return toast('Основной турнир команды пока не определён.');
  const existing=state.matches.find(m=>Number(m.leagueId)===Number(comp.leagueId));
  if(existing) {
    openTournament(Number(comp.leagueId));
    if (openTable) setTournamentTab('table', true);
    return;
  }
  state.currentTournament={leagueId:Number(comp.leagueId),season:Number(comp.season||new Date().getFullYear()),name:comp.name||'Турнир',shortName:comp.shortName||comp.name||'Турнир',country:comp.country||'',logo:comp.logo||'',category:comp.category||'',tier:comp.tier||'standard'};
  renderTournamentHero();
  renderTournamentMatches();
  setTournamentTab('table', true);
  showView('tournamentView');
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
    ${items.map(x => `<div class="live-stat-row"><strong>${statValue(x.home)}</strong><span>${escapeHtml(publicText(x.label))}</span><strong>${statValue(x.away)}</strong></div>`).join('')}
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

async function requestMatchCenter(fixtureId, extraParams = {}, options = {}) {
  const seq = ++state.matchCenterRequestSeq;
  const params = new URLSearchParams({ fixtureId: String(Number(fixtureId)) });
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const data = await api(`/api/match-center?${params.toString()}`, options);
  return seq === state.matchCenterRequestSeq ? data : null;
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
    if (el) el.textContent = 'Автообновление матча временно приостановлено.';
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
        const data = await requestMatchCenter(fixtureId, { t: Date.now() });
        if (!data) return;
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
  if (!move?.baseline || !move?.probabilityChange) return '<p class="muted">История движения появится после нескольких снимков во время матча.</p>';
  const row = (label, key) => {
    const d = Number(move.probabilityChange?.[key] || 0);
    const cls = d > .4 ? 'up' : d < -.4 ? 'down' : 'flat';
    const arrow = d > .4 ? '↑' : d < -.4 ? '↓' : '→';
    return `<div class="odds-move-row ${cls}"><span>${label}</span><strong>${move.baseline?.[key] ?? '—'} → ${move.current?.[key] ?? '—'}</strong><b>${arrow} ${signedPp(d)}</b></div>`;
  };
  return `<div class="odds-movement-grid">${row('П1','home')}${row('Н','draw')}${row('П2','away')}</div><p class="tiny">Сравнение с самым ранним сохранённым снимком во время матча${move.from ? ` · ${dateTime(move.from)}` : ''}. Изменение указано в расчётной вероятности.</p>`;
}

function livePressureHtml(p, m) {
  if (!p) return '';
  const home = Math.max(0, Math.min(100, Number(p.home || 0)));
  const away = 100 - home;
  const lead = p.leader === 'home' ? m.home?.name : p.leader === 'away' ? m.away?.name : 'Баланс';
  return `<section class="panel pulse-panel"><h2>⚡ Пульс матча</h2><div class="pulse-names"><span>${escapeHtml(m.home?.name || '')}</span><strong>${escapeHtml(lead || 'Баланс')}</strong><span>${escapeHtml(m.away?.name || '')}</span></div><div class="pulse-bar"><i style="width:${home}%"></i><b style="width:${away}%"></b></div><div class="pulse-values"><span>${home}</span><span>${away}</span></div><p class="tiny">${escapeHtml(publicText(p.note || ''))}</p></section>`;
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
    ? rows.map(x => `<div class="absence-live-row"><strong>${escapeHtml(x.name || 'Игрок')}</strong><span>${escapeHtml(publicText(x.reason || x.type || 'Недоступен'))}</span></div>`).join('')
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
  return `<div class="center-all-stats">${items.map(x => centerCompareRow(publicText(x.label), x.home, x.away)).join('')}</div>`;
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
      <div class="timeline-home">${e.side==='home' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(publicText(e.label || ''))}</span>` : ''}</div>
      <div class="timeline-minute"><b>${minuteLabel(e)}</b>${e.goalScore ? `<em>${e.goalScore}</em>` : ''}</div>
      <div class="timeline-away">${e.side==='away' ? `<strong>${escapeHtml(e.player || e.teamName || '')}</strong><span>${escapeHtml(publicText(e.label || ''))}</span>` : ''}</div>
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
    embedded: 'данные матча',
    api: 'источник данных',
    cache: 'сохранённые данные',
    stale: 'резервные сохранённые данные',
    skipped: 'пропущено',
    error: 'ошибка',
  })[source] || publicText(source) || '—';
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
  const names = { events:'События', statistics:'Статистика', players:'Игроки', lineups:'Составы', injuries:'Потери', liveOdds:'Коэффициенты' };
  return `<div class="center-freshness">
    ${rows.map(([key, meta]) => `<div class="${escapeHtml(meta?.source || '')}">
      <span>${escapeHtml(names[key] || key)}</span>
      <strong>${escapeHtml(freshnessSourceLabel(meta?.source))}</strong>
      <small>${freshnessAgeLabel(meta?.ageSeconds)}${meta?.policy?.ttlSeconds ? ` · срок обновления ${Math.round(Number(meta.policy.ttlSeconds)/60*10)/10} мин.` : ''}</small>
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
  if (!d.liveOdds) return `<div class="empty compact-empty">Коэффициенты П1 / Н / П2 в реальном времени сейчас недоступны. Покрытие зависит от турнира и режима данных.</div>`;
  return `<div class="center-market">
    <div class="odds-grid">
      <div><span>П1</span><strong>${d.liveOdds.odds?.home ?? '—'}</strong></div>
      <div><span>Н</span><strong>${d.liveOdds.odds?.draw ?? '—'}</strong></div>
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
  const buttons = [...document.querySelectorAll('.center-tab-btn')];
  const panels = [...document.querySelectorAll('.center-tab-panel')];
  buttons.forEach(btn => {
    const active = btn.dataset.centerTab === state.currentCenterTab;
    const name = btn.dataset.centerTab || 'summary';
    btn.id = `center-tab-${name}`;
    btn.classList.toggle('active', active);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `center-panel-${name}`);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });
  panels.forEach(panel => {
    const active = panel.dataset.centerPanel === state.currentCenterTab;
    const name = panel.dataset.centerPanel || 'summary';
    panel.id = `center-panel-${name}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.toggleAttribute('inert', !active);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `center-tab-${name}`);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (scroll) document.querySelector('.center-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindMatchCenterTabs() {
  const buttons = [...document.querySelectorAll('.center-tab-btn')];
  buttons.forEach(btn => btn.addEventListener('click', () => setMatchCenterTab(btn.dataset.centerTab, false)));
  bindRovingTabKeyboard(buttons, 'centerTab', value => setMatchCenterTab(value, false));
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
      <h3>${escapeHtml(publicText(insight.title || 'Наблюдение'))}</h3>
      <p>${escapeHtml(publicText(insight.text || ''))}</p>
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
      <div><span class="smart-story-label">🧠 КАРТИНА МАТЧА</span><h2>${escapeHtml(publicText(si.headline || ''))}</h2></div>
      <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(publicText(si.dataLabel || 'Покрытие'))}</span></div>
    </div>
    <p class="smart-story-summary">${escapeHtml(publicText(si.summary || ''))}</p>
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
        <div class="smart-data-score"><strong>${Number(si.dataScore || 0)}%</strong><span>${escapeHtml(publicText(si.dataLabel || ''))}</span></div>
      </div>
      <p>${escapeHtml(si.summary || '')}</p>
    </section>
    <div class="smart-insight-list">${(si.insights || []).map(x => smartInsightCardHtml(x, match)).join('')}</div>
    <section class="panel smart-methodology"><strong>Как это считается</strong><p>${escapeHtml(publicText(si.methodology || ''))}</p></section>
  </div>`;
}

function liveAiCoachHtml(ai, match) {
  if (!ai?.available) return '';
  const tone = ['holds','weakened','broken','shifted','wait'].includes(ai.state) ? ai.state : 'neutral';
  const pressure = ai.current?.pressure || {};
  const xg = ai.current?.xg || {};
  const pressureText = Number.isFinite(Number(pressure.home)) && Number.isFinite(Number(pressure.away)) ? `${pressure.home}:${pressure.away}` : '—';
  const xgText = Number.isFinite(Number(xg.home)) && Number.isFinite(Number(xg.away)) ? `${Number(xg.home).toFixed(2)}:${Number(xg.away).toFixed(2)}` : '—';
  const watch = Array.isArray(ai.watchNext) ? ai.watchNext.slice(0,3) : [];
  return `<section class="panel live-ai-coach ${tone}">
    <div class="live-ai-head"><div><span>AI В ЭФИРЕ · ${Number(match.elapsed || 0) ? `${Number(match.elapsed)}′` : 'сейчас'}</span><h2>${escapeHtml(publicText(ai.headline || 'Читаю матч в реальном времени'))}</h2></div><b>${Math.round(Number(ai.confidence || 0))}%</b></div>
    <p class="live-ai-summary">${escapeHtml(publicText(ai.summary || ''))}</p>
    <div class="live-ai-decision"><span>Решение AI сейчас</span><strong>${escapeHtml(publicText(ai.action?.label || 'Наблюдать'))}</strong><small>${escapeHtml(publicText(ai.action?.reason || 'Дождитесь более устойчивой картины.'))}</small></div>
    <div class="live-ai-grid">
      <div><span>Счёт</span><strong>${match.score?.home ?? 0}:${match.score?.away ?? 0}</strong><small>${Number(match.elapsed || 0) ? `${Number(match.elapsed)} мин.` : 'Матч идёт'}</small></div>
      <div><span>Давление</span><strong>${pressureText}</strong><small>${escapeHtml(publicText(ai.current?.pressureLeaderLabel || 'Баланс'))}</small></div>
      <div><span>xG</span><strong>${xgText}</strong><small>${escapeHtml(publicText(ai.current?.chanceLabel || 'По доступным данным'))}</small></div>
      <div><span>Риск сценария</span><strong>${escapeHtml(publicText(ai.volatility?.label || 'Средний'))}</strong><small>${escapeHtml(publicText(ai.volatility?.reason || 'Матч может быстро измениться.'))}</small></div>
    </div>
    ${ai.prematch?.available ? `<div class="live-ai-prematch"><span>До матча</span><strong>${escapeHtml(publicText(ai.prematch.signal || ai.prematch.outcome || 'AI-разбор'))}</strong><b>${escapeHtml(publicText(ai.prematch.stateLabel || 'сравниваю'))}</b></div>` : `<div class="live-ai-prematch muted"><span>До матча</span><strong>Сохранённого AI-разбора нет</strong><b>читаю только текущий матч</b></div>`}
    ${watch.length ? `<div class="live-ai-watch"><strong>Что смотреть дальше</strong><ul>${watch.map(x=>`<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
    <p class="live-ai-disclaimer">Оценка по ходу матча перестраивается при каждом обновлении счёта, событий и статистики. Это объяснение сценария, а не гарантия результата.</p>
  </section>`;
}

function postMatchReviewHtml(review = {}, match = {}) {
  if (!review || !Object.keys(review).length) return '';
  if (!review.available) {
    return `<section class="panel post-match-review unavailable">
      <div class="post-match-review-head"><div><span>🧠 ПОСЛЕ МАТЧА</span><h2>${escapeHtml(review.headline || 'Итог AI недоступен')}</h2></div><b>архив</b></div>
      <p>${escapeHtml(publicText(review.summary || 'Для честного сравнения нужен сохранённый предматчевый снимок.'))}</p>
    </section>`;
  }
  const outcome=review.outcome || {};
  const score=review.score || {};
  const hit=Boolean(outcome.correct);
  const markets=Array.isArray(review.markets)?review.markets:[];
  const evidence=Array.isArray(review.evidence)?review.evidence.slice(0,3):[];
  const quality=review.quality || {};
  return `<section class="panel post-match-review ${hit?'hit':'miss'}">
    <div class="post-match-review-head">
      <div><span>🧠 POST-MATCH AI REVIEW</span><h2>${escapeHtml(review.headline || 'Разбор завершён')}</h2></div>
      <b>${hit?'✓ исход':'✕ исход'}</b>
    </div>
    <p class="post-match-summary">${escapeHtml(publicText(review.summary || ''))}</p>
    <div class="post-match-compare">
      <div><span>До матча</span><strong>${escapeHtml(outcome.predictedLabel || '—')}${Number.isFinite(Number(outcome.probability))?` · ${Number(outcome.probability)}%`:''}</strong><small>максимальная вероятность модели</small></div>
      <div><span>Факт</span><strong>${escapeHtml(outcome.actualLabel || '—')} · ${Number(score.home)}:${Number(score.away)}</strong><small>финальный результат</small></div>
    </div>
    ${markets.length?`<div class="post-match-markets">${markets.map(x=>`<div class="${x.correct?'hit':'miss'}"><span>${x.correct?'✓':'✕'} ${escapeHtml(x.label || '')}</span><strong>${escapeHtml(x.predicted || '—')} → ${escapeHtml(x.actual || '—')}</strong><small>${Number.isFinite(Number(x.probability))?`до матча ${Number(x.probability)}%`:''}</small></div>`).join('')}</div>`:''}
    ${evidence.length?`<div class="post-match-evidence"><strong>Что видно по матчу</strong>${evidence.map(x=>`<div><span>${escapeHtml(x.icon || '•')}</span><p><b>${escapeHtml(x.title || '')}</b><small>${escapeHtml(publicText(x.text || ''))}</small></p></div>`).join('')}</div>`:''}
    <div class="post-match-calibration">
      <span>Калибровка</span>
      <p>${escapeHtml(publicText(review.calibration?.note || ''))}</p>
      ${Number.isFinite(Number(quality.brier))?`<small>Brier: ${Number(quality.brier).toFixed(3)} · чем меньше, тем точнее были вероятности</small>`:''}
    </div>
    <p class="tiny warning">${escapeHtml(publicText(review.disclaimer || ''))}</p>
  </section>`;
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
  const statusText = live ? '● ИДЁТ' : finished ? '✓ ЗАВЕРШЁН' : 'ПРЕДСТОИТ';
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

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Показан последний сохранённый снимок</strong><p>${escapeHtml(publicText(d.warning || 'Источник данных временно ограничил запросы.'))}</p></section>` : ''}
    ${d.note ? `<section class="panel center-note"><p class="tiny warning">${escapeHtml(publicText(d.note))}</p></section>` : ''}

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
      ${finished ? postMatchReviewHtml(d.postMatchReview || {}, m) : ''}
      ${live ? liveAiCoachHtml(d.liveAiCoach, m) : ''}
      ${smartInsightsHeroHtml(d.smartInsights, m)}
      ${livePressureHtml(d.livePressure, m)}
      <section class="panel">
        <div class="center-section-title"><div><h2>Ключевые показатели</h2><p>Самые полезные метрики в одном экране</p></div><span class="coverage-badge">${escapeHtml(publicText(d.dataCapabilities?.label || 'Покрытие данных'))}</span></div>
        ${centerKeyStatsHtml(d.statistics)}
      </section>

      ${latestEvents.length ? `<section class="panel"><div class="center-section-title"><div><h2>Последние события</h2><p>Что произошло недавно</p></div></div>${liveEventsHtml(latestEvents)}</section>` : ''}

      ${(d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><div class="center-section-title"><div><h2>🩺 Потери состава</h2><p>Подтверждённые недоступные игроки</p></div></div>${centerAbsenceSummary(d.absences,m)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}

      <section class="panel coverage-panel">
        <div class="center-section-title"><div><h2>Покрытие и свежесть</h2><p>${d.cached ? 'Данные из сохранённой версии' : 'Свежие данные источника'} · ${dateTime(d.generatedAt)}</p></div></div>
        ${centerCoverageHtml(d)}
        ${centerFreshnessHtml(d)}
        ${d.quotaMode ? `<div class="quota-public-chip">${escapeHtml(publicText(d.quotaMode.label || ''))} · обновление ${Number(d.quotaMode.liveRefreshSeconds || d.refreshSeconds || 0)} сек.</div>` : ''}
        ${d.availability?.limitedCoverage ? '<div class="coverage-badge limited">Ограниченное покрытие · экономим лимит запросов</div>' : ''}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="insights">
      ${smartInsightsFullHtml(d.smartInsights, m)}
    </div>

    <div class="center-tab-panel" data-center-panel="timeline">
      <section class="panel">
        <div class="center-section-title"><div><h2>⚡ Хронология матча</h2><p>Голы, карточки, замены и видеопросмотры</p></div></div>
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
        <div class="center-section-title"><div><h2>👥 Составы и схема</h2><p>Стартовые составы, схемы и запасные</p></div></div>
        ${lineupLiveHtml(d.lineups, m)}
      </section>
      ${(d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><h2>🩺 Недоступные игроки</h2>${liveAbsencesHtml(d.absences,m)}</section>` : ''}
    </div>

    <div class="center-tab-panel" data-center-panel="players">
      <section class="panel">
        <div class="center-section-title"><div><h2>⭐ Игроки матча</h2><p>Лучшие доступные показатели игроков и рейтинг</p></div></div>
        ${centerPlayersHtml(d.playerLeaders, m)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="market">
      <section class="panel">
        <div class="center-section-title"><div><h2>💹 Рынок в реальном времени</h2><p>Коэффициенты П1 / Н / П2 и изменение расчётной рыночной вероятности</p></div></div>
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
      const data = await requestMatchCenter(m.fixtureId, { t: Date.now() });
      if (!data) return;
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
  const sourceView = activeViewId();
  if (sourceView !== 'analysisView') state.analysisBackView = sourceView;
  if (Number(state.currentCenter?.match?.fixtureId || 0) !== Number(fixtureId)) state.currentCenterTab = 'summary';
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю матч…'; }
  try {
    const data = await requestMatchCenter(fixtureId);
    if (!data) return;
    renderMatchCenter(data);
    showView('analysisView');
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function syncAnalysisBusyUi() {
  document.querySelectorAll('.analyze-btn[data-fixture], #centerAnalyzeBtn').forEach(button => {
    button.disabled = Boolean(state.analysisActionPending);
    button.classList.toggle('is-pending', Boolean(state.analysisActionPending));
  });
}

async function analyzeMatch(fixtureId, btn, options = {}) {
  if (state.analysisActionPending) {
    toast('Анализ уже выполняется. Дождитесь завершения текущего запроса.');
    return;
  }
  const sourceView = activeViewId();
  if (sourceView !== 'analysisView') state.analysisBackView = sourceView;
  if (!runtimeAllows('analysisEnabled')) {
    toast(state.runtimeStatus?.message || 'Полный анализ временно приостановлен.');
    return;
  }
  stopLiveRefresh();
  state.currentCenter = null;
  state.analysisActionPending = true;
  syncAnalysisBusyUi();
  const original = btn?.textContent || '';
  if (btn) btn.textContent = '⏳ Собираю данные…';
  try {
    const data = await api('/api/analyze', { method: 'POST', body: JSON.stringify({
      fixtureId,
      origin:'miniapp',
      recheck: options.recheck !== false,
      newsImpactDecision:String(options.newsImpactDecision || '').toLowerCase().slice(0,24),
      newsImpactAction:String(options.newsImpactAction || '').toLowerCase().slice(0,24),
    }) });
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    renderAnalysis(data);
    rememberHistoryAnalysis(data);
    if (state.profile && data.quota) {
      state.profile.quota = data.quota;
      renderProfile();
    }
    showView('analysisView');
    void Promise.allSettled([loadHistory(false), loadReminders()]);
  } catch (e) {
    if (e.status === 429 && String(e.payload?.code || '').startsWith('FOOTBALL_')) {
      toast(e.payload?.retryAfter ? `Источник футбольных данных временно на паузе. Повторите через ~${e.payload.retryAfter} сек.` : e.message);
    } else if (e.status === 429) toast('Дневной лимит анализов исчерпан.');
    else toast(e.message);
  } finally {
    state.analysisActionPending = false;
    syncAnalysisBusyUi();
    if (btn) btn.textContent = original;
  }
}

function historyItemFromAnalysis(data = {}) {
  const match = data?.match || {};
  const fixtureId = Number(match.fixtureId || 0);
  if (!fixtureId) return null;
  return {
    fixtureId,
    homeName: match.home?.name || '',
    awayName: match.away?.name || '',
    leagueName: match.league || '',
    fixtureDate: match.date || '',
    homeLogo: match.home?.logo || '',
    awayLogo: match.away?.logo || '',
    aiSignalCode: data?.aiInstructor?.betSignal?.code || '',
    aiSignalLabel: data?.aiInstructor?.betSignal?.label || '',
    aiConfidence: Number(data?.aiInstructor?.confidenceScore ?? 0) || null,
    aiRisk: data?.aiInstructor?.riskLabel || '',
    aiOutcome: data?.aiInstructor?.verdict?.outcome || '',
    aiTotal: data?.aiInstructor?.verdict?.total || '',
    aiBtts: data?.aiInstructor?.verdict?.btts || '',
    analysisVersion: data?.analysisVersion || '',
    viewedAt: new Date().toISOString(),
  };
}

function rememberHistoryAnalysis(data) {
  const item = historyItemFromAnalysis(data);
  if (!item) return;
  state.history = [item, ...state.history.filter(x => Number(x.fixtureId) !== item.fixtureId)].slice(0, 50);
  state.historyLoaded = true;
  state.historyLoadError = '';
  state.historyRevision += 1;
  if (activeViewId() === 'historyView') renderHistory();
  if (state.matches.length) renderMatches();
}


async function loadAiTrackRecord(force = false) {
  if (state.aiTrackRecordLoading) return;
  state.aiTrackRecordLoading=true;
  state.aiTrackRecordError='';
  renderAiTrackRecord();
  try {
    const data=await api(`/api/ai-track-record?days=180${force?'&refresh=1':''}`,{retry:false,timeoutMs:9000});
    state.aiTrackRecord=data;
    state.aiTrackRecordLoaded=true;
  } catch (error) {
    state.aiTrackRecordError=error.message || 'Не удалось загрузить протокол AI.';
  } finally {
    state.aiTrackRecordLoading=false;
    renderAiTrackRecord();
  }
}

function renderAiTrackRecord() {
  const el=$('aiTrackRecord');
  if (!el) return;
  if (state.aiTrackRecordLoading && !state.aiTrackRecordLoaded) {
    el.innerHTML='<div class="loader compact-loader">Проверяю подтверждённую историю AI…</div>';
    return;
  }
  if (state.aiTrackRecordError && !state.aiTrackRecordLoaded) {
    el.innerHTML=`<div class="ai-track-record-error"><strong>Протокол AI временно недоступен</strong><p>${escapeHtml(state.aiTrackRecordError)}</p><button id="aiTrackRetry" class="secondary-btn" type="button">Повторить</button></div>`;
    $('aiTrackRetry')?.addEventListener('click',()=>loadAiTrackRecord(true));
    return;
  }
  const r=state.aiTrackRecord;
  if (!r?.available) {
    el.innerHTML='<div class="ai-track-record-empty"><strong>Протокол AI формируется</strong><p>Подтверждённые результаты появятся здесь после проверки завершённых матчей.</p></div>';
    return;
  }
  const sample=r.sample || {};
  const quality=r.probabilityQuality || {};
  const recent=Array.isArray(r.recent)?r.recent:[];
  const brier=Number.isFinite(Number(quality.avgBrier))?Number(quality.avgBrier).toFixed(3):'—';
  const sampleClass=sample.state==='early'?'early':sample.state==='forming'?'forming':sample.state==='informative'?'informative':'empty';
  const notice=state.aiTrackRecordError
    ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.aiTrackRecordError)} Показана последняя загруженная версия.</div>`
    : '';
  el.innerHTML=`
    ${notice}
    <section class="panel ai-track-card">
      <div class="ai-track-head">
        <div><span>📈 ПРОТОКОЛ FM AI</span><h2>Проверенная история модели</h2></div>
        <b class="ai-track-sample ${sampleClass}">${escapeHtml(sample.label || '—')}</b>
      </div>
      <p class="ai-track-intro">Только неизменяемые предматчевые прогнозы с подтверждённым финальным результатом. Здесь нет рекламного «процента побед».</p>
      <div class="ai-track-kpis">
        <div><span>Проверено</span><strong>${Number(sample.verified || 0)}</strong><small>матчей</small></div>
        <div><span>Совпало</span><strong>${Number(sample.matched || 0)}</strong><small>основной исход</small></div>
        <div><span>Не совпало</span><strong>${Number(sample.missed || 0)}</strong><small>основной исход</small></div>
        <div><span>Брайер</span><strong>${brier}</strong><small>ниже — лучше</small></div>
      </div>
      <p class="ai-track-sample-note">${escapeHtml(sample.message || '')}</p>
      ${recent.length?`<div class="ai-track-recent">
        <div class="ai-track-block-head"><strong>Последние подтверждённые прогнозы</strong><span>${Number(r.periodDays || 180)} дней</span></div>
        ${recent.map(row=>`<div class="ai-track-row">
          <span class="ai-track-result ${row.matched?'hit':'miss'}">${row.matched?'✓':'✕'}</span>
          <div><strong>${escapeHtml(row.home)} — ${escapeHtml(row.away)}</strong><small>${escapeHtml(row.league || '')}${row.kickoffAt?` · ${dateTime(row.kickoffAt)}`:''}</small></div>
          <div class="ai-track-outcome"><strong>${escapeHtml(row.score)}</strong><small>AI: ${escapeHtml(row.predictedLabel || '—')}${Number.isFinite(Number(row.topProbability))?` · ${Number(row.topProbability)}%`:''} → ${escapeHtml(row.actualLabel || '—')}</small></div>
        </div>`).join('')}
      </div>`:''}
      <div class="ai-track-method">
        <strong>Что означает Брайер?</strong>
        <p>${escapeHtml(quality.explanation || '')}</p>
        <small>${escapeHtml(r.methodology?.disclaimer || '')}</small>
      </div>
    </section>`;
}

async function loadHistory(showLoader = true) {
  if (state.historyLoading) return;
  const revisionAtStart = state.historyRevision;
  state.historyLoading = true;
  state.historyLoadError = '';
  if (showLoader || !state.historyLoaded) renderHistory();
  try {
    const data = await api('/api/history');
    if (revisionAtStart !== state.historyRevision) return;
    state.history = data.items || [];
    state.historyLoaded = true;
    state.historyLoadError = '';
    if (state.matches.length) renderMatches();
  } catch (e) {
    if (revisionAtStart !== state.historyRevision) return;
    state.historyLoadError = e.message || 'Не удалось загрузить историю.';
  } finally {
    state.historyLoading = false;
    renderHistory();
  }
}

async function openHistoryAnalysis(fixtureId, btn) {
  const sourceView = activeViewId();
  if (sourceView !== 'analysisView') state.analysisBackView = sourceView;
  const seq = ++state.historyOpenRequestSeq;
  const original = btn?.textContent || '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Открываю…'; }
  try {
    const data = await api(`/api/history-analysis?fixtureId=${Number(fixtureId)}`, { retry: false, timeoutMs: 9000 });
    if (seq !== state.historyOpenRequestSeq) return;
    state.currentCenter = null;
    renderAnalysis(data);
    showView('analysisView', { fromHistoryOpen: true });
  } catch (error) {
    if (seq !== state.historyOpenRequestSeq) return;
    if (Number(error?.status || 0) === 404) {
      const center = await requestMatchCenter(fixtureId, {}, { timeoutMs: 9000 });
      if (seq !== state.historyOpenRequestSeq || !center) return;
      renderMatchCenter(center);
      showView('analysisView', { fromHistoryOpen: true });
      toast('Сохранённый полный анализ уже недоступен — открыт центр матча.');
    } else {
      toast(error.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function renderHistory() {
  const el = $('history');
  if (!el) return;
  if (state.historyLoading && !state.historyLoaded) {
    el.innerHTML = '<div class="loader">Загружаю историю…</div>';
    return;
  }
  if (state.historyLoadError && !state.historyLoaded) {
    el.innerHTML = recoveryCardHtml({ title: 'История временно недоступна', message: state.historyLoadError, retryId: 'historyRecoveryRetry' });
    $('historyRecoveryRetry')?.addEventListener('click', () => loadHistory(true));
    return;
  }
  if (!state.history.length) {
    const retry = state.historyLoadError
      ? '<button id="historyEmptyRetry" class="secondary-btn" type="button">Обновить историю</button>'
      : '';
    el.innerHTML = `
      ${state.historyLoadError ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.historyLoadError)} Последняя загруженная история была пустой.</div>` : ''}
      <div class="empty history-empty-state">
        <strong>История пока пуста</strong>
        <p>После первого полного анализа матч появится здесь для быстрого повторного открытия.</p>
        <div class="empty-actions">
          ${retry}
          <button id="historyEmptyMatches" class="primary-setting-btn" type="button">Найти матч</button>
        </div>
      </div>`;
    $('historyEmptyRetry')?.addEventListener('click', () => loadHistory(true));
    $('historyEmptyMatches')?.addEventListener('click', () => showView('searchView'));
    return;
  }
  const notice = state.historyLoading
    ? '<div class="data-notice">↻ Обновляю историю…</div>'
    : state.historyLoadError
      ? `<div class="data-notice stale">⚠️ ${escapeHtml(state.historyLoadError)} Показана последняя загруженная история.</div>`
      : '';
  el.innerHTML = notice + state.history.map(item => `
    <article class="history-item">
      <div class="history-logos">
        ${item.homeLogo ? `<img src="${safeUrl(item.homeLogo)}" alt="">` : ''}
        <span>—</span>
        ${item.awayLogo ? `<img src="${safeUrl(item.awayLogo)}" alt="">` : ''}
      </div>
      <div class="history-main">
        <strong>${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}</strong>
        <span>${escapeHtml(item.leagueName || '')}${item.fixtureDate ? ` · ${dateTime(item.fixtureDate)}` : ''}${item.viewedAt ? ` · открыто ${relativeAge(item.viewedAt)}` : ''}</span>
        ${item.aiSignalLabel ? `<em class="history-ai-chip ${item.aiSignalCode === 'skip' ? 'skip' : ''}">AI · ${escapeHtml(item.aiSignalLabel)}${Number.isFinite(Number(item.aiConfidence)) ? ` · ${Math.round(Number(item.aiConfidence))}/100` : ''}</em>` : ''}
      </div>
      <button class="history-open" data-fixture="${Number(item.fixtureId)}" type="button" aria-label="Открыть анализ матча ${escapeHtml(item.homeName)} — ${escapeHtml(item.awayName)}">Открыть</button>
    </article>
  `).join('');
  el.querySelectorAll('.history-open').forEach(btn => btn.addEventListener('click', () => openHistoryAnalysis(Number(btn.dataset.fixture), btn)));
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
  const names = { market: 'рынок', apiPrediction: 'прогноз источника', recentForm: 'форма', h2h: 'очные встречи' };
  const parts = Object.entries(weights).filter(([,v]) => Number(v) > 0).map(([k,v]) => `${names[k] || k} ${Number(v).toFixed(0)}%`);
  return parts.length ? parts.join(' · ') : 'Недостаточно сигналов';
}

function bullets(items = [], empty = 'Нет существенных факторов.') {
  if (!items?.length) return `<p class="muted">${escapeHtml(publicText(empty))}</p>`;
  return `<ul class="list analysis-list">${items.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul>`;
}

function absenceList(title, items) {
  if (!items?.length) return `<div class="data-card"><span>${escapeHtml(title)}</span><strong>Нет данных</strong></div>`;
  return `<div class="panel"><h2>${escapeHtml(title)}</h2><ul class="list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong>${x.reason ? ` — ${escapeHtml(publicText(x.reason))}` : ''}${x.type ? ` (${escapeHtml(publicText(x.type))})` : ''}</li>`).join('')}</ul></div>`;
}

function reminderFor(fixtureId) {
  return state.reminders.find(x => Number(x.fixtureId) === Number(fixtureId)) || null;
}

function hasReminder(fixtureId) {
  return Boolean(reminderFor(fixtureId));
}

function syncQuickReminderButton(button, fixtureId) {
  if (!button) return;
  const pending = state.reminderMutations.has(Number(fixtureId));
  const active = hasReminder(fixtureId);
  const minutes = Number(state.preferences?.reminderMinutes || 30);
  button.disabled = pending;
  button.classList.toggle('is-pending', pending);
  button.classList.toggle('active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  button.textContent = pending
    ? 'Сохраняю…'
    : active
      ? '🔔 Напоминание включено'
      : `🔔 Напомнить за ${minutes} мин.`;
}

function syncAllQuickReminderButtons() {
  document.querySelectorAll('.quick-reminder-btn[data-quick-reminder]').forEach(button => {
    syncQuickReminderButton(button, Number(button.dataset.quickReminder));
  });
}

function syncReminderMutationUi(fixtureId) {
  const pending = state.reminderMutations.has(Number(fixtureId));
  const button = $('reminderBtn');
  if (button && Number(state.currentAnalysis?.match?.fixtureId || 0) === Number(fixtureId)) {
    button.disabled = pending;
    button.classList.toggle('is-pending', pending);
  }
  document.querySelectorAll(`.reminder-remove[data-fixture-id="${Number(fixtureId)}"]`).forEach(el => {
    el.disabled = pending;
    el.classList.toggle('is-pending', pending);
  });
  document.querySelectorAll(`.quick-reminder-btn[data-quick-reminder="${Number(fixtureId)}"]`).forEach(el => {
    syncQuickReminderButton(el, fixtureId);
  });
}

async function toggleReminder(match) {
  if (!match?.fixtureId) return;
  const fixtureId = Number(match.fixtureId);
  if (state.reminderMutations.has(fixtureId)) return;
  const active = hasReminder(fixtureId);
  state.remindersLoadError = '';
  if (!active && !runtimeAllows('remindersEnabled')) {
    toast('Новые уведомления временно приостановлены.');
    return;
  }
  state.reminderMutations.add(fixtureId);
  syncReminderMutationUi(fixtureId);
  try {
    if (active) {
      await api(`/api/reminders?fixtureId=${fixtureId}`, { method: 'DELETE' });
      state.reminders = state.reminders.filter(x => Number(x.fixtureId) !== fixtureId);
      state.remindersLoaded = true;
      state.remindersRevision += 1;
      toast('Напоминание отключено');
    } else {
      const data = await api('/api/reminders', {
        method: 'POST',
        body: JSON.stringify({
          fixtureId,
          homeName: match.home?.name || '',
          awayName: match.away?.name || '',
          leagueName: match.league || '',
          fixtureDate: match.date || '',
          reminderMinutes: Number(state.preferences?.reminderMinutes || 30),
          kickoffNotify: state.preferences?.kickoffNotification !== false,
        }),
      });
      const item = data?.item || {
        fixtureId,
        homeName: match.home?.name || '',
        awayName: match.away?.name || '',
        leagueName: match.league || '',
        fixtureDate: match.date || '',
        remindBeforeMinutes: Number(state.preferences?.reminderMinutes || 30),
        kickoffNotify: state.preferences?.kickoffNotification !== false,
        deliveryStatus: 'scheduled',
        deliveryAttempts: 0,
      };
      state.reminders = [item, ...state.reminders.filter(x => Number(x.fixtureId) !== fixtureId)];
      state.remindersLoaded = true;
      state.remindersRevision += 1;
      renderReminderList();
      toast(`Напомним примерно за ${Number(item.remindBeforeMinutes || state.preferences?.reminderMinutes || 30)} минут до матча${item.kickoffNotify !== false ? ' и около старта' : ''}`);
    }
    if (state.profile) {
      state.profile = {
        ...state.profile,
        stats: { ...(state.profile.stats || {}), reminders: state.reminders.length },
      };
      renderProfile();
    }
    if (state.currentAnalysis) renderAnalysis(state.currentAnalysis);
  } catch (e) {
    toast(e.message);
  } finally {
    state.reminderMutations.delete(fixtureId);
    syncReminderMutationUi(fixtureId);
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
  if (d.apiPrediction) parts.push('Прогноз источника данных');
  if (d.recentForm?.home?.overall?.sample || d.recentForm?.away?.overall?.sample) parts.push('Форма');
  if ((d.h2h?.homeWins || 0) + (d.h2h?.awayWins || 0) + (d.h2h?.draws || 0) > 0) parts.push('Очные встречи');
  if (d.news?.answer) parts.push('Новости');
  return parts.length ? parts.join(' · ') : 'Базовые данные';
}

function compactAbsence(title, items) {
  if (!items?.length) return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><p class="muted">Заявленных потерь нет или данные недоступны.</p></div>`;
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><ul class="compact-list">${items.slice(0, 10).map(x => `<li><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml([x.reason, x.type].filter(Boolean).map(publicText).join(' · '))}</span></li>`).join('')}</ul></div>`;
}

function lineupBlock(title, lineup) {
  const players = lineup?.startXI || [];
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)} <span>${escapeHtml(lineup?.formation || '')}</span></div>${players.length ? `<div class="lineup-list">${players.map((x,i) => `<span><b>${lineupPlayerNumber(x) || i+1}</b>${escapeHtml(lineupPlayerName(x))}</span>`).join('')}</div>` : '<p class="muted">Стартовый состав ещё не опубликован.</p>'}</div>`;
}

async function shareAnalysis(d) {
  const m=d?.match || {};
  const p=d?.probabilities || {};
  const fixtureId=Number(m.fixtureId || 0);
  const signal=d?.aiInstructor?.betSignal || {};
  const title=`${m.home?.name || ''} — ${m.away?.name || ''}`;
  const lines=[
    `⚽ ${title}`,
    `${m.league || ''}${m.date ? ` · ${dateTime(m.date)}` : ''}`,
    `П1 ${pct(p.home)} · Н ${pct(p.draw)} · П2 ${pct(p.away)}`,
    signal.label ? `FM AI: ${signal.label}` : `Наиболее вероятно: ${d?.likelyOutcome || '—'}`,
    `Уверенность: ${d?.confidence?.score ?? d?.aiInstructor?.confidenceScore ?? '—'}/100`,
    '',
    'Открой матч в FM AI — ссылка сразу приведёт к этому разбору.',
    'Аналитическая оценка модели · не гарантия результата.',
  ];
  let shareUrl='';
  let telegramShareUrl='';
  try {
    if (fixtureId) {
      const share=await api(`/api/share-link?fixtureId=${fixtureId}&source=social&campaign=match_share&content=miniapp`,{retry:false,timeoutMs:7000});
      shareUrl=String(share?.url || '');
      telegramShareUrl=String(share?.telegramShareUrl || '');
    }
  } catch {}
  const text=lines.join('\n');
  const fullText=shareUrl ? `${text}\n\n${shareUrl}` : text;
  try {
    if (telegramShareUrl && tg?.openTelegramLink) {
      tg.openTelegramLink(telegramShareUrl);
      toast('Открыто окно отправки матча');
      return;
    }
    if (navigator.share) {
      await navigator.share({title,text,...(shareUrl?{url:shareUrl}:{})});
      return;
    }
    await navigator.clipboard.writeText(fullText);
    toast(shareUrl ? 'Ссылка на матч скопирована' : 'Краткий анализ скопирован');
  } catch (e) {
    if (e?.name !== 'AbortError') {
      try {
        await navigator.clipboard.writeText(fullText);
        toast(shareUrl ? 'Ссылка на матч скопирована' : 'Краткий анализ скопирован');
      } catch {
        toast('Не удалось поделиться анализом');
      }
    }
  }
}

function bindRovingTabKeyboard(buttons, dataKey, activate) {
  const tabs = Array.from(buttons || []);
  if (!tabs.length) return;
  tabs.forEach((btn, index) => btn.addEventListener('keydown', event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    const next = tabs[nextIndex];
    const value = next?.dataset?.[dataKey];
    if (!next || !value) return;
    activate(value);
    next.focus();
  }));
}

function setAnalysisTab(tab, scroll = false) {
  state.currentAnalysisTab = tab || 'brief';
  const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
  const panels = [...document.querySelectorAll('.analysis-tab-panel')];
  buttons.forEach(btn => {
    const active = btn.dataset.tab === state.currentAnalysisTab;
    const name = btn.dataset.tab || 'overview';
    btn.id = `analysis-tab-${name}`;
    btn.classList.toggle('active', active);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `analysis-panel-${name}`);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.tabIndex = active ? 0 : -1;
  });
  panels.forEach(panel => {
    const active = panel.dataset.panel === state.currentAnalysisTab;
    const name = panel.dataset.panel || 'overview';
    panel.id = `analysis-panel-${name}`;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.toggleAttribute('inert', !active);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `analysis-tab-${name}`);
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (scroll) document.querySelector('.analysis-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function bindAnalysisTabs() {
  const buttons = [...document.querySelectorAll('.analysis-tab-btn')];
  buttons.forEach(btn => btn.addEventListener('click', () => setAnalysisTab(btn.dataset.tab, true)));
  bindRovingTabKeyboard(buttons, 'tab', value => setAnalysisTab(value, false));
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
      <h3>${escapeHtml(publicText(driver.title || 'Фактор'))}</h3>
      <p>${escapeHtml(publicText(driver.text || ''))}</p>
      ${Number.isFinite(Number(driver.weight)) ? `<div class="driver-weight"><span>Вес в общей модели</span><strong>${Number(driver.weight).toFixed(1)}%</strong></div>` : ''}
    </div>
  </article>`;
}

function prematchScenarioCard(scenario) {
  return `<article class="prematch-scenario ${escapeHtml(scenario.tone || 'balanced')}">
    <div class="prematch-scenario-top"><span>${escapeHtml(scenario.icon || '•')}</span><small>${escapeHtml(publicText(scenario.relevance || ''))}</small></div>
    <h3>${escapeHtml(publicText(scenario.title || ''))}</h3>
    <p>${escapeHtml(publicText(scenario.text || ''))}</p>
  </article>`;
}

function prematchSourceRow(row, match) {
  const finalKey = state.currentAnalysis?.preMatchIntelligence?.leader?.key || '';
  return `<div class="prematch-source-row ${row.agreesWithFinal ? 'agree' : 'disagree'}">
    <div class="prematch-source-main">
      <span class="prematch-source-icon">${escapeHtml(row.icon || '•')}</span>
      <div><strong>${escapeHtml(publicText(row.label || ''))}</strong><small>Вес ${Number(row.weight || 0).toFixed(1)}%</small></div>
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
    return `<section class="panel"><div class="empty"><strong>Преданализ недоступен</strong><p>Пересчитайте анализ после обновления приложения.</p></div></section>`;
  }
  const uncertainty = pm.uncertainty || {};
  const leader = pm.leader || {};
  const dataScore = Number(pm.dataScore || 0);
  return `
    <section class="panel prematch-brief-hero">
      <div class="prematch-brief-top">
        <div>
          <span class="prematch-brief-label">🧠 ПРЕДАНАЛИЗ МАТЧА</span>
          <h2>${escapeHtml(publicText(pm.headline || 'Преданализ матча'))}</h2>
        </div>
        <div class="prematch-data-score"><strong>${dataScore}%</strong><span>полнота данных</span></div>
      </div>
      <p class="prematch-brief-summary">${escapeHtml(publicText(pm.summary || ''))}</p>

      <div class="prematch-brief-kpis">
        <div><span>Главный сценарий</span><strong>${escapeHtml(leader.label || prematchOutcomeName(leader.key, match))}</strong><small>${Number(leader.probability || 0).toFixed(1)}%</small></div>
        <div><span>Отрыв</span><strong>${Number(leader.gap || 0).toFixed(1)} п.п.</strong><small>от второго исхода</small></div>
        <div><span>Неопределённость</span><strong>${Number(uncertainty.score || 0)}/100</strong><small>${escapeHtml(publicText(uncertainty.label || ''))}</small></div>
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
      ${(pm.watch || []).length ? `<div class="prematch-watch-list">${pm.watch.map((x,i)=>`<div><b>${i+1}</b><span>${escapeHtml(publicText(x))}</span></div>`).join('')}</div>` : '<div class="empty compact-empty">Критичных ожидаемых изменений по доступным данным нет.</div>'}
    </section>

    <section class="panel">
      <div class="prematch-section-head"><div><h2>Как голосуют источники</h2><p>Каждый источник имеет собственную оценку и вес в объединении</p></div></div>
      <div class="prematch-source-table">${(pm.sourceRows || []).length ? pm.sourceRows.map(x => prematchSourceRow(x, match)).join('') : '<div class="empty compact-empty">Детальные данные по отдельным сигналам пока недоступны.</div>'}</div>
      <p class="tiny warning">${escapeHtml(publicText(pm.methodology || ''))}</p>
    </section>`;
}

function aiInstructorHtml(ai = {}, match = {}, kickoffHandoff = {}) {
  const signal = ai.betSignal || {};
  const verdict = ai.verdict || {};
  const factors = Array.isArray(ai.factors) ? ai.factors.slice(0, 3) : [];
  const risks = Array.isArray(ai.risks) ? ai.risks.slice(0, 2) : [];
  const handoffLocked = Boolean(kickoffHandoff?.locked);
  const signalClass = handoffLocked ? 'archived' : signal.code === 'skip' ? 'skip' : signal.code === 'watch' ? 'watch' : 'active';
  const confidenceText = Number.isFinite(Number(ai.confidenceScore)) ? `${Math.round(Number(ai.confidenceScore))}/100` : 'данных мало';
  const dataTrust = ai.dataTrust || {};
  const matchPlan = ai.matchPlan || {};
  const checks = Array.isArray(matchPlan.checks) ? matchPlan.checks.slice(0, 3) : [];
  const dataTrustScore = Number.isFinite(Number(dataTrust.score)) ? `${Math.round(Number(dataTrust.score))}%` : '—';
  return `
    <section class="panel ai-instructor-card ${signalClass}">
      <div class="ai-instructor-head">
        <div><span>AI ФУТБОЛЬНЫЙ ИНСТРУКТОР</span><h2>${handoffLocked ? 'Предматчевый разбор зафиксирован' : 'Мой разбор перед матчем'}</h2></div>
        <b>AI</b>
      </div>
      <div class="ai-verdict-grid" aria-label="Вердикт AI за 10 секунд">
        <div><span>Исход</span><strong>${escapeHtml(verdict.outcome || '—')}</strong></div>
        <div><span>Тотал 2.5</span><strong>${escapeHtml(verdict.total || '—')}</strong></div>
        <div><span>Обе забьют</span><strong>${escapeHtml(verdict.btts || '—')}</strong></div>
        <div class="${handoffLocked ? 'archived' : signal.code === 'skip' ? 'skip' : 'action'}"><span>${handoffLocked ? 'Сигнал до старта' : 'Решение'}</span><strong>${escapeHtml(signal.label || 'Изучить матч')}</strong></div>
      </div>
      <div class="ai-instructor-main">
        <div class="ai-instructor-pick">
          <span>${handoffLocked ? 'Архивная идея до старта' : 'Главная идея'}</span>
          <strong>${escapeHtml(signal.label || 'Сначала изучить матч')}</strong>
          <small>${escapeHtml(publicText(signal.reason || 'Собираю доступные сигналы и риски.'))}</small>
          ${ai.marketNote ? `<div class="ai-market-note">💹 ${escapeHtml(publicText(ai.marketNote))}</div>` : ''}
          ${ai.lineupImpact?.note ? `<div class="ai-lineup-note">👥 ${escapeHtml(publicText(ai.lineupImpact.note))}</div>` : ''}
        </div>
        <div class="ai-instructor-facts">
          <div><span>Уверенность</span><strong>${escapeHtml(ai.confidenceLabel || '—')}</strong><small>${confidenceText}</small></div>
          <div><span>Риск</span><strong>${escapeHtml(ai.riskLabel || '—')}</strong><small>${escapeHtml(publicText(ai.riskNote || 'Оценивайте несколько факторов.'))}</small></div>
          <div><span>Судья</span><strong>${escapeHtml(ai.refereeProfile?.name || ai.referee || match.referee || 'Ещё не указан')}</strong><small>${escapeHtml(publicText(ai.refereeHistory?.available ? `${ai.refereeHistory.styleLabel} · ${ai.refereeHistory.avgYellow} жёлт. · ${ai.refereeHistory.avgRed} красн. · выборка ${ai.refereeHistory.sample}` : ai.refereeProfile?.country ? `${ai.refereeProfile.country} · ${ai.refereeNote || ''}` : ai.refereeNote || 'Назначение судьи может появиться ближе к матчу.'))}</small></div>
          <div class="ai-data-trust"><span>Качество данных</span><strong>${escapeHtml(dataTrust.label || 'Оценивается')}</strong><small>${dataTrustScore} · ${escapeHtml(publicText(dataTrust.note || 'Отдельно от уверенности модели.'))}</small></div>
        </div>
      </div>
      ${factors.length ? `<div class="ai-instructor-reasons"><strong>Почему так</strong><ul>${factors.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
      ${risks.length ? `<div class="ai-instructor-risks"><strong>Что может сломать сценарий</strong><ul>${risks.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
      <div class="ai-match-plan">
        <div class="ai-match-plan-head"><span>AI-ПЛАН ДО СТАРТОВОГО СВИСТКА</span><strong>Что проверить перед решением</strong></div>
        ${checks.length ? `<div class="ai-match-plan-checks">${checks.map((x,i) => `<div><b>${i+1}</b><span>${escapeHtml(publicText(x))}</span></div>`).join('')}</div>` : ''}
        <div class="ai-match-plan-grid">
          <div><span>Условие отмены</span><strong>${escapeHtml(publicText(matchPlan.cancel || 'Если ключевые данные изменятся — пересмотреть сценарий.'))}</strong></div>
          <div><span>Что смотреть дальше</span><strong>${escapeHtml(publicText(matchPlan.liveWatch || 'После стартового свистка сверять фактический рисунок игры с предматчевым сценарием.'))}</strong></div>
        </div>
      </div>
      <p class="ai-instructor-disclaimer">Это аналитический сигнал по данным матча, а не гарантия результата. Если сигнал слабый, лучший вариант — пропустить ставку.</p>
    </section>`;
}

let launchIntentHandled = false;
async function openLaunchFixture(fixtureId, action, tab = '', handoff = false, newsImpactDecision = '', newsImpactAction = '') {
  const id = Number(fixtureId || 0);
  if (!id) return;
  const allowedTabs = new Set(['brief','overview','form','comparison','market','squads','context']);
  const requestedTab = allowedTabs.has(String(tab || '').toLowerCase()) ? String(tab).toLowerCase() : '';
  if (requestedTab) state.currentAnalysisTab = requestedTab;
  if (action === 'center') return openMatchCenter(id, null);
  if (action === 'analysis') {
    if (handoff) return analyzeMatch(id, null, { recheck:true, newsImpactDecision, newsImpactAction });
    await loadHistory(false);
    if (analysisHistoryForFixture(id)) return openHistoryAnalysis(id, null);
    return analyzeMatch(id, null);
  }
}

function applyLaunchIntent() {
  if (launchIntentHandled) return;
  launchIntentHandled = true;
  const params = new URLSearchParams(location.search);
  const filter = String(params.get('filter') || '').toLowerCase();
  const view = String(params.get('view') || '').toLowerCase();
  const query = String(params.get('q') || '').trim().slice(0, 60);
  const fixtureId = Number(params.get('fixtureId') || 0);
  const action = String(params.get('action') || '').toLowerCase();
  const tab = String(params.get('tab') || '').toLowerCase();
  const handoff = params.get('handoff') === '1';
  const newsImpactDecision = String(params.get('newsImpactDecision') || '').toLowerCase().slice(0,24);
  const newsImpactAction = String(params.get('newsImpactAction') || '').toLowerCase().slice(0,24);
  if (['top', 'live', 'favorites', 'all'].includes(filter)) {
    state.filter = filter;
  }
  if (view === 'search' || query) {
    if (query) {
      state.globalSearch.query = query;
      const input = $('globalSearchInput');
      if (input) input.value = query;
    }
    renderDiscoveryHome();
    renderGlobalSearch();
    showView('searchView');
    if (query) void runGlobalSearch();
  } else if (view === 'history') {
    showView('historyView');
    void Promise.allSettled([loadHistory(false),loadAiTrackRecord(false)]);
  } else if (fixtureId > 0 && ['analysis','center'].includes(action)) {
    showView('searchView');
    void openLaunchFixture(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction);
  } else {
    renderGlobalSearch();
    showView('searchView', { restore: true });
  }
}
function analysisFreshnessHtml(freshness = {}, recheck = {}) {
  if (!freshness || !freshness.label) return '';
  const state=String(freshness.state || 'fresh');
  const icon=state==='recheck'?'🟠':state==='started'?'⚪':'🟢';
  const mins=Number(freshness.ageMinutes || 0);
  const kickoff=Number.isFinite(Number(freshness.minutesToKickoff)) ? Number(freshness.minutesToKickoff) : null;
  const kickoffText=kickoff===null?'':kickoff>0?` · до старта ${kickoff} мин.`:' · матч уже начался';
  const action=freshness.needsRecheck ? '<button id="analysisRecheckBtn" class="freshness-recheck-btn" type="button">↻ Перепроверить AI сейчас</button>' : '';
  const rechecked=recheck?.performed ? `<small class="freshness-recheck-meta">${recheck.free ? 'Перепроверено без повторного списания лимита' : 'Выполнена свежая перепроверка'}</small>` : '';
  const delta=recheck?.performed ? recheck?.delta : null;
  const deltaItems=Array.isArray(delta?.items) ? delta.items.slice(0,6) : [];
  const deltaHtml=delta?.available ? `<div class="analysis-delta ${delta.material ? 'material' : delta.stable ? 'stable' : ''}">
    <div class="analysis-delta-head"><strong>${delta.material ? '🔄 Что изменилось' : delta.stable ? '✓ Прогноз стабилен' : '↻ Обновились детали'}</strong><span>${deltaItems.length} изменений</span></div>
    <p>${escapeHtml(publicText(delta.summary || ''))}</p>
    ${deltaItems.length ? `<div class="analysis-delta-list">${deltaItems.map(item=>`<div><span>${escapeHtml(item.title || item.code || '')}</span><strong>${item.before && item.after ? `${escapeHtml(item.before)} → ${escapeHtml(item.after)}` : escapeHtml(item.after || item.before || '')}</strong></div>`).join('')}</div>` : ''}
  </div>` : '';
  return `<section class="panel analysis-freshness ${escapeHtml(state)}">
    <div><span>${icon}</span><div><strong>${escapeHtml(freshness.label)}</strong><small>Расчёту ${mins} мин.${escapeHtml(kickoffText)}</small></div></div>
    <p>${escapeHtml(publicText(freshness.reason || ''))}</p>
    ${rechecked}${deltaHtml}${action}
  </section>`;
}

function kickoffHandoffHtml(handoff = {}, match = {}) {
  const state=String(handoff?.state || 'prematch');
  if (state==='prematch') return '';
  const locked=Boolean(handoff?.locked);
  const icon=state==='imminent'?'⏳':state==='finished'?'✓':'●';
  const action=locked && Number(match?.fixtureId || 0)
    ? `<button id="kickoffMatchCenterBtn" class="kickoff-center-btn" type="button">${escapeHtml(handoff.actionLabel || (state==='finished'?'Открыть итог матча':'Открыть центр матча'))}</button>`
    : '';
  return `<section class="panel kickoff-handoff ${locked?'locked':state}">
    <div><span>${icon}</span><div><strong>${escapeHtml(handoff.label || '')}</strong><small>${locked?'Предматчевый AI переведён в архивный режим':'Последняя проверка перед стартом'}</small></div></div>
    <p>${escapeHtml(publicText(handoff.reason || ''))}</p>
    ${action}
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
  const reminderPending = state.reminderMutations.has(Number(m.fixtureId));
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
      ${m.referee ? `<div class="analysis-referee-line"><span>🧑‍⚖️ Судья</span><strong>${escapeHtml(m.referee)}</strong></div>` : ''}

      <div class="match-experience-teams">
        <div class="experience-team">
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<div class="experience-logo-placeholder">⚽</div>'}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
          <small>Хозяева</small>
        </div>
        <div class="experience-vs">
          <span>против</span>
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
        <span>🧠 Преданализ матча</span>
        <strong>${escapeHtml(publicText(d.preMatchIntelligence.headline || ''))}</strong>
        <small>Открыть причины, сценарии и риски →</small>
      </button>` : ''}

      <div class="experience-prob-labels">
        <div><span>П1</span><strong>${pct(p.home)}</strong></div>
        <div><span>Н</span><strong>${pct(p.draw)}</strong></div>
        <div><span>П2</span><strong>${pct(p.away)}</strong></div>
      </div>
      ${probabilityStrip(p)}

      <div class="experience-health-row">
        <span class="quality-pill ${quality.cls}">● ${quality.label}</span>
        <span>${d.stale ? '⚠️ Последние сохранённые данные' : d.cached ? '⚡ Сохранённые данные' : '🆕 Свежий'} · ${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</span>
        <span>Обновлено ${d.generatedAt ? `${timeOf(d.generatedAt)} · ${relativeAge(d.generatedAt)}` : '—'}</span>
      </div>

      <div class="experience-actions">
        <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderPending ? '⏳ Сохраняю…' : reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
        <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться матчем</button>
      </div>
    </section>

    ${d.stale ? `<section class="panel stale-panel"><strong>⚠️ Использован последний сохранённый анализ</strong><p>${escapeHtml(d.warning || 'Свежие данные временно недоступны из-за ограничения источника данных.')}</p></section>` : ''}

    ${analysisFreshnessHtml(d.freshness || {}, d.recheck || {})}

    ${kickoffHandoffHtml(d.kickoffHandoff || {}, m)}

    ${aiInstructorHtml(d.aiInstructor || {}, m, d.kickoffHandoff || {})}

    <div class="analysis-tabs" role="tablist">
      <button class="analysis-tab-btn" data-tab="brief" type="button">Главное</button>
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
          <small>${escapeHtml(publicText(confidence.label || '—'))}</small>
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
        <p class="muted">Модель Пуассона по недавней результативности. Это не официальный показатель ожидаемых голов.</p>` : '<p class="muted">Недостаточно недавних матчей для голевой модели.</p>'}
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
        <div class="comparison-balance">${escapeHtml(publicText(comparison.balanceLabel || 'Сравнение строится по доступным данным'))}</div>
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
        <div class="comparison-section-head"><h2>♻️ Переиспользование данных</h2><span>+${Number(comparison.dataReuse?.separateApiRequests || 0)} доп. запросов</span></div>
        <p>${escapeHtml(publicText(comparison.dataReuse?.note || 'Сравнение использует уже загруженные данные.'))}</p>
        <div class="reuse-chips">${(comparison.dataReuse?.sources || []).map(x=>`<span>${escapeHtml(publicText(x))}</span>`).join('')}</div>
        <div class="reuse-status"><span>${comparison.dataReuse?.seasonStatsCached ? '✓' : '—'} Сезонная статистика из сохранённых данных</span><span>${comparison.dataReuse?.standingsCached ? '✓' : '—'} Таблица из сохранённых данных</span></div>
      </section>
    </div>

    <div class="analysis-tab-panel" data-panel="market">
      <section class="panel">
        <h2>💹 Коэффициенты П1 / Н / П2</h2>
        <div class="odds-grid">
          <div><span>П1</span><strong>${market?.odds?.home ?? '—'}</strong></div>
          <div><span>Н</span><strong>${market?.odds?.draw ?? '—'}</strong></div>
          <div><span>П2</span><strong>${market?.odds?.away ?? '—'}</strong></div>
        </div>
        <p class="muted">Букмекеров в выборке: ${market?.bookmakers ?? '—'}. Коэффициенты отражают рынок, а не гарантированный исход.</p>
      </section>
      <section class="panel">
        <h2>🧠 Состав модели</h2>
        <p class="muted">${escapeHtml(publicText(d.modelBreakdown?.method || 'Модель объединяет доступные статистические сигналы.'))}</p>
        <div class="model-weights">${escapeHtml(modelWeightsText(d.modelBreakdown?.weights || {}))}</div>
      ${d.modelCalibration ? `<div class="analysis-calibration-card ${escapeHtml(d.modelCalibration.mode || 'baseline')}"><span>Калибровка v${escapeHtml(d.modelCalibration.version || '4.0')}</span><strong>${escapeHtml(calibrationModeLabel(d.modelCalibration.mode))}</strong><small>профиль ${escapeHtml(String(d.modelCalibration.fingerprint || '').slice(0, 8) || 'базовый')} · выборка ${Number(d.modelCalibration.sample || 0)} · коэффициент ${Number(d.modelCalibration.temperature || 1).toFixed(2)}${d.modelCalibration.weightsActive ? ' · адаптивные веса' : ''}</small></div>` : ''}
        <div class="model-api-card">
          <span>Прогноз источника данных</span>
          <strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong>
          <small>${escapeHtml(predictionAdviceLabel(pred?.advice || 'Подсказка недоступна'))}</small>
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
        <h2>🌐 Свежий контекст из интернета</h2>
        <p class="context-answer">${escapeHtml(news.answer || 'Источник свежего веб-контекста не подключён или сводка не найдена.')}</p>
        ${news.results?.length ? `<div class="news-links">${news.results.slice(0, 5).map(r => `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(r.title || 'Источник')}</a>`).join('')}</div>` : ''}
      </section>
      <section class="panel data-transparency-panel">
        <h2>🔎 Прозрачность данных</h2>
        <div class="transparency-grid">
          <div><span>Полнота</span><strong>${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</strong></div>
          <div><span>Анализ</span><strong>v${escapeHtml(d.analysisVersion || '—')}</strong></div>
          <div><span>Статус</span><strong>${d.stale ? 'Последние сохранённые данные' : d.cached ? 'Сохранённые данные' : 'Свежий'}</strong></div>
          <div><span>Режим данных</span><strong>${escapeHtml(dataPolicyModeLabel(d.dataPolicy?.mode || 'standard'))}</strong></div>
        </div>
        ${d.dataPolicy?.skipped?.length ? `<div class="policy-list"><strong>Что было пропущено для экономии/качества:</strong><ul>${d.dataPolicy.skipped.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
        <p class="tiny warning">${escapeHtml(publicText(d.disclaimer || ''))}</p>
      </section>
    </div>
  `;

  $('analysisRecheckBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget, { recheck:true }));
  $('kickoffMatchCenterBtn')?.addEventListener('click', e => openMatchCenter(Number(m.fixtureId), e.currentTarget));
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
    const drawer = btn.closest('.league-filter-drawer');
    if (drawer) drawer.open = false;
  });
});

document.querySelectorAll('[data-quick-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.filter = btn.dataset.quickFilter || 'top';
    syncFilterButtons();
    renderMatches();
    $('matchesTitle')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
document.querySelectorAll('[data-theme-choice]').forEach(button => {
  button.addEventListener('click', () => saveInterfacePreference('theme', button.dataset.themeChoice || 'system'));
});
document.querySelectorAll('[data-button-style-choice]').forEach(button => {
  button.addEventListener('click', () => saveInterfacePreference('buttonStyle', button.dataset.buttonStyleChoice || 'soft'));
});

document.querySelectorAll('[data-admin-target]').forEach(button => {
  button.addEventListener('click', async () => {
    const target = $(button.dataset.adminTarget);
    if (!target) return;
    if (button.dataset.adminTarget === 'diagnosticsPanel' && !state.diagnosticsLoading) await loadDiagnostics(false);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
$('adminAdvancedTools')?.addEventListener('toggle', event => {
  if (event.currentTarget.open) loadAdvancedAdminTools();
});

$('matchSearch').addEventListener('input', e => {
  state.search = e.target.value || '';
  clearTimeout(matchSearchTimer);
  matchSearchTimer = setTimeout(renderMatches, 110);
});

$('globalSearchBtn')?.addEventListener('click', runGlobalSearch);
$('globalSearchInput')?.addEventListener('input', e => {
  state.globalSearch.requestSeq += 1;
  state.globalSearch.loading = false;
  state.globalSearch.query = e.target.value || '';
  state.globalSearch.remoteTeams = [];
  state.globalSearch.remoteCompetitions = [];
  state.globalSearch.remoteMatches = [];
  state.globalSearch.matchSourceTeam = '';
  state.globalSearch.warning = '';
  renderGlobalSearch();
});
$('globalSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); } });
document.querySelectorAll('[data-search-mode]').forEach(btn => btn.addEventListener('click', () => setGlobalSearchMode(btn.dataset.searchMode || 'all')));
$('clearRecentTeamsBtn')?.addEventListener('click', clearRecentTeams);
$('refreshBtn').addEventListener('click', () => loadMatches({ force: true }));
$('historyRefreshBtn').addEventListener('click', () => Promise.allSettled([loadHistory(true), loadAiTrackRecord(true)]));
$('backBtn').addEventListener('click', handleBackNavigation);
$('tournamentBackBtn')?.addEventListener('click', handleBackNavigation);
$('teamBackBtn')?.addEventListener('click', handleBackNavigation);
const tournamentTabs = [...document.querySelectorAll('.tournament-tab')];
tournamentTabs.forEach(btn => btn.addEventListener('click', () => setTournamentTab(btn.dataset.tournamentTab || 'matches')));
bindRovingTabKeyboard(tournamentTabs, 'tournamentTab', value => setTournamentTab(value));
const teamTabs = [...document.querySelectorAll('.team-tab')];
teamTabs.forEach(btn => btn.addEventListener('click', () => setTeamTab(btn.dataset.teamTab || 'overview')));
bindRovingTabKeyboard(teamTabs, 'teamTab', value => setTeamTab(value));
$('profileBtn').addEventListener('click', openProfileView);
$('navMatches').addEventListener('click', () => showView('matchesView'));
$('navSearch')?.addEventListener('click', () => {
  renderDiscoveryHome();
  renderGlobalSearch();
  showView('searchView');
  if (window.matchMedia?.('(pointer: fine)').matches) {
    setTimeout(() => $('globalSearchInput')?.focus({ preventScroll: true }), 80);
  }
});
$('navHistory').addEventListener('click', async () => {
  showView('historyView');
  const tasks=[];
  if (!state.historyLoaded) tasks.push(loadHistory(true)); else renderHistory();
  if (!state.aiTrackRecordLoaded) tasks.push(loadAiTrackRecord(false)); else renderAiTrackRecord();
  if (tasks.length) await Promise.allSettled(tasks);
});
$('navProfile').addEventListener('click', openProfileView);
$('proBtn')?.addEventListener('click', () => buyPlan('PRO'));
$('premiumBtn')?.addEventListener('click', () => buyPlan('PREMIUM'));
$('billingSyncBtn')?.addEventListener('click', () => syncBilling(true));
$('subscriptionManageBtn')?.addEventListener('click', () => manageSubscription($('subscriptionManageBtn').dataset.action || 'cancel'));
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
$('firstRunGuideDismiss')?.addEventListener('click', dismissFirstRunGuide);

if (tg?.BackButton?.onClick) {
  try { tg.BackButton.onClick(handleBackNavigation); } catch {}
}

async function scheduleIdle(task) {
  if ('requestIdleCallback' in window) return new Promise(resolve => requestIdleCallback(async () => { try { await task(); } finally { resolve(); } }, { timeout: 1800 }));
  return new Promise(resolve => setTimeout(async () => { try { await task(); } finally { resolve(); } }, 250));
}

$('favoriteTeams')?.setAttribute('aria-live', 'polite');
$('reminderList')?.setAttribute('aria-live', 'polite');
$('history')?.setAttribute('aria-live', 'polite');
organizeAdminConsole();
applyInterfacePreferences();
renderFirstRunGuide();
syncFilterButtons();
showView('matchesView', { restore: true });

// RC30: settlement watchdog with runtime-gated automatic catch-up and cron audit trail.
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

const MINIAPP_PRODUCT_MODE = 'ai-analysis-only';
