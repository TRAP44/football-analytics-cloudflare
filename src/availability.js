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
