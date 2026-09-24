const SUPPORTED = Object.freeze({
  78: { shortcuts: ['bl1'], label: 'Bundesliga' },
  79: { shortcuts: ['bl2'], label: '2. Bundesliga' },
  80: { shortcuts: ['bl3'], label: '3. Liga' },
  81: { shortcuts: ['dfb'], label: 'DFB-Pokal' },
  2: { shortcuts: ['ucl'], label: 'UEFA Champions League' },
  1: { shortcuts: ['wm26'], label: 'FIFA World Cup' },
});

export function openLigaCompetition(leagueId, season) {
  const item = SUPPORTED[Number(leagueId)];
  if (!item) return null;
  const year = Number(season || 0);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return { ...item, leagueId: Number(leagueId), season: year };
}

export function normalizeOpenLigaStandings(rows = [], context = {}) {
  const table = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const goalsFor = Number(row?.Goals ?? row?.goals ?? 0) || 0;
    const goalsAgainst = Number(row?.OpponentGoals ?? row?.opponentGoals ?? 0) || 0;
    return {
      rank: index + 1,
      team: {
        id: 0,
        providerId: Number(row?.TeamInfoId ?? row?.teamInfoId ?? 0) || null,
        name: String(row?.TeamName ?? row?.teamName ?? ''),
        logo: '',
      },
      points: Number(row?.Points ?? row?.points ?? 0) || 0,
      goalsDiff: Number(row?.GoalDiff ?? row?.goalDiff ?? (goalsFor - goalsAgainst)) || 0,
      played: Number(row?.Matches ?? row?.matches ?? 0) || 0,
      win: Number(row?.Won ?? row?.won ?? 0) || 0,
      draw: Number(row?.Draw ?? row?.draw ?? 0) || 0,
      lose: Number(row?.Lost ?? row?.lost ?? 0) || 0,
      goalsFor,
      goalsAgainst,
      form: '',
      description: '',
    };
  }).filter(row => row.team.name);

  return {
    available: table.length > 0,
    league: {
      id: Number(context.leagueId || 0),
      name: String(context.leagueName || context.label || ''),
      country: String(context.country || ''),
      logo: '',
      flag: '',
      season: Number(context.season || 0) || null,
    },
    groups: table.length ? [{ name: '', rows: table }] : [],
    standings: table,
    reason: table.length ? '' : 'OpenLigaDB не вернул таблицу для этого турнира и сезона.',
    sourceMeta: {
      provider: 'openligadb',
      label: 'OpenLigaDB',
      attribution: 'OpenLigaDB · ODbL',
    },
  };
}

export function openLigaTableUrls(leagueId, season) {
  const competition = openLigaCompetition(leagueId, season);
  if (!competition) return [];
  return competition.shortcuts.map(shortcut => ({
    shortcut,
    url: `https://api.openligadb.de/getbltable/${encodeURIComponent(shortcut)}/${competition.season}`,
  }));
}
