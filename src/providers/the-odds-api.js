const SPORTS = Object.freeze({
  39: 'soccer_epl',
  40: 'soccer_efl_champ',
  45: 'soccer_fa_cup',
  48: 'soccer_england_efl_cup',
  61: 'soccer_france_ligue_one',
  78: 'soccer_germany_bundesliga',
  79: 'soccer_germany_bundesliga2',
  81: 'soccer_germany_dfb_pokal',
  88: 'soccer_netherlands_eredivisie',
  94: 'soccer_portugal_primeira_liga',
  135: 'soccer_italy_serie_a',
  140: 'soccer_spain_la_liga',
  143: 'soccer_spain_copa_del_rey',
  179: 'soccer_spl',
  203: 'soccer_turkey_super_league',
  253: 'soccer_usa_mls',
  307: 'soccer_saudi_arabia_pro_league',
  1: 'soccer_fifa_world_cup',
  2: 'soccer_uefa_champs_league',
  3: 'soccer_uefa_europa_league',
  848: 'soccer_uefa_europa_conference_league',
});

export function theOddsSportKey(leagueId) {
  return SPORTS[Number(leagueId)] || '';
}

export function theOddsApiUrl(leagueId, { regions = 'eu' } = {}) {
  const sportKey = theOddsSportKey(leagueId);
  if (!sportKey) return '';
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
  url.searchParams.set('regions', regions);
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('dateFormat', 'iso');
  return url.toString();
}

export function normalizeTeamKey(value) {
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

function safeTeamMatch(a, b) {
  const left = normalizeTeamKey(a);
  const right = normalizeTeamKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const short = left.length <= right.length ? left : right;
  const long = short === left ? right : left;
  return short.length >= 7 && long.includes(short);
}

function eventDistanceMs(event, kickoffAt) {
  const a = Date.parse(String(event?.commence_time || ''));
  const b = Date.parse(String(kickoffAt || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b);
}

function findFixtureEvent(events, { homeName, awayName, kickoffAt }) {
  const matches = (Array.isArray(events) ? events : []).filter(event =>
    safeTeamMatch(event?.home_team, homeName)
    && safeTeamMatch(event?.away_team, awayName)
  );
  if (!matches.length) return null;
  matches.sort((a, b) => eventDistanceMs(a, kickoffAt) - eventDistanceMs(b, kickoffAt));
  const best = matches[0];
  const distance = eventDistanceMs(best, kickoffAt);
  if (Number.isFinite(distance) && distance > 36 * 60 * 60 * 1000) return null;
  return best;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function normalizeThree(home, draw, away) {
  const sum = Number(home) + Number(draw) + Number(away);
  if (!(sum > 0)) return null;
  return {
    home: round1(Number(home) / sum * 100),
    draw: round1(Number(draw) / sum * 100),
    away: round1(Number(away) / sum * 100),
  };
}

export function normalizeTheOddsApiMarket(events, context = {}) {
  const event = findFixtureEvent(events, context);
  if (!event) return null;

  const samples = [];
  const updates = [];
  for (const bookmaker of event.bookmakers || []) {
    const market = (bookmaker.markets || []).find(item => item?.key === 'h2h');
    if (!market) continue;
    const outcomes = market.outcomes || [];
    const home = Number(outcomes.find(item => safeTeamMatch(item?.name, event.home_team))?.price);
    const away = Number(outcomes.find(item => safeTeamMatch(item?.name, event.away_team))?.price);
    const draw = Number(outcomes.find(item => /^draw$/i.test(String(item?.name || '').trim()))?.price);
    if (home > 1 && draw > 1 && away > 1) {
      samples.push({ home, draw, away });
      const updatedAt = market.last_update || bookmaker.last_update || '';
      if (Number.isFinite(Date.parse(String(updatedAt)))) updates.push(String(updatedAt));
    }
  }

  if (!samples.length) return null;
  const avg = key => samples.reduce((sum, row) => sum + row[key], 0) / samples.length;
  const odds = {
    home: round1(avg('home')),
    draw: round1(avg('draw')),
    away: round1(avg('away')),
  };
  const probabilities = normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away);
  if (!probabilities) return null;

  updates.sort((a, b) => Date.parse(b) - Date.parse(a));
  return {
    odds,
    probabilities,
    bookmakers: samples.length,
    sources: samples.length,
    provider: 'the-odds-api',
    updatedAt: updates[0] || String(event.commence_time || ''),
    sourceEventId: String(event.id || ''),
    sportKey: String(event.sport_key || ''),
  };
}
