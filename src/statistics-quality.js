const RULES = new Map([
  ['Ball Possession',['percent',0,100]], ['Total Shots',['count',0,100]],
  ['Shots on Goal',['count',0,60]], ['Shots off Goal',['count',0,60]], ['Blocked Shots',['count',0,60]],
  ['Corner Kicks',['count',0,40]], ['Offsides',['count',0,30]], ['Fouls',['count',0,60]],
  ['Yellow Cards',['count',0,15]], ['Red Cards',['count',0,5]], ['Goalkeeper Saves',['count',0,30]],
  ['Total passes',['count',0,2000]], ['Passes accurate',['count',0,2000]], ['Passes %',['percent',0,100]],
]);

const cellId = (key, side) => `${key}:${side}`;

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function statisticKey(value) {
  return textValue(value);
}

function state(value) {
  return textValue(value).toLowerCase().replace(/\s+/g, '_');
}

function sourceTrusted(meta = {}) {
  return meta?.confidenceBearing === true
    && meta?.available === true
    && meta?.usable === true
    && meta?.stale !== true
    && ['fresh','cached'].includes(state(meta?.freshnessState))
    && state(meta?.provenanceState) === 'verified';
}

function parseNumber(value, percent = false) {
  if (value === null || value === undefined || value === '') {
    return { observed:false, value:null, reason:'missing' };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { observed:true, value, reason:'ok' }
      : { observed:true, value:null, reason:'not_finite' };
  }
  if (typeof value !== 'string') {
    return { observed:true, value:null, reason:'invalid_type' };
  }

  const raw = value.trim().replace(',', '.');
  if (!raw) return { observed:false, value:null, reason:'missing' };
  const pattern = percent ? /^-?\d+(?:\.\d+)?%?$/ : /^-?\d+(?:\.\d+)?$/;
  if (!pattern.test(raw)) return { observed:true, value:null, reason:'invalid_format' };

  const numericText = percent && raw.endsWith('%') ? raw.slice(0, -1) : raw;
  const numeric = Number(numericText);
  return Number.isFinite(numeric)
    ? { observed:true, value:numeric, reason:'ok' }
    : { observed:true, value:null, reason:'not_finite' };
}

export function inspectStatisticValue(key = '', value = null) {
  const rule = RULES.get(statisticKey(key));
  if (!rule) return { guarded:false, observed:value !== null && value !== undefined && value !== '', valid:true, value:null, reason:'external_guard' };
  const [kind,min,max] = rule;
  const parsed = parseNumber(value, kind === 'percent');
  if (!parsed.observed) return { guarded:true, observed:false, valid:true, value:null, reason:'missing' };
  if (parsed.value === null) return { guarded:true, observed:true, valid:false, value:null, reason:parsed.reason };
  if (parsed.value < min || parsed.value > max) return { guarded:true, observed:true, valid:false, value:null, reason:'out_of_range' };
  if (kind === 'count' && !Number.isInteger(parsed.value)) return { guarded:true, observed:true, valid:false, value:null, reason:'non_integer_count' };
  return { guarded:true, observed:true, valid:true, value:parsed.value, reason:'ok' };
}

function metric(inspections, key, side) {
  const row = inspections.get(cellId(key, side));
  return row?.valid && row?.observed ? row.value : null;
}

function reject(issues, invalidCells, code, key, side, relatedKey = '', detail = '') {
  issues.push({ code, key, side, relatedKey, detail });
  if (side) invalidCells.add(cellId(key, side));
}

export function assessMatchStatisticsQuality(statistics = {}, { statisticsMeta = {}, mode = 'live' } = {}) {
  const rows = asRows(plainObject(statistics)?.items);
  const trusted = sourceTrusted(plainObject(statisticsMeta) || {});
  const inspections = new Map();
  const invalidCells = new Set();
  const issues = [];
  let guardedObservedCells = 0;
  let guardedValidCells = 0;
  let partialPairCount = 0;
  let invalidRowCount = 0;
  let duplicateMetricCount = 0;
  const seenGuardedKeys = new Set();

  for (const row of rows) {
    const sourceRow = plainObject(row);
    if (!sourceRow) {
      invalidRowCount += 1;
      issues.push({ code:'invalid_row', key:'', side:'', relatedKey:'', detail:'statistics row must be an object' });
      continue;
    }
    const key = statisticKey(sourceRow.key);
    if (!key) {
      invalidRowCount += 1;
      issues.push({ code:'invalid_key', key:'', side:'', relatedKey:'', detail:'statistics key must be a non-empty string' });
      continue;
    }
    if (!RULES.has(key)) continue;
    if (seenGuardedKeys.has(key)) {
      duplicateMetricCount += 1;
      invalidCells.add(cellId(key,'home'));
      invalidCells.add(cellId(key,'away'));
      issues.push({ code:'duplicate_metric', key, side:'', relatedKey:'', detail:'duplicate guarded statistic row' });
      continue;
    }
    seenGuardedKeys.add(key);
    let observedSides = 0;
    for (const side of ['home','away']) {
      const inspected = inspectStatisticValue(key, sourceRow[side]);
      inspections.set(cellId(key, side), inspected);
      if (inspected.observed) {
        observedSides += 1;
        guardedObservedCells += 1;
      }
      if (inspected.observed && inspected.valid) guardedValidCells += 1;
      if (!inspected.valid) reject(issues, invalidCells, inspected.reason, key, side);
    }
    if (observedSides === 1) partialPairCount += 1;
  }

  for (const side of ['home','away']) {
    const totalShots = metric(inspections,'Total Shots',side);
    for (const key of ['Shots on Goal','Shots off Goal','Blocked Shots']) {
      const value = metric(inspections,key,side);
      if (totalShots !== null && value !== null && value > totalShots) {
        reject(issues,invalidCells,'component_exceeds_total',key,side,'Total Shots',`${value}>${totalShots}`);
      }
    }

    const totalPasses = metric(inspections,'Total passes',side);
    const accurate = metric(inspections,'Passes accurate',side);
    if (totalPasses !== null && accurate !== null && accurate > totalPasses) {
      reject(issues,invalidCells,'accurate_passes_exceed_total','Passes accurate',side,'Total passes',`${accurate}>${totalPasses}`);
    }

    const reportedPct = metric(inspections,'Passes %',side);
    if (totalPasses !== null && accurate !== null && reportedPct !== null && totalPasses > 0 && accurate <= totalPasses) {
      const calculated = accurate / totalPasses * 100;
      if (Math.abs(calculated - reportedPct) > 5) {
        reject(issues,invalidCells,'pass_percentage_mismatch','Passes %',side,'Passes accurate',
          `reported=${reportedPct},calculated=${Math.round(calculated * 10) / 10}`);
      }
    }
  }

  const homePossession = metric(inspections,'Ball Possession','home');
  const awayPossession = metric(inspections,'Ball Possession','away');
  if (homePossession !== null && awayPossession !== null) {
    const total = homePossession + awayPossession;
    if (total < 95 || total > 105) {
      reject(issues,invalidCells,'possession_pair_mismatch','Ball Possession','home','Ball Possession',`total=${total}`);
      reject(issues,invalidCells,'possession_pair_mismatch','Ball Possession','away','Ball Possession',`total=${total}`);
    }
  }

  const displayRowKeys = [];
  const analyticalRowKeys = [];
  const displaySeen = new Set();
  const analyticalSeen = new Set();
  for (const row of rows) {
    const sourceRow = plainObject(row);
    if (!sourceRow) continue;
    const key = statisticKey(sourceRow.key);
    if (!key) continue;
    if (!RULES.has(key)) {
      if (!displaySeen.has(key)) {
        displaySeen.add(key);
        displayRowKeys.push(key);
      }
      if (!analyticalSeen.has(key)) {
        analyticalSeen.add(key);
        analyticalRowKeys.push(key);
      }
      continue;
    }
    const home = inspections.get(cellId(key,'home')) || inspectStatisticValue(key,sourceRow.home);
    const away = inspections.get(cellId(key,'away')) || inspectStatisticValue(key,sourceRow.away);
    const homeOk = home.observed && home.valid && !invalidCells.has(cellId(key,'home'));
    const awayOk = away.observed && away.valid && !invalidCells.has(cellId(key,'away'));
    if ((homeOk || awayOk) && !displaySeen.has(key)) {
      displaySeen.add(key);
      displayRowKeys.push(key);
    }
    if (homeOk && awayOk && !analyticalSeen.has(key)) {
      analyticalSeen.add(key);
      analyticalRowKeys.push(key);
    }
  }

  const observed = rows.length > 0;
  const invalidCellCount = invalidCells.size;
  const comparativeRows = analyticalRowKeys.filter(key => RULES.has(key)).length;
  let qualityState = 'unavailable';
  let label = 'Статистика недоступна';
  let reason = 'no_statistics';
  if (observed && !trusted) {
    qualityState = 'source_untrusted'; label = 'Статистика не используется'; reason = 'statistics_source_untrusted';
  } else if (observed && invalidRowCount === rows.length) {
    qualityState = 'invalid'; label = 'Статистика отклонена'; reason = 'no_valid_statistics_rows';
  } else if (observed && guardedObservedCells > 0 && guardedValidCells === 0) {
    qualityState = 'invalid'; label = 'Статистика отклонена'; reason = 'no_valid_guarded_statistics';
  } else if (observed && (invalidCellCount > 0 || partialPairCount > 0 || invalidRowCount > 0 || duplicateMetricCount > 0)) {
    qualityState = 'sanitized'; label = 'Статистика очищена'; reason = 'inconsistent_statistics_removed';
  } else if (observed) {
    qualityState = 'verified'; label = 'Статистика подтверждена'; reason = 'verified_statistics';
  }

  return {
    state:qualityState, label, reason, mode:String(mode || 'live'), observed, sourceTrusted:trusted,
    guardedObservedCells, guardedValidCells, invalidCellCount, partialPairCount,
    invalidRowCount, duplicateMetricCount,
    analyticalRowCount:comparativeRows, confidenceBearing:trusted && comparativeRows > 0,
    displayRowKeys, analyticalRowKeys, invalidCells:[...invalidCells], issues,
    warnings:[
      ...(invalidCellCount ? [`Исключены некорректные значения статистики: ${invalidCellCount}.`] : []),
      ...(partialPairCount ? [`Неполные пары метрик не используются для сравнения: ${partialPairCount}.`] : []),
      ...(invalidRowCount ? [`Отклонены повреждённые строки статистики: ${invalidRowCount}.`] : []),
      ...(duplicateMetricCount ? [`Отклонены дубли защищённых метрик: ${duplicateMetricCount}.`] : []),
      ...(observed && !trusted ? ['Источник статистики не прошёл freshness/provenance guard.'] : []),
    ],
    provider:textValue(statisticsMeta?.provider), source:textValue(statisticsMeta?.source),
    freshnessState:textValue(statisticsMeta?.freshnessState,'unknown'),
    provenanceState:textValue(statisticsMeta?.provenanceState,'unknown'),
    methodology:'Live-статистика допускается в сравнительную аналитику только после проверки диапазонов, пар home/away и связей между ударами, передачами и владением. xG проверяется отдельным специализированным guard.',
  };
}

function sanitizeValues(values = {}, side = '', invalidCells = new Set()) {
  const source = plainObject(values) || {};
  const result = { ...source };
  for (const key of RULES.keys()) {
    if (invalidCells.has(cellId(key,side))) result[key] = null;
  }
  return result;
}

export function sanitizeStatisticsForDisplay(statistics = {}, quality = {}) {
  const source = plainObject(statistics) || {};
  const qualityState = plainObject(quality) || {};
  if (qualityState.sourceTrusted !== true) return { ...source, items:[] };

  const invalidCells = new Set(
    asRows(qualityState.invalidCells).filter(value => typeof value === 'string'),
  );
  const home = plainObject(source.home);
  const away = plainObject(source.away);
  const items = asRows(source.items)
    .filter(row => plainObject(row))
    .map(row => {
      const key = statisticKey(row.key);
      if (!key) return null;
      if (!RULES.has(key)) return { ...row, key };
      return {
        ...row,
        key,
        home:invalidCells.has(cellId(key,'home')) ? null : row.home ?? null,
        away:invalidCells.has(cellId(key,'away')) ? null : row.away ?? null,
      };
    })
    .filter(row => row && (row.home !== null || row.away !== null));

  return {
    ...source,
    home:home ? { ...home, values:sanitizeValues(home.values,'home',invalidCells) } : source.home,
    away:away ? { ...away, values:sanitizeValues(away.values,'away',invalidCells) } : source.away,
    items,
  };
}

export function statisticsForTrustedAnalytics(statistics = {}, quality = {}) {
  const source = plainObject(statistics) || {};
  const qualityState = plainObject(quality) || {};
  if (qualityState.sourceTrusted !== true) return { ...source, items:[] };

  const allowed = new Set(
    asRows(qualityState.analyticalRowKeys)
      .map(statisticKey)
      .filter(Boolean),
  );
  return {
    ...source,
    items:asRows(source.items)
      .filter(row => {
        const sourceRow = plainObject(row);
        return sourceRow && allowed.has(statisticKey(sourceRow.key));
      }),
  };
}

export function annotateStatisticsReliability(meta = {}, quality = {}) {
  const sourceMeta = plainObject(meta) || {};
  const qualityState = plainObject(quality) || {};
  const displayRowKeys = asRows(qualityState.displayRowKeys);
  const base = {
    ...sourceMeta,
    semanticState:textValue(qualityState.state,'unavailable'),
    statisticsQuality:qualityState,
    partial:qualityState.state === 'sanitized',
  };
  if (!qualityState.observed) return { ...base, available:false, usable:false, confidenceBearing:false };
  if (qualityState.sourceTrusted !== true) {
    return {
      ...base,
      transportState:textValue(sourceMeta.state,'available'),
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'statistics_source_untrusted',
    };
  }
  if (!displayRowKeys.length) {
    return {
      ...base,
      transportState:textValue(sourceMeta.state,'available'),
      state:'invalid_data',
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'no_valid_statistics',
    };
  }
  return {
    ...base,
    state:'available',
    available:true,
    usable:true,
    observed:true,
    degraded:qualityState.state === 'sanitized',
    confidenceBearing:qualityState.confidenceBearing === true,
    reason:qualityState.state === 'sanitized' ? 'statistics_sanitized' : '',
  };
}
