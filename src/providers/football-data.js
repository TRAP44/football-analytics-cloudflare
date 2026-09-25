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


function footballDataTeamKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:football club|futbol club|club de futbol|fc|afc|cf|sc|ac|calcio)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function footballDataTeamMatches(providerName, expectedName) {
  const left = footballDataTeamKey(providerName);
  const right = footballDataTeamKey(expectedName);
  if (!left || !right) return false;
  if (left === right) return true;
  const short = left.length <= right.length ? left : right;
  const long = short === left ? right : left;
  if (short.length >= 7 && long.includes(short)) return true;
  const generic = new Set(['united','city','real','sporting','athletic','club','team']);
  const leftTokens = left.split(' ').filter(token => token.length >= 5 && !generic.has(token));
  const rightTokens = new Set(right.split(' ').filter(token => token.length >= 5 && !generic.has(token)));
  return leftTokens.some(token => rightTokens.has(token));
}

export function footballDataScorersUrl(leagueId, season, { limit = 50 } = {}) {
  const code = footballDataCompetitionCode(leagueId);
  const year = Number(season || 0);
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 50) || 50));
  if (!code || !Number.isInteger(year) || year < 2000 || year > 2100) return '';
  return `https://api.football-data.org/v4/competitions/${encodeURIComponent(code)}/scorers?season=${year}&limit=${safeLimit}`;
}

export function normalizeFootballDataTeamScorers(payload = {}, context = {}) {
  const teamName = String(context.teamName || '').trim();
  const rows = (Array.isArray(payload?.scorers) ? payload.scorers : [])
    .filter(row => !teamName || footballDataTeamMatches(row?.team?.name || row?.team?.shortName || '', teamName))
    .map(row => ({
      id: 0,
      providerId: Number(row?.player?.id || 0) || null,
      name: String(row?.player?.name || row?.player?.lastName || row?.player?.firstName || ''),
      age: null,
      nationality: String(row?.player?.nationality || ''),
      photo: '',
      injured: null,
      team: {
        id: Number(context.teamId || 0) || 0,
        providerId: Number(row?.team?.id || 0) || null,
        name: String(row?.team?.name || row?.team?.shortName || teamName || ''),
      },
      league: {
        id: Number(context.leagueId || 0) || 0,
        name: String(context.leagueName || payload?.competition?.name || ''),
        season: Number(context.season || 0) || null,
      },
      games: {
        appearances: Number(row?.playedMatches || 0) || 0,
        lineups: null,
        minutes: null,
        rating: null,
        position: String(row?.player?.position || ''),
      },
      goals: {
        total: Number(row?.goals || 0) || 0,
        assists: Number(row?.assists || 0) || 0,
        penalties: Number(row?.penalties || 0) || 0,
      },
      cards: { yellow: null, yellowRed: null, red: null },
      passes: { key: null, accuracy: null },
      source: 'football-data',
    }))
    .filter(row => row.name)
    .sort((a, b) =>
      Number(b.goals.total || 0) - Number(a.goals.total || 0)
      || Number(b.goals.assists || 0) - Number(a.goals.assists || 0)
      || Number(b.games.appearances || 0) - Number(a.games.appearances || 0)
      || a.name.localeCompare(b.name)
    );

  return {
    available: rows.length > 0,
    complete: false,
    partial: rows.length > 0,
    scope: 'competition-scorers',
    players: rows,
    summary: {
      count: rows.length,
      complete: false,
      sourceScope: 'competition-scorers',
    },
    reason: rows.length ? '' : 'football-data.org не вернул игроков этой команды в таблице бомбардиров.',
    sourceMeta: {
      provider: 'football-data',
      label: 'football-data.org',
      attribution: 'Data provided by football-data.org',
    },
  };
}
