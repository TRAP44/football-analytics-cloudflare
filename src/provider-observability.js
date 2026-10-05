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

const MAX_PROVIDER_LENGTH=80;
const MAX_OPERATION_LENGTH=180;
const MAX_LATENCY_MS=120000;
const VALID_OUTCOMES=new Set(['retrying','success','failed','rate_limited']);

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

function boundedPositiveInteger(value,fallback,max) {
  const number=nonNegativeIntegerCandidate(value);
  if (number === null || number < 1) return fallback;
  return Math.min(max,number);
}

function timestampCandidate(value,fallback=Date.now()) {
  const number=numericCandidate(value);
  return number !== null && number >= 0 && number <= 8.64e15 ? number : fallback;
}

function iso(value) {
  const timestamp=timestampCandidate(value,Date.now());
  return new Date(timestamp).toISOString();
}

function cleanLabel(value,fallback,maxLength) {
  if (typeof value !== 'string') return fallback;
  const text=value.trim().replace(/\s+/gu,' ');
  if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return fallback;
  return text.slice(0,maxLength);
}

function pct(part,total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function seriesKey(provider,operation) {
  return JSON.stringify([
    cleanLabel(provider,'provider',MAX_PROVIDER_LENGTH),
    cleanLabel(operation,'unknown',MAX_OPERATION_LENGTH),
  ]);
}

function emptySeries(provider,operation) {
  return {
    provider:cleanLabel(provider,'provider',MAX_PROVIDER_LENGTH),
    operation:cleanLabel(operation,'unknown',MAX_OPERATION_LENGTH),
    attempts:0,
    requests:0,
    successes:0,
    failures:0,
    retries:0,
    timeouts:0,
    networkErrors:0,
    rateLimits:0,
    httpErrors:0,
    invalidResponses:0,
    latencySumMs:0,
    latencySamples:0,
    maxLatencyMs:0,
  };
}

function counterValue(row,camel,snake=camel) {
  const value=row?.[camel] ?? row?.[snake];
  if (value === undefined || value === null || value === '') return 0;
  return nonNegativeIntegerCandidate(value);
}

function normalizeMetricRow(row = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const metric=emptySeries(row.provider,row.operation);
  const mappings=[
    ['attempts','attempts'],
    ['requests','requests'],
    ['successes','successes'],
    ['failures','failures'],
    ['retries','retries'],
    ['timeouts','timeouts'],
    ['networkErrors','network_errors'],
    ['rateLimits','rate_limits'],
    ['httpErrors','http_errors'],
    ['invalidResponses','invalid_responses'],
    ['latencySumMs','latency_sum_ms'],
    ['latencySamples','latency_samples'],
    ['maxLatencyMs','max_latency_ms'],
  ];

  for (const [camel,snake] of mappings) {
    const value=counterValue(row,camel,snake);
    if (value === null) return null;
    metric[camel]=value;
  }

  if (
    metric.requests > metric.attempts
    || metric.retries > metric.attempts
    || metric.requests + metric.retries > metric.attempts
    || metric.successes + metric.failures > metric.requests
    || metric.timeouts + metric.networkErrors + metric.rateLimits + metric.httpErrors + metric.invalidResponses > metric.failures
    || metric.latencySamples > metric.attempts
    || (metric.latencySamples === 0 && (metric.latencySumMs > 0 || metric.maxLatencyMs > 0))
    || (metric.latencySamples > 0 && metric.maxLatencyMs > metric.latencySumMs)
    || metric.maxLatencyMs > MAX_LATENCY_MS
    || metric.latencySumMs > metric.latencySamples * MAX_LATENCY_MS
  ) return null;

  return metric;
}

function classifyFailure(bucket,errorType) {
  const code=typeof errorType === 'string' ? errorType.trim().toUpperCase() : '';
  if (code === 'PROVIDER_TIMEOUT' || code === 'UPSTREAM_TIMEOUT') bucket.timeouts += 1;
  else if (code === 'PROVIDER_NETWORK_ERROR' || code === 'FOOTBALL_NETWORK') bucket.networkErrors += 1;
  else if (code === 'PROVIDER_RATE_LIMITED' || code === 'FOOTBALL_RATE_LIMIT' || code === 'FOOTBALL_RATE_LIMIT_BODY') bucket.rateLimits += 1;
  else if (code === 'PROVIDER_INVALID_RESPONSE' || code === 'FOOTBALL_INVALID_RESPONSE') bucket.invalidResponses += 1;
  else if (code === 'PROVIDER_HTTP_ERROR' || code === 'FOOTBALL_HTTP' || code === 'FOOTBALL_RESPONSE') bucket.httpErrors += 1;
}

function mergeSeries(target,source = {}) {
  const normalized=normalizeMetricRow(source);
  if (!normalized) return target;
  for (const key of [
    'attempts','requests','successes','failures','retries','timeouts','networkErrors',
    'rateLimits','httpErrors','invalidResponses','latencySumMs','latencySamples'
  ]) {
    target[key] += normalized[key];
  }
  target.maxLatencyMs=Math.max(target.maxLatencyMs,normalized.maxLatencyMs);
  return target;
}

function summarizeSeries(row = {}) {
  const normalized=normalizeMetricRow(row) || emptySeries(row?.provider,row?.operation);
  const {
    requests,attempts,latencySamples,successes,failures,retries,timeouts,rateLimits,
  }=normalized;
  return {
    ...normalized,
    attempts,
    requests,
    successes,
    failures,
    retries,
    successRatePct:pct(successes,requests),
    errorRatePct:pct(failures,requests),
    timeoutRatePct:pct(timeouts,requests),
    rateLimitRatePct:pct(rateLimits,requests),
    retryRatePct:pct(retries,requests),
    avgAttemptLatencyMs:latencySamples > 0 ? Math.round(normalized.latencySumMs / latencySamples) : null,
    maxLatencyMs:normalized.maxLatencyMs,
  };
}

function policyNumber(policy,key,fallback,{integer=false,min=0,max=Number.MAX_SAFE_INTEGER}={}) {
  const raw=policy?.[key];
  const number=integer ? nonNegativeIntegerCandidate(raw) : numericCandidate(raw);
  if (number === null || number < min || number > max) return fallback;
  return number;
}

function normalizePolicy(policy = DEFAULT_PROVIDER_SLO_POLICY) {
  const defaults=DEFAULT_PROVIDER_SLO_POLICY;
  return {
    minSample:policyNumber(policy,'minSample',defaults.minSample,{integer:true,min:1,max:100000}),
    successRatePct:policyNumber(policy,'successRatePct',defaults.successRatePct,{min:0,max:100}),
    timeoutRatePct:policyNumber(policy,'timeoutRatePct',defaults.timeoutRatePct,{min:0,max:100}),
    rateLimitRatePct:policyNumber(policy,'rateLimitRatePct',defaults.rateLimitRatePct,{min:0,max:100}),
    retryRatePct:policyNumber(policy,'retryRatePct',defaults.retryRatePct,{min:0,max:100}),
    avgAttemptLatencyMs:policyNumber(policy,'avgAttemptLatencyMs',defaults.avgAttemptLatencyMs,{min:0,max:MAX_LATENCY_MS}),
    incidentSuccessRatePct:policyNumber(policy,'incidentSuccessRatePct',defaults.incidentSuccessRatePct,{min:0,max:100}),
    incidentTimeoutRatePct:policyNumber(policy,'incidentTimeoutRatePct',defaults.incidentTimeoutRatePct,{min:0,max:100}),
    incidentRateLimitRatePct:policyNumber(policy,'incidentRateLimitRatePct',defaults.incidentRateLimitRatePct,{min:0,max:100}),
    incidentRetryRatePct:policyNumber(policy,'incidentRetryRatePct',defaults.incidentRetryRatePct,{min:0,max:100}),
    incidentAvgAttemptLatencyMs:policyNumber(policy,'incidentAvgAttemptLatencyMs',defaults.incidentAvgAttemptLatencyMs,{min:0,max:MAX_LATENCY_MS}),
  };
}

function summaryMetric(summary,key,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}) {
  const raw=summary?.[key];
  if (raw === undefined || raw === null || raw === '') return {value:fallback,valid:true};
  const number=numericCandidate(raw);
  return {
    value:number !== null && number >= min && number <= max ? number : fallback,
    valid:number !== null && number >= min && number <= max,
  };
}

export function providerSloState(summary = {},policy = DEFAULT_PROVIDER_SLO_POLICY) {
  const requestsRaw=summary?.requests;
  const requests=requestsRaw === undefined || requestsRaw === null || requestsRaw === ''
    ? 0
    : nonNegativeIntegerCandidate(requestsRaw);
  if (requests === null) return { state:'collecting', label:'Некорректная выборка Provider SLO' };
  if (requests === 0) return { state:'idle', label:'Нет запросов в выбранном окне' };

  const normalizedPolicy=normalizePolicy(policy);
  if (requests < normalizedPolicy.minSample) {
    return { state:'collecting', label:`Собираем выборку: ${requests}/${normalizedPolicy.minSample}` };
  }

  const metrics={
    success:summaryMetric(summary,'successRatePct',100,{min:0,max:100}),
    timeout:summaryMetric(summary,'timeoutRatePct',0,{min:0,max:100}),
    rateLimit:summaryMetric(summary,'rateLimitRatePct',0,{min:0,max:100}),
    retry:summaryMetric(summary,'retryRatePct',0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    latency:summaryMetric(summary,'avgAttemptLatencyMs',0,{min:0,max:MAX_LATENCY_MS}),
  };
  if (Object.values(metrics).some(metric=>!metric.valid)) {
    return { state:'collecting', label:'Некорректные метрики Provider SLO' };
  }

  const incident =
    metrics.success.value < normalizedPolicy.incidentSuccessRatePct
    || metrics.timeout.value > normalizedPolicy.incidentTimeoutRatePct
    || metrics.rateLimit.value > normalizedPolicy.incidentRateLimitRatePct
    || metrics.retry.value > normalizedPolicy.incidentRetryRatePct
    || metrics.latency.value > normalizedPolicy.incidentAvgAttemptLatencyMs;

  if (incident) return { state:'incident', label:'Provider SLO нарушен' };

  const watch =
    metrics.success.value < normalizedPolicy.successRatePct
    || metrics.timeout.value > normalizedPolicy.timeoutRatePct
    || metrics.rateLimit.value > normalizedPolicy.rateLimitRatePct
    || metrics.retry.value > normalizedPolicy.retryRatePct
    || metrics.latency.value > normalizedPolicy.avgAttemptLatencyMs;

  if (watch) return { state:'watch', label:'Provider SLO требует контроля' };
  return { state:'healthy', label:'Provider SLO в пределах цели' };
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizePersistedWindow(item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const candidate=item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata
    : item;
  const startMs=parseTimestamp(candidate.windowStartedAt);
  const endMs=parseTimestamp(candidate.windowEndedAt ?? item?.created_at);
  if (startMs === null || endMs === null || endMs < startMs) return null;

  const series=(Array.isArray(candidate.series) ? candidate.series : [])
    .map(normalizeMetricRow)
    .filter(Boolean)
    .slice(0,24);
  const windowStartedAt=new Date(startMs).toISOString();
  const windowEndedAt=new Date(endMs).toISOString();

  return {
    windowId:`provider-slo:${windowStartedAt}:${windowEndedAt}`,
    windowStartedAt,
    windowEndedAt,
    complete:candidate.complete === undefined ? true : candidate.complete === true,
    series,
  };
}

function bucketMetricRow(row = {}) {
  return normalizeMetricRow({
    provider:row?.provider,
    operation:row?.operation,
    attempts:row?.attempts,
    requests:row?.requests,
    successes:row?.successes,
    failures:row?.failures,
    retries:row?.retries,
    timeouts:row?.timeouts,
    network_errors:row?.network_errors ?? row?.networkErrors,
    rate_limits:row?.rate_limits ?? row?.rateLimits,
    http_errors:row?.http_errors ?? row?.httpErrors,
    invalid_responses:row?.invalid_responses ?? row?.invalidResponses,
    latency_sum_ms:row?.latency_sum_ms ?? row?.latencySumMs,
    latency_samples:row?.latency_samples ?? row?.latencySamples,
    max_latency_ms:row?.max_latency_ms ?? row?.maxLatencyMs,
  });
}

export function providerSloWindowsFromBuckets(rows = [],{
  hours = 24,
  nowMs = Date.now(),
  windowMinutes = 15,
  includeOpen = true,
  policy = DEFAULT_PROVIDER_SLO_POLICY,
} = {}) {
  const safeHours=boundedPositiveInteger(hours,24,168);
  const safeWindowMinutes=boundedPositiveInteger(windowMinutes,15,60);
  const nowValue=timestampCandidate(nowMs,Date.now());
  const allowOpen=includeOpen === true;
  const cutoff=nowValue-safeHours*60*60_000;
  const deduped=new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const startMs=parseTimestamp(row?.bucket_started_at ?? row?.bucketStartedAt);
    if (startMs === null) continue;
    const endMs=startMs+safeWindowMinutes*60_000;
    if (endMs<=cutoff || startMs>nowValue) continue;
    const metric=bucketMetricRow(row);
    if (!metric) continue;
    const identity=`${new Date(startMs).toISOString()}|${seriesKey(metric.provider,metric.operation)}`;
    const currentUpdated=parseTimestamp(row?.updated_at ?? row?.updatedAt);
    const previous=deduped.get(identity);
    if (
      !previous
      || (currentUpdated !== null && (previous.updatedAt === null || currentUpdated >= previous.updatedAt))
      || (currentUpdated === null && previous.updatedAt === null)
    ) {
      deduped.set(identity,{row,metric,updatedAt:currentUpdated});
    }
  }

  const grouped=new Map();
  for (const entry of deduped.values()) {
    const startMs=parseTimestamp(entry.row?.bucket_started_at ?? entry.row?.bucketStartedAt);
    if (startMs === null) continue;
    const endMs=startMs+safeWindowMinutes*60_000;
    const complete=endMs<=nowValue;
    if (!allowOpen && !complete) continue;
    const startIso=new Date(startMs).toISOString();
    if (!grouped.has(startIso)) grouped.set(startIso,[]);
    grouped.get(startIso).push(entry.metric);
  }

  const normalizedPolicy=normalizePolicy(policy);
  return [...grouped.entries()]
    .sort(([a],[b])=>Date.parse(a)-Date.parse(b))
    .map(([windowStartedAt,series])=>{
      const startMs=Date.parse(windowStartedAt);
      const windowEndedAt=new Date(startMs+safeWindowMinutes*60_000).toISOString();
      const totals=emptySeries('all','all');
      for (const metric of series) mergeSeries(totals,metric);
      const summarizedTotals=summarizeSeries(totals);
      const state=providerSloState(summarizedTotals,normalizedPolicy).state;
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
  if (!memory || typeof memory !== 'object' || Array.isArray(memory)) throw new Error('memory is required');
  const normalizedPolicy=normalizePolicy(policy);

  function currentNow() {
    let value;
    try {
      value=typeof now === 'function' ? now() : Date.now();
    } catch {
      value=Date.now();
    }
    return timestampCandidate(value,Date.now());
  }

  function ensureState() {
    if (
      !memory.providerObservability
      || typeof memory.providerObservability !== 'object'
      || Array.isArray(memory.providerObservability)
    ) {
      memory.providerObservability={
        windowStartedAt:iso(currentNow()),
        buckets:{},
      };
    }
    if (
      !memory.providerObservability.buckets
      || typeof memory.providerObservability.buckets !== 'object'
      || Array.isArray(memory.providerObservability.buckets)
    ) {
      memory.providerObservability.buckets={};
    }
    if (parseTimestamp(memory.providerObservability.windowStartedAt) === null) {
      memory.providerObservability.windowStartedAt=iso(currentNow());
    }
    return memory.providerObservability;
  }

  function observeProviderRequest(event = {}) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return false;
    const outcome=typeof (event.outcome ?? event.finalResult) === 'string'
      ? String(event.outcome ?? event.finalResult).trim().toLowerCase()
      : '';
    if (!VALID_OUTCOMES.has(outcome)) return false;

    const state=ensureState();
    const provider=cleanLabel(event.provider,'provider',MAX_PROVIDER_LENGTH);
    const operation=cleanLabel(event.operation,'unknown',MAX_OPERATION_LENGTH);
    const key=seriesKey(provider,operation);
    const existing=normalizeMetricRow(state.buckets[key]);
    state.buckets[key]=existing || emptySeries(provider,operation);
    const bucket=state.buckets[key];
    bucket.attempts += 1;

    const latencyCandidate=numericCandidate(event.latencyMs);
    if (latencyCandidate !== null && latencyCandidate >= 0) {
      const latencyMs=Math.min(MAX_LATENCY_MS,Math.round(latencyCandidate));
      bucket.latencySumMs += latencyMs;
      bucket.latencySamples += 1;
      bucket.maxLatencyMs=Math.max(bucket.maxLatencyMs,latencyMs);
    }

    if (outcome === 'retrying') {
      bucket.retries += 1;
      return true;
    }

    bucket.requests += 1;
    if (outcome === 'success') {
      bucket.successes += 1;
      return true;
    }

    bucket.failures += 1;
    if (outcome === 'rate_limited') bucket.rateLimits += 1;
    else classifyFailure(bucket,event.errorType);
    return true;
  }

  function currentWindow() {
    const state=ensureState();
    const series=Object.values(state.buckets)
      .map(normalizeMetricRow)
      .filter(Boolean);
    const totals=emptySeries('all','all');
    for (const row of series) mergeSeries(totals,row);
    return {
      windowStartedAt:state.windowStartedAt,
      windowEndedAt:iso(currentNow()),
      series:series.map(row=>({...row})),
      totals:summarizeSeries(totals),
    };
  }

  function rotateWindow() {
    const snapshot=currentWindow();
    memory.providerObservability={
      windowStartedAt:snapshot.windowEndedAt,
      buckets:{},
    };
    return snapshot;
  }

  function restoreWindow(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    const state=ensureState();
    const restoredStart=parseTimestamp(snapshot.windowStartedAt);
    const currentStart=parseTimestamp(state.windowStartedAt);
    if (restoredStart !== null && (currentStart === null || restoredStart < currentStart)) {
      state.windowStartedAt=new Date(restoredStart).toISOString();
    }
    for (const row of Array.isArray(snapshot.series) ? snapshot.series : []) {
      const normalized=normalizeMetricRow(row);
      if (!normalized) continue;
      const key=seriesKey(normalized.provider,normalized.operation);
      state.buckets[key] ||= emptySeries(normalized.provider,normalized.operation);
      mergeSeries(state.buckets[key],normalized);
    }
    return true;
  }

  function summarizeWindows(items = [],{ hours = 24,includeCurrent = true } = {}) {
    const safeHours=boundedPositiveInteger(hours,24,168);
    const nowValue=currentNow();
    const cutoff=nowValue-safeHours*60*60_000;
    const combined=new Map();
    const deduped=new Map();
    const sourceWindows=(Array.isArray(items) ? items : [])
      .map(normalizePersistedWindow)
      .filter(Boolean);
    if (includeCurrent === true) {
      const current=normalizePersistedWindow(currentWindow());
      if (current) sourceWindows.push(current);
    }

    for (const window of sourceWindows) {
      const endMs=parseTimestamp(window.windowEndedAt);
      if (endMs === null || endMs<cutoff || endMs>nowValue+60_000) continue;
      const identity=`${window.windowStartedAt}|${window.windowEndedAt}`;
      deduped.set(identity,window);
    }
    const windows=[...deduped.values()]
      .sort((a,b)=>Date.parse(a.windowEndedAt)-Date.parse(b.windowEndedAt));

    let windowCount=0;
    let windowStartedAt=null;
    let windowEndedAt=null;
    for (const window of windows) {
      if (!window.series.length) continue;
      windowCount += 1;
      const startMs=Date.parse(window.windowStartedAt);
      const endMs=Date.parse(window.windowEndedAt);
      if (!windowStartedAt || startMs<Date.parse(windowStartedAt)) windowStartedAt=new Date(startMs).toISOString();
      if (!windowEndedAt || endMs>Date.parse(windowEndedAt)) windowEndedAt=new Date(endMs).toISOString();

      for (const row of window.series) {
        const key=seriesKey(row.provider,row.operation);
        if (!combined.has(key)) combined.set(key,emptySeries(row.provider,row.operation));
        mergeSeries(combined.get(key),row);
      }
    }

    const series=[...combined.values()].map(summarizeSeries)
      .sort((a,b)=>b.requests-a.requests || b.attempts-a.attempts || String(a.provider).localeCompare(String(b.provider)));
    const totals=emptySeries('all','all');
    for (const row of series) mergeSeries(totals,row);
    const overall=summarizeSeries(totals);
    const health=providerSloState(overall,normalizedPolicy);

    const byProviderMap=new Map();
    for (const row of series) {
      const key=row.provider;
      if (!byProviderMap.has(key)) byProviderMap.set(key,emptySeries(key,'all'));
      mergeSeries(byProviderMap.get(key),row);
    }
    const providers=[...byProviderMap.values()].map(row=>{
      const summary=summarizeSeries(row);
      return {...summary,...providerSloState(summary,normalizedPolicy)};
    }).sort((a,b)=>b.requests-a.requests || String(a.provider).localeCompare(String(b.provider)));

    return {
      visibility:'admin',
      hours:safeHours,
      generatedAt:iso(nowValue),
      windowStartedAt,
      windowEndedAt,
      windowCount,
      policy:{...normalizedPolicy},
      overall:{...overall,...health},
      providers,
      operations:series.map(row=>({...row,...providerSloState(row,normalizedPolicy)})).slice(0,24),
      note:'SLO считает логический исход запроса после bounded retry; latency относится к отдельным попыткам. Малые выборки не переводятся в healthy/incident.',
    };
  }

  return Object.freeze({
    observeProviderRequest,
    currentWindow,
    rotateWindow,
    restoreWindow,
    summarizeWindows,
    windowsFromBuckets:(rows,options={})=>providerSloWindowsFromBuckets(rows,{
      ...options,
      policy:normalizedPolicy,
      nowMs:options?.nowMs ?? currentNow(),
    }),
  });
}
