function compactText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizedPlayerKey(player = {}) {
  const id = Number(player?.id || 0);
  if (id > 0) return `id:${id}`;
  const name = compactText(player?.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return name ? `name:${name}` : '';
}

function validGrid(value = '') {
  return /^\d+:\d+$/.test(compactText(value));
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function compactState(value = '') {
  return compactText(value).toLowerCase().replace(/\s+/g, '_');
}

function explicitLineupStale(meta = {}) {
  const state = compactState(meta?.state);
  const freshness = compactState(meta?.freshness);
  const source = compactState(meta?.source);
  return state === 'stale' || state === 'stale_data' || freshness === 'stale' || source === 'stale-cache';
}

function lineupProvenanceKnown(meta = {}) {
  const provider = compactState(meta?.provider);
  const source = compactState(meta?.source);
  const providerKnown = Boolean(provider && provider !== 'unknown' && provider !== 'none');
  const sourceKnown = Boolean(source && source !== 'unknown' && source !== 'none');
  return providerKnown && sourceKnown;
}

function lineupSourceReliability(meta = {}) {
  const stale = explicitLineupStale(meta);
  const provenanceKnown = lineupProvenanceKnown(meta);
  const source = compactState(meta?.source);
  const freshness = compactState(meta?.freshness);
  const cached = !stale && (source === 'cache' || freshness === 'cached');
  return {
    stale,
    cached,
    provenanceKnown,
    freshnessState: stale ? 'stale' : cached ? 'cached' : 'fresh',
    provenanceState: provenanceKnown ? 'verified' : 'unknown',
  };
}

function downgradeConfirmedMatchQuality(quality = {}, reason = '') {
  if (!quality || typeof quality !== 'object' || !quality.bothConfirmed) return quality;
  quality.structuralBothConfirmed = true;
  quality.reliabilityConfirmed = false;
  quality.reliabilityReason = reason;
  quality.bothConfirmed = false;
  quality.confirmedSides = 0;
  for (const sideName of ['home', 'away']) {
    const side = quality?.[sideName];
    if (!side || typeof side !== 'object') continue;
    side.structurallyConfirmed = Boolean(side.confirmed);
    side.confirmed = false;
    side.reliabilityConfirmed = false;
    side.reliabilityReason = reason;
  }
  return quality;
}

export function assessLineupQuality(lineup = null) {
  const starters = Array.isArray(lineup?.startXI) ? lineup.startXI : [];
  const substitutes = Array.isArray(lineup?.substitutes) ? lineup.substitutes : [];
  const keys = starters.map(normalizedPlayerKey).filter(Boolean);
  const uniqueStarters = new Set(keys).size;
  const duplicateStarters = Math.max(0, keys.length - uniqueStarters);
  const gridKnown = starters.filter(player => validGrid(player?.grid)).length;
  const published = starters.length > 0;
  const confirmed = starters.length === 11 && uniqueStarters === 11 && duplicateStarters === 0;
  const partial = published && !confirmed;
  const starterCoverage = Math.min(1, uniqueStarters / 11);
  const gridCoverage = starters.length ? gridKnown / starters.length : 0;
  const score = boundedScore(
    starterCoverage * 75
    + (compactText(lineup?.formation) ? 10 : 0)
    + (compactText(lineup?.coach) ? 5 : 0)
    + gridCoverage * 5
    + (substitutes.length ? 5 : 0)
  );

  const warnings = [];
  if (partial) warnings.push(`Ожидалось 11 уникальных игроков старта, получено ${uniqueStarters}.`);
  if (duplicateStarters > 0) warnings.push(`В стартовом составе обнаружены дубли: ${duplicateStarters}.`);

  return {
    state: confirmed ? 'confirmed' : partial ? 'partial' : 'unavailable',
    label: confirmed ? 'Подтверждён' : partial ? 'Неполный состав' : 'Не опубликован',
    published,
    confirmed,
    partial,
    score,
    startCount: starters.length,
    uniqueStartCount: uniqueStarters,
    duplicateStartCount: duplicateStarters,
    substituteCount: substitutes.length,
    gridKnown,
    formationKnown: Boolean(compactText(lineup?.formation)),
    coachKnown: Boolean(compactText(lineup?.coach)),
    warnings,
  };
}

export function annotateLineupReliability(meta = {}, matchQuality = {}) {
  const quality = matchQuality && typeof matchQuality === 'object' ? matchQuality : {};
  const anyPublished = Boolean(quality.anyPublished);
  const bothConfirmed = Boolean(quality.bothConfirmed);
  const originalState = String(meta?.state || (anyPublished ? 'available' : 'empty_response'));
  const originalAvailable = meta?.available === undefined ? anyPublished : Boolean(meta.available);
  const originalUsable = meta?.usable === undefined ? originalAvailable : Boolean(meta.usable);
  const originalObserved = meta?.observed === undefined ? anyPublished : Boolean(meta.observed);
  const sourceReliability = lineupSourceReliability(meta);

  if (!anyPublished) {
    return {
      ...meta,
      semanticState: 'unavailable',
      freshnessState: sourceReliability.freshnessState,
      provenanceState: sourceReliability.provenanceState,
      confirmed: false,
      partial: false,
      stale: sourceReliability.stale,
      lineupQuality: quality,
    };
  }

  if (bothConfirmed && sourceReliability.stale) {
    downgradeConfirmedMatchQuality(quality, 'lineup_stale');
    return {
      ...meta,
      transportState: originalState,
      state: 'stale_data',
      available: false,
      usable: false,
      observed: true,
      degraded: true,
      semanticState: 'confirmed',
      freshnessState: 'stale',
      provenanceState: sourceReliability.provenanceState,
      structurallyConfirmed: true,
      confirmed: false,
      partial: false,
      stale: true,
      reason: 'lineup_stale',
      lineupQuality: quality,
    };
  }

  if (bothConfirmed && !sourceReliability.provenanceKnown) {
    downgradeConfirmedMatchQuality(quality, 'lineup_provenance_missing');
    return {
      ...meta,
      transportState: originalState,
      state: 'unverified_source',
      available: false,
      usable: false,
      observed: true,
      degraded: true,
      semanticState: 'confirmed',
      freshnessState: sourceReliability.freshnessState,
      provenanceState: 'unknown',
      structurallyConfirmed: true,
      confirmed: false,
      partial: false,
      stale: false,
      reason: 'lineup_provenance_missing',
      lineupQuality: quality,
    };
  }

  if (bothConfirmed) {
    return {
      ...meta,
      available: originalAvailable,
      usable: originalUsable,
      observed: originalObserved || originalAvailable,
      semanticState: 'confirmed',
      freshnessState: sourceReliability.freshnessState,
      provenanceState: sourceReliability.provenanceState,
      structurallyConfirmed: true,
      confirmed: true,
      partial: false,
      stale: false,
      lineupQuality: quality,
    };
  }

  return {
    ...meta,
    transportState: originalState,
    state: 'partial_data',
    available: false,
    usable: false,
    observed: true,
    semanticState: 'partial',
    freshnessState: sourceReliability.freshnessState,
    provenanceState: sourceReliability.provenanceState,
    confirmed: false,
    partial: true,
    stale: sourceReliability.stale,
    reason: 'lineup_incomplete',
    lineupQuality: quality,
  };
}

export function assessMatchLineups(lineups = {}) {
  const home = assessLineupQuality(lineups?.home || null);
  const away = assessLineupQuality(lineups?.away || null);
  return {
    home,
    away,
    anyPublished: home.published || away.published,
    bothPublished: home.published && away.published,
    bothConfirmed: home.confirmed && away.confirmed,
    confirmedSides: Number(home.confirmed) + Number(away.confirmed),
    partialSides: Number(home.partial) + Number(away.partial),
    reliabilityConfirmed: home.confirmed && away.confirmed,
    methodology: 'Состав считается подтверждённым только при 11 уникальных игроках стартового XI и надёжном свежем источнике. Stale-кэш или неизвестный provenance не повышают статус до подтверждённого.',
  };
}
