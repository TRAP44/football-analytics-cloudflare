// Живое табло любимых команд (Сергей 15.10): одно сообщение на матч, которое
// обновляется весь матч (счёт, минута, перерыв), а после свистка — итог.
//
// Фоновое задание каждые 5 минут, после кривой по ходу матча (она же обновляет
// пакет матчей дня). Своих запросов к источнику данных не делает: берёт идущие
// и только что завершённые матчи из кеша provider-fixtures. Получатели — те, у
// кого команда в избранном и не выключены уведомления о голах (match.goal).
//
// Надёжность (Issue #921, политика — docs/LIVE_SCOREBOARD_RU.md):
// - свежесть: снимок старше SNAPSHOT_MAX_AGE_MS не создаёт и не правит LIVE-табло;
//   снимок не новее уже показанного не откатывает счёт/статус; итог (FT/AET/PEN)
//   закрывает табло и из более старого снимка — итог не меняется;
// - состояния получателя: active (подтверждённое message_id), pending (отметка
//   «отправляю» до sendMessage; если ответ не получен — unknown: без повтора,
//   человек получает обычные уведомления о голах), blocked, done;
// - очередь: сначала итоги, затем поровну правки и новые табло, правки — от давно
//   не обновлявшихся; новые — по возрастанию telegram_id с курсором между запусками;
// - лимиты: не больше MAX_MESSAGES_PER_RUN сообщений и RUN_TIME_BUDGET_MS за
//   запуск; при 429 запуск останавливается до retry_after;
// - одна агрегированная ops-запись за запуск.

const RAW_FIXTURES_CACHE_KEY = date => `provider-fixtures:${date}:v1`;
export const SCOREBOARD_CACHE_KEY = fixtureId => `scoreboard:${fixtureId}:v1`;
export const SCOREBOARD_CURSOR_KEY = 'scoreboard:discovery:v1';
export const SCOREBOARD_PAUSE_KEY = 'scoreboard:pause:v1';
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN']);
const RECENT_FINAL_MS = 4 * 3600_000;
export const SNAPSHOT_MAX_AGE_MS = 10 * 60_000;
const BOARD_TTL_MINUTES = 360;
export const MAX_MESSAGES_PER_RUN = 600;
// Пачка: доля бюджета запуска (600 → 150). Каждая запись переписывает состояние
// матча целиком, поэтому пачки крупные: 2 записи на 150 новых табло.
export const CLAIM_BATCH_SIZE = 150;
const RUN_TIME_BUDGET_MS = 45_000;
const DISCOVERY_PAGE_SIZE = 1000;
const FUTURE_SKEW_MS = 60_000;
const RECHECK_CHUNK = 200;
const DISCOVERY_MAX_ROWS = 10_000;
const MAX_FIXTURES = 120;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function positiveId(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function goals(value) {
  return Number.isInteger(value) && value >= 0 && value <= 99 ? value : null;
}

function text(value, limit = 60) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit) : '';
}

// Короткий отпечаток текста табло: в состоянии храним его, а не весь текст.
export function textHash(value) {
  let hash = 0x811c9dc5;
  for (const ch of String(value)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// Компактная запись получателя: m — message_id, h — отпечаток текста, a — время
// последнего действия, s — 'p' (pending/unknown), 'b' (blocked), 'd' (done),
// 'g' (gone: человек удалил сообщение до конца матча — табло не шлём заново, а
// уведомления о голах возвращаются).
// Старый формат (#919: messageId/text/pending/blocked/done) читается так же.
export function normalizeBoard(value) {
  const source = plainObject(value);
  if (!source) return null;
  const m = positiveId(source.m ?? source.messageId);
  const s = source.s === 'p' || source.pending ? 'p' : source.s === 'b' || source.blocked ? 'b' : source.s === 'g' ? 'g' : source.s === 'd' || source.done ? 'd' : '';
  const h = typeof source.h === 'string' ? source.h : typeof source.text === 'string' ? textHash(source.text) : '';
  const a = Number.isFinite(Number(source.a ?? source.at)) ? Number(source.a ?? source.at) : 0;
  if (!m && !s) return null;
  return { ...(m ? { m } : {}), ...(h ? { h } : {}), a, ...(s ? { s } : {}) };
}

// Подтверждённое работающее табло: есть message_id и оно не заблокировано.
export function boardIsActive(board) {
  return Boolean(board?.m) && board.s !== 'b' && board.s !== 'p' && board.s !== 'g';
}

// Сколько табло считается живым для подавления уведомлений о голе: снимок
// не старше 10 мин + интервал cron 5 мин (аудит 16.10).
export const SUPPRESS_MAX_AGE_MS = SNAPSHOT_MAX_AGE_MS + 5 * 60_000;

export function scoreboardFixture(row, nowMs = Date.now()) {
  const item = plainObject(row) || {};
  const fixture = plainObject(item.fixture) || {};
  const status = plainObject(fixture.status) || {};
  const code = String(status.short || '').toUpperCase();
  const fixtureId = positiveId(fixture.id);
  const teams = plainObject(item.teams) || {};
  const home = plainObject(teams.home) || {};
  const away = plainObject(teams.away) || {};
  const score = plainObject(item.goals) || {};
  const homeGoals = goals(score.home);
  const awayGoals = goals(score.away);
  const live = LIVE_STATUSES.has(code);
  const kickoff = Date.parse(String(fixture.date || ''));
  const final = FINAL_STATUSES.has(code) && Number.isFinite(kickoff) && nowMs - kickoff <= RECENT_FINAL_MS;
  if (!fixtureId || !(live || final) || homeGoals === null || awayGoals === null) return null;
  const homeId = positiveId(home.id);
  const awayId = positiveId(away.id);
  if (!homeId || !awayId || homeId === awayId) return null;
  const elapsed = Number.isInteger(status.elapsed) && status.elapsed >= 0 && status.elapsed <= 150 ? status.elapsed : null;
  const extra = Number.isInteger(status.extra) && status.extra > 0 && status.extra <= 30 ? status.extra : null;
  return {
    fixtureId, code, live, final, elapsed, extra, homeGoals, awayGoals, homeId, awayId,
    homeName: text(home.name) || 'Хозяева',
    awayName: text(away.name) || 'Гости',
    league: text(plainObject(item.league)?.name, 80),
  };
}

// Кому по матчу уже идёт подтверждённое и актуальное табло — им не нужно
// отдельное уведомление о голе. Не входят (получают обычные уведомления):
// pending/unknown (Issue #921), удалённые табло, табло с устаревшим текстом
// (правка отложена) и все табло матча, если свежих данных нет дольше
// SUPPRESS_MAX_AGE_MS — иначе гол терялся бы и в табло, и в уведомлениях.
export async function scoreboardRecipientIds(getCache, fixtureId, cfg, nowMs = Date.now()) {
  const id = positiveId(fixtureId);
  // Табло выключено — обычные уведомления о голах возвращаются (ревью Codex #919).
  if (!id || typeof getCache !== 'function' || cfg?.favoriteScoreboardEnabled === false) return new Set();
  let state = null;
  try { state = plainObject(await getCache(SCOREBOARD_CACHE_KEY(id), cfg)); } catch { return new Set(); }
  const shown = plainObject(state?.shown);
  const current = typeof shown?.h === 'string' ? shown.h : '';
  const freshAt = Number(shown?.f);
  if (!current || !Number.isFinite(freshAt) || nowMs - freshAt > SUPPRESS_MAX_AGE_MS) return new Set();
  return new Set(Object.entries(plainObject(state?.users) || {})
    .filter(([, value]) => {
      const board = normalizeBoard(value);
      return boardIsActive(board) && board.h === current;
    })
    .map(([userId]) => positiveId(Number(userId)))
    .filter(Boolean));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function scoreboardText(match) {
  const head = match.final
    ? `✅ <b>Матч завершён</b>${match.code === 'AET' ? ' · доп. время' : match.code === 'PEN' ? ' · по пенальти' : ''}`
    : match.code === 'HT' ? '⏸ <b>Перерыв</b>'
      : match.code === 'BT' ? '⏸ <b>Перерыв перед доп. временем</b>'
        : match.code === 'P' ? '🔴 <b>Серия пенальти</b>'
          : `🔴 <b>LIVE</b>${match.elapsed !== null ? ` · ${match.elapsed}${match.extra ? `+${match.extra}` : ''}′` : ''}`;
  return [
    head,
    `${escapeHtml(match.homeName)} <b>${match.homeGoals} : ${match.awayGoals}</b> ${escapeHtml(match.awayName)}`,
    match.league ? `<i>${escapeHtml(match.league)}</i>` : '',
    match.final ? '' : '\nСообщение обновляется само — следить можно здесь.',
  ].filter(Boolean).join('\n');
}

function scoreboardKeyboard(match) {
  return { inline_keyboard: [[{ text: match.final ? '📋 Итог AI' : '🧠 AI-оценка матча', callback_data: `match:${match.final ? 'review' : 'menu'}:${match.fixtureId}` }]] };
}

function telegramErrorKind(error) {
  const message = String(error?.message || '');
  if (error?.code === 'TELEGRAM_RATE_LIMIT' || error?.status === 429) return 'rate_limited';
  if (error?.status === 403 || /blocked|deactivated|chat not found/i.test(message)) return 'blocked';
  if (/not modified/i.test(message)) return 'not_modified';
  if (/message to edit not found|can't be edited/i.test(message)) return 'gone';
  // Telegram ответил отказом: сообщение точно не создано.
  if (error?.code === 'TELEGRAM_REJECTED' || (Number(error?.status) >= 400 && Number(error?.status) < 500)) return 'rejected';
  // Тайм-аут, сеть, 5xx: результат неизвестен.
  return 'unknown';
}

export function createFavoriteScoreboardJob(deps = {}) {
  const { clock, filterRecipients, getCache, hasSupabase, recordOpsEvent, setCache, supaSelectPaged, telegramApi } = deps;
  for (const [name, fn] of Object.entries({ filterRecipients, getCache, hasSupabase, setCache, supaSelectPaged, telegramApi })) {
    if (typeof fn !== 'function') throw new TypeError(`Favorite scoreboard job requires ${name}.`);
  }
  const maxMessages = Number.isSafeInteger(deps.maxMessagesPerRun) && deps.maxMessagesPerRun > 0 ? deps.maxMessagesPerRun : MAX_MESSAGES_PER_RUN;
  const timeBudgetMs = Number.isFinite(deps.runTimeBudgetMs) && deps.runTimeBudgetMs > 0 ? deps.runTimeBudgetMs : RUN_TIME_BUDGET_MS;
  const discoveryMaxRows = Number.isSafeInteger(deps.discoveryMaxRows) && deps.discoveryMaxRows > 0 ? deps.discoveryMaxRows : DISCOVERY_MAX_ROWS;
  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  // Матчи из кеша пакета дня + возраст снимка (fetchedAt).
  async function fixtures(nowMs, cfg) {
    const dates = [new Date(nowMs).toISOString().slice(0, 10)];
    // Матч, начавшийся до полуночи UTC, лежит во вчерашнем пакете.
    if (new Date(nowMs).getUTCHours() < 4) dates.push(new Date(nowMs - 86400_000).toISOString().slice(0, 10));
    const seen = new Set();
    const result = [];
    for (const date of dates) {
      let cached = null;
      try { cached = plainObject(await getCache(RAW_FIXTURES_CACHE_KEY(date), cfg)); } catch {}
      const fetchedAt = Date.parse(String(cached?.fetchedAt || ''));
      for (const row of Array.isArray(cached?.fixtures) ? cached.fixtures : []) {
        const match = scoreboardFixture(row, nowMs);
        if (!match || seen.has(match.fixtureId)) continue;
        seen.add(match.fixtureId);
        match.fetchedAt = Number.isFinite(fetchedAt) ? fetchedAt : 0;
        // Время запуска — фактическое (ревью Codex #925): пакет, обновлённый уже после
        // слота cron, свежий; небольшой сдвиг часов вперёд допустим.
        match.fresh = Number.isFinite(fetchedAt) && nowMs - fetchedAt >= -FUTURE_SKEW_MS && nowMs - fetchedAt <= SNAPSHOT_MAX_AGE_MS;
        result.push(match);
        if (result.length >= MAX_FIXTURES) return result;
      }
    }
    return result;
  }

  async function readJson(key, cfg) {
    try { return plainObject(await getCache(key, cfg)); } catch { return null; }
  }

  async function writeJson(key, fixtureId, payload, cfg) {
    try {
      // С requireDurable запись возвращает true только после сохранения в базе.
      return (await setCache(key, fixtureId, payload, cfg, BOARD_TTL_MINUTES, { requireDurable: true })) === true;
    } catch {
      return false;
    }
  }

  // Новые получатели по курсору telegram_id: за запуск не больше DISCOVERY_MAX_ROWS
  // строк избранного; если строк больше (truncated), курсор переносит хвост на
  // следующий запуск — никто не выпадает навсегда.
  // Курсор составной (telegram_id, team_id): telegram_id в favorites не уникален, и
  // граница страницы может разрезать команды одного человека (ревью Codex #925).
  // team = 0 — «все строки этого человека уже прочитаны» (telegram_id gt).
  async function discover(teamIds, cursor, cfg) {
    const params = { team_id: `in.(${teamIds.join(',')})` };
    if (cursor.id > 0 && cursor.team > 0) params.or = `(telegram_id.gt.${cursor.id},and(telegram_id.eq.${cursor.id},team_id.gt.${cursor.team}))`;
    else if (cursor.id > 0) params.telegram_id = `gt.${cursor.id}`;
    const page = plainObject(await supaSelectPaged(cfg, 'favorites', params, {
      pageSize: Math.min(DISCOVERY_PAGE_SIZE, discoveryMaxRows), maxRows: discoveryMaxRows, order: 'telegram_id.asc,team_id.asc',
    }));
    const rows = Array.isArray(page?.rows) ? page.rows : null;
    if (!rows) throw new TypeError('favorites lookup returned an invalid response.');
    // Фильтр уведомлений сводит строки к одной на пользователя — проверяем людей,
    // а все их любимые команды оставляем (ревью Codex #919).
    const byUser = new Map();
    for (const row of rows) {
      const userId = positiveId(row?.telegram_id);
      if (userId && !byUser.has(userId)) byUser.set(userId, { telegram_id: userId });
    }
    const allowed = plainObject(await filterRecipients([...byUser.values()], 'match.goal', cfg));
    const ids = new Set((Array.isArray(allowed?.rows) ? allowed.rows : []).map(row => positiveId(row?.telegram_id)).filter(Boolean));
    const lastRow = rows[rows.length - 1];
    const last = lastRow ? { id: positiveId(lastRow.telegram_id), team: positiveId(lastRow.team_id) } : cursor;
    return { rows: rows.filter(row => ids.has(positiveId(row?.telegram_id))), truncated: page.truncated === true, last };
  }

  // Актуальная проверка получателей уже показанных табло: фильтр уведомлений о
  // голах и избранное по их id (не зависит от курсора и страниц discovery).
  // Возвращает Map(userId → Set(teamId)) или null, если проверить не удалось.
  async function recheckExisting(items, cfg) {
    try {
      const userIds = [...new Set(items.map(item => item.userId))].sort((x, y) => x - y);
      const allowed = plainObject(await filterRecipients(userIds.map(id => ({ telegram_id: id })), 'match.goal', cfg));
      if (!Array.isArray(allowed?.rows)) return null;
      const ids = [...new Set(allowed.rows.map(row => positiveId(row?.telegram_id)).filter(Boolean))].sort((x, y) => x - y);
      const teams = [...new Set(items.flatMap(item => [item.entry.match.homeId, item.entry.match.awayId]))].sort((x, y) => x - y);
      const result = new Map();
      for (let i = 0; i < ids.length; i += RECHECK_CHUNK) {
        const chunk = ids.slice(i, i + RECHECK_CHUNK);
        const page = plainObject(await supaSelectPaged(cfg, 'favorites', {
          telegram_id: `in.(${chunk.join(',')})`, team_id: `in.(${teams.join(',')})`,
        }, { pageSize: DISCOVERY_PAGE_SIZE, maxRows: DISCOVERY_MAX_ROWS, order: 'telegram_id.asc,team_id.asc' }));
        if (!Array.isArray(page?.rows) || page.truncated === true) return null;
        for (const row of page.rows) {
          const userId = positiveId(row?.telegram_id);
          const teamId = positiveId(row?.team_id);
          if (!userId || !teamId) continue;
          if (!result.has(userId)) result.set(userId, new Set());
          result.get(userId).add(teamId);
        }
      }
      return result;
    } catch {
      return null;
    }
  }

  async function report(cfg, summary) {
    if (typeof recordOpsEvent !== 'function') return;
    const activity = summary.sent + summary.edited + summary.closed + summary.failed + summary.unknown + summary.deferred + summary.staleSkipped;
    if (!activity) return;
    try {
      await recordOpsEvent(cfg, {
        severity: summary.failed || summary.unknown ? 'warning' : 'info',
        source: 'favorite_scoreboard',
        eventType: 'favorite_scoreboard_run',
        code: summary.failed || summary.unknown ? 'FAVORITE_SCOREBOARD_PARTIAL' : 'FAVORITE_SCOREBOARD_RUN',
        message: `Живое табло: матчей ${summary.matches}, новых ${summary.sent}, обновлено ${summary.edited}, итогов ${summary.closed}, `
          + `без изменений ${summary.unchanged}, отложено ${summary.deferred}, устаревший снимок ${summary.staleSkipped}, `
          + `неизвестно ${summary.unknown}, ошибок ${summary.failed}${summary.stopped ? `, остановка: ${summary.stopped}` : ''}.`,
        endpoint: 'cron:favorite-scoreboard',
        meta: summary,
      });
    } catch {}
  }

  async function processFavoriteScoreboards(cfg, scheduledAt = new Date()) {
    const summary = {
      ok: true, matches: 0, recipients: 0, sent: 0, edited: 0, closed: 0, unchanged: 0, blocked: 0,
      failed: 0, unknown: 0, unknownPending: 0, optedOut: 0, deferred: 0, staleSkipped: 0, staleMatches: 0, capped: false, stopped: '',
      oldestWaitSec: 0, discovery: { cursor: 0, next: 0, truncated: false }, telegramCalls: 0, dbWrites: 0,
    };
    if (cfg?.favoriteScoreboardEnabled === false) return { ...summary, reason: 'disabled' };
    let storage = false;
    try { storage = hasSupabase(cfg) === true; } catch {}
    if (!storage) return { ...summary, reason: 'storage_unavailable' };

    const startedAt = now();
    // Свежесть и паузы — по фактическому времени, а не по слоту cron (ревью Codex #925).
    const at = startedAt;
    void scheduledAt;

    // Лимит Telegram (429) из прошлого запуска ещё действует — ждём.
    const pause = await readJson(SCOREBOARD_PAUSE_KEY, cfg);
    if (Number(pause?.until) > at) return { ...summary, reason: 'rate_limit_pause' };

    const matches = await fixtures(at, cfg);
    if (!matches.length) return { ...summary, reason: 'no_matches' };

    // Состояние матчей: подтверждённые табло правятся по нему, без выборки избранного.
    const states = new Map();
    for (const match of matches) {
      const state = await readJson(SCOREBOARD_CACHE_KEY(match.fixtureId), cfg);
      const boards = {};
      for (const [userId, value] of Object.entries(plainObject(state?.users) || {})) {
        const board = normalizeBoard(value);
        if (board && positiveId(Number(userId))) boards[userId] = board;
      }
      const shown = plainObject(state?.shown);
      const body = scoreboardText(match);
      states.set(match.fixtureId, {
        match, boards, body, hash: textHash(body), markup: scoreboardKeyboard(match),
        shown: shown
          ? { f: Number(shown.f) || 0, final: shown.final === true, ...(typeof shown.h === 'string' ? { h: shown.h } : {}) }
          : { f: 0, final: false },
        changed: false,
      });
    }

    // Можно ли показывать этот снимок: свежий; не старше уже показанного; итог
    // не меняется на LIVE. Итог закрывает табло и из более старого снимка.
    const usable = entry => {
      const { match, shown } = entry;
      if (shown.final && !match.final) return false;
      if (match.final) return true;
      return match.fresh && match.fetchedAt >= shown.f;
    };

    // Новые получатели — только для свежих LIVE-матчей.
    const liveTeams = [...new Set(matches.filter(m => m.live && m.fresh).flatMap(m => [m.homeId, m.awayId]))].sort((x, y) => x - y);
    const teamsKey = textHash(liveTeams.join(','));
    const cursorState = await readJson(SCOREBOARD_CURSOR_KEY, cfg);
    const cursor = cursorState?.teams === teamsKey
      ? { id: positiveId(cursorState.after), team: positiveId(cursorState.afterTeam) }
      : { id: 0, team: 0 };
    summary.discovery.cursor = cursor.id;
    const usersByTeam = new Map();
    let discovery = { rows: [], truncated: false, last: cursor };
    if (liveTeams.length) {
      try {
        discovery = await discover(liveTeams, cursor, cfg);
      } catch {
        summary.failed += 1;
        summary.stopped = 'favorites_lookup_failed';
      }
    }
    summary.discovery.truncated = discovery.truncated;
    for (const row of discovery.rows) {
      const teamId = positiveId(row?.team_id);
      const userId = positiveId(row?.telegram_id);
      if (!teamId || !userId) continue;
      if (!usersByTeam.has(teamId)) usersByTeam.set(teamId, new Set());
      usersByTeam.get(teamId).add(userId);
    }

    // Очереди: итоги (закрыть табло после свистка), правки, новые табло.
    const closings = [];
    const edits = [];
    const news = [];
    for (const entry of states.values()) {
      const { match, boards, hash } = entry;
      const show = usable(entry);
      if (!show) {
        const waiting = Object.values(boards).filter(b => boardIsActive(b) && b.s !== 'd' && b.h !== hash).length;
        if (waiting) {
          summary.staleSkipped += waiting;
          summary.staleMatches += 1;
        }
      }
      // Актуальный текст и время снимка — для подавления уведомлений о голе: табло
      // считается живым, пока данные свежие, даже если текст не менялся (перерыв).
      if (show && Object.values(boards).some(boardIsActive)
        && (entry.shown.h !== hash || match.fetchedAt > entry.shown.f)) {
        entry.shown = { ...entry.shown, h: hash, f: Math.max(entry.shown.f, match.fetchedAt) };
        entry.changed = true;
      }
      const users = new Set([...(usersByTeam.get(match.homeId) || []), ...(usersByTeam.get(match.awayId) || [])]);
      if (Object.keys(boards).length || users.size) summary.matches += 1;
      summary.recipients += new Set([...users, ...Object.keys(boards).map(Number)]).size;
      for (const [userId, board] of Object.entries(boards)) {
        if (!boardIsActive(board) || board.s === 'd') {
          if (board.s === 'p') summary.unknownPending += 1;
          continue;
        }
        if (board.h === hash) {
          // Итог уже показан — табло закрыто.
          if (match.final && show) { boards[userId] = { ...board, s: 'd' }; entry.changed = true; }
          else summary.unchanged += 1;
          continue;
        }
        if (!show) continue;
        (match.final ? closings : edits).push({ entry, userId: Number(userId), a: board.a || 0 });
      }
      if (match.live && show) {
        for (const userId of users) {
          if (!boards[userId]) news.push({ entry, userId });
        }
      }
    }
    closings.sort((x, y) => x.a - y.a);
    edits.sort((x, y) => x.a - y.a);
    news.sort((x, y) => x.entry.match.fixtureId - y.entry.match.fixtureId || x.userId - y.userId);

    // Уже показанные табло правим, только если человек по-прежнему получает
    // уведомления о голах и держит команду матча в избранном (ревью Codex #925).
    // Проверяются те, до кого дойдёт этот запуск; остальные — в хвосте.
    const overflow = [...closings.splice(maxMessages), ...edits.splice(Math.max(0, maxMessages - closings.length))];
    const existing = [...closings, ...edits];
    if (existing.length) {
      const keep = await recheckExisting(existing, cfg);
      if (!keep) {
        // Проверить не удалось — правки откладываем, без отправки.
        overflow.push(...existing);
        closings.length = 0;
        edits.length = 0;
        summary.failed += 1;
        summary.recheckFailed = true;
      } else {
        const stillFan = item => keep.get(item.userId)?.has(item.entry.match.homeId) || keep.get(item.userId)?.has(item.entry.match.awayId);
        for (const list of [closings, edits]) {
          const kept = list.filter(item => {
            if (stillFan(item)) return true;
            // Отписался от голов или убрал команду: табло больше не трогаем.
            const board = item.entry.boards[item.userId];
            item.entry.boards[item.userId] = { ...board, s: 'd' };
            item.entry.changed = true;
            summary.optedOut += 1;
            return false;
          });
          list.splice(0, list.length, ...kept);
        }
      }
    }

    // Порядок: все итоги, затем поровну пачки правок и пачки новых табло (пачка
    // новых — один матч, чтобы отметки сохранялись одной записью).
    const chunkSize = Math.max(1, Math.min(CLAIM_BATCH_SIZE, Math.ceil(maxMessages / 4)));
    const chunks = (items, sameEntry) => {
      const result = [];
      for (const item of items) {
        const last = result[result.length - 1];
        if (last && last.length < chunkSize && (!sameEntry || last[0].entry === item.entry)) last.push(item);
        else result.push([item]);
      }
      return result;
    };
    const editChunks = chunks(edits.map(item => ({ ...item, kind: 'edit' })), false);
    const newChunks = chunks(news.map(item => ({ ...item, kind: 'new' })), true);
    const queue = closings.map(item => ({ ...item, kind: 'close' }));
    for (let i = 0; i < Math.max(editChunks.length, newChunks.length); i += 1) {
      if (i < editChunks.length) queue.push(...editChunks[i]);
      if (i < newChunks.length) queue.push(...newChunks[i]);
    }

    let budget = maxMessages;
    // Новые, которых Telegram точно не принял или до которых не дошли, — для курсора.
    const retryNew = [];
    const markRateLimit = async error => {
      const seconds = Number(error?.retryAfter);
      // retry_after отсчитывается от ответа Telegram, а не от начала запуска (аудит 16.10).
      const limitedAt = now();
      const until = limitedAt + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : 60_000);
      summary.stopped = 'rate_limited';
      summary.retryAfterSec = Math.round((until - limitedAt) / 1000);
      if (await writeJson(SCOREBOARD_PAUSE_KEY, 0, { until }, cfg)) summary.dbWrites += 1;
    };
    const saveEntry = async entry => {
      const ok = await writeJson(SCOREBOARD_CACHE_KEY(entry.match.fixtureId), entry.match.fixtureId, {
        users: entry.boards, shown: entry.shown, updatedAt: new Date(now()).toISOString(),
      }, cfg);
      if (ok) summary.dbWrites += 1;
      return ok;
    };

    let index = 0;
    let unsentClaims = 0;
    while (index < queue.length && !summary.stopped && !summary.capped) {
      if (budget <= 0 || now() - startedAt > timeBudgetMs) {
        summary.capped = true;
        break;
      }
      const item = queue[index];
      const { entry } = item;
      const { match, boards, body, hash, markup } = entry;

      if (item.kind === 'new') {
        // Пакет новых табло одного матча: отметки «отправляю» сохраняются одной
        // надёжной записью ДО отправки (Issue #921: меньше записей в базу).
        const batch = [];
        while (index < queue.length && batch.length < Math.min(chunkSize, budget)
          && queue[index].kind === 'new' && queue[index].entry === entry) {
          batch.push(queue[index].userId);
          index += 1;
        }
        const claimedAt = now();
        for (const userId of batch) boards[userId] = { a: claimedAt, s: 'p' };
        if (!await saveEntry(entry)) {
          for (const userId of batch) delete boards[userId];
          // Отметки не сохранились — ничего не отправлено; эти люди остаются в
          // очереди, курсор их не пропускает (аудит 16.10).
          retryNew.push(...batch);
          unsentClaims += batch.length;
          summary.failed += 1;
          summary.stopped = 'checkpoint_failed';
          break;
        }
        for (const userId of batch) {
          // Дедлайн проверяется перед каждой отправкой (ревью Codex #925).
          if (!summary.stopped && now() - startedAt > timeBudgetMs) summary.capped = true;
          if (summary.stopped || summary.capped) {
            // Отметки, до которых не дошли, снимаем и сохраняем ниже — человек
            // получит табло в следующем запуске (курсор вернётся к нему).
            delete boards[userId];
            retryNew.push(userId);
            unsentClaims += 1;
            continue;
          }
          budget -= 1;
          summary.telegramCalls += 1;
          try {
            const sent = plainObject(await telegramApi('sendMessage', cfg, { chat_id: userId, parse_mode: 'HTML', text: body, reply_markup: markup }));
            const messageId = positiveId(sent?.message_id);
            if (!messageId) throw Object.assign(new Error('sendMessage returned no message_id'), { code: 'TELEGRAM_UNKNOWN' });
            boards[userId] = { m: messageId, h: hash, a: now() };
            summary.sent += 1;
          } catch (error) {
            const kind = telegramErrorKind(error);
            if (kind === 'blocked') {
              boards[userId] = { a: now(), s: 'b' };
              summary.blocked += 1;
            } else if (kind === 'rejected' || kind === 'rate_limited') {
              // Telegram точно не принял — отметку снимаем, повторим позже.
              delete boards[userId];
              retryNew.push(userId);
              summary.failed += 1;
              if (kind === 'rate_limited') await markRateLimit(error);
            } else {
              // Неизвестно, ушло ли сообщение: без повтора (иначе возможен дубль),
              // человек получает обычные уведомления о голах по этому матчу.
              summary.unknown += 1;
            }
          }
        }
        entry.shown = { f: Math.max(entry.shown.f, match.fetchedAt), final: entry.shown.final || match.final, h: hash };
        if (!await saveEntry(entry)) {
          summary.failed += 1;
          summary.stopped = 'checkpoint_failed';
        }
        continue;
      }

      index += 1;
      budget -= 1;
      summary.telegramCalls += 1;
      const board = boards[item.userId];
      try {
        await telegramApi('editMessageText', cfg, { chat_id: item.userId, message_id: board.m, parse_mode: 'HTML', text: body, reply_markup: markup });
        boards[item.userId] = { m: board.m, h: hash, a: now(), ...(match.final ? { s: 'd' } : {}) };
        if (match.final) summary.closed += 1;
        else summary.edited += 1;
      } catch (error) {
        const kind = telegramErrorKind(error);
        if (kind === 'not_modified') {
          boards[item.userId] = { m: board.m, h: hash, a: now(), ...(match.final ? { s: 'd' } : {}) };
          summary.unchanged += 1;
        } else if (kind === 'blocked') {
          boards[item.userId] = { ...board, a: now(), s: 'b' };
          summary.blocked += 1;
        } else if (kind === 'gone') {
          // Человек удалил сообщение: нового табло не шлём, но и уведомления о
          // голах ему возвращаются (до аудита 16.10 он терял их до конца матча).
          boards[item.userId] = { ...board, a: now(), s: match.final ? 'd' : 'g' };
          summary.gone = (summary.gone || 0) + 1;
        } else {
          // Правку можно безопасно повторить в следующем запуске.
          summary.failed += 1;
          unsentClaims += 1;
          if (kind === 'rate_limited') await markRateLimit(error);
          continue;
        }
      }
      entry.shown = { f: Math.max(entry.shown.f, match.fetchedAt), final: entry.shown.final || match.final, h: hash };
      entry.changed = true;
    }

    // Отложенное: не дошедшие в этом запуске правки/итоги/новые и самое долгое ожидание.
    const rest = queue.slice(index);
    summary.deferred = rest.length + unsentClaims + overflow.length;
    const waits = [...rest, ...overflow].filter(item => item.kind !== 'new' && item.a).map(item => Math.round((at - item.a) / 1000));
    summary.oldestWaitSec = waits.length ? Math.max(...waits) : 0;

    if (summary.stopped !== 'checkpoint_failed') {
      for (const entry of states.values()) {
        if (entry.changed && !await saveEntry(entry)) summary.failed += 1;
      }
    }

    // Курсор новых получателей: до первого необработанного нового (по telegram_id),
    // иначе — до конца прочитанной части; хвост за пределами выборки — в следующий раз.
    if (liveTeams.length && summary.stopped !== 'favorites_lookup_failed') {
      const pendingNew = [...rest.filter(item => item.kind === 'new').map(item => item.userId), ...retryNew];
      let next = { id: 0, team: 0 };
      // Необработанный новый — перечитываем все его строки (gt id-1); табло, что уже
      // есть, повторно не создаются.
      if (pendingNew.length) next = { id: Math.min(...pendingNew) - 1, team: 0 };
      else if (discovery.truncated) next = discovery.last;
      summary.discovery.next = next.id;
      if (next.id !== cursor.id || next.team !== cursor.team || cursorState?.teams !== teamsKey) {
        if (await writeJson(SCOREBOARD_CURSOR_KEY, 0, { teams: teamsKey, after: next.id, afterTeam: next.team }, cfg)) summary.dbWrites += 1;
      }
    }

    summary.ok = summary.failed === 0;
    await report(cfg, summary);
    return summary;
  }

  return Object.freeze({ processFavoriteScoreboards });
}
