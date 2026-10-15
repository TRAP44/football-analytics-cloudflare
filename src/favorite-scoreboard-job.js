// Живое табло любимых команд (Сергей 15.10): одно сообщение на матч, которое
// обновляется весь матч (счёт, минута, перерыв), а после свистка — итог.
//
// Фоновое задание каждые 5 минут, после кривой по ходу матча (она же обновляет
// пакет матчей дня). Своих запросов к источнику данных не делает: берёт идущие
// и только что завершённые матчи из кеша provider-fixtures. Получатели — те, у
// кого команда в избранном и не выключены уведомления о голах (match.goal).
// Новое табло создаётся только для идущего матча; завершённый лишь закрывает
// уже отправленное. Состояние — одна запись кеша на матч.

const RAW_FIXTURES_CACHE_KEY = date => `provider-fixtures:${date}:v1`;
export const SCOREBOARD_CACHE_KEY = fixtureId => `scoreboard:${fixtureId}:v1`;
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN']);
const RECENT_FINAL_MS = 4 * 3600_000;
const BOARD_TTL_MINUTES = 360;
const MAX_MESSAGES_PER_RUN = 600;
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

export function createFavoriteScoreboardJob(deps = {}) {
  const { clock, filterRecipients, getCache, hasSupabase, recordOpsEvent, setCache, supaSelectPaged, telegramApi } = deps;
  for (const [name, fn] of Object.entries({ filterRecipients, getCache, hasSupabase, setCache, supaSelectPaged, telegramApi })) {
    if (typeof fn !== 'function') throw new TypeError(`Favorite scoreboard job requires ${name}.`);
  }
  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  async function fixtures(nowMs, cfg) {
    const dates = [new Date(nowMs).toISOString().slice(0, 10)];
    // Матч, начавшийся до полуночи UTC, лежит во вчерашнем пакете.
    if (new Date(nowMs).getUTCHours() < 4) dates.push(new Date(nowMs - 86400_000).toISOString().slice(0, 10));
    const seen = new Set();
    const result = [];
    for (const date of dates) {
      let cached = null;
      try { cached = plainObject(await getCache(RAW_FIXTURES_CACHE_KEY(date), cfg)); } catch {}
      for (const row of Array.isArray(cached?.fixtures) ? cached.fixtures : []) {
        const match = scoreboardFixture(row, nowMs);
        if (!match || seen.has(match.fixtureId)) continue;
        seen.add(match.fixtureId);
        result.push(match);
        if (result.length >= MAX_FIXTURES) return result;
      }
    }
    return result;
  }

  // Все болельщики постранично (ревью Codex #919: одна выборка ограничена 1000 строк).
  async function fans(teamIds, cfg) {
    const page = plainObject(await supaSelectPaged(cfg, 'favorites', { team_id: `in.(${teamIds.join(',')})` }, {
      pageSize: 1000, maxRows: 10000, order: 'telegram_id.asc',
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
    return rows.filter(row => ids.has(positiveId(row?.telegram_id)));
  }

  async function saveBoards(fixtureId, boards, cfg) {
    try {
      // С requireDurable запись возвращает true только после сохранения в базе.
      return (await setCache(SCOREBOARD_CACHE_KEY(fixtureId), fixtureId, { users: boards, updatedAt: new Date(now()).toISOString() }, cfg, BOARD_TTL_MINUTES, { requireDurable: true })) === true;
    } catch {
      return false;
    }
  }

  async function report(cfg, summary) {
    if (typeof recordOpsEvent !== 'function' || !(summary.sent || summary.edited || summary.failed)) return;
    try {
      await recordOpsEvent(cfg, {
        severity: summary.failed ? 'warning' : 'info',
        source: 'favorite_scoreboard',
        eventType: 'favorite_scoreboard_run',
        code: summary.failed ? 'FAVORITE_SCOREBOARD_PARTIAL' : 'FAVORITE_SCOREBOARD_RUN',
        message: `Живое табло: матчей ${summary.matches}, новых ${summary.sent}, обновлено ${summary.edited}, итогов ${summary.closed}, ошибок ${summary.failed}.`,
        endpoint: 'cron:favorite-scoreboard',
        meta: summary,
      });
    } catch {}
  }

  async function processFavoriteScoreboards(cfg, scheduledAt = new Date()) {
    const summary = { ok: true, matches: 0, recipients: 0, sent: 0, edited: 0, closed: 0, unchanged: 0, blocked: 0, failed: 0, capped: false };
    if (cfg?.favoriteScoreboardEnabled === false) return { ...summary, reason: 'disabled' };
    let storage = false;
    try { storage = hasSupabase(cfg) === true; } catch {}
    if (!storage) return { ...summary, reason: 'storage_unavailable' };

    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt.getTime() : now();
    const matches = await fixtures(at, cfg);
    if (!matches.length) return { ...summary, reason: 'no_matches' };

    let recipients;
    try {
      recipients = await fans([...new Set(matches.flatMap(m => [m.homeId, m.awayId]))], cfg);
    } catch {
      return { ...summary, ok: false, reason: 'favorites_lookup_failed' };
    }
    const usersByTeam = new Map();
    for (const row of recipients) {
      const teamId = positiveId(row?.team_id);
      const userId = positiveId(row?.telegram_id);
      if (!teamId || !userId) continue;
      if (!usersByTeam.has(teamId)) usersByTeam.set(teamId, new Set());
      usersByTeam.get(teamId).add(userId);
    }

    // Очередь работ по всем матчам: сначала новые табло, затем обновления — от
    // давно не обновлявшихся. Так потолок за запуск не съедают одни и те же люди
    // и последние матчи тоже доходят (ревью Codex #919).
    const states = new Map();
    const work = [];
    for (const match of matches) {
      const users = new Set([...(usersByTeam.get(match.homeId) || []), ...(usersByTeam.get(match.awayId) || [])]);
      if (!users.size) continue;
      summary.matches += 1;
      summary.recipients += users.size;
      let state = null;
      try { state = plainObject(await getCache(SCOREBOARD_CACHE_KEY(match.fixtureId), cfg)); } catch {}
      const entry = { match, body: scoreboardText(match), markup: scoreboardKeyboard(match), boards: { ...(plainObject(state?.users) || {}) }, changed: false };
      states.set(match.fixtureId, entry);
      for (const userId of users) {
        const board = plainObject(entry.boards[userId]);
        if (board?.blocked || board?.done || board?.pending) continue;
        if (!board) {
          if (match.live) work.push({ entry, userId, kind: 'new', at: 0 });
          continue;
        }
        if (board.text === entry.body) {
          summary.unchanged += 1;
          continue;
        }
        work.push({ entry, userId, kind: 'edit', at: Number(board.at) || 0 });
      }
    }
    work.sort((x, y) => (x.kind === y.kind ? x.at - y.at : x.kind === 'new' ? -1 : 1));

    let budget = MAX_MESSAGES_PER_RUN;
    for (const item of work) {
      if (budget <= 0) {
        summary.capped = true;
        break;
      }
      budget -= 1;
      const { entry, userId } = item;
      const { match, body, markup, boards } = entry;
      const at = now();
      if (item.kind === 'new') {
        // Отметка «отправляю» сохраняется надёжно ДО отправки: если потом запись не
        // удастся, следующий запуск увидит отметку и не пришлёт второе табло
        // (ревью Codex #919). Не сохранилась отметка — не отправляем вовсе.
        boards[userId] = { pending: true, at };
        if (!await saveBoards(match.fixtureId, boards, cfg)) {
          delete boards[userId];
          summary.failed += 1;
          summary.stopped = 'checkpoint_failed';
          break;
        }
        try {
          const sent = plainObject(await telegramApi('sendMessage', cfg, { chat_id: userId, parse_mode: 'HTML', text: body, reply_markup: markup }));
          const messageId = positiveId(sent?.message_id);
          if (!messageId) throw new Error('sendMessage returned no message_id');
          boards[userId] = { messageId, text: body, at };
          summary.sent += 1;
        } catch (error) {
          const message = String(error?.message || '');
          if (error?.status === 403 || /blocked|deactivated|chat not found/i.test(message)) {
            boards[userId] = { blocked: true, at };
            summary.blocked += 1;
          } else if (error?.code === 'TELEGRAM_REJECTED') {
            // Telegram точно отклонил — сообщения нет, можно попробовать в следующий раз.
            delete boards[userId];
            summary.failed += 1;
          } else {
            // Тайм-аут или сеть: сообщение могло уйти — отметку оставляем, без повтора.
            summary.failed += 1;
          }
        }
        if (!await saveBoards(match.fixtureId, boards, cfg)) {
          summary.failed += 1;
          summary.stopped = 'checkpoint_failed';
          break;
        }
        continue;
      }
      const board = plainObject(boards[userId]) || {};
      try {
        await telegramApi('editMessageText', cfg, { chat_id: userId, message_id: board.messageId, parse_mode: 'HTML', text: body, reply_markup: markup });
        boards[userId] = { ...board, text: body, at, ...(match.final ? { done: true } : {}) };
        if (match.final) summary.closed += 1;
        else summary.edited += 1;
      } catch (error) {
        const message = String(error?.message || '');
        if (/not modified/i.test(message)) {
          boards[userId] = { ...board, text: body, at, ...(match.final ? { done: true } : {}) };
          summary.unchanged += 1;
        } else if (error?.status === 403 || /blocked|deactivated|chat not found/i.test(message)) {
          // Пользователь закрыл бота — больше не пишем ему по этому матчу.
          boards[userId] = { ...board, blocked: true, at };
          summary.blocked += 1;
        } else if (/message to edit not found|can't be edited/i.test(message)) {
          // Сообщение удалено или слишком старое — закрываем табло без новых сообщений.
          boards[userId] = { ...board, done: true, at };
          summary.failed += 1;
        } else {
          summary.failed += 1;
          continue;
        }
      }
      entry.changed = true;
    }
    if (!summary.stopped) {
      for (const entry of states.values()) {
        if (entry.changed && !await saveBoards(entry.match.fixtureId, entry.boards, cfg)) summary.failed += 1;
      }
    }
    summary.ok = summary.failed === 0;
    await report(cfg, summary);
    return summary;
  }

  return Object.freeze({ processFavoriteScoreboards });
}
