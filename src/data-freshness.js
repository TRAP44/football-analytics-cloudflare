const DEFAULT_FRESHNESS_LIMITS = Object.freeze({
  match:       { live: 90,   finished: 86400, upcoming: 600 },
  events:      { live: 120,  finished: 86400, upcoming: 600 },
  statistics:  { live: 150,  finished: 86400, upcoming: 600 },
  players:     { live: 300,  finished: 86400, upcoming: 900 },
  lineups:     { live: 600,  finished: 86400, upcoming: 900 },
  injuries:    { live: 3600, finished: 86400, upcoming: 3600 },
  liveOdds:    { live: 120,  finished: 600,   upcoming: 300 },
  odds:        { live: 120,  finished: 3600,  upcoming: 600 },
  predictions: { live: 900,  finished: 86400, upcoming: 3600 },
  h2h:         { live: 86400,finished: 86400, upcoming: 86400 },
});

const FUTURE_TIMESTAMP_TOLERANCE_SECONDS = 30;
const MAX_POLICY_TTL_MULTIPLIER = 2;

function compactState(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedAgeSeconds(value) {
  const age = Number(value);
  return Number.isFinite(age) && age >= 0 ? Math.floor(age) : null;
}

function defaultFreshnessLimit(feature, mode) {
  const config = DEFAULT_FRESHNESS_LIMITS[String(feature || '')] || {};
  return Number(config[String(mode || '')] || config.upcoming || 3600);
}

function policyTtlState(meta = {}, { feature = meta?.feature || 'data', mode = 'upcoming' } = {}) {
  const fallback = defaultFreshnessLimit(feature, mode);
  const raw = Number(meta?.policy?.ttlSeconds);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { configured:false, excessive:false, ttlSeconds:null, fallback, limit:fallback };
  }
  const ttlSeconds = Math.ceil(raw);
  const ceiling = Math.max(fallback, fallback * MAX_POLICY_TTL_MULTIPLIER);
  const excessive = ttlSeconds > ceiling;
  return {
    configured:true,
    excessive,
    ttlSeconds,
    fallback,
    limit: excessive
      ? fallback
      : Math.min(ceiling, Math.max(fallback, ttlSeconds * 2)),
  };
}

export function featureFreshnessLimitSeconds(meta = {}, { feature = meta?.feature || 'data', mode = 'upcoming' } = {}) {
  return policyTtlState(meta, { feature, mode }).limit;
}

export function assessFeatureFreshness(meta = {}, {
  feature = meta?.feature || 'data',
  mode = 'upcoming',
  now = Date.now(),
  forceStale = false,
} = {}) {
  const provider = compactState(meta?.provider);
  const source = compactState(meta?.source);
  const transportState = compactState(meta?.transportState || meta?.state);
  const freshnessHint = compactState(meta?.freshness || meta?.freshnessState);
  const providerKnown = Boolean(provider && provider !== 'unknown' && provider !== 'none');
  const sourceKnown = Boolean(source && source !== 'unknown' && source !== 'none');
  const provenanceKnown = providerKnown && sourceKnown;

  const sourceUpdatedAtMs = timestampMs(meta?.sourceUpdatedAt);
  const fetchedAtMs = timestampMs(meta?.fetchedAt);
  const sourceUpdatedAt = sourceUpdatedAtMs !== null ? String(meta.sourceUpdatedAt) : null;
  const fetchedAt = fetchedAtMs !== null ? String(meta.fetchedAt) : null;
  const anchorMs = sourceUpdatedAtMs ?? fetchedAtMs;
  const nowMs = Number(now);
  const futureSkewSeconds = anchorMs !== null && Number.isFinite(nowMs) && anchorMs > nowMs
    ? Math.ceil((anchorMs - nowMs) / 1000)
    : 0;
  const futureTimestamp = futureSkewSeconds > FUTURE_TIMESTAMP_TOLERANCE_SECONDS;
  const timestampRequired = source === 'embedded';
  const timestampMissing = timestampRequired && anchorMs === null;

  const computedAge = anchorMs === null
    ? boundedAgeSeconds(meta?.ageSeconds)
    : futureTimestamp
      ? null
      : Math.max(0, Math.floor((nowMs - anchorMs) / 1000));

  const ttlPolicy = policyTtlState(meta, { feature, mode });
  const limit = ttlPolicy.limit;
  const ageExpired = computedAge !== null && computedAge > limit;
  const explicitStale = forceStale
    || ['stale','stale_data'].includes(transportState)
    || freshnessHint === 'stale'
    || ['stale','stale-cache'].includes(source);
  const stale = explicitStale || ageExpired;
  const freshnessKnown = stale
    || (!timestampMissing && !futureTimestamp && computedAge !== null)
    || (!timestampRequired && ['fresh','cached'].includes(freshnessHint));

  const originalAvailable = Boolean(meta?.available);
  const originalUsable = meta?.usable === undefined ? originalAvailable : Boolean(meta.usable);
  const freshnessPolicyValid = !futureTimestamp && !timestampMissing && !ttlPolicy.excessive;
  const confidenceBearing = originalAvailable
    && originalUsable
    && provenanceKnown
    && freshnessKnown
    && freshnessPolicyValid
    && !stale;

  let state = String(meta?.state || 'unknown');
  let freshnessReason = '';
  if (originalAvailable && futureTimestamp) {
    state = 'invalid_freshness';
    freshnessReason = 'future_timestamp';
  } else if (originalAvailable && timestampMissing) {
    state = 'unverified_freshness';
    freshnessReason = 'embedded_timestamp_missing';
  } else if (originalAvailable && ttlPolicy.excessive) {
    state = 'unverified_freshness';
    freshnessReason = 'ttl_policy_excessive';
  } else if (originalAvailable && stale) {
    state = 'stale_data';
    freshnessReason = forceStale || explicitStale ? 'explicit_stale_source' : 'freshness_expired';
  } else if (originalAvailable && !provenanceKnown) {
    state = 'unverified_source';
    freshnessReason = 'provenance_missing';
  } else if (originalAvailable && !freshnessKnown) {
    state = 'unverified_freshness';
    freshnessReason = 'freshness_missing';
  }

  return {
    ...meta,
    feature: String(feature || meta?.feature || 'data'),
    ...(state !== String(meta?.state || 'unknown') ? { transportState: String(meta?.state || 'unknown') } : {}),
    state,
    available: confidenceBearing ? originalAvailable : false,
    usable: confidenceBearing ? originalUsable : false,
    observed: Boolean(meta?.observed ?? originalAvailable),
    degraded: Boolean(meta?.degraded) || (originalAvailable && !confidenceBearing),
    sourceUpdatedAt,
    fetchedAt,
    ageSeconds: computedAge,
    freshnessLimitSeconds: limit,
    freshnessState: stale ? 'stale' : freshnessKnown && freshnessPolicyValid ? (source === 'cache' ? 'cached' : 'fresh') : 'unknown',
    provenanceState: provenanceKnown ? 'verified' : 'unknown',
    stale,
    confidenceBearing,
    freshnessReason,
    reason: freshnessReason || String(meta?.reason || ''),
    futureTimestamp,
    futureSkewSeconds,
    timestampRequired,
    timestampMissing,
    ttlPolicySeconds: ttlPolicy.ttlSeconds,
    ttlPolicyExcessive: ttlPolicy.excessive,
  };
}

export function applyFeatureFreshness(meta = {}, options = {}) {
  return assessFeatureFreshness(meta, options);
}

export function applyFeatureFreshnessMap(featureMeta = {}, options = {}) {
  return Object.fromEntries(
    Object.entries(featureMeta || {}).map(([feature, meta]) => [
      feature,
      assessFeatureFreshness(meta || {}, { ...options, feature }),
    ]),
  );
}
