const EXPECTED_GOALS_KEY = 'expected_goals';
const MAX_REASONABLE_XG = 15;

function compactState(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function inspectExpectedGoalsValue(value) {
  if (value === null || value === undefined || value === '') {
    return { observed:false, valid:false, value:null, reason:'missing' };
  }
  if (typeof value === 'boolean') {
    return { observed:true, valid:false, value:null, reason:'invalid_type' };
  }

  const raw = typeof value === 'number' ? String(value) : String(value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    return { observed:true, valid:false, value:null, reason:'invalid_format' };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { observed:true, valid:false, value:null, reason:'not_finite' };
  }
  if (numeric < 0 || numeric > MAX_REASONABLE_XG) {
    return { observed:true, valid:false, value:null, reason:'out_of_range' };
  }

  return { observed:true, valid:true, value:numeric, reason:'ok' };
}

function expectedGoalsRow(statistics = {}) {
  return (statistics?.items || []).find(row => String(row?.key || '') === EXPECTED_GOALS_KEY) || null;
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

export function assessExpectedGoalsQuality(statistics = {}, { statisticsMeta = {}, mode = 'live' } = {}) {
  const row = expectedGoalsRow(statistics);
  const home = inspectExpectedGoalsValue(row?.home);
  const away = inspectExpectedGoalsValue(row?.away);
  const observedSides = Number(home.observed) + Number(away.observed);
  const validSides = Number(home.valid) + Number(away.valid);
  const sourceTrusted = sourceIsTrusted(statisticsMeta);

  let state = 'unavailable';
  let label = 'xG недоступен';
  let reason = 'missing_pair';

  if (observedSides > 0 && validSides < observedSides) {
    state = 'invalid';
    label = 'xG отклонён';
    reason = 'invalid_value';
  } else if (validSides === 1) {
    state = 'partial';
    label = 'xG неполный';
    reason = 'partial_pair';
  } else if (validSides === 2 && !sourceTrusted) {
    state = 'source_untrusted';
    label = 'xG не используется';
    reason = 'statistics_source_untrusted';
  } else if (validSides === 2) {
    state = 'verified';
    label = 'xG подтверждён';
    reason = 'verified_pair';
  }

  return {
    state,
    label,
    reason,
    mode:String(mode || 'live'),
    observed:observedSides > 0,
    observedSides,
    validSides,
    bothObserved:observedSides === 2,
    bothValid:validSides === 2,
    confidenceBearing:state === 'verified',
    provider:String(statisticsMeta?.provider || ''),
    source:String(statisticsMeta?.source || ''),
    freshnessState:String(statisticsMeta?.freshnessState || 'unknown'),
    provenanceState:String(statisticsMeta?.provenanceState || 'unknown'),
    home,
    away,
    methodology:'xG участвует в live-выводах только парой: оба значения должны быть числовыми, неотрицательными, в безопасном диапазоне и получены из свежего подтверждённого источника статистики.',
  };
}

export function sanitizeExpectedGoalsForDisplay(statistics = {}, quality = {}) {
  const items = Array.isArray(statistics?.items) ? statistics.items : [];
  const sanitized = items.map(row => {
    if (String(row?.key || '') !== EXPECTED_GOALS_KEY) return row;
    return {
      ...row,
      home:quality?.home?.valid ? quality.home.value : null,
      away:quality?.away?.valid ? quality.away.value : null,
    };
  }).filter(row => {
    if (String(row?.key || '') !== EXPECTED_GOALS_KEY) return true;
    return row.home !== null || row.away !== null;
  });
  return { ...statistics, items:sanitized };
}

export function statisticsForTrustedExpectedGoals(statistics = {}, quality = {}) {
  if (quality?.confidenceBearing) return statistics;
  return {
    ...statistics,
    items:(statistics?.items || []).filter(row => String(row?.key || '') !== EXPECTED_GOALS_KEY),
  };
}
