import { createPlayerIdentityResolver, normalizePlayerName } from './player-identity.js';

function compactText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizedName(value = '') {
  return normalizePlayerName(value);
}

function categoryFromText(type = '', reason = '') {
  const text = `${compactText(type)} ${compactText(reason)}`.toLowerCase();
  if (/suspend|suspension|ban\b|banned|disciplin|red card|cards accumulation|дисквалиф|отстран/u.test(text)) {
    return { key: 'suspension', label: 'Дисквалификация' };
  }
  if (/illness|ill\b|virus|viral|flu\b|fever|covid|sick|болез|вирус|простуд/u.test(text)) {
    return { key: 'illness', label: 'Болезнь' };
  }
  if (/injur|strain|sprain|fracture|hamstring|ankle|knee|muscle|ligament|shoulder|groin|back|calf|achilles|surgery|травм|поврежд|перелом|мышц|колен|голеностоп/u.test(text)) {
    return { key: 'injury', label: 'Травма' };
  }
  return { key: 'other', label: 'Другая причина' };
}

function statusFromText(type = '', reason = '', category = 'other') {
  const text = `${compactText(type)} ${compactText(reason)}`.toLowerCase();
  if (/doubt|questionable|fitness test|late fitness|uncertain|под вопрос|сомнен/u.test(text)) {
    return { key: 'doubtful', label: 'Под вопросом' };
  }
  if (category === 'suspension') return { key: 'reported_out', label: 'Не сыграет по данным источника' };
  if (category === 'injury' || category === 'illness') return { key: 'reported_out', label: 'Отмечен как недоступный' };
  return { key: 'reported', label: 'Есть отметка о доступности' };
}

function mergeReasons(a = '', b = '') {
  const parts = [compactText(a), compactText(b)].filter(Boolean);
  return [...new Set(parts)].join(' · ');
}

function categoryPriority(key = '') {
  return ({ suspension: 4, injury: 3, illness: 2, other: 1 })[key] || 0;
}

function mergeAbsenceRows(current, next) {
  if (!current) return next;
  const stronger = categoryPriority(next.category) > categoryPriority(current.category) ? next : current;
  const status = current.status === 'reported_out' || next.status === 'reported_out'
    ? { key: 'reported_out', label: current.status === 'reported_out' ? current.statusLabel : next.statusLabel }
    : current.status === 'doubtful' || next.status === 'doubtful'
      ? { key: 'doubtful', label: 'Под вопросом' }
      : { key: stronger.status, label: stronger.statusLabel };
  return {
    ...stronger,
    reason: mergeReasons(current.reason, next.reason),
    type: mergeReasons(current.type, next.type),
    status: status.key,
    statusLabel: status.label,
    duplicateCount: Number(current.duplicateCount || 1) + Number(next.duplicateCount || 1),
  };
}

function normalizeAbsenceRow(item = {}) {
  const player = item?.player || {};
  const type = compactText(player?.type || item?.type || '');
  const reason = compactText(player?.reason || item?.reason || '');
  const category = categoryFromText(type, reason);
  const status = statusFromText(type, reason, category.key);
  return {
    id: Number(player?.id || player?.playerId || player?.player_id || 0) || 0,
    name: compactText(player?.name || player?.playerName || player?.player_name || 'Игрок'),
    type,
    reason,
    category: category.key,
    categoryLabel: category.label,
    status: status.key,
    statusLabel: status.label,
    source: 'api-football',
    duplicateCount: 1,
  };
}

function lineupEntries(lineup = null) {
  return [
    ...(Array.isArray(lineup?.startXI) ? lineup.startXI : []),
    ...(Array.isArray(lineup?.substitutes) ? lineup.substitutes : []),
  ];
}

function summarize(rows = []) {
  const summary = {
    total: rows.length,
    injury: 0,
    suspension: 0,
    illness: 0,
    other: 0,
    doubtful: 0,
    reportedOut: 0,
  };
  for (const row of rows) {
    if (Object.hasOwn(summary, row.category)) summary[row.category] += 1;
    else summary.other += 1;
    if (row.status === 'doubtful') summary.doubtful += 1;
    if (row.status === 'reported_out') summary.reportedOut += 1;
  }
  return summary;
}

export function normalizeFixtureAbsences(rows = [], { homeId = 0, awayId = 0, lineups = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const homeLineup = lineupEntries(lineups?.home || null);
  const awayLineup = lineupEntries(lineups?.away || null);
  const resolver = createPlayerIdentityResolver([
    ...list.map(item => item?.player || {}),
    ...homeLineup,
    ...awayLineup,
  ]);
  const bySide = { home: new Map(), away: new Map() };

  for (const item of list) {
    const teamId = Number(item?.team?.id || 0);
    const side = teamId === Number(homeId) ? 'home' : teamId === Number(awayId) ? 'away' : '';
    if (!side) continue;
    const normalized = normalizeAbsenceRow(item);
    const identity = resolver.resolve(normalized);
    if (!identity.valid || !identity.key) continue;
    bySide[side].set(identity.key, mergeAbsenceRows(bySide[side].get(identity.key), normalized));
  }

  const active = { home: [], away: [] };
  const resolvedByLineup = { home: [], away: [] };
  const published = { home:homeLineup, away:awayLineup };

  for (const side of ['home', 'away']) {
    for (const [, item] of bySide[side]) {
      const listed = published[side].some(player => resolver.matches(item, player));
      if (listed) {
        resolvedByLineup[side].push({
          ...item,
          reconciled: true,
          reconciliationReason: 'listed_in_published_lineup',
        });
      } else {
        active[side].push(item);
      }
    }
    active[side].sort((a, b) =>
      categoryPriority(b.category) - categoryPriority(a.category)
      || Number(a.status === 'doubtful') - Number(b.status === 'doubtful')
      || a.name.localeCompare(b.name)
    );
  }

  return {
    home: active.home,
    away: active.away,
    summary: {
      home: summarize(active.home),
      away: summarize(active.away),
      resolvedByLineup: resolvedByLineup.home.length + resolvedByLineup.away.length,
    },
    resolvedByLineup,
    source: 'api-football',
    methodology: 'Потери нормализуются по устойчивой identity-модели: известный ID имеет приоритет, имя используется только для ID-less alias без конфликта. Игрок снимается из активных потерь только при однозначном совпадении с опубликованным стартом или запасом.',
  };
}

function compactState(value = '') {
  return compactText(value).toLowerCase().replace(/\s+/g, '_');
}

function availabilitySourceTrusted(meta = {}) {
  return meta?.confidenceBearing === true
    && meta?.available === true
    && meta?.usable === true
    && meta?.stale !== true
    && ['fresh', 'cached'].includes(compactState(meta?.freshnessState))
    && compactState(meta?.provenanceState) === 'verified';
}

function identityIssueCode(reason = '') {
  if (reason === 'name_alias_ambiguous') return 'player_identity_ambiguous';
  if (reason === 'conflicting_known_ids') return 'player_identity_conflict';
  return 'player_identity_missing';
}

export function assessFixtureAvailabilityQuality(rows = [], {
  homeId = 0,
  awayId = 0,
  injuriesMeta = {},
  mode = 'upcoming',
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const sourceTrusted = availabilitySourceTrusted(injuriesMeta);
  const resolver = createPlayerIdentityResolver(list.map(item => item?.player || {}));
  const accepted = new Set();
  const rejected = new Set();
  const issues = [];
  const identitySides = new Map();
  const identityRows = new Map();

  for (let index = 0; index < list.length; index += 1) {
    const item = list[index] || {};
    const teamId = Number(item?.team?.id || 0);
    const side = teamId === Number(homeId) ? 'home' : teamId === Number(awayId) ? 'away' : '';
    const identity = resolver.resolve(item?.player || {});

    if (!side) {
      rejected.add(index);
      issues.push({ code:'team_mismatch', index, teamId:Number.isFinite(teamId) ? teamId : 0 });
      continue;
    }
    if (!identity.valid || !identity.key) {
      rejected.add(index);
      issues.push({
        code:identityIssueCode(identity.reason),
        index,
        side,
        normalizedName:identity.normalizedName || '',
      });
      continue;
    }

    accepted.add(index);
    if (!identitySides.has(identity.key)) identitySides.set(identity.key, new Set());
    identitySides.get(identity.key).add(side);
    const indices = identityRows.get(identity.key) || [];
    indices.push(index);
    identityRows.set(identity.key, indices);
  }

  let crossTeamConflictCount = 0;
  for (const [identity, sides] of identitySides) {
    if (sides.size <= 1) continue;
    crossTeamConflictCount += 1;
    for (const index of identityRows.get(identity) || []) {
      accepted.delete(index);
      rejected.add(index);
    }
    issues.push({ code:'cross_team_player_conflict', identity, sides:[...sides] });
  }

  const observed = list.length > 0;
  const acceptedIndices = [...accepted].sort((a, b) => a - b);
  const rejectedIndices = [...rejected].sort((a, b) => a - b);
  const acceptedCount = acceptedIndices.length;
  const rejectedCount = rejectedIndices.length;
  const ambiguousIdentityCount = issues.filter(issue => issue.code === 'player_identity_ambiguous').length;
  const conflictingIdentityCount = issues.filter(issue => issue.code === 'player_identity_conflict').length;

  let state = 'unavailable';
  let label = 'Данные о потерях недоступны';
  let reason = 'no_absence_rows';
  if (observed && !sourceTrusted) {
    state = 'source_untrusted';
    label = 'Потери не используются';
    reason = 'injuries_source_untrusted';
  } else if (observed && acceptedCount === 0) {
    state = 'invalid';
    label = 'Потери отклонены';
    reason = 'no_valid_absence_rows';
  } else if (observed && rejectedCount > 0) {
    state = 'sanitized';
    label = 'Потери очищены';
    reason = 'invalid_absence_rows_removed';
  } else if (observed) {
    state = 'verified';
    label = 'Потери подтверждены источником';
    reason = 'verified_absence_rows';
  }

  return {
    state,
    label,
    reason,
    mode:String(mode || 'upcoming'),
    observed,
    sourceTrusted,
    rawCount:list.length,
    acceptedCount,
    rejectedCount,
    crossTeamConflictCount,
    ambiguousIdentityCount,
    conflictingIdentityCount,
    confidenceBearing:Boolean(sourceTrusted && acceptedCount > 0),
    acceptedIndices,
    rejectedIndices,
    issues,
    provider:String(injuriesMeta?.provider || ''),
    source:String(injuriesMeta?.source || ''),
    freshnessState:String(injuriesMeta?.freshnessState || 'unknown'),
    provenanceState:String(injuriesMeta?.provenanceState || 'unknown'),
    warnings:[
      ...(rejectedCount ? [`Исключены некорректные записи о потерях: ${rejectedCount}.`] : []),
      ...(ambiguousIdentityCount ? [`Неоднозначные name-only идентичности игроков: ${ambiguousIdentityCount}.`] : []),
      ...(conflictingIdentityCount ? [`Конфликтующие известные ID игроков: ${conflictingIdentityCount}.`] : []),
      ...(crossTeamConflictCount ? [`Обнаружены конфликты принадлежности игрока к командам: ${crossTeamConflictCount}.`] : []),
      ...(observed && !sourceTrusted ? ['Источник потерь не прошёл freshness/provenance guard.'] : []),
    ],
    methodology:'Известный player ID является авторитетной identity. Name-only alias разрешается только при единственном совместимом ID; одинаковые имена с разными известными ID не объединяются. Неоднозначные alias и межкомандные конфликты fail-closed исключаются.',
  };
}

export function sanitizeAvailabilityRows(rows = [], quality = {}) {
  if (!quality?.sourceTrusted) return [];
  const accepted = new Set(Array.isArray(quality?.acceptedIndices) ? quality.acceptedIndices.map(Number) : []);
  return (Array.isArray(rows) ? rows : []).filter((_, index) => accepted.has(index));
}

export function annotateAvailabilityReliability(meta = {}, quality = {}) {
  const originalState = String(meta?.state || (quality?.observed ? 'available' : 'empty_response'));
  const base = {
    ...meta,
    semanticState:String(quality?.state || 'unavailable'),
    availabilityQuality:quality,
    rawCount:Number(quality?.rawCount || 0),
    count:Number(quality?.acceptedCount || 0),
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
      reason:'injuries_source_untrusted',
    };
  }
  if (!quality?.acceptedCount) {
    return {
      ...base,
      transportState:originalState,
      state:'invalid_data',
      available:false,
      usable:false,
      observed:true,
      degraded:true,
      confidenceBearing:false,
      reason:'no_valid_absence_rows',
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
    reason:quality?.state === 'sanitized' ? 'injuries_sanitized' : '',
  };
}


function bounded(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function roundRoleWeight(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function seasonPlayerIndex(playerStats = null) {
  const players = Array.isArray(playerStats?.players) ? playerStats.players : [];
  const byId = new Map();
  const byNameCandidates = new Map();
  for (const player of players) {
    const source = compactText(player?.source || playerStats?.sourceMeta?.provider || '').toLowerCase();
    const ids = [Number(player?.id || 0)];
    if (source === 'api-football') ids.push(Number(player?.providerId || 0));
    for (const id of [...new Set(ids.filter(value => value > 0))]) if (!byId.has(id)) byId.set(id, player);
    const name = normalizedName(player?.name || '');
    if (name) {
      const candidates = byNameCandidates.get(name) || [];
      candidates.push(player);
      byNameCandidates.set(name, candidates);
    }
  }
  const byName = new Map();
  for (const [name, candidates] of byNameCandidates) {
    if (candidates.length === 1) byName.set(name, candidates[0]);
  }
  return { byId, byName };
}

function matchSeasonPlayer(absence = {}, index = {}) {
  const id = Number(absence?.id || 0);
  if (id > 0 && index.byId?.has(id)) return index.byId.get(id);
  const name = normalizedName(absence?.name || '');
  return name && index.byName?.has(name) ? index.byName.get(name) : null;
}

function seasonRoleProfile(player = {}) {
  const appearances = Math.max(0, Number(player?.games?.appearances || 0));
  const lineups = Math.max(0, Number(player?.games?.lineups || 0));
  const minutes = Math.max(0, Number(player?.games?.minutes || 0));
  const goals = Math.max(0, Number(player?.goals?.total || 0));
  const assists = Math.max(0, Number(player?.goals?.assists || 0));
  if (!appearances && !lineups && !minutes && !goals && !assists) return null;

  const starterRate = appearances ? bounded(lineups / appearances, 0, 1) : 0;
  const minutesPerAppearance = appearances ? bounded(minutes / appearances, 0, 90) : 0;
  const contributionRate = appearances ? bounded((goals + assists) / appearances, 0, 0.6) / 0.6 : 0;
  const usageKnown = lineups > 0 || minutes > 0;
  const rawWeight = usageKnown
    ? 0.85 + 0.30 * starterRate + 0.30 * (minutesPerAppearance / 90) + 0.15 * contributionRate
    : 1 + 0.20 * contributionRate;
  const sampleStrength = bounded(appearances / 8, 0, 1);
  const weight = roundRoleWeight(bounded(1 + (rawWeight - 1) * sampleStrength, 0.85, 1.60));
  const label = weight >= 1.35
    ? 'Высокая игровая нагрузка'
    : weight >= 1.12
      ? 'Заметная игровая нагрузка'
      : weight <= 0.92
        ? 'Ограниченная игровая нагрузка'
        : 'Обычная игровая нагрузка';

  return {
    matched: true,
    weight,
    label,
    appearances,
    lineups,
    minutes,
    goals,
    assists,
    position: compactText(player?.games?.position || ''),
    source: compactText(player?.source || ''),
    methodology: 'Вес ограниченно учитывает только наблюдаемую сезонную игровую нагрузку и результативные действия; это не рейтинг качества игрока.',
  };
}

function enrichAbsenceSide(rows = [], playerStats = null) {
  const index = seasonPlayerIndex(playerStats);
  let matched = 0;
  const enriched = (Array.isArray(rows) ? rows : []).map(row => {
    const player = matchSeasonPlayer(row, index);
    const seasonRole = player ? seasonRoleProfile(player) : null;
    if (!seasonRole) return row;
    matched += 1;
    return { ...row, seasonRole };
  });
  return {
    rows: enriched,
    coverage: {
      matched,
      total: enriched.length,
      complete: Boolean(playerStats?.complete),
      partial: Boolean(playerStats?.partial),
      scope: compactText(playerStats?.scope || ''),
      provider: compactText(playerStats?.sourceMeta?.provider || ''),
    },
  };
}

export function enrichFixtureAbsencesWithSeasonRole(absences = {}, { homePlayerStats = null, awayPlayerStats = null } = {}) {
  const home = enrichAbsenceSide(absences?.home, homePlayerStats);
  const away = enrichAbsenceSide(absences?.away, awayPlayerStats);
  return {
    ...absences,
    home: home.rows,
    away: away.rows,
    summary: {
      ...(absences?.summary || {}),
      seasonRole: { home: home.coverage, away: away.coverage },
    },
    methodology: [
      compactText(absences?.methodology || ''),
      'Если в shared Team Intelligence cache уже есть сезонная статистика игрока, активная потеря получает ограниченный вес по минутам, стартам и результативным действиям без дополнительного внешнего запроса.',
    ].filter(Boolean).join(' '),
  };
}
