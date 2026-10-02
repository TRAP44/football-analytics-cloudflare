const SIDES = Object.freeze(['home', 'draw', 'away']);
const MIN_DECIMAL_ODD = 1.001;
const MAX_DECIMAL_ODD = 1000;
const MIN_IMPLIED_TOTAL = 0.75;
const MAX_IMPLIED_TOTAL = 1.6;
const PROBABILITY_TOLERANCE = 2.5;
const MAX_SOURCE_COUNT = 500;

function compactState(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function sourceIsTrusted(meta = {}) {
  return meta?.confidenceBearing === true
    && meta?.available === true
    && meta?.usable === true
    && meta?.stale !== true
    && ['fresh', 'cached'].includes(compactState(meta?.freshnessState))
    && compactState(meta?.provenanceState) === 'verified';
}

export function inspectDecimalOdd(value) {
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
  if (numeric < MIN_DECIMAL_ODD || numeric > MAX_DECIMAL_ODD) {
    return { observed:true, valid:false, value:null, reason:'out_of_range' };
  }
  return { observed:true, valid:true, value:numeric, reason:'ok' };
}

function inspectProbability(value) {
  if (value === null || value === undefined || value === '') {
    return { observed:false, valid:false, value:null, reason:'missing' };
  }
  if (typeof value === 'boolean') {
    return { observed:true, valid:false, value:null, reason:'invalid_type' };
  }
  const raw = typeof value === 'number' ? String(value) : String(value).trim().replace(',', '.').replaceAll('%', '');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) {
    return { observed:true, valid:false, value:null, reason:'invalid_format' };
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return { observed:true, valid:false, value:null, reason:'out_of_range' };
  }
  return { observed:true, valid:true, value:numeric, reason:'ok' };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function impliedTotalFromOdds(odds = {}) {
  const values = SIDES.map(side => Number(odds?.[side]));
  if (values.some(value => !Number.isFinite(value) || value <= 0)) return null;
  return values.reduce((sum, value) => sum + 1 / value, 0);
}

export function probabilitiesFromDecimalOdds(odds = {}) {
  const total = impliedTotalFromOdds(odds);
  if (!(total > 0)) return null;
  return Object.fromEntries(SIDES.map(side => [side, round1((1 / Number(odds[side])) / total * 100)]));
}

function sourceCount(market = {}) {
  const value = market?.sources ?? market?.bookmakers;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_SOURCE_COUNT ? count : null;
}

export function assessOddsMarketQuality(market = null, { oddsMeta = {}, mode = 'upcoming' } = {}) {
  const observed = Boolean(market && typeof market === 'object' && market.odds && typeof market.odds === 'object');
  const sourceTrusted = sourceIsTrusted(oddsMeta);
  const inspections = Object.fromEntries(SIDES.map(side => [side, inspectDecimalOdd(market?.odds?.[side])]));
  const issues = [];

  for (const side of SIDES) {
    const inspected = inspections[side];
    if (!inspected.valid) issues.push({ code:`odd_${inspected.reason}`, side, value:market?.odds?.[side] ?? null });
  }

  const allOddsValid = observed && SIDES.every(side => inspections[side].valid);
  const canonicalOdds = allOddsValid
    ? Object.fromEntries(SIDES.map(side => [side, inspections[side].value]))
    : null;
  const impliedTotal = canonicalOdds ? impliedTotalFromOdds(canonicalOdds) : null;
  const impliedTotalValid = impliedTotal !== null && impliedTotal >= MIN_IMPLIED_TOTAL && impliedTotal <= MAX_IMPLIED_TOTAL;
  if (allOddsValid && !impliedTotalValid) {
    issues.push({ code:'implied_total_out_of_range', value:round1(impliedTotal * 100) });
  }

  const sources = observed ? sourceCount(market) : null;
  if (observed && sources === null) issues.push({ code:'source_count_invalid', value:market?.sources ?? market?.bookmakers ?? null });

  const marketProvider = compactState(market?.provider);
  const metaProvider = compactState(oddsMeta?.provider);
  const providerMismatch = Boolean(marketProvider && metaProvider && marketProvider !== metaProvider);
  if (providerMismatch) issues.push({ code:'provider_mismatch', marketProvider, metaProvider });

  const marketValid = Boolean(observed && allOddsValid && impliedTotalValid && sources !== null && !providerMismatch);
  const derivedProbabilities = marketValid ? probabilitiesFromDecimalOdds(canonicalOdds) : null;
  const reported = market?.probabilities && typeof market.probabilities === 'object' ? market.probabilities : null;
  let probabilityIssueCount = 0;

  if (marketValid && reported) {
    const inspectedProbabilities = Object.fromEntries(SIDES.map(side => [side, inspectProbability(reported?.[side])]));
    const reportedValid = SIDES.every(side => inspectedProbabilities[side].valid);
    if (!reportedValid) {
      probabilityIssueCount += 1;
      issues.push({ code:'probability_invalid' });
    } else {
      const total = SIDES.reduce((sum, side) => sum + inspectedProbabilities[side].value, 0);
      if (Math.abs(total - 100) > 1.5) {
        probabilityIssueCount += 1;
        issues.push({ code:'probability_sum_mismatch', value:round1(total) });
      }
      for (const side of SIDES) {
        if (Math.abs(inspectedProbabilities[side].value - Number(derivedProbabilities?.[side] || 0)) > PROBABILITY_TOLERANCE) {
          probabilityIssueCount += 1;
          issues.push({
            code:'probability_mismatch',
            side,
            reported:round1(inspectedProbabilities[side].value),
            derived:Number(derivedProbabilities?.[side] || 0),
          });
        }
      }
    }
  }

  let state = 'unavailable';
  let label = 'Рынок недоступен';
  let reason = 'market_missing';
  if (observed && !sourceTrusted) {
    state = 'source_untrusted';
    label = 'Рынок не используется';
    reason = 'odds_source_untrusted';
  } else if (observed && !marketValid) {
    state = 'invalid';
    label = 'Рынок отклонён';
    reason = 'invalid_1x2_market';
  } else if (observed && probabilityIssueCount > 0) {
    state = 'sanitized';
    label = 'Рынок очищен';
    reason = 'probabilities_recomputed';
  } else if (observed) {
    state = 'verified';
    label = 'Рынок подтверждён';
    reason = 'verified_1x2_market';
  }

  const structuralIssueCount = issues.filter(issue => !String(issue.code || '').startsWith('probability_')).length;
  return {
    state,
    label,
    reason,
    mode:String(mode || 'upcoming'),
    observed,
    sourceTrusted,
    marketValid,
    confidenceBearing:Boolean(sourceTrusted && marketValid),
    provider:String(market?.provider || oddsMeta?.provider || ''),
    source:String(oddsMeta?.source || ''),
    sourceCount:sources || 0,
    freshnessState:String(oddsMeta?.freshnessState || 'unknown'),
    provenanceState:String(oddsMeta?.provenanceState || 'unknown'),
    impliedTotal:impliedTotal === null ? null : round1(impliedTotal * 100),
    odds:canonicalOdds,
    probabilities:derivedProbabilities,
    issueCount:issues.length,
    structuralIssueCount,
    probabilityIssueCount,
    issues,
    warnings:[
      ...(structuralIssueCount ? ['Некорректный рынок 1X2 исключён из аналитики и истории движения.'] : []),
      ...(probabilityIssueCount ? ['Вероятности рынка пересчитаны из валидных десятичных коэффициентов.'] : []),
      ...(observed && !sourceTrusted ? ['Источник коэффициентов не прошёл freshness/provenance guard.'] : []),
    ],
    methodology:'Рынок 1X2 участвует в модели и движении коэффициентов только при полной валидной тройке десятичных коэффициентов, разумной сумме implied probabilities, согласованном provider и положительном числе источников. Вероятности всегда канонически пересчитываются из коэффициентов.',
  };
}

export function oddsMarketForTrustedAnalytics(market = null, quality = {}) {
  if (!quality?.confidenceBearing || !quality?.marketValid || !quality?.odds || !quality?.probabilities) return null;
  const result = {
    ...(market || {}),
    odds:{ ...quality.odds },
    probabilities:{ ...quality.probabilities },
    sources:Number(quality.sourceCount || 0),
  };
  if (market?.bookmakers !== undefined) result.bookmakers = Number(quality.sourceCount || 0);
  return result;
}

export function sanitizeOddsSnapshotsForMovement(snapshots = []) {
  const safe = [];
  for (const row of Array.isArray(snapshots) ? snapshots : []) {
    const at = String(row?.at || '');
    if (!Number.isFinite(Date.parse(at))) continue;
    const inspections = Object.fromEntries(SIDES.map(side => [side, inspectDecimalOdd(row?.[side])]));
    if (!SIDES.every(side => inspections[side].valid)) continue;
    const odds = Object.fromEntries(SIDES.map(side => [side, inspections[side].value]));
    const impliedTotal = impliedTotalFromOdds(odds);
    if (impliedTotal === null || impliedTotal < MIN_IMPLIED_TOTAL || impliedTotal > MAX_IMPLIED_TOTAL) continue;
    const probabilities = probabilitiesFromDecimalOdds(odds);
    if (!probabilities) continue;
    safe.push({
      ...row,
      home:odds.home,
      draw:odds.draw,
      away:odds.away,
      homeProb:probabilities.home,
      drawProb:probabilities.draw,
      awayProb:probabilities.away,
    });
  }
  return safe;
}

export function annotateOddsReliability(meta = {}, quality = {}) {
  const originalState = String(meta?.state || (quality?.observed ? 'available' : 'empty_response'));
  const base = {
    ...meta,
    semanticState:String(quality?.state || 'unavailable'),
    oddsQuality:quality,
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
      reason:'odds_source_untrusted',
    };
  }
  if (!quality?.marketValid) {
    return {
      ...base,
      transportState:originalState,
      state:'invalid_data',
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'invalid_1x2_market',
    };
  }
  return {
    ...base,
    state:'available',
    available:true,
    usable:true,
    observed:true,
    degraded:quality?.state === 'sanitized',
    confidenceBearing:true,
    reason:quality?.state === 'sanitized' ? 'odds_probabilities_sanitized' : '',
  };
}
