// Задача 5: объяснение матча простыми словами (Cloudflare Workers AI).
//
// Принцип: выдумать число или вывод невозможно.
// - Сервер собирает каталог фактов из провалидированного анализа: у факта ID,
//   роль (lead / support / risk / caveat) и каноническая формулировка по шаблону.
//   Тексты и роли пишет только сервер.
// - LLM получает каталог и возвращает только упорядоченный список factIds.
//   Любой другой ответ отбрасывается целиком → порядок по умолчанию (без LLM).
// - Итоговый текст собирается детерминированно: связка по роли + формулировка факта.

import { claimDailyBudget } from './daily-budget-claim.js';

export const EXPLANATION_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
export const EXPLANATION_VERSION = 'v1';
export const EXPLANATION_ANALYSIS_CACHE_KEY = fixtureId => `fixture:${fixtureId}:v17-starting-xi-rc146`;

const ROLE_CONNECTORS = Object.freeze({
  lead: 'Главное:',
  support: 'Это подкрепляет:',
  risk: 'Риск:',
  caveat: 'Важно учитывать:',
});
const ROLE_ORDER = Object.freeze(['lead', 'support', 'risk', 'caveat']);
const MIN_ITEMS = 3;
const MAX_ITEMS = 5;
const AI_TIMEOUT_MS = 4000;
const SELECTION_CACHE_MINUTES = 24 * 60;
const HOUR_SECONDS = 3600;

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

function finite(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function nonNegativeInt(value, max = 1000) {
  const number = finite(value, 0, max);
  return number !== null && Number.isInteger(number) ? number : null;
}

function positiveId(value) {
  const number = finite(value, 1, Number.MAX_SAFE_INTEGER);
  return number !== null && Number.isSafeInteger(number) ? number : 0;
}

function cleanName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return text || fallback;
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function oneDecimal(value) {
  return (Math.round(value * 10) / 10).toFixed(1).replace('.', ',');
}

function validProbabilities(value) {
  const source = plainObject(value);
  if (!source) return null;
  const home = finite(source.home, 0, 100);
  const draw = finite(source.draw, 0, 100);
  const away = finite(source.away, 0, 100);
  if (home === null || draw === null || away === null) return null;
  const sum = home + draw + away;
  return sum >= 98 && sum <= 102 ? { home, draw, away } : null;
}

function formSummary(value) {
  const overall = plainObject(safeRead(plainObject(value), 'overall'));
  if (!overall) return null;
  const sample = nonNegativeInt(overall.sample, 50);
  const wins = nonNegativeInt(overall.wins, 50);
  const draws = nonNegativeInt(overall.draws, 50);
  const losses = nonNegativeInt(overall.losses, 50);
  if (!sample || sample < 3 || wins === null || draws === null || losses === null) return null;
  if (wins + draws + losses !== sample) return null;
  return { sample, wins, draws, losses, ppg: (wins * 3 + draws) / sample };
}

function listLength(value) {
  return Array.isArray(value) ? Math.min(value.length, 60) : null;
}

/**
 * Каталог фактов матча. Только из провалидированных полей анализа; без лида
 * (корректных вероятностей) объяснение не строится.
 */
export function buildExplanationFacts(payload = {}) {
  const data = plainObject(payload) || {};
  const match = plainObject(data.match) || {};
  const home = cleanName(safeRead(plainObject(match.home), 'name'), 'Хозяева');
  const away = cleanName(safeRead(plainObject(match.away), 'name'), 'Гости');
  const names = { home, away };
  const opponent = side => (side === 'home' ? 'away' : 'home');
  const probabilities = validProbabilities(data.probabilities);
  if (!probabilities) return [];

  const facts = [];
  const add = (id, role, text, priority) => facts.push({ id, role, text, priority });

  const ranked = [
    { key: 'home', value: probabilities.home },
    { key: 'draw', value: probabilities.draw },
    { key: 'away', value: probabilities.away },
  ].sort((a, b) => b.value - a.value);
  const gap = ranked[0].value - ranked[1].value;
  let leaderSide = null;
  if (gap >= 5) {
    const top = ranked[0];
    if (top.key === 'draw') {
      add('model_lead', 'lead', `По оценке модели самый вероятный исход — ничья: ${Math.round(top.value)}%.`, 100);
    } else {
      leaderSide = top.key;
      add('model_lead', 'lead', `По оценке модели фаворит — ${names[top.key]}: победа с вероятностью ${Math.round(top.value)}%.`, 100);
    }
  } else {
    add('model_balance', 'lead', `Явного фаворита нет: ${home} — ${Math.round(probabilities.home)}%, ничья — ${Math.round(probabilities.draw)}%, ${away} — ${Math.round(probabilities.away)}%.`, 100);
  }

  // Роль факта «в пользу стороны» задаёт сервер: за лидера модели — support,
  // против лидера — risk, при равном матче — caveat.
  const roleFor = favoredSide => (!leaderSide ? 'caveat' : favoredSide === leaderSide ? 'support' : 'risk');

  const recentForm = plainObject(data.recentForm) || {};
  for (const side of ['home', 'away']) {
    const form = formSummary(recentForm[side]);
    if (!form) continue;
    const strong = form.ppg >= 2;
    const weak = form.ppg <= 1;
    if (!strong && !weak) continue;
    const favored = strong ? side : opponent(side);
    add(
      `form_${side}`,
      roleFor(favored),
      `${names[side]}: ${form.wins} ${plural(form.wins, 'победа', 'победы', 'побед')} в ${form.sample} последних матчах (${oneDecimal(form.ppg)} очка за игру).`,
      strong ? 70 : 65,
    );
  }

  const h2h = plainObject(data.h2h);
  if (h2h) {
    const homeWins = nonNegativeInt(h2h.homeWins, 200);
    const draws = nonNegativeInt(h2h.draws, 200);
    const awayWins = nonNegativeInt(h2h.awayWins, 200);
    if (homeWins !== null && draws !== null && awayWins !== null && homeWins + draws + awayWins >= 3 && Math.abs(homeWins - awayWins) >= 2) {
      const favored = homeWins > awayWins ? 'home' : 'away';
      add(
        'h2h',
        roleFor(favored),
        `Очные встречи: ${home} — ${homeWins} ${plural(homeWins, 'победа', 'победы', 'побед')}, ${away} — ${awayWins}, ничьих — ${draws}.`,
        60,
      );
    }
  }

  const absences = plainObject(data.absences);
  if (absences) {
    const counts = { home: listLength(absences.home), away: listLength(absences.away) };
    if (counts.home !== null && counts.away !== null) {
      for (const side of ['home', 'away']) {
        const n = counts[side];
        if (n >= 2 && n - counts[opponent(side)] >= 2) {
          add(
            `absences_${side}`,
            roleFor(opponent(side)),
            `${names[side]}: ${n} ${plural(n, 'игрок', 'игрока', 'игроков')} вне заявки или под вопросом по данным источника.`,
            75,
          );
        }
      }
    }
  }

  const confidence = finite(safeRead(plainObject(data.confidence), 'score'), 0, 100);
  if (confidence !== null && confidence < 50) {
    add('confidence_low', 'caveat', `Уверенность модели низкая — ${Math.round(confidence)} из 100.`, 85);
  } else if (confidence !== null && confidence >= 70 && leaderSide) {
    add('confidence_high', 'support', `Уверенность модели высокая — ${Math.round(confidence)} из 100.`, 80);
  }

  const completeness = plainObject(data.completeness);
  const filled = nonNegativeInt(safeRead(completeness, 'score'), 100);
  const total = nonNegativeInt(safeRead(completeness, 'max'), 100);
  if (filled !== null && total && filled <= total && filled / total < 0.6) {
    add('data_limited', 'caveat', `Данных по матчу немного: заполнено ${filled} из ${total} блоков.`, 90);
  }

  const lineupQuality = plainObject(data.lineupQuality);
  const status = String(safeRead(match, 'status') || '').toUpperCase();
  if (safeRead(lineupQuality, 'bothConfirmed') === true) {
    add('lineups_confirmed', 'caveat', 'Оба стартовых состава подтверждены.', 40);
  } else if (!status || status === 'NS' || status === 'TBD') {
    add('lineups_pending', 'caveat', 'Стартовые составы ещё не подтверждены — оценка может измениться.', 70);
  }

  const over25 = finite(safeRead(plainObject(data.goalModel), 'over25'), 0, 100);
  if (over25 !== null && over25 >= 60) {
    add('goals_high', 'caveat', 'Модель ждёт результативную игру.', 50);
  } else if (over25 !== null && over25 <= 40) {
    add('goals_low', 'caveat', 'Модель ждёт закрытую игру с небольшим числом голов.', 50);
  }

  return facts.map(({ id, role, text, priority }) => ({ id, role, text, priority }));
}

/** Стабильный хеш каталога: любое изменение факта — промах кеша. */
export async function explanationCatalogHash(facts = []) {
  const canonical = JSON.stringify((Array.isArray(facts) ? facts : []).map(fact => [fact.id, fact.role, fact.text]));
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function itemCountBounds(facts) {
  const count = facts.length;
  return { min: Math.min(MIN_ITEMS, count), max: Math.min(MAX_ITEMS, count) };
}

/** Порядок по умолчанию (без LLM): лид, затем до 2 подтверждений, до 2 рисков, оговорки. */
export function defaultExplanationOrder(facts = []) {
  const list = Array.isArray(facts) ? facts : [];
  const byRole = role => list.filter(fact => fact.role === role).sort((a, b) => b.priority - a.priority);
  const picked = [
    ...byRole('lead').slice(0, 1),
    ...byRole('support').slice(0, 2),
    ...byRole('risk').slice(0, 2),
    ...byRole('caveat'),
  ];
  return picked.slice(0, MAX_ITEMS).map(fact => fact.id);
}

function extractModelText(result) {
  if (typeof result === 'string') return result;
  const response = safeRead(plainObject(result), 'response');
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    try {
      return JSON.stringify(response);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Строгая проверка ответа LLM. Принимается только JSON-массив ID или объект
 * ровно с одним полем factIds. Неизвестные ID, повторы, лишние поля, свободный
 * текст, неверное количество или не-лид первым — отказ целиком (null).
 */
export function parseExplanationSelection(result, facts = []) {
  const list = Array.isArray(facts) ? facts : [];
  if (!list.length) return null;
  let text = extractModelText(result).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  if (!text || text.length > 600) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  let ids = null;
  if (Array.isArray(parsed)) {
    ids = parsed;
  } else if (plainObject(parsed) && Object.keys(parsed).length === 1 && Array.isArray(parsed.factIds)) {
    ids = parsed.factIds;
  }
  if (!ids) return null;
  const known = new Map(list.map(fact => [fact.id, fact]));
  const { min, max } = itemCountBounds(list);
  if (ids.length < min || ids.length > max) return null;
  if (!ids.every(id => typeof id === 'string' && known.has(id))) return null;
  if (new Set(ids).size !== ids.length) return null;
  const hasLead = list.some(fact => fact.role === 'lead');
  if (hasLead && known.get(ids[0]).role !== 'lead') return null;
  return ids.slice();
}

/** Детерминированная сборка: связка по роли факта + каноническая формулировка. */
export function composeExplanation(facts = [], ids = []) {
  const known = new Map((Array.isArray(facts) ? facts : []).map(fact => [fact.id, fact]));
  return (Array.isArray(ids) ? ids : [])
    .map(id => known.get(id))
    .filter(Boolean)
    .map(fact => ({ id: fact.id, role: fact.role, connector: ROLE_CONNECTORS[fact.role], text: fact.text }));
}

export function explanationPrompt(facts = []) {
  const lines = (Array.isArray(facts) ? facts : []).map(fact => `${fact.id} (${fact.role}): ${fact.text}`);
  const { min, max } = itemCountBounds(facts);
  return [
    {
      role: 'system',
      content: [
        'You order facts about a football match for a short explanation to a fan.',
        `Reply with JSON only, exactly in the form {"factIds":["id1","id2"]}.`,
        `Choose ${min} to ${max} ids from the list, most important first. The first id must be the fact with role lead.`,
        'Use only ids from the list. Do not write any other text, keys or comments.',
      ].join(' '),
    },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function createMatchExplanationRuntime(deps = {}) {
  const {
    json,
    getCache,
    getStaleCache,
    setCache,
    getHistory,
    hasSupabase,
    supaRpc,
    supaSelectMany,
    loadRuntimeControls,
    recordOpsEvent,
    bumpTelemetry,
    clock,
    memory,
  } = deps;
  const nowMs = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };
  const state = memory && typeof memory === 'object' ? memory : {};
  for (const [name, fn] of Object.entries({ json, getCache, getStaleCache, setCache, getHistory, hasSupabase, supaRpc, supaSelectMany, loadRuntimeControls })) {
    if (typeof fn !== 'function') throw new TypeError(`Match explanation requires ${name}.`);
  }

  const telemetry = key => {
    try {
      if (typeof bumpTelemetry === 'function') bumpTelemetry(key);
    } catch {}
  };

  function reportAiFailure(cfg, code, message) {
    const now = Date.now();
    const last = Number(state.matchExplanationWarningAt || 0);
    if (now - last < 60_000 || typeof recordOpsEvent !== 'function') return;
    state.matchExplanationWarningAt = now;
    try {
      Promise.resolve(recordOpsEvent(cfg, {
        severity: 'warning',
        source: 'match_explanation',
        eventType: 'match_explanation_ai',
        code,
        message: String(message || code).slice(0, 200),
        endpoint: '/api/match-explanation',
      })).catch(() => {});
    } catch {}
  }

  function storageReady(cfg) {
    try {
      return hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  // Окно claim_provider_request не длиннее часа: на пользователя — часовой лимит,
  // на сервис — настоящий суточный (24 часовые корзины, daily-budget-claim.js).
  async function claimUserHour(cfg, userId, limit) {
    if (!Number.isInteger(limit) || limit <= 0 || !storageReady(cfg)) return false;
    try {
      const result = plainObject(await supaRpc(cfg, 'claim_provider_request', {
        p_bucket_key: `ai-explain:user:${userId}`,
        p_limit: limit,
        p_window_seconds: HOUR_SECONDS,
      }, 1800));
      return safeRead(result, 'allowed') === true;
    } catch {
      return false;
    }
  }

  async function claimServiceDay(cfg, limit) {
    if (!storageReady(cfg)) return false;
    const claim = await claimDailyBudget({ cfg, supaRpc, supaSelectMany, prefix: 'ai-explain-global', limit, now: nowMs });
    return claim.allowed === true;
  }

  async function aiSelection(cfg, facts, userId, { aiEnabled = true } = {}) {
    const ai = cfg?.workersAi;
    if (cfg?.aiExplanationEnabled === false) return { ids: null, reason: 'disabled' };
    // Переключатель AI в админке: объяснение строится без LLM, по порядку фактов.
    if (aiEnabled === false) return { ids: null, reason: 'ai_disabled' };
    if (!ai || typeof ai.run !== 'function') return { ids: null, reason: 'no_binding' };
    if (!(await claimUserHour(cfg, userId, cfg?.aiExplanationUserHourlyLimit))) {
      telemetry('aiExplanationUserLimited');
      return { ids: null, reason: 'user_limit' };
    }
    if (!(await claimServiceDay(cfg, cfg?.aiExplanationDailyLimit))) {
      telemetry('aiExplanationDailyLimited');
      return { ids: null, reason: 'daily_limit' };
    }
    let timer;
    try {
      telemetry('aiExplanationCalls');
      const result = await Promise.race([
        ai.run(EXPLANATION_MODEL, { messages: explanationPrompt(facts), max_tokens: 80, temperature: 0 }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Workers AI timeout')), AI_TIMEOUT_MS);
        }),
      ]);
      const ids = parseExplanationSelection(result, facts);
      if (!ids) {
        telemetry('aiExplanationRejected');
        return { ids: null, reason: 'invalid_response' };
      }
      return { ids, reason: '' };
    } catch (error) {
      telemetry('aiExplanationFailures');
      reportAiFailure(cfg, 'MATCH_EXPLANATION_AI_FAILED', safeRead(error, 'message'));
      return { ids: null, reason: 'ai_error' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function apiMatchExplanation(request, cfg, user) {
    const userId = positiveId(safeRead(user, 'id'));
    if (!userId) return json({ error: 'Сессия Telegram не подтверждена.', code: 'AUTH_REQUIRED' }, 401);
    let fixtureId = 0;
    try {
      fixtureId = positiveId(new URL(request.url).searchParams.get('fixtureId'));
    } catch {
      fixtureId = 0;
    }
    if (!fixtureId) return json({ error: 'Номер матча обязателен.', code: 'FIXTURE_REQUIRED' }, 400);

    let aiEnabled = true;
    try {
      const runtime = plainObject(safeRead(plainObject(await loadRuntimeControls(cfg)), 'value')) || {};
      if (runtime.maintenanceMode === true || runtime.analysisEnabled === false) {
        return json({ available: false, reason: 'analysis_disabled' });
      }
      aiEnabled = runtime.aiEnabled !== false;
    } catch {
      return json({ available: false, reason: 'analysis_disabled' });
    }

    // Объяснение строится из сохранённого полного анализа — только для тех,
    // кто этот анализ уже открывал (как /api/history-analysis), без нового расхода лимита.
    let history;
    try {
      history = await getHistory(userId, cfg, { strict: true });
    } catch {
      return json({ error: 'История анализов временно недоступна.', code: 'HISTORY_UNAVAILABLE' }, 503);
    }
    if (!Array.isArray(history) || !history.some(row => positiveId(safeRead(row, 'fixture_id')) === fixtureId)) {
      return json({ available: false, reason: 'not_in_history', code: 'EXPLANATION_NOT_IN_HISTORY' }, 404);
    }

    const cacheKey = EXPLANATION_ANALYSIS_CACHE_KEY(fixtureId);
    let payload = null;
    try {
      payload = (await getCache(cacheKey, cfg)) || (await getStaleCache(cacheKey, cfg));
    } catch {
      payload = null;
    }
    if (!plainObject(payload) || positiveId(safeRead(plainObject(payload.match), 'fixtureId')) !== fixtureId) {
      return json({ available: false, reason: 'analysis_unavailable' });
    }

    const facts = buildExplanationFacts(payload);
    if (facts.length < 2) return json({ available: false, reason: 'not_enough_facts' });

    const hash = await explanationCatalogHash(facts);
    const analysisVersion = String(safeRead(payload, 'analysisVersion') || 'unknown').replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown';
    const selectionKey = `explain:${EXPLANATION_VERSION}:${fixtureId}:${analysisVersion}:${hash}`;

    let ids = null;
    let source = 'default';
    let reason = '';
    // AI выключен в админке — и порядок из кеша прежних ответов AI не берётся
    // (ревью Codex #863): объяснение строится по порядку фактов.
    if (!aiEnabled) reason = 'ai_disabled';
    else try {
      const cached = plainObject(await getCache(selectionKey, cfg));
      const cachedIds = parseExplanationSelection(JSON.stringify({ factIds: cached?.factIds }), facts);
      if (cachedIds) {
        ids = cachedIds;
        source = 'ai';
        reason = 'cached';
        telemetry('aiExplanationCacheHits');
      }
    } catch {}

    if (!ids && aiEnabled) {
      const selection = await aiSelection(cfg, facts, userId, { aiEnabled });
      if (selection.ids) {
        ids = selection.ids;
        source = 'ai';
        try {
          await setCache(selectionKey, fixtureId, { factIds: ids, model: EXPLANATION_MODEL }, cfg, SELECTION_CACHE_MINUTES);
        } catch {}
      } else {
        reason = selection.reason;
      }
    }
    if (!ids) ids = defaultExplanationOrder(facts);

    return json({
      available: true,
      fixtureId,
      source,
      ...(reason ? { reason } : {}),
      items: composeExplanation(facts, ids),
    });
  }

  return Object.freeze({ apiMatchExplanation });
}
