import { createApiClient, initTelegramWebApp, localDate, timeOf, dateTime, dateOnly, relativeAge, phase5SessionToken } from './modules/client-core.js';
import { CANONICAL_HOME_VIEW, PUBLIC_VIEW_IDS, backTargetForView, telegramBackButtonVisible } from './modules/navigation.js';
import { createNavigationShell } from './modules/navigation-shell.js';
import { createViewChromeController } from './modules/view-chrome.js';
import { createInterfacePreferencesController } from './modules/ui-preferences.js';
import { createFirstRunGuideController } from './modules/first-run-guide.js';
import { createProfileDataCapabilitiesModule } from './modules/profile-data-capabilities.js';
import { createProfileAccessStateModule } from './modules/profile-access-state.js';
import { createProfileSummaryModule } from './modules/profile-summary.js';
import { createDigestSettingsModule } from './modules/digest-settings.js';
import { createSmartNotificationsModule } from './modules/smart-notifications.js';
import { createBillingModule } from './modules/billing.js';
import { createFavoriteTeamsRenderer } from './modules/favorite-teams-renderer.js';
import { createReminderListModule } from './modules/reminder-list.js';
import { createMyTeamsRenderer } from './modules/my-teams-renderer.js';
import { createJourneyStateModule } from './modules/journey-state.js';
import { createGlobalSearchRenderer } from './modules/global-search-renderer.js';
import { renderMatchPulse } from './modules/match-pulse.js';
import { renderAiTimelineCompact, renderAiTimelineDetails } from './modules/ai-timeline.js';
import { buildPlayerComparisonCandidates, playerComparisonHtml, samePlayer } from './modules/player-comparison.js';
import { createPlayerFollowModule } from './modules/player-follow.js';
import {
  CLIENT_VERSION,
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  SUPABASE_SCHEMA_HINT,
  appSurface,
  readUiPreferences,
  MATCH_WATCHLIST_KEY,
  readMatchWatchlist,
} from './modules/app-runtime.js';

const APP_SURFACE = appSurface(document);
const initialUiPreferences = readUiPreferences(localStorage);
document.documentElement.dataset.theme = initialUiPreferences.theme;
document.documentElement.dataset.accent = initialUiPreferences.accent;
document.documentElement.dataset.buttonStyle = initialUiPreferences.buttonStyle;

const tg = initTelegramWebApp(window);
const PHASE5_SESSION_TOKEN = phase5SessionToken(window);

const state = {
  profile: null,
  offset: 0,
  matches: [],
  matchesMeta: { refreshedAt: null, stale: false, warning: '', retryAfter: 0, catalog: {}, integrity: null },
  history: [],
  favorites: [],
  favoritePlayers: [],
  reminders: [],
  watchlist: readMatchWatchlist(localStorage),
  preferences: { defaultFilter: 'top', reminderMinutes: 30, kickoffNotification: true, hideYouth: true, favoriteFirst: true },
  uiPreferences: initialUiPreferences,
  preferencesApplied: false,
  provider: null,
  providerTransition: null,
  providerBudget: null,
  providerObservability: null,
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
  releaseRegressionResponsePending: false,
  releaseMonitorHours: 24,
  releaseMonitorDigestDays: 7,
  betaDashboard: null,
  betaDashboardLoading: false,
  betaDashboardDays: 7,
  betaFeedbackSending: false,
  launchFunnel: null,
  launchFunnelLoading: false,
  launchFunnelDays: 7,
  recoveryIncidentAckPending: new Set(),
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
  closedBetaBlocked: false,
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
  globalSearch: { query: '', mode: 'all', remoteTeams: [], knownTeams: [], remoteCompetitions: [], remoteMatches: [], matchSourceTeam: '', matchDiscovery: null, primaryFixtureId: null, loading: false, status: 'idle', warning: '', searchedAt: null, requestSeq: 0 },
  currentAnalysis: null,
  currentAnalysisTab: 'brief',
  analysisBackView: 'matchesView',
  currentCenter: null,
  currentCenterTab: 'summary',
  currentTournament: null,
  tournamentBackView: 'matchesView',
  currentTeam: null,
  teamBackView: 'matchesView',
  currentPlayer: null,
  playerBackView: 'analysisView',
  playerComparisonRequestSeq: 0,
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
  favoritePlayersLoaded: false,
  favoritePlayersLoading: false,
  favoritePlayersLoadError: '',
  favoritePlayersRevision: 0,
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
  matchesLoadSeq: 0,
  matchCenterRequestSeq: 0,
  matchCenterInFlight: new Map(),
  analysisActionPending: false,
  favoriteMutations: new Set(),
  favoritePlayerMutations: new Set(),
  reminderMutations: new Set(),
  preferencesSaving: false,
  profileStale: false,
  profileLoadError: '',
  clientPerf: { startedAt: new Date().toISOString(), requests: 0, completed: 0, failed: 0, deduped: 0, retries: 0, rateLimited: 0, timeouts: 0, recoveries: 0, degradedEvents: 0, manifestFailures: 0, bootMs: null, totalMs: 0, lastMs: null, clientErrors: 0, lastError: '' },
};

const inflightGetRequests = new Map();
const MATCH_SNAPSHOT_PREFIX = 'football-analytics:v4:matches:';
const MATCH_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;


const $ = id => document.getElementById(id);

const { renderDataCapabilities } = createProfileDataCapabilitiesModule({ state, elementById: $ });
const { renderProfileAccessState } = createProfileAccessStateModule({
  elementById: $,
  escapeHtml,
  onRetry: () => openProfileView(),
});
const { renderProfileSummary } = createProfileSummaryModule({
  state,
  elementById: $,
  safeUrl,
  planLabel,
  dateOnly,
  createElement: tag => document.createElement(tag),
});
const { renderFavoriteTeams } = createFavoriteTeamsRenderer({
  state,
  elementById: $,
  escapeHtml,
  safeUrl,
  recoveryCardHtml,
  onRetryLoad: () => loadFavorites(),
  onShowMatches: () => showView('matchesView'),
  onRemoveFavorite: team => toggleFavorite(team),
  onOpenTeam: team => openTeam(team),
});
const { renderReminderList } = createReminderListModule({
  state,
  elementById: $,
  querySelectorAll: selector => document.querySelectorAll(selector),
  escapeHtml,
  dateTime,
  recoveryCardHtml,
  onRetry: () => loadReminders(),
  onOpenMatches: () => showView('matchesView'),
  onRemove: fixtureId => handleReminderRemove(fixtureId),
});
const { renderMyTeams } = createMyTeamsRenderer({
  state,
  elementById: $,
  escapeHtml,
  safeUrl,
  timeOf,
  onOpenTeam: team => openTeam(team),
  onAnalyzeMatch: (fixtureId, button) => analyzeMatch(fixtureId, button),
});
const { renderJourneyState } = createJourneyStateModule({
  elementById: $,
  escapeHtml,
});

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
  if (state.liveRefreshTimer) clearInterval(state.liveRefreshTimer);
  state.liveRefreshTimer = null;
  state.liveRefreshRemaining = 0;
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
    if (to !== 'analysisView') {
      stopLiveRefresh();
      state.liveRefreshWasActive = false;
    }
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
  const retryAfter = Number(error?.retryAfter || error?.payload?.retryAfter || 0);
  if (category === 'offline') return 'Нет подключения к интернету. Сохранённые данные останутся на экране.';
  if (error?.status === 426 || error?.payload?.category === 'compatibility') return 'Версия приложения устарела. Обновите приложение.';
  if (error?.payload?.category === 'maintenance') return error?.payload?.error || 'Приложение временно на техническом обслуживании.';
  if (error?.payload?.category === 'feature_disabled') return error?.payload?.error || 'Эта функция временно приостановлена.';
  if (category === 'auth') return 'Сессия Telegram не подтверждена. Закройте приложение и откройте его снова из бота.';
  if (category === 'timeout') return 'Сервис отвечает медленнее обычного. Попробуйте обновить ещё раз.';
  if (category === 'rate_limit') return retryAfter
    ? `Обновления на паузе ~${retryAfter} сек. Уже загруженные данные доступны.`
    : 'Обновления временно на паузе. Уже загруженные данные доступны.';
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
      durationMs: meta.durationMs,
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

  setBootStatus('MatchRadar', 'Загружаем матчи…', 12);
  const manifest = await loadAppManifest();

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
  await Promise.allSettled([
    loadRuntimeStatus(false),
    loadProfile().catch(()=>null),
  ]);

  if (state.closedBetaBlocked) return false;
  renderProfile();
  applyRuntimeUi();
  const admin=isAdmin();
  if ($('profileBtn')) $('profileBtn').hidden=false;
  if ($('navProfile')) $('navProfile').hidden=false;
  if ($('navMatches')) $('navMatches').hidden=false;

  const startupTasks = [loadFavorites(), loadMatches()];
  await Promise.allSettled(startupTasks);
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
  await new Promise(resolve => setTimeout(resolve, 120));
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

const digestSettingsModule = createDigestSettingsModule({
  elementById: $,
  api,
  escapeHtml,
  planLabel,
  toast,
});
const {
  loadDigestSettings,
  renderDigestSettings,
} = digestSettingsModule;

const smartNotificationsModule = createSmartNotificationsModule({
  elementById: $,
  api,
  escapeHtml,
  toast,
});
const {
  load: loadSmartNotifications,
  render: renderSmartNotifications,
} = smartNotificationsModule;

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

const billingModule = createBillingModule({
  state,
  elementById: $,
  api,
  toast,
  telegram: tg,
  dateTime,
  reloadProfile: () => loadProfile(),
  openProfile: () => openProfileView(),
});
function renderBilling() { return billingModule.render(); }
function loadBilling(...args) { return billingModule.load(...args); }
function showQuotaPaywall() { return billingModule.showQuotaPaywall(); }
function showQuotaPaywallForFixture(fixtureId = 0) { return billingModule.showQuotaPaywall(fixtureId); }
function hideQuotaPaywall() { return billingModule.hideQuotaPaywall(); }

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
  return `<button class="search-entity-summary search-competition-summary" type="button"
    data-search-competition="${Number(comp.leagueId)}"
    data-season="${Number(comp.season || new Date().getFullYear())}"
    data-comp-name="${escapeHtml(comp.name || comp.shortName || 'Турнир')}"
    data-comp-short="${escapeHtml(comp.shortName || comp.name || 'Турнир')}"
    data-comp-country="${escapeHtml(comp.country || '')}"
    data-comp-category="${escapeHtml(comp.category || '')}"
    data-comp-tier="${escapeHtml(comp.tier || 'standard')}"
    aria-label="Открыть турнир ${escapeHtml(comp.shortName || comp.name || 'Турнир')}">
    <span class="discovery-team-logo">${comp.logo ? `<img src="${safeUrl(comp.logo)}" alt="">` : '🏆'}</span>
    <span><small>ТУРНИР НАЙДЕН</small><strong>${escapeHtml(comp.shortName || comp.name || 'Турнир')}</strong><em>${escapeHtml(comp.country || '')}</em></span>
    <b>Открыть →</b>
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

function discoveryText(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function discoveryMatchRank(value, query) {
  const text = discoveryText(value);
  const q = discoveryText(query);
  if (!text || !q) return 99;
  if (text === q) return 0;
  if (text.startsWith(q)) return 1;
  if (text.split(/\s+/).some(part => part.startsWith(q))) return 2;
  if (text.includes(q)) return 3;
  return 99;
}

function localDiscoveryResults(query) {
  const q = discoveryText(query);
  if (!q) return { teams: [], competitions: [], matches: [] };
  const teams = new Map(), competitions = new Map(), matches = [];
  for (const m of state.matches) {
    for (const team of [m.home, m.away]) {
      if (!team?.id || !team?.name) continue;
      const rank = Math.min(discoveryMatchRank(team.name, q), discoveryMatchRank(`${team.name} ${m.country || ''}`, q));
      if (rank < 99 && !teams.has(Number(team.id))) teams.set(Number(team.id), { ...team, country: m.country || '', _searchRank:rank });
    }
    const names = [m.leagueShort, m.league, m.leagueOriginal].filter(Boolean);
    const compRank = Math.min(...names.map(name => discoveryMatchRank(name, q)), discoveryMatchRank(`${m.league || ''} ${m.country || ''}`, q));
    if (Number(m.leagueId) > 0 && compRank < 99 && !competitions.has(Number(m.leagueId))) competitions.set(Number(m.leagueId), {
      leagueId: Number(m.leagueId), season: Number(m.season || new Date().getFullYear()), name: m.league || m.leagueOriginal || 'Турнир', shortName: m.leagueShort || m.league || 'Турнир', country: m.country || '', category: m.category || '', tier: m.competition?.tier || 'standard', logo: m.leagueLogo || '', _searchRank:compRank,
    });
    const teamRank = Math.min(discoveryMatchRank(m.home?.name, q), discoveryMatchRank(m.away?.name, q));
    const matchRank = Math.min(teamRank, discoveryMatchRank(m.league, q), discoveryMatchRank(m.leagueOriginal, q));
    if (matchRank < 99 && Number(m.fixtureId) > 0) matches.push({ ...m, _searchRank:matchRank });
  }
  const teamRows = [...teams.values()].sort((a,b) => Number(a._searchRank||99)-Number(b._searchRank||99) || String(a.name||'').localeCompare(String(b.name||''),'ru'));
  const compRows = [...competitions.values()].sort((a,b) => Number(a._searchRank||99)-Number(b._searchRank||99) || Number(b.tier==='top')-Number(a.tier==='top') || String(a.shortName||a.name||'').localeCompare(String(b.shortName||b.name||''),'ru'));
  matches.sort((a,b) => Number(a._searchRank||99)-Number(b._searchRank||99) || Number(Boolean(b.live))-Number(Boolean(a.live)) || Date.parse(a.date||0)-Date.parse(b.date||0));
  return { teams: teamRows.slice(0, 10), competitions: compRows.slice(0, 8), matches: matches.slice(0, 20) };
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

function setDiscoveryHomeVisibility(visible) {
  ['searchRecentWrap', 'searchFavoritesWrap', 'searchCompetitionsWrap'].forEach(id => {
    const el = $(id);
    if (el) el.hidden = !visible;
  });
}

function renderDiscoveryHome() {
  const recentEl = $('searchRecent');
  const favEl = $('searchFavorites');
  const compEl = $('searchCompetitions');
  setDiscoveryHomeVisibility(!String(state.globalSearch.query || '').trim());
  if (recentEl) {
    const rows = getRecentTeams();
    recentEl.innerHTML = rows.map(x => discoveryTeamCard(x, 'Недавно')).join('');
    if ($('searchRecentWrap')) $('searchRecentWrap').hidden = !rows.length || Boolean(String(state.globalSearch.query || '').trim());
  }
  if (favEl) {
    const rows = state.favorites.slice(0, 10);
    favEl.innerHTML = rows.map(x => discoveryTeamCard({ id:x.teamId, name:x.teamName, logo:x.teamLogo }, 'Избранное')).join('');
    if ($('searchFavoritesWrap')) $('searchFavoritesWrap').hidden = !rows.length || Boolean(String(state.globalSearch.query || '').trim());
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
    : `<button class="search-match-action" type="button" data-search-fixture="${Number(match.fixtureId)}">AI-разбор</button>`;
  const primaryLabel=primary ? `<div class="search-match-primary"><b>⭐ ОСНОВНОЙ МАТЧ</b><span>${escapeHtml(match?.selection?.reason || state.globalSearch.matchDiscovery?.primaryReason || 'Основной выбор MatchRadar для анализа')}</span></div>` : '';
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

const { renderGlobalSearch } = createGlobalSearchRenderer({
  state,
  elementById: $,
  querySelectorAll: selector => document.querySelectorAll(selector),
  escapeHtml,
  localDiscoveryResults,
  mergeById,
  russianCountLabel,
  searchTeamSummaryCard,
  knownTeamSummaryCard,
  searchCompetitionSummaryCard,
  searchMatchCard,
  setDiscoveryHomeVisibility,
  onRenderDiscoveryHome: () => renderDiscoveryHome(),
  onRetry: () => runGlobalSearch({ manual:true }),
  onBindDiscoveryActions: root => bindDiscoveryActions(root),
  onBindSearchMatchActions: root => bindSearchMatchActions(root),
  onSetMode: mode => setGlobalSearchMode(mode),
});

async function runGlobalSearch({ manual = false } = {}) {
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
    state.globalSearch.status = query.length < 2 ? 'idle' : 'done';
    state.globalSearch.remoteTeams = [];
    state.globalSearch.remoteCompetitions = [];
    if (!runtimeAllows('searchEnabled')) state.globalSearch.warning = 'Удалённый поиск временно недоступен. Уже загруженные матчи остаются доступны.';
    renderGlobalSearch();
    return;
  }

  const local = localDiscoveryResults(query);
  const localCount = local.teams.length + local.competitions.length + local.matches.length;
  sendProductAction('search_used', 'searchView');
  const timingStartedAt = performance.now();
  state.globalSearch.loading = true;
  state.globalSearch.status = localCount ? 'refreshing' : 'searching';
  renderGlobalSearch();

  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`, {
      timeoutMs: 6500,
      retry: false,
    });
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
    const merged = localDiscoveryResults(query);
    const totalMatches = mergeById(state.globalSearch.remoteMatches, merged.matches, 'fixtureId').length;
    const totalEntities = mergeById(merged.teams, state.globalSearch.remoteTeams, 'id').length
      + mergeById(merged.competitions, state.globalSearch.remoteCompetitions, 'leagueId').length
      + state.globalSearch.knownTeams.length;
    state.globalSearch.status = totalMatches ? 'found' : totalEntities ? 'done' : 'empty';
    if (totalMatches || totalEntities) sendProductAction('search_found', 'searchView');
    else sendProductAction('search_empty', 'searchView');
    sendOperationTiming('search', timingStartedAt, 'searchView');
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
  } catch (e) {
    if (seq !== state.globalSearch.requestSeq) return;
    const category = apiErrorCategory(e);
    state.globalSearch.status = category === 'timeout' ? 'timeout' : 'error';
    state.globalSearch.warning = category === 'timeout'
      ? 'Источник отвечает слишком долго.'
      : friendlyErrorMessage(e);
    sendActionError('search', e, 'searchView');
    if (manual && category !== 'timeout') toast(state.globalSearch.warning);
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

function applyMatchPayload(data, { snapshot = false, refreshing = false } = {}) {
  state.matches = data.matches || [];
  state.matchesMeta = {
    refreshedAt: data.refreshedAt || null,
    stale: Boolean(data.stale || snapshot),
    warning: data.warning || '',
    retryAfter: Number(data.retryAfter || 0),
    catalog: data.catalog || {},
    integrity: data.integrity || null,
    localSnapshot: snapshot,
    refreshing: Boolean(refreshing),
  };
  if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
  if (state.filter === 'top' && !state.matches.some(x => personalMatchInsight(x).recommended)) state.filter = 'all';
  syncFilterButtons();
  renderMatches();
  renderDiscoveryHome();
  $('matches')?.setAttribute('aria-busy', 'false');
}

async function loadMatches(options = {}) {
  const force = Boolean(options.force);
  const silent = Boolean(options.silent);
  const seq = ++state.matchesLoadSeq;
  const date = localDate(state.offset);
  const labels = { '-1': 'Матчи вчера', '0': 'Матчи сегодня', '1': 'Матчи завтра' };
  $('matchesTitle').textContent = labels[String(state.offset)] || 'Матчи';

  const snapshot = !force ? readMatchSnapshot(date) : null;
  const canReuseCurrent = Boolean(state.matches.length && state.matchesMeta?.date === date);

  if (snapshot && !canReuseCurrent) {
    applyMatchPayload(snapshot, { snapshot: true, refreshing: true });
    state.matchesMeta.date = date;
  } else if (canReuseCurrent) {
    state.matchesMeta.refreshing = true;
    renderMatches();
    $('matches')?.setAttribute('aria-busy', 'false');
  } else if (!silent) {
    state.matches = [];
    $('matches')?.setAttribute('aria-busy', 'true');
    $('matches').innerHTML = matchSkeletonHtml();
    $('matchesCount').textContent = '';
    if ($('dataNotice')) $('dataNotice').innerHTML = '';
  }

  try {
    const data = await api(`/api/matches?date=${date}`, {
      timeoutMs: 6500,
      retry: false,
    });
    if (seq !== state.matchesLoadSeq) return;
    data.refreshedAt ||= new Date().toISOString();
    writeMatchSnapshot(date, data);
    applyMatchPayload(data, { snapshot: false, refreshing: false });
    state.matchesMeta.date = date;
  } catch (e) {
    if (seq !== state.matchesLoadSeq) return;
    sendActionError('matches', e, 'matchesView');
    const retry = Number(e.payload?.retryAfter || 0);
    if (state.matches.length && (snapshot || state.matchesMeta?.date === date)) {
      state.matchesMeta.stale = true;
      state.matchesMeta.refreshing = false;
      state.matchesMeta.warning = e.message || 'Не удалось обновить данные. Показана последняя сохранённая версия.';
      state.matchesMeta.retryAfter = retry;
      renderMatches();
      $('matches')?.setAttribute('aria-busy', 'false');
      return;
    }
    const category = apiErrorCategory(e);
    const publicMessage = category === 'rate_limit'
      ? 'Источник матчей временно занят. Попробуйте ещё раз чуть позже.'
      : (e.message || 'Не удалось обновить матчи.');
    $('matches').innerHTML = `<div class="empty error-state"><strong>Матчи сейчас не обновились</strong><span>${escapeHtml(publicMessage)}</span><button id="matchesRetryBtn" class="secondary-btn" type="button">Повторить</button></div>`;
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
    const drawerFilters = ['favorites', 'international', 'cups', 'england', 'spain', 'italy', 'germany', 'france'];
    const activeDrawerFilter = drawerFilters.includes(state.filter);
    drawer.classList.toggle('has-active-filter', activeDrawerFilter);
    const summaryValue = drawer.querySelector('[data-filter-summary-value]');
    const labels = {
      favorites: 'Избранное',
      international: 'Международные',
      cups: 'Кубки',
      england: 'Англия',
      spain: 'Испания',
      italy: 'Италия',
      germany: 'Германия',
      france: 'Франция',
    };
    if (summaryValue) {
      summaryValue.textContent = activeDrawerFilter ? labels[state.filter] : '';
      summaryValue.hidden = !activeDrawerFilter;
    }
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

function homePersonalMatch(signals = personalContextSignals(), nowMs = Date.now()) {
  if (!signals.hasPersonalData) return null;
  const rows = state.matches
    .filter(match => !match.finished && !match.youthReserve)
    .map(match => ({ match, insight:personalMatchInsight(match, signals) }))
    .filter(item => item.insight.favorite || item.insight.viewedTeam)
    .sort((a, b) => {
      if (Boolean(a.match.live) !== Boolean(b.match.live)) return a.match.live ? -1 : 1;
      const scoreDelta = Number(b.insight.score || 0) - Number(a.insight.score || 0);
      if (scoreDelta) return scoreDelta;
      const aDate = Date.parse(a.match.date || '') || Number.POSITIVE_INFINITY;
      const bDate = Date.parse(b.match.date || '') || Number.POSITIVE_INFINITY;
      const aFuture = aDate >= nowMs ? 0 : 1;
      const bFuture = bDate >= nowMs ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return aDate - bDate;
    });
  return rows[0] || null;
}

function homePersonalMatchMeta(item) {
  if (!item) return '';
  const match = item.match;
  const reason = item.insight.favorite ? 'Любимая команда' : 'Вы смотрели эту команду';
  const status = match.live ? 'LIVE' : timeOf(match.date);
  return [reason, status, match.league || ''].filter(Boolean).join(' · ');
}

function watchedMatch(fixtureId) {
  const id = Number(fixtureId || 0);
  return id > 0 ? state.watchlist.find(item => Number(item.fixtureId) === id) || null : null;
}

function isWatchedMatch(fixtureId) {
  return Boolean(watchedMatch(fixtureId));
}

function matchWatchlistSnapshot(match = {}) {
  return {
    fixtureId: Number(match.fixtureId || 0),
    homeName: String(match.home?.name || '').trim(),
    awayName: String(match.away?.name || '').trim(),
    league: String(match.league || '').trim(),
    date: String(match.date || '').trim(),
    homeId: Number(match.home?.id || 0),
    awayId: Number(match.away?.id || 0),
    homeLogo: String(match.home?.logo || '').trim(),
    awayLogo: String(match.away?.logo || '').trim(),
    addedAt: new Date().toISOString(),
  };
}

function persistMatchWatchlist() {
  try {
    localStorage.setItem(MATCH_WATCHLIST_KEY, JSON.stringify(state.watchlist.slice(0, 50)));
  } catch {}
}

function toggleMatchWatch(match = {}) {
  const fixtureId = Number(match.fixtureId || 0);
  if (!fixtureId || match.finished) return;
  if (isWatchedMatch(fixtureId)) {
    state.watchlist = state.watchlist.filter(item => Number(item.fixtureId) !== fixtureId);
    persistMatchWatchlist();
    toast('Матч удалён из слежения');
  } else {
    const snapshot = matchWatchlistSnapshot(match);
    if (!snapshot.homeName || !snapshot.awayName) return;
    state.watchlist = [snapshot, ...state.watchlist.filter(item => Number(item.fixtureId) !== fixtureId)].slice(0, 50);
    persistMatchWatchlist();
    toast('Матч добавлен в слежение');
  }
  renderMatches();
}

function radarFeedItems(nowMs = Date.now()) {
  const favoriteIds = favoriteSet();
  const viewed = personalContextSignals();
  const rows = [];

  for (const match of state.matches) {
    if (!match || match.youthReserve) continue;
    const fixtureId = Number(match.fixtureId || 0);
    if (!fixtureId) continue;

    const homeId = Number(match.home?.id || 0);
    const awayId = Number(match.away?.id || 0);
    const favorite = favoriteIds.has(homeId) || favoriteIds.has(awayId);
    const homeName = normalizedSignalText(match.home?.name);
    const awayName = normalizedSignalText(match.away?.name);
    const viewedTeam = viewed.viewedTeams.has(homeName) || viewed.viewedTeams.has(awayName);
    const reminder = reminderFor(fixtureId);
    const history = analysisHistoryForFixture(fixtureId);
    const watched = isWatchedMatch(fixtureId);
    const kickoffMs = Date.parse(match.date || '');
    const hoursToKickoff = Number.isFinite(kickoffMs) ? (kickoffMs - nowMs) / 3600000 : Infinity;

    let item = null;
    if (match.live && (watched || favorite || viewedTeam)) {
      item = {
        priority: watched ? 126 : favorite ? 120 : 105,
        tone: 'live',
        kicker: watched ? 'LIVE · ВЫ СЛЕДИТЕ' : favorite ? 'LIVE · ЛЮБИМАЯ КОМАНДА' : 'LIVE · ВЫ СМОТРЕЛИ',
        title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
        meta: `${match.score?.home ?? 0} : ${match.score?.away ?? 0}${Number(match.elapsed || 0) ? ` · ${Number(match.elapsed)}′` : ''}${match.league ? ` · ${match.league}` : ''}`,
        action: 'center',
        fixtureId,
      };
    } else if (!match.finished && history && (watched || favorite || viewedTeam)) {
      item = {
        priority: watched ? 98 : favorite ? 92 : 82,
        tone: 'ai',
        kicker: 'AI-РАЗБОР ГОТОВ',
        title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
        meta: [history.aiSignalLabel || 'Сохранённый разбор', Number(history.aiConfidence || 0) ? `уверенность ${Math.round(Number(history.aiConfidence))}/100` : '', timeOf(match.date)].filter(Boolean).join(' · '),
        action: 'history',
        fixtureId,
      };
    } else if (!match.finished && reminder && hoursToKickoff >= 0 && hoursToKickoff <= 24) {
      item = {
        priority: watched ? 84 : favorite ? 78 : 68,
        tone: 'reminder',
        kicker: 'НАПОМИНАНИЕ ВКЛЮЧЕНО',
        title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
        meta: `${dateTime(match.date)} · за ${Number(reminder.remindBeforeMinutes || state.preferences?.reminderMinutes || 30)} мин.`,
        action: 'center',
        fixtureId,
      };
    } else if (!match.finished && watched && hoursToKickoff >= 0 && hoursToKickoff <= 24) {
      item = {
        priority: 74 - Math.min(14, Math.max(0, hoursToKickoff * .5)),
        tone: 'watching',
        kicker: 'СЛЕЖУ ЗА МАТЧЕМ',
        title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
        meta: [dateTime(match.date), match.league || ''].filter(Boolean).join(' · '),
        action: 'center',
        fixtureId,
      };
    } else if (!match.finished && favorite && hoursToKickoff >= 0 && hoursToKickoff <= 6) {
      item = {
        priority: 64 - Math.min(18, Math.max(0, hoursToKickoff * 3)),
        tone: 'soon',
        kicker: 'СКОРО · ЛЮБИМАЯ КОМАНДА',
        title: `${match.home?.name || ''} — ${match.away?.name || ''}`,
        meta: [timeOf(match.date), match.league || ''].filter(Boolean).join(' · '),
        action: 'center',
        fixtureId,
      };
    }

    if (item) rows.push(item);
  }

  return rows
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .slice(0, 4);
}

function renderRadarFeed() {
  const wrap = $('radarFeedWrap');
  const list = $('radarFeedList');
  const meta = $('radarFeedMeta');
  if (!wrap || !list) return;

  const rows = radarFeedItems();
  if (!rows.length) {
    wrap.hidden = true;
    list.innerHTML = '';
    if (meta) meta.textContent = '';
    return;
  }

  wrap.hidden = false;
  if (meta) meta.textContent = russianCountLabel(rows.length, 'сигнал', 'сигнала', 'сигналов');
  list.innerHTML = rows.map(item => `
    <button class="radar-feed-item tone-${escapeHtml(item.tone || 'neutral')}" type="button"
      data-radar-fixture="${Number(item.fixtureId)}"
      data-radar-action="${escapeHtml(item.action || 'center')}">
      <span class="radar-feed-pulse" aria-hidden="true"></span>
      <span class="radar-feed-copy">
        <small>${escapeHtml(item.kicker || '')}</small>
        <strong>${escapeHtml(item.title || '')}</strong>
        <em>${escapeHtml(item.meta || '')}</em>
      </span>
      <b aria-hidden="true">→</b>
    </button>`).join('');

  list.querySelectorAll('[data-radar-fixture]').forEach(button => {
    button.addEventListener('click', () => {
      const fixtureId = Number(button.dataset.radarFixture || 0);
      if (!fixtureId) return;
      if (button.dataset.radarAction === 'history') {
        openHistoryAnalysis(fixtureId, button);
        return;
      }
      openMatchCenter(fixtureId, button);
    });
  });
}

function renderDailyOverview() {
  const root = $('dailyOverview');
  const personalCard = $('homePersonalMatchBtn');
  if (!root) return;

  const personalItem = homePersonalMatch();

  if (personalCard) {
    personalCard.hidden = !personalItem;
    personalCard.dataset.personalFixture = personalItem ? String(Number(personalItem.match.fixtureId || 0)) : '';
    personalCard.dataset.personalLive = personalItem?.match.live ? '1' : '0';
    const kicker = $('homePersonalMatchKicker');
    const text = $('homePersonalMatchText');
    const meta = $('homePersonalMatchMeta');
    if (kicker) kicker.textContent = personalItem?.match.live ? 'Для вас · LIVE' : 'Для вас';
    if (text) text.textContent = personalItem ? `${personalItem.match.home?.name || ''} — ${personalItem.match.away?.name || ''}` : 'Персональный матч';
    if (meta) meta.textContent = homePersonalMatchMeta(personalItem);
  }
  root.hidden = !personalItem;
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

function matchCenter(m) {
  if ((m.finished || m.live) && m.score?.home !== null && m.score?.home !== undefined && m.score?.away !== null && m.score?.away !== undefined) {
    return `${m.score.home} : ${m.score.away}`;
  }
  if (m.live) return `${m.score?.home ?? 0} : ${m.score?.away ?? 0}`;
  return 'VS';
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

function favoriteStarSvg(active = false) {
  return `<svg class="fav-star-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 3.7l2.55 5.17 5.71.83-4.13 4.03.98 5.69L12 16.73l-5.11 2.69.98-5.69-4.13-4.03 5.71-.83L12 3.7z"
      ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`;
}

function matchCardHtml(m, { grouped = false } = {}) {
  const aiHistory = analysisHistoryForFixture(m.fixtureId);
  const cardState = m.live ? 'is-live' : m.finished ? 'is-finished' : 'is-upcoming';
  const reminderActive = hasReminder(m.fixtureId);
  const reminderPending = state.reminderMutations.has(Number(m.fixtureId));
  const reminderMinutes = Number(state.preferences?.reminderMinutes || 30);
  const watchActive = isWatchedMatch(m.fixtureId);
  const liveMinute = Number(m.elapsed || 0) > 0 ? ` · ${Number(m.elapsed)}′` : '';
  const statusLabel = m.live
    ? `<b class="match-live-label">LIVE${liveMinute}</b>`
    : m.finished
      ? '<span class="match-finished-label">Завершён</span>'
      : `<span class="match-time-label">${escapeHtml(timeOf(m.date))}</span>`;
  const primaryAction = m.live
    ? `<button class="analyze-btn live-center-btn" type="button" data-center="${Number(m.fixtureId)}">Матч-центр</button>`
    : m.finished
      ? `<button class="analyze-btn finished-btn" type="button" data-center="${Number(m.fixtureId)}">Итоги матча</button>`
      : aiHistory
        ? `<button class="analyze-btn analyzed-btn" type="button" data-history-analysis="${Number(m.fixtureId)}">Открыть AI-разбор</button>`
        : `<button class="analyze-btn" type="button" data-fixture="${Number(m.fixtureId)}">AI-разбор</button>`;

  const favoriteButton = team => { const active = isFavorite(team?.id); return `<button class="fav-star compact ${active ? 'active' : ''} ${state.favoriteMutations.has(Number(team?.id)) ? 'is-pending' : ''}" type="button" data-team-id="${Number(team?.id)}" data-team-name="${escapeHtml(team?.name || '')}" data-team-logo="${escapeHtml(team?.logo || '')}" aria-pressed="${active ? 'true' : 'false'}" aria-label="${active ? 'Удалить из избранного' : 'Добавить в избранное'}: ${escapeHtml(team?.name || '')}" ${state.favoriteMutations.has(Number(team?.id)) ? 'disabled' : ''}>${favoriteStarSvg(active)}</button>`; };

  return `
    <article class="match-card compact-match-card ${cardState}">
      <div class="match-card-topline">
        <span class="competition-name">${escapeHtml(m.league || 'Турнир')}</span>
        ${statusLabel}
      </div>
      <div class="compact-match-row">
        <button class="team-open-link compact-team" type="button" data-open-team="${Number(m.home?.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}">
          ${m.home?.logo ? `<img src="${safeUrl(m.home.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
          <strong>${escapeHtml(m.home?.name || '')}</strong>
        </button>
        <div class="compact-score ${m.live ? 'score-live' : m.finished ? 'score-finished' : 'score-upcoming'}">${escapeHtml(matchCenter(m))}</div>
        <button class="team-open-link compact-team away" type="button" data-open-team="${Number(m.away?.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}">
          ${m.away?.logo ? `<img src="${safeUrl(m.away.logo)}" alt="">` : '<span class="team-logo-fallback">⚽</span>'}
          <strong>${escapeHtml(m.away?.name || '')}</strong>
        </button>
      </div>
      <div class="match-card-actions compact-actions single">${primaryAction}</div>
      <div class="match-secondary-actions" aria-label="Дополнительные действия">
        <span>${favoriteButton(m.home)}${favoriteButton(m.away)}</span>
        ${!m.finished ? `<button class="match-watch-btn compact ${watchActive ? 'active' : ''}" type="button" data-watch-fixture="${Number(m.fixtureId)}" aria-pressed="${watchActive ? 'true' : 'false'}" aria-label="${watchActive ? 'Перестать следить за матчем' : 'Следить за матчем'}">${watchActive ? '👁 Слежу' : '👁 Следить'}</button>` : ''}
        ${!m.live && !m.finished ? `<button class="quick-reminder-btn compact ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" data-quick-reminder="${Number(m.fixtureId)}" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderActive ? '🔔' : '🔕'} <span>${reminderActive ? 'Включено' : `${reminderMinutes} мин.`}</span></button>` : ''}
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
  root.querySelectorAll('[data-watch-fixture]').forEach(btn => btn.addEventListener('click', () => {
    const fixtureId = Number(btn.dataset.watchFixture);
    const match = state.matches.find(item => Number(item.fixtureId) === fixtureId);
    if (match) toggleMatchWatch(match);
  }));
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
function homeMatchSections(list, nowMs = Date.now()) {
  const soonWindowMs = 3 * 60 * 60 * 1000;
  const sections = [
    { key:'live', label:'Сейчас идут', tone:'live', matches:[] },
    { key:'soon', label:'Скоро начнутся', tone:'soon', matches:[] },
    { key:'later', label:'Позже', tone:'later', matches:[] },
    { key:'finished', label:'Завершённые', tone:'finished', matches:[] },
  ];
  for (const match of list) {
    if (match.live) {
      sections[0].matches.push(match);
      continue;
    }
    if (match.finished) {
      sections[3].matches.push(match);
      continue;
    }
    const kickoffMs = Date.parse(match.date || '');
    const startsInMs = Number.isFinite(kickoffMs) ? kickoffMs - nowMs : Number.POSITIVE_INFINITY;
    if (startsInMs >= 0 && startsInMs <= soonWindowMs) sections[1].matches.push(match);
    else sections[2].matches.push(match);
  }
  return sections.filter(section => section.matches.length);
}

function homeMatchSectionsHtml(list) {
  return homeMatchSections(list).map(section => {
    const cards = section.matches.map(match => matchCardHtml(match)).join('');
    const count = section.matches.length;
    if (section.key === 'later' || section.key === 'finished') {
      return `
        <details class="home-match-section home-match-section--${section.tone} is-collapsible" data-home-match-section="${section.key}">
          <summary class="home-match-section-head">
            <strong>${escapeHtml(section.label)}</strong>
            <span>${count}</span>
          </summary>
          <div class="home-match-section-list home-match-section-list--collapsed">
            ${cards}
          </div>
        </details>
      `;
    }
    return `
      <section class="home-match-section home-match-section--${section.tone}" data-home-match-section="${section.key}">
        <div class="home-match-section-head">
          <strong>${escapeHtml(section.label)}</strong>
          <span>${count}</span>
        </div>
        <div class="home-match-section-list">
          ${cards}
        </div>
      </section>
    `;
  }).join('');
}

function renderMatches() {
  const list = filteredMatches();
  const integrity = state.matchesMeta?.integrity || {};
  if ($('matchesCount')) $('matchesCount').textContent = '';
  renderDailyOverview();
  renderRadarFeed();
  renderAiFocus();
  renderAiCenterSummary();
  renderPopularCompetitions();

  if ($('dataNotice')) {
    const notices = [];
    if (state.matchesMeta?.stale && !state.matchesMeta?.refreshing) notices.push(`<div class="data-notice stale">⚠️ ${escapeHtml(state.matchesMeta.warning || 'Показаны последние сохранённые данные.')}</div>`);
    if (Number(integrity.quarantined || 0) > 0) notices.push('<div class="data-notice integrity-notice">Некоторые матчи временно скрыты, пока мы проверяем данные.</div>');
    $('dataNotice').innerHTML = notices.join('');
  }

  if (!list.length) {
    const filtered = state.filter !== 'all';
    const extra = filtered ? '<button id="showAllBtn" class="secondary-btn" type="button">Показать все матчи</button>' : '';
    $('matches').innerHTML = `<div class="empty match-empty-state">
      <strong>${filtered ? 'По этому фильтру матчей нет' : 'Матчей на эту дату пока нет'}</strong>
      <p>${filtered ? 'Снимите фильтр или найдите нужную команду через поиск.' : 'Попробуйте поиск по команде или выберите соседнюю дату.'}</p>
      <div class="empty-actions">${extra}<button id="matchesEmptySearch" class="primary-setting-btn" type="button">Найти матч</button></div>
    </div>`;
    $('showAllBtn')?.addEventListener('click', () => { state.filter = 'all'; syncFilterButtons(); renderMatches(); });
    $('matchesEmptySearch')?.addEventListener('click', () => {
      renderDiscoveryHome();
      renderGlobalSearch();
      showView('searchView');
      setTimeout(() => $('globalSearchInput')?.focus({ preventScroll: true }), 80);
    });
    return;
  }

  $('matches').innerHTML = homeMatchSectionsHtml(list);
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
          <td>${Number(row.team?.id || 0) > 0
            ? `<button class="standing-team team-open-link" type="button" data-open-team="${Number(row.team.id)}" data-team-name="${escapeHtml(row.team?.name || '')}" data-team-logo="${escapeHtml(row.team?.logo || '')}">${row.team?.logo ? `<img src="${safeUrl(row.team.logo)}" alt="">` : ''}<strong>${escapeHtml(row.team?.name || '')}</strong></button>`
            : `<span class="standing-team standing-team-readonly"><strong>${escapeHtml(row.team?.name || '')}</strong></span>`}</td>
          <td>${Number(row.played)}</td><td class="wide-stat">${Number(row.win)}</td><td class="wide-stat">${Number(row.draw)}</td><td class="wide-stat">${Number(row.lose)}</td>
          <td>${Number(row.goalsFor)}:${Number(row.goalsAgainst)}</td><td class="${Number(row.goalsDiff) > 0 ? 'positive' : Number(row.goalsDiff) < 0 ? 'negative' : ''}">${Number(row.goalsDiff) > 0 ? '+' : ''}${Number(row.goalsDiff)}</td><td><b>${Number(row.points)}</b></td><td>${standingFormHtml(row.form)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="tiny table-note">Источник: ${escapeHtml(data.sourceMeta?.label || 'API-Football')}${data.sourceMeta?.fallback ? ' · резервный источник' : ''}. ${data.sourceMeta?.attribution ? escapeHtml(data.sourceMeta.attribution) + '. ' : ''}Свежие данные сохраняются в общем кэше; резервные таблицы перепроверяются чаще основного источника.</p>
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
function teamPlayerSeasonStatsHtml(data = {}) {
  const p=data?.playerStats || {};
  const players=Array.isArray(p.players) ? p.players : [];
  const sourceLabel=String(p.sourceMeta?.label || p.sourceMeta?.provider || '');
  if (!p.available || !players.length) {
    const reason=String(p.reason || 'Статистика игроков сезона сейчас недоступна.');
    return `<section class="panel team-player-season-panel">
      <div class="mini-section-head"><strong>👤 Игроки сезона</strong><span>${escapeHtml(sourceLabel || 'по доступности')}</span></div>
      <div class="empty compact-empty">${escapeHtml(reason==='all_player_sources_unavailable' ? 'Статистика игроков сезона сейчас недоступна в настроенных источниках.' : reason==='quota_guard' ? 'Статистика игроков не запрашивается сейчас: сохраняем квоту источника данных.' : reason)}</div>
    </section>`;
  }

  const rows=players.slice(0,10);
  const scopeNote=p.complete
    ? `Полная доступная выборка команды · ${Number(p.summary?.count || players.length)} игроков`
    : p.scope==='competition-scorers'
      ? 'Резервный источник: показаны только игроки команды, присутствующие в таблице бомбардиров турнира.'
      : `Частичная выборка · загружено ${Number(p.summary?.pagesLoaded || 0)} из ${Number(p.summary?.pagesTotal || 0)} страниц`;
  const rowHtml=rows.map(player => {
    const yellow=Number(player.cards?.yellow || 0);
    const red=Number(player.cards?.red || 0)+Number(player.cards?.yellowRed || 0);
    const rating=player.games?.rating===null || player.games?.rating===undefined ? '—' : teamDecimal(player.games.rating);
    const availability=player.injured===true ? '<span class="player-season-alert">травмирован</span>' : '';
    return `<div class="player-season-row">
      <div class="player-season-name"><strong>${escapeHtml(player.name || 'Игрок')}</strong><small>${escapeHtml(player.games?.position || player.nationality || '—')} ${availability}</small></div>
      <span><small>Матчи</small><b>${Number(player.games?.appearances || 0)}</b></span>
      <span><small>Голы</small><b>${Number(player.goals?.total || 0)}</b></span>
      <span><small>Ассисты</small><b>${Number(player.goals?.assists || 0)}</b></span>
      <span><small>Рейтинг</small><b>${rating}</b></span>
      <span><small>Карточки</small><b>${yellow} / ${red}</b></span>
    </div>`;
  }).join('');

  return `<section class="panel team-player-season-panel">
    <div class="mini-section-head"><strong>👤 Игроки сезона</strong><span>${escapeHtml(sourceLabel || 'источник данных')}</span></div>
    <div class="player-season-table">
      <div class="player-season-head"><span>Игрок</span><span>М</span><span>Г</span><span>А</span><span>R</span><span>Ж / К</span></div>
      ${rowHtml}
    </div>
    <p class="tiny">${escapeHtml(scopeNote)}. Сортировка: голы, ассисты, матчи, минуты — без искусственного рейтинга.</p>
  </section>`;
}

function renderTeamIntelligence(data) {
  const el = $('teamIntelligence'); if (!el) return;
  if (!data?.available || !data?.stats?.available) {
    el.innerHTML = `<div class="empty compact-empty">${escapeHtml(data?.reason || 'Сезонная статистика для этой команды сейчас недоступна.')}</div>`;
    return;
  }
  const s=data.stats, f=s.fixtures||{}, d=s.derived||{}, g=s.goals||{}, b=s.biggest||{};
  const playerStatsHtml=teamPlayerSeasonStatsHtml(data);
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
    ${playerStatsHtml}
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

function lineupQualityLabel(lineup) {
  const quality = lineup?.quality || {};
  if (lineup?.quality?.confirmed === true) return `Подтверждён · ${Number(quality.startCount || 11)}/11`;
  if (quality.partial) return `Неполный состав · ${Number(quality.uniqueStartCount || quality.startCount || 0)}/11`;
  return 'Состав не подтверждён';
}

function lineupTeamHtml(lineup, title) {
  if (!lineup) return `<div class="center-lineup-team"><h3>${escapeHtml(title)}</h3><div class="empty compact-empty">Состав не опубликован.</div></div>`;
  const subs = lineup.substitutes || [];
  const quality = lineup.quality || {};
  const qualityNotice = quality.partial
    ? `<div class="data-notice">⚠️ Неполный состав источника: ${Number(quality.uniqueStartCount || quality.startCount || 0)}/11 уникальных игроков старта. До полного XI он не считается подтверждённым.</div>`
    : '';
  return `<div class="center-lineup-team">
    <div class="center-lineup-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(lineup.formation || 'Схема —')} · ${escapeHtml(lineupQualityLabel(lineup))}</span></div><div class="coach-chip">👔 ${escapeHtml(lineup.coach || 'Тренер —')}</div></div>
    ${qualityNotice}
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
  const id=Number(fixtureId);
  const key=String(id);
  const existing=state.matchCenterInFlight.get(key);
  if (existing) {
    state.clientPerf.deduped += 1;
    return await existing;
  }

  const seq = ++state.matchCenterRequestSeq;
  const params = new URLSearchParams({ fixtureId: key });
  Object.entries(extraParams || {}).forEach(([paramKey, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(paramKey, String(value));
  });

  const task=(async()=>{
    const data = await api(`/api/match-center?${params.toString()}`, options);
    return seq === state.matchCenterRequestSeq ? data : null;
  })();
  state.matchCenterInFlight.set(key,task);
  try {
    return await task;
  } finally {
    if (state.matchCenterInFlight.get(key)===task) state.matchCenterInFlight.delete(key);
  }
}

function updateLiveCountdown() {
  const el = $('liveRefreshText');
  if (!el || !state.currentCenter || state.currentCenter.mode !== 'live') return;
  el.textContent = 'Обновляется автоматически';
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
        const timingStartedAt = performance.now();
        const data = await requestMatchCenter(fixtureId, { t: Date.now() });
        if (!data) return;
        sendOperationTiming('live', timingStartedAt, 'analysisView');
        state.currentCenter = data;
        renderMatchCenter(data);
        if (data.mode !== 'live') stopLiveRefresh();
      } catch (e) {
        state.liveRefreshRemaining = Math.max(15, Number(state.currentCenter?.refreshSeconds || 60));
        const el = $('liveRefreshText');
        if (el) el.textContent = 'Не удалось обновить. Повторим автоматически.';
        sendActionError('live_refresh', e, 'analysisView');
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

function absenceKindLabel(row = {}) {
  if (row.categoryLabel) return String(row.categoryLabel);
  return ({ suspension:'Дисквалификация', injury:'Травма', illness:'Болезнь', other:'Другая причина' })[String(row.category || '')] || 'Потеря состава';
}

function absenceStatusLabel(row = {}) {
  if (row.statusLabel) return String(row.statusLabel);
  return row.status === 'doubtful' ? 'Под вопросом' : '';
}

function liveAbsencesHtml(absences, match) {
  const side = (title, rows = []) => `<div class="absence-live-side"><h3>${escapeHtml(title)}</h3>${rows.length
    ? rows.map(x => {
      const status=absenceStatusLabel(x);
      return `<div class="absence-live-row">
        <div class="absence-live-title"><strong>${escapeHtml(x.name || 'Игрок')}</strong><span class="absence-kind ${escapeHtml(String(x.category || 'other'))}">${escapeHtml(absenceKindLabel(x))}</span></div>
        <span>${escapeHtml(publicText(x.reason || x.type || status || 'Есть отметка о доступности'))}</span>
        ${status ? `<small>${escapeHtml(status)}</small>` : ''}
      </div>`;
    }).join('')
    : '<p class="muted">Активных отметок о потерях нет или данные недоступны.</p>'}</div>`;
  const reconciled=Number(absences?.summary?.resolvedByLineup || 0);
  return `<div class="absence-live-grid">${side(match.home?.name || 'Хозяева', absences?.home || [])}${side(match.away?.name || 'Гости', absences?.away || [])}</div>${reconciled ? `<p class="tiny">Сверка с опубликованными составами сняла устаревших отметок: ${reconciled}.</p>` : ''}`;
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

function availabilityQualityHintHtml(quality = {}) {
  if (!quality?.state || quality.state === 'unavailable') return '';
  const label = publicText(quality.label || 'Качество данных о потерях');
  const detail = quality.state === 'verified'
    ? `проверено записей: ${Number(quality.acceptedCount || 0)}`
    : quality.state === 'sanitized'
      ? `очищено перед аналитикой · исключено: ${Number(quality.rejectedCount || 0)}`
      : quality.state === 'source_untrusted'
        ? 'данные источника недостаточно свежие или подтверждённые'
        : 'некорректные записи исключены из модели';
  const limited = ['verified','sanitized'].includes(quality.state) ? '' : 'limited';
  return `<div class="coverage-badge ${limited}">Потери · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
}

function xgQualityHintHtml(quality = {}) {
  if (!quality?.state) return '';
  const trusted = Boolean(quality.confidenceBearing);
  const label = publicText(quality.label || (trusted ? 'xG подтверждён' : 'xG не используется'));
  const validSides = Number(quality.validSides || 0);
  const detail = trusted
    ? 'используется в live-инсайтах'
    : quality.state === 'partial'
      ? `доступно сторон: ${validSides}/2 · не используется для сравнения`
      : quality.state === 'source_untrusted'
        ? 'статистика источника недостаточно свежая или подтверждённая'
        : quality.state === 'invalid'
          ? 'некорректное значение исключено из аналитики'
          : 'полная пара xG сейчас недоступна';
  return `<div class="coverage-badge ${trusted ? '' : 'limited'}">xG · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
}

function eventQualityHintHtml(quality = {}) {
  if (!quality?.state || quality.state === 'unavailable') return '';
  const label = publicText(quality.label || 'Качество событий');
  const issues = Number(quality.rejectedCount || 0) + Number(quality.duplicateCount || 0) + Number(quality.unknownSideCount || 0);
  const detail = quality.state === 'verified'
    ? `проверено событий: ${Number(quality.displayCount || 0)}`
    : quality.state === 'sanitized'
      ? `очищено перед аналитикой · проблем: ${issues}`
      : quality.state === 'source_untrusted'
        ? 'данные источника недостаточно свежие или подтверждённые'
        : 'некорректные записи исключены';
  const limited = quality.state === 'verified' ? '' : 'limited';
  return `<div class="coverage-badge ${limited}">События · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
}

function statisticsQualityHintHtml(quality = {}) {
  if (!quality?.state || quality.state === 'unavailable') return '';
  const label = publicText(quality.label || 'Качество статистики');
  const issues = Number(quality.invalidCellCount || 0);
  const partial = Number(quality.partialPairCount || 0);
  const detail = quality.state === 'verified'
    ? `сравнимых метрик: ${Number(quality.analyticalRowCount || 0)}`
    : quality.state === 'sanitized'
      ? `очищено перед аналитикой · ошибок: ${issues} · неполных пар: ${partial}`
      : quality.state === 'source_untrusted'
        ? 'данные источника недостаточно свежие или подтверждённые'
        : 'некорректные значения исключены';
  const limited = quality.state === 'verified' ? '' : 'limited';
  return `<div class="coverage-badge ${limited}">Статистика · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
}

function oddsQualityHintHtml(quality = {}) {
  if (!quality?.state || quality.state === 'unavailable') return '';
  const label = publicText(quality.label || 'Качество рынка');
  const detail = quality.state === 'verified'
    ? `источников: ${Number(quality.sourceCount || 0)}`
    : quality.state === 'sanitized'
      ? 'вероятности пересчитаны из валидных коэффициентов'
      : quality.state === 'source_untrusted'
        ? 'данные источника недостаточно свежие или подтверждённые'
        : 'некорректный рынок исключён из аналитики';
  const limited = ['verified','sanitized'].includes(quality.state) ? '' : 'limited';
  return `<div class="coverage-badge ${limited}">Рынок · ${escapeHtml(label)} · ${escapeHtml(detail)}</div>`;
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
  const side = (title, teamSide, list = []) => `<div class="center-player-team"><h3>${escapeHtml(title)}</h3>${list.length ? list.map((p,i)=>`
    <button class="center-player-row center-player-open" type="button" data-center-player="${Number(p.id || 0)}" data-center-player-side="${escapeHtml(teamSide)}" aria-label="Открыть профиль игрока ${escapeHtml(p.name || 'Игрок')}">
      <div class="center-player-rank">${i+1}</div>
      ${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span class="center-player-avatar">👤</span>'}
      <div class="center-player-info"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(playerMetricText(p))}</small></div>
      <div class="center-player-rating">${p.rating ? p.rating.toFixed(1) : '—'}</div>
      <span class="center-player-chevron" aria-hidden="true">›</span>
    </button>`).join('') : '<div class="empty compact-empty">Статистика игроков недоступна.</div>'}</div>`;
  return `<div class="center-players-grid">${side(match.home?.name || 'Хозяева', 'home', leaders?.home || [])}${side(match.away?.name || 'Гости', 'away', leaders?.away || [])}</div>`;
}

function playerPositionLabel(value = '') {
  const key = String(value || '').trim().toLowerCase();
  return ({ g:'Вратарь', goalkeeper:'Вратарь', d:'Защитник', defender:'Защитник', m:'Полузащитник', midfielder:'Полузащитник', f:'Нападающий', attacker:'Нападающий' })[key] || publicText(value) || 'Позиция не указана';
}

function playerHubMetric(label, value, suffix = '') {
  const shown = value === null || value === undefined || value === '' ? '—' : `${escapeHtml(String(value))}${suffix}`;
  return `<div class="player-hub-metric"><span>${escapeHtml(label)}</span><strong>${shown}</strong></div>`;
}

function playerSquadProfile(data = {}, player = {}) {
  const targetId = Number(player?.data?.id || 0);
  const targetName = String(player?.data?.name || '').trim().toLowerCase();
  for (const group of (data?.groups || [])) {
    for (const item of (group?.players || [])) {
      const sameId = targetId > 0 && Number(item?.id || 0) === targetId;
      const sameName = !targetId && targetName && String(item?.name || '').trim().toLowerCase() === targetName;
      if (sameId || sameName) return {
        found: true,
        group: String(group?.label || 'Состав'),
        age: Number(item?.age || 0) || null,
        number: Number(item?.number || 0) || null,
        position: item?.position || player?.data?.position || '',
        photo: item?.photo || player?.data?.photo || '',
        stale: Boolean(data?.stale),
        warning: String(data?.warning || ''),
      };
    }
  }
  return { found: false, stale: Boolean(data?.stale), warning: String(data?.warning || '') };
}

function playerSquadProfileHtml(profile = {}) {
  if (profile.loading) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Сверяю с составом команды</p></div></div><div class="loader compact-loader">Загружаю профиль…</div></section>`;
  if (profile.error) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Дополнительные данные команды</p></div></div><div class="empty compact-empty">Профиль состава временно недоступен. Данные текущего матча остаются актуальными.</div></section>`;
  if (!profile.found) return `<section class="panel player-hub-profile"><div class="center-section-title"><div><h2>Профиль игрока</h2><p>Дополнительные данные команды</p></div></div><div class="empty compact-empty">Игрок не найден в текущем составе команды.</div></section>`;
  return `<section class="panel player-hub-profile">
    <div class="center-section-title"><div><h2>Профиль игрока</h2><p>Данные из текущего состава команды</p></div></div>
    ${profile.stale ? `<div class="data-notice stale">⚠️ ${escapeHtml(profile.warning || 'Показан сохранённый состав команды.')}</div>` : ''}
    <div class="player-hub-profile-grid">
      <div><span>Возраст</span><strong>${profile.age ?? '—'}</strong></div>
      <div><span>Номер</span><strong>${profile.number ? `№${profile.number}` : '—'}</strong></div>
      <div><span>Позиция</span><strong>${escapeHtml(playerPositionLabel(profile.position))}</strong></div>
      <div><span>Группа состава</span><strong>${escapeHtml(profile.group || '—')}</strong></div>
    </div>
    <p class="tiny">Профиль загружается лениво через уже существующий кэш состава команды и не создаёт отдельный запрос на сезонную статистику игрока.</p>
  </section>`;
}

async function loadPlayerSquadProfile(player = state.currentPlayer) {
  const teamId = Number(player?.team?.id || 0);
  if (!teamId || !player) return;
  const key = String(teamId);
  player.squadProfile = { loading: true };
  renderPlayerHub(player);
  try {
    let data = state.teamSquadCache.get(key);
    if (!data) {
      data = await api(`/api/team/squad?teamId=${teamId}`);
      state.teamSquadCache.set(key, data);
    }
    if (state.currentPlayer !== player) return;
    player.squadProfile = playerSquadProfile(data, player);
    if (player.squadProfile.photo && !player.data.photo) player.data.photo = player.squadProfile.photo;
    if (player.squadProfile.position && !player.data.position) player.data.position = player.squadProfile.position;
    renderPlayerHub(player);
  } catch (error) {
    if (state.currentPlayer !== player) return;
    player.squadProfile = { error: true, message: error?.message || 'Не удалось загрузить профиль.' };
    renderPlayerHub(player);
  }
}

function playerSeasonStatProfile(data = {}, player = {}) {
  const targetId = Number(player?.data?.id || 0);
  const targetName = String(player?.data?.name || '').trim().toLowerCase();
  const stats = data?.playerStats || {};
  const rows = Array.isArray(stats.players) ? stats.players : [];
  const found = rows.find(item => {
    const sameId = targetId > 0 && Number(item?.id || 0) === targetId;
    const sameName = targetName && String(item?.name || '').trim().toLowerCase() === targetName;
    return sameId || sameName;
  });
  if (!found) {
    return {
      found: false,
      available: Boolean(stats.available),
      partial: Boolean(stats.partial),
      sourceLabel: String(stats.sourceMeta?.label || stats.sourceMeta?.provider || ''),
      reason: String(stats.reason || ''),
    };
  }
  return {
    found: true,
    partial: Boolean(stats.partial || !stats.complete),
    sourceLabel: String(stats.sourceMeta?.label || stats.sourceMeta?.provider || ''),
    scope: String(stats.scope || ''),
    appearances: Number.isFinite(Number(found.games?.appearances)) ? Number(found.games.appearances) : null,
    lineups: Number.isFinite(Number(found.games?.lineups)) ? Number(found.games.lineups) : null,
    minutes: Number.isFinite(Number(found.games?.minutes)) ? Number(found.games.minutes) : null,
    rating: Number.isFinite(Number(found.games?.rating)) ? Number(found.games.rating) : null,
    goals: Number.isFinite(Number(found.goals?.total)) ? Number(found.goals.total) : null,
    assists: Number.isFinite(Number(found.goals?.assists)) ? Number(found.goals.assists) : null,
    keyPasses: Number.isFinite(Number(found.passes?.key)) ? Number(found.passes.key) : null,
    passAccuracy: Number.isFinite(Number(found.passes?.accuracy)) ? Number(found.passes.accuracy) : null,
    yellow: Number.isFinite(Number(found.cards?.yellow)) ? Number(found.cards.yellow) : null,
    red: Number.isFinite(Number(found.cards?.red)) ? Number(found.cards.red) + Number(found.cards?.yellowRed || 0) : null,
    injured: found.injured === true,
  };
}

function playerSeasonStatsHtml(profile = {}) {
  if (profile.loading) return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Собираю уже доступную статистику команды</p></div></div><div class="loader compact-loader">Загружаю сезонные показатели…</div></section>`;
  if (profile.error) return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Статистика игрока</p></div></div><div class="empty compact-empty">Сезонные показатели временно недоступны. Статистика текущего матча остаётся доступной.</div></section>`;
  if (!profile.found) {
    const detail = profile.reason === 'quota_guard'
      ? 'Источник сейчас бережёт квоту — отдельный запрос ради игрока не выполняется.'
      : 'Игрок не найден в доступной сезонной выборке команды.';
    return `<section class="panel player-hub-season"><div class="center-section-title"><div><h2>Сезон</h2><p>Статистика игрока</p></div></div><div class="empty compact-empty">${escapeHtml(detail)}</div></section>`;
  }
  const rating = profile.rating === null ? '—' : profile.rating.toFixed(2);
  const minutes = profile.minutes === null ? '—' : profile.minutes;
  const lineups = profile.lineups === null ? '—' : profile.lineups;
  const keyPasses = profile.keyPasses === null ? '—' : profile.keyPasses;
  const accuracy = profile.passAccuracy === null ? '—' : `${profile.passAccuracy}%`;
  return `<section class="panel player-hub-season">
    <div class="center-section-title"><div><h2>Показатели сезона</h2><p>${escapeHtml(profile.sourceLabel || 'Данные команды')}${profile.partial ? ' · частичное покрытие' : ''}</p></div></div>
    ${profile.injured ? '<div class="data-notice stale">⚠️ В сезонных данных игрок отмечен как травмированный.</div>' : ''}
    <div class="player-hub-season-grid">
      ${playerHubMetric('Матчи', profile.appearances)}
      ${playerHubMetric('В старте', lineups)}
      ${playerHubMetric('Минуты', minutes)}
      ${playerHubMetric('Голы', profile.goals)}
      ${playerHubMetric('Ассисты', profile.assists)}
      ${playerHubMetric('Рейтинг', rating)}
      ${playerHubMetric('Ключ. передачи', keyPasses)}
      ${playerHubMetric('Точность паса', accuracy)}
      ${playerHubMetric('Жёлтые', profile.yellow === null ? '—' : profile.yellow)}
      ${playerHubMetric('Красные', profile.red === null ? '—' : profile.red)}
    </div>
    <p class="tiny">Player Hub использует общий Team Intelligence cache. Отдельного player endpoint и отдельного запроса только ради этого профиля нет.</p>
  </section>`;
}

async function loadPlayerSeasonStats(player = state.currentPlayer) {
  const teamId = Number(player?.team?.id || 0);
  const leagueId = Number(player?.match?.leagueId || 0);
  const season = Number(player?.match?.season || 0);
  if (!player || !teamId || !leagueId || !season) {
    if (player) {
      player.seasonStats = { found:false, reason:'competition_context_missing' };
      renderPlayerHub(player);
    }
    return;
  }

  const key = `${teamId}:${leagueId}:${season}`;
  player.seasonStats = { loading:true };
  renderPlayerHub(player);
  try {
    let data = state.teamIntelligenceCache.get(key);
    if (!data) {
      const q = new URLSearchParams({
        teamId:String(teamId),
        leagueId:String(leagueId),
        season:String(season),
        teamName:String(player.team?.name || ''),
        teamLogo:String(player.team?.logo || ''),
        leagueName:String(player.match?.league || ''),
        leagueLogo:String(player.match?.leagueLogo || ''),
        country:String(player.match?.country || ''),
      });
      data = await api(`/api/team/intelligence?${q.toString()}`);
      state.teamIntelligenceCache.set(key, data);
    }
    if (state.currentPlayer !== player) return;
    player.seasonStats = playerSeasonStatProfile(data, player);
    renderPlayerHub(player);
  } catch (error) {
    if (state.currentPlayer !== player) return;
    player.seasonStats = { error:true, message:error?.message || 'Не удалось загрузить сезонные показатели.' };
    renderPlayerHub(player);
  }
}


function playerComparisonSquadSources(player = state.currentPlayer) {
  const match = player?.match || {};
  const teams = [player?.team, match?.home, match?.away].filter(Boolean);
  const seen = new Set();
  return teams.flatMap(team => {
    const teamId = Number(team?.id || 0);
    if (!teamId || seen.has(teamId)) return [];
    seen.add(teamId);
    const data = state.teamSquadCache.get(String(teamId));
    return data ? [{ team:{ ...team }, data }] : [];
  });
}

function enrichPlayerComparisonCandidate(candidate = {}) {
  const teamId = Number(candidate?.team?.id || 0);
  const leagueId = Number(candidate?.match?.leagueId || 0);
  const season = Number(candidate?.match?.season || 0);
  if (teamId && !candidate.squadProfile) {
    const squadData = state.teamSquadCache.get(String(teamId));
    if (squadData) candidate.squadProfile = playerSquadProfile(squadData, candidate);
  }
  if (teamId && leagueId && season && !candidate.seasonStats) {
    const intelligenceKey = `${teamId}:${leagueId}:${season}`;
    const data = state.teamIntelligenceCache.get(intelligenceKey);
    if (data) candidate.seasonStats = playerSeasonStatProfile(data, candidate);
  }
  return candidate;
}

function playerComparisonCandidatesFor(player = state.currentPlayer) {
  return buildPlayerComparisonCandidates(player, {
    center: state.currentCenter || {},
    squads: playerComparisonSquadSources(player),
  }).map(enrichPlayerComparisonCandidate);
}

async function hydrateComparisonPlayer(primary, secondary) {
  if (!primary || !secondary || samePlayer(primary, secondary)) return;
  const comparison = primary.comparison || (primary.comparison = { open:true });
  const requestSeq = ++state.playerComparisonRequestSeq;
  comparison.loading = true;
  comparison.error = '';
  renderPlayerHub(primary);

  try {
    const teamId = Number(secondary?.team?.id || 0);
    const leagueId = Number(secondary?.match?.leagueId || 0);
    const season = Number(secondary?.match?.season || 0);

    if (teamId && !secondary.squadProfile?.found) {
      let squadData = state.teamSquadCache.get(String(teamId));
      if (!squadData) {
        squadData = await api(`/api/team/squad?teamId=${teamId}`);
        state.teamSquadCache.set(String(teamId), squadData);
      }
      secondary.squadProfile = playerSquadProfile(squadData, secondary);
      if (secondary.squadProfile?.photo && !secondary.data?.photo) secondary.data.photo = secondary.squadProfile.photo;
      if (secondary.squadProfile?.position && !secondary.data?.position) secondary.data.position = secondary.squadProfile.position;
    }

    if (teamId && leagueId && season && !secondary.seasonStats?.found) {
      const intelligenceKey = `${teamId}:${leagueId}:${season}`;
      let data = state.teamIntelligenceCache.get(intelligenceKey);
      if (!data) {
        const q = new URLSearchParams({
          teamId:String(teamId),
          leagueId:String(leagueId),
          season:String(season),
          teamName:String(secondary.team?.name || ''),
          teamLogo:String(secondary.team?.logo || ''),
          leagueName:String(secondary.match?.league || ''),
          leagueLogo:String(secondary.match?.leagueLogo || ''),
          country:String(secondary.match?.country || ''),
        });
        data = await api(`/api/team/intelligence?${q.toString()}`);
        state.teamIntelligenceCache.set(intelligenceKey, data);
      }
      secondary.seasonStats = playerSeasonStatProfile(data, secondary);
    } else if (!secondary.seasonStats && (!teamId || !leagueId || !season)) {
      secondary.seasonStats = { found:false, reason:'competition_context_missing' };
    }
  } catch (error) {
    comparison.error = friendlyErrorMessage(error);
  } finally {
    if (state.currentPlayer !== primary || requestSeq !== state.playerComparisonRequestSeq) return;
    comparison.loading = false;
    renderPlayerHub(primary);
  }
}

function bindPlayerComparisonActions(player, candidates = []) {
  const root = $('playerHub');
  if (!root || !player) return;
  root.querySelector('[data-player-comparison-open]')?.addEventListener('click', () => {
    player.comparison = { ...(player.comparison || {}), open:true, error:'' };
    renderPlayerHub(player);
  });
  root.querySelector('[data-player-comparison-close]')?.addEventListener('click', () => {
    player.comparison = { open:false, secondary:null, loading:false, error:'' };
    state.playerComparisonRequestSeq += 1;
    renderPlayerHub(player);
  });
  root.querySelector('[data-player-comparison-change]')?.addEventListener('click', () => {
    player.comparison = { ...(player.comparison || {}), open:true, secondary:null, loading:false, error:'' };
    state.playerComparisonRequestSeq += 1;
    renderPlayerHub(player);
  });
  root.querySelectorAll('[data-player-comparison-candidate]').forEach(button => button.addEventListener('click', () => {
    const candidate = candidates[Number(button.dataset.playerComparisonCandidate || -1)];
    if (!candidate) return;
    if (samePlayer(player, candidate)) return toast('Нельзя сравнить игрока с самим собой.');
    player.comparison = { open:true, secondary:candidate, loading:false, error:'' };
    renderPlayerHub(player);
    void hydrateComparisonPlayer(player, candidate);
  }));
}

function renderPlayerHub(player = state.currentPlayer) {
  const root = $('playerHub');
  if (!root) return;
  if (!player) {
    root.innerHTML = '<div class="empty">Игрок не выбран.</div>';
    return;
  }
  const match = player.match || {};
  const team = player.team || {};
  const p = player.data || {};
  const rating = Number.isFinite(Number(p.rating)) ? Number(p.rating).toFixed(1) : '—';
  root.innerHTML = `
    <section class="panel player-hub-hero">
      <div class="player-hub-main">
        <div class="player-hub-photo">${p.photo ? `<img src="${safeUrl(p.photo)}" alt="">` : '<span>👤</span>'}</div>
        <div class="player-hub-copy">
          <span>PLAYER HUB · ТЕКУЩИЙ МАТЧ</span>
          <h2>${escapeHtml(p.name || 'Игрок')}</h2>
          <p>${escapeHtml(team.name || 'Команда')} · ${escapeHtml(playerPositionLabel(p.position))}</p>
        </div>
        <div class="player-hub-rating"><span>Рейтинг</span><strong>${rating}</strong></div>
      </div>
      <div class="player-hub-match">
        <span>${escapeHtml(match.league || '')}</span>
        <strong>${escapeHtml(match.home?.name || '')} — ${escapeHtml(match.away?.name || '')}</strong>
        <small>${escapeHtml(match.statusLabel || '')}</small>
      </div>
      <div class="player-hub-actions">
        ${playerFollowModule.controlHtml(player)}
        <button class="btn secondary" type="button" data-player-comparison-open>⚖️ Сравнить</button>
      </div>
    </section>

    ${player.comparison?.open ? playerComparisonHtml({
      primary:player,
      secondary:player.comparison?.secondary || null,
      candidates:playerComparisonCandidatesFor(player),
      loading:Boolean(player.comparison?.loading),
      error:String(player.comparison?.error || ''),
    }) : ''}

    ${playerSquadProfileHtml(player.squadProfile || {})}
    ${playerSeasonStatsHtml(player.seasonStats || {})}

    <section class="panel">
      <div class="center-section-title"><div><h2>Показатели в матче</h2><p>Только данные, уже полученные для этого матча</p></div></div>
      <div class="player-hub-metrics">
        ${playerHubMetric('Минуты', Number(p.minutes || 0))}
        ${playerHubMetric('Голы', Number(p.goals || 0))}
        ${playerHubMetric('Ассисты', Number(p.assists || 0))}
        ${playerHubMetric('Удары в створ', Number(p.shotsOn || 0))}
        ${playerHubMetric('Ключевые передачи', Number(p.keyPasses || 0))}
        ${playerHubMetric('Отборы', Number(p.tackles || 0))}
        ${playerHubMetric('Перехваты', Number(p.interceptions || 0))}
        ${playerHubMetric('Сейвы', Number(p.saves || 0))}
      </div>
    </section>

    <section class="panel player-hub-context">
      <div class="center-section-title"><div><h2>Роль в текущем матче</h2><p>Краткий контекст без дополнительного запроса к источнику</p></div></div>
      <div class="player-hub-context-grid">
        <div><span>Позиция</span><strong>${escapeHtml(playerPositionLabel(p.position))}</strong></div>
        <div><span>Impact</span><strong>${Number.isFinite(Number(p.impact)) ? Number(p.impact).toFixed(1) : '—'}</strong></div>
        <div><span>Команда</span><strong>${escapeHtml(team.name || '—')}</strong></div>
        <div><span>Источник</span><strong>данные матча</strong></div>
      </div>
      <p class="tiny">Контекст матча остаётся независимым от сезонной выборки: если сезонные данные ограничены квотой или покрытием, текущая статистика игрока продолжает отображаться.</p>
    </section>
  `;
  bindPlayerComparisonActions(player, playerComparisonCandidatesFor(player));
  playerFollowModule.bind(root, player);
}

function openPlayerFromMatch(playerId, side = '') {
  const center = state.currentCenter || {};
  const match = center.match || {};
  const key = side === 'away' ? 'away' : 'home';
  const player = (center.playerLeaders?.[key] || []).find(item => Number(item.id || 0) === Number(playerId || 0));
  if (!player) return toast('Данные игрока для этого матча уже недоступны.');
  const current = activeViewId();
  if (current !== 'playerView') state.playerBackView = current || 'analysisView';
  state.currentPlayer = {
    data: { ...player },
    team: { ...(match[key] || {}) },
    match: { ...match },
    source: 'match_center',
  };
  renderPlayerHub();
  sendProductAction('player_open', current || 'analysisView');
  showView('playerView');
  if (!state.favoritePlayersLoaded && !state.favoritePlayersLoading) void loadFavoritePlayers();
  void loadPlayerSquadProfile(state.currentPlayer);
  void loadPlayerSeasonStats(state.currentPlayer);
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
    ['xG', d.availability?.xg],
    ['Составы', d.availability?.lineups],
    ['Игроки', d.availability?.players],
    ['Потери', d.availability?.injuries],
    ['Рынок', Boolean(d.availability?.liveOdds)],
  ];
  return `<div class="center-coverage">${cells.map(([label,ok])=>`<span class="${ok?'ok':''}">${ok?'✓':'·'} ${label}</span>`).join('')}</div>`;
}

function centerMarketHtml(d) {
  const quality = oddsQualityHintHtml(d.liveOddsQuality);
  if (!d.liveOdds) return `${quality}<div class="empty compact-empty">Коэффициенты П1 / Н / П2 в реальном времени сейчас недоступны. Покрытие зависит от турнира и режима данных.</div>`;
  return `${quality}<div class="center-market">
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
  const side = (name, rows = [], summary = {}) => {
    const total=rows.length;
    const injury=Number(summary.injury || 0)+Number(summary.illness || 0);
    const suspension=Number(summary.suspension || 0);
    const doubtful=Number(summary.doubtful || 0);
    return `<div>
      <span>${escapeHtml(name)}</span><strong>${total}</strong><small>активных отметок</small>
      <p>${injury ? `🚑 ${injury}` : ''}${suspension ? `${injury ? ' · ' : ''}🟥 ${suspension}` : ''}${doubtful ? `${injury || suspension ? ' · ' : ''}❔ ${doubtful}` : ''}</p>
    </div>`;
  };
  const hc = absences?.home?.length || 0;
  const ac = absences?.away?.length || 0;
  if (!hc && !ac) return '';
  return `<div class="center-absence-summary">
    ${side(match.home?.name || 'Хозяева', absences?.home || [], absences?.summary?.home || {})}
    ${side(match.away?.name || 'Гости', absences?.away || [], absences?.summary?.away || {})}
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

function matchChangeNarrativeHtml(d = {}, match = {}) {
  const items = [];
  const mode = String(d.mode || '');
  const events = Array.isArray(d.events) ? d.events : [];
  const latest = [...events].reverse().find(event => {
    const type = String(event?.type || '').toLowerCase();
    const detail = String(event?.detail || '').toLowerCase();
    return type.includes('goal')
      || type.includes('card')
      || type.includes('subst')
      || detail.includes('goal')
      || detail.includes('card')
      || detail.includes('subst');
  });

  if (latest && mode !== 'upcoming') {
    const type = String(latest.type || '').toLowerCase();
    const detail = String(latest.detail || '').toLowerCase();
    const icon = type.includes('goal') || detail.includes('goal')
      ? '⚽'
      : type.includes('card') || detail.includes('card')
        ? '🟨'
        : '🔄';
    const actor = latest.player || latest.teamName || (latest.side === 'home' ? match.home?.name : latest.side === 'away' ? match.away?.name : '');
    items.push({
      icon,
      title: `${minuteLabel(latest)} · ${publicText(latest.label || latest.detail || latest.type || 'Событие матча')}`,
      text: actor ? String(actor) : 'Новое событие в хронологии матча.',
      tone: type.includes('goal') || detail.includes('goal') ? 'strong' : 'neutral',
    });
  }

  if (mode === 'live' && d.livePressure) {
    const home = Number(d.livePressure.home);
    const away = Number.isFinite(Number(d.livePressure.away)) ? Number(d.livePressure.away) : (Number.isFinite(home) ? 100 - home : NaN);
    const leader = d.livePressure.leader === 'home'
      ? match.home?.name
      : d.livePressure.leader === 'away'
        ? match.away?.name
        : '';
    if (leader && Number.isFinite(home) && Number.isFinite(away) && Math.abs(home - away) >= 12) {
      items.push({
        icon: '⚡',
        title: `${leader} усилил давление`,
        text: `Текущий индекс давления: ${Math.round(home)}:${Math.round(away)}.`,
        tone: 'strong',
      });
    }
  }

  const movement = d.oddsMovement?.probabilityChange || null;
  if (movement && typeof movement === 'object') {
    const labels = {
      home: match.home?.name || 'П1',
      draw: 'Ничья',
      away: match.away?.name || 'П2',
    };
    const strongest = Object.entries(movement)
      .map(([key, value]) => ({ key, value: Number(value) }))
      .filter(row => Number.isFinite(row.value))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    if (strongest && Math.abs(strongest.value) >= 0.5) {
      items.push({
        icon: strongest.value > 0 ? '📈' : '📉',
        title: `Изменилась оценка: ${labels[strongest.key] || strongest.key}`,
        text: `Сдвиг расчётной рыночной вероятности: ${signedPp(strongest.value)}.`,
        tone: strongest.value > 0 ? 'up' : 'down',
      });
    }
  }

  if (mode === 'upcoming') {
    const homeAbsences = Number(d.absences?.home?.length || 0);
    const awayAbsences = Number(d.absences?.away?.length || 0);
    const totalAbsences = homeAbsences + awayAbsences;
    if (totalAbsences > 0) {
      items.push({
        icon: '🩺',
        title: 'Есть изменения по доступности игроков',
        text: `${match.home?.name || 'Хозяева'}: ${homeAbsences} · ${match.away?.name || 'Гости'}: ${awayAbsences}.`,
        tone: 'neutral',
      });
    }
  }

  if (!items.length) return '';
  const visible = items.slice(0, 3);
  return `<section class="panel match-change-panel">
    <div class="center-section-title">
      <div><span class="center-priority-label">RADAR</span><h2>Что изменилось</h2><p>Последние сигналы, которые реально меняют картину матча</p></div>
    </div>
    <div class="match-change-list">
      ${visible.map(item => `<article class="match-change-item ${escapeHtml(item.tone || 'neutral')}">
        <span class="match-change-icon">${escapeHtml(item.icon || '•')}</span>
        <div><strong>${escapeHtml(publicText(item.title || ''))}</strong><p>${escapeHtml(publicText(item.text || ''))}</p></div>
      </article>`).join('')}
    </div>
  </section>`;
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
  const xgQualityLabel = publicText(ai.current?.xgQuality?.label || '');
  const watch = Array.isArray(ai.watchNext) ? ai.watchNext.slice(0,3) : [];
  return `<section class="panel live-ai-coach ${tone}">
    <div class="live-ai-head"><div><span>AI В ЭФИРЕ · ${Number(match.elapsed || 0) ? `${Number(match.elapsed)}′` : 'сейчас'}</span><h2>${escapeHtml(publicText(ai.headline || 'Читаю матч в реальном времени'))}</h2></div><b>${Math.round(Number(ai.confidence || 0))}%</b></div>
    <p class="live-ai-summary">${escapeHtml(publicText(ai.summary || ''))}</p>
    <div class="live-ai-decision"><span>Решение AI сейчас</span><strong>${escapeHtml(publicText(ai.action?.label || 'Наблюдать'))}</strong><small>${escapeHtml(publicText(ai.action?.reason || 'Дождитесь более устойчивой картины.'))}</small></div>
    <div class="live-ai-grid">
      <div><span>Счёт</span><strong>${match.score?.home ?? 0}:${match.score?.away ?? 0}</strong><small>${Number(match.elapsed || 0) ? `${Number(match.elapsed)} мин.` : 'Матч идёт'}</small></div>
      <div><span>Давление</span><strong>${pressureText}</strong><small>${escapeHtml(publicText(ai.current?.pressureLeaderLabel || 'Баланс'))}</small></div>
      <div><span>xG</span><strong>${xgText}</strong><small>${escapeHtml(publicText(ai.current?.chanceLabel || 'По доступным данным'))}${xgQualityLabel ? ` · ${escapeHtml(xgQualityLabel)}` : ''}</small></div>
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
  $('analysis')?.setAttribute('aria-busy', 'false');
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
      <div class="center-brand-kicker">MatchRadar · Центр матча</div>
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
          ${live ? '<small id="liveRefreshText">Обновляется автоматически</small>' : `<small>${upcoming ? dateTime(m.date) : `Обновлено ${dateTime(d.generatedAt)}`}</small>`}
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
      </div>

      <div class="center-hero-actions ${isAdmin() ? 'has-admin-audit' : ''}">
        <button id="centerRefreshBtn" class="reminder-btn" type="button">↻ Обновить</button>
        ${upcoming ? `<button id="centerAnalyzeBtn" class="primary-btn center-analyze-inline" type="button">🧠 Полный анализ</button><button id="centerMatchPassBtn" class="reminder-btn center-pass-btn" type="button">⭐ Pass на матч</button>` : ''}
        ${isAdmin() ? `<button id="centerCoverageAuditBtn" class="reminder-btn admin-audit-btn" type="button">🧪 Покрытие</button>` : ''}
        ${isAdmin() ? `<button id="centerE2EBtn" class="reminder-btn admin-e2e-btn" type="button">🚦 E2E</button>` : ''}
      </div>
    </section>

    ${renderMatchPulse(d)}

    ${renderAiTimelineCompact(d.aiTimeline || {}, m)}

    ${d.note ? `<section class="panel center-note"><p class="tiny warning">${escapeHtml(publicText(d.note))}</p></section>` : ''}

    <div class="match-center-primary" aria-label="Главное о матче">
      ${matchChangeNarrativeHtml(d, m)}
      ${renderAiTimelineDetails(d.aiTimeline || {}, m)}
      ${live ? liveAiCoachHtml(d.liveAiCoach, m) : ''}
      ${smartInsightsHeroHtml(d.smartInsights, m)}
      ${finished ? postMatchReviewHtml(d.postMatchReview || {}, m) : ''}

      <section class="panel center-primary-metrics">
        <div class="center-section-title"><div><span class="center-priority-label">ГЛАВНОЕ</span><h2>Ключевые показатели</h2><p>Самые полезные метрики без перегрузки</p></div></div>
        ${centerKeyStatsHtml(d.statistics)}
      </section>

      ${latestEvents.length ? `<section class="panel center-primary-events"><div class="center-section-title"><div><span class="center-priority-label">СЕЙЧАС</span><h2>Последние события</h2><p>Что недавно изменило ход матча</p></div></div>${liveEventsHtml(latestEvents)}</section>` : ''}
    </div>

    <details class="match-center-more">
      <summary>Статистика, составы и хронология</summary>
      <div class="match-center-more-body">
      <div class="center-tabs-wrap">
      <div class="center-tabs" role="tablist" aria-label="Разделы матча">
        <button class="center-tab-btn" data-center-tab="summary" type="button">Данные</button>
        <button class="center-tab-btn" data-center-tab="insights" type="button">Инсайты</button>
        <button class="center-tab-btn" data-center-tab="timeline" type="button">Хронология</button>
        <button class="center-tab-btn" data-center-tab="stats" type="button">Статистика</button>
        <button class="center-tab-btn" data-center-tab="lineups" type="button">Составы</button>
        <button class="center-tab-btn" data-center-tab="players" type="button">Игроки</button>
        <button class="center-tab-btn" data-center-tab="market" type="button">Рынок</button>
      </div>
    </div>

    <div class="center-tab-panel" data-center-panel="summary">
      ${(d.availabilityQuality?.observed || d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><div class="center-section-title"><div><h2>🩺 Потери состава</h2><p>Доступность игроков и важные отсутствия</p></div></div>${centerAbsenceSummary(d.absences,m)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}

      <details class="panel analysis-disclosure coverage-panel">
        <summary>Подробнее о данных</summary>
        <div class="analysis-disclosure-body">
        <div class="center-section-title"><div><h2>Покрытие и свежесть</h2><p>${d.cached ? 'Данные из сохранённой версии' : 'Свежие данные источника'} · ${dateTime(d.generatedAt)}</p></div></div>
        ${centerCoverageHtml(d)}
        ${centerFreshnessHtml(d)}
        ${d.quotaMode ? `<div class="quota-public-chip">${escapeHtml(publicText(d.quotaMode.label || ''))} · обновление ${Number(d.quotaMode.liveRefreshSeconds || d.refreshSeconds || 0)} сек.</div>` : ''}
        ${d.availability?.limitedCoverage ? '<div class="coverage-badge limited">Ограниченное покрытие · экономим лимит запросов</div>' : ''}

        </div>
      </details>
    </div>

    <div class="center-tab-panel" data-center-panel="insights">
      ${smartInsightsFullHtml(d.smartInsights, m)}
    </div>

    <div class="center-tab-panel" data-center-panel="timeline">
      <section class="panel">
        <div class="center-section-title"><div><h2>⚡ Хронология матча</h2><p>Голы, карточки, замены и видеопросмотры</p></div></div>
        ${eventQualityHintHtml(d.eventQuality)}
        ${timelineEventsHtml(d.events, m)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="stats">
      <section class="panel">
        <div class="center-section-title"><div><h2>📊 Статистика матча</h2><p>Сравнение команд по доступным показателям</p></div></div>
        ${statisticsQualityHintHtml(d.statisticsQuality)}
        ${xgQualityHintHtml(d.xgQuality)}
        ${centerAllStatsHtml(d.statistics)}
      </section>
    </div>

    <div class="center-tab-panel" data-center-panel="lineups">
      <section class="panel">
        <div class="center-section-title"><div><h2>👥 Составы и схема</h2><p>Стартовые составы, схемы и запасные</p></div></div>
        ${lineupLiveHtml(d.lineups, m)}
      </section>
      ${(d.availabilityQuality?.observed || d.absences?.home?.length || d.absences?.away?.length) ? `<section class="panel"><h2>🩺 Потери и сомнения</h2>${availabilityQualityHintHtml(d.availabilityQuality)}${liveAbsencesHtml(d.absences,m)}</section>` : ''}
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
    ${m.referee ? `<section class="panel analysis-referee-line"><h2>Судья</h2><p>${escapeHtml(m.referee)}</p></section>` : ''}
      </div>
    </details>
  `;

  bindMatchCenterTabs();
  document.querySelectorAll('.smart-open-insights').forEach(btn => btn.addEventListener('click', () => {
    const details = document.querySelector('.match-center-more');
    if (details) details.open = true;
    setMatchCenterTab('insights', false);
    requestAnimationFrame(() => {
      document.querySelector('[data-center-panel="insights"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }));

  document.querySelectorAll('[data-center-player]').forEach(btn => btn.addEventListener('click', () => {
    openPlayerFromMatch(Number(btn.dataset.centerPlayer || 0), btn.dataset.centerPlayerSide || '');
  }));

  document.querySelectorAll('[data-center-team]').forEach(btn => btn.addEventListener('click', () => {
    const teamId = Number(btn.dataset.centerTeam || 0);
    if (!teamId) return;
    openTeam(teamId, btn);
  }));

  $('centerAnalyzeBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget));
  $('centerMatchPassBtn')?.addEventListener('click', () => { void billingModule.openPassStoreForFixture(Number(m.fixtureId)); });
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
  const timingStartedAt = performance.now();
  const reusableCenter = Number(state.currentCenter?.match?.fixtureId || 0) === Number(fixtureId)
    ? state.currentCenter
    : null;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Загружаю матч…'; }
  showView('analysisView');
  if (reusableCenter) {
    renderMatchCenter(reusableCenter);
  } else {
    renderJourneyState('loading', {
      title: 'Открываем матч',
      message: 'Загружаем счёт, события и доступную статистику.',
    });
  }
  try {
    const data = await requestMatchCenter(fixtureId);
    if (!data) return;
    renderMatchCenter(data);
    sendProductAction('match_open', sourceView);
    sendMatchDataCoverage(data, sourceView);
    sendOperationTiming('match', timingStartedAt, sourceView);
    if (data.mode === 'live') {
      sendProductAction('live_open', sourceView);
      sendOperationTiming('live', timingStartedAt, sourceView);
    }
  } catch (e) {
    sendActionError('match', e, sourceView);
    const category=apiErrorCategory(e);
    const previous=Number(state.currentCenter?.match?.fixtureId || 0)===Number(fixtureId) ? state.currentCenter : null;
    if (['rate_limit','provider'].includes(category)) {
      if (previous) {
        renderMatchCenter(previous);
      } else if (sourceView && sourceView !== 'analysisView') {
        showView(sourceView, { restore:true });
      }
      toast(friendlyErrorMessage(e));
    } else {
      renderJourneyState('error', {
        title: 'Матч временно не открылся',
        message: e.message || 'Не удалось получить данные матча.',
        retry: () => openMatchCenter(fixtureId, null),
      });
    }
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
  hideQuotaPaywall();
  const previousCenter=state.currentCenter;
  state.currentCenter = null;
  state.analysisActionPending = true;
  syncAnalysisBusyUi();
  sendProductAction('ai_start', sourceView);
  const timingStartedAt = performance.now();
  const movedToAnalysis = sourceView !== 'analysisView';
  if (movedToAnalysis) {
    showView('analysisView');
    renderJourneyState('loading', {
      title: 'Готовим AI-анализ',
      message: 'Собираем данные матча и проверяем основные факторы.',
    });
  }
  const original = btn?.textContent || '';
  if (btn) btn.textContent = '⏳ Собираю данные…';
  try {
    const data = await api('/api/analyze', { method: 'POST', body: JSON.stringify({
      fixtureId,
      origin:'miniapp',
      recheck: options.recheck !== false,
      newsImpactDecision:String(options.newsImpactDecision || '').toLowerCase().slice(0,24),
      newsImpactAction:String(options.newsImpactAction || '').toLowerCase().slice(0,24),
      newsImpactRecoveryCode:String(options.newsImpactRecoveryCode || '').toLowerCase().slice(0,24),
      newsImpactRecoveryFrom:String(options.newsImpactRecoveryFrom || '').toLowerCase().slice(0,24),
    }) });
    if (isAdmin() && data.provider?.visibility === 'admin') { state.provider = data.provider; renderProvider(); }
    renderAnalysis(data);
    rememberHistoryAnalysis(data);
    sendProductAction('ai_complete', sourceView);
    sendOperationTiming('ai', timingStartedAt, sourceView);
    if (state.profile && data.quota) {
      state.profile.quota = data.quota;
      renderProfile();
    }
    showView('analysisView');
    const secondaryTasks = [loadHistory(false)];
    if (!state.remindersLoaded) secondaryTasks.push(loadReminders());
    if (!state.favoritesLoaded) secondaryTasks.push(loadFavorites());
    void Promise.allSettled(secondaryTasks);
  } catch (e) {
    const recovery=e.payload?.newsImpactRecovery || null;
    const quotaExhausted = e.status === 429 && !String(e.payload?.code || '').startsWith('FOOTBALL_');
    if (quotaExhausted) showQuotaPaywallForFixture(fixtureId);
    if (recovery?.message) {
      toast(recovery.message);
      if (recovery.action==='search') {
        renderDiscoveryHome();
        renderGlobalSearch();
        showView('searchView');
      }
    } else if (e.status === 429 && String(e.payload?.code || '').startsWith('FOOTBALL_')) {
      toast(e.payload?.retryAfter ? `Источник футбольных данных временно на паузе. Повторите через ~${e.payload.retryAfter} сек.` : e.message);
    } else if (quotaExhausted) toast('AI-разборы на сегодня закончились. Матчи и LIVE остаются доступны.');
    else toast(e.message);
    sendActionError('ai', e, sourceView);
    const category=apiErrorCategory(e);
    if (['rate_limit','provider'].includes(category)) {
      if (previousCenter && sourceView === 'analysisView') {
        state.currentCenter=previousCenter;
        renderMatchCenter(previousCenter);
      } else if (sourceView && sourceView !== 'analysisView') {
        showView(sourceView, { restore:true });
      }
    } else if (movedToAnalysis && recovery?.action !== 'search') {
      renderJourneyState('error', {
        title: 'AI-анализ временно недоступен',
        message: quotaExhausted
          ? 'AI-разборы на сегодня закончились. Матчи, LIVE, составы и статистика остаются доступны бесплатно.'
          : (e.status === 429 ? 'Источник футбольных данных временно ограничил обновления.' : (e.message || 'Не удалось подготовить анализ.')),
        retry: () => analyzeMatch(fixtureId, null, options),
      });
    }
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

let aiTrackRecordRenderer = null;
let aiTrackRecordRendererPromise = null;
async function ensureAiTrackRecordRenderer() {
  if (aiTrackRecordRenderer) return aiTrackRecordRenderer;
  if (!aiTrackRecordRendererPromise) {
    aiTrackRecordRendererPromise = import('./modules/ai-track-record-renderer.js').then(({ createAiTrackRecordRenderer }) => {
      aiTrackRecordRenderer = createAiTrackRecordRenderer({
        state,
        elementById: $,
        escapeHtml,
        dateTime,
        onRetry: force => loadAiTrackRecord(force),
      });
      return aiTrackRecordRenderer;
    });
  }
  return aiTrackRecordRendererPromise;
}

function renderAiTrackRecord() {
  if (aiTrackRecordRenderer) return aiTrackRecordRenderer.renderAiTrackRecord();
  void ensureAiTrackRecordRenderer().then(module => module?.renderAiTrackRecord());
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
    sendActionError('history', e, 'historyView');
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
    sendProductAction('history_item_open', 'historyView');
  } catch (error) {
    if (seq !== state.historyOpenRequestSeq) return;
    if (Number(error?.status || 0) === 404) {
      const center = await requestMatchCenter(fixtureId, {}, { timeoutMs: 9000 });
      if (seq !== state.historyOpenRequestSeq || !center) return;
      renderMatchCenter(center);
      showView('analysisView', { fromHistoryOpen: true });
      toast('Сохранённый полный анализ уже недоступен — открыт центр матча.');
    } else {
      sendActionError('history', error, 'historyView');
      toast(error.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

let historyRenderer = null;
let historyRendererPromise = null;
async function ensureHistoryRenderer() {
  if (historyRenderer) return historyRenderer;
  if (!historyRendererPromise) {
    historyRendererPromise = import('./modules/history-renderer.js').then(({ createHistoryRenderer }) => {
      historyRenderer = createHistoryRenderer({
        state,
        elementById: $,
        recoveryCardHtml,
        escapeHtml,
        safeUrl,
        dateTime,
        relativeAge,
        onReloadHistory: force => loadHistory(force),
        onOpenSearch: () => showView('searchView'),
        onOpenHistoryAnalysis: (fixtureId, button) => openHistoryAnalysis(fixtureId, button),
      });
      return historyRenderer;
    });
  }
  return historyRendererPromise;
}

function renderHistory() {
  if (historyRenderer) return historyRenderer.renderHistory();
  void ensureHistoryRenderer().then(module => module?.renderHistory());
}

function pct(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)}%` : '—'; }

function formSequence(form) {
  if (!form) return '—';
  return String(form).split('').map(x => x === 'W' ? 'П' : x === 'D' ? 'Н' : x === 'L' ? 'ПР' : x).join(' · ');
}

function likelyOutcomeDisplay(probabilities, fallback = '') {
  const rows = [Number(probabilities?.home), Number(probabilities?.draw), Number(probabilities?.away)]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (rows.length === 3 && rows[0] - rows[1] < 1) return 'Нет явного фаворита';
  return String(fallback || 'Недостаточно данных');
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

function compactAbsence(title, items) {
  if (!items?.length) return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><p class="muted">Активных отметок о потерях нет или данные недоступны.</p></div>`;
  return `<div class="squad-block"><div class="squad-title">${escapeHtml(title)}</div><ul class="compact-list">${items.slice(0, 10).map(x => {
    const status=absenceStatusLabel(x);
    const role=x.seasonRole?.matched ? x.seasonRole.label : '';
    const detail=[absenceKindLabel(x),x.reason || x.type,status,role].filter(Boolean).map(publicText).join(' · ');
    return `<li><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml(detail)}</span></li>`;
  }).join('')}</ul></div>`;
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
  const confidenceScore=d?.confidence?.score ?? d?.aiInstructor?.confidenceScore;
  const hasProbabilities=[p.home,p.draw,p.away].every(value=>Number.isFinite(Number(value)));
  const title=`${m.home?.name || ''} — ${m.away?.name || ''}`;
  const lines=[
    `⚽ ${title}`,
    `${m.league || ''}${m.date ? ` · ${dateTime(m.date)}` : ''}`,
  ].filter(Boolean);
  if (hasProbabilities) lines.push(`П1 ${pct(p.home)} · Н ${pct(p.draw)} · П2 ${pct(p.away)}`);
  if (signal.label) {
    lines.push(`MatchRadar AI: ${signal.label}`);
    if (Number.isFinite(Number(confidenceScore))) lines.push(`Уверенность: ${Number(confidenceScore)}/100`);
  }
  lines.push(
    '',
    'Открой матч в MatchRadar — ссылка сразу приведёт к матчу и доступному AI-разбору.',
    'Аналитическая оценка модели · не гарантия результата.',
  );
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

function providerCoverageHtml(reliability = {}) {
  const features = reliability?.features || {};
  const labels = { injuries:'Травмы', lineups:'Составы', odds:'Коэффициенты', predictions:'Прогноз API', h2h:'Очные встречи' };
  const states = {
    available:['✓','Получено'], empty_response:['○','Источник вернул пустой ответ'], skipped:['○','Запрос отложен'],
    rate_limited:['!','Лимит запросов'], plan_limited:['!','Недоступно на текущем тарифе источника'],
    timeout:['!','Тайм-аут источника'], network_error:['!','Ошибка сети источника'], provider_error:['!','Ошибка источника'],
    configuration:['!','Источник не настроен'], error:['!','Временно недоступно'],
  };
  const rows = Object.entries(labels).filter(([key]) => features[key]).map(([key,label]) => {
    const item = features[key] || {};
    const state = String(item.state || 'unknown');
    const [icon,text] = states[state] || ['○','Статус не определён'];
    const cls = item.available ? 'available' : item.degraded ? 'degraded' : 'missing';
    return `<div class="provider-coverage-row ${cls}"><span>${icon}</span><strong>${label}</strong><small>${escapeHtml(text)}</small></div>`;
  }).join('');
  if (!rows) return '';
  const state = String(reliability.state || 'partial');
  const title = state === 'healthy' ? 'Данные источника получены' : state === 'degraded' ? 'Часть данных ограничена' : 'Часть данных ещё недоступна';
  return `<section class="provider-coverage-card ${escapeHtml(state)}"><div class="provider-coverage-head"><strong>${escapeHtml(title)}</strong><span>доверие ≤ ${Math.round(Number(reliability.trustCap || 100))}%</span></div><div class="provider-coverage-grid">${rows}</div><p>${escapeHtml(publicText(reliability.note || 'AI использует только подтверждённые сигналы.'))}</p></section>`;
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
  const qualityGate = ai.qualityGate || {};
  const gateReasons = Array.isArray(qualityGate.reasons) ? qualityGate.reasons.slice(0, 2) : [];
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
          <div class="ai-data-trust"><span>Quality Gate</span><strong>${escapeHtml(qualityGate.label || 'Оценивается')}</strong><small>${escapeHtml(publicText(gateReasons[0]?.text || 'Проверка качества сигнала пройдена без блокирующих причин.'))}</small></div>
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
async function openLaunchFixture(fixtureId, action, tab = '', handoff = false, newsImpactDecision = '', newsImpactAction = '', newsImpactRecoveryCode = '', newsImpactRecoveryFrom = '') {
  const id = Number(fixtureId || 0);
  if (!id) return;
  const allowedTabs = new Set(['brief','overview','form','comparison','market','squads','context']);
  const requestedTab = allowedTabs.has(String(tab || '').toLowerCase()) ? String(tab).toLowerCase() : '';
  if (requestedTab) state.currentAnalysisTab = requestedTab;
  if (action === 'center') return openMatchCenter(id, null);
  if (action === 'analysis') {
    if (handoff) {
      await Promise.allSettled([loadFavorites(), loadReminders()]);
      return analyzeMatch(id, null, { recheck:true, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom });
    }
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
  const newsImpactRecoveryCode = String(params.get('newsImpactRecoveryCode') || '').toLowerCase().slice(0,24);
  const newsImpactRecoveryFrom = String(params.get('newsImpactRecoveryFrom') || '').toLowerCase().slice(0,24);
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
    void openLaunchFixture(fixtureId, action, tab, handoff, newsImpactDecision, newsImpactAction, newsImpactRecoveryCode, newsImpactRecoveryFrom);
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

function dataProvenanceHtml(provenance = {}) {
  const features = provenance?.features || {};
  const labels = {
    injuries:'Травмы и дисквалификации',
    predictions:'Прогноз источника',
    odds:'Коэффициенты',
    h2h:'Очные встречи',
    lineups:'Стартовые составы',
  };
  const stateLabels = {
    available:'получено', empty_response:'пустой подтверждённый ответ', skipped:'пропущено политикой',
    rate_limited:'лимит источника', plan_limited:'ограничено тарифом', timeout:'тайм-аут',
    network_error:'ошибка сети', provider_error:'ошибка источника', error:'недоступно', unknown:'неизвестно',
    stale_data:'устарело — исключено из расчёта', unverified_source:'источник не подтверждён', unverified_freshness:'свежесть не подтверждена',
  };
  const rows = Object.entries(labels).filter(([key]) => features[key]).map(([key,label]) => {
    const meta = features[key] || {};
    const provider = meta.provider === 'api-football' ? 'API-Football' : String(meta.provider || '—');
    const age = Number.isFinite(Number(meta.ageSeconds)) ? ` · возраст ${Math.max(0,Math.round(Number(meta.ageSeconds)))} сек.` : '';
    return `<div class="provenance-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(provider)}</strong><small>${escapeHtml(stateLabels[meta.state] || meta.state || '—')}${escapeHtml(age)}</small></div>`;
  });
  if (!rows.length) return '';
  return `<section class="panel data-provenance-panel">
    <div class="prematch-section-head"><div><h2>🛰️ Паспорт данных</h2><p>Откуда пришли ключевые входы и насколько они свежие</p></div></div>
    <div class="provenance-grid">${rows.join('')}</div>
  </section>`;
}

function cockpitProviderLabel(provider = '') {
  const key=String(provider || '').toLowerCase();
  if (key==='api-football') return 'API-Football';
  if (key==='the-odds-api') return 'The Odds API';
  return provider ? String(provider) : '—';
}

function matchCockpitHtml(d = {}) {
  const m=d.match || {};
  const recent=d.recentForm || {};
  const comparison=d.comparison || {};
  const metrics=Array.isArray(comparison.metrics) ? comparison.metrics : [];
  const metric=key=>metrics.find(x=>x?.key===key) || null;
  const formMetric=metric('form_ppg');
  const venueMetric=metric('venue_ppg');
  const tableMetric=metric('table_rank');
  const injuriesMeta=d.providerReliability?.features?.injuries || d.dataPolicy?.reliability?.features?.injuries || {};
  const lineupMeta=d.providerReliability?.features?.lineups || d.dataPolicy?.reliability?.features?.lineups || {};
  const injuryConfirmed=Boolean(injuriesMeta.available);
  const homeAbs=Array.isArray(d.absences?.home) ? d.absences.home.length : 0;
  const awayAbs=Array.isArray(d.absences?.away) ? d.absences.away.length : 0;
  const homeConfirmed=Boolean(d.lineupImpact?.homeConfirmed || d.lineups?.home?.quality?.confirmed === true);
  const awayConfirmed=Boolean(d.lineupImpact?.awayConfirmed || d.lineups?.away?.quality?.confirmed === true);
  const confirmedCount=Number(homeConfirmed)+Number(awayConfirmed);
  const h2h=d.h2h || {};
  const h2hSample=Number(h2h.homeWins || 0)+Number(h2h.draws || 0)+Number(h2h.awayWins || 0);
  const market=d.market || null;
  const oddsProvider=d.dataProvenance?.features?.odds?.provider || market?.provider || '';
  const confidence=Number.isFinite(Number(d.confidence?.score)) ? Math.round(Number(d.confidence.score)) : null;
  const completeness=Number.isFinite(Number(d.completeness?.score)) ? Number(d.completeness.score) : null;
  const completenessMax=Number.isFinite(Number(d.completeness?.max)) ? Number(d.completeness.max) : null;
  const homeName=m.home?.name || 'Хозяева';
  const awayName=m.away?.name || 'Гости';
  const fmt=value=>Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '—';
  const rank=value=>Number.isFinite(Number(value)) ? `${Math.round(Number(value))} место` : '—';
  const formAvailable=Boolean(recent.home?.overall?.sample && recent.away?.overall?.sample);
  const venueAvailable=Boolean(recent.home?.venue?.sample && recent.away?.venue?.sample);
  const marketAvailable=Boolean(market?.odds && Number(market.odds.home)>1 && Number(market.odds.draw)>1 && Number(market.odds.away)>1);
  const tableAvailable=Boolean(tableMetric && Number.isFinite(Number(tableMetric.homeValue)) && Number.isFinite(Number(tableMetric.awayValue)));
  const movement=d.marketMovement || {};
  const movementDelta=movement?.probabilityChange || {};
  const movementSample=Number(movement?.sample || 0);
  const movementRows=[['П1',Number(movementDelta.home || 0)],['Н',Number(movementDelta.draw || 0)],['П2',Number(movementDelta.away || 0)]]
    .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const strongestMove=movementRows[0];
  const movementText=movementSample>=2 && Math.abs(strongestMove?.[1] || 0)>=1
    ? `Рынок: ${strongestMove[0]} ${strongestMove[1]>0?'+':''}${strongestMove[1].toFixed(1)} п.п.`
    : '';
  const lineupText=confirmedCount===2
    ? 'Оба стартовых состава подтверждены'
    : confirmedCount===1
      ? 'Подтверждён состав одной команды'
      : lineupMeta.state==='empty_response'
        ? 'Составы ещё не опубликованы источником'
        : 'Стартовые составы пока не подтверждены';
  const injuryText=injuryConfirmed
    ? `${homeName}: ${homeAbs} · ${awayName}: ${awayAbs}`
    : injuriesMeta.state==='empty_response'
      ? 'Источник вернул пустой ответ — это не означает «потерь нет»'
      : 'Данные о потерях сейчас не подтверждены';
  const qualityText=confidence===null
    ? 'Оценивается'
    : `${confidence}/100${completeness!==null&&completenessMax!==null ? ` · данные ${completeness}/${completenessMax}` : ''}`;

  const card=(tab,icon,title,value,note,available=true)=>`<button class="match-cockpit-card ${available?'':'is-missing'}" type="button" data-cockpit-tab="${escapeHtml(tab)}">
    <span class="match-cockpit-icon">${icon}</span>
    <span class="match-cockpit-copy"><small>${escapeHtml(title)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(publicText(note || ''))}</em></span>
    <span class="match-cockpit-arrow">→</span>
  </button>`;

  return `<section class="panel match-cockpit-panel">
    <div class="match-cockpit-head">
      <div><span>⚡ МАТЧ ЗА 15 СЕКУНД</span><h2>Ключевые факторы перед стартом</h2></div>
      <small>${escapeHtml(publicText(comparison.balanceLabel || 'Сводка строится только по доступным подтверждённым данным'))}</small>
    </div>
    <div class="match-cockpit-grid">
      ${card('form','📈','Текущая форма',
        formAvailable ? `${fmt(formMetric?.homeValue ?? recent.home?.overall?.ppg)} — ${fmt(formMetric?.awayValue ?? recent.away?.overall?.ppg)} очка/матч` : 'Недостаточно данных',
        formAvailable ? `${homeName} / ${awayName}, последние матчи` : 'Форма не включается в вывод без достаточной выборки',
        formAvailable)}
      ${card('form','🏟️','Дома / в гостях',
        venueAvailable ? `${fmt(venueMetric?.homeValue ?? recent.home?.venue?.ppg)} — ${fmt(venueMetric?.awayValue ?? recent.away?.venue?.ppg)} очка/матч` : 'Недостаточно данных',
        venueAvailable ? 'Хозяева дома против гостей на выезде' : 'Профиль площадки пока неполный',
        venueAvailable)}
      ${card('comparison','🏆','Положение в таблице',
        tableAvailable ? `${rank(tableMetric.homeValue)} — ${rank(tableMetric.awayValue)}` : 'Нет в сохранённых данных',
        tableAvailable ? `${homeName} / ${awayName}` : 'Таблица не запрашивается дополнительно только ради этой карточки',
        tableAvailable)}
      ${card('squads','🚑','Потери состава',
        injuryConfirmed ? `${homeAbs} — ${awayAbs}` : 'Не подтверждены',
        injuryText,
        injuryConfirmed)}
      ${card('squads','👥','Стартовые составы',
        confirmedCount===2 ? '2 / 2 подтверждены' : confirmedCount===1 ? '1 / 2 подтверждён' : 'Ожидаются',
        lineupText,
        confirmedCount>0)}
      ${card('form','🤝','Очные встречи',
        h2hSample ? `${Number(h2h.homeWins||0)} — ${Number(h2h.draws||0)} — ${Number(h2h.awayWins||0)}` : 'Нет выборки',
        h2hSample ? `${homeName} · ничьи · ${awayName}, выборка ${h2hSample}` : 'H2H не используется, если источник не вернул выборку',
        h2hSample>0)}
      ${card('market','💹','Коэффициенты П1 / Н / П2',
        marketAvailable ? `${market.odds.home} · ${market.odds.draw} · ${market.odds.away}` : 'Недоступен',
        marketAvailable ? `${cockpitProviderLabel(oddsProvider)}${movementText ? ` · ${movementText}` : ''}` : 'Рыночный сигнал исключён из модели',
        marketAvailable)}
      ${card('overview','🧠','Качество оценки',
        qualityText,
        d.confidence?.label || 'Уверенность модели и полнота входных данных считаются отдельно',
        confidence!==null)}
    </div>
    ${d.lineupImpact?.note ? `<div class="match-cockpit-note"><span>👥</span><p>${escapeHtml(publicText(d.lineupImpact.note))}</p></div>` : ''}
  </section>`;
}

function analysisGlanceHtml(d = {}) {
  const factors = (Array.isArray(d.insights) ? d.insights : []).filter(Boolean).slice(0, 3);
  const risks = (Array.isArray(d.risks) ? d.risks : []).filter(Boolean).slice(0, 3);
  const score = Number.isFinite(Number(d.confidence?.score)) ? Math.round(Number(d.confidence.score)) : null;
  const dataQuality = qualityInfo(d.completeness);
  return `<section class="panel analysis-glance">
    <div class="analysis-glance-head">
      <div><span>ГЛАВНОЕ</span><h2>Что важно перед матчем</h2></div>
      <div class="analysis-confidence-simple"><span>Уверенность AI</span><strong>${score === null ? '—' : `${score}/100`}</strong><small>${escapeHtml(publicText(d.confidence?.label || 'Оценивается'))}</small><small>Данные: ${escapeHtml(dataQuality.label || 'пока неполные')}</small></div>
    </div>
    <div class="analysis-glance-grid">
      <div><h3>Главные факторы</h3>${factors.length ? `<ol>${factors.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ol>` : '<p>Сильных отдельных факторов пока нет.</p>'}</div>
      <div class="analysis-glance-risks"><h3>Основные риски</h3>${risks.length ? `<ul>${risks.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul>` : '<p>Критичных ограничений не найдено.</p>'}</div>
    </div>
  </section>`;
}

function renderAnalysis(d) {
  $('analysis')?.setAttribute('aria-busy', 'false');
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
  const homeFavorite = isFavorite(Number(m.home?.id || 0));
  const awayFavorite = isFavorite(Number(m.away?.id || 0));
  const confidence = d.confidence || {};
  const goal = d.goalModel;
  const recent = d.recentForm || {};
  const comparison = d.comparison || { metrics: [], advantages: { home: [], away: [] }, score: { home: 0, away: 0, even: 0 }, dataReuse: {} };
  const quality = qualityInfo(d.completeness);
  const confidenceScore = clampPercent(confidence.score);

  $('analysis').innerHTML = `
    <section class="panel match-experience-hero">
      <div class="analysis-brand-kicker">MatchRadar · AI-центр матча</div>
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
        <strong>${escapeHtml(likelyOutcomeDisplay(p, d.likelyOutcome))}</strong>
      </div>

      <div class="experience-prob-labels">
        <div><span>П1</span><strong>${pct(p.home)}</strong></div>
        <div><span>Н</span><strong>${pct(p.draw)}</strong></div>
        <div><span>П2</span><strong>${pct(p.away)}</strong></div>
      </div>
      ${probabilityStrip(p)}

      <div class="experience-health-row">
        <span class="quality-pill ${quality.cls}">● ${escapeHtml(publicText(confidence.label || quality.label || 'Оценивается'))}</span>
        <span>${confidence.score ?? '—'}/100 уверенность</span>
        ${d.stale ? '<span>⚠️ Показана последняя доступная версия</span>' : ''}
      </div>

      <div class="experience-actions">
        <button id="reminderBtn" class="reminder-btn ${reminderActive ? 'active' : ''} ${reminderPending ? 'is-pending' : ''}" type="button" aria-pressed="${reminderActive ? 'true' : 'false'}" ${reminderPending ? 'disabled' : ''}>${reminderPending ? '⏳ Сохраняю…' : reminderActive ? `🔔 За ${Number(activeReminder?.remindBeforeMinutes || 30)} мин.${activeReminder?.kickoffNotify ? ' + старт' : ''}` : `🔕 Напомнить за ${Number(state.preferences?.reminderMinutes || 30)} минут`}</button>
        <button id="shareAnalysisBtn" class="share-analysis-btn" type="button">↗ Поделиться матчем</button>
        ${Number(m.home?.id || 0) ? `<button class="secondary-btn analysis-favorite-btn ${homeFavorite ? 'active' : ''}" type="button" data-analysis-favorite="${Number(m.home.id)}" data-team-name="${escapeHtml(m.home?.name || '')}" data-team-logo="${escapeHtml(m.home?.logo || '')}" aria-pressed="${homeFavorite ? 'true' : 'false'}"><span class="analysis-favorite-star">${favoriteStarSvg(homeFavorite)}</span><span class="analysis-favorite-copy"><small>${homeFavorite ? 'В избранном' : 'В избранное'}</small><strong>${escapeHtml(m.home?.name || 'Хозяева')}</strong></span></button>` : ''}
        ${Number(m.away?.id || 0) ? `<button class="secondary-btn analysis-favorite-btn ${awayFavorite ? 'active' : ''}" type="button" data-analysis-favorite="${Number(m.away.id)}" data-team-name="${escapeHtml(m.away?.name || '')}" data-team-logo="${escapeHtml(m.away?.logo || '')}" aria-pressed="${awayFavorite ? 'true' : 'false'}"><span class="analysis-favorite-star">${favoriteStarSvg(awayFavorite)}</span><span class="analysis-favorite-copy"><small>${awayFavorite ? 'В избранном' : 'В избранное'}</small><strong>${escapeHtml(m.away?.name || 'Гости')}</strong></span></button>` : ''}
      </div>
    </section>


    ${analysisGlanceHtml(d)}

    ${kickoffHandoffHtml(d.kickoffHandoff || {}, m)}

    <details class="analysis-more-data">
      <summary>Подробные данные матча</summary>
      <div class="analysis-more-body">
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
      ${aiInstructorHtml(d.aiInstructor || {}, m, d.kickoffHandoff || {})}
    </div>

    <div class="analysis-tab-panel" data-panel="overview">
      ${matchCockpitHtml(d)}


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
        <p class="muted">Модель Пуассона по недавней результативности. Качество выборки: <b>${escapeHtml(goal.qualityLabel || 'Оценивается')}</b>${Number.isFinite(Number(goal.qualityScore)) ? ` · ${Math.round(Number(goal.qualityScore))}/100` : ''}. Это не официальный показатель ожидаемых голов.</p>` : '<p class="muted">Недостаточно недавних матчей для голевой модели.</p>'}
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


    </div>

    <div class="analysis-tab-panel" data-panel="market">
      <section class="panel">
        <h2>💹 Коэффициенты П1 / Н / П2</h2>
        ${oddsQualityHintHtml(d.oddsQuality)}
        <div class="odds-grid">
          <div><span>П1</span><strong>${market?.odds?.home ?? '—'}</strong></div>
          <div><span>Н</span><strong>${market?.odds?.draw ?? '—'}</strong></div>
          <div><span>П2</span><strong>${market?.odds?.away ?? '—'}</strong></div>
        </div>
        <p class="muted">Букмекеров в выборке: ${market?.bookmakers ?? '—'}. Коэффициенты отражают рынок, а не гарантированный исход.</p>
      </section>
      <details class="panel analysis-disclosure">
        <summary>Подробнее о расчёте</summary>
        <div class="analysis-disclosure-body">
        <h2>🧠 Состав модели</h2>
        <p class="muted">${escapeHtml(publicText(d.modelBreakdown?.method || 'Модель объединяет доступные статистические сигналы.'))}</p>
        <div class="model-weights">${escapeHtml(modelWeightsText(d.modelBreakdown?.weights || {}))}</div>
      ${d.modelCalibration ? `<div class="analysis-calibration-card ${escapeHtml(d.modelCalibration.mode || 'baseline')}"><span>Настройка модели</span><strong>${escapeHtml(calibrationModeLabel(d.modelCalibration.mode))}</strong><small>Проверено на выборке: ${Number(d.modelCalibration.sample || 0)}</small></div>` : ''}
        <div class="model-api-card">
          <span>Прогноз источника данных</span>
          <strong>${escapeHtml(pred?.winner || 'Нет данных')}</strong>
          <small>${escapeHtml(predictionAdviceLabel(pred?.advice || 'Подсказка недоступна'))}</small>
        </div>

        </div>
      </details>
    </div>

    <div class="analysis-tab-panel" data-panel="squads">
      <section class="panel">
        <h2>🚑 Потери</h2>
        ${availabilityQualityHintHtml(d.availabilityQuality)}
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
      <details class="panel analysis-disclosure data-details-disclosure">
        <summary>Подробнее о данных</summary>
        <div class="analysis-disclosure-body">
          ${analysisFreshnessHtml(d.freshness || {}, d.recheck || {})}
          ${providerCoverageHtml(d.providerReliability || d.dataPolicy?.reliability || {})}
          ${dataProvenanceHtml(d.dataProvenance || {})}
          <section class="data-transparency-panel">
        <h2>О данных</h2>
        <div class="transparency-grid">
          <div><span>Полнота</span><strong>${d.completeness?.score ?? 0}/${d.completeness?.max ?? 10}</strong></div>
          <div><span>Статус</span><strong>${d.stale ? 'Последние сохранённые данные' : d.cached ? 'Сохранённые данные' : 'Свежие данные'}</strong></div>
          <div><span>Режим</span><strong>${escapeHtml(dataPolicyModeLabel(d.dataPolicy?.mode || 'standard'))}</strong></div>
        </div>
        ${d.dataPolicy?.skipped?.length ? `<div class="policy-list"><strong>Что было пропущено для экономии/качества:</strong><ul>${d.dataPolicy.skipped.map(x => `<li>${escapeHtml(publicText(x))}</li>`).join('')}</ul></div>` : ''}
        <p class="tiny warning">${escapeHtml(publicText(d.disclaimer || ''))}</p>
          </section>
        </div>
      </details>
      ${m.referee ? `<section class="panel analysis-referee-line"><h2>Судья</h2><p>${escapeHtml(m.referee)}</p></section>` : ''}
    </div>
      </div>
    </details>
  `;

  $('analysisRecheckBtn')?.addEventListener('click', e => analyzeMatch(Number(m.fixtureId), e.currentTarget, { recheck:true }));
  $('kickoffMatchCenterBtn')?.addEventListener('click', e => openMatchCenter(Number(m.fixtureId), e.currentTarget));
  $('reminderBtn')?.addEventListener('click', () => toggleReminder(m));
  $('shareAnalysisBtn')?.addEventListener('click', () => shareAnalysis(d));
  $('analysis')?.querySelectorAll('[data-analysis-favorite]').forEach(btn => btn.addEventListener('click', () => toggleFavorite({
    id:Number(btn.dataset.analysisFavorite || 0),
    name:btn.dataset.teamName || '',
    logo:btn.dataset.teamLogo || '',
  })));
  $('openPrematchBrief')?.addEventListener('click', () => setAnalysisTab('brief', true));
  $('analysis')?.querySelectorAll('[data-cockpit-tab]').forEach(btn => btn.addEventListener('click', () => setAnalysisTab(btn.dataset.cockpitTab || 'overview', true)));
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
  retry.hidden = !['offline','degraded'].includes(mode)
    || navigator.onLine === false
    || (state.network.category === 'rate_limit' && Number(state.network.retryAfter || 0) > 0);

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
    const cooldown=Number(state.network.retryAfter || 0);
    title.textContent = state.network.category === 'rate_limit'
      ? (cooldown ? `Пауза обновлений · ~${cooldown} сек.` : 'Пауза обновлений')
      : 'Часть данных обновляется медленнее';
    text.textContent = state.network.category === 'rate_limit'
      ? 'Показываем уже загруженные матчи и снимки.'
      : (state.network.message || 'Сохранённые данные останутся доступны.');
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
let globalSearchTimer = null;

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

$('globalSearchBtn')?.addEventListener('click', () => {
  clearTimeout(globalSearchTimer);
  runGlobalSearch({ manual:true });
});
$('globalSearchInput')?.addEventListener('input', e => {
  clearTimeout(globalSearchTimer);
  state.globalSearch.requestSeq += 1;
  state.globalSearch.loading = false;
  state.globalSearch.query = e.target.value || '';
  state.globalSearch.status = state.globalSearch.query.trim().length >= 2 ? 'local' : 'idle';
  state.globalSearch.remoteTeams = [];
  state.globalSearch.remoteCompetitions = [];
  state.globalSearch.remoteMatches = [];
  state.globalSearch.matchSourceTeam = '';
  state.globalSearch.warning = '';
  renderGlobalSearch();
  if (state.globalSearch.query.trim().length >= 3) {
    globalSearchTimer = setTimeout(() => runGlobalSearch(), 500);
  }
});
$('globalSearchInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(globalSearchTimer);
    runGlobalSearch({ manual:true });
  }
});
document.querySelectorAll('[data-search-mode]').forEach(btn => btn.addEventListener('click', () => setGlobalSearchMode(btn.dataset.searchMode || 'all')));
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
  billingModule.clearPassContext();
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
  billingModule.clearPassContext();
  void openProfileView();
});
$('profileFavoriteTeamsBtn')?.addEventListener('click', () => {
  renderMyTeams();
  showView('myTeamsView');
});
$('profileRemindersBtn')?.addEventListener('click', () => {
  $('remindersPanel')?.scrollIntoView?.({ behavior:'smooth', block:'start' });
});
$('myTeamsFindBtn')?.addEventListener('click', () => { showView('matchesView'); setTimeout(() => $('matchSearch')?.focus({ preventScroll:true }), 80); });
$('homeSearchBtn')?.addEventListener('click', () => { const q=String($('matchSearch')?.value || '').trim(); state.globalSearch.query=q; if ($('globalSearchInput')) $('globalSearchInput').value=q; renderGlobalSearch(); showView('searchView'); if (q) runGlobalSearch(); });
billingModule.bind();
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

async function scheduleIdle(task) {
  if ('requestIdleCallback' in window) return new Promise(resolve => requestIdleCallback(async () => { try { await task(); } finally { resolve(); } }, { timeout: 1800 }));
  return new Promise(resolve => setTimeout(async () => { try { await task(); } finally { resolve(); } }, 250));
}

$('favoriteTeams')?.setAttribute('aria-live', 'polite');
$('reminderList')?.setAttribute('aria-live', 'polite');
$('history')?.setAttribute('aria-live', 'polite');
organizeAdminConsole();
syncBootVersion();
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
  if (APP_SURFACE === 'admin') {
    if (isAdmin()) {
      openProfileView();
      document.body.classList.add('admin-surface-ready');
    } else {
      location.replace('/');
    }
  }
} finally {
  clearTimeout(startupWatchdog);
}

