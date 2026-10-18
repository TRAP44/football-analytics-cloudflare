import {favoriteMatchRecipients,recentNotificationMinutes} from './favorite-match-notifications.js';
import {
  SMART_NOTIFICATION_POLICY,
  notificationCategory,
  smartNotificationDedupeKey,
} from './smart-notification-policy.js';
import { inspectMatchEvent } from './event-quality.js';

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number = integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function numberCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!/^-?(?:\d+|\d+\.\d+|\.\d+)$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function numberInRange(value, min, max, fallback) {
  const number = numberCandidate(value);
  return number !== null && number >= min && number <= max ? number : fallback;
}

function textCandidate(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function groupByFixture(rows = []) {
  const groups = new Map();
  for (const row of asRows(rows)) {
    const fixtureId = positiveSafeInteger(row?.fixture_id ?? row?.fixtureId);
    if (!fixtureId || row?.enabled === false) continue;
    const list = groups.get(fixtureId) || [];
    list.push(row);
    groups.set(fixtureId, list);
  }
  return groups;
}

function validProbability(value) {
  const number = numberCandidate(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function probabilityRow(row = {}) {
  const home = validProbability(row.home_prob ?? row.homeProb);
  const draw = validProbability(row.draw_prob ?? row.drawProb);
  const away = validProbability(row.away_prob ?? row.awayProb);
  const capturedAt = textCandidate(row.captured_at ?? row.capturedAt);
  if (home === null || draw === null || away === null || !Number.isFinite(Date.parse(capturedAt))) return null;
  if (Math.abs(home + draw + away - 100) > 2.5) return null;
  return {
    home,
    draw,
    away,
    confidence: validProbability(row.confidence_score ?? row.confidenceScore),
    triggerCategory: textCandidate(row.trigger_category ?? row.triggerCategory),
    capturedAt,
    snapshotKey: textCandidate(row.snapshot_key ?? row.snapshotKey, capturedAt),
  };
}

export function radarStrongSignalState(snapshots = [], {
  confidenceThreshold = SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
  outcomeThreshold = SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
  maxSignalAgeMinutes = SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
  now = Date.now(),
} = {}) {
  const valid = asRows(snapshots)
    .map(probabilityRow)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  if (!valid.length) return { significant:false, strong:false, reason:'insufficient_history', sample:0 };
  const latest = valid[valid.length - 1];
  const baseline = valid.length > 1 ? valid[valid.length - 2] : null;
  const nowMs = numberCandidate(now);
  const maxAge = numberInRange(
    maxSignalAgeMinutes,
    0,
    Number.MAX_SAFE_INTEGER,
    SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
  );
  const confidenceLimit = numberInRange(
    confidenceThreshold,
    0,
    100,
    SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
  );
  const outcomeLimit = numberInRange(
    outcomeThreshold,
    0,
    100,
    SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
  );
  const ageMinutes = nowMs === null
    ? Number.NaN
    : Math.max(0, (nowMs - Date.parse(latest.capturedAt)) / 60000);
  if (!Number.isFinite(ageMinutes) || ageMinutes > maxAge) {
    return { significant:false, strong:false, reason:'stale_signal', sample:valid.length, ageMinutes, latest };
  }

  const ranked = ['home','draw','away']
    .map(side => ({ side, probability:latest[side] }))
    .sort((a,b) => b.probability - a.probability);
  const strongest = ranked[0] || { side:'', probability:0 };
  const strong = (latest.confidence ?? -1) >= confidenceLimit
    && strongest.probability >= outcomeLimit;

  let baselineStrong = false;
  let baselineSide = '';
  if (baseline) {
    const priorRanked = ['home','draw','away']
      .map(side => ({ side, probability:baseline[side] }))
      .sort((a,b) => b.probability - a.probability);
    const priorStrongest = priorRanked[0] || { side:'', probability:0 };
    baselineSide = priorStrongest.side;
    baselineStrong = (baseline.confidence ?? -1) >= confidenceLimit
      && priorStrongest.probability >= outcomeLimit;
  }

  return {
    significant:Boolean(strong && (!baselineStrong || baselineSide !== strongest.side)),
    strong,
    reason:'evaluated',
    sample:valid.length,
    ageMinutes,
    baseline,
    latest,
    strongest,
    thresholds:{
      confidence:confidenceLimit,
      outcome:outcomeLimit,
    },
  };
}

export function aiProbabilityMovement(snapshots = [], {
  thresholdPp = SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
  maxSignalAgeMinutes = SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
  now = Date.now(),
} = {}) {
  const valid = asRows(snapshots)
    .map(probabilityRow)
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  if (valid.length < 2) return { significant: false, reason: 'insufficient_history', sample: valid.length };
  const latest = valid[valid.length - 1];
  const baseline = valid[valid.length - 2];
  const nowMs = numberCandidate(now);
  const maxAge = numberInRange(
    maxSignalAgeMinutes,
    0,
    Number.MAX_SAFE_INTEGER,
    SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
  );
  const threshold = numberInRange(
    thresholdPp,
    0,
    100,
    SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
  );
  const ageMinutes = nowMs === null
    ? Number.NaN
    : Math.max(0, (nowMs - Date.parse(latest.capturedAt)) / 60000);
  if (!Number.isFinite(ageMinutes) || ageMinutes > maxAge) {
    return { significant: false, reason: 'stale_signal', sample: valid.length, ageMinutes };
  }

  const sides = ['home', 'draw', 'away'].map(side => ({
    side,
    from: baseline[side],
    to: latest[side],
    delta: Math.round((latest[side] - baseline[side]) * 10) / 10,
  }));
  const strongest = sides.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  return {
    significant: Boolean(strongest && Math.abs(strongest.delta) >= threshold),
    reason: 'evaluated',
    sample: valid.length,
    ageMinutes,
    baseline,
    latest,
    strongest,
  };
}

function normalizedEventKey(event = {}) {
  const explicitKey = textCandidate(event?.eventKey);
  if (explicitKey) return explicitKey;
  const minute = integerCandidate(event?.minute);
  const extra = integerCandidate(event?.extra ?? 0);
  return [
    minute ?? 'na',
    extra ?? 0,
    textCandidate(event?.type).toLowerCase(),
    textCandidate(event?.detail).toLowerCase(),
    positiveSafeInteger(event?.teamId ?? event?.team_id),
    positiveSafeInteger(event?.playerId ?? event?.player_id),
    positiveSafeInteger(event?.assistPlayerId ?? event?.assist_player_id),
  ].join(':');
}

export function notificationEventsFromSnapshot(snapshot = {}, { elapsed = null } = {}) {
  if (snapshot?.trusted !== true || snapshot?.stale === true) return [];

  const sanitized = Array.isArray(snapshot?.sanitizedEvents) ? snapshot.sanitizedEvents : null;
  const rows = sanitized || asRows(snapshot?.events);
  const quality = snapshot?.eventQuality && typeof snapshot.eventQuality === 'object'
    ? snapshot.eventQuality
    : null;
  const explicitAllowed = !sanitized && Array.isArray(quality?.displayEventIndices)
    ? new Set(
      quality.displayEventIndices
        .map(integerCandidate)
        .filter(index => index !== null && index >= 0),
    )
    : null;

  if (quality?.sourceTrusted === false) return [];

  const seen = new Set();
  const accepted = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (explicitAllowed && !explicitAllowed.has(index)) continue;
    const event = rows[index] || {};
    const inspected = inspectMatchEvent(event, { mode:'live', elapsed });
    if (!inspected.displayValid) continue;
    const key = normalizedEventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(event);
  }
  return accepted;
}

function isGoal(event = {}) {
  const type = String(event.type || '').toLowerCase();
  const detail = String(event.detail || '').toLowerCase();
  return type === 'goal' && !detail.includes('missed');
}

function isRedCard(event = {}) {
  const type = String(event.type || '').toLowerCase();
  const detail = String(event.detail || '').toLowerCase();
  return type === 'card' && (detail.includes('red') || detail.includes('second yellow'));
}

function matchEventType(event = {}) {
  if (isGoal(event)) return 'match.goal';
  if (isRedCard(event)) return 'match.red_card';
  if (String(event.type || '').toLowerCase()==='card' && String(event.detail || '').toLowerCase().includes('yellow')) return 'match.yellow_card';
  return '';
}

function playerEventType(event = {}) {
  const type = String(event.type || '').toLowerCase();
  if (isGoal(event)) return 'player.goal';
  if (type === 'card') return 'player.card';
  if (type === 'subst') return 'player.substitution';
  return '';
}

function minuteLabel(event = {}) {
  const minute = integerCandidate(event?.minute);
  const extra = integerCandidate(event?.extra ?? 0);
  if (minute === null) return '';
  return extra !== null && extra > 0 ? `${minute}+${extra}′` : `${minute}′`;
}

// Оценка модели по ходу матча для уведомления о голе/удалении — только если
// она свежая и уже учитывает все голы, которые видит уведомление.
const IN_PLAY_ESTIMATE_MAX_AGE_MS = 10 * 60_000;
export function inPlayEstimateLine(row, estimate, events = [], now = Date.now()) {
  if (!estimate || typeof estimate !== 'object') return '';
  const values = ['home', 'draw', 'away'].map(key => Number(estimate[key]));
  if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 100)) return '';
  const sum = values[0] + values[1] + values[2];
  if (sum < 98 || sum > 102) return '';
  const capturedMs = Date.parse(String(estimate.capturedAt || ''));
  if (!Number.isFinite(capturedMs) || now - capturedMs > IN_PLAY_ESTIMATE_MAX_AGE_MS || capturedMs - now > 60_000) return '';
  const scoreHome = integerCandidate(estimate.score?.home);
  const scoreAway = integerCandidate(estimate.score?.away);
  if (scoreHome === null || scoreAway === null) return '';
  // Голы и удаления сверяются по командам (ревью Codex #859): если источники
  // временно расходятся, кому засчитан гол, оценка в сообщение не попадает.
  const homeTeam = positiveSafeInteger(estimate.teams?.home);
  const awayTeam = positiveSafeInteger(estimate.teams?.away);
  const perTeam = list => {
    if (!homeTeam || !awayTeam) return null;
    let home = 0;
    let away = 0;
    for (const event of list) {
      const team = positiveSafeInteger(event?.teamId ?? event?.team_id);
      if (team === homeTeam) home += 1;
      else if (team === awayTeam) away += 1;
      else return null;
    }
    return { home, away };
  };
  const goalEvents = asRows(events).filter(isGoal);
  if (goalEvents.length) {
    // Автогол: по событию нельзя надёжно сказать, какой стороне он засчитан.
    if (goalEvents.some(event => String(event?.detail || '').toLowerCase().includes('own goal'))) return '';
    const goals = perTeam(goalEvents);
    if (!goals || goals.home !== scoreHome || goals.away !== scoreAway) return '';
  } else if (scoreHome + scoreAway !== 0) return '';
  // Удаления — так же: оценка не должна быть посчитана до карточки или с
  // удалением не у той стороны.
  const redHome = estimate.reds ? integerCandidate(estimate.reds.home ?? 0) : 0;
  const redAway = estimate.reds ? integerCandidate(estimate.reds.away ?? 0) : 0;
  if (redHome === null || redAway === null) return '';
  const redEvents = asRows(events).filter(isRedCard);
  if (redEvents.length) {
    const reds = perTeam(redEvents);
    if (!reds || redHome !== Math.min(3, reds.home) || redAway !== Math.min(3, reds.away)) return '';
  } else if (redHome + redAway !== 0) return '';
  const minute = integerCandidate(estimate.minute);
  const percent = value => `${Math.round(value)}%`;
  return `📊 Оценка модели сейчас (${scoreHome}:${scoreAway}${minute !== null ? `, ${minute}′` : ''}): `
    + `${row?.home_name || 'Хозяева'} ${percent(values[0])} · Ничья ${percent(values[1])} · ${row?.away_name || 'Гости'} ${percent(values[2])}`;
}

function matchEventMessage(row, event, eventType) {
  const title = eventType === 'match.goal' ? '⚽ Гол' : eventType === 'match.yellow_card' ? '🟨 Жёлтая карточка' : '🟥 Красная карточка';
  const actor = String(event.playerName || event.player || '').trim();
  const team = String(event.teamName || '').trim();
  return [
    title,
    '',
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    [minuteLabel(event), team].filter(Boolean).join(' · '),
    actor,

  ].filter(Boolean).join('\n');
}

function playerEventMessage(row, event, eventType, favorite) {
  const player = String(favorite?.player_name || favorite?.playerName || event?.playerName || 'Игрок');
  const action = eventType === 'player.goal'
    ? 'забил гол'
    : eventType === 'player.card'
      ? String(event?.detail || '').toLowerCase().includes('red') ? 'получил красную карточку' : 'получил карточку'
      : 'участвует в замене';
  return [
    '👤 Событие отслеживаемого игрока',
    '',
    `${player}: ${action}${minuteLabel(event) ? ` · ${minuteLabel(event)}` : ''}.`,
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    '',
    'Откройте MatchRadar для деталей.',
  ].join('\n');
}

function lineupPlayerMessage(row, favorite, eventType) {
  const player = String(favorite?.player_name || favorite?.playerName || 'Игрок');
  return [
    eventType === 'player.starting_lineup' ? '✅ Отслеживаемый игрок в старте' : 'ℹ️ Отслеживаемый игрок вне опубликованной заявки',
    '',
    player,
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    '',
    eventType === 'player.starting_lineup'
      ? 'Игрок есть в подтверждённом стартовом составе.'
      : 'Игрок не найден ни в старте, ни среди запасных в опубликованном составе. Это факт по заявке, а не диагноз травмы.',
  ].join('\n');
}

function aiMovementMessage(row, movement) {
  const strongest = movement?.strongest || {};
  const sideName = strongest.side === 'home'
    ? String(row?.home_name || 'Хозяева')
    : strongest.side === 'away'
      ? String(row?.away_name || 'Гости')
      : 'Ничья';
  return [
    '🧠 MatchRadar: оценка матча изменилась',
    '',
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    `Вероятность «${sideName}»: ${Number(strongest.from || 0).toFixed(1)}% → ${Number(strongest.to || 0).toFixed(1)}%.`,
    '',
    'Это изменение расчётной модели, а не гарантия результата.',
  ].join('\n');
}

function radarSignalMessage(row, signal) {
  const strongest = signal?.strongest || {};
  const sideName = strongest.side === 'home'
    ? String(row?.home_name || 'Хозяева')
    : strongest.side === 'away'
      ? String(row?.away_name || 'Гости')
      : 'Ничья';
  return [
    '📡 MatchRadar Radar: сильный сигнал',
    '',
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    `Лидер модели: ${sideName} · ${Number(strongest.probability || 0).toFixed(1)}%.`,
    `Radar Confidence: ${Math.round(Number(signal?.latest?.confidence || 0))}/100.`,
    '',
    'Сигнал сформирован по сохранённому снимку модели и не является гарантией результата.',
  ].join('\n');
}

function playerIdsForEvent(event = {}) {
  const ids = [positiveSafeInteger(event?.playerId ?? event?.player_id)];
  if (textCandidate(event?.type).toLowerCase() === 'subst') {
    ids.push(positiveSafeInteger(event?.assistPlayerId ?? event?.assist_player_id));
  }
  return [...new Set(ids.filter(Boolean))];
}

function favoritesForEvent(favorites = [], event = {}) {
  const ids = new Set(playerIdsForEvent(event));
  return asRows(favorites).filter(item => ids.has(
    positiveSafeInteger(item?.player_id ?? item?.playerId),
  ));
}

function lineupsByTeam(snapshot = {}) {
  const map = new Map();
  for (const team of asRows(snapshot?.teams)) {
    const teamId = positiveSafeInteger(team?.teamId ?? team?.team_id);
    if (teamId) map.set(teamId, team);
  }
  return map;
}

function lineupPlayerIds(team = {}) {
  return {
    starters: new Set(
      asRows(team?.startXI)
        .map(item => positiveSafeInteger(item?.id ?? item?.playerId))
        .filter(Boolean),
    ),
    substitutes: new Set(
      asRows(team?.substitutes)
        .map(item => positiveSafeInteger(item?.id ?? item?.playerId))
        .filter(Boolean),
    ),
  };
}

export function createSmartNotificationService({
  hasSupabase,
  prepareLiveNotificationConfig,
  getCache,
  setCache,
  loadRuntimeControls,
  supaSelectPaged,
  filterRecipients,
  loadFavoritePlayersByUser,
  loadLiveNotificationSnapshot,
  loadLineupSnapshot,
  getAnalysisTimelineSnapshots,
  loadLatestInPlayEstimate,
  loadScoreboardRecipients,
  deliverSmartNotification,
  recordOpsEvent,
  maxFixturesPerRun = SMART_NOTIFICATION_POLICY.maxFixturesPerRun,
  aiThresholdPp = SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
  aiCooldownSeconds = SMART_NOTIFICATION_POLICY.aiCooldownSeconds,
  radarConfidenceThreshold = SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
  radarOutcomeThreshold = SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
  radarCooldownSeconds = SMART_NOTIFICATION_POLICY.radarCooldownSeconds,
} = {}) {
  async function audience(rows, eventType, cfg) {
    if (typeof filterRecipients !== 'function') {
      return { rows: asRows(rows), checked: asRows(rows).length, blockedByPreference: 0, blockedByEntitlement: 0 };
    }
    return await filterRecipients(rows, eventType, cfg);
  }

  async function processSmartNotifications(cfg,{liveOnly=false,maxFixtures=2,timeBudgetMs=20000}={}) {
    const startedAt=Date.now();
    const exhausted=()=>liveOnly && Date.now()-startedAt>=timeBudgetMs;
    const recipientCursorKey=liveOnly?'smart-notifications:live-favorite-recipient-cursor:v1':'smart-notifications:favorite-recipient-cursor:v1';
    const fixtureCursorKey=liveOnly?'smart-notifications:live-fixture-cursor:v1':'smart-notifications:fixture-cursor:v1';
    if (!hasSupabase?.(cfg) || !cfg?.botToken) {
      return { ok: true, checked: 0, fixturesChecked: 0, sent: 0, duplicate: 0, cooldown: 0, failed: 0, unknown: 0 };
    }
    let runtime;
    try {
      if (typeof loadRuntimeControls !== 'function') throw new Error('runtime controls loader unavailable');
      runtime = await loadRuntimeControls(cfg);
    } catch (error) {
      await recordOpsEvent?.(cfg, {
        severity: 'error',
        source: 'smart_notifications',
        eventType: 'smart_notification_scheduler',
        code: 'SMART_NOTIFICATION_RUNTIME_CONTROLS_FAILED',
        message: error?.message || error,
        endpoint: 'cron:smart-notifications',
      }).catch(() => {});
      return { ok: false, checked: 0, fixturesChecked: 0, sent: 0, duplicate: 0, cooldown: 0, failed: 1, unknown: 0, runtimeUnavailable: true };
    }
    if (runtime?.value?.remindersEnabled === false) {
      return { ok: true, checked: 0, fixturesChecked: 0, sent: 0, duplicate: 0, cooldown: 0, failed: 0, unknown: 0, disabled: true };
    }

    const now = Date.now();
    const from = new Date(now - 4 * 60 * 60_000).toISOString();
    const to = new Date(now + 100 * 60_000).toISOString();
    let page;
    try {
      page = await supaSelectPaged(cfg, 'match_reminders', {
        enabled: 'eq.true',
        and: `(fixture_date.gte.${from},fixture_date.lte.${to})`,
      }, {
        pageSize: 250,
        maxRows: 1000,
        order: 'fixture_date.asc,fixture_id.asc,telegram_id.asc',
      });
    } catch (error) {
      await recordOpsEvent?.(cfg, {
        severity: 'error',
        source: 'smart_notifications',
        eventType: 'smart_notification_scheduler',
        code: 'SMART_NOTIFICATION_READ_FAILED',
        message: error?.message || error,
        endpoint: 'cron:smart-notifications',
      }).catch(() => {});
      return { ok: false, checked: 0, fixturesChecked: 0, sent: 0, duplicate: 0, cooldown: 0, failed: 1, unknown: 0 };
    }

    let favorites={rows:[],truncated:false};
    let favoriteReadFailed=false;
    let recentMinutes=new Map();
    if(typeof getCache==='function'){
      try{
        const [cursor,...batches]=await Promise.all([
          getCache(recipientCursorKey,cfg),
          ...[-1,0,1].map(offset=>getCache(`provider-fixtures:${new Date(now+offset*86400_000).toISOString().slice(0,10)}:v1`,cfg)),
        ]);
        recentMinutes=recentNotificationMinutes(batches,now);
        const readFavorites=async start=>{
          const uid=positiveSafeInteger(start?.userId);
          const page=await supaSelectPaged(cfg,'favorites',uid?{telegram_id:`gte.${uid}`}:{}, {pageSize:1000,maxRows:10000,order:'telegram_id.asc,team_id.asc'});
          if(!Array.isArray(page?.rows))throw new Error('Favorite notification audience unavailable.');
          return page;
        };
        let followed=await readFavorites(cursor);
        favorites=favoriteMatchRecipients(followed.rows,batches,now,1000,cursor,false,liveOnly);
        if(!favorites.rows.length && cursor && !followed.truncated){
          followed=await readFavorites(null);
          favorites=favoriteMatchRecipients(followed.rows,batches,now,1000,null,false,liveOnly);
        }
        if(!favorites.cursor && followed.truncated){
          const uid=positiveSafeInteger(followed.rows.at(-1)?.telegram_id);
          if(uid)favorites.cursor={userId:uid,fixtureId:0};
        }
        favorites.truncated ||= Boolean(followed?.truncated);
        // A team opt-out applies to automatic favorite discovery only.
        favorites.rows=asRows((await audience(favorites.rows,'team.match_day',cfg))?.rows);
      }catch{favoriteReadFailed=true;favorites={rows:[],truncated:false};}
    }
    const combined=new Map(asRows(page?.rows).map(row=>[`${row.telegram_id}:${row.fixture_id}`,row]));
    for(const row of favorites.rows){
      const key=`${row.telegram_id}:${row.fixture_id}`;
      const existing=combined.get(key);
      if(existing)combined.set(key,{...existing,_favoriteTeams:row._favoriteTeams,_favoriteOpponent:row._favoriteOpponent,_favoriteToday:row._favoriteToday});
      else combined.set(key,row);
    }
    const rows = [...combined.values()].filter(row=>!liveOnly || recentMinutes.has(Number(row.fixture_id)) && Date.parse(row.fixture_date)<=now);
    const groupedRows = groupByFixture(rows);
    const fixtureLimit = liveOnly?Math.min(2,positiveSafeInteger(maxFixtures)||2):(positiveSafeInteger(maxFixturesPerRun)
      || SMART_NOTIFICATION_POLICY.maxFixturesPerRun);
    let entries=[...groupedRows.entries()];
    if(typeof getCache==='function'&&typeof setCache==='function'&&entries.length>fixtureLimit){
      const cursor=positiveSafeInteger(await getCache(fixtureCursorKey,cfg).catch(()=>null));
      entries.sort((a,b)=>a[0]-b[0]);
      const next=entries.findIndex(([id])=>id>cursor);
      if(next>0)entries=[...entries.slice(next),...entries.slice(0,next)];
    }
    const groups = entries.slice(0, fixtureLimit);
    const truncated = Boolean(page?.truncated || favorites.truncated || groupedRows.size > groups.length);

    const summary = {
      ok: true,
      checked: rows.length,
      fixturesChecked: groups.length,
      sent: 0,
      duplicate: 0,
      cooldown: 0,
      retryPending: 0,
      failed: favoriteReadFailed ? 1 : 0,
      unknown: 0,
      blockedByPreference: 0,
      blockedByEntitlement: 0,
      staleSignals: 0,
      truncated,
    };

    if(liveOnly && exhausted())return {...summary,skipped:'live_discovery_budget'};
    if(liveOnly && groups.length){
      if(typeof prepareLiveNotificationConfig!=='function')return {...summary,skipped:'live_budget_unavailable'};
      const guarded=await prepareLiveNotificationConfig(cfg).catch(()=>null);
      if(!guarded)return {...summary,skipped:'live_provider_reserve'};
      cfg=guarded;
    }
    const deferredFixtures=new Set();
    let favoritesByUser = new Map();
    if (!liveOnly && typeof loadFavoritePlayersByUser === 'function') {
      try {
        const loadedFavorites = await loadFavoritePlayersByUser(rows.filter(row=>!row._favoriteOnly), cfg);
        if (loadedFavorites instanceof Map) favoritesByUser = loadedFavorites;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        await recordOpsEvent?.(cfg, {
          severity: 'warning',
          source: 'smart_notifications',
          eventType: 'smart_notification_probe',
          code: 'SMART_NOTIFICATION_FAVORITES_READ_FAILED',
          message: error?.message || error,
          endpoint: 'cron:smart-notifications',
        }).catch(() => {});
      }
    }

    const noteAudience = result => {
      summary.blockedByPreference += Number(result?.blockedByPreference || 0);
      summary.blockedByEntitlement += Number(result?.blockedByEntitlement || 0);
      return asRows(result?.rows);
    };
    const noteDelivery = result => {
      const state = String(result?.state || '');
      if (state === 'sent') summary.sent += 1;
      else if (state === 'duplicate' || state === 'retry_wait') summary.duplicate += 1;
      else if (state === 'cooldown') summary.cooldown += 1;
      else if (state === 'retry_pending') summary.retryPending += 1;
      else if (state === 'unknown') summary.unknown += 1;
      else if (state && state !== 'invalid') summary.failed += 1;
    };
    const safeAudience = async (inputRows, eventType) => {
      try {
        return noteAudience(await audience(inputRows, eventType, cfg));
      } catch (error) {
        summary.failed += 1;
        await recordOpsEvent?.(cfg, {
          severity: 'warning',
          source: 'smart_notifications',
          eventType: 'smart_notification_probe',
          code: 'SMART_NOTIFICATION_AUDIENCE_FILTER_FAILED',
          message: error?.message || error,
          endpoint: 'cron:smart-notifications',
          meta: { eventType },
        }).catch(() => {});
        return [];
      }
    };
    const safeDeliver = async input => {
      if(exhausted()){deferredFixtures.add(Number(input?.row?.fixture_id));summary.truncated=true;return;}
      try {
        if (typeof deliverSmartNotification !== 'function') {
          throw new Error('smart notification delivery unavailable');
        }
        noteDelivery(await deliverSmartNotification(input, cfg));
      } catch (error) {
        summary.failed += 1;
        await recordOpsEvent?.(cfg, {
          severity: 'warning',
          source: 'smart_notifications',
          eventType: 'smart_notification_delivery',
          code: 'SMART_NOTIFICATION_DELIVERY_FAILED',
          message: error?.message || error,
          endpoint: 'cron:smart-notifications',
          meta: {
            fixtureId: positiveSafeInteger(input?.row?.fixture_id ?? input?.row?.fixtureId),
            notificationType: textCandidate(input?.eventType),
          },
        }).catch(() => {});
      }
    };

    for (const [fixtureId, recipients] of groups) {
      if(exhausted()){deferredFixtures.add(fixtureId);summary.truncated=true;continue;}
      const fixtureDate = Date.parse(recipients[0]?.fixture_date || '');
      const minutesToKickoff = Number.isFinite(fixtureDate) ? (fixtureDate - now) / 60000 : null;
      // An edited scoreboard is silent in Telegram: send the short goal alert too.
      const matchGoalAudience = await safeAudience(recipients, 'match.goal');
      const explicitRecipients=liveOnly?[]:recipients.filter(row=>!row._favoriteOnly);
      const playerAudience = await safeAudience(explicitRecipients, 'player.goal');
      const aiAudience = await safeAudience(explicitRecipients, 'ai.probability_change');
      for(const row of recipients.filter(row=>row._favoriteToday)){
        const at=new Date(row.fixture_date).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
        await safeDeliver({row,eventType:'team.match_day',category:'teams',
          text:[row._favoriteTeams.length>1?'⭐ Любимые команды сегодня играют':`⭐ Любимая команда ${row._favoriteTeams[0]} сегодня играет`,
            row._favoriteTeams.length>1?`${row.home_name} — ${row.away_name}`:`Соперник: ${row._favoriteOpponent}`,`${row.league_name} · ${at} МСК`].join('\n'),
          dedupeKey:smartNotificationDedupeKey({fixtureId,eventType:'team.match_day',eventKey:'today'}),
        });
      }


      if(exhausted()){deferredFixtures.add(fixtureId);summary.truncated=true;continue;}
      if (minutesToKickoff !== null && minutesToKickoff <= 5 && minutesToKickoff >= -240
          && (matchGoalAudience.length || playerAudience.length)) {
        let snapshot = null;
        try {
          snapshot = await loadLiveNotificationSnapshot(fixtureId, cfg);
        } catch (error) {
          summary.failed += 1;
          await recordOpsEvent?.(cfg, {
            severity: 'warning',
            source: 'smart_notifications',
            eventType: 'smart_notification_probe',
            code: 'SMART_NOTIFICATION_EVENT_PROBE_FAILED',
            message: error?.message || error,
            endpoint: 'cron:smart-notifications',
            meta: { fixtureId },
          }).catch(() => {});
        }

        if (snapshot?.trusted === true && snapshot?.stale !== true) {
          const elapsed = minutesToKickoff < 0 ? Math.max(0, Math.floor(-minutesToKickoff)) : 0;
          const snapshotEvents = notificationEventsFromSnapshot(snapshot, { elapsed });
          for (const event of snapshotEvents) {
            const basicType = matchEventType(event);
            if (basicType) {
              const eligible = basicType === 'match.goal'
                ? matchGoalAudience
                : await safeAudience(recipients, basicType);
              for (const row of eligible) {
                if(basicType==='match.yellow_card' && (!recentMinutes.has(fixtureId) || integerCandidate(event.minute)===null || event.minute<recentMinutes.get(fixtureId)))continue;
                if(row._favoriteOnly && (row._favoriteMinMinute===null || integerCandidate(event.minute)===null || event.minute<row._favoriteMinMinute))continue;
                const dedupeKey = smartNotificationDedupeKey({
                  fixtureId,
                  eventType: basicType,
                  eventKey: normalizedEventKey(event),
                });
                await safeDeliver({
                  row,
                  eventType: basicType,
                  category: notificationCategory(basicType),
                  text: matchEventMessage(row, event, basicType),
                  dedupeKey,
                });
              }
            }

            const followedType = playerEventType(event);
            if (!followedType || !playerAudience.length) continue;
            const eventPlayerIds = new Set(playerIdsForEvent(event));
            if (!eventPlayerIds.size) continue;
            const candidateRows = playerAudience.filter(row => {
              const favorites = favoritesByUser.get(
                positiveSafeInteger(row?.telegram_id ?? row?.telegramId),
              ) || [];
              return favorites.some(item => eventPlayerIds.has(
                positiveSafeInteger(item?.player_id ?? item?.playerId),
              ));
            });
            const eligiblePlayers = followedType === 'player.goal'
              ? candidateRows
              : await safeAudience(candidateRows, followedType);

            for (const row of eligiblePlayers) {
              const favorites = favoritesForEvent(
                favoritesByUser.get(positiveSafeInteger(row?.telegram_id ?? row?.telegramId)) || [],
                event,
              );
              for (const favorite of favorites) {
                const playerId = positiveSafeInteger(favorite?.player_id ?? favorite?.playerId);
                const dedupeKey = smartNotificationDedupeKey({
                  fixtureId,
                  eventType: followedType,
                  playerId,
                  eventKey: normalizedEventKey(event),
                });
                await safeDeliver({
                  row,
                  eventType: followedType,
                  category: 'players',
                  text: playerEventMessage(row, event, followedType, favorite),
                  dedupeKey,
                });
              }
            }
          }
        }
      }

      if (minutesToKickoff !== null && minutesToKickoff <= 95 && minutesToKickoff >= -8 && playerAudience.length) {
        let lineupSnapshot = null;
        try { lineupSnapshot = await loadLineupSnapshot(fixtureId, cfg); } catch {}
        if (lineupSnapshot?.confirmed === true) {
          const byTeam = lineupsByTeam(lineupSnapshot);
          for (const row of playerAudience) {
            const favorites = favoritesByUser.get(
              positiveSafeInteger(row?.telegram_id ?? row?.telegramId),
            ) || [];
            for (const favorite of favorites) {
              const teamId = positiveSafeInteger(favorite?.team_id ?? favorite?.teamId);
              const playerId = positiveSafeInteger(favorite?.player_id ?? favorite?.playerId);
              const team = byTeam.get(teamId);
              if (!team || !playerId) continue;
              const ids = lineupPlayerIds(team);
              const eventType = ids.starters.has(playerId)
                ? 'player.starting_lineup'
                : ids.substitutes.has(playerId)
                  ? ''
                  : 'player.absence';
              if (!eventType) continue;
              const eligible = await safeAudience([row], eventType);
              if (!eligible.length) continue;
              const dedupeKey = smartNotificationDedupeKey({
                fixtureId,
                eventType,
                playerId,
                eventKey: 'confirmed-lineup',
              });
              await safeDeliver({
                row,
                eventType,
                category: 'players',
                text: lineupPlayerMessage(row, favorite, eventType),
                dedupeKey,
              });
            }
          }
        }
      }

      if (minutesToKickoff !== null && minutesToKickoff <= 180 && minutesToKickoff >= -2 && aiAudience.length) {
        let snapshots = [];
        try { snapshots = await getAnalysisTimelineSnapshots(fixtureId, cfg, 20); } catch {}
        const movement = aiProbabilityMovement(snapshots, {
          thresholdPp: aiThresholdPp,
          maxSignalAgeMinutes: SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
          now,
        });
        if (movement.reason === 'stale_signal') summary.staleSignals += 1;
        if (movement.significant) {
          const eventKey = `${movement.baseline.snapshotKey}:${movement.latest.snapshotKey}`;
          for (const row of aiAudience) {
            const dedupeKey = smartNotificationDedupeKey({
              fixtureId,
              eventType: 'ai.probability_change',
              eventKey,
            });
            await safeDeliver({
              row,
              eventType: 'ai.probability_change',
              category: 'aiRadar',
              text: aiMovementMessage(row, movement),
              dedupeKey,
              cooldownSeconds: aiCooldownSeconds,
            });
          }
        }

        const radarSignal = radarStrongSignalState(snapshots, {
          confidenceThreshold: radarConfidenceThreshold,
          outcomeThreshold: radarOutcomeThreshold,
          maxSignalAgeMinutes: SMART_NOTIFICATION_POLICY.maxSignalAgeMinutes,
          now,
        });
        if (radarSignal.reason === 'stale_signal' && movement.reason !== 'stale_signal') summary.staleSignals += 1;
        if (radarSignal.significant) {
          const eventKey = `${radarSignal.latest.snapshotKey}:${radarSignal.strongest.side}`;
          for (const row of aiAudience) {
            const dedupeKey = smartNotificationDedupeKey({
              fixtureId,
              eventType: 'radar.strong_signal',
              eventKey,
            });
            await safeDeliver({
              row,
              eventType: 'radar.strong_signal',
              category: 'aiRadar',
              text: radarSignalMessage(row, radarSignal),
              dedupeKey,
              cooldownSeconds: radarCooldownSeconds,
            });
          }
        }
      }
    }

    if(Object.hasOwn(favorites,'cursor') && typeof setCache==='function'){
      const processed=new Set(groups.map(([fixtureId])=>fixtureId).filter(id=>!deferredFixtures.has(id)));
      let progress=null,complete=true;
      for(const row of favorites.rows){
        if(!processed.has(row.fixture_id)){complete=false;break;}
        progress={userId:row.telegram_id,fixtureId:row.fixture_id};
      }
      // Never move a recipient page past a fixture deferred by the run limit.
      const nextCursor=complete ? (favorites.cursor||{userId:0,fixtureId:0}) : progress;
      if(nextCursor){
        try{await setCache(recipientCursorKey,0,nextCursor,cfg,60);}
        catch{summary.failed+=1;}
      }
    }
    if(groups.some(([id])=>!deferredFixtures.has(id)) && typeof setCache==='function'){
      try{await setCache(fixtureCursorKey,0,groups.filter(([id])=>!deferredFixtures.has(id)).at(-1)[0],cfg,60);}
      catch{summary.failed+=1;}
    }
    if(liveOnly && summary.truncated && !summary.failed && !summary.unknown){summary.status='degraded';summary.reason='bounded_live_tick';}
    summary.ok = !(summary.failed || summary.unknown || summary.truncated);
    if (summary.sent || summary.failed || summary.unknown || summary.truncated || summary.blockedByEntitlement || summary.blockedByPreference) {
      await recordOpsEvent?.(cfg, {
        severity: summary.ok ? 'info' : 'warning',
        source: 'smart_notifications',
        eventType: 'smart_notification_scheduler',
        code: summary.ok ? 'SMART_NOTIFICATION_RUN_OK' : 'SMART_NOTIFICATION_RUN_DEGRADED',
        message: `Smart Notifications: fixtures ${summary.fixturesChecked}, sent ${summary.sent}, dedupe ${summary.duplicate}, cooldown ${summary.cooldown}, failed ${summary.failed}.`,
        endpoint: 'cron:smart-notifications',
        meta: summary,
      }).catch(() => {});
    }
    return summary;
  }

  return Object.freeze({
    processSmartNotifications,
  });
}
