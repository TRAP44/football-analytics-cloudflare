const SUPPORTED = Object.freeze({
  78: { shortcuts: ['bl1'], label: 'Bundesliga' },
  79: { shortcuts: ['bl2'], label: '2. Bundesliga' },
  80: { shortcuts: ['bl3'], label: '3. Liga' },
  81: { shortcuts: ['dfb'], label: 'DFB-Pokal' },
  2: { shortcuts: ['ucl'], label: 'UEFA Champions League' },
  1: { shortcuts: ['wm26'], label: 'FIFA World Cup' },
});

function strictInteger(value, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  let number=null;
  if (typeof value === 'number') {
    number=Number.isSafeInteger(value) ? value : null;
  } else if (typeof value === 'string') {
    const raw=value.trim();
    if (!/^-?\d+$/.test(raw)) return null;
    const parsed=Number(raw);
    number=Number.isSafeInteger(parsed) ? parsed : null;
  }
  return number !== null && number >= min && number <= max ? number : null;
}

function safeText(value, max = 240) {
  if (!['string','number','bigint'].includes(typeof value)) return '';
  try {
    return String(value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,max);
  } catch {
    return '';
  }
}

function explicitBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized=value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return false;
}

export function openLigaCompetition(leagueId, season) {
  const id = strictInteger(leagueId, 1);
  const year = strictInteger(season, 2000, 2100);
  if (id === null || year === null) return null;
  const item = SUPPORTED[id];
  if (!item) return null;
  return { ...item, leagueId: id, season: year };
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


function openLigaTextKey(value) {
  return safeText(value, 240)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:fussballclub|fußballclub|football club|futbol club|club de futbol|fc|afc|cf|sc|sv|vfb|vfl|tsg|borussia)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function openLigaTeamMatches(providerName, expectedName) {
  const left = openLigaTextKey(providerName);
  const right = openLigaTextKey(expectedName);
  if (!left || !right) return false;
  if (left === right) return true;
  const short = left.length <= right.length ? left : right;
  const long = short === left ? right : left;
  if (short.length >= 6 && long.includes(short)) return true;

  const generic = new Set(['united','city','real','sporting','athletic','club','team','manchester','madrid','milan','munich','munchen']);
  const leftTokens = left.split(' ').filter(token => token.length >= 5 && !generic.has(token));
  const rightTokens = new Set(right.split(' ').filter(token => token.length >= 5 && !generic.has(token)));
  return leftTokens.some(token => rightTokens.has(token));
}

function openLigaKickoffMs(match = {}) {
  const value = match?.matchDateTimeUTC
    ?? match?.MatchDateTimeUTC
    ?? match?.matchDateTime
    ?? match?.MatchDateTime
    ?? '';
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function openLigaTeamName(team = {}) {
  return safeText(
    team?.teamName ?? team?.TeamName ?? team?.shortName ?? team?.ShortName ?? '',
    180,
  );
}

function findOpenLigaMatch(matches = [], context = {}) {
  const kickoffRaw=typeof context?.kickoffAt === 'string' ? context.kickoffAt.trim() : '';
  const kickoff = kickoffRaw ? Date.parse(kickoffRaw) : NaN;
  if (!Number.isFinite(kickoff)) return null;
  const candidates = (Array.isArray(matches) ? matches : []).filter(match => {
    const home = openLigaTeamName(match?.team1 ?? match?.Team1 ?? {});
    const away = openLigaTeamName(match?.team2 ?? match?.Team2 ?? {});
    return openLigaTeamMatches(home, context.homeName) && openLigaTeamMatches(away, context.awayName);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const left = openLigaKickoffMs(a);
    const right = openLigaKickoffMs(b);
    const ld = left === null ? Number.POSITIVE_INFINITY : Math.abs(left - kickoff);
    const rd = right === null ? Number.POSITIVE_INFINITY : Math.abs(right - kickoff);
    return ld - rd;
  });
  const best = candidates[0];
  const bestKickoff = openLigaKickoffMs(best);
  if (bestKickoff === null || Math.abs(bestKickoff - kickoff) > 12 * 60 * 60 * 1000) return null;
  return best;
}

function openLigaGoalNumber(goal = {}, key) {
  const value = goal?.[key] ?? goal?.[key[0].toUpperCase() + key.slice(1)];
  return strictInteger(value, 0, 99);
}

function openLigaTeamFilter(value) {
  const tokens = openLigaTextKey(value).split(' ').filter(token => token.length >= 4);
  return tokens[0] || '';
}

export function openLigaMatchDataUrls(leagueId, season, teamName = '') {
  const competition = openLigaCompetition(leagueId, season);
  if (!competition) return [];
  const teamFilter = openLigaTeamFilter(teamName);
  return competition.shortcuts.map(shortcut => ({
    shortcut,
    teamFilter,
    url: teamFilter
      ? `https://api.openligadb.de/getmatchdata/${encodeURIComponent(shortcut)}/${competition.season}/${encodeURIComponent(teamFilter)}`
      : `https://api.openligadb.de/getmatchdata/${encodeURIComponent(shortcut)}/${competition.season}`,
  }));
}

export function normalizeOpenLigaMatchEvents(matches = [], context = {}) {
  const homeId=strictInteger(context?.homeId, 1);
  const awayId=strictInteger(context?.awayId, 1);
  if (homeId === null || awayId === null || homeId === awayId) {
    return {
      available:false,
      events:[],
      reason:'fixture_context_invalid',
      sourceMeta:{
        provider:'openligadb',
        label:'OpenLigaDB',
        attribution:'OpenLigaDB · ODbL',
      },
    };
  }

  const match = findOpenLigaMatch(matches, context);
  if (!match) {
    return {
      available: false,
      events: [],
      reason: 'fixture_not_matched',
      sourceMeta: {
        provider: 'openligadb',
        label: 'OpenLigaDB',
        attribution: 'OpenLigaDB · ODbL',
      },
    };
  }

  const goals = Array.isArray(match?.goals ?? match?.Goals) ? (match.goals ?? match.Goals) : [];
  let previousHome = 0;
  let previousAway = 0;
  const events = [];

  for (const goal of goals) {
    const scoreHome = openLigaGoalNumber(goal, 'scoreTeam1');
    const scoreAway = openLigaGoalNumber(goal, 'scoreTeam2');
    if (scoreHome === null || scoreAway === null) continue;

    const homeDelta=scoreHome-previousHome;
    const awayDelta=scoreAway-previousAway;
    const sequentialGoal=(
      (homeDelta===1 && awayDelta===0)
      || (homeDelta===0 && awayDelta===1)
    );
    if (!sequentialGoal) {
      if (
        scoreHome >= previousHome
        && scoreAway >= previousAway
        && scoreHome + scoreAway > previousHome + previousAway
      ) {
        previousHome=scoreHome;
        previousAway=scoreAway;
      }
      continue;
    }

    const side=homeDelta===1 ? 'home' : 'away';
    previousHome=scoreHome;
    previousAway=scoreAway;

    const minute = strictInteger(goal?.matchMinute ?? goal?.MatchMinute, 0, 130);
    if (minute === null) continue;
    const isPenalty = explicitBoolean(goal?.isPenalty ?? goal?.IsPenalty);
    const isOwnGoal = explicitBoolean(goal?.isOwnGoal ?? goal?.IsOwnGoal);
    const playerName = safeText(goal?.goalGetterName ?? goal?.GoalGetterName ?? '', 120);
    const teamId = side === 'home' ? homeId : awayId;
    const teamName = side === 'home'
      ? safeText(context.homeName, 180)
      : safeText(context.awayName, 180);

    events.push({
      time: { elapsed: minute, extra: 0 },
      team: { id: teamId, name: teamName },
      player: { id: 0, name: playerName },
      assist: { id: 0, name: '' },
      type: 'Goal',
      detail: isOwnGoal ? 'Own Goal' : isPenalty ? 'Penalty' : 'Normal Goal',
      comments: 'OpenLigaDB',
    });
  }

  const updatedAt = safeText(
    match?.lastUpdateDateTime
    ?? match?.LastUpdateDateTime
    ?? match?.matchDateTimeUTC
    ?? match?.MatchDateTimeUTC
    ?? '',
    80,
  );

  return {
    available: events.length > 0,
    events,
    reason: events.length ? '' : 'goals_not_available',
    sourceMatchId: strictInteger(match?.matchID ?? match?.MatchID, 1),
    updatedAt,
    sourceMeta: {
      provider: 'openligadb',
      label: 'OpenLigaDB',
      attribution: 'OpenLigaDB · ODbL',
    },
  };
}
