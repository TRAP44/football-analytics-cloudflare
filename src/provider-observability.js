export const DEFAULT_PROVIDER_SLO_POLICY = Object.freeze({
  minSample: 10,
  successRatePct: 98,
  timeoutRatePct: 2,
  rateLimitRatePct: 2,
  retryRatePct: 10,
  avgAttemptLatencyMs: 2500,
  incidentSuccessRatePct: 90,
  incidentTimeoutRatePct: 5,
  incidentRateLimitRatePct: 5,
  incidentRetryRatePct: 25,
  incidentAvgAttemptLatencyMs: 5000,
});

function iso(ms) {
  return new Date(Number(ms || Date.now())).toISOString();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function seriesKey(provider, operation) {
  return `${String(provider || 'provider').trim() || 'provider'}::${String(operation || 'unknown').trim() || 'unknown'}`;
}

function emptySeries(provider, operation) {
  return {
    provider: String(provider || 'provider').trim() || 'provider',
    operation: String(operation || 'unknown').trim() || 'unknown',
    attempts: 0,
    requests: 0,
    successes: 0,
    failures: 0,
    retries: 0,
    timeouts: 0,
    networkErrors: 0,
    rateLimits: 0,
    httpErrors: 0,
    invalidResponses: 0,
    latencySumMs: 0,
    latencySamples: 0,
    maxLatencyMs: 0,
  };
}

function classifyFailure(bucket, errorType) {
  const code = String(errorType || '');
  if (code === 'PROVIDER_TIMEOUT' || code === 'UPSTREAM_TIMEOUT') bucket.timeouts += 1;
  else if (code === 'PROVIDER_NETWORK_ERROR' || code === 'FOOTBALL_NETWORK') bucket.networkErrors += 1;
  else if (code === 'PROVIDER_RATE_LIMITED' || code === 'FOOTBALL_RATE_LIMIT' || code === 'FOOTBALL_RATE_LIMIT_BODY') bucket.rateLimits += 1;
  else if (code === 'PROVIDER_INVALID_RESPONSE' || code === 'FOOTBALL_INVALID_RESPONSE') bucket.invalidResponses += 1;
  else if (code === 'PROVIDER_HTTP_ERROR' || code === 'FOOTBALL_HTTP') bucket.httpErrors += 1;
}

function mergeSeries(target, source = {}) {
  for (const key of [
    'attempts','requests','successes','failures','retries','timeouts','networkErrors',
    'rateLimits','httpErrors','invalidResponses','latencySumMs','latencySamples'
  ]) {
    target[key] = finite(target[key]) + finite(source[key]);
  }
  target.maxLatencyMs = Math.max(finite(target.maxLatencyMs), finite(source.maxLatencyMs));
  return target;
}

function summarizeSeries(row = {}) {
  const requests = finite(row.requests);
  const attempts = finite(row.attempts);
  const latencySamples = finite(row.latencySamples);
  const successes = finite(row.successes);
  const failures = finite(row.failures);
  const retries = finite(row.retries);
  const timeouts = finite(row.timeouts);
  const rateLimits = finite(row.rateLimits);
  return {
    ...row,
    attempts,
    requests,
    successes,
    failures,
    retries,
    successRatePct: pct(successes, requests),
    errorRatePct: pct(failures, requests),
    timeoutRatePct: pct(timeouts, requests),
    rateLimitRatePct: pct(rateLimits, requests),
    retryRatePct: pct(retries, requests),
    avgAttemptLatencyMs: latencySamples > 0 ? Math.round(finite(row.latencySumMs) / latencySamples) : null,
    maxLatencyMs: finite(row.maxLatencyMs),
  };
}

export function providerSloState(summary = {}, policy = DEFAULT_PROVIDER_SLO_POLICY) {
  const requests = finite(summary.requests);
  if (requests === 0) return { state:'idle', label:'Нет запросов в выбранном окне' };
  if (requests < finite(policy.minSample, 10)) {
    return { state:'collecting', label:`Собираем выборку: ${requests}/${finite(policy.minSample, 10)}` };
  }

  const success = finite(summary.successRatePct, 100);
  const timeout = finite(summary.timeoutRatePct);
  const rateLimit = finite(summary.rateLimitRatePct);
  const retry = finite(summary.retryRatePct);
  const latency = finite(summary.avgAttemptLatencyMs);

  const incident =
    success < finite(policy.incidentSuccessRatePct, 90) ||
    timeout > finite(policy.incidentTimeoutRatePct, 5) ||
    rateLimit > finite(policy.incidentRateLimitRatePct, 5) ||
    retry > finite(policy.incidentRetryRatePct, 25) ||
    latency > finite(policy.incidentAvgAttemptLatencyMs, 5000);

  if (incident) return { state:'incident', label:'Provider SLO нарушен' };

  const watch =
    success < finite(policy.successRatePct, 98) ||
    timeout > finite(policy.timeoutRatePct, 2) ||
    rateLimit > finite(policy.rateLimitRatePct, 2) ||
    retry > finite(policy.retryRatePct, 10) ||
    latency > finite(policy.avgAttemptLatencyMs, 2500);

  if (watch) return { state:'watch', label:'Provider SLO требует контроля' };
  return { state:'healthy', label:'Provider SLO в пределах цели' };
}

function normalizePersistedWindow(item = {}) {
  const meta = item?.metadata || item || {};
  const series = Array.isArray(meta.series) ? meta.series : [];
  const windowStartedAt=String(meta.windowStartedAt || '');
  const windowEndedAt=String(meta.windowEndedAt || item?.created_at || '');
  return {
    windowId:String(meta.windowId || `${windowStartedAt}|${windowEndedAt}`),
    windowStartedAt,
    windowEndedAt,
    complete:meta.complete !== false,
    series: series.filter(row => row && typeof row === 'object').slice(0, 24),
  };
}

function bucketMetricRow(row = {}) {
  return {
    provider:String(row.provider || 'provider').trim() || 'provider',
    operation:String(row.operation || 'unknown').trim() || 'unknown',
    attempts:finite(row.attempts),
    requests:finite(row.requests),
    successes:finite(row.successes),
    failures:finite(row.failures),
    retries:finite(row.retries),
    timeouts:finite(row.timeouts),
    networkErrors:finite(row.network_errors ?? row.networkErrors),
    rateLimits:finite(row.rate_limits ?? row.rateLimits),
    httpErrors:finite(row.http_errors ?? row.httpErrors),
    invalidResponses:finite(row.invalid_responses ?? row.invalidResponses),
    latencySumMs:finite(row.latency_sum_ms ?? row.latencySumMs),
    latencySamples:finite(row.latency_samples ?? row.latencySamples),
    maxLatencyMs:finite(row.max_latency_ms ?? row.maxLatencyMs),
  };
}

export function providerSloWindowsFromBuckets(rows = [], {
  hours = 24,
  nowMs = Date.now(),
  windowMinutes = 15,
  includeOpen = true,
  policy = DEFAULT_PROVIDER_SLO_POLICY,
} = {}) {
  const safeHours=Math.max(1,Math.min(168,Number(hours || 24)));
  const safeWindowMinutes=Math.max(1,Math.min(60,Number(windowMinutes || 15)));
  const nowValue=Number(nowMs || Date.now());
  const cutoff=nowValue-safeHours*60*60_000;
  const deduped=new Map();

  for (const row of rows || []) {
    const startMs=Date.parse(String(row?.bucket_started_at || row?.bucketStartedAt || ''));
    if (!Number.isFinite(startMs)) continue;
    const endMs=startMs+safeWindowMinutes*60_000;
    if (endMs<=cutoff || startMs>nowValue) continue;
    const metric=bucketMetricRow(row);
    const identity=`${new Date(startMs).toISOString()}|${seriesKey(metric.provider,metric.operation)}`;
    const previous=deduped.get(identity);
    const previousUpdated=Date.parse(String(previous?.updated_at || previous?.updatedAt || ''));
    const currentUpdated=Date.parse(String(row?.updated_at || row?.updatedAt || ''));
    if (!previous || !Number.isFinite(previousUpdated) || (Number.isFinite(currentUpdated) && currentUpdated>=previousUpdated)) {
      deduped.set(identity,row);
    }
  }

  const grouped=new Map();
  for (const row of deduped.values()) {
    const startMs=Date.parse(String(row?.bucket_started_at || row?.bucketStartedAt || ''));
    const endMs=startMs+safeWindowMinutes*60_000;
    const complete=endMs<=nowValue;
    if (!includeOpen && !complete) continue;
    const startIso=new Date(startMs).toISOString();
    if (!grouped.has(startIso)) grouped.set(startIso,[]);
    grouped.get(startIso).push(bucketMetricRow(row));
  }

  return [...grouped.entries()]
    .sort(([a],[b])=>Date.parse(a)-Date.parse(b))
    .map(([windowStartedAt,series])=>{
      const startMs=Date.parse(windowStartedAt);
      const windowEndedAt=new Date(startMs+safeWindowMinutes*60_000).toISOString();
      const totals=emptySeries('all','all');
      for (const metric of series) mergeSeries(totals,metric);
      const summarizedTotals=summarizeSeries(totals);
      const state=providerSloState(summarizedTotals,policy).state;
      return {
        created_at:windowEndedAt,
        metadata:{
          windowId:`provider-slo:${windowStartedAt}`,
          windowStartedAt,
          windowEndedAt,
          complete:Date.parse(windowEndedAt)<=nowValue,
          series:series.map(row=>({...row})),
          totals:summarizedTotals,
          sloState:state,
        },
      };
    });
}

export function createProviderObservabilityRuntime({
  memory,
  now = () => Date.now(),
  policy = DEFAULT_PROVIDER_SLO_POLICY,
} = {}) {
  if (!memory || typeof memory !== 'object') throw new Error('memory is required');

  function ensureState() {
    if (!memory.providerObservability || typeof memory.providerObservability !== 'object') {
      memory.providerObservability = {
        windowStartedAt: iso(now()),
        buckets: {},
      };
    }
    memory.providerObservability.buckets ||= {};
    memory.providerObservability.windowStartedAt ||= iso(now());
    return memory.providerObservability;
  }

  function observeProviderRequest(event = {}) {
    const state = ensureState();
    const provider = String(event.provider || 'provider').trim() || 'provider';
    const operation = String(event.operation || 'unknown').trim() || 'unknown';
    const key = seriesKey(provider, operation);
    state.buckets[key] ||= emptySeries(provider, operation);
    const bucket = state.buckets[key];
    bucket.attempts += 1;

    const latencyMs = Number(event.latencyMs);
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      bucket.latencySumMs += latencyMs;
      bucket.latencySamples += 1;
      bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, latencyMs);
    }

    const outcome = String(event.outcome || event.finalResult || '');
    if (outcome === 'retrying') {
      bucket.retries += 1;
      return;
    }

    bucket.requests += 1;
    if (outcome === 'success') {
      bucket.successes += 1;
      return;
    }

    bucket.failures += 1;
    classifyFailure(bucket, event.errorType);
  }

  function currentWindow() {
    const state = ensureState();
    const series = Object.values(state.buckets).map(row => ({ ...row }));
    const totals = emptySeries('all', 'all');
    for (const row of series) mergeSeries(totals, row);
    return {
      windowStartedAt: state.windowStartedAt,
      windowEndedAt: iso(now()),
      series,
      totals: summarizeSeries(totals),
    };
  }

  function rotateWindow() {
    const snapshot = currentWindow();
    memory.providerObservability = {
      windowStartedAt: snapshot.windowEndedAt,
      buckets: {},
    };
    return snapshot;
  }

  function restoreWindow(snapshot = {}) {
    const state = ensureState();
    const restoredStart = Date.parse(String(snapshot.windowStartedAt || ''));
    const currentStart = Date.parse(String(state.windowStartedAt || ''));
    if (Number.isFinite(restoredStart) && (!Number.isFinite(currentStart) || restoredStart < currentStart)) {
      state.windowStartedAt = new Date(restoredStart).toISOString();
    }
    for (const row of snapshot.series || []) {
      const key = seriesKey(row.provider, row.operation);
      state.buckets[key] ||= emptySeries(row.provider, row.operation);
      mergeSeries(state.buckets[key], row);
    }
  }

  function summarizeWindows(items = [], { hours = 24, includeCurrent = true } = {}) {
    const safeHours=Math.max(1,Math.min(168,Number(hours || 24)));
    const cutoff=now()-safeHours*60*60_000;
    const combined = new Map();
    const deduped=new Map();
    const sourceWindows=(items || []).map(normalizePersistedWindow);
    if (includeCurrent) sourceWindows.push(normalizePersistedWindow(currentWindow()));
    for (const window of sourceWindows) {
      const endMs=Date.parse(window.windowEndedAt || '');
      if (!Number.isFinite(endMs) || endMs<cutoff || endMs>now()+60_000) continue;
      const identity=window.windowId || `${window.windowStartedAt}|${window.windowEndedAt}`;
      deduped.set(identity,window);
    }
    const windows=[...deduped.values()].sort((a,b)=>Date.parse(a.windowEndedAt)-Date.parse(b.windowEndedAt));

    let windowCount = 0;
    let windowStartedAt = null;
    let windowEndedAt = null;
    for (const window of windows) {
      if (!Array.isArray(window.series) || !window.series.length) continue;
      windowCount += 1;
      const startMs = Date.parse(window.windowStartedAt || '');
      const endMs = Date.parse(window.windowEndedAt || '');
      if (Number.isFinite(startMs) && (!windowStartedAt || startMs < Date.parse(windowStartedAt))) windowStartedAt = new Date(startMs).toISOString();
      if (Number.isFinite(endMs) && (!windowEndedAt || endMs > Date.parse(windowEndedAt))) windowEndedAt = new Date(endMs).toISOString();

      for (const row of window.series) {
        const key = seriesKey(row.provider, row.operation);
        if (!combined.has(key)) combined.set(key, emptySeries(row.provider, row.operation));
        mergeSeries(combined.get(key), row);
      }
    }

    const series = [...combined.values()].map(summarizeSeries)
      .sort((a, b) => b.requests - a.requests || b.attempts - a.attempts || String(a.provider).localeCompare(String(b.provider)));
    const totals = emptySeries('all', 'all');
    for (const row of series) mergeSeries(totals, row);
    const overall = summarizeSeries(totals);
    const health = providerSloState(overall, policy);

    const byProviderMap = new Map();
    for (const row of series) {
      const key = String(row.provider || 'provider');
      if (!byProviderMap.has(key)) byProviderMap.set(key, emptySeries(key, 'all'));
      mergeSeries(byProviderMap.get(key), row);
    }
    const providers = [...byProviderMap.values()].map(row => {
      const summary = summarizeSeries(row);
      return { ...summary, ...providerSloState(summary, policy) };
    }).sort((a, b) => b.requests - a.requests || String(a.provider).localeCompare(String(b.provider)));

    return {
      visibility:'admin',
      hours: safeHours,
      generatedAt: iso(now()),
      windowStartedAt,
      windowEndedAt,
      windowCount,
      policy: { ...policy },
      overall: { ...overall, ...health },
      providers,
      operations: series.map(row => ({ ...row, ...providerSloState(row, policy) })).slice(0, 24),
      note: 'SLO считает логический исход запроса после bounded retry; latency относится к отдельным попыткам. Малые выборки не переводятся в healthy/incident.',
    };
  }

  return Object.freeze({
    observeProviderRequest,
    currentWindow,
    rotateWindow,
    restoreWindow,
    summarizeWindows,
    windowsFromBuckets:(rows,options={})=>providerSloWindowsFromBuckets(rows,{...options,policy,nowMs:options.nowMs ?? now()}),
  });
}
