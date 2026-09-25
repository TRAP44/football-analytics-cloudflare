function compactText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizedName(value = '') {
  return compactText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function absenceMatchKeys(player = {}) {
  const keys = [];
  const id = Number(player?.id || 0);
  if (id > 0) keys.push(`id:${id}`);
  const name = normalizedName(player?.name || '');
  if (name) keys.push(`name:${name}`);
  return keys;
}

function absencePlayerKey(player = {}) {
  return absenceMatchKeys(player)[0] || '';
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
    id: Number(player?.id || 0) || 0,
    name: compactText(player?.name || 'Игрок'),
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

function lineupKeys(lineup = null) {
  const keys = new Set();
  for (const entry of [...(lineup?.startXI || []), ...(lineup?.substitutes || [])]) {
    for (const key of absenceMatchKeys(entry)) keys.add(key);
  }
  return keys;
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
  const bySide = { home: new Map(), away: new Map() };
  for (const item of Array.isArray(rows) ? rows : []) {
    const teamId = Number(item?.team?.id || 0);
    const side = teamId === Number(homeId) ? 'home' : teamId === Number(awayId) ? 'away' : '';
    if (!side) continue;
    const normalized = normalizeAbsenceRow(item);
    const key = absencePlayerKey(normalized);
    if (!key) continue;
    bySide[side].set(key, mergeAbsenceRows(bySide[side].get(key), normalized));
  }

  const active = { home: [], away: [] };
  const resolvedByLineup = { home: [], away: [] };
  for (const side of ['home', 'away']) {
    const published = lineupKeys(lineups?.[side] || null);
    for (const [, item] of bySide[side]) {
      const listed = absenceMatchKeys(item).some(key => published.has(key));
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
    methodology: 'Потери нормализуются из fixture-level /injuries; игрок, присутствующий в опубликованном стартовом составе или запасе, исключается из активных потерь.',
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
