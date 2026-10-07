const MAX_EVENT_MINUTE = 130;
const MAX_EXTRA_MINUTE = 30;
const LIVE_FUTURE_TOLERANCE = 8;
const ANALYTICAL_TYPES = new Set(['goal', 'card', 'var', 'subst']);

function plainObject(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeKeys(value) {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function compactText(value = '') {
  if (!['string','number','bigint'].includes(typeof value)) return '';
  try {
    return String(value)
      .replace(/[\u0000-\u001f\u007f]+/g,' ')
      .trim()
      .replace(/\s+/g, ' ');
  } catch {
    return '';
  }
}

function compactState(value = '') {
  return compactText(value).toLowerCase().replace(/\s+/g, '_');
}

function normalizedText(value = '') {
  const text=compactText(value);
  if (!text) return '';
  try {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function strictInstantMs(value) {
  if (value instanceof Date) {
    const ms=value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value!=='string' || !value.trim()) return null;
  const raw=value.trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(raw);
  if (!match) return null;
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function measurableFreshness(meta) {
  const value=plainObject(meta);
  if (!value) return false;
  const ageSeconds=safeRead(value,'ageSeconds');
  if (typeof ageSeconds==='number' && Number.isFinite(ageSeconds) && ageSeconds>=0) {
    return true;
  }
  for (const key of ['fetchedAt','sourceTimestamp','observedAt','generatedAt']) {
    if (strictInstantMs(safeRead(value,key))!==null) return true;
  }
  return false;
}

function sourceIsTrusted(meta = {}) {
  const value=plainObject(meta);
  if (!value) return false;
  if (
    safeRead(value,'confidenceBearing') !== true
    || safeRead(value,'available') !== true
    || safeRead(value,'usable') !== true
    || safeRead(value,'stale') !== false
  ) return false;
  const freshnessState = compactState(safeRead(value,'freshnessState'));
  const provenanceState = compactState(safeRead(value,'provenanceState'));
  return ['fresh', 'cached'].includes(freshnessState)
    && provenanceState === 'verified'
    && measurableFreshness(value);
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const n=Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function integerInRange(value, min, max) {
  const n = integerCandidate(value);
  return n !== null && n >= min && n <= max ? n : null;
}

function positiveIdentifier(value) {
  const n=integerCandidate(value);
  return n !== null && n > 0 ? n : '';
}

function compactEventId(value) {
  if (typeof value === 'string') return compactText(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return '';
}

function nonNegativeCount(value) {
  const n=integerCandidate(value);
  return n !== null && n >= 0 ? n : 0;
}

function safeShallowCopy(value) {
  const source=plainObject(value);
  if (!source) return {};
  const out={};
  for (const key of safeKeys(source).slice(0,100)) {
    const item=safeRead(source,key);
    if (item!==undefined) out[key]=item;
  }
  return out;
}

function eventFingerprint(event = {}) {
  const value=plainObject(event) || {};
  return [
    integerInRange(safeRead(value,'minute'), 0, MAX_EVENT_MINUTE) ?? '',
    integerInRange(safeRead(value,'extra') ?? 0, 0, MAX_EXTRA_MINUTE) ?? '',
    compactState(safeRead(value,'side')),
    positiveIdentifier(safeRead(value,'teamId') ?? safeRead(value,'team_id')),
    normalizedText(safeRead(value,'type')),
    normalizedText(safeRead(value,'detail')),
    positiveIdentifier(safeRead(value,'playerId') ?? safeRead(value,'player_id')),
    normalizedText(safeRead(value,'playerName') || safeRead(value,'player')),
    positiveIdentifier(
      safeRead(value,'assistPlayerId') ?? safeRead(value,'assist_player_id'),
    ),
    normalizedText(safeRead(value,'assistPlayerName') || safeRead(value,'assist')),
    normalizedText(safeRead(value,'comments')),
  ].join('|');
}

export function inspectMatchEvent(event = {}, { mode = 'live', elapsed = null } = {}) {
  const value=plainObject(event) || {};
  const minute = integerInRange(safeRead(value,'minute'), 0, MAX_EVENT_MINUTE);
  const extra = integerInRange(safeRead(value,'extra') ?? 0, 0, MAX_EXTRA_MINUTE);
  const side = compactState(safeRead(value,'side'));
  const type = normalizedText(safeRead(value,'type'));
  const normalizedMode = compactState(mode) || 'live';
  const liveElapsed = integerInRange(elapsed, 0, MAX_EVENT_MINUTE);
  const effectiveMinute=minute!==null && extra!==null ? minute+extra : null;
  const future = normalizedMode === 'live'
    && liveElapsed !== null
    && effectiveMinute !== null
    && effectiveMinute > liveElapsed + LIVE_FUTURE_TOLERANCE;

  const reasons = [];
  if (minute === null) reasons.push('minute_invalid');
  if (extra === null) reasons.push('extra_invalid');
  if (future) reasons.push('future_event');

  const displayValid = reasons.length === 0;
  const sideValid = side === 'home' || side === 'away';
  const analyticalType = ANALYTICAL_TYPES.has(type);
  const analyticsValid = displayValid && sideValid && analyticalType;

  if (displayValid && analyticalType && !sideValid) reasons.push('side_unknown');

  return {
    id:compactEventId(safeRead(value,'id')),
    minute,
    extra,
    side,
    type,
    displayValid,
    analyticsValid,
    analyticalType,
    sideValid,
    future,
    reasons,
    fingerprint:eventFingerprint(value),
  };
}

export function assessMatchEventQuality(events = [], { eventsMeta = {}, mode = 'live', elapsed = null } = {}) {
  const rows = Array.isArray(events) ? events : [];
  const normalizedMode = compactState(mode) || 'live';
  const sourceTrusted = sourceIsTrusted(eventsMeta);
  const seen = new Set();
  const displayEventIds = [];
  const analyticalEventIds = [];
  const duplicateEventIds = [];
  const rejectedEventIds = [];
  const displayEventIndices = [];
  const analyticalEventIndices = [];
  const duplicateEventIndices = [];
  const rejectedEventIndices = [];
  const warnings = [];
  let unknownSideCount = 0;
  let futureEventCount = 0;
  let invalidTimeCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const inspected = inspectMatchEvent(rows[index], {
      mode:normalizedMode,
      elapsed,
    });
    const eventId = inspected.id || `index:${index}`;

    if (!inspected.displayValid) {
      rejectedEventIds.push(eventId);
      rejectedEventIndices.push(index);
      if (inspected.future) futureEventCount += 1;
      if (inspected.minute === null || inspected.extra === null) invalidTimeCount += 1;
      continue;
    }

    const fingerprint = inspected.fingerprint;
    if (fingerprint && seen.has(fingerprint)) {
      duplicateEventIds.push(eventId);
      duplicateEventIndices.push(index);
      continue;
    }
    if (fingerprint) seen.add(fingerprint);
    displayEventIds.push(eventId);
    displayEventIndices.push(index);

    if (inspected.analyticsValid) {
      analyticalEventIds.push(eventId);
      analyticalEventIndices.push(index);
    } else if (inspected.analyticalType && !inspected.sideValid) {
      unknownSideCount += 1;
    }
  }

  const observed = rows.length > 0;
  const displayCount = displayEventIndices.length;
  const analyticalCount = analyticalEventIndices.length;
  const issueCount = rejectedEventIndices.length + duplicateEventIndices.length + unknownSideCount;
  let state = 'unavailable';
  let label = 'События недоступны';
  let reason = 'no_events';

  if (observed && !sourceTrusted) {
    state = 'source_untrusted';
    label = 'События не используются';
    reason = 'events_source_untrusted';
  } else if (observed && displayCount === 0) {
    state = 'invalid';
    label = 'События отклонены';
    reason = 'no_valid_events';
  } else if (observed && issueCount > 0) {
    state = 'sanitized';
    label = 'События очищены';
    reason = 'invalid_or_duplicate_events_removed';
  } else if (observed) {
    state = 'verified';
    label = 'События подтверждены';
    reason = 'verified_events';
  }

  if (duplicateEventIds.length) warnings.push(`Удалены дубли событий: ${duplicateEventIds.length}.`);
  if (futureEventCount) warnings.push(`Отклонены события из будущей минуты матча: ${futureEventCount}.`);
  if (invalidTimeCount) warnings.push(`Отклонены события с некорректной минутой: ${invalidTimeCount}.`);
  if (unknownSideCount) warnings.push(`События без подтверждённой стороны исключены из аналитики: ${unknownSideCount}.`);
  if (observed && !sourceTrusted) warnings.push('Источник событий не прошёл freshness/provenance guard.');

  const analyticalConfidenceBearing=sourceTrusted && analyticalCount > 0;

  return {
    state,
    label,
    reason,
    mode:normalizedMode,
    observed,
    sourceTrusted,
    rawCount:rows.length,
    displayCount,
    analyticalCount,
    rejectedCount:rejectedEventIndices.length,
    duplicateCount:duplicateEventIndices.length,
    unknownSideCount,
    futureEventCount,
    invalidTimeCount,
    confidenceBearing:analyticalConfidenceBearing,
    analyticalConfidenceBearing,
    displayEventIds,
    analyticalEventIds,
    duplicateEventIds,
    rejectedEventIds,
    displayEventIndices,
    analyticalEventIndices,
    duplicateEventIndices,
    rejectedEventIndices,
    warnings,
    provider:compactText(safeRead(eventsMeta,'provider')),
    source:compactText(safeRead(eventsMeta,'source')),
    freshnessState:compactState(safeRead(eventsMeta,'freshnessState')) || 'unknown',
    provenanceState:compactState(safeRead(eventsMeta,'provenanceState')) || 'unknown',
    methodology:'Live-события допускаются downstream только после проверки времени, измеримой свежести и дедупликации. Аналитика дополнительно требует подтверждённую сторону команды. Sanitized collections выбираются по индексам исходного массива, поэтому rejected/duplicate rows не могут вернуться из-за совпадающего provider event ID.',
  };
}

function selectEventIndices(events = [], indices = []) {
  const rows=Array.isArray(events) ? events : [];
  const allowed = new Set(
    (Array.isArray(indices) ? indices : [])
      .map(integerCandidate)
      .filter(index => index !== null && index >= 0 && index < rows.length),
  );
  return rows.filter((_, index) => allowed.has(index));
}

function selectEventIdsLegacy(events = [], ids = []) {
  const allowed = new Set(
    (Array.isArray(ids) ? ids : [])
      .map(compactEventId)
      .filter(Boolean),
  );
  const emitted = new Set();
  return (Array.isArray(events) ? events : []).filter((event, index) => {
    const value=plainObject(event) || {};
    const id = compactEventId(safeRead(value,'id')) || `index:${index}`;
    if (!allowed.has(id) || emitted.has(id)) return false;
    emitted.add(id);
    return true;
  });
}

export function sanitizeEventsForDisplay(events = [], quality = {}) {
  const value=plainObject(quality);
  if (!value || safeRead(value,'sourceTrusted')!==true) return [];
  const indices=safeRead(value,'displayEventIndices');
  if (Array.isArray(indices)) {
    return selectEventIndices(events, indices);
  }
  return selectEventIdsLegacy(events, safeRead(value,'displayEventIds') || []);
}

export function eventsForTrustedAnalytics(events = [], quality = {}) {
  const value=plainObject(quality);
  if (!value || safeRead(value,'analyticalConfidenceBearing')!==true) return [];
  const indices=safeRead(value,'analyticalEventIndices');
  if (Array.isArray(indices)) {
    return selectEventIndices(events, indices);
  }
  return selectEventIdsLegacy(events, safeRead(value,'analyticalEventIds') || []);
}

export function annotateEventReliability(meta = {}, quality = {}) {
  const metaValue=plainObject(meta) || {};
  const qualityValue=plainObject(quality) || {};
  const originalState = compactText(
    safeRead(metaValue,'state')
      || (safeRead(qualityValue,'observed')===true ? 'available' : 'empty_response'),
  ) || 'empty_response';
  const base = {
    ...safeShallowCopy(metaValue),
    semanticState:compactState(safeRead(qualityValue,'state')) || 'unavailable',
    eventQuality:qualityValue,
    rawCount:nonNegativeCount(safeRead(qualityValue,'rawCount')),
    count:nonNegativeCount(safeRead(qualityValue,'displayCount')),
    partial:safeRead(qualityValue,'state') === 'sanitized',
  };

  if (safeRead(qualityValue,'observed')!==true) {
    return { ...base, available:false, usable:false, confidenceBearing:false };
  }
  if (safeRead(qualityValue,'sourceTrusted')!==true) {
    return {
      ...base,
      transportState:originalState,
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'events_source_untrusted',
    };
  }
  if (!nonNegativeCount(safeRead(qualityValue,'displayCount'))) {
    return {
      ...base,
      transportState:originalState,
      state:'invalid_data',
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'no_valid_events',
    };
  }
  const analyticsTrusted=safeRead(qualityValue,'analyticalConfidenceBearing')===true;
  return {
    ...base,
    state:'available',
    available:true,
    usable:true,
    observed:true,
    degraded:safeRead(qualityValue,'state') === 'sanitized',
    confidenceBearing:analyticsTrusted,
    reason:analyticsTrusted
      ? (safeRead(qualityValue,'state') === 'sanitized' ? 'events_sanitized' : '')
      : 'no_analytical_events',
  };
}
