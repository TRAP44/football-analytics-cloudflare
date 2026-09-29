export function normalizedSignalText(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

export function buildPersonalContextSignals(favorites = [], history = []) {
  const viewedTeams = new Set();
  const viewedLeagues = new Set();

  for (const item of history.slice(0, 20)) {
    const home = normalizedSignalText(item?.homeName);
    const away = normalizedSignalText(item?.awayName);
    const league = normalizedSignalText(item?.leagueName);
    if (home) viewedTeams.add(home);
    if (away) viewedTeams.add(away);
    if (league) viewedLeagues.add(league);
  }

  return {
    favoriteTeams: new Set(favorites.map(item => Number(item?.teamId || item?.team_id || 0)).filter(id => id > 0)),
    viewedTeams,
    viewedLeagues,
    hasPersonalData: favorites.length > 0 || viewedTeams.size > 0,
  };
}

export function buildPersonalMatchInsight(match = {}, signals = {}) {
  const favoriteTeams = signals.favoriteTeams instanceof Set ? signals.favoriteTeams : new Set();
  const viewedTeams = signals.viewedTeams instanceof Set ? signals.viewedTeams : new Set();
  const viewedLeagues = signals.viewedLeagues instanceof Set ? signals.viewedLeagues : new Set();

  const homeId = Number(match.home?.id || 0);
  const awayId = Number(match.away?.id || 0);
  const homeName = normalizedSignalText(match.home?.name);
  const awayName = normalizedSignalText(match.away?.name);
  const leagueName = normalizedSignalText(match.league || match.leagueOriginal);
  const favorite = favoriteTeams.has(homeId) || favoriteTeams.has(awayId);
  const viewedTeam = viewedTeams.has(homeName) || viewedTeams.has(awayName);
  const viewedLeague = viewedLeagues.has(leagueName);

  let score = Math.min(34, Number(match.interestScore || 0) * .34)
    + Math.min(26, Number(match.competition?.priority || 0) * 3);
  if (favorite) score += 150;
  if (viewedTeam) score += 72;
  else if (viewedLeague) score += 18;
  if (match.live) score += 48;
  if (match.featured) score += 34;
  if (match.lowPriority) score -= 55;
  if (match.youthReserve) score -= 80;

  let reason = '';
  if (favorite) reason = 'Любимая команда';
  else if (viewedTeam) reason = 'Вы смотрели эту команду';
  else if (match.live) reason = 'Сейчас в эфире';
  else if (match.featured) reason = 'Главный матч';
  else if (viewedLeague) reason = 'Знакомый турнир';
  else if (Number(match.interestScore || 0) >= 80) reason = 'Высокий интерес';

  const baseline = Boolean(match.featured)
    || (Number(match.interestScore || 0) >= 68 && !match.lowPriority);
  const recommended = signals.hasPersonalData
    ? Boolean(favorite || viewedTeam || match.live || match.featured || (!match.lowPriority && Number(match.interestScore || 0) >= 74))
    : baseline;

  return { score, reason, favorite, viewedTeam, viewedLeague, recommended };
}

export function pickHomePersonalMatch(matches = [], signals = {}, nowMs = Date.now()) {
  if (!signals.hasPersonalData) return null;

  const rows = matches
    .filter(match => !match.finished && !match.youthReserve)
    .map(match => ({ match, insight: buildPersonalMatchInsight(match, signals) }))
    .filter(item => item.insight.favorite || item.insight.viewedTeam)
    .sort((a, b) => {
      if (Boolean(a.match.live) !== Boolean(b.match.live)) return a.match.live ? -1 : 1;
      const scoreDelta = Number(b.insight.score || 0) - Number(a.insight.score || 0);
      if (scoreDelta) return scoreDelta;

      const aDate = Date.parse(a.match.date || '') || Number.POSITIVE_INFINITY;
      const bDate = Date.parse(b.match.date || '') || Number.POSITIVE_INFINITY;
      const aFuture = aDate >= nowMs ? 0 : 1;
      const bFuture = bDate >= nowMs ? 0 : 1;
      if (aFuture !== bFuture) return aFuture - bFuture;
      return aDate - bDate;
    });

  return rows[0] || null;
}
