// Задача 3 (часть 2): точки кривой 1/X/2 по ходу матча.
//
// Фоновое задание (каждые 5 минут, под общей блокировкой scheduled-jobs):
// берёт идущие матчи из пакета матчей дня (кеш provider-fixtures, не чаще
// одного запроса к источнику за запуск), оставляет те, у которых есть
// предматчевый снимок модели (model_predictions), считает оценку по счёту и
// минуте (src/in-play-model.js) и сохраняет снимок в analysis_timeline_snapshots,
// если изменился счёт или оценка сдвинулась хотя бы на 1 п. п.
// Разборы и запросы деталей матча задание не делает.

import { inPlayProbabilities, matchMinuteFromFixture, IN_PLAY_MODEL_VERSION } from './in-play-model.js';
import { providerBudgetDecision } from './prematch-prediction-job.js';

const RAW_FIXTURES_CACHE_KEY = date => `provider-fixtures:${date}:v1`;
const LIVE_STATUSES = new Set(['1H', 'HT', '2H']);
const MAX_LIVE_FIXTURES = 60;
const MAX_SNAPSHOTS_PER_FIXTURE = 60;
const MIN_SHIFT_POINTS = 1;
const LATE_WINDOW_HOURS = 4;
const LATE_WINDOW_MS = LATE_WINDOW_HOURS * 3600_000;
const LATE_FINAL_STATUSES = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);
export const IN_PLAY_SNAPSHOT_PREFIX = 'in-play:';
export const IN_PLAY_PROVENANCE_SOURCE = 'in_play_model';

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
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function goals(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 30 ? number : null;
}

/** Идущий матч из сырой строки API-Football: счёт и минута, без выдумок. */
export function liveFixtureState(row) {
  const item = plainObject(row) || {};
  const fixture = plainObject(item.fixture) || {};
  const status = plainObject(fixture.status) || {};
  const code = String(status.short || '').toUpperCase();
  if (!LIVE_STATUSES.has(code)) return null;
  const fixtureId = positiveId(fixture.id);
  const score = plainObject(item.goals) || {};
  const homeGoals = goals(score.home);
  const awayGoals = goals(score.away);
  const minute = matchMinuteFromFixture(code, status.elapsed, status.extra);
  if (!fixtureId || homeGoals === null || awayGoals === null || minute === null) return null;
  return { fixtureId, status: code, minute, homeGoals, awayGoals };
}

function maxShift(a, b) {
  return Math.max(...['home', 'draw', 'away'].map(key => Math.abs(Number(a?.[key]) - Number(b?.[key]))));
}

/** Нужен ли новый снимок: первый, сменился счёт или оценка сдвинулась на ≥ 1 п. п. */
export function shouldCaptureInPlay(previous, state, probabilities) {
  if (!previous) return true;
  const score = plainObject(safeRead(previous, 'score'));
  if (!score || score.home !== state.homeGoals || score.away !== state.awayGoals) return true;
  return maxShift(previous.probabilities, probabilities) >= MIN_SHIFT_POINTS;
}

export function inPlaySnapshotRow(state, probabilities, previous, capturedAt) {
  const scoreChanged = Boolean(previous) && (
    safeRead(previous.score, 'home') !== state.homeGoals || safeRead(previous.score, 'away') !== state.awayGoals
  );
  const scoreText = `${state.homeGoals}:${state.awayGoals}`;
  return {
    snapshot_key: `${IN_PLAY_SNAPSHOT_PREFIX}${state.fixtureId}:${capturedAt}`,
    fixture_id: state.fixtureId,
    captured_at: capturedAt,
    match_status: state.status,
    match_minute: Math.round(state.minute),
    home_prob: probabilities.home,
    draw_prob: probabilities.draw,
    away_prob: probabilities.away,
    confidence_score: null,
    completeness_score: null,
    completeness_max: null,
    trigger_category: scoreChanged ? 'event' : 'model_update',
    causal_relation: scoreChanged ? 'confirmed' : 'model_driven',
    explanation: scoreChanged
      ? `Счёт изменился на ${scoreText} — оценка пересчитана по счёту и оставшемуся времени.`
      : `Оценка по счёту ${scoreText} и оставшемуся времени.`,
    provenance: {
      source: IN_PLAY_PROVENANCE_SOURCE,
      stale: false,
      basis: 'model_predictions',
      score: { home: state.homeGoals, away: state.awayGoals },
    },
    analysis_version: IN_PLAY_MODEL_VERSION,
  };
}

export function createInPlayTimelineJob(deps = {}) {
  const {
    clock,
    getCache,
    getModelProbabilities,
    hasSupabase,
    loadProviderFixturesForDate,
    loadSharedProviderState,
    providerSnapshot,
    recordOpsEvent,
    supaInsertIgnore,
    supaSelectMany,
  } = deps;
  for (const [name, fn] of Object.entries({ getCache, getModelProbabilities, hasSupabase, loadProviderFixturesForDate, providerSnapshot, supaInsertIgnore, supaSelectMany })) {
    if (typeof fn !== 'function') throw new TypeError(`In-play timeline job requires ${name}.`);
  }

  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  // Пакет матчей дня: свежий кеш; если устарел и бюджет источника позволяет —
  // один запрос /fixtures?date (он же обновит кеш для приложения).
  async function dayRows(date, cfg, allowNetwork) {
    try {
      const cached = plainObject(await getCache(RAW_FIXTURES_CACHE_KEY(date), cfg));
      if (cached && Array.isArray(cached.fixtures) && (!cached.date || cached.date === date)) return cached.fixtures;
      if (allowNetwork) {
        const rows = await loadProviderFixturesForDate(date, cfg, { allowNetwork: true });
        return Array.isArray(rows) ? rows : [];
      }
    } catch {}
    return [];
  }

  // Матч, начавшийся до полуночи UTC, лежит в пакете вчерашнего дня, а его кеш
  // живёт до 12 часов — счёт там устаревает. В первые часы суток UTC, если во
  // вчерашнем пакете есть недоигранный матч, начавшийся за последние 4 часа,
  // пакет обновляется одним запросом (только при доступном бюджете).
  async function lateRows(date, cfg, allowNetwork, nowMs) {
    if (!allowNetwork) return [];
    let cached = [];
    try {
      const value = plainObject(await getCache(RAW_FIXTURES_CACHE_KEY(date), cfg));
      cached = value && Array.isArray(value.fixtures) ? value.fixtures : [];
    } catch {
      cached = [];
    }
    const pending = cached.some(row => {
      const fixture = plainObject(safeRead(row, 'fixture')) || {};
      const code = String(safeRead(plainObject(fixture.status), 'short') || '').toUpperCase();
      const kickoff = Date.parse(String(fixture.date || ''));
      return !LATE_FINAL_STATUSES.has(code) && Number.isFinite(kickoff) && kickoff <= nowMs && nowMs - kickoff <= LATE_WINDOW_MS;
    });
    if (!pending) return [];
    try {
      const rows = await loadProviderFixturesForDate(date, cfg, { allowNetwork: true, forceRefresh: true });
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function liveFixtures(nowMs, cfg, allowNetwork) {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const rows = [...await dayRows(today, cfg, allowNetwork)];
    if (new Date(nowMs).getUTCHours() < LATE_WINDOW_HOURS) {
      rows.push(...await lateRows(new Date(nowMs - 86400_000).toISOString().slice(0, 10), cfg, allowNetwork, nowMs));
    }
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const state = liveFixtureState(row);
      if (!state || seen.has(state.fixtureId)) continue;
      seen.add(state.fixtureId);
      result.push(state);
      if (result.length >= MAX_LIVE_FIXTURES) break;
    }
    return result;
  }

  // Последний снимок по ходу матча и их число для каждого матча.
  async function previousSnapshots(ids, cfg) {
    const rows = await supaSelectMany(cfg, 'analysis_timeline_snapshots', {
      fixture_id: `in.(${ids.join(',')})`,
      snapshot_key: `like.${IN_PLAY_SNAPSHOT_PREFIX}*`,
    }, {
      limit: ids.length * MAX_SNAPSHOTS_PER_FIXTURE + 10,
      order: 'captured_at.desc',
      select: 'fixture_id,home_prob,draw_prob,away_prob,provenance,captured_at',
    });
    if (!Array.isArray(rows)) throw new TypeError('analysis_timeline_snapshots lookup returned an invalid response.');
    const result = new Map();
    for (const row of rows) {
      const id = positiveId(safeRead(row, 'fixture_id'));
      if (!id) continue;
      const entry = result.get(id) || { count: 0, latest: null };
      entry.count += 1;
      if (!entry.latest) {
        entry.latest = {
          probabilities: { home: Number(row.home_prob), draw: Number(row.draw_prob), away: Number(row.away_prob) },
          score: plainObject(safeRead(plainObject(row.provenance), 'score')),
        };
      }
      result.set(id, entry);
    }
    return result;
  }

  async function report(cfg, summary) {
    if (typeof recordOpsEvent !== 'function' || !(summary.written || summary.failed)) return;
    try {
      await recordOpsEvent(cfg, {
        severity: summary.failed ? 'warning' : 'info',
        source: 'in_play_timeline',
        eventType: 'in_play_timeline_run',
        code: summary.failed ? 'IN_PLAY_TIMELINE_PARTIAL' : 'IN_PLAY_TIMELINE_RUN',
        message: `Кривая по ходу матча: идёт ${summary.live}, с предматчевой оценкой ${summary.eligible}, новых точек ${summary.written}, ошибок ${summary.failed}.`,
        endpoint: 'cron:in-play-timeline',
        meta: { live: summary.live, eligible: summary.eligible, written: summary.written, unchanged: summary.unchanged, capped: summary.capped, failed: summary.failed },
      });
    } catch {}
  }

  async function processInPlayTimeline(cfg, scheduledAt = new Date()) {
    const summary = { ok: true, live: 0, eligible: 0, written: 0, unchanged: 0, capped: 0, failed: 0 };
    let storage = false;
    try {
      storage = hasSupabase(cfg) === true;
    } catch {
      storage = false;
    }
    if (!storage) return { ...summary, reason: 'storage_unavailable' };

    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : new Date(now());
    if (typeof loadSharedProviderState === 'function') {
      try {
        await loadSharedProviderState(cfg);
      } catch {}
    }
    let budget;
    try {
      budget = providerBudgetDecision(providerSnapshot(), { freeDailyReserve: 60 }, at.getTime());
    } catch {
      budget = { allowed: false };
    }
    const live = await liveFixtures(at.getTime(), cfg, budget.allowed === true);
    summary.live = live.length;
    if (!live.length) return { ...summary, reason: 'no_live_matches' };

    let prematch;
    try {
      prematch = plainObject(await getModelProbabilities(live.map(state => state.fixtureId), cfg)) || {};
    } catch {
      return { ...summary, ok: false, reason: 'predictions_lookup_failed' };
    }
    const eligible = live.filter(state => plainObject(prematch[state.fixtureId]));
    summary.eligible = eligible.length;
    if (!eligible.length) return { ...summary, reason: 'no_prematch_estimate' };

    let previous;
    try {
      previous = await previousSnapshots(eligible.map(state => state.fixtureId), cfg);
    } catch {
      return { ...summary, ok: false, reason: 'snapshots_lookup_failed' };
    }

    const capturedAt = new Date(now()).toISOString();
    for (const state of eligible) {
      const probabilities = inPlayProbabilities({ prematch: prematch[state.fixtureId], ...state });
      if (!probabilities) continue;
      const entry = previous.get(state.fixtureId) || { count: 0, latest: null };
      if (entry.count >= MAX_SNAPSHOTS_PER_FIXTURE) {
        summary.capped += 1;
        continue;
      }
      if (!shouldCaptureInPlay(entry.latest, state, probabilities)) {
        summary.unchanged += 1;
        continue;
      }
      try {
        await supaInsertIgnore(cfg, 'analysis_timeline_snapshots', inPlaySnapshotRow(state, probabilities, entry.latest, capturedAt), 'snapshot_key');
        summary.written += 1;
      } catch {
        summary.failed += 1;
      }
    }
    summary.ok = summary.failed === 0;
    await report(cfg, summary);
    return summary;
  }

  return Object.freeze({ processInPlayTimeline });
}
