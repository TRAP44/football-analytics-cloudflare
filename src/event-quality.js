const MAX_EVENT_MINUTE = 130;
const MAX_EXTRA_MINUTE = 30;
const LIVE_FUTURE_TOLERANCE = 8;
const ANALYTICAL_TYPES = new Set(['goal', 'card', 'var', 'subst']);

function compactText(value = '') {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function compactState(value = '') {
  return compactText(value).toLowerCase().replace(/\s+/g, '_');
}

function normalizedText(value = '') {
  return compactText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sourceIsTrusted(meta = {}) {
  if (
    meta?.confidenceBearing !== true
    || meta?.available !== true
    || meta?.usable !== true
    || meta?.stale === true
  ) return false;
  const freshnessState = compactState(meta?.freshnessState);
  const provenanceState = compactState(meta?.provenanceState);
  return ['fresh', 'cached'].includes(freshnessState) && provenanceState === 'verified';
}

function integerInRange(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function eventFingerprint(event = {}) {
  return [
    integerInRange(event?.minute, 0, MAX_EVENT_MINUTE) ?? '',
    integerInRange(event?.extra, 0, MAX_EXTRA_MINUTE) ?? '',
    compactState(event?.side),
    Number(event?.teamId || event?.team_id || 0) || '',
    normalizedText(event?.type),
    normalizedText(event?.detail),
    Number(event?.playerId || event?.player_id || 0) || '',
    normalizedText(event?.playerName || event?.player),
    Number(event?.assistPlayerId || event?.assist_player_id || 0) || '',
    normalizedText(event?.assistPlayerName || event?.assist),
    normalizedText(event?.comments),
  ].join('|');
}

export function inspectMatchEvent(event = {}, { mode = 'live', elapsed = null } = {}) {
  const minute = integerInRange(event?.minute, 0, MAX_EVENT_MINUTE);
  const extra = integerInRange(event?.extra ?? 0, 0, MAX_EXTRA_MINUTE);
  const side = compactState(event?.side);
  const type = normalizedText(event?.type);
  const liveElapsed = Number(elapsed);
  const future = String(mode || '') === 'live'
    && Number.isFinite(liveElapsed)
    && liveElapsed > 0
    && minute !== null
    && minute > liveElapsed + LIVE_FUTURE_TOLERANCE;

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
    id:compactText(event?.id),
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
    fingerprint:eventFingerprint(event),
  };
}

export function assessMatchEventQuality(events = [], { eventsMeta = {}, mode = 'live', elapsed = null } = {}) {
  const rows = Array.isArray(events) ? events : [];
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
    const event = rows[index] || {};
    const inspected = inspectMatchEvent(event, { mode, elapsed });
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

  return {
    state,
    label,
    reason,
    mode:String(mode || 'live'),
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
    confidenceBearing:sourceTrusted && displayCount > 0,
    analyticalConfidenceBearing:sourceTrusted && analyticalCount > 0,
    displayEventIds,
    analyticalEventIds,
    duplicateEventIds,
    rejectedEventIds,
    displayEventIndices,
    analyticalEventIndices,
    duplicateEventIndices,
    rejectedEventIndices,
    warnings,
    provider:String(eventsMeta?.provider || ''),
    source:String(eventsMeta?.source || ''),
    freshnessState:String(eventsMeta?.freshnessState || 'unknown'),
    provenanceState:String(eventsMeta?.provenanceState || 'unknown'),
    methodology:'Live-события допускаются downstream только после проверки времени и дедупликации. Аналитика дополнительно требует подтверждённую сторону команды. Sanitized collections выбираются по индексам исходного массива, поэтому rejected/duplicate rows не могут вернуться из-за совпадающего provider event ID.',
  };
}

function selectEventIndices(events = [], indices = []) {
  const allowed = new Set(Array.isArray(indices) ? indices.map(Number) : []);
  return (Array.isArray(events) ? events : []).filter((_, index) => allowed.has(index));
}

function selectEventIdsLegacy(events = [], ids = []) {
  const allowed = new Set(Array.isArray(ids) ? ids.map(String) : []);
  const emitted = new Set();
  return (Array.isArray(events) ? events : []).filter((event, index) => {
    const id = compactText(event?.id) || `index:${index}`;
    if (!allowed.has(id) || emitted.has(id)) return false;
    emitted.add(id);
    return true;
  });
}

export function sanitizeEventsForDisplay(events = [], quality = {}) {
  if (!quality?.sourceTrusted) return [];
  if (Array.isArray(quality?.displayEventIndices)) {
    return selectEventIndices(events, quality.displayEventIndices);
  }
  return selectEventIdsLegacy(events, quality?.displayEventIds || []);
}

export function eventsForTrustedAnalytics(events = [], quality = {}) {
  if (!quality?.analyticalConfidenceBearing) return [];
  if (Array.isArray(quality?.analyticalEventIndices)) {
    return selectEventIndices(events, quality.analyticalEventIndices);
  }
  return selectEventIdsLegacy(events, quality?.analyticalEventIds || []);
}

export function annotateEventReliability(meta = {}, quality = {}) {
  const originalState = String(meta?.state || (quality?.observed ? 'available' : 'empty_response'));
  const base = {
    ...meta,
    semanticState:String(quality?.state || 'unavailable'),
    eventQuality:quality,
    rawCount:Number(quality?.rawCount || 0),
    count:Number(quality?.displayCount || 0),
    partial:Boolean(quality?.state === 'sanitized'),
  };

  if (!quality?.observed) {
    return { ...base, available:false, usable:false, confidenceBearing:false };
  }
  if (!quality?.sourceTrusted) {
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
  if (!quality?.displayCount) {
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
  return {
    ...base,
    state:'available',
    available:true,
    usable:true,
    observed:true,
    degraded:quality?.state === 'sanitized',
    confidenceBearing:Boolean(quality?.analyticalConfidenceBearing),
    reason:quality?.analyticalConfidenceBearing ? (quality?.state === 'sanitized' ? 'events_sanitized' : '') : 'no_analytical_events',
  };
}
