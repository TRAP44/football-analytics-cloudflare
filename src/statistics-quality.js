const RULES = new Map([
  ['Ball Possession',['percent',0,100]], ['Total Shots',['count',0,100]],
  ['Shots on Goal',['count',0,60]], ['Shots off Goal',['count',0,60]], ['Blocked Shots',['count',0,60]],
  ['Corner Kicks',['count',0,40]], ['Offsides',['count',0,30]], ['Fouls',['count',0,60]],
  ['Yellow Cards',['count',0,15]], ['Red Cards',['count',0,5]], ['Goalkeeper Saves',['count',0,30]],
  ['Total passes',['count',0,2000]], ['Passes accurate',['count',0,2000]], ['Passes %',['percent',0,100]],
]);

const cellId = (key, side) => `${key}:${side}`;
const state = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

function sourceTrusted(meta = {}) {
  return meta?.confidenceBearing === true
    && meta?.available === true
    && meta?.usable === true
    && meta?.stale !== true
    && ['fresh','cached'].includes(state(meta?.freshnessState))
    && state(meta?.provenanceState) === 'verified';
}

function parseNumber(value, percent = false) {
  if (value === null || value === undefined || value === '') return { observed:false, value:null, reason:'missing' };
  if (typeof value === 'boolean') return { observed:true, value:null, reason:'invalid_type' };
  const raw = (typeof value === 'number' ? String(value) : String(value).trim().replace(',', '.'));
  if (!(percent ? /^\d+(?:\.\d+)?%?$/ : /^\d+(?:\.\d+)?$/).test(raw)) {
    return { observed:true, value:null, reason:'invalid_format' };
  }
  const numeric = Number(raw.replaceAll('%',''));
  return Number.isFinite(numeric)
    ? { observed:true, value:numeric, reason:'ok' }
    : { observed:true, value:null, reason:'not_finite' };
}

export function inspectStatisticValue(key = '', value = null) {
  const rule = RULES.get(String(key || ''));
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
  const rows = Array.isArray(statistics?.items) ? statistics.items : [];
  const trusted = sourceTrusted(statisticsMeta);
  const inspections = new Map();
  const invalidCells = new Set();
  const issues = [];
  let guardedObservedCells = 0;
  let guardedValidCells = 0;
  let partialPairCount = 0;

  for (const row of rows) {
    const key = String(row?.key || '');
    if (!RULES.has(key)) continue;
    let observedSides = 0;
    for (const side of ['home','away']) {
      const inspected = inspectStatisticValue(key, row?.[side]);
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
  for (const row of rows) {
    const key = String(row?.key || '');
    if (!RULES.has(key)) {
      displayRowKeys.push(key);
      analyticalRowKeys.push(key);
      continue;
    }
    const home = inspections.get(cellId(key,'home')) || inspectStatisticValue(key,row?.home);
    const away = inspections.get(cellId(key,'away')) || inspectStatisticValue(key,row?.away);
    const homeOk = home.observed && home.valid && !invalidCells.has(cellId(key,'home'));
    const awayOk = away.observed && away.valid && !invalidCells.has(cellId(key,'away'));
    if (homeOk || awayOk) displayRowKeys.push(key);
    if (homeOk && awayOk) analyticalRowKeys.push(key);
  }

  const observed = rows.length > 0;
  const invalidCellCount = invalidCells.size;
  const comparativeRows = analyticalRowKeys.filter(key => RULES.has(key)).length;
  let qualityState = 'unavailable';
  let label = 'Статистика недоступна';
  let reason = 'no_statistics';
  if (observed && !trusted) {
    qualityState = 'source_untrusted'; label = 'Статистика не используется'; reason = 'statistics_source_untrusted';
  } else if (observed && guardedObservedCells > 0 && guardedValidCells === 0) {
    qualityState = 'invalid'; label = 'Статистика отклонена'; reason = 'no_valid_guarded_statistics';
  } else if (observed && (invalidCellCount > 0 || partialPairCount > 0)) {
    qualityState = 'sanitized'; label = 'Статистика очищена'; reason = 'inconsistent_statistics_removed';
  } else if (observed) {
    qualityState = 'verified'; label = 'Статистика подтверждена'; reason = 'verified_statistics';
  }

  return {
    state:qualityState, label, reason, mode:String(mode || 'live'), observed, sourceTrusted:trusted,
    guardedObservedCells, guardedValidCells, invalidCellCount, partialPairCount,
    analyticalRowCount:comparativeRows, confidenceBearing:trusted && comparativeRows > 0,
    displayRowKeys, analyticalRowKeys, invalidCells:[...invalidCells], issues,
    warnings:[
      ...(invalidCellCount ? [`Исключены некорректные значения статистики: ${invalidCellCount}.`] : []),
      ...(partialPairCount ? [`Неполные пары метрик не используются для сравнения: ${partialPairCount}.`] : []),
      ...(observed && !trusted ? ['Источник статистики не прошёл freshness/provenance guard.'] : []),
    ],
    provider:String(statisticsMeta?.provider || ''), source:String(statisticsMeta?.source || ''),
    freshnessState:String(statisticsMeta?.freshnessState || 'unknown'),
    provenanceState:String(statisticsMeta?.provenanceState || 'unknown'),
    methodology:'Live-статистика допускается в сравнительную аналитику только после проверки диапазонов, пар home/away и связей между ударами, передачами и владением. xG проверяется отдельным специализированным guard.',
  };
}

function sanitizeValues(values = {}, side = '', invalidCells = new Set()) {
  const result = { ...(values || {}) };
  for (const key of RULES.keys()) if (invalidCells.has(cellId(key,side))) result[key] = null;
  return result;
}

export function sanitizeStatisticsForDisplay(statistics = {}, quality = {}) {
  if (!quality?.sourceTrusted) return { ...statistics, items:[] };
  const invalidCells = new Set(Array.isArray(quality?.invalidCells) ? quality.invalidCells : []);
  return {
    ...statistics,
    home:statistics?.home ? { ...statistics.home, values:sanitizeValues(statistics.home.values,'home',invalidCells) } : statistics?.home,
    away:statistics?.away ? { ...statistics.away, values:sanitizeValues(statistics.away.values,'away',invalidCells) } : statistics?.away,
    items:(statistics?.items || []).map(row => {
      const key = String(row?.key || '');
      if (!RULES.has(key)) return row;
      return { ...row,
        home:invalidCells.has(cellId(key,'home')) ? null : row?.home ?? null,
        away:invalidCells.has(cellId(key,'away')) ? null : row?.away ?? null,
      };
    }).filter(row => row?.home !== null || row?.away !== null),
  };
}

export function statisticsForTrustedAnalytics(statistics = {}, quality = {}) {
  if (!quality?.sourceTrusted) return { ...statistics, items:[] };
  const allowed = new Set(Array.isArray(quality?.analyticalRowKeys) ? quality.analyticalRowKeys : []);
  return { ...statistics, items:(statistics?.items || []).filter(row => allowed.has(String(row?.key || ''))) };
}

export function annotateStatisticsReliability(meta = {}, quality = {}) {
  const base = { ...meta, semanticState:String(quality?.state || 'unavailable'), statisticsQuality:quality, partial:quality?.state === 'sanitized' };
  if (!quality?.observed) return { ...base, available:false, usable:false, confidenceBearing:false };
  if (!quality?.sourceTrusted) return { ...base, transportState:String(meta?.state || 'available'), available:false, usable:false, observed:true, degraded:true, confidenceBearing:false, reason:'statistics_source_untrusted' };
  if (!(quality?.displayRowKeys || []).length) return { ...base, transportState:String(meta?.state || 'available'), state:'invalid_data', available:false, usable:false, observed:true, degraded:true, confidenceBearing:false, reason:'no_valid_statistics' };
  return { ...base, state:'available', available:true, usable:true, observed:true, degraded:quality?.state === 'sanitized',
    confidenceBearing:Boolean(quality?.confidenceBearing), reason:quality?.state === 'sanitized' ? 'statistics_sanitized' : '' };
}
