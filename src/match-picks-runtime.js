// «Обыграй AI» (решение Сергея 12.10): пользователь до начала матча выбирает
// исход 1/X/2, AI «играет» своим предматчевым прогнозом — самым вероятным
// исходом первого снимка модели (model_predictions.predicted_outcome).
// Очко — за угаданный исход. Итоги — из уже рассчитанных результатов модели
// (model_predictions.status = 'settled', actual_outcome): отдельного расчёта нет.
// Играть можно только в матчах с предматчевым прогнозом модели. Без денег и
// без ставочных формулировок. В таблице лидеров — только имя из Telegram.

export const PICK_OUTCOMES = Object.freeze(['home', 'draw', 'away']);
export const LEADERBOARD_DAYS = 30;
const LEADERBOARD_TOP = 10;
const PICKS_PAGE = 1000;
const MAX_PICKS_SCAN = 20000;
// Итог засчитывается только после проверки финальности (ревью Codex #864):
// первичный settled может быть «unverified» или «drift».
const TRUSTED_SETTLEMENT = Object.freeze(['confirmed', 'adjudicated']);
const PREDICTION_CHUNK = 200;
const MAX_BODY_CHARS = 500;
const NAME_MAX = 32;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeRead(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function positiveId(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function outcome(value) {
  return PICK_OUTCOMES.includes(value) ? value : null;
}

function goals(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= 30 ? number : null;
}

function label(value, max = 60) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Вероятность выбранного AI исхода из того же предматчевого снимка (сумма 98–102), иначе null. */
export function aiPickProbability(model, ai) {
  const values = ['home_prob', 'draw_prob', 'away_prob'].map(key => {
    const raw = safeRead(model, key);
    return raw === null || raw === undefined || raw === '' || typeof raw === 'boolean' ? NaN : Number(raw);
  });
  if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  const sum = values[0] + values[1] + values[2];
  if (sum < 98 || sum > 102) return null;
  const index = PICK_OUTCOMES.indexOf(ai);
  return index >= 0 ? Math.round(values[index]) : null;
}

/** Имя для таблицы: только first_name, без управляющих символов и ссылок. */
export function publicPlayerName(value) {
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/https?:\/\/\S+|t\.me\/\S+|@\w+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? Array.from(text).slice(0, NAME_MAX).join('') : 'Игрок';
}

/**
 * Счёт игроков по прогнозам и итогам модели.
 * picks — [{telegram_id, fixture_id, pick}], settled — Map fixtureId → {predicted, actual}.
 */
export function scorePicks(picks = [], settled = new Map()) {
  const players = new Map();
  for (const row of Array.isArray(picks) ? picks : []) {
    const userId = positiveId(safeRead(row, 'telegram_id'));
    const fixtureId = positiveId(safeRead(row, 'fixture_id'));
    const pick = outcome(safeRead(row, 'pick'));
    const result = settled.get(fixtureId);
    if (!userId || !fixtureId || !pick || !result) continue;
    const entry = players.get(userId) || { userId, points: 0, played: 0, aiPoints: 0 };
    entry.played += 1;
    if (pick === result.actual) entry.points += 1;
    if (result.predicted === result.actual) entry.aiPoints += 1;
    players.set(userId, entry);
  }
  // Больше очков выше; при равенстве — меньше сыгранных матчей (точнее), затем id.
  return [...players.values()].sort((a, b) => b.points - a.points || a.played - b.played || a.userId - b.userId);
}

export function createMatchPicksRuntime(deps = {}) {
  const { clock, hasSupabase, json, supaSelectMany, supaUpsert } = deps;
  for (const [name, fn] of Object.entries({ hasSupabase, json, supaSelectMany, supaUpsert })) {
    if (typeof fn !== 'function') throw new TypeError(`Match picks runtime requires ${name}.`);
  }
  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  function storageReady(cfg) {
    try {
      return hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  async function readBody(request) {
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return null;
      return plainObject(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async function prediction(fixtureId, cfg) {
    const rows = await supaSelectMany(cfg, 'model_predictions', { fixture_id: `eq.${fixtureId}` }, {
      limit: 1,
      select: 'fixture_id,kickoff_at,status,predicted_outcome,actual_outcome,settlement_verification_state,'
        + 'home_name,away_name,league_name,home_prob,draw_prob,away_prob,actual_home_goals,actual_away_goals',
    });
    return plainObject(Array.isArray(rows) ? rows[0] : null);
  }

  function pickState(model, pickRow, nowMs) {
    const kickoffMs = Date.parse(String(safeRead(model, 'kickoff_at') || ''));
    const finished = safeRead(model, 'status') === 'settled';
    const settled = finished
      && TRUSTED_SETTLEMENT.includes(safeRead(model, 'settlement_verification_state'))
      && outcome(safeRead(model, 'actual_outcome'));
    const open = !finished && Number.isFinite(kickoffMs) && kickoffMs > nowMs;
    const pick = outcome(safeRead(pickRow, 'pick'));
    const ai = outcome(safeRead(model, 'predicted_outcome'));
    const actual = settled ? outcome(safeRead(model, 'actual_outcome')) : null;
    return {
      available: true,
      fixtureId: positiveId(safeRead(model, 'fixture_id')),
      open,
      kickoffAt: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null,
      pick,
      ai,
      verifying: finished && !actual,
      result: actual ? {
        actual,
        userPoint: pick ? (pick === actual ? 1 : 0) : null,
        aiPoint: ai === actual ? 1 : 0,
        // Для карточки «AI угадал» — только проверенные данные того же снимка.
        score: goals(safeRead(model, 'actual_home_goals')) !== null && goals(safeRead(model, 'actual_away_goals')) !== null
          ? { home: goals(safeRead(model, 'actual_home_goals')), away: goals(safeRead(model, 'actual_away_goals')) }
          : null,
        aiProbability: aiPickProbability(model, ai),
        homeName: label(safeRead(model, 'home_name')),
        awayName: label(safeRead(model, 'away_name')),
        league: label(safeRead(model, 'league_name'), 80),
      } : null,
    };
  }

  // GET /api/match-pick?fixtureId= — прогноз пользователя, выбор AI и итог.
  async function apiMatchPickGet(request, cfg, user) {
    const userId = positiveId(safeRead(user, 'id'));
    if (!userId) return json({ error: 'Сессия Telegram не подтверждена.', code: 'AUTH_REQUIRED' }, 401);
    let fixtureId = 0;
    try {
      fixtureId = positiveId(new URL(request.url).searchParams.get('fixtureId'));
    } catch {
      fixtureId = 0;
    }
    if (!fixtureId) return json({ error: 'Номер матча обязателен.', code: 'FIXTURE_REQUIRED' }, 400);
    if (!storageReady(cfg)) return json({ available: false, reason: 'storage_unavailable' });
    try {
      const model = await prediction(fixtureId, cfg);
      if (!model || !outcome(safeRead(model, 'predicted_outcome'))) return json({ available: false, reason: 'no_model_prediction', fixtureId });
      const picks = await supaSelectMany(cfg, 'match_picks', { telegram_id: `eq.${userId}`, fixture_id: `eq.${fixtureId}` }, { limit: 1, select: 'pick' });
      return json(pickState(model, Array.isArray(picks) ? picks[0] : null, now()));
    } catch {
      return json({ available: false, reason: 'temporarily_unavailable' }, 503);
    }
  }

  // POST /api/match-pick {fixtureId, pick} — до начала матча, можно изменить.
  async function apiMatchPickSave(request, cfg, user) {
    const userId = positiveId(safeRead(user, 'id'));
    if (!userId) return json({ error: 'Сессия Telegram не подтверждена.', code: 'AUTH_REQUIRED' }, 401);
    const body = await readBody(request);
    if (!body) return json({ error: 'Неверный запрос.', code: 'BAD_REQUEST' }, 400);
    const fixtureId = positiveId(body.fixtureId);
    const pick = outcome(body.pick);
    if (!fixtureId || !pick) return json({ error: 'Выберите исход: победа хозяев, ничья или победа гостей.', code: 'PICK_INVALID' }, 400);
    if (!storageReady(cfg)) return json({ error: 'Прогнозы временно недоступны.', code: 'STORAGE_UNAVAILABLE' }, 503);
    try {
      const model = await prediction(fixtureId, cfg);
      if (!model || !outcome(safeRead(model, 'predicted_outcome'))) {
        return json({ error: 'В этом матче AI не делал прогноз до начала — сыграть с ним не получится.', code: 'NO_MODEL_PREDICTION' }, 409);
      }
      const nowMs = now();
      const state = pickState(model, null, nowMs);
      if (!state.open) {
        // Показываем уже сохранённый прогноз, а не «нет прогноза».
        const existing = await supaSelectMany(cfg, 'match_picks', { telegram_id: `eq.${userId}`, fixture_id: `eq.${fixtureId}` }, { limit: 1, select: 'pick' }).catch(() => []);
        return json({ error: 'Матч уже начался — прогноз больше не меняется.', code: 'PICK_LOCKED', ...pickState(model, Array.isArray(existing) ? existing[0] : null, nowMs) }, 409);
      }
      await supaUpsert(cfg, 'match_picks', {
        telegram_id: userId,
        fixture_id: fixtureId,
        pick,
        kickoff_at: state.kickoffAt,
        updated_at: new Date(nowMs).toISOString(),
      }, 'telegram_id,fixture_id');
      return json({ ...state, pick, saved: true });
    } catch {
      return json({ error: 'Не удалось сохранить прогноз. Попробуйте ещё раз.', code: 'PICK_SAVE_FAILED' }, 503);
    }
  }

  async function settledFor(fixtureIds, cfg) {
    const result = new Map();
    const ids = [...new Set(fixtureIds.map(positiveId).filter(Boolean))];
    for (let index = 0; index < ids.length; index += PREDICTION_CHUNK) {
      const part = ids.slice(index, index + PREDICTION_CHUNK);
      const rows = await supaSelectMany(cfg, 'model_predictions', {
        fixture_id: `in.(${part.join(',')})`,
        status: 'eq.settled',
        settlement_verification_state: `in.(${TRUSTED_SETTLEMENT.join(',')})`,
      }, {
        limit: part.length,
        select: 'fixture_id,predicted_outcome,actual_outcome',
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        const fixtureId = positiveId(safeRead(row, 'fixture_id'));
        const predicted = outcome(safeRead(row, 'predicted_outcome'));
        const actual = outcome(safeRead(row, 'actual_outcome'));
        if (fixtureId && predicted && actual) result.set(fixtureId, { predicted, actual });
      }
    }
    return result;
  }

  // GET /api/picks-leaderboard — таблица за 30 дней и счёт «вы против AI».
  async function apiPicksLeaderboard(request, cfg, user) {
    const userId = positiveId(safeRead(user, 'id'));
    if (!userId) return json({ error: 'Сессия Telegram не подтверждена.', code: 'AUTH_REQUIRED' }, 401);
    if (!storageReady(cfg)) return json({ available: false, reason: 'storage_unavailable' });
    try {
      const since = new Date(now() - LEADERBOARD_DAYS * 86400_000).toISOString();
      // Все прогнозы окна, страницами (ревью Codex #864): без молчаливого
      // обрезания старых прогнозов. Порядок стабильный — по первичному ключу.
      const rows = [];
      let truncated = false;
      for (let offset = 0; ; offset += PICKS_PAGE) {
        if (offset >= MAX_PICKS_SCAN) { truncated = true; break; }
        const page = await supaSelectMany(cfg, 'match_picks', { kickoff_at: `gte.${since}`, offset: String(offset) }, {
          limit: PICKS_PAGE,
          order: 'telegram_id.asc,fixture_id.asc',
          select: 'telegram_id,fixture_id,pick',
        });
        const list = Array.isArray(page) ? page : [];
        rows.push(...list);
        if (list.length < PICKS_PAGE) break;
      }
      const settled = await settledFor(rows.map(row => safeRead(row, 'fixture_id')), cfg);
      const ranking = scorePicks(rows, settled);
      const top = ranking.slice(0, LEADERBOARD_TOP);
      const myIndex = ranking.findIndex(entry => entry.userId === userId);
      const mine = myIndex >= 0 ? ranking[myIndex] : null;
      const pending = rows.filter(row => positiveId(safeRead(row, 'telegram_id')) === userId && !settled.has(positiveId(safeRead(row, 'fixture_id')))).length;

      const nameIds = top.map(entry => entry.userId);
      const names = new Map();
      if (nameIds.length) {
        const users = await supaSelectMany(cfg, 'users', { telegram_id: `in.(${nameIds.join(',')})` }, {
          limit: nameIds.length,
          select: 'telegram_id,first_name',
        });
        for (const row of Array.isArray(users) ? users : []) names.set(positiveId(safeRead(row, 'telegram_id')), publicPlayerName(safeRead(row, 'first_name')));
      }
      return json({
        available: true,
        periodDays: LEADERBOARD_DAYS,
        truncated,
        top: top.map((entry, index) => ({
          rank: index + 1,
          name: names.get(entry.userId) || 'Игрок',
          points: entry.points,
          played: entry.played,
          me: entry.userId === userId,
        })),
        me: {
          rank: mine ? myIndex + 1 : null,
          points: mine ? mine.points : 0,
          played: mine ? mine.played : 0,
          aiPoints: mine ? mine.aiPoints : 0,
          pending,
        },
      });
    } catch {
      return json({ available: false, reason: 'temporarily_unavailable' }, 503);
    }
  }

  return Object.freeze({ apiMatchPickGet, apiMatchPickSave, apiPicksLeaderboard });
}
