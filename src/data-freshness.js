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
const FRESHNESS_MODES = new Set(['live','finished','upcoming']);

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compactState(value = '') {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function finiteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function timestampMs(value) {
  if (value instanceof Date) {
    const ms=value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw=value.trim();
  const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  if (!calendar) return null;
  const year=Number(calendar[1]);
  const month=Number(calendar[2]);
  const day=Number(calendar[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;

  // Freshness must be deterministic across runtimes. Date-only values are UTC
  // calendar anchors; time-bearing values require an explicit timezone.
  if (
    raw.length>10
    && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  ) return null;

  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedAgeSeconds(value) {
  const age=finiteNumber(value);
  return age !== null && age>=0 ? Math.floor(age) : null;
}

function normalizedFeature(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'data';
}

function normalizedMode(value) {
  if (typeof value !== 'string') return null;
  const mode=value.trim().toLowerCase();
  return FRESHNESS_MODES.has(mode) ? mode : null;
}

function defaultFreshnessLimit(feature, mode) {
  const config=DEFAULT_FRESHNESS_LIMITS[normalizedFeature(feature)] || {};
  const normalized=normalizedMode(mode);
  if (normalized) return Number(config[normalized] || config.upcoming || 3600);
  const knownLimits=Object.values(config).filter(value=>typeof value==='number' && Number.isFinite(value) && value>0);
  return knownLimits.length ? Math.min(...knownLimits) : 3600;
}

function timestampSupplied(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim()!=='';
  return true;
}

function policyTtlState(meta = {}, { feature = meta?.feature || 'data', mode = 'upcoming' } = {}) {
  const source=objectRecord(meta);
  const fallback=defaultFreshnessLimit(feature,mode);
  const policy=objectRecord(source.policy);
  const raw=finiteNumber(policy.ttlSeconds);
  if (raw === null || raw<=0) {
    return {configured:false,excessive:false,ttlSeconds:null,fallback,limit:fallback};
  }
  const ttlSeconds=Math.ceil(raw);
  const ceiling=Math.max(fallback,fallback*MAX_POLICY_TTL_MULTIPLIER);
  const excessive=ttlSeconds>ceiling;
  return {
    configured:true,
    excessive,
    ttlSeconds,
    fallback,
    limit:excessive
      ? fallback
      : Math.min(ceiling,Math.max(fallback,ttlSeconds*2)),
  };
}

export function featureFreshnessLimitSeconds(meta = {}, { feature = meta?.feature || 'data', mode = 'upcoming' } = {}) {
  return policyTtlState(meta,{feature,mode}).limit;
}

export function assessFeatureFreshness(meta = {}, {
  feature = objectRecord(meta).feature || 'data',
  mode = 'upcoming',
  now = Date.now(),
  forceStale = false,
} = {}) {
  const sourceMeta=objectRecord(meta);
  const normalizedFeatureName=normalizedFeature(feature || sourceMeta.feature);
  const normalizedModeName=normalizedMode(mode);
  const modeValid=normalizedModeName!==null;

  const provider=compactState(sourceMeta.provider);
  const source=compactState(sourceMeta.source);
  const transportState=compactState(sourceMeta.transportState || sourceMeta.state);
  const freshnessHint=compactState(sourceMeta.freshness || sourceMeta.freshnessState);
  const providerKnown=Boolean(provider && provider!=='unknown' && provider!=='none');
  const sourceKnown=Boolean(source && source!=='unknown' && source!=='none');
  const provenanceKnown=providerKnown && sourceKnown;

  const sourceUpdatedSupplied=timestampSupplied(sourceMeta.sourceUpdatedAt);
  const fetchedAtSupplied=timestampSupplied(sourceMeta.fetchedAt);
  const sourceUpdatedAtMs=timestampMs(sourceMeta.sourceUpdatedAt);
  const fetchedAtMs=timestampMs(sourceMeta.fetchedAt);
  const sourceUpdatedAt=sourceUpdatedAtMs!==null
    ? new Date(sourceUpdatedAtMs).toISOString()
    : null;
  const fetchedAt=fetchedAtMs!==null
    ? new Date(fetchedAtMs).toISOString()
    : null;
  const sourceTimestampInvalid=sourceUpdatedSupplied && sourceUpdatedAtMs===null;
  const fetchTimestampInvalid=!sourceUpdatedSupplied && fetchedAtSupplied && fetchedAtMs===null;
  const timestampInvalid=sourceTimestampInvalid || fetchTimestampInvalid;
  const anchorMs=timestampInvalid
    ? null
    : sourceUpdatedSupplied
      ? sourceUpdatedAtMs
      : fetchedAtMs;

  const nowMs=now instanceof Date ? finiteNumber(now.getTime()) : finiteNumber(now);
  const clockValid=nowMs!==null && nowMs>=0;
  const futureSkewSeconds=anchorMs!==null && clockValid && anchorMs>nowMs
    ? Math.ceil((anchorMs-nowMs)/1000)
    : 0;
  const futureTimestamp=clockValid && futureSkewSeconds>FUTURE_TIMESTAMP_TOLERANCE_SECONDS;
  const timestampRequired=source==='embedded';
  const timestampMissing=timestampRequired && anchorMs===null && !timestampInvalid;

  const fallbackAge=boundedAgeSeconds(sourceMeta.ageSeconds);
  const computedAge=!clockValid || timestampInvalid
    ? null
    : anchorMs===null
      ? fallbackAge
      : futureTimestamp
        ? null
        : Math.max(0,Math.floor((nowMs-anchorMs)/1000));
  const measurableFreshness=anchorMs!==null || fallbackAge!==null;

  const ttlPolicy=policyTtlState(sourceMeta,{
    feature:normalizedFeatureName,
    mode:normalizedModeName || 'upcoming',
  });
  const limit=ttlPolicy.limit;
  const ageExpired=computedAge!==null && computedAge>limit;
  const explicitStale=forceStale===true
    || ['stale','stale_data'].includes(transportState)
    || freshnessHint==='stale'
    || ['stale','stale-cache'].includes(source);
  const stale=explicitStale || ageExpired;
  const freshnessKnown=clockValid
    && modeValid
    && !timestampInvalid
    && !futureTimestamp
    && measurableFreshness
    && (stale || (!timestampMissing && computedAge!==null));

  const originalAvailable=sourceMeta.available===true;
  const originalUsable=sourceMeta.usable===undefined ? originalAvailable : sourceMeta.usable===true;
  const freshnessPolicyValid=clockValid
    && modeValid
    && !timestampInvalid
    && !futureTimestamp
    && !timestampMissing
    && !ttlPolicy.excessive;
  const confidenceBearing=originalAvailable
    && originalUsable
    && provenanceKnown
    && freshnessKnown
    && freshnessPolicyValid
    && !stale;

  let state=typeof sourceMeta.state==='string' && sourceMeta.state.trim()
    ? sourceMeta.state
    : 'unknown';
  let freshnessReason='';
  if (originalAvailable && !clockValid) {
    state='invalid_freshness';
    freshnessReason='invalid_clock';
  } else if (originalAvailable && !modeValid) {
    state='invalid_freshness';
    freshnessReason='invalid_mode';
  } else if (originalAvailable && timestampInvalid) {
    state='invalid_freshness';
    freshnessReason=sourceTimestampInvalid
      ? 'source_timestamp_invalid'
      : 'fetch_timestamp_invalid';
  } else if (originalAvailable && futureTimestamp) {
    state='invalid_freshness';
    freshnessReason='future_timestamp';
  } else if (originalAvailable && !provenanceKnown) {
    state='unverified_source';
    freshnessReason='provenance_missing';
  } else if (originalAvailable && timestampMissing) {
    state='unverified_freshness';
    freshnessReason='embedded_timestamp_missing';
  } else if (originalAvailable && ttlPolicy.excessive) {
    state='unverified_freshness';
    freshnessReason='ttl_policy_excessive';
  } else if (originalAvailable && stale) {
    state='stale_data';
    freshnessReason=forceStale===true || explicitStale
      ? 'explicit_stale_source'
      : 'freshness_expired';
  } else if (originalAvailable && !freshnessKnown) {
    state='unverified_freshness';
    freshnessReason='freshness_missing';
  }

  return {
    ...sourceMeta,
    feature:normalizedFeatureName,
    ...(state !== (typeof sourceMeta.state==='string' ? sourceMeta.state : 'unknown')
      ? {transportState:typeof sourceMeta.state==='string' ? sourceMeta.state : 'unknown'}
      : {}),
    state,
    available:confidenceBearing ? originalAvailable : false,
    usable:confidenceBearing ? originalUsable : false,
    observed:sourceMeta.observed===undefined ? originalAvailable : sourceMeta.observed===true,
    degraded:sourceMeta.degraded===true || (originalAvailable && !confidenceBearing),
    sourceUpdatedAt,
    fetchedAt,
    ageSeconds:computedAge,
    freshnessLimitSeconds:limit,
    freshnessState:stale
      ? 'stale'
      : freshnessKnown && freshnessPolicyValid
        ? (source==='cache' ? 'cached' : 'fresh')
        : 'unknown',
    provenanceState:provenanceKnown ? 'verified' : 'unknown',
    stale,
    confidenceBearing,
    freshnessReason,
    reason:freshnessReason || (typeof sourceMeta.reason==='string' ? sourceMeta.reason : ''),
    clockValid,
    modeValid,
    futureTimestamp,
    futureSkewSeconds,
    timestampRequired,
    timestampMissing,
    timestampInvalid,
    sourceTimestampInvalid,
    fetchTimestampInvalid,
    ttlPolicySeconds:ttlPolicy.ttlSeconds,
    ttlPolicyExcessive:ttlPolicy.excessive,
  };
}

export function applyFeatureFreshness(meta = {}, options = {}) {
  return assessFeatureFreshness(meta,options);
}

export function applyFeatureFreshnessMap(featureMeta = {}, options = {}) {
  const source=objectRecord(featureMeta);
  return Object.fromEntries(
    Object.entries(source).map(([feature,meta])=>[
      feature,
      assessFeatureFreshness(objectRecord(meta),{...objectRecord(options),feature}),
    ]),
  );
}
