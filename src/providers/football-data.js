const COMPETITIONS = Object.freeze({
  39: 'PL',
  140: 'PD',
  78: 'BL1',
  135: 'SA',
  61: 'FL1',
  2: 'CL',
});

export function footballDataCompetitionCode(leagueId) {
  return COMPETITIONS[Number(leagueId)] || '';
}

export function footballDataStandingsUrl(leagueId, season) {
  const code = footballDataCompetitionCode(leagueId);
  const year = Number(season || 0);
  if (!code || !Number.isInteger(year) || year < 2000 || year > 2100) return '';
  return `https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/standings?season=${year}`;
}

export function normalizeFootballDataStandings(payload = {}, context = {}) {
  const total = (Array.isArray(payload?.standings) ? payload.standings : []).find(row => String(row?.type || '').toUpperCase() === 'TOTAL')
    || payload?.standings?.[0]
    || {};
  const table = (Array.isArray(total?.table) ? total.table : []).map(row => ({
    rank: Number(row?.position || 0) || 0,
    team: {
      id: 0,
      providerId: Number(row?.team?.id || 0) || null,
      name: String(row?.team?.name || row?.team?.shortName || ''),
      logo: '',
    },
    points: Number(row?.points || 0) || 0,
    goalsDiff: Number(row?.goalDifference || 0) || 0,
    played: Number(row?.playedGames || 0) || 0,
    win: Number(row?.won || 0) || 0,
    draw: Number(row?.draw || 0) || 0,
    lose: Number(row?.lost || 0) || 0,
    goalsFor: Number(row?.goalsFor || 0) || 0,
    goalsAgainst: Number(row?.goalsAgainst || 0) || 0,
    form: String(row?.form || '').replaceAll(',', '').slice(-5),
    description: '',
  })).filter(row => row.team.name);

  return {
    available: table.length > 0,
    league: {
      id: Number(context.leagueId || 0),
      name: String(context.leagueName || payload?.competition?.name || ''),
      country: String(context.country || payload?.area?.name || ''),
      logo: '',
      flag: '',
      season: Number(context.season || 0) || null,
    },
    groups: table.length ? [{ name: '', rows: table }] : [],
    standings: table,
    reason: table.length ? '' : 'football-data.org не вернул таблицу для этого турнира и сезона.',
    sourceMeta: {
      provider: 'football-data',
      label: 'football-data.org',
      attribution: 'Data provided by football-data.org',
    },
  };
}
