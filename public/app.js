import { createTeamHubModule } from './modules/team-hub.js';
import { createPlayerHubModule } from './modules/player-hub.js';
import { createTournamentModule } from './modules/tournament.js';
import { createMatchCenterLiveCore } from './modules/match-center-live-core.js';
import { createMatchCenterRenderModule } from './modules/match-center-render.js';
import { createAnalysisOrchestrationModule } from './modules/analysis-orchestration.js';
import { createAnalysisPresentationModule } from './modules/analysis-presentation.js';
import { createDiscoveryModule } from './modules/discovery.js';
import { createMatchesHomeModule } from './modules/matches-home.js';
import { createProfileCoreModule } from './modules/profile-core.js';
import { createAdminBootstrapModule } from './modules/admin-bootstrap.js';
import { createApiClient, initTelegramWebApp, localDate, timeOf, dateTime, dateOnly, relativeAge, phase5SessionToken } from './modules/client-core.js';
import { CANONICAL_HOME_VIEW, PUBLIC_VIEW_IDS, backTargetForView, telegramBackButtonVisible } from './modules/navigation.js';
import { createNavigationShell } from './modules/navigation-shell.js';
import { createViewChromeController } from './modules/view-chrome.js';
import { createInterfacePreferencesController } from './modules/ui-preferences.js';
import { createFirstRunGuideController } from './modules/first-run-guide.js';
import { createProfileDataCapabilitiesModule } from './modules/profile-data-capabilities.js';
import { createProfileAccessStateModule } from './modules/profile-access-state.js';
import { createProfileSummaryModule } from './modules/profile-summary.js';
import { createFavoriteTeamsRenderer } from './modules/favorite-teams-renderer.js';
import { createReminderListModule } from './modules/reminder-list.js';
import { createMyTeamsRenderer } from './modules/my-teams-renderer.js';
import { createJourneyStateModule } from './modules/journey-state.js';
import { analysisAccessUsageHtml, buildAnalysisAccessUsage } from './modules/analysis-access.js';
import { createGlobalSearchRenderer } from './modules/global-search-renderer.js';
import { createGlobalSearchController } from './modules/global-search-controller.js';
import { buildPlayerComparisonCandidates, playerComparisonHtml, samePlayer } from './modules/player-comparison.js';
import { createPlayerFollowModule } from './modules/player-follow.js';
import {
  CLIENT_VERSION,
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  SUPABASE_SCHEMA_HINT,
  readUiPreferences,
  MATCH_WATCHLIST_KEY,
  readMatchWatchlist,
} from './modules/app-runtime.js';

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
    timings: {
      manifestMs: null,
      identityMs: null,
      feedMs: null,
      revealDelayMs: null,
    },
  },
  storageAvailable: true,
  network: {
    mode: navigator.onLine === false ? 'offline' : 'online',
    lastSuccessAt: null,
    lastFailureAt: null,
    lastRecoveredAt: null,
    lastAutoRecoveryAt: 0,
    consecutiveFailures: 0,
    retryAfter: 0,
    retryAt: 0,
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
  analysisActionPending: false,
  analysisRequestSeq: 0,
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

let matchCenterController = null;
let matchCenterControllerPromise = null;
let analysisController = null;
let analysisControllerPromise = null;

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

let __profileCoreModule;
function __getProfileCoreModule() {
  __profileCoreModule ||= createProfileCoreModule({
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
  });
  return __profileCoreModule;
}
async function loadProfile(...args) { return __getProfileCoreModule().loadProfile(...args); }
function isAdmin(...args) { return __getProfileCoreModule().isAdmin(...args); }
async function ensureAdminBillingRefundModule(...args) { return __getProfileCoreModule().ensureAdminBillingRefundModule(...args); }
function renderAdminBillingRefund(...args) { return __getProfileCoreModule().renderAdminBillingRefund(...args); }
async function loadAdminBillingRefund(...args) { return __getProfileCoreModule().loadAdminBillingRefund(...args); }
async function ensureAdminBetaDashboardModule(...args) { return __getProfileCoreModule().ensureAdminBetaDashboardModule(...args); }
function renderBetaDashboard(...args) { return __getProfileCoreModule().renderBetaDashboard(...args); }
async function loadBetaDashboard(...args) { return __getProfileCoreModule().loadBetaDashboard(...args); }
async function ensureBetaFeedbackModule(...args) { return __getProfileCoreModule().ensureBetaFeedbackModule(...args); }
function setBetaFeedbackOpen(...args) { return __getProfileCoreModule().setBetaFeedbackOpen(...args); }
async function submitBetaFeedback(...args) { return __getProfileCoreModule().submitBetaFeedback(...args); }
async function ensureAdminOverviewModule(...args) { return __getProfileCoreModule().ensureAdminOverviewModule(...args); }
function renderAdminOverview(...args) { return __getProfileCoreModule().renderAdminOverview(...args); }
function applyAdminVisibility(...args) { return __getProfileCoreModule().applyAdminVisibility(...args); }
function organizeAdminConsole(...args) { return __getProfileCoreModule().organizeAdminConsole(...args); }
async function loadAdvancedAdminTools(...args) { return __getProfileCoreModule().loadAdvancedAdminTools(...args); }
function planLabel(...args) { return __getProfileCoreModule().planLabel(...args); }
function technicalStateLabel(...args) { return __getProfileCoreModule().technicalStateLabel(...args); }
function humanizeTechnicalText(...args) { return __getProfileCoreModule().humanizeTechnicalText(...args); }
function publicText(...args) { return __getProfileCoreModule().publicText(...args); }
function dataPolicyModeLabel(...args) { return __getProfileCoreModule().dataPolicyModeLabel(...args); }
function calibrationModeLabel(...args) { return __getProfileCoreModule().calibrationModeLabel(...args); }
function predictionAdviceLabel(...args) { return __getProfileCoreModule().predictionAdviceLabel(...args); }
function renderProfile(...args) { return __getProfileCoreModule().renderProfile(...args); }
let __adminBootstrapModule;
function __getAdminBootstrapModule() {
  __adminBootstrapModule ||= createAdminBootstrapModule({
    $,
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
  });
  return __adminBootstrapModule;
}
function outcomeShortLabel(...args) { return __getAdminBootstrapModule().outcomeShortLabel(...args); }
async function ensureAdminModelQualityModule(...args) { return __getAdminBootstrapModule().ensureAdminModelQualityModule(...args); }
function renderModelQuality(...args) { return __getAdminBootstrapModule().renderModelQuality(...args); }
async function loadModelQuality(...args) { return __getAdminBootstrapModule().loadModelQuality(...args); }
async function ensureAdminCalibrationControlModule(...args) { return __getAdminBootstrapModule().ensureAdminCalibrationControlModule(...args); }
function renderCalibrationControl(...args) { return __getAdminBootstrapModule().renderCalibrationControl(...args); }
async function loadCalibrationControl(...args) { return __getAdminBootstrapModule().loadCalibrationControl(...args); }
async function runCalibrationControlAction(...args) { return __getAdminBootstrapModule().runCalibrationControlAction(...args); }
async function ensureAdminModelRemediationModule(...args) { return __getAdminBootstrapModule().ensureAdminModelRemediationModule(...args); }
function renderModelRemediation(...args) { return __getAdminBootstrapModule().renderModelRemediation(...args); }
async function loadModelRemediation(...args) { return __getAdminBootstrapModule().loadModelRemediation(...args); }
async function runModelRemediation(...args) { return __getAdminBootstrapModule().runModelRemediation(...args); }
async function resolveSettlementDriftFromUi(...args) { return __getAdminBootstrapModule().resolveSettlementDriftFromUi(...args); }
async function resetSettlementCircuitFromUi(...args) { return __getAdminBootstrapModule().resetSettlementCircuitFromUi(...args); }
async function openProfileView(...args) { return __getAdminBootstrapModule().openProfileView(...args); }
async function ensureAdminReleaseReadinessModule(...args) { return __getAdminBootstrapModule().ensureAdminReleaseReadinessModule(...args); }
function renderReleaseReadiness(...args) { return __getAdminBootstrapModule().renderReleaseReadiness(...args); }
async function loadReleaseReadiness(...args) { return __getAdminBootstrapModule().loadReleaseReadiness(...args); }
function diagPct(...args) { return __getAdminBootstrapModule().diagPct(...args); }
function diagDuration(...args) { return __getAdminBootstrapModule().diagDuration(...args); }
function diagnosticsStateLabel(...args) { return __getAdminBootstrapModule().diagnosticsStateLabel(...args); }
async function ensureAdminProductionReadinessModule(...args) { return __getAdminBootstrapModule().ensureAdminProductionReadinessModule(...args); }
function renderProductionReadiness(...args) { return __getAdminBootstrapModule().renderProductionReadiness(...args); }
async function loadProductionReadiness(...args) { return __getAdminBootstrapModule().loadProductionReadiness(...args); }
function runClientContractSmoke(...args) { return __getAdminBootstrapModule().runClientContractSmoke(...args); }
async function ensureAdminRcRegressionModule(...args) { return __getAdminBootstrapModule().ensureAdminRcRegressionModule(...args); }
function renderRcRegression(...args) { return __getAdminBootstrapModule().renderRcRegression(...args); }
async function loadRcRegression(...args) { return __getAdminBootstrapModule().loadRcRegression(...args); }
async function ensureAdminRuntimeControlsModule(...args) { return __getAdminBootstrapModule().ensureAdminRuntimeControlsModule(...args); }
function renderRuntimeControls(...args) { return __getAdminBootstrapModule().renderRuntimeControls(...args); }
async function loadRuntimeControlsAdmin(...args) { return __getAdminBootstrapModule().loadRuntimeControlsAdmin(...args); }
async function saveRuntimeControls(...args) { return __getAdminBootstrapModule().saveRuntimeControls(...args); }
async function restoreRuntimeDefaults(...args) { return __getAdminBootstrapModule().restoreRuntimeDefaults(...args); }
async function ensureAdminReminderHealthModule(...args) { return __getAdminBootstrapModule().ensureAdminReminderHealthModule(...args); }
function renderReminderHealth(...args) { return __getAdminBootstrapModule().renderReminderHealth(...args); }
async function loadReminderHealth(...args) { return __getAdminBootstrapModule().loadReminderHealth(...args); }
async function sendReminderTest(...args) { return __getAdminBootstrapModule().sendReminderTest(...args); }
async function ensureAdminReleaseMonitorModule(...args) { return __getAdminBootstrapModule().ensureAdminReleaseMonitorModule(...args); }
function renderReleaseMonitor(...args) { return __getAdminBootstrapModule().renderReleaseMonitor(...args); }
async function loadReleaseMonitor(...args) { return __getAdminBootstrapModule().loadReleaseMonitor(...args); }
async function transitionPostDeployRegressionResponse(...args) { return __getAdminBootstrapModule().transitionPostDeployRegressionResponse(...args); }
async function ensureAdminMediaPublisherModule(...args) { return __getAdminBootstrapModule().ensureAdminMediaPublisherModule(...args); }
async function generateMediaPublisherLink(...args) { return __getAdminBootstrapModule().generateMediaPublisherLink(...args); }
async function copyMediaPublisherPost(...args) { return __getAdminBootstrapModule().copyMediaPublisherPost(...args); }
async function ensureAdminLaunchFunnelModule(...args) { return __getAdminBootstrapModule().ensureAdminLaunchFunnelModule(...args); }
function renderLaunchFunnel(...args) { return __getAdminBootstrapModule().renderLaunchFunnel(...args); }
async function acknowledgeRecoveryIncident(...args) { return __getAdminBootstrapModule().acknowledgeRecoveryIncident(...args); }
async function loadLaunchFunnel(...args) { return __getAdminBootstrapModule().loadLaunchFunnel(...args); }
async function ensureAdminDiagnosticsModule(...args) { return __getAdminBootstrapModule().ensureAdminDiagnosticsModule(...args); }
function renderDiagnostics(...args) { return __getAdminBootstrapModule().renderDiagnostics(...args); }
async function loadDiagnostics(...args) { return __getAdminBootstrapModule().loadDiagnostics(...args); }
function openActivePassMatches(...args) { return __getAdminBootstrapModule().openActivePassMatches(...args); }
async function ensureBillingModule(...args) { return __getAdminBootstrapModule().ensureBillingModule(...args); }
function renderBilling(...args) { return __getAdminBootstrapModule().renderBilling(...args); }
async function loadBilling(...args) { return __getAdminBootstrapModule().loadBilling(...args); }
function showQuotaPaywall(...args) { return __getAdminBootstrapModule().showQuotaPaywall(...args); }
function showQuotaPaywallForFixture(...args) { return __getAdminBootstrapModule().showQuotaPaywallForFixture(...args); }
function hideQuotaPaywall(...args) { return __getAdminBootstrapModule().hideQuotaPaywall(...args); }
async function openPassStoreForFixture(...args) { return __getAdminBootstrapModule().openPassStoreForFixture(...args); }
async function ensureAdminProviderModule(...args) { return __getAdminBootstrapModule().ensureAdminProviderModule(...args); }
function renderProvider(...args) { return __getAdminBootstrapModule().renderProvider(...args); }
function renderProviderAudit(...args) { return __getAdminBootstrapModule().renderProviderAudit(...args); }
function renderExpandedDataReleaseGate(...args) { return __getAdminBootstrapModule().renderExpandedDataReleaseGate(...args); }
async function loadProvider(...args) { return __getAdminBootstrapModule().loadProvider(...args); }
async function probeProvider(...args) { return __getAdminBootstrapModule().probeProvider(...args); }
async function runProviderCoverageAudit(...args) { return __getAdminBootstrapModule().runProviderCoverageAudit(...args); }
async function runProviderE2E(...args) { return __getAdminBootstrapModule().runProviderE2E(...args); }
async function loadFavorites(...args) { return __getAdminBootstrapModule().loadFavorites(...args); }
async function loadReminders(...args) { return __getAdminBootstrapModule().loadReminders(...args); }
async function handleReminderRemove(...args) { return __getAdminBootstrapModule().handleReminderRemove(...args); }
async function savePreferencesFromUi(...args) { return __getAdminBootstrapModule().savePreferencesFromUi(...args); }
function favoriteSet(...args) { return __getAdminBootstrapModule().favoriteSet(...args); }
function isFavorite(...args) { return __getAdminBootstrapModule().isFavorite(...args); }
function favoriteMutationSelector(...args) { return __getAdminBootstrapModule().favoriteMutationSelector(...args); }
function syncFavoriteMutationUi(...args) { return __getAdminBootstrapModule().syncFavoriteMutationUi(...args); }
async function toggleFavorite(...args) { return __getAdminBootstrapModule().toggleFavorite(...args); }
let __discoveryModule;
function __getDiscoveryModule() {
  __discoveryModule ||= createDiscoveryModule({
    $,
    RECENT_TEAMS_KEY,
    activeViewId,
    analyzeMatch,
    api,
    apiErrorCategory,
    bindGlobalSearchControls,
    createGlobalSearchController,
    createGlobalSearchRenderer,
    dateTime,
    escapeHtml,
    friendlyErrorMessage,
    isAdmin,
    localDiscoveryResults,
    mergeById,
    openMatchCenter,
    openTeam,
    openTournament,
    renderGlobalSearch,
    renderProvider,
    renderTournamentHero,
    renderTournamentMatches,
    runGlobalSearch,
    runtimeAllows,
    safeUrl,
    sendActionError,
    sendOperationTiming,
    sendProductAction,
    setGlobalSearchMode,
    setTournamentTab,
    showView,
    state,
    toast,
  });
  return __discoveryModule;
}
function storageGet(...args) { return __getDiscoveryModule().storageGet(...args); }
function storageSet(...args) { return __getDiscoveryModule().storageSet(...args); }
function storageRemove(...args) { return __getDiscoveryModule().storageRemove(...args); }
function getRecentTeams(...args) { return __getDiscoveryModule().getRecentTeams(...args); }
function rememberTeam(...args) { return __getDiscoveryModule().rememberTeam(...args); }
function clearRecentTeams(...args) { return __getDiscoveryModule().clearRecentTeams(...args); }
function discoveryTeamCard(...args) { return __getDiscoveryModule().discoveryTeamCard(...args); }
function searchTeamSummaryCard(...args) { return __getDiscoveryModule().searchTeamSummaryCard(...args); }
function knownTeamSummaryCard(...args) { return __getDiscoveryModule().knownTeamSummaryCard(...args); }
function searchCompetitionSummaryCard(...args) { return __getDiscoveryModule().searchCompetitionSummaryCard(...args); }
function bindDiscoveryActions(...args) { return __getDiscoveryModule().bindDiscoveryActions(...args); }
function setDiscoveryHomeVisibility(...args) { return __getDiscoveryModule().setDiscoveryHomeVisibility(...args); }
function renderDiscoveryHome(...args) { return __getDiscoveryModule().renderDiscoveryHome(...args); }
function russianCountLabel(...args) { return __getDiscoveryModule().russianCountLabel(...args); }
function searchMatchCard(...args) { return __getDiscoveryModule().searchMatchCard(...args); }
function bindSearchMatchActions(...args) { return __getDiscoveryModule().bindSearchMatchActions(...args); }
function openTournamentMeta(...args) { return __getDiscoveryModule().openTournamentMeta(...args); }
let __matchesHomeModule;
function __getMatchesHomeModule() {
  __matchesHomeModule ||= createMatchesHomeModule({
    $,
    MATCH_SNAPSHOT_MAX_AGE_MS,
    MATCH_SNAPSHOT_PREFIX,
    MATCH_WATCHLIST_KEY,
    analyzeMatch,
    api,
    apiErrorCategory,
    bindCooldownRetry,
    dateTime,
    escapeHtml,
    favoriteSet,
    friendlyErrorMessage,
    hasReminder,
    isAdmin,
    isFavorite,
    localDate,
    openHistoryAnalysis,
    openMatchCenter,
    openTeam,
    openTournament,
    reminderFor,
    renderDiscoveryHome,
    renderGlobalSearch,
    renderProvider,
    russianCountLabel,
    safeUrl,
    sendActionError,
    showView,
    state,
    storageGet,
    storageRemove,
    storageSet,
    timeOf,
    toast,
    toggleFavorite,
    toggleReminder,
  });
  return __matchesHomeModule;
}
function matchSkeletonHtml(...args) { return __getMatchesHomeModule().matchSkeletonHtml(...args); }
function matchSnapshotKey(...args) { return __getMatchesHomeModule().matchSnapshotKey(...args); }
function readMatchSnapshot(...args) { return __getMatchesHomeModule().readMatchSnapshot(...args); }
function writeMatchSnapshot(...args) { return __getMatchesHomeModule().writeMatchSnapshot(...args); }
function applyMatchPayload(...args) { return __getMatchesHomeModule().applyMatchPayload(...args); }
async function loadMatches(...args) { return __getMatchesHomeModule().loadMatches(...args); }
function syncFilterButtons(...args) { return __getMatchesHomeModule().syncFilterButtons(...args); }
function normalizedSignalText(...args) { return __getMatchesHomeModule().normalizedSignalText(...args); }
function personalContextSignals(...args) { return __getMatchesHomeModule().personalContextSignals(...args); }
function personalMatchInsight(...args) { return __getMatchesHomeModule().personalMatchInsight(...args); }
function homePersonalMatch(...args) { return __getMatchesHomeModule().homePersonalMatch(...args); }
function homePersonalMatchMeta(...args) { return __getMatchesHomeModule().homePersonalMatchMeta(...args); }
function watchedMatch(...args) { return __getMatchesHomeModule().watchedMatch(...args); }
function isWatchedMatch(...args) { return __getMatchesHomeModule().isWatchedMatch(...args); }
function matchWatchlistSnapshot(...args) { return __getMatchesHomeModule().matchWatchlistSnapshot(...args); }
function persistMatchWatchlist(...args) { return __getMatchesHomeModule().persistMatchWatchlist(...args); }
function toggleMatchWatch(...args) { return __getMatchesHomeModule().toggleMatchWatch(...args); }
function radarFeedItems(...args) { return __getMatchesHomeModule().radarFeedItems(...args); }
function renderRadarFeed(...args) { return __getMatchesHomeModule().renderRadarFeed(...args); }
function renderDailyOverview(...args) { return __getMatchesHomeModule().renderDailyOverview(...args); }
function filteredMatches(...args) { return __getMatchesHomeModule().filteredMatches(...args); }
function categoryLabel(...args) { return __getMatchesHomeModule().categoryLabel(...args); }
function matchCenter(...args) { return __getMatchesHomeModule().matchCenter(...args); }
function renderPopularCompetitions(...args) { return __getMatchesHomeModule().renderPopularCompetitions(...args); }
function favoriteStarSvg(...args) { return __getMatchesHomeModule().favoriteStarSvg(...args); }
function matchCardHtml(...args) { return __getMatchesHomeModule().matchCardHtml(...args); }
function bindMatchActions(...args) { return __getMatchesHomeModule().bindMatchActions(...args); }
function analysisHistoryForFixture(...args) { return __getMatchesHomeModule().analysisHistoryForFixture(...args); }
function renderAiCenterSummary(...args) { return __getMatchesHomeModule().renderAiCenterSummary(...args); }
function renderAiFocus(...args) { return __getMatchesHomeModule().renderAiFocus(...args); }
function homeMatchSections(...args) { return __getMatchesHomeModule().homeMatchSections(...args); }
function homeMatchSectionsHtml(...args) { return __getMatchesHomeModule().homeMatchSectionsHtml(...args); }
function renderMatches(...args) { return __getMatchesHomeModule().renderMatches(...args); }
let __tournamentModule;
function __getTournamentModule() {
  __tournamentModule ||= createTournamentModule({
    $,
    activeViewId,
    api,
    bindMatchActions,
    categoryLabel,
    dateOnly,
    escapeHtml,
    isAdmin,
    localDate,
    matchCardHtml,
    openTeam,
    recoveryCardHtml,
    renderProvider,
    safeUrl,
    showView,
    state,
    toast,
  });
  return __tournamentModule;
}
function currentTournamentMatches(...args) { return __getTournamentModule().currentTournamentMatches(...args); }
function tournamentKey(...args) { return __getTournamentModule().tournamentKey(...args); }
function openTournament(...args) { return __getTournamentModule().openTournament(...args); }
function renderTournamentHero(...args) { return __getTournamentModule().renderTournamentHero(...args); }
function renderTournamentMatches(...args) { return __getTournamentModule().renderTournamentMatches(...args); }
function standingFormHtml(...args) { return __getTournamentModule().standingFormHtml(...args); }
function renderTournamentStandings(...args) { return __getTournamentModule().renderTournamentStandings(...args); }
async function loadTournamentStandings(...args) { return __getTournamentModule().loadTournamentStandings(...args); }
function setTournamentTab(...args) { return __getTournamentModule().setTournamentTab(...args); }
let __teamHubModule;
function __getTeamHubModule() {
  __teamHubModule ||= createTeamHubModule({
    $,
    activeViewId,
    analyzeMatch,
    api,
    dateTime,
    escapeHtml,
    isAdmin,
    isFavorite,
    openMatchCenter,
    openTournament,
    recoveryCardHtml,
    rememberTeam,
    renderDiscoveryHome,
    renderProvider,
    renderTournamentHero,
    renderTournamentMatches,
    russianCountLabel,
    safeUrl,
    setTournamentTab,
    showView,
    state,
    toast,
    toggleFavorite,
  });
  return __teamHubModule;
}
function teamResultBadge(...args) { return __getTeamHubModule().teamResultBadge(...args); }
function teamMatchRow(...args) { return __getTeamHubModule().teamMatchRow(...args); }
function bindTeamFixtureActions(...args) { return __getTeamHubModule().bindTeamFixtureActions(...args); }
function teamPercent(...args) { return __getTeamHubModule().teamPercent(...args); }
function teamDecimal(...args) { return __getTeamHubModule().teamDecimal(...args); }
function teamFormBadges(...args) { return __getTeamHubModule().teamFormBadges(...args); }
function seasonSplitCard(...args) { return __getTeamHubModule().seasonSplitCard(...args); }
function teamPlayerSeasonStatsHtml(...args) { return __getTeamHubModule().teamPlayerSeasonStatsHtml(...args); }
function renderTeamIntelligence(...args) { return __getTeamHubModule().renderTeamIntelligence(...args); }
async function loadTeamIntelligence(...args) { return __getTeamHubModule().loadTeamIntelligence(...args); }
function playerCard(...args) { return __getTeamHubModule().playerCard(...args); }
function renderTeamSquad(...args) { return __getTeamHubModule().renderTeamSquad(...args); }
async function loadTeamSquad(...args) { return __getTeamHubModule().loadTeamSquad(...args); }
function renderTeamHub(...args) { return __getTeamHubModule().renderTeamHub(...args); }
async function loadTeamHub(...args) { return __getTeamHubModule().loadTeamHub(...args); }
function openTeam(...args) { return __getTeamHubModule().openTeam(...args); }
function setTeamTab(...args) { return __getTeamHubModule().setTeamTab(...args); }
function openTournamentFromTeam(...args) { return __getTeamHubModule().openTournamentFromTeam(...args); }
let __matchLiveModule;
function __getMatchLiveModule() {
  __matchLiveModule ||= createMatchCenterLiveCore({
    categoryLabel,
    dateTime,
    ensureMatchCenterController,
    escapeHtml,
    matchCenterController,
    publicText,
    safeUrl,
    sendActionError,
    state,
  });
  return __matchLiveModule;
}
function minuteLabel(...args) { return __getMatchLiveModule().minuteLabel(...args); }
function liveEventsHtml(...args) { return __getMatchLiveModule().liveEventsHtml(...args); }
function lineupPlayerName(...args) { return __getMatchLiveModule().lineupPlayerName(...args); }
function lineupPlayerNumber(...args) { return __getMatchLiveModule().lineupPlayerNumber(...args); }
function lineupPlayerGrid(...args) { return __getMatchLiveModule().lineupPlayerGrid(...args); }
function shortPlayerName(...args) { return __getMatchLiveModule().shortPlayerName(...args); }
function lineupPitchHtml(...args) { return __getMatchLiveModule().lineupPitchHtml(...args); }
function lineupQualityLabel(...args) { return __getMatchLiveModule().lineupQualityLabel(...args); }
function lineupTeamHtml(...args) { return __getMatchLiveModule().lineupTeamHtml(...args); }
function lineupLiveHtml(...args) { return __getMatchLiveModule().lineupLiveHtml(...args); }
async function requestMatchCenter(...args) { return __getMatchLiveModule().requestMatchCenter(...args); }
function startLiveRefresh(...args) { return __getMatchLiveModule().startLiveRefresh(...args); }
function signedPp(...args) { return __getMatchLiveModule().signedPp(...args); }
function oddsMovementHtml(...args) { return __getMatchLiveModule().oddsMovementHtml(...args); }
function playerMetricText(...args) { return __getMatchLiveModule().playerMetricText(...args); }
function absenceKindLabel(...args) { return __getMatchLiveModule().absenceKindLabel(...args); }
function absenceStatusLabel(...args) { return __getMatchLiveModule().absenceStatusLabel(...args); }
function liveAbsencesHtml(...args) { return __getMatchLiveModule().liveAbsencesHtml(...args); }
function centerStatNumber(...args) { return __getMatchLiveModule().centerStatNumber(...args); }
function centerStatRow(...args) { return __getMatchLiveModule().centerStatRow(...args); }
function centerCompareRow(...args) { return __getMatchLiveModule().centerCompareRow(...args); }
function centerKeyStatsHtml(...args) { return __getMatchLiveModule().centerKeyStatsHtml(...args); }
function availabilityQualityHintHtml(...args) { return __getMatchLiveModule().availabilityQualityHintHtml(...args); }
function xgQualityHintHtml(...args) { return __getMatchLiveModule().xgQualityHintHtml(...args); }
function eventQualityHintHtml(...args) { return __getMatchLiveModule().eventQualityHintHtml(...args); }
function statisticsQualityHintHtml(...args) { return __getMatchLiveModule().statisticsQualityHintHtml(...args); }
function oddsQualityHintHtml(...args) { return __getMatchLiveModule().oddsQualityHintHtml(...args); }
function centerAllStatsHtml(...args) { return __getMatchLiveModule().centerAllStatsHtml(...args); }
function timelineEventsHtml(...args) { return __getMatchLiveModule().timelineEventsHtml(...args); }
function centerPlayersHtml(...args) { return __getMatchLiveModule().centerPlayersHtml(...args); }
let __playerHubModule;
function __getPlayerHubModule() {
  __playerHubModule ||= createPlayerHubModule({
    $,
    activeViewId,
    api,
    buildPlayerComparisonCandidates,
    escapeHtml,
    friendlyErrorMessage,
    loadFavoritePlayers,
    playerComparisonHtml,
    playerFollowModule,
    publicText,
    safeUrl,
    samePlayer,
    sendProductAction,
    showView,
    state,
    toast,
  });
  return __playerHubModule;
}
function playerPositionLabel(...args) { return __getPlayerHubModule().playerPositionLabel(...args); }
function playerHubMetric(...args) { return __getPlayerHubModule().playerHubMetric(...args); }
function playerSquadProfile(...args) { return __getPlayerHubModule().playerSquadProfile(...args); }
function playerSquadProfileHtml(...args) { return __getPlayerHubModule().playerSquadProfileHtml(...args); }
async function loadPlayerSquadProfile(...args) { return __getPlayerHubModule().loadPlayerSquadProfile(...args); }
function playerSeasonStatProfile(...args) { return __getPlayerHubModule().playerSeasonStatProfile(...args); }
function playerSeasonStatsHtml(...args) { return __getPlayerHubModule().playerSeasonStatsHtml(...args); }
async function loadPlayerSeasonStats(...args) { return __getPlayerHubModule().loadPlayerSeasonStats(...args); }
function playerComparisonSquadSources(...args) { return __getPlayerHubModule().playerComparisonSquadSources(...args); }
function enrichPlayerComparisonCandidate(...args) { return __getPlayerHubModule().enrichPlayerComparisonCandidate(...args); }
function playerComparisonCandidatesFor(...args) { return __getPlayerHubModule().playerComparisonCandidatesFor(...args); }
async function hydrateComparisonPlayer(...args) { return __getPlayerHubModule().hydrateComparisonPlayer(...args); }
function bindPlayerComparisonActions(...args) { return __getPlayerHubModule().bindPlayerComparisonActions(...args); }
function renderPlayerHub(...args) { return __getPlayerHubModule().renderPlayerHub(...args); }
function openPlayerFromMatch(...args) { return __getPlayerHubModule().openPlayerFromMatch(...args); }
let __matchRenderModule;
function __getMatchRenderModule() {
  __matchRenderModule ||= createMatchCenterRenderModule({
    $,
    analyzeMatch,
    api,
    availabilityQualityHintHtml,
    bindRovingTabKeyboard,
    centerAllStatsHtml,
    centerKeyStatsHtml,
    centerPlayersHtml,
    dateTime,
    ensureMatchCenterController,
    escapeHtml,
    eventQualityHintHtml,
    isAdmin,
    lineupLiveHtml,
    liveAbsencesHtml,
    liveEventsHtml,
    matchCenterExtras,
    minuteLabel,
    oddsMovementHtml,
    oddsQualityHintHtml,
    openPassStoreForFixture,
    openPlayerFromMatch,
    openProfileView,
    openTeam,
    publicText,
    renderProvider,
    requestMatchCenter,
    runProviderCoverageAudit,
    runProviderE2E,
    safeUrl,
    signedPp,
    startLiveRefresh,
    state,
    statisticsQualityHintHtml,
    stopLiveRefresh,
    timeOf,
    timelineEventsHtml,
    toast,
    xgQualityHintHtml,
  });
  return __matchRenderModule;
}
function freshnessSourceLabel(...args) { return __getMatchRenderModule().freshnessSourceLabel(...args); }
function freshnessAgeLabel(...args) { return __getMatchRenderModule().freshnessAgeLabel(...args); }
function centerFreshnessHtml(...args) { return __getMatchRenderModule().centerFreshnessHtml(...args); }
function centerCoverageHtml(...args) { return __getMatchRenderModule().centerCoverageHtml(...args); }
function centerMarketHtml(...args) { return __getMatchRenderModule().centerMarketHtml(...args); }
function centerAbsenceSummary(...args) { return __getMatchRenderModule().centerAbsenceSummary(...args); }
function setMatchCenterTab(...args) { return __getMatchRenderModule().setMatchCenterTab(...args); }
function bindMatchCenterTabs(...args) { return __getMatchRenderModule().bindMatchCenterTabs(...args); }
function insightSideLabel(...args) { return __getMatchRenderModule().insightSideLabel(...args); }
function smartInsightCardHtml(...args) { return __getMatchRenderModule().smartInsightCardHtml(...args); }
function matchChangeNarrativeHtml(...args) { return __getMatchRenderModule().matchChangeNarrativeHtml(...args); }
function smartInsightsHeroHtml(...args) { return __getMatchRenderModule().smartInsightsHeroHtml(...args); }
function smartInsightsFullHtml(...args) { return __getMatchRenderModule().smartInsightsFullHtml(...args); }
function liveAiCoachHtml(...args) { return __getMatchRenderModule().liveAiCoachHtml(...args); }
function postMatchReviewHtml(...args) { return __getMatchRenderModule().postMatchReviewHtml(...args); }
function renderMatchCenter(...args) { return __getMatchRenderModule().renderMatchCenter(...args); }
async function openMatchCenter(...args) { return __getMatchRenderModule().openMatchCenter(...args); }
let __analysisOrchestrationModule;
function __getAnalysisOrchestrationModule() {
  __analysisOrchestrationModule ||= createAnalysisOrchestrationModule({
    activeViewId,
    aiTrackRecordRenderer,
    aiTrackRecordRendererPromise,
    api,
    dateTime,
    ensureAnalysisController,
    ensureMatchCenterExtras,
    escapeHtml,
    historyRenderer,
    historyRendererPromise,
    recoveryCardHtml,
    relativeAge,
    renderAnalysis,
    renderMatchCenter,
    renderMatches,
    requestMatchCenter,
    safeUrl,
    sendActionError,
    sendProductAction,
    showView,
    state,
    toast,
  });
  return __analysisOrchestrationModule;
}
function syncAnalysisBusyUi(...args) { return __getAnalysisOrchestrationModule().syncAnalysisBusyUi(...args); }
async function analyzeMatch(...args) { return __getAnalysisOrchestrationModule().analyzeMatch(...args); }
function historyItemFromAnalysis(...args) { return __getAnalysisOrchestrationModule().historyItemFromAnalysis(...args); }
function rememberHistoryAnalysis(...args) { return __getAnalysisOrchestrationModule().rememberHistoryAnalysis(...args); }
async function loadAiTrackRecord(...args) { return __getAnalysisOrchestrationModule().loadAiTrackRecord(...args); }
async function ensureAiTrackRecordRenderer(...args) { return __getAnalysisOrchestrationModule().ensureAiTrackRecordRenderer(...args); }
function renderAiTrackRecord(...args) { return __getAnalysisOrchestrationModule().renderAiTrackRecord(...args); }
async function loadHistory(...args) { return __getAnalysisOrchestrationModule().loadHistory(...args); }
async function openHistoryAnalysis(...args) { return __getAnalysisOrchestrationModule().openHistoryAnalysis(...args); }
async function ensureHistoryRenderer(...args) { return __getAnalysisOrchestrationModule().ensureHistoryRenderer(...args); }
function renderHistory(...args) { return __getAnalysisOrchestrationModule().renderHistory(...args); }
let __analysisPresentationModule;
function __getAnalysisPresentationModule() {
  __analysisPresentationModule ||= createAnalysisPresentationModule({
    $,
    absenceKindLabel,
    absenceStatusLabel,
    analysisAccessUsageHtml,
    analysisHistoryForFixture,
    analyzeMatch,
    api,
    availabilityQualityHintHtml,
    calibrationModeLabel,
    dataPolicyModeLabel,
    dateTime,
    escapeHtml,
    favoriteStarSvg,
    isFavorite,
    launchIntentHandled,
    lineupPlayerName,
    lineupPlayerNumber,
    loadAiTrackRecord,
    loadFavorites,
    loadHistory,
    loadReminders,
    oddsQualityHintHtml,
    openHistoryAnalysis,
    openMatchCenter,
    openTeam,
    predictionAdviceLabel,
    publicText,
    renderDiscoveryHome,
    renderGlobalSearch,
    renderProfile,
    renderReminderList,
    runGlobalSearch,
    runtimeAllows,
    safeUrl,
    showView,
    state,
    tg,
    toast,
    toggleFavorite,
  });
  return __analysisPresentationModule;
}
function pct(...args) { return __getAnalysisPresentationModule().pct(...args); }
function formSequence(...args) { return __getAnalysisPresentationModule().formSequence(...args); }
function likelyOutcomeDisplay(...args) { return __getAnalysisPresentationModule().likelyOutcomeDisplay(...args); }
function formCard(...args) { return __getAnalysisPresentationModule().formCard(...args); }
function modelWeightsText(...args) { return __getAnalysisPresentationModule().modelWeightsText(...args); }
function bullets(...args) { return __getAnalysisPresentationModule().bullets(...args); }
function reminderFor(...args) { return __getAnalysisPresentationModule().reminderFor(...args); }
function hasReminder(...args) { return __getAnalysisPresentationModule().hasReminder(...args); }
function syncQuickReminderButton(...args) { return __getAnalysisPresentationModule().syncQuickReminderButton(...args); }
function syncAllQuickReminderButtons(...args) { return __getAnalysisPresentationModule().syncAllQuickReminderButtons(...args); }
function syncReminderMutationUi(...args) { return __getAnalysisPresentationModule().syncReminderMutationUi(...args); }
async function toggleReminder(...args) { return __getAnalysisPresentationModule().toggleReminder(...args); }
function clampPercent(...args) { return __getAnalysisPresentationModule().clampPercent(...args); }
function qualityInfo(...args) { return __getAnalysisPresentationModule().qualityInfo(...args); }
function probabilityStrip(...args) { return __getAnalysisPresentationModule().probabilityStrip(...args); }
function compactAbsence(...args) { return __getAnalysisPresentationModule().compactAbsence(...args); }
function lineupBlock(...args) { return __getAnalysisPresentationModule().lineupBlock(...args); }
async function shareAnalysis(...args) { return __getAnalysisPresentationModule().shareAnalysis(...args); }
function bindRovingTabKeyboard(...args) { return __getAnalysisPresentationModule().bindRovingTabKeyboard(...args); }
function setAnalysisTab(...args) { return __getAnalysisPresentationModule().setAnalysisTab(...args); }
function bindAnalysisTabs(...args) { return __getAnalysisPresentationModule().bindAnalysisTabs(...args); }
function comparisonValue(...args) { return __getAnalysisPresentationModule().comparisonValue(...args); }
function comparisonMetricRow(...args) { return __getAnalysisPresentationModule().comparisonMetricRow(...args); }
function comparisonAdvantages(...args) { return __getAnalysisPresentationModule().comparisonAdvantages(...args); }
function comparisonTeamHeader(...args) { return __getAnalysisPresentationModule().comparisonTeamHeader(...args); }
function prematchOutcomeName(...args) { return __getAnalysisPresentationModule().prematchOutcomeName(...args); }
function prematchDriverCard(...args) { return __getAnalysisPresentationModule().prematchDriverCard(...args); }
function prematchScenarioCard(...args) { return __getAnalysisPresentationModule().prematchScenarioCard(...args); }
function prematchSourceRow(...args) { return __getAnalysisPresentationModule().prematchSourceRow(...args); }
function prematchBriefHtml(...args) { return __getAnalysisPresentationModule().prematchBriefHtml(...args); }
function providerCoverageHtml(...args) { return __getAnalysisPresentationModule().providerCoverageHtml(...args); }
function aiInstructorHtml(...args) { return __getAnalysisPresentationModule().aiInstructorHtml(...args); }
async function openLaunchFixture(...args) { return __getAnalysisPresentationModule().openLaunchFixture(...args); }
function applyLaunchIntent(...args) { return __getAnalysisPresentationModule().applyLaunchIntent(...args); }
function analysisFreshnessHtml(...args) { return __getAnalysisPresentationModule().analysisFreshnessHtml(...args); }
function kickoffHandoffHtml(...args) { return __getAnalysisPresentationModule().kickoffHandoffHtml(...args); }
function dataProvenanceHtml(...args) { return __getAnalysisPresentationModule().dataProvenanceHtml(...args); }
function cockpitProviderLabel(...args) { return __getAnalysisPresentationModule().cockpitProviderLabel(...args); }
function matchCockpitHtml(...args) { return __getAnalysisPresentationModule().matchCockpitHtml(...args); }
function analysisGlanceHtml(...args) { return __getAnalysisPresentationModule().analysisGlanceHtml(...args); }
function renderAnalysis(...args) { return __getAnalysisPresentationModule().renderAnalysis(...args); }
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
  if (document.querySelector('meta[name="matchradar-surface"]')?.content === 'admin') {
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

