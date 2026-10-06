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

function matchEventMessage(row, event, eventType) {
  const title = eventType === 'match.goal' ? '⚽ Гол' : '🟥 Красная карточка';
  const actor = String(event.playerName || event.player || '').trim();
  const team = String(event.teamName || '').trim();
  return [
    title,
    '',
    `${row?.home_name || 'Хозяева'} — ${row?.away_name || 'Гости'}`,
    [minuteLabel(event), team].filter(Boolean).join(' · '),
    actor,
    '',
    'Откройте MatchRadar, чтобы увидеть обновлённый контекст матча.',
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
  loadRuntimeControls,
  supaSelectPaged,
  filterRecipients,
  loadFavoritePlayersByUser,
  loadLiveNotificationSnapshot,
  loadLineupSnapshot,
  getAnalysisTimelineSnapshots,
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

  async function processSmartNotifications(cfg) {
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

    const rows = asRows(page?.rows);
    const groupedRows = groupByFixture(rows);
    const fixtureLimit = positiveSafeInteger(maxFixturesPerRun)
      || SMART_NOTIFICATION_POLICY.maxFixturesPerRun;
    const groups = [...groupedRows.entries()].slice(0, fixtureLimit);
    const truncated = Boolean(page?.truncated || groupedRows.size > groups.length);

    const summary = {
      ok: true,
      checked: rows.length,
      fixturesChecked: groups.length,
      sent: 0,
      duplicate: 0,
      cooldown: 0,
      retryPending: 0,
      failed: 0,
      unknown: 0,
      blockedByPreference: 0,
      blockedByEntitlement: 0,
      staleSignals: 0,
      truncated,
    };

    let favoritesByUser = new Map();
    if (typeof loadFavoritePlayersByUser === 'function') {
      try {
        const loadedFavorites = await loadFavoritePlayersByUser(rows, cfg);
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
      const fixtureDate = Date.parse(recipients[0]?.fixture_date || '');
      const minutesToKickoff = Number.isFinite(fixtureDate) ? (fixtureDate - now) / 60000 : null;
      const matchGoalAudience = await safeAudience(recipients, 'match.goal');
      const playerAudience = await safeAudience(recipients, 'player.goal');
      const aiAudience = await safeAudience(recipients, 'ai.probability_change');

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
          for (const event of notificationEventsFromSnapshot(snapshot, { elapsed })) {
            const basicType = matchEventType(event);
            if (basicType) {
              const eligible = basicType === 'match.goal'
                ? matchGoalAudience
                : await safeAudience(recipients, basicType);
              for (const row of eligible) {
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
