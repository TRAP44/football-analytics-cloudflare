// Изолированный стенд живого табло: кеш, избранное и Telegram в памяти, со
// счётчиками операций. Используется тестами и scripts/scoreboard-capacity-sim.js.
// Ничего не отправляет и не читает из сети.
import { createFavoriteScoreboardJob } from '../src/favorite-scoreboard-job.js';

export const DAY = '2026-10-15';
export const NOW = Date.parse('2026-10-15T19:00:00Z');

export function fixtureRow({ id = 7, status = '1H', elapsed = 10, home = 0, away = 0, homeId = 596, awayId = 558, kickoff = '2026-10-15T18:00:00Z' } = {}) {
  return {
    fixture: { id, date: kickoff, status: { short: status, elapsed } },
    league: { name: 'Premier League' },
    teams: { home: { id: homeId, name: 'Zenit' }, away: { id: awayId, name: 'Spartak Moscow' } },
    goals: { home, away },
  };
}

export function createScoreboardHarness({
  favorites = [],
  allow = rows => rows,
  telegram = null,
  failSaveAt = null,
  maxMessagesPerRun,
  discoveryMaxRows,
  clockStart = NOW,
  sendDelayMs = 0,
  runTimeBudgetMs,
  getWatchSession,
} = {}) {
  const store = new Map();
  const ops = [];
  const sent = [];
  const counters = { telegram: 0, dbReads: 0, dbWrites: 0, dbBytes: 0, favoriteReads: 0 };
  let clock = clockStart;
  let saves = 0;
  let nextMessageId = 1000;
  const job = createFavoriteScoreboardJob({
    getWatchSession,
    clock: () => clock,
    maxMessagesPerRun,
    discoveryMaxRows,
    runTimeBudgetMs,
    filterRecipients: async rows => ({ rows: allow(rows) }),
    getCache: async key => {
      counters.dbReads += 1;
      const value = store.get(key);
      return value === undefined ? null : JSON.parse(JSON.stringify(value));
    },
    hasSupabase: () => true,
    setCache: async (key, _fixtureId, payload, _cfg, _ttl, options) => {
      if (options?.requireDurable !== true) throw new Error('scoreboard writes must be durable');
      saves += 1;
      if (typeof failSaveAt === 'function' ? failSaveAt(saves, key, payload) : failSaveAt === saves) return false;
      const json = JSON.stringify(payload);
      counters.dbWrites += 1;
      counters.dbBytes += json.length;
      store.set(key, JSON.parse(json));
      return true;
    },
    // Как PostgREST: team_id in (...), telegram_id in (...) / gt.X, составной курсор
    // or=(telegram_id.gt.X,and(telegram_id.eq.X,team_id.gt.T)), порядок
    // (telegram_id, team_id), постранично до maxRows с признаком truncated.
    supaSelectPaged: async (_cfg, table, params, options) => {
      if (table !== 'favorites') throw new Error(`unexpected table ${table}`);
      const list = value => new Set(String(value).replace(/^in\.\(|\)$/g, '').split(',').map(Number));
      const teams = list(params.team_id);
      const users = String(params.telegram_id || '').startsWith('in.') ? list(params.telegram_id) : null;
      const after = String(params.telegram_id || '').startsWith('gt.') ? Number(params.telegram_id.slice(3)) : 0;
      const composite = params.or ? String(params.or).match(/^\(telegram_id\.gt\.(\d+),and\(telegram_id\.eq\.\1,team_id\.gt\.(\d+)\)\)$/) : null;
      if (params.or && !composite) throw new Error(`unexpected or filter ${params.or}`);
      if (options.order !== 'telegram_id.asc,team_id.asc') throw new Error(`unexpected order ${options.order}`);
      const rows = favorites
        .filter(row => teams.has(row.team_id) && (!users || users.has(row.telegram_id)) && row.telegram_id > after)
        .filter(row => !composite || row.telegram_id > Number(composite[1]) || (row.telegram_id === Number(composite[1]) && row.team_id > Number(composite[2])))
        .sort((x, y) => x.telegram_id - y.telegram_id || x.team_id - y.team_id);
      const cap = options.maxRows;
      counters.favoriteReads += Math.max(1, Math.ceil(Math.min(rows.length, cap) / options.pageSize));
      return { rows: rows.slice(0, cap), truncated: rows.length > cap };
    },
    telegramApi: async (method, _cfg, payload) => {
      counters.telegram += 1;
      clock += sendDelayMs; // виртуальная задержка Telegram
      if (telegram) {
        const result = await telegram(method, payload, { sent });
        if (result !== undefined) return result;
      }
      if (method === 'sendMessage') {
        const message_id = nextMessageId++;
        sent.push({ chat: payload.chat_id, message_id, text: payload.text });
        return { message_id };
      }
      return true;
    },
    recordOpsEvent: async (_cfg, event) => { ops.push(event); },
  });
  return {
    job, store, ops, sent, counters, favorites,
    setAllow(fn) { allow = fn; },
    setFixtures(rows, { fetchedAt = clock, date = DAY } = {}) {
      store.set(`provider-fixtures:${date}:v1`, { date, fixtures: rows, fetchedAt: new Date(fetchedAt).toISOString() });
    },
    tick(ms = 5 * 60_000) { clock += ms; },
    now: () => clock,
    run(cfg = {}) { return job.processFavoriteScoreboards(cfg, new Date(clock)); },
    board(fixtureId, userId) { return store.get(`scoreboard:${fixtureId}:v1`)?.users?.[userId]; },
  };
}
