// Match formatting and live-data normalization extracted from worker.js.
// Semantic lineup/availability quality logic is injected by the composition root.
export function createMatchFormattingRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Match formatting runtime dependencies are required.');
  }
  const {
    assessLineupQuality,
    normalizeFixtureAbsences,
  } = deps;

  function formatAbsences(rows, homeId, awayId, lineups = null) {
    return normalizeFixtureAbsences(rows, { homeId, awayId, lineups });
  }
  function normalizeLineupPlayer(entry) {
    const p = entry?.player || {};
    if (!p?.name) return null;
    return {
      id: Number(p.id || 0),
      name: p.name || 'Игрок',
      number: p.number ?? null,
      pos: p.pos || '',
      grid: p.grid || '',
      photo: p.photo || '',
    };
  }
  
  function formatLineups(rows, homeId, awayId) {
    const out = { home: null, away: null };
    for (const x of rows || []) {
      const lineup = {
        formation: x.formation || '',
        coach: x.coach?.name || '',
        coachPhoto: x.coach?.photo || '',
        startXI: (x.startXI || []).map(normalizeLineupPlayer).filter(Boolean),
        substitutes: (x.substitutes || []).map(normalizeLineupPlayer).filter(Boolean),
      };
      lineup.quality = assessLineupQuality(lineup);
      if (Number(x.team?.id) === Number(homeId)) out.home = lineup;
      if (Number(x.team?.id) === Number(awayId)) out.away = lineup;
    }
    return out;
  }
  function formatH2H(rows, homeId, awayId) {
    let homeWins = 0, draws = 0, awayWins = 0;
    const matches = [];
    for (const x of rows || []) {
      const hg = Number(x.goals?.home ?? 0), ag = Number(x.goals?.away ?? 0);
      const hId = Number(x.teams?.home?.id), aId = Number(x.teams?.away?.id);
      let winnerId = null;
      if (hg > ag) winnerId = hId;
      if (ag > hg) winnerId = aId;
      if (!winnerId) draws++; else if (winnerId === Number(homeId)) homeWins++; else if (winnerId === Number(awayId)) awayWins++;
      matches.push({ date: x.fixture?.date || '', home: x.teams?.home?.name || '', away: x.teams?.away?.name || '', score: `${hg}:${ag}` });
    }
    return { homeWins, draws, awayWins, matches: matches.slice(0, 5) };
  }
  
  const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
  const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
  
  function isLiveStatus(status) { return LIVE_STATUSES.has(String(status || '').toUpperCase()); }
  function isFinishedStatus(status) { return FINISHED_STATUSES.has(String(status || '').toUpperCase()); }
  
  function statusLabel(status, elapsed) {
    const s = String(status || '').toUpperCase();
    const labels = {
      NS: 'Не начался', TBD: 'Время уточняется', '1H': '1-й тайм', HT: 'Перерыв', '2H': '2-й тайм',
      ET: 'Доп. время', BT: 'Перерыв', P: 'Пенальти', INT: 'Прерван', LIVE: 'Матч идёт',
      FT: 'Завершён', AET: 'Завершён после доп. времени', PEN: 'Завершён по пенальти',
      SUSP: 'Приостановлен', PST: 'Перенесён', CANC: 'Отменён', ABD: 'Прерван', AWD: 'Тех. результат', WO: 'Без игры',
    };
    const base = labels[s] || s || 'Статус неизвестен';
    return isLiveStatus(s) && Number.isFinite(Number(elapsed)) ? `${base} · ${Number(elapsed)}′` : base;
  }
  
  function normalizeStatValue(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value;
    return String(value);
  }
  
  const STAT_KEYS = [
    ['Ball Possession', 'Владение'],
    ['Total Shots', 'Удары'],
    ['Shots on Goal', 'В створ'],
    ['Shots off Goal', 'Мимо'],
    ['Blocked Shots', 'Блокированные'],
    ['Corner Kicks', 'Угловые'],
    ['Offsides', 'Офсайды'],
    ['Fouls', 'Фолы'],
    ['Yellow Cards', 'Жёлтые'],
    ['Red Cards', 'Красные'],
    ['Goalkeeper Saves', 'Сейвы'],
    ['Total passes', 'Передачи'],
    ['Passes accurate', 'Точные передачи'],
    ['Passes %', 'Точность передач'],
    ['expected_goals', 'xG'],
  ];
  
  function formatLiveStatistics(rows, homeId, awayId) {
    const byTeam = new Map();
    for (const row of rows || []) {
      const id = Number(row.team?.id || 0);
      const values = {};
      for (const stat of row.statistics || []) values[String(stat.type || '')] = normalizeStatValue(stat.value);
      byTeam.set(id, { teamId: id, teamName: row.team?.name || '', values });
    }
    const home = byTeam.get(Number(homeId)) || { teamId: Number(homeId), values: {} };
    const away = byTeam.get(Number(awayId)) || { teamId: Number(awayId), values: {} };
    const items = STAT_KEYS.map(([key, label]) => ({
      key, label, home: home.values[key] ?? null, away: away.values[key] ?? null,
    })).filter(x => x.home !== null || x.away !== null);
    return { home, away, items };
  }
  
  function translateEvent(type, detail) {
    const t = String(type || '').toLowerCase();
    const d = String(detail || '').toLowerCase();
    if (t === 'goal') {
      if (d.includes('own')) return '⚽ Автогол';
      if (d.includes('missed')) return '❌ Незабитый пенальти';
      if (d.includes('penalty')) return '⚽ Гол с пенальти';
      return '⚽ Гол';
    }
    if (t === 'card') {
      if (d.includes('red')) return '🟥 Красная карточка';
      if (d.includes('second yellow')) return '🟥 Вторая жёлтая';
      return '🟨 Жёлтая карточка';
    }
    if (t === 'subst') return '🔄 Замена';
    if (t === 'var') return '📺 Видеопросмотр';
    return detail || type || 'Событие';
  }
  
  function formatLiveEvents(rows, homeId, awayId) {
    return (rows || []).map((event, index) => {
      const rawMinute = event.time?.elapsed;
      const rawExtra = event.time?.extra;
      const minute = rawMinute === null || rawMinute === undefined || rawMinute === '' ? null : Number(rawMinute);
      const extra = rawExtra === null || rawExtra === undefined || rawExtra === '' ? 0 : Number(rawExtra);
      return {
        id: `${Number.isFinite(minute) ? minute : '?'}-${Number.isFinite(extra) ? extra : '?'}-${index}`,
        minute,
        extra,
        teamId: Number(event.team?.id || 0),
        side: Number(event.team?.id) === Number(homeId) ? 'home' : Number(event.team?.id) === Number(awayId) ? 'away' : '',
        teamName: event.team?.name || '',
        player: event.player?.name || '',
        assist: event.assist?.name || '',
        type: event.type || '',
        detail: event.detail || '',
        label: translateEvent(event.type, event.detail),
        comments: event.comments || '',
      };
    }).sort((a, b) => {
      const am = Number.isFinite(Number(a.minute)) ? Number(a.minute) : Number.MAX_SAFE_INTEGER;
      const bm = Number.isFinite(Number(b.minute)) ? Number(b.minute) : Number.MAX_SAFE_INTEGER;
      return am - bm || Number(a.extra || 0) - Number(b.extra || 0);
    });
  }
  
  function scoreSnapshot(fixture) {
    return {
      home: fixture.goals?.home ?? null,
      away: fixture.goals?.away ?? null,
      halftime: fixture.score?.halftime || null,
      fulltime: fixture.score?.fulltime || null,
      extratime: fixture.score?.extratime || null,
      penalty: fixture.score?.penalty || null,
    };
  }
  
  function embeddedLiveData(fixture) {
    return {
      events: Array.isArray(fixture.events) ? fixture.events : [],
      lineups: Array.isArray(fixture.lineups) ? fixture.lineups : [],
      statistics: Array.isArray(fixture.statistics) ? fixture.statistics : [],
      players: Array.isArray(fixture.players) ? fixture.players : [],
    };
  }
  
  
  
  return {
    formatAbsences,
    normalizeLineupPlayer,
    formatLineups,
    formatH2H,
    LIVE_STATUSES,
    FINISHED_STATUSES,
    isLiveStatus,
    isFinishedStatus,
    statusLabel,
    normalizeStatValue,
    STAT_KEYS,
    formatLiveStatistics,
    translateEvent,
    formatLiveEvents,
    scoreSnapshot,
    embeddedLiveData,
  };
}
