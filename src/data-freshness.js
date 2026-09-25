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

export function featureFreshnessLimitSeconds(meta = {}, { feature = meta?.feature || 'data', mode = 'upcoming' } = {}) {
  const fallback = defaultFreshnessLimit(feature, mode);
  const policyTtl = Number(meta?.policy?.ttlSeconds);
  if (!Number.isFinite(policyTtl) || policyTtl <= 0) return fallback;
  return Math.max(fallback, Math.ceil(policyTtl * 2));
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

  const sourceUpdatedAt = timestampMs(meta?.sourceUpdatedAt) !== null
    ? String(meta.sourceUpdatedAt)
    : null;
  const fetchedAt = timestampMs(meta?.fetchedAt) !== null
    ? String(meta.fetchedAt)
    : null;
  const anchorMs = timestampMs(sourceUpdatedAt) ?? timestampMs(fetchedAt);
  const computedAge = anchorMs === null
    ? boundedAgeSeconds(meta?.ageSeconds)
    : Math.max(0, Math.floor((Number(now) - anchorMs) / 1000));
  const limit = featureFreshnessLimitSeconds(meta, { feature, mode });
  const ageExpired = computedAge !== null && computedAge > limit;
  const explicitStale = forceStale
    || ['stale','stale_data'].includes(transportState)
    || freshnessHint === 'stale'
    || ['stale','stale-cache'].includes(source);
  const stale = explicitStale || ageExpired;
  const freshnessKnown = stale
    || computedAge !== null
    || ['fresh','cached'].includes(freshnessHint)
    || source === 'embedded';

  const originalAvailable = Boolean(meta?.available);
  const originalUsable = meta?.usable === undefined ? originalAvailable : Boolean(meta.usable);
  const confidenceBearing = originalAvailable
    && originalUsable
    && provenanceKnown
    && freshnessKnown
    && !stale;

  let state = String(meta?.state || 'unknown');
  let freshnessReason = '';
  if (originalAvailable && stale) {
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
    ageSeconds: computedAge,
    freshnessLimitSeconds: limit,
    freshnessState: stale ? 'stale' : freshnessKnown ? (source === 'cache' ? 'cached' : 'fresh') : 'unknown',
    provenanceState: provenanceKnown ? 'verified' : 'unknown',
    stale,
    confidenceBearing,
    freshnessReason,
    reason: freshnessReason || String(meta?.reason || ''),
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
