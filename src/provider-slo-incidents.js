import { DEFAULT_PROVIDER_SLO_POLICY, providerSloState } from './provider-observability.js';

const ACTIONABLE_STATES = new Set(['healthy','watch','incident']);

function asIso(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(part, total) {
  return total > 0 ? Math.round((finite(part) / total) * 1000) / 10 : null;
}

function severityRank(state = '') {
  return ({ healthy:0, watch:1, incident:2 })[String(state)] ?? -1;
}

function slug(value = '') {
  return String(value || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,24) || 'provider';
}

function summarizeMetricRow(row = {}) {
  const requests = finite(row.requests);
  const attempts = finite(row.attempts);
  const successes = finite(row.successes);
  const failures = finite(row.failures);
  const retries = finite(row.retries);
  const timeouts = finite(row.timeouts);
  const rateLimits = finite(row.rateLimits);
  const latencySamples = finite(row.latencySamples);
  const latencySumMs = finite(row.latencySumMs);
  return {
    provider:String(row.provider || 'provider').trim() || 'provider',
    operation:String(row.operation || 'unknown').trim() || 'unknown',
    attempts,
    requests,
    successes,
    failures,
    retries,
    timeouts,
    rateLimits,
    networkErrors:finite(row.networkErrors),
    httpErrors:finite(row.httpErrors),
    invalidResponses:finite(row.invalidResponses),
    successRatePct: nullableNumber(row.successRatePct) ?? pct(successes, requests),
    errorRatePct: nullableNumber(row.errorRatePct) ?? pct(failures, requests),
    timeoutRatePct: nullableNumber(row.timeoutRatePct) ?? pct(timeouts, requests),
    rateLimitRatePct: nullableNumber(row.rateLimitRatePct) ?? pct(rateLimits, requests),
    retryRatePct: nullableNumber(row.retryRatePct) ?? pct(retries, requests),
    avgAttemptLatencyMs: nullableNumber(row.avgAttemptLatencyMs)
      ?? (latencySamples > 0 ? Math.round(latencySumMs / latencySamples) : null),
    maxLatencyMs: nullableNumber(row.maxLatencyMs),
  };
}

function normalizeWindow(row = {}) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : row;
  const endedAt = asIso(meta?.windowEndedAt || row?.created_at);
  const startedAt = asIso(meta?.windowStartedAt || row?.created_at);
  const reportedState = String(meta?.sloState || '').trim().toLowerCase();
  const totals = summarizeMetricRow({
    provider:'all',
    operation:'all',
    ...(meta?.totals && typeof meta.totals === 'object' ? meta.totals : {}),
  });
  const derivedState=providerSloState(totals).state;
  const stateMismatch=ACTIONABLE_STATES.has(reportedState) && reportedState!==derivedState;
  const series = Array.isArray(meta?.series)
    ? meta.series.filter(x => x && typeof x === 'object').slice(0,24).map(summarizeMetricRow)
    : [];
  return {
    windowId:String(meta?.windowId || `${startedAt}|${endedAt}`),
    startedAt,
    endedAt,
    state:stateMismatch ? 'invalid' : derivedState,
    reportedState,
    derivedState,
    stateMismatch,
    complete:meta?.complete !== false,
    totals,
    series,
  };
}

const PROVIDER_SLO_WINDOW_MINUTES=15;
const PROVIDER_SLO_CADENCE_TOLERANCE_MS=90_000;

function windowTiming(window = {}) {
  const start=Date.parse(String(window.startedAt || ''));
  const end=Date.parse(String(window.endedAt || ''));
  return {
    start,
    end,
    valid:Number.isFinite(start) && Number.isFinite(end) && end>start,
    durationMs:Number.isFinite(start) && Number.isFinite(end) ? end-start : NaN,
  };
}

function validWindowDuration(window = {}) {
  const timing=windowTiming(window);
  const expected=PROVIDER_SLO_WINDOW_MINUTES*60_000;
  return timing.valid && Math.abs(timing.durationMs-expected)<=PROVIDER_SLO_CADENCE_TOLERANCE_MS;
}

function windowCadence(previous = {}, current = {}) {
  const a=windowTiming(previous);
  const b=windowTiming(current);
  if (!a.valid || !b.valid) return 'invalid';
  const delta=b.start-a.end;
  if (Math.abs(delta)<=PROVIDER_SLO_CADENCE_TOLERANCE_MS) return 'contiguous';
  return delta>0 ? 'gap' : 'overlap';
}

function canonicalWindows(rows = []) {
  const byIdentity=new Map();
  let duplicates=0;
  for (const row of rows || []) {
    const window=normalizeWindow(row);
    if (!window.endedAt || !window.startedAt) continue;
    const identity=window.windowId || `${window.startedAt}|${window.endedAt}`;
    if (byIdentity.has(identity)) duplicates+=1;
    byIdentity.set(identity,window);
  }
  const windows=[...byIdentity.values()]
    .sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt) || Date.parse(a.startedAt)-Date.parse(b.startedAt));
  const integrity={
    duplicates,
    gaps:0,
    overlaps:0,
    invalidDuration:0,
    incomplete:0,
    stateMismatches:0,
  };
  for (let i=0;i<windows.length;i+=1) {
    const window=windows[i];
    if (!validWindowDuration(window)) integrity.invalidDuration+=1;
    if (!window.complete) integrity.incomplete+=1;
    if (window.stateMismatch) integrity.stateMismatches+=1;
    if (i>0) {
      const cadence=windowCadence(windows[i-1],window);
      if (cadence==='gap') integrity.gaps+=1;
      else if (cadence==='overlap') integrity.overlaps+=1;
    }
  }
  return {windows,integrity};
}

function transitionKind(previousState, state) {
  if ((!previousState || previousState === 'healthy') && ['watch','incident'].includes(state)) return 'opened';
  if (['watch','incident'].includes(previousState) && state === 'healthy') return 'recovered';
  if (previousState === 'watch' && state === 'incident') return 'escalated';
  if (previousState === 'incident' && state === 'watch') return 'deescalated';
  return 'changed';
}

function metricBreaches(metrics = {}, state = 'incident') {
  const policy = DEFAULT_PROVIDER_SLO_POLICY;
  const incident = state === 'incident';
  const successThreshold = incident ? policy.incidentSuccessRatePct : policy.successRatePct;
  const timeoutThreshold = incident ? policy.incidentTimeoutRatePct : policy.timeoutRatePct;
  const rateLimitThreshold = incident ? policy.incidentRateLimitRatePct : policy.rateLimitRatePct;
  const retryThreshold = incident ? policy.incidentRetryRatePct : policy.retryRatePct;
  const latencyThreshold = incident ? policy.incidentAvgAttemptLatencyMs : policy.avgAttemptLatencyMs;
  const out = [];
  if (metrics.successRatePct !== null && Number(metrics.successRatePct) < successThreshold) {
    out.push('success rate ' + Number(metrics.successRatePct).toFixed(1) + '% < ' + successThreshold + '%');
  }
  if (metrics.errorRatePct !== null && Number(metrics.errorRatePct) > 0) {
    out.push('error rate ' + Number(metrics.errorRatePct).toFixed(1) + '%');
  }
  if (metrics.timeoutRatePct !== null && Number(metrics.timeoutRatePct) > timeoutThreshold) {
    out.push('timeout rate ' + Number(metrics.timeoutRatePct).toFixed(1) + '% > ' + timeoutThreshold + '%');
  }
  if (metrics.rateLimitRatePct !== null && Number(metrics.rateLimitRatePct) > rateLimitThreshold) {
    out.push('rate-limit rate ' + Number(metrics.rateLimitRatePct).toFixed(1) + '% > ' + rateLimitThreshold + '%');
  }
  if (metrics.retryRatePct !== null && Number(metrics.retryRatePct) > retryThreshold) {
    out.push('retry rate ' + Number(metrics.retryRatePct).toFixed(1) + '% > ' + retryThreshold + '%');
  }
  if (metrics.avgAttemptLatencyMs !== null && Number(metrics.avgAttemptLatencyMs) > latencyThreshold) {
    out.push('latency ' + Math.round(Number(metrics.avgAttemptLatencyMs)) + ' ms > ' + latencyThreshold + ' ms');
  }
  return out;
}

function diagnosticRank(row = {}) {
  const state = providerSloState(row).state;
  const stateScore = state === 'incident' ? 3 : state === 'watch' ? 2 : state === 'collecting' ? 1 : 0;
  return stateScore * 1_000_000
    + finite(row.failures) * 10_000
    + finite(row.timeouts) * 1000
    + finite(row.rateLimits) * 100
    + finite(row.requests);
}

function diagnosticsForWindow(window = {}) {
  const series = Array.isArray(window.series) ? window.series : [];
  const classified = series.map(row => ({ ...row, sloState:providerSloState(row).state }));
  const affected = classified
    .filter(row => ['watch','incident'].includes(row.sloState))
    .sort((a,b) => diagnosticRank(b) - diagnosticRank(a));
  const ranked = [...classified].sort((a,b) => diagnosticRank(b) - diagnosticRank(a));
  const primary = affected[0] || ranked[0] || null;
  const affectedProviders = [...new Set((affected.length ? affected : primary ? [primary] : []).map(row => row.provider))].slice(0,6);
  const affectedOperations = [...new Set((affected.length ? affected : primary ? [primary] : []).map(row => row.operation))].slice(0,8);
  const metrics = window.totals || summarizeMetricRow({});
  const reasonParts = metricBreaches(metrics, window.state === 'watch' ? 'watch' : 'incident');
  return {
    primaryProvider:primary?.provider || (affectedProviders[0] || 'all'),
    primaryOperation:primary?.operation || (affectedOperations[0] || 'all'),
    affectedProviders,
    affectedOperations,
    sampleSize:finite(metrics.requests),
    requests:finite(metrics.requests),
    successes:finite(metrics.successes),
    failures:finite(metrics.failures),
    errorRatePct:nullableNumber(metrics.errorRatePct),
    successRatePct:nullableNumber(metrics.successRatePct),
    timeoutRatePct:nullableNumber(metrics.timeoutRatePct),
    rateLimitRatePct:nullableNumber(metrics.rateLimitRatePct),
    retryRatePct:nullableNumber(metrics.retryRatePct),
    avgAttemptLatencyMs:nullableNumber(metrics.avgAttemptLatencyMs),
    maxLatencyMs:nullableNumber(metrics.maxLatencyMs),
    reason:reasonParts.length ? reasonParts.slice(0,4).join('; ') : 'Provider SLO left the target range.',
  };
}

function incidentIdFor(transition = {}, diagnostics = {}) {
  const startMs = Date.parse(String(transition?.confirmedBy?.[0] || transition?.at || ''));
  const stamp = Number.isFinite(startMs) ? Math.floor(startMs / 1000).toString(36) : 'unknown';
  return 'pslo-' + slug(diagnostics.primaryProvider || 'provider') + '-' + stamp;
}

function episodeSeverity(episode = {}) {
  if (episode.highestState !== 'incident') return 'warning';
  const d = episode.diagnostics || {};
  const sample = finite(d.sampleSize);
  const duration = finite(episode.durationMinutes);
  const severeImmediate = sample >= 20 && (
    finite(d.errorRatePct) >= 50
    || finite(d.timeoutRatePct) >= 20
    || finite(d.rateLimitRatePct) >= 20
    || finite(d.avgAttemptLatencyMs) >= 10_000
  );
  const severeSustained = sample >= 40 && duration >= 180 && (
    finite(d.errorRatePct) >= 25
    || finite(d.timeoutRatePct) >= 10
    || finite(d.rateLimitRatePct) >= 10
    || finite(d.avgAttemptLatencyMs) >= 7000
  );
  return severeImmediate || severeSustained ? 'critical' : 'incident';
}

function buildRunbook(metrics = {}, diagnostics = {}) {
  const steps = [
    'Откройте админ-панель Provider SLO и последние PROVIDER_SLO_WINDOW / PROVIDER_SLO_* события в ops_events; сопоставьте provider и operation.',
  ];
  if (Number(metrics.rateLimitRatePct || 0) > 2) {
    steps.push('Проверить Retry-After, provider_rate_windows, shared quota/cooldown и остаток лимита источника; не увеличивать частоту запросов до нормализации.');
  }
  if (Number(metrics.timeoutRatePct || 0) > 2) {
    steps.push('Проверить доступность upstream и сетевую задержку; убедиться, что bounded retry остаётся ограниченным и не создаёт шторм повторов.');
  }
  if (Number(metrics.retryRatePct || 0) > 10) {
    steps.push('Сопоставить рост retry с конкретными provider/operation и проверить повторяющуюся transient-деградацию в operational logs.');
  }
  if (Number(metrics.avgAttemptLatencyMs || 0) > 2500) {
    steps.push('Проверить latency по provider/operation и не расширять нагрузку, пока задержка не вернётся в целевой диапазон.');
  }
  if (metrics.successRatePct !== null && Number(metrics.successRatePct) < 98) {
    steps.push('Определить impact по затронутым операциям и проверить, что пользовательский runtime использует существующие analysis_cache/stale fallback там, где это предусмотрено.');
  }
  steps.push('Безопасные ручные действия: проверить upstream/status, квоту, cache и логи; не выполнять автоматический rollback, provider switch или отключение функций из этого контура.');
  steps.push('Восстановление подтверждается двумя последовательными healthy SLO-окнами; затем должен появиться PROVIDER_SLO_RECOVERED для того же Incident ID.');
  if (diagnostics.primaryOperation && diagnostics.primaryOperation !== 'all') {
    steps.unshift('Приоритетная проверка: ' + diagnostics.primaryProvider + ' · ' + diagnostics.primaryOperation + '.');
  }
  return steps.slice(0,7);
}

function lastHealthyBefore(windows, at) {
  const boundary = Date.parse(String(at || ''));
  const healthy = windows
    .filter(window => window.state === 'healthy' && (!Number.isFinite(boundary) || Date.parse(window.endedAt) < boundary))
    .at(-1);
  return healthy?.endedAt || null;
}

export function buildProviderSloIncidentTimeline(rows = [], { nowMs = Date.now() } = {}) {
  const canonical=canonicalWindows(rows);
  const windows=canonical.windows;

  const transitions = [];
  let confirmedState = '';

  for (let i = 1; i < windows.length; i += 1) {
    const previous = windows[i - 1];
    const current = windows[i];
    if (
      !previous.complete
      || !current.complete
      || !validWindowDuration(previous)
      || !validWindowDuration(current)
      || windowCadence(previous,current)!=='contiguous'
      || previous.stateMismatch
      || current.stateMismatch
      || !ACTIONABLE_STATES.has(previous.state)
      || current.state !== previous.state
    ) continue;
    const nextState = current.state;
    if (nextState === confirmedState) continue;

    const diagnostics = diagnosticsForWindow(current);
    const transition = {
      state: nextState,
      previousState: confirmedState || null,
      kind: transitionKind(confirmedState, nextState),
      at: current.endedAt,
      confirmedBy: [previous.endedAt, current.endedAt],
      metrics: current.totals,
      diagnostics,
      incidentId:null,
    };
    transitions.push(transition);
    confirmedState = nextState;
  }

  const episodes = [];
  let active = null;

  for (const transition of transitions) {
    if (['watch','incident'].includes(transition.state)) {
      if (!active) {
        const firstConfirmedWindow = windows.find(window => window.endedAt === transition.confirmedBy?.[0]);
        const startedAt = firstConfirmedWindow?.startedAt || transition.confirmedBy?.[0] || transition.at;
        active = {
          incidentId:incidentIdFor(transition, transition.diagnostics),
          startedAt,
          confirmedAt:transition.at,
          initialState:transition.state,
          state:transition.state,
          highestState:transition.state,
          latestAt:transition.at,
          lastDegradedAt:transition.at,
          recoveredAt:null,
          active:true,
          transitions:[],
          metrics:transition.metrics,
          diagnostics:transition.diagnostics,
          recoveryMetrics:null,
          recoveryDiagnostics:null,
          lastHealthyWindowAt:lastHealthyBefore(windows, startedAt),
        };
        episodes.push(active);
      } else {
        active.state = transition.state;
        active.latestAt = transition.at;
        active.lastDegradedAt = transition.at;
        active.metrics = transition.metrics;
        active.diagnostics = transition.diagnostics;
        if (severityRank(transition.state) > severityRank(active.highestState)) active.highestState = transition.state;
      }
      transition.incidentId = active.incidentId;
      active.transitions.push(transition);
      continue;
    }

    if (transition.state === 'healthy' && active) {
      transition.incidentId = active.incidentId;
      active.state = 'recovered';
      active.latestAt = transition.at;
      active.recoveredAt = transition.at;
      active.active = false;
      active.recoveryMetrics = transition.metrics;
      active.recoveryDiagnostics = transition.diagnostics;
      active.transitions.push(transition);
      active = null;
    }
  }

  const now = Number(nowMs || Date.now());
  for (const episode of episodes) {
    const start = Date.parse(episode.startedAt || '');
    const end = Date.parse(episode.recoveredAt || '');
    const effectiveEnd = Number.isFinite(end) ? end : now;
    const badWindows = windows.filter(window => {
      const t = Date.parse(window.endedAt || '');
      if (!Number.isFinite(t) || !Number.isFinite(start) || t < start) return false;
      if (Number.isFinite(end) && t >= end) return false;
      return ['watch','incident'].includes(window.state);
    });
    const latestBad = badWindows.at(-1);
    if (latestBad) {
      episode.lastDegradedAt = latestBad.endedAt;
      episode.metrics = latestBad.totals;
      episode.diagnostics = diagnosticsForWindow(latestBad);
    }
    episode.durationMinutes = Number.isFinite(start)
      ? Math.max(0, Math.round(((effectiveEnd - start) / 60_000) * 10) / 10)
      : null;
    episode.severity = episodeSeverity(episode);
    episode.runbook = buildRunbook(episode.metrics, episode.diagnostics);
    episode.fingerprint = [
      episode.diagnostics?.primaryProvider || 'provider',
      episode.diagnostics?.primaryOperation || 'all',
      'provider_slo',
      episode.incidentId,
    ].join('|');
  }

  for (const transition of transitions) {
    const episode = episodes.find(item => item.incidentId === transition.incidentId);
    transition.severity = transition.state === 'healthy'
      ? 'info'
      : episode?.severity || (transition.state === 'incident' ? 'incident' : 'warning');
  }

  const latestWindow = windows.at(-1) || null;
  const latestTransition = transitions.at(-1) || null;
  const transitionIsFresh = Boolean(
    latestWindow
    && latestTransition
    && latestTransition.at === latestWindow.endedAt
    && (
      ['watch','incident'].includes(latestTransition.state)
      || (latestTransition.state === 'healthy' && ['watch','incident'].includes(String(latestTransition.previousState || '')))
    )
  );

  const currentEpisode = [...episodes].reverse().find(x => x.active) || null;
  const currentState = currentEpisode?.state || (confirmedState === 'healthy' ? 'healthy' : confirmedState || 'collecting');
  const lastHealthyWindow = [...windows].reverse().find(window => window.state === 'healthy') || null;

  return {
    visibility:'admin',
    state:currentState,
    label:currentState === 'incident'
      ? 'Активный provider SLO инцидент'
      : currentState === 'watch'
        ? 'Provider SLO требует контроля'
        : currentState === 'healthy'
          ? 'Provider SLO восстановлен'
          : 'Собираем подтверждение SLO',
    confirmationWindows:2,
    expectedWindowMinutes:PROVIDER_SLO_WINDOW_MINUTES,
    windowsObserved:windows.length,
    windowIntegrity:{...canonical.integrity},
    lastHealthyWindowAt:lastHealthyWindow?.endedAt || null,
    activeIncident:currentEpisode,
    transition:transitionIsFresh ? latestTransition : null,
    history:episodes.slice(-10).reverse(),
    summary:{
      episodes:episodes.length,
      active:episodes.filter(x => x.active).length,
      recovered:episodes.filter(x => !x.active).length,
      incidentEpisodes:episodes.filter(x => x.highestState === 'incident').length,
    },
    policy:{
      automaticRollback:false,
      automaticFeatureDisable:false,
      notificationChannel:'ops_events_and_admin_telegram',
      note:'Переход фиксируется только после двух последовательных полных 15-минутных SLO-окон без gap/overlap и только когда состояние согласуется с метриками. watch не отправляет полноценный incident alert; collecting/invalid не создаёт инцидент.',
    },
  };
}

export function providerSloIncidentOpsEvent(transition = {}) {
  const state = String(transition?.state || '');
  const previousState = String(transition?.previousState || '');
  const recovered = state === 'healthy' && ['watch','incident'].includes(previousState);
  if (!['watch','incident'].includes(state) && !recovered) return null;

  const code = recovered
    ? 'PROVIDER_SLO_RECOVERED'
    : state === 'incident'
      ? 'PROVIDER_SLO_INCIDENT'
      : 'PROVIDER_SLO_WATCH';
  const severity = recovered
    ? 'info'
    : transition.severity === 'critical'
      ? 'critical'
      : state === 'incident'
        ? 'error'
        : 'warning';
  const lifecycleEvent = recovered
    ? 'provider_incident_recovered'
    : state === 'incident'
      ? 'provider_incident_opened'
      : 'provider_watch_started';

  return {
    severity,
    source:'provider',
    eventType:'slo_incident',
    code,
    message:recovered
      ? 'Provider SLO returned to healthy state after confirmed recovery.'
      : state === 'incident'
        ? 'Provider SLO entered confirmed incident state.'
        : 'Provider SLO entered confirmed watch state.',
    endpoint:'cron:production-monitor',
    meta:{
      lifecycleEvent,
      incidentId:transition.incidentId || null,
      state:recovered ? 'recovered' : state,
      previousState:previousState || null,
      transitionKind:String(transition.kind || ''),
      severity:transition.severity || (state === 'incident' ? 'incident' : 'warning'),
      confirmedBy:Array.isArray(transition.confirmedBy) ? transition.confirmedBy.slice(0,2) : [],
      provider:transition.diagnostics?.primaryProvider || 'all',
      operation:transition.diagnostics?.primaryOperation || 'all',
      diagnostics:transition.diagnostics || {},
      metrics:transition.metrics || {},
      automaticRollback:false,
      automaticFeatureDisable:false,
    },
  };
}

export function providerSloIncidentUpdateOpsEvent(episode = {}, reason = 'severity_changed') {
  if (!episode?.active || episode?.highestState !== 'incident' || !episode?.incidentId) return null;
  return {
    severity:episode.severity === 'critical' ? 'critical' : 'error',
    source:'provider',
    eventType:'slo_incident',
    code:'PROVIDER_SLO_INCIDENT_UPDATED',
    message:'Provider SLO incident received a material operational update.',
    endpoint:'cron:production-monitor',
    meta:{
      lifecycleEvent:'provider_incident_updated',
      incidentId:episode.incidentId,
      state:episode.state,
      severity:episode.severity,
      updateReason:String(reason || 'material_update').slice(0,80),
      provider:episode.diagnostics?.primaryProvider || 'all',
      operation:episode.diagnostics?.primaryOperation || 'all',
      diagnostics:episode.diagnostics || {},
      metrics:episode.metrics || {},
      automaticRollback:false,
      automaticFeatureDisable:false,
    },
  };
}
