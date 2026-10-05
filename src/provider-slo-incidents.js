import { DEFAULT_PROVIDER_SLO_POLICY, providerSloState } from './provider-observability.js';

const ACTIONABLE_STATES = new Set(['healthy','watch','incident']);
const REPORTED_STATES = new Set(['idle','collecting','healthy','watch','incident']);
const MAX_LATENCY_MS = 120000;

function numericCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeIntegerCandidate(value) {
  const number=numericCandidate(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function timestampCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function asIso(value) {
  const ms=timestampCandidate(value);
  return ms === null ? '' : new Date(ms).toISOString();
}

function finite(value, fallback = 0) {
  const number=numericCandidate(value);
  return number === null ? fallback : number;
}

function nullableNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number=numericCandidate(value);
  return number !== null && number >= min && number <= max ? number : null;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function cleanLabel(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const text=value.trim().replace(/\s+/gu,' ');
  if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return fallback;
  return text.slice(0,maxLength);
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

function inspectMetricRow(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { valid:false, summary:null };
  }

  const fields=[
    'attempts','requests','successes','failures','retries','timeouts',
    'rateLimits','networkErrors','httpErrors','invalidResponses','latencySamples','latencySumMs','maxLatencyMs',
  ];
  const values={};
  const present=new Set();
  let valid=true;
  for (const key of fields) {
    const raw=row?.[key];
    if (raw === undefined || raw === null || raw === '') {
      values[key]=0;
      continue;
    }
    present.add(key);
    const number=nonNegativeIntegerCandidate(raw);
    if (number === null) {
      valid=false;
      values[key]=0;
    } else {
      values[key]=number;
    }
  }

  const {
    attempts,requests,successes,failures,retries,timeouts,rateLimits,
    networkErrors,httpErrors,invalidResponses,latencySamples,latencySumMs,maxLatencyMs,
  }=values;

  if (
    successes + failures > requests
    || (attempts > 0 && requests + retries > attempts)
    || timeouts + networkErrors + rateLimits + httpErrors + invalidResponses > failures
    || (attempts > 0 && latencySamples > attempts)
    || (latencySamples === 0 && (latencySumMs > 0 || maxLatencyMs > 0))
    || (latencySamples > 0 && maxLatencyMs > latencySumMs)
    || maxLatencyMs > MAX_LATENCY_MS
    || latencySumMs > latencySamples * MAX_LATENCY_MS
  ) valid=false;

  const explicitPct=(key,max=100)=>{
    const raw=row?.[key];
    if (raw === undefined || raw === null || raw === '') return null;
    const number=nullableNumber(raw,{min:0,max});
    if (number === null) valid=false;
    return number;
  };
  const explicitLatency=(()=>{
    const raw=row?.avgAttemptLatencyMs;
    if (raw === undefined || raw === null || raw === '') return null;
    const number=nullableNumber(raw,{min:0,max:MAX_LATENCY_MS});
    if (number === null) valid=false;
    return number;
  })();

  const explicitSuccess=explicitPct('successRatePct');
  const explicitError=explicitPct('errorRatePct');
  const explicitTimeout=explicitPct('timeoutRatePct');
  const explicitRateLimit=explicitPct('rateLimitRatePct');
  const explicitRetry=explicitPct('retryRatePct',Number.MAX_SAFE_INTEGER);

  const closeEnough=(reported,derived)=>
    reported === null
    || derived === null
    || Math.abs(reported-derived) <= 0.2;

  if (
    requests > 0
    && (
      (present.has('successes') && !closeEnough(explicitSuccess,pct(successes,requests)))
      || (present.has('failures') && !closeEnough(explicitError,pct(failures,requests)))
      || (present.has('timeouts') && !closeEnough(explicitTimeout,pct(timeouts,requests)))
      || (present.has('rateLimits') && !closeEnough(explicitRateLimit,pct(rateLimits,requests)))
      || (present.has('retries') && !closeEnough(explicitRetry,pct(retries,requests)))
    )
  ) valid=false;

  const summary={
    provider:cleanLabel(row.provider,'provider',80),
    operation:cleanLabel(row.operation,'unknown',180),
    attempts,
    requests,
    successes,
    failures,
    retries,
    timeouts,
    rateLimits,
    networkErrors,
    httpErrors,
    invalidResponses,
    successRatePct:explicitSuccess ?? pct(successes,requests),
    errorRatePct:explicitError ?? pct(failures,requests),
    timeoutRatePct:explicitTimeout ?? pct(timeouts,requests),
    rateLimitRatePct:explicitRateLimit ?? pct(rateLimits,requests),
    retryRatePct:explicitRetry ?? pct(retries,requests),
    avgAttemptLatencyMs:explicitLatency ?? (latencySamples > 0 ? Math.round(latencySumMs / latencySamples) : null),
    maxLatencyMs:nullableNumber(row.maxLatencyMs,{min:0,max:MAX_LATENCY_MS}) ?? maxLatencyMs,
  };
  return {valid,summary};
}

function summarizeMetricRow(row = {}) {
  return inspectMetricRow(row).summary || {
    provider:'provider',
    operation:'unknown',
    attempts:0,
    requests:0,
    successes:0,
    failures:0,
    retries:0,
    timeouts:0,
    rateLimits:0,
    networkErrors:0,
    httpErrors:0,
    invalidResponses:0,
    successRatePct:null,
    errorRatePct:null,
    timeoutRatePct:null,
    rateLimitRatePct:null,
    retryRatePct:null,
    avgAttemptLatencyMs:null,
    maxLatencyMs:0,
  };
}

function normalizeWindow(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const meta=row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : row;
  const endedAt=asIso(meta?.windowEndedAt ?? row?.created_at);
  const startedAt=asIso(meta?.windowStartedAt ?? row?.created_at);
  if (!endedAt || !startedAt) return null;

  const reportedState=typeof meta?.sloState === 'string'
    ? meta.sloState.trim().toLowerCase()
    : '';
  const totalsInput=meta?.totals && typeof meta.totals === 'object' && !Array.isArray(meta.totals)
    ? {provider:'all',operation:'all',...meta.totals}
    : {provider:'all',operation:'all'};
  const totalsInspection=inspectMetricRow(totalsInput);
  const totals=totalsInspection.summary;
  const derivedState=totalsInspection.valid ? providerSloState(totals).state : 'invalid';
  const reportedStateInvalid=Boolean(reportedState && !REPORTED_STATES.has(reportedState));
  const stateMismatch=reportedStateInvalid
    || (Boolean(reportedState) && reportedState!==derivedState);
  const series=Array.isArray(meta?.series)
    ? meta.series
        .slice(0,24)
        .map(inspectMetricRow)
        .filter(item=>item.valid && item.summary)
        .map(item=>item.summary)
    : [];
  const complete=meta?.complete === undefined ? true : meta.complete === true;

  return {
    windowId:typeof meta?.windowId === 'string' ? meta.windowId.trim().slice(0,180) : '',
    startedAt,
    endedAt,
    state:totalsInspection.valid && !stateMismatch ? derivedState : 'invalid',
    reportedState,
    derivedState,
    stateMismatch,
    reportedStateInvalid,
    metricIntegrityValid:totalsInspection.valid,
    complete,
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
  let duplicateConflicts=0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const window=normalizeWindow(row);
    if (!window?.endedAt || !window?.startedAt) continue;
    const identity=`${window.startedAt}|${window.endedAt}`;
    const existing=byIdentity.get(identity);
    if (existing) {
      duplicates+=1;
      if (
        existing.derivedState!==window.derivedState
        || existing.stateMismatch!==window.stateMismatch
        || JSON.stringify(existing.totals)!==JSON.stringify(window.totals)
      ) {
        duplicateConflicts+=1;
        byIdentity.set(identity,{
          ...window,
          state:'invalid',
          stateMismatch:true,
          duplicateConflict:true,
        });
      }
      continue;
    }
    byIdentity.set(identity,window);
  }
  const windows=[...byIdentity.values()]
    .sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt) || Date.parse(a.startedAt)-Date.parse(b.startedAt));
  const integrity={
    duplicates,
    duplicateConflicts,
    gaps:0,
    overlaps:0,
    invalidDuration:0,
    incomplete:0,
    stateMismatches:0,
    invalidMetrics:0,
    invalidReportedStates:0,
  };
  for (let i=0;i<windows.length;i+=1) {
    const window=windows[i];
    if (!validWindowDuration(window)) integrity.invalidDuration+=1;
    if (!window.complete) integrity.incomplete+=1;
    if (window.stateMismatch) integrity.stateMismatches+=1;
    if (!window.metricIntegrityValid) integrity.invalidMetrics+=1;
    if (window.reportedStateInvalid) integrity.invalidReportedStates+=1;
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

  const nowCandidate=typeof nowMs === 'number'
    ? (Number.isFinite(nowMs) && nowMs >= 0 && nowMs <= 8.64e15 ? nowMs : null)
    : typeof nowMs === 'string'
      ? numericCandidate(nowMs)
      : null;
  const latestObserved=Date.parse(windows.at(-1)?.endedAt || '');
  const now=nowCandidate !== null && nowCandidate >= 0 && nowCandidate <= 8.64e15
    ? nowCandidate
    : Number.isFinite(latestObserved)
      ? latestObserved
      : Date.now();
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
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) return null;
  const state=typeof transition.state === 'string' ? transition.state.trim().toLowerCase() : '';
  const previousState=typeof transition.previousState === 'string'
    ? transition.previousState.trim().toLowerCase()
    : '';
  const incidentId=typeof transition.incidentId === 'string'
    ? transition.incidentId.trim()
    : '';
  const recovered = state === 'healthy' && ['watch','incident'].includes(previousState);
  if ((!['watch','incident'].includes(state) && !recovered) || !incidentId || incidentId.length > 200) return null;

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
      incidentId,
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
  if (!episode || typeof episode !== 'object' || Array.isArray(episode)) return null;
  const incidentId=typeof episode.incidentId === 'string' ? episode.incidentId.trim() : '';
  if (
    episode.active !== true
    || episode.highestState !== 'incident'
    || !incidentId
    || incidentId.length > 200
  ) return null;
  return {
    severity:episode.severity === 'critical' ? 'critical' : 'error',
    source:'provider',
    eventType:'slo_incident',
    code:'PROVIDER_SLO_INCIDENT_UPDATED',
    message:'Provider SLO incident received a material operational update.',
    endpoint:'cron:production-monitor',
    meta:{
      lifecycleEvent:'provider_incident_updated',
      incidentId,
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
