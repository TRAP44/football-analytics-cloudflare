const EXPECTED_GOALS_KEY = 'expected_goals';
const MAX_REASONABLE_XG = 15;
const MAX_META_TEXT_LENGTH = 120;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value, max = MAX_META_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  const text=value.trim();
  if (!text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return '';
  return text.slice(0,max);
}

function compactState(value = '') {
  return textValue(value)
    .toLowerCase()
    .replace(/\s+/g,'_');
}

function statisticsItems(statistics) {
  const source=plainObject(statistics);
  return Array.isArray(source?.items) ? source.items : [];
}

function expectedGoalsRows(statistics) {
  return statisticsItems(statistics).filter(row=>{
    const source=plainObject(row);
    return textValue(source?.key,64) === EXPECTED_GOALS_KEY;
  });
}

export function inspectExpectedGoalsValue(value) {
  if (value === null || value === undefined || value === '') {
    return { observed:false, valid:false, value:null, reason:'missing' };
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    return { observed:true, valid:false, value:null, reason:'invalid_type' };
  }

  let raw;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { observed:true, valid:false, value:null, reason:'not_finite' };
    }
    raw=String(value);
  } else {
    raw=value.trim().replace(',','.');
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return { observed:true, valid:false, value:null, reason:'invalid_format' };
  }

  const numeric=Number(raw);
  if (!Number.isFinite(numeric)) {
    return { observed:true, valid:false, value:null, reason:'not_finite' };
  }
  if (numeric < 0 || numeric > MAX_REASONABLE_XG) {
    return { observed:true, valid:false, value:null, reason:'out_of_range' };
  }

  return { observed:true, valid:true, value:numeric, reason:'ok' };
}

function expectedGoalsRow(statistics = {}) {
  return expectedGoalsRows(statistics)[0] || null;
}

function sourceIsTrusted(meta = {}) {
  const source=plainObject(meta);
  if (
    !source
    || source.confidenceBearing !== true
    || source.available !== true
    || source.usable !== true
    || source.stale === true
  ) return false;

  const freshnessState=compactState(source.freshnessState);
  const provenanceState=compactState(source.provenanceState);
  return ['fresh','cached'].includes(freshnessState) && provenanceState === 'verified';
}

export function assessExpectedGoalsQuality(statistics = {}, { statisticsMeta = {}, mode = 'live' } = {}) {
  const rows=expectedGoalsRows(statistics);
  const row=rows[0] || null;
  const home=inspectExpectedGoalsValue(row?.home);
  const away=inspectExpectedGoalsValue(row?.away);
  const observedSides=Number(home.observed)+Number(away.observed);
  const validSides=Number(home.valid)+Number(away.valid);
  const sourceTrusted=sourceIsTrusted(statisticsMeta);

  let state='unavailable';
  let label='xG недоступен';
  let reason='missing_pair';

  if (rows.length > 1) {
    state='invalid';
    label='xG отклонён';
    reason='duplicate_metric';
  } else if (observedSides > 0 && validSides < observedSides) {
    state='invalid';
    label='xG отклонён';
    reason='invalid_value';
  } else if (validSides === 1) {
    state='partial';
    label='xG неполный';
    reason='partial_pair';
  } else if (validSides === 2 && !sourceTrusted) {
    state='source_untrusted';
    label='xG не используется';
    reason='statistics_source_untrusted';
  } else if (validSides === 2) {
    state='verified';
    label='xG подтверждён';
    reason='verified_pair';
  }

  const meta=plainObject(statisticsMeta) || {};
  return {
    state,
    label,
    reason,
    mode:textValue(mode,32) || 'live',
    observed:observedSides > 0,
    observedSides,
    validSides,
    bothObserved:observedSides === 2,
    bothValid:validSides === 2,
    confidenceBearing:state === 'verified',
    provider:textValue(meta.provider),
    source:textValue(meta.source),
    freshnessState:textValue(meta.freshnessState) || 'unknown',
    provenanceState:textValue(meta.provenanceState) || 'unknown',
    home,
    away,
    methodology:'xG участвует в live-выводах только парой: оба значения должны быть числовыми, неотрицательными, в безопасном диапазоне и получены из свежего подтверждённого источника статистики.',
  };
}

export function sanitizeExpectedGoalsForDisplay(statistics = {}, quality = {}) {
  const source=plainObject(statistics) || {};
  const qualitySource=plainObject(quality) || {};
  let expectedGoalsSeen=false;

  const sanitized=statisticsItems(source)
    .filter(row=>plainObject(row))
    .map(row=>{
      const key=textValue(row.key,64);
      if (key !== EXPECTED_GOALS_KEY) return row;
      if (expectedGoalsSeen) return null;
      expectedGoalsSeen=true;
      return {
        ...row,
        home:qualitySource?.home?.valid === true ? qualitySource.home.value : null,
        away:qualitySource?.away?.valid === true ? qualitySource.away.value : null,
      };
    })
    .filter(row=>{
      if (!row) return false;
      if (textValue(row.key,64) !== EXPECTED_GOALS_KEY) return true;
      return row.home !== null || row.away !== null;
    });

  return {...source,items:sanitized};
}

export function statisticsForTrustedExpectedGoals(statistics = {}, quality = {}) {
  const source=plainObject(statistics) || {};
  if (plainObject(quality)?.confidenceBearing === true) return source;
  return {
    ...source,
    items:statisticsItems(source).filter(row=>{
      const item=plainObject(row);
      return item && textValue(item.key,64) !== EXPECTED_GOALS_KEY;
    }),
  };
}
