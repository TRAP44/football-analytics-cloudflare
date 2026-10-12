// Задача 3 (часть 2, решение Сергея 12.10): оценка 1/X/2 по ходу матча.
//
// Основа — первый предматчевый снимок модели (model_predictions). Из него
// подбираются ожидаемые голы хозяев и гостей за матч (две независимые
// пуассоновские величины), затем считается, как может закончиться матч при
// текущем счёте и оставшемся времени. На 0-й минуте при 0:0 оценка в точности
// равна предматчевой (поправочные множители), к концу матча — сходится к счёту.
//
// Чего модель НЕ учитывает (честно показывается в интерфейсе): красные
// карточки, добавленное время, ход игры (удары, владение), овертайм и пенальти.
// Для дополнительного времени и серии пенальти оценка не строится.

const REGULATION_MINUTES = 90;
const HALF_MINUTES = 45;
const MAX_GOALS = 12;
const LAMBDA_MIN = 0.02;
const LAMBDA_MAX = 6;
// Остаток времени после 90-й минуты, пока судья не свистнул: оценка не
// становится окончательной до финального свистка.
const MIN_REMAINING_MINUTES = 0.5;
const IN_PLAY_STATUSES = new Set(['1H', 'HT', '2H']);
export const IN_PLAY_MODEL_VERSION = 'in-play-poisson-v1';

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function poisson(lambda) {
  const values = new Array(MAX_GOALS + 1);
  let term = Math.exp(-lambda);
  let total = 0;
  for (let k = 0; k <= MAX_GOALS; k += 1) {
    if (k > 0) term = term * lambda / k;
    values[k] = term;
    total += term;
  }
  // Хвост за MAX_GOALS — в последнюю ячейку, чтобы сумма была ровно 1.
  values[MAX_GOALS] += Math.max(0, 1 - total);
  return values;
}

// Вероятности исходов матча (доли 0..1) при счёте и ожидаемых голах до конца.
export function outcomeProbabilities(homeLambda, awayLambda, homeGoals = 0, awayGoals = 0) {
  const home = poisson(Math.max(0, homeLambda));
  const away = poisson(Math.max(0, awayLambda));
  const lead = homeGoals - awayGoals;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let i = 0; i <= MAX_GOALS; i += 1) {
    for (let j = 0; j <= MAX_GOALS; j += 1) {
      const p = home[i] * away[j];
      const diff = lead + i - j;
      if (diff > 0) homeWin += p;
      else if (diff < 0) awayWin += p;
      else draw += p;
    }
  }
  return { home: homeWin, draw, away: awayWin };
}

function bisect(fn, target, low = LAMBDA_MIN, high = LAMBDA_MAX) {
  // fn монотонно растёт по аргументу.
  let a = low;
  let b = high;
  for (let step = 0; step < 50; step += 1) {
    const mid = (a + b) / 2;
    if (fn(mid) < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

// Ожидаемые голы за матч, при которых P(победа хозяев) и P(победа гостей)
// совпадают с предматчевой оценкой. P(хозяева) растёт с голами хозяев,
// P(гости) — с голами гостей: попеременный подбор сходится.
export function fitExpectedGoals(prematch) {
  const home = finite(prematch?.home);
  const away = finite(prematch?.away);
  if (home === null || away === null || home <= 0 || away <= 0 || home + away >= 1) return null;
  let homeLambda = 1.3;
  let awayLambda = 1.1;
  for (let round = 0; round < 30; round += 1) {
    const nextHome = bisect(value => outcomeProbabilities(value, awayLambda).home, home);
    const nextAway = bisect(value => outcomeProbabilities(nextHome, value).away, away);
    const settled = Math.abs(nextHome - homeLambda) < 1e-6 && Math.abs(nextAway - awayLambda) < 1e-6;
    homeLambda = nextHome;
    awayLambda = nextAway;
    if (settled) break;
  }
  return { home: homeLambda, away: awayLambda };
}

function percentSet(values) {
  const total = values.home + values.draw + values.away;
  if (!(total > 0)) return null;
  const keys = ['home', 'draw', 'away'];
  const rounded = Object.fromEntries(keys.map(key => [key, Math.round(values[key] / total * 1000) / 10]));
  // Сумма ровно 100.0: остаток округления — самому вероятному исходу.
  const drift = Math.round((100 - keys.reduce((sum, key) => sum + rounded[key], 0)) * 10) / 10;
  if (drift !== 0) {
    const leader = keys.reduce((best, key) => (values[key] > values[best] ? key : best), 'home');
    rounded[leader] = Math.round((rounded[leader] + drift) * 10) / 10;
  }
  return keys.every(key => rounded[key] >= 0 && rounded[key] <= 100) ? rounded : null;
}

export function matchMinuteFromFixture(status, elapsed, extra = 0) {
  const code = String(status || '').toUpperCase();
  if (code === 'HT') return 45;
  const base = finite(elapsed);
  if (base === null || base < 0 || base > 130) return null;
  const added = Math.max(0, finite(extra) || 0);
  return Math.min(130, base + added);
}

/**
 * Оценка 1/X/2 (проценты, сумма 100) по ходу основного времени матча.
 * prematch — предматчевые проценты модели (сумма 98–102); score — текущий счёт.
 * Возвращает null, если оценку строить нельзя (нет данных, овертайм, пенальти).
 */
export function inPlayProbabilities({ prematch, homeGoals, awayGoals, minute, status } = {}) {
  const code = String(status || '').toUpperCase();
  if (!IN_PLAY_STATUSES.has(code)) return null;
  const values = ['home', 'draw', 'away'].map(key => finite(prematch?.[key]));
  if (values.some(value => value === null || value < 0 || value > 100)) return null;
  const sum = values[0] + values[1] + values[2];
  if (sum < 98 || sum > 102) return null;
  const pre = { home: values[0] / sum, draw: values[1] / sum, away: values[2] / sum };
  if (pre.home <= 0.005 || pre.away <= 0.005 || pre.draw <= 0.005) return null;
  const goalsHome = finite(homeGoals);
  const goalsAway = finite(awayGoals);
  if (goalsHome === null || goalsAway === null || goalsHome < 0 || goalsAway < 0 || goalsHome > 30 || goalsAway > 30) return null;
  if (!Number.isInteger(goalsHome) || !Number.isInteger(goalsAway)) return null;
  const played = finite(minute);
  if (played === null || played < 0 || played > 130) return null;

  const lambdas = fitExpectedGoals(pre);
  if (!lambdas) return null;
  // Множители, с которыми модель на старте (0:0, 0′) равна предматчевой оценке.
  const kickoff = outcomeProbabilities(lambdas.home, lambdas.away);
  const weights = {};
  for (const key of ['home', 'draw', 'away']) {
    if (!(kickoff[key] > 0.001)) return null;
    weights[key] = Math.min(3, Math.max(1 / 3, pre[key] / kickoff[key]));
  }
  // Добавленное время первого тайма не съедает второй тайм: в 1H прогресс
  // основного времени — не больше 45 минут.
  const progress = code === '1H' ? Math.min(played, HALF_MINUTES) : code === 'HT' ? HALF_MINUTES : played;
  const remaining = Math.max(MIN_REMAINING_MINUTES, REGULATION_MINUTES - Math.min(progress, REGULATION_MINUTES));
  const share = remaining / REGULATION_MINUTES;
  const raw = outcomeProbabilities(lambdas.home * share, lambdas.away * share, goalsHome, goalsAway);
  return percentSet({
    home: raw.home * weights.home,
    draw: raw.draw * weights.draw,
    away: raw.away * weights.away,
  });
}
