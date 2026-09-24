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


function openLigaTextKey(value) {
  return String(value || '')
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
  return short.length >= 6 && long.includes(short);
}

function openLigaKickoffMs(match = {}) {
  const value = match?.matchDateTimeUTC
    ?? match?.MatchDateTimeUTC
    ?? match?.matchDateTime
    ?? match?.MatchDateTime
    ?? '';
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function openLigaTeamName(team = {}) {
  return String(team?.teamName ?? team?.TeamName ?? team?.shortName ?? team?.ShortName ?? '');
}

function findOpenLigaMatch(matches = [], context = {}) {
  const kickoff = Date.parse(String(context.kickoffAt || ''));
  const candidates = (Array.isArray(matches) ? matches : []).filter(match => {
    const home = openLigaTeamName(match?.team1 ?? match?.Team1 ?? {});
    const away = openLigaTeamName(match?.team2 ?? match?.Team2 ?? {});
    return openLigaTeamMatches(home, context.homeName) && openLigaTeamMatches(away, context.awayName);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (!Number.isFinite(kickoff)) return 0;
    const left = openLigaKickoffMs(a);
    const right = openLigaKickoffMs(b);
    const ld = left === null ? Number.POSITIVE_INFINITY : Math.abs(left - kickoff);
    const rd = right === null ? Number.POSITIVE_INFINITY : Math.abs(right - kickoff);
    return ld - rd;
  });
  const best = candidates[0];
  if (Number.isFinite(kickoff)) {
    const bestKickoff = openLigaKickoffMs(best);
    if (bestKickoff === null || Math.abs(bestKickoff - kickoff) > 12 * 60 * 60 * 1000) return null;
  }
  return best;
}

function openLigaGoalNumber(goal = {}, key) {
  const value = goal?.[key] ?? goal?.[key[0].toUpperCase() + key.slice(1)];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    let side = '';
    if (scoreHome !== null && scoreAway !== null) {
      if (scoreHome > previousHome && scoreAway === previousAway) side = 'home';
      else if (scoreAway > previousAway && scoreHome === previousHome) side = 'away';
      previousHome = Math.max(previousHome, scoreHome);
      previousAway = Math.max(previousAway, scoreAway);
    }
    if (!side) continue;

    const minute = Math.max(0, Number(goal?.matchMinute ?? goal?.MatchMinute ?? 0) || 0);
    const isPenalty = Boolean(goal?.isPenalty ?? goal?.IsPenalty);
    const isOwnGoal = Boolean(goal?.isOwnGoal ?? goal?.IsOwnGoal);
    const playerName = String(goal?.goalGetterName ?? goal?.GoalGetterName ?? '').trim();
    const teamId = side === 'home' ? Number(context.homeId || 0) : Number(context.awayId || 0);
    const teamName = side === 'home' ? String(context.homeName || '') : String(context.awayName || '');

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

  const updatedAt = String(
    match?.lastUpdateDateTime
    ?? match?.LastUpdateDateTime
    ?? match?.matchDateTimeUTC
    ?? match?.MatchDateTimeUTC
    ?? '',
  );

  return {
    available: events.length > 0,
    events,
    reason: events.length ? '' : 'goals_not_available',
    sourceMatchId: Number(match?.matchID ?? match?.MatchID ?? 0) || null,
    updatedAt,
    sourceMeta: {
      provider: 'openligadb',
      label: 'OpenLigaDB',
      attribution: 'OpenLigaDB · ODbL',
    },
  };
}
