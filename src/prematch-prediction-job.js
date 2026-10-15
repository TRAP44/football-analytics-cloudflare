import {prematchLineupEvent,analysisIncludesLineupEvent,completedPrematchLineupRefresh,prematchLineupCacheKey,prematchLineupRefreshKey,prematchLineupProbeKey,prematchAnalysisCacheKey,PREMATCH_LINEUP_RETENTION_MINUTES} from './prematch-lineup-event.js';
// Задача 2: вероятности модели заранее для главных матчей дня.
//
// Фоновое задание (cron, под lease-механизмом scheduled-jobs) выбирает до K
// ближайших главных матчей, у которых ЕЩЁ НЕТ строки в model_predictions, и
// запускает существующий конвейер анализа через системный вход (без квоты,
// прав, истории и событий роста пользователя). Новый расчёт вероятностей не
// придумывается: первая предматчевая строка model_predictions неизменяема,
// поэтому критерий отбора — «строки нет», а не «прогноз устарел».

import { claimDailyBudget, peekDailyBudget } from './daily-budget-claim.js';
import { ensureProviderSnapshot } from './provider-status-probe.js';
import {prematchProviderBudget,PREMATCH_PROVIDER_BUDGET_PREFIX} from './prematch-provider-budget.js';

const DAY_SECONDS = 86400;
const FEED_CACHE_KEY = date => `matches:${date}:v6-integrity`;
// Тот же ключ, что providerFixtureDateCacheKey в provider-fixture-runtime.js.
const RAW_FIXTURES_CACHE_KEY = date => `provider-fixtures:${date}:v1`;
const BUDGET_PREFIX = 'prematch-predictions';
const MIN_LEAD_MINUTES = 20;
const MAX_LEAD_HOURS = 36;
const UPCOMING_STATUSES = new Set(['NS', 'TBD']);
const MAX_FEED_MATCHES = 3000;
const MAX_FAVORITE_LOOKUP_TEAMS = 4000;
// Матчи, на которые пользователи включили напоминание в Telegram, — серверный
// признак «наблюдаемого» матча («Следить» хранится только на устройстве).
const MAX_WATCHED_LOOKUP_FIXTURES = 1000;

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

function boundedInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function prematchPredictionSettings(cfg = {}) {
  // Cron вызывает воркер раз в 5 минут — интервал округляется до кратного 5.
  const interval = boundedInt(safeRead(cfg, 'prematchPredictionsIntervalMinutes'), 5, 720, 30);
  return {
    enabled: safeRead(cfg, 'prematchPredictionsEnabled') !== false,
    perRun: boundedInt(safeRead(cfg, 'prematchPredictionsPerRun'), 1, 10, 2),
    dailyLimit: boundedInt(safeRead(cfg, 'prematchPredictionsDailyLimit'), 1, 500, 20),
    intervalMinutes: Math.max(5, Math.round(interval / 5) * 5),
    freeDailyReserve: boundedInt(safeRead(cfg, 'prematchPredictionsFreeReserve'), 0, 100000, 60),
  };
}

/**
 * Решение о бюджете провайдера до любых запросов. FREE/UNKNOWN — только при
 * подтверждённом остатке выше резерва; платный план — если нет cooldown.
 */
export function providerBudgetDecision(snapshot, settings, nowMs = Date.now(), {requireDailyQuota=false}={}) {
  const snap = plainObject(snapshot) || {};
  if (snap.cooldownActive === true) return { allowed: false, reason: 'provider_cooldown' };
  if (snap.health === 'critical') return { allowed: false, reason: 'provider_critical' };
  const plan = String(snap.plan || 'UNKNOWN').toUpperCase();
  const paid = ['PRO', 'ULTRA', 'MEGA'].includes(plan);
  // Остатки из снимка верны только пока он свежий: минутный — 90 секунд,
  // дневной — в пределах текущих суток UTC (лимит сбрасывается в 00:00 UTC).
  const updatedMs = Date.parse(String(snap.updatedAt || ''));
  const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : Infinity;
  const minute = Number(snap.minuteRemaining);
  if (ageMs >= 0 && ageMs <= 90_000 && Number.isFinite(minute) && minute < 10) return { allowed: false, reason: 'provider_minute_budget' };
  if (paid) return requireDailyQuota ? prematchProviderBudget(snap,nowMs) : {allowed:true,reason:''};
  const sameUtcDay = Number.isFinite(updatedMs) && utcDate(updatedMs) === utcDate(nowMs);
  const daily = Number(snap.dailyRemaining);
  if (!sameUtcDay || !Number.isFinite(daily) || daily < settings.freeDailyReserve) return { allowed: false, reason: 'provider_daily_reserve' };
  return { allowed: true, reason: '' };
}

/** Кандидаты из уже закешированной ленты матчей: предстоящие главные матчи в окне. */
export function prematchCandidates(feeds = [], favoriteTeamIds = new Set(), nowMs = Date.now(), watchedFixtureIds = new Set()) {
  const seen = new Set();
  const rows = [];
  for (const feed of feeds) {
    const matches = Array.isArray(safeRead(plainObject(feed), 'matches')) ? feed.matches : [];
    for (const match of matches.slice(0, MAX_FEED_MATCHES)) {
      const m = plainObject(match);
      const fixtureId = positiveId(m?.fixtureId);
      if (!fixtureId || seen.has(fixtureId)) continue;
      if (m.live === true || m.finished === true) continue;
      if (!UPCOMING_STATUSES.has(String(m.status || '').toUpperCase())) continue;
      const kickoff = Date.parse(String(m.date || ''));
      if (!Number.isFinite(kickoff)) continue;
      const minutes = (kickoff - nowMs) / 60000;
      if (minutes < MIN_LEAD_MINUTES || minutes > MAX_LEAD_HOURS * 60) continue;
      if (m.youthReserve === true || m.lowPriority === true) continue;
      const homeId = positiveId(safeRead(plainObject(m.home), 'id'));
      const awayId = positiveId(safeRead(plainObject(m.away), 'id'));
      const favorite = favoriteTeamIds.has(homeId) || favoriteTeamIds.has(awayId);
      const watched = watchedFixtureIds.has(fixtureId);
      const competition = plainObject(m.competition) || {};
      const top = m.featured === true || competition.featured === true || m.isTop === true;
      if (!favorite && !watched && !top) continue;
      seen.add(fixtureId);
      rows.push({
        fixtureId,
        kickoff,
        watched,
        favorite,
        top,
        interest: Number.isFinite(Number(m.interestScore)) ? Number(m.interestScore) : 0,
        homeId,
        awayId,
      });
    }
  }
  return rows.sort((a, b) => (
    Number(b.watched) - Number(a.watched)
    || Number(b.favorite) - Number(a.favorite)
    || Number(b.top) - Number(a.top)
    || b.interest - a.interest
    || a.kickoff - b.kickoff
    || a.fixtureId - b.fixtureId
  ));
}

export function createPrematchPredictionJob(deps = {}) {
  const {
    analyzeFixtureForSystem,
    analysisProviderFetch,
    setCache,
    clock,
    getCache,
    getStaleCache,
    hasSupabase,
    isTopLeague,
    loadProviderFixturesForDate,
    loadSharedProviderState,
    normalizeCompetition,
    probeProviderStatus,
    providerSnapshot,
    recordOpsEvent,
    supaRpc,
    supaSelectMany,
  } = deps;
  for (const [name, fn] of Object.entries({ analyzeFixtureForSystem, getCache, getStaleCache, hasSupabase, providerSnapshot, supaRpc, supaSelectMany })) {
    if (typeof fn !== 'function') throw new TypeError(`Prematch prediction job requires ${name}.`);
  }

  const realNow = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  // Сырые матчи дня (кеш provider-fixtures, при необходимости — один запрос
  // /fixtures?date) в форме кандидата: лента могла ещё никем не открываться.
  // Классификация турнира — та же, что у нормализованной ленты
  // (normalizeCompetition): молодёжные, резервные, товарищеские и низшие
  // лиги помечаются lowPriority и не тратят бюджет. Если классификатор
  // недоступен или упал — матч считается низкоприоритетным (fail-closed).
  function rawCompetition(league, teams) {
    const leagueId = positiveId(league.id);
    const leagueName = String(league.name || '');
    try {
      const competition = typeof normalizeCompetition === 'function'
        ? plainObject(normalizeCompetition(
          leagueId,
          leagueName,
          String(league.country || ''),
          String(safeRead(plainObject(teams.home), 'name') || ''),
          String(safeRead(plainObject(teams.away), 'name') || ''),
        ))
        : null;
      if (!competition) return { top: false, youth: false, lowPriority: true };
      const youth = competition.youth === true;
      const lowPriority = youth || competition.friendly === true || competition.lower === true;
      let top = competition.featured === true;
      if (!top && !lowPriority && typeof isTopLeague === 'function') top = isTopLeague(leagueId, leagueName) === true;
      return { top: top && !lowPriority, youth, lowPriority };
    } catch {
      return { top: false, youth: false, lowPriority: true };
    }
  }

  function rawFixtureMatch(row) {
    const item = plainObject(row) || {};
    const fixture = plainObject(item.fixture) || {};
    const league = plainObject(item.league) || {};
    const teams = plainObject(item.teams) || {};
    const competition = rawCompetition(league, teams);
    return {
      fixtureId: positiveId(fixture.id),
      date: String(fixture.date || ''),
      status: String(safeRead(plainObject(fixture.status), 'short') || ''),
      live: false,
      finished: false,
      isTop: competition.top,
      youthReserve: competition.youth,
      lowPriority: competition.lowPriority,
      interestScore: 0,
      home: { id: positiveId(safeRead(plainObject(teams.home), 'id')) },
      away: { id: positiveId(safeRead(plainObject(teams.away), 'id')) },
    };
  }

  function rawFixtureRows(payload, date) {
    const value = plainObject(payload);
    if (!value || (value.date && String(value.date) !== date) || !Array.isArray(value.fixtures)) return null;
    return value.fixtures;
  }

  // Полный пакет матчей дня. Сначала кеш (свежий, затем устаревший — он
  // переживает TTL), и только если кеша нет совсем и нет нормализованной
  // ленты — один запрос к источнику; он же заполнит кеш на следующие запуски.
  async function loadRawFixtures(date, cfg, allowNetwork) {
    const key = RAW_FIXTURES_CACHE_KEY(date);
    for (const read of [getCache, getStaleCache]) {
      try {
        const rows = rawFixtureRows(await read(key, cfg), date);
        if (rows) return rows;
      } catch {}
    }
    if (!allowNetwork || typeof loadProviderFixturesForDate !== 'function') return [];
    try {
      const rows = await loadProviderFixturesForDate(date, cfg, { allowNetwork: true });
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  // Кандидаты — из полного пакета матчей дня: нормализованная лента хранит
  // только ~120 матчей и ничего не знает об избранных командах. Записи ленты
  // (интерес, «главный», классификация) важнее сырых и идут первыми.
  async function loadFeed(date, cfg, allowNetwork=true) {
    let normalized = [];
    try {
      const key = FEED_CACHE_KEY(date);
      const feed = plainObject(await getCache(key, cfg)) || plainObject(await getStaleCache(key, cfg));
      normalized = Array.isArray(feed?.matches) ? feed.matches : [];
    } catch {
      normalized = [];
    }
    const raw = await loadRawFixtures(date, cfg, allowNetwork && !normalized.length);
    const byId = new Map();
    for (const match of normalized) {
      const id = positiveId(safeRead(plainObject(match), 'fixtureId'));
      if (id && !byId.has(id)) byId.set(id, match);
    }
    for (const row of raw.slice(0, MAX_FEED_MATCHES)) {
      const match = rawFixtureMatch(row);
      if (match.fixtureId && !byId.has(match.fixtureId)) byId.set(match.fixtureId, match);
    }
    const matches = [...byId.values()].slice(0, MAX_FEED_MATCHES);
    return matches.length ? { matches } : null;
  }

  // Все команды кандидатов, частями по 200. Строка favorites — это пара
  // (пользователь, команда), поэтому популярная команда может занять всю
  // страницу: пагинация по ключу team_id (gt) перескакивает её дубли, число
  // страниц ограничено числом различных команд, а не числом пользователей.
  async function favoriteTeams(teamIds, cfg) {
    const ids = [...new Set(teamIds.filter(Boolean))].sort((a, b) => a - b).slice(0, MAX_FAVORITE_LOOKUP_TEAMS);
    const found = new Set();
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200);
      let after = 0;
      for (let page = 0; page <= chunk.length; page += 1) {
        let rows;
        try {
          rows = await supaSelectMany(
            cfg,
            'favorites',
            { and: `(team_id.in.(${chunk.join(',')}),team_id.gt.${after})` },
            { limit: 1000, select: 'team_id', order: 'team_id.asc' },
          );
        } catch {
          break;
        }
        const list = (Array.isArray(rows) ? rows : []).map(row => positiveId(safeRead(row, 'team_id'))).filter(Boolean);
        for (const id of list) found.add(id);
        if (list.length < 1000) break;
        const last = Math.max(...list);
        if (!(last > after)) break;
        after = last;
      }
    }
    return found;
  }

  // Матчи с включённым напоминанием, частями по 200 id. Ошибка чтения не
  // останавливает расчёт: остаются прежние приоритеты избранных и главных.
  async function watchedFixtures(fixtureIds, cfg) {
    const ids = [...new Set(fixtureIds.filter(Boolean))].sort((a, b) => a - b).slice(0, MAX_WATCHED_LOOKUP_FIXTURES);
    const found = new Set();
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200);
      let rows;
      try {
        rows = await supaSelectMany(
          cfg,
          'match_reminders',
          { fixture_id: `in.(${chunk.join(',')})`, enabled: 'eq.true' },
          { limit: 1000, select: 'fixture_id' },
        );
      } catch {
        continue;
      }
      for (const row of Array.isArray(rows) ? rows : []) {
        const id = positiveId(safeRead(row, 'fixture_id'));
        if (id) found.add(id);
      }
    }
    return found;
  }

  async function fixturesWithPrediction(fixtureIds, cfg) {
    const ids = fixtureIds.slice(0, 200);
    if (!ids.length) return new Set();
    const rows = await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${ids.join(',')})` }, { limit: ids.length + 2, select: 'fixture_id' });
    if (!Array.isArray(rows)) throw new TypeError('model_predictions lookup returned an invalid response.');
    return new Set(rows.map(row => positiveId(safeRead(row, 'fixture_id'))).filter(Boolean));
  }

  // The scheduler already owns cron-global. At most one discovery attempt
  // per fixture; all later ticks only observe existing shared cache events.
  async function lineupRefreshQueue(candidates,existing,cfg,settings,nowMs,summary) {
    const queue=[];
    let probes=0;
    const eligible=candidates.filter(row=>existing.has(row.fixtureId)
      && row.kickoff-nowMs<=90*60000).slice(0,40);
    for (const row of eligible) {
      try {
        const marker=await getCache(prematchLineupRefreshKey(row.fixtureId),cfg)
          || await getStaleCache(prematchLineupRefreshKey(row.fixtureId),cfg);
        if (completedPrematchLineupRefresh(marker,row.fixtureId)) continue;
        const analysis=await getStaleCache(prematchAnalysisCacheKey(row.fixtureId),cfg);
        if (completedPrematchLineupRefresh(analysis?.prematchLineupRefresh,row.fixtureId)) continue;
        let snapshot=await getCache(prematchLineupCacheKey(row.fixtureId),cfg);
        let event=prematchLineupEvent(snapshot,row,nowMs);
        if (!event && row.kickoff-nowMs<=65*60000 && probes<settings.perRun
            && typeof analysisProviderFetch==='function' && typeof setCache==='function') {
          const probeKey=prematchLineupProbeKey(row.fixtureId);
          const probed=await getCache(probeKey,cfg) || await getStaleCache(probeKey,cfg);
          if (probed?.fixtureId!==row.fixtureId) {
            const saved=await setCache(probeKey,row.fixtureId,{fixtureId:row.fixtureId,attemptedAt:new Date(nowMs).toISOString()},cfg,PREMATCH_LINEUP_RETENTION_MINUTES,{requireDurable:true});
            if (saved!==true) { summary.lineupSkipped++; summary.stopReason='lineup_storage_unavailable'; break; }
            probes++;
            const result=await analysisProviderFetch({feature:'lineups',path:'/fixtures/lineups',params:{fixture:row.fixtureId},fixtureId:row.fixtureId,cfg});
            if (['rate_limited','plan_limited'].includes(result?.meta?.state)) {
              summary.stopReason='provider_limited';
              summary.lineupSkipped++;
              break;
            }
            snapshot={fixtureId:row.fixtureId,feature:'lineups',provider:result?.meta?.provider,fetchedAt:result?.meta?.fetchedAt,
              stale:result?.meta?.stale===true || result?.meta?.source==='stale-cache',data:result?.data};
            event=prematchLineupEvent(snapshot,row,nowMs);
          }
        }
        if (!event) { summary.lineupSkipped++; continue; }
        if (analysisIncludesLineupEvent(analysis,event)) {
          if (typeof setCache==='function') await setCache(prematchLineupRefreshKey(row.fixtureId),row.fixtureId,
            {fixtureId:row.fixtureId,phase:'lineups',fingerprint:event.fingerprint,computedAt:analysis.generatedAt},cfg,PREMATCH_LINEUP_RETENTION_MINUTES,{requireDurable:true});
          continue;
        }
        queue.push({...row,lineupEvent:event});
        if (queue.length>=settings.perRun || summary.stopReason) break;
      } catch { summary.lineupSkipped++; summary.stopReason ||= 'lineup_event_unavailable'; }
      if (summary.stopReason) break;
    }
    summary.lineupProbes=probes;
    return queue;
  }

  async function report(cfg, summary) {
    if (typeof recordOpsEvent !== 'function') return;
    try {
      await recordOpsEvent(cfg, {
        severity: summary.failed ? 'warning' : 'info',
        source: 'prematch_predictions',
        eventType: 'prematch_predictions_run',
        code: summary.failed ? 'PREMATCH_PREDICTIONS_PARTIAL' : 'PREMATCH_PREDICTIONS_RUN',
        message: `Предматчевые прогнозы: посчитано ${summary.computed}, уже были ${summary.alreadyCached}, пропущено ${summary.skipped}${summary.stopReason ? ` (${summary.stopReason})` : ''}, ошибок ${summary.failed}.`,
        endpoint: 'cron:prematch-predictions',
        meta: {
          candidates: summary.candidates,
          watched: summary.watched || 0,
          withoutPrediction: summary.withoutPrediction,
          computed: summary.computed,
          alreadyCached: summary.alreadyCached,
          skipped: summary.skipped,
          failed: summary.failed,
          stopReason: summary.stopReason || summary.reason || null,
          providerRequestsReserved:summary.providerRequestsReserved || 0,
          providerRequestLimit:summary.providerRequestLimit || 0,
          lineupRefreshed:summary.lineupRefreshed || 0,
          lineupProbes:summary.lineupProbes || 0,
          lineupSkipped:summary.lineupSkipped || 0,
        },
      });
    } catch {}
  }

  async function processPrematchPredictions(cfg, scheduledAt = new Date()) {
    const settings = prematchPredictionSettings(cfg);
    const summary = { ok: true, candidates: 0, watched: 0, withoutPrediction: 0, computed: 0, alreadyCached: 0, skipped: 0, failed: 0, stopReason: '',lineupRefreshed:0,lineupSkipped:0,lineupProbes:0 };
    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : new Date();
    if (!settings.enabled) return { ...summary, reason: 'disabled' };
    let storage = false;
    try {
      storage = hasSupabase(cfg) === true;
    } catch {
      storage = false;
    }
    if (!storage) return { ...summary, reason: 'storage_unavailable' };
    const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
    const initialWindow=minuteOfDay % settings.intervalMinutes===0;

    // Состояние квоты провайдера общее для всех изолятов (Supabase); в cron-изоляте
    // своей памяти о нём может не быть. Истёкший снимок обновляется запросом /status.
    await ensureProviderSnapshot({ cfg, loadSharedProviderState, providerSnapshot, probeProviderStatus, nowMs: realNow(), requireDailyQuota:true });
    let budget;
    try {
      budget = providerBudgetDecision(providerSnapshot(), settings, realNow(), {requireDailyQuota:true});
    } catch {
      budget = { allowed: false, reason: 'provider_unknown' };
    }
    const finish=async reason=>{
      summary.reason=reason;
      summary.stopReason=reason;
      await report(cfg,summary);
      return summary;
    };
    if (!budget.allowed) return finish(budget.reason);
    const providerBudget=prematchProviderBudget(providerSnapshot(),realNow());
    if (!providerBudget.allowed) return finish(providerBudget.reason);
    summary.providerRequestLimit=providerBudget.limit;
    summary.providerRequestsReserved=0;
    const providerPeek=await peekDailyBudget({cfg,supaSelectMany,prefix:PREMATCH_PROVIDER_BUDGET_PREFIX,limit:providerBudget.limit,now:realNow});
    if (!providerPeek.available) return finish(providerPeek.reason);
    const baseCfg=cfg;
    cfg={...cfg,prematchProviderClaim:async()=>{
      const snapshot=providerSnapshot();
      const decision=providerBudgetDecision(snapshot,settings,realNow(),{requireDailyQuota:true});
      const reserve=prematchProviderBudget(snapshot,realNow());
      let reason=summary.stopReason || (!decision.allowed ? decision.reason : !reserve.allowed ? reserve.reason : '');
      if (!reason) {
        const claim=await claimDailyBudget({cfg:baseCfg,supaRpc,supaSelectMany,prefix:PREMATCH_PROVIDER_BUDGET_PREFIX,limit:reserve.limit,now:realNow});
        if (!claim.allowed) reason=claim.reason || 'daily_limit';
      }
      if (reason) {
        summary.stopReason=reason;
        throw Object.assign(new Error('Background provider budget protected.'),{code:'FOOTBALL_BACKGROUND_LIMIT',status:429});
      }
      summary.providerRequestsReserved++;
    }};

    // Суточный потолок исчерпан — не тратим запросы к источнику на ленту.
    const peek = await peekDailyBudget({ cfg, supaSelectMany, prefix: BUDGET_PREFIX, limit: settings.dailyLimit, now: realNow });
    if (!peek.available) return finish(peek.reason);

    const nowMs = at.getTime();
    const feeds = (await Promise.all([utcDate(nowMs), utcDate(nowMs + DAY_SECONDS * 1000)].map(date => loadFeed(date, cfg, initialWindow)))).filter(Boolean);
    if (!feeds.length) return initialWindow ? finish(summary.stopReason || 'feed_not_cached') : {...summary,reason:'interval'};

    // Избранные ищутся только среди команд матчей, которые вообще могут стать
    // кандидатами (предстоящие, в окне, не молодёжь/товарищеские/низшие лиги):
    // полный пакет дня может содержать тысячи матчей.
    const eligible = prematchCandidates(feeds, { has: () => true }, nowMs);
    const preliminary = eligible.filter(row => row.top);
    const favorites = await favoriteTeams(eligible.flatMap(row => [row.homeId, row.awayId]), cfg);
    const watched = await watchedFixtures(eligible.map(row => row.fixtureId), cfg);
    const candidates = prematchCandidates(feeds, favorites, nowMs, watched).slice(0, 200);
    summary.candidates = candidates.length;
    summary.watched = candidates.filter(row => row.watched).length;
    if (!candidates.length) return finish(preliminary.length ? 'no_candidates' : 'no_main_matches');

    let existing;
    try {
      existing = await fixturesWithPrediction(candidates.map(row => row.fixtureId), cfg);
    } catch {
      summary.ok=false;
      return finish('predictions_lookup_failed');
    }
    const refresh=await lineupRefreshQueue(candidates,existing,cfg,settings,realNow(),summary);
    const initial=initialWindow ? candidates.filter(row=>!existing.has(row.fixtureId)) : [];
    const priority=new Map(candidates.map((row,index)=>[row.fixtureId,index]));
    const queue=[...refresh,...initial].sort((a,b)=>priority.get(a.fixtureId)-priority.get(b.fixtureId));
    summary.withoutPrediction = initial.length;
    if (!queue.length) return !initialWindow && !summary.lineupProbes && !summary.stopReason ? {...summary,reason:'interval'} : finish(summary.stopReason || (summary.lineupSkipped ? 'lineups_not_ready' : 'all_predicted'));

    for (const row of queue.slice(0, settings.perRun)) {
      if (summary.stopReason) break;
      const current=providerBudgetDecision(providerSnapshot(),settings,realNow(),{requireDailyQuota:true});
      if (!current.allowed) { summary.stopReason=current.reason; break; }
      // Настоящий суточный потолок (24 часовые корзины, см. daily-budget-claim.js):
      // окно claim_provider_request само по себе не длиннее часа.
      const claim = await claimDailyBudget({ cfg, supaRpc, supaSelectMany, prefix: BUDGET_PREFIX, limit: settings.dailyLimit, now: realNow });
      if (!claim.allowed) {
        summary.stopReason = claim.reason || 'daily_limit';
        break;
      }
      try {
        const response = await analyzeFixtureForSystem(row.fixtureId, cfg,row.lineupEvent ? {lineupEvent:{...row.lineupEvent.snapshot,match:{fixtureId:row.fixtureId,date:new Date(row.kickoff).toISOString(),status:'NS',home:{id:row.homeId},away:{id:row.awayId}}}} : undefined);
        const status = Number(safeRead(response, 'status')) || 0;
        let body = null;
        try {
          body = typeof response?.clone === 'function' ? await response.clone().json() : null;
        } catch {
          body = null;
        }
        if (status === 200 && body?.cached === true && body?.fixtureId === row.fixtureId) {
          summary.alreadyCached += 1;
        } else if (status === 200 && body?.stale!==true) {
          summary.computed += 1;
          if (row.lineupEvent) summary.lineupRefreshed++;
        } else if (status === 429 || status === 503) {
          summary.skipped += 1;
          summary.stopReason ||= ['LINEUP_REFRESH_CACHE_UNAVAILABLE','LINEUP_REFRESH_STORAGE_UNAVAILABLE'].includes(body?.code) ? 'lineup_storage_unavailable' : 'provider_limited';
          break;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.failed += 1;
        const code = String(safeRead(error, 'code') || '');
        if (/RATE|QUOTA|COOLDOWN|LIMIT/i.test(code) || Number(safeRead(error, 'status')) === 429) {
          summary.stopReason ||= 'provider_limited';
          break;
        }
      }
    }
    summary.ok = summary.failed === 0;
    await report(cfg, summary);
    return summary;
  }

  return Object.freeze({ processPrematchPredictions });
}
