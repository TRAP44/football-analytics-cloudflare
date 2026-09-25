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
    normalizedText(event?.type),
    normalizedText(event?.detail),
    normalizedText(event?.player),
    normalizedText(event?.assist),
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
      if (inspected.future) futureEventCount += 1;
      if (inspected.minute === null || inspected.extra === null) invalidTimeCount += 1;
      continue;
    }

    const fingerprint = inspected.fingerprint;
    if (fingerprint && seen.has(fingerprint)) {
      duplicateEventIds.push(eventId);
      continue;
    }
    if (fingerprint) seen.add(fingerprint);
    displayEventIds.push(eventId);

    if (inspected.analyticsValid) analyticalEventIds.push(eventId);
    else if (inspected.analyticalType && !inspected.sideValid) unknownSideCount += 1;
  }

  const observed = rows.length > 0;
  const displayCount = displayEventIds.length;
  const analyticalCount = analyticalEventIds.length;
  const issueCount = rejectedEventIds.length + duplicateEventIds.length + unknownSideCount;
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
    rejectedCount:rejectedEventIds.length,
    duplicateCount:duplicateEventIds.length,
    unknownSideCount,
    futureEventCount,
    invalidTimeCount,
    confidenceBearing:sourceTrusted && displayCount > 0,
    analyticalConfidenceBearing:sourceTrusted && analyticalCount > 0,
    displayEventIds,
    analyticalEventIds,
    duplicateEventIds,
    rejectedEventIds,
    warnings,
    provider:String(eventsMeta?.provider || ''),
    source:String(eventsMeta?.source || ''),
    freshnessState:String(eventsMeta?.freshnessState || 'unknown'),
    provenanceState:String(eventsMeta?.provenanceState || 'unknown'),
    methodology:'Live-события допускаются в аналитику только после проверки времени, дедупликации, подтверждения стороны команды и freshness/provenance источника. Некорректные или дублирующиеся записи не должны влиять на Live AI и post-match evidence.',
  };
}

function selectEventIds(events = [], ids = []) {
  const allowed = new Set(Array.isArray(ids) ? ids.map(String) : []);
  return (Array.isArray(events) ? events : []).filter((event, index) => {
    const id = compactText(event?.id) || `index:${index}`;
    return allowed.has(id);
  });
}

export function sanitizeEventsForDisplay(events = [], quality = {}) {
  if (!quality?.sourceTrusted) return [];
  return selectEventIds(events, quality?.displayEventIds || []);
}

export function eventsForTrustedAnalytics(events = [], quality = {}) {
  if (!quality?.analyticalConfidenceBearing) return [];
  return selectEventIds(events, quality?.analyticalEventIds || []);
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
    degraded:false,
    confidenceBearing:Boolean(quality?.analyticalConfidenceBearing),
    reason:quality?.analyticalConfidenceBearing ? (quality?.state === 'sanitized' ? 'events_sanitized' : '') : 'no_analytical_events',
  };
}
