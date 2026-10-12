// «Перелом матча» (решение Сергея 13.10): если по ходу игры оценка модели
// резко развернулась — фаворит до матча потерял не меньше 25 п. п., а лидером
// оценки стал соперник, — сообщаем:
//   • лично — тем, у кого стоит напоминание на матч или в нём играет любимая
//     команда (существующая доставка smart-уведомлений: дедупликация, настройки
//     «Матчи»/«Команды», один раз на матч);
//   • в канал — только главные турниры и не больше трёх постов за день (МСК).
//     Пока CHANNEL_SWING_POST_ENABLED выключен, вместо поста пишется
//     предпросмотр в ops_events (CHANNEL_SWING_POST_PREVIEW).
//
// Только данные, которые уже есть: предматчевый снимок model_predictions и
// свежая точка кривой по ходу матча (analysis_timeline_snapshots, in-play:*).
// Запросов к источнику данных задание не делает.

import { publishChannelMessage } from './channel-publisher.js';
import { bettingFree } from './channel-daily-post-job.js';
import { smartNotificationDedupeKey } from './smart-notification-policy.js';

export const MATCH_SWING_POLICY = Object.freeze({
  minFavoriteGapPp: 10,
  minDropPp: 25,
  minLeaderProb: 45,
  maxPointAgeMs: 10 * 60_000,
  maxSwingsPerRun: 10,
  channelDailyCap: 3,
  maxRecipientsPerFixture: 10000,
});

const LIVE_STATUSES = new Set(['1H', 'HT', '2H']);
const MSK_OFFSET_MS = 3 * 3600_000;
const SWING_EVENT_KEY = 'swing';
const SLOT_KEY = (date, slot) => `telegram:channel-publish:v1:swing-slot:${date}:${slot}`;
const DONE_KEY = fixtureId => `telegram:channel-publish:v1:swing-done:${fixtureId}`;

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

function cleanName(value, fallback) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return text || fallback;
}

/** Три вероятности 1/X/2 в процентах; сумма 98–102, иначе null. */
export function validProbabilities(value) {
  const source = plainObject(value);
  if (!source) return null;
  const values = ['home', 'draw', 'away'].map(key => Number(source[key]));
  if (!values.every(number => Number.isFinite(number) && number >= 0 && number <= 100)) return null;
  const sum = values[0] + values[1] + values[2];
  if (sum < 98 || sum > 102) return null;
  return { home: values[0], draw: values[1], away: values[2] };
}

/**
 * Перелом: у фаворита до матча (отрыв от соперника ≥ 10 п. п.) оценка победы
 * упала на ≥ 25 п. п., а соперник стал лидером оценки (≥ 45% и выше ничьей и
 * фаворита). Рост ничьей к концу игры без голов переломом не считается.
 */
export function matchSwing(prematchInput, pointInput, policy = MATCH_SWING_POLICY) {
  const prematch = validProbabilities(prematchInput);
  const point = plainObject(pointInput);
  const now = validProbabilities(point);
  if (!prematch || !now || !point) return null;
  if (!LIVE_STATUSES.has(String(point.status || '').toUpperCase())) return null;
  const homeGoals = goals(safeRead(point.score, 'home'));
  const awayGoals = goals(safeRead(point.score, 'away'));
  const minute = Number(point.minute);
  if (homeGoals === null || awayGoals === null || !Number.isInteger(minute) || minute < 0 || minute > 130) return null;
  const favorite = prematch.home >= prematch.away ? 'home' : 'away';
  const other = favorite === 'home' ? 'away' : 'home';
  if (Math.abs(prematch.home - prematch.away) < policy.minFavoriteGapPp) return null;
  const drop = prematch[favorite] - now[favorite];
  if (drop < policy.minDropPp) return null;
  if (now[other] < policy.minLeaderProb || now[other] <= now.draw || now[other] <= now[favorite]) return null;
  return {
    favorite,
    other,
    prematch,
    now,
    drop: Math.round(drop),
    minute,
    status: String(point.status).toUpperCase(),
    score: { home: homeGoals, away: awayGoals },
  };
}

function percent(value) {
  return `${Math.round(Number(value))}%`;
}

function minuteText(swing) {
  return swing.status === 'HT' ? 'перерыв' : `${swing.minute}′`;
}

/** Текст сообщения: только числа из предматчевого снимка и свежей точки. */
export function matchSwingText(match, swing, { channel = false } = {}) {
  const home = cleanName(match?.homeName, 'Хозяева');
  const away = cleanName(match?.awayName, 'Гости');
  const names = { home, away };
  const lines = [
    '⚡ Перелом матча',
    '',
    `${home} ${swing.score.home}:${swing.score.away} ${away} · ${minuteText(swing)}`,
    `До матча модель отдавала преимущество команде ${names[swing.favorite]}: ${percent(swing.prematch[swing.favorite])}. Сейчас — ${percent(swing.now[swing.favorite])}.`,
    `${names[swing.other]} — ${percent(swing.now[swing.other])} · ничья — ${percent(swing.now.draw)}.`,
    '',
    'Оценка модели по счёту и оставшемуся времени. Это аналитика, а не рекомендация.',
  ];
  if (channel) lines.push('Как менялась оценка — в MatchRadar.');
  return lines.join('\n');
}

function mskDate(ms) {
  return new Date(ms + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

export function createMatchSwingJob(deps = {}) {
  const {
    claimIdempotency,
    clock,
    completeIdempotency,
    deliverSmartNotification,
    filterRecipients,
    fixtureTelegramDeepLink,
    getCache,
    hasSupabase,
    isTopLeague,
    loadRuntimeControls,
    recordOpsEvent,
    releaseIdempotency,
    supaSelectMany,
    supaSelectPaged,
  } = deps;
  for (const [name, fn] of Object.entries({ claimIdempotency, completeIdempotency, deliverSmartNotification, getCache, hasSupabase, releaseIdempotency, supaSelectMany, supaSelectPaged })) {
    if (typeof fn !== 'function') throw new TypeError(`Match swing job requires ${name}.`);
  }

  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  // true — событие сохранено в Supabase.
  async function record(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      const row = await recordOpsEvent(cfg, event);
      return row?._persistenceStatus === 'persistent';
    } catch {
      return false;
    }
  }

  // Последняя свежая точка по ходу матча для каждого матча.
  async function recentPoints(nowMs, cfg) {
    const since = new Date(nowMs - MATCH_SWING_POLICY.maxPointAgeMs).toISOString();
    const rows = await supaSelectMany(cfg, 'analysis_timeline_snapshots', {
      snapshot_key: 'like.in-play:*',
      captured_at: `gte.${since}`,
    }, {
      limit: 300,
      order: 'captured_at.desc',
      select: 'fixture_id,captured_at,match_status,match_minute,home_prob,draw_prob,away_prob,provenance',
    });
    const latest = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = positiveId(safeRead(row, 'fixture_id'));
      if (!id || latest.has(id)) continue;
      latest.set(id, {
        fixtureId: id,
        status: String(safeRead(row, 'match_status') || ''),
        minute: Number(safeRead(row, 'match_minute')),
        home: safeRead(row, 'home_prob'),
        draw: safeRead(row, 'draw_prob'),
        away: safeRead(row, 'away_prob'),
        score: plainObject(safeRead(plainObject(safeRead(row, 'provenance')), 'score')),
      });
    }
    return latest;
  }

  async function predictions(ids, cfg) {
    const rows = await supaSelectMany(cfg, 'model_predictions', { fixture_id: `in.(${ids.join(',')})` }, {
      limit: ids.length + 5,
      select: 'fixture_id,league_id,league_name,home_id,away_id,home_name,away_name,home_prob,draw_prob,away_prob',
    });
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = positiveId(safeRead(row, 'fixture_id'));
      const probabilities = validProbabilities({ home: safeRead(row, 'home_prob'), draw: safeRead(row, 'draw_prob'), away: safeRead(row, 'away_prob') });
      if (!id || !probabilities || result.has(id)) continue;
      result.set(id, {
        fixtureId: id,
        leagueId: positiveId(safeRead(row, 'league_id')),
        leagueName: String(safeRead(row, 'league_name') || ''),
        homeId: positiveId(safeRead(row, 'home_id')),
        awayId: positiveId(safeRead(row, 'away_id')),
        homeName: safeRead(row, 'home_name'),
        awayName: safeRead(row, 'away_name'),
        probabilities,
      });
    }
    return result;
  }

  // Все строки постранично (ревью Codex #869): без молчаливого обрезания.
  async function allRows(cfg, table, params, summary) {
    const page = await supaSelectPaged(cfg, table, params, {
      pageSize: 1000,
      maxRows: MATCH_SWING_POLICY.maxRecipientsPerFixture,
      order: 'telegram_id.asc',
    });
    if (page?.truncated) summary.truncated += 1;
    return Array.isArray(page?.rows) ? page.rows : [];
  }

  function userIds(rows) {
    const ids = new Set();
    for (const row of rows) {
      const id = positiveId(safeRead(row, 'telegram_id'));
      if (id) ids.add(id);
    }
    return ids;
  }

  // Получатели: напоминание на матч (match.swing) и любимая команда (team.swing).
  // Один перелом — одно сообщение человеку на матч (ревью Codex #869): человек
  // с тем и другим получает его по напоминанию, а тот, кому сообщение уже
  // ушло по одному поводу, не получает его по другому (например, снял
  // напоминание во время матча, но команда осталась любимой).
  async function personalAudience(match, cfg, summary) {
    const base = { fixture_id: match.fixtureId, home_name: cleanName(match.homeName, 'Хозяева'), away_name: cleanName(match.awayName, 'Гости') };
    const reminders = userIds(await allRows(cfg, 'match_reminders', { fixture_id: `eq.${match.fixtureId}`, enabled: 'eq.true' }, summary));
    const teamIds = [match.homeId, match.awayId].filter(Boolean);
    const fans = teamIds.length
      ? userIds(await allRows(cfg, 'favorites', { team_id: `in.(${teamIds.join(',')})` }, summary))
      : new Set();
    const delivered = await allRows(cfg, 'smart_notification_deliveries', {
      fixture_id: `eq.${match.fixtureId}`,
      event_type: 'in.("match.swing","team.swing")',
    }, summary);
    const deliveredAs = type => new Set(delivered
      .filter(row => String(safeRead(row, 'event_type') || '') === type)
      .map(row => positiveId(safeRead(row, 'telegram_id')))
      .filter(Boolean));
    const viaTeam = deliveredAs('team.swing');
    const viaMatch = deliveredAs('match.swing');
    const reminderRows = [...reminders]
      .filter(id => !viaTeam.has(id))
      .map(id => ({ ...base, telegram_id: id }));
    const fanRows = [...fans]
      .filter(id => !reminders.has(id) && !viaMatch.has(id))
      .map(id => ({ ...base, telegram_id: id }));
    return [
      { eventType: 'match.swing', category: 'match', rows: reminderRows },
      { eventType: 'team.swing', category: 'teams', rows: fanRows },
    ];
  }

  async function notifyPersonal(match, swing, cfg, summary) {
    let groups;
    try {
      groups = await personalAudience(match, cfg, summary);
    } catch {
      summary.failed += 1;
      return;
    }
    const text = matchSwingText(match, swing);
    for (const group of groups) {
      if (!group.rows.length) continue;
      let eligible = group.rows;
      if (typeof filterRecipients === 'function') {
        try {
          const filtered = await filterRecipients(group.rows, group.eventType, cfg);
          eligible = Array.isArray(filtered?.rows) ? filtered.rows : [];
        } catch {
          summary.failed += 1;
          continue;
        }
      }
      const dedupeKey = smartNotificationDedupeKey({ fixtureId: match.fixtureId, eventType: group.eventType, eventKey: SWING_EVENT_KEY });
      for (const row of eligible) {
        try {
          const result = await deliverSmartNotification({ row, eventType: group.eventType, category: group.category, text, dedupeKey }, cfg);
          const state = String(result?.state || '');
          if (state === 'sent') summary.sent += 1;
          else if (state === 'duplicate' || state === 'cooldown' || state === 'retry_wait') summary.duplicate += 1;
          else if (state && state !== 'invalid') summary.failed += 1;
        } catch {
          summary.failed += 1;
        }
      }
    }
  }

  // Канал: главный турнир, имена без букмекерских брендов, ≤ 3 постов за день (МСК).
  function channelEligible(match) {
    const home = bettingFree(cleanName(match.homeName, ''));
    const away = bettingFree(cleanName(match.awayName, ''));
    if (!home || !away) return false;
    try {
      return typeof isTopLeague === 'function' && isTopLeague(match.leagueId, match.leagueName) === true;
    } catch {
      return false;
    }
  }

  async function postToChannel(match, swing, cfg, nowMs, summary) {
    if (!channelEligible(match)) return;
    const text = matchSwingText(match, swing, { channel: true });
    if (cfg?.channelSwingPostEnabled !== true) {
      // Предпросмотр: одна запись на матч (transitionKey), пост не публикуется.
      if (await record(cfg, {
        severity: 'info',
        source: 'channel_publisher',
        eventType: 'channel_swing_post_preview',
        code: 'CHANNEL_SWING_POST_PREVIEW',
        transitionKey: `channel-swing-preview:${match.fixtureId}`,
        message: text,
        endpoint: 'cron:match-swing',
        meta: { fixtureId: match.fixtureId, enabled: false },
      })) summary.previews += 1;
      return;
    }
    try {
      if (await getCache(DONE_KEY(match.fixtureId), cfg)) return;
    } catch {
      return;
    }
    const date = mskDate(nowMs);
    let slot = null;
    for (let index = 1; index <= MATCH_SWING_POLICY.channelDailyCap; index += 1) {
      const key = SLOT_KEY(date, index);
      const claim = await claimIdempotency(key, { fixtureId: match.fixtureId }, cfg).catch(() => ({ unavailable: true }));
      if (claim?.unavailable === true) return;
      if (claim?.claimed === true) {
        slot = { key, claimId: claim.claimId };
        break;
      }
    }
    if (!slot) {
      summary.channelCapped += 1;
      return;
    }
    try {
      const link = typeof fixtureTelegramDeepLink === 'function'
        ? await fixtureTelegramDeepLink(cfg, match.fixtureId, { source: 'channel', campaign: 'match_swing', content: 'auto' })
        : null;
      const result = await publishChannelMessage({
        cfg,
        fixtureId: match.fixtureId,
        text,
        ctaUrl: link?.url,
        idempotencyKey: `channel-swing:${match.fixtureId}`,
      }, {
        claimIdempotency: (key, meta) => claimIdempotency(key, meta, cfg),
        completeIdempotency: (key, meta) => completeIdempotency(key, meta, cfg),
        releaseIdempotency: (key, meta) => releaseIdempotency(key, meta, cfg),
      });
      if (result?.published) {
        await completeIdempotency(slot.key, { claimId: slot.claimId, fixtureId: match.fixtureId, messageId: result.messageId }, cfg);
        await completeIdempotency(DONE_KEY(match.fixtureId), { fixtureId: match.fixtureId, messageId: result.messageId }, cfg);
        summary.channelPosted += 1;
        await record(cfg, {
          severity: 'info',
          source: 'channel_publisher',
          eventType: 'channel_swing_post',
          code: 'CHANNEL_SWING_POST_PUBLISHED',
          message: `Пост «Перелом матча» опубликован (матч ${match.fixtureId}).`,
          endpoint: 'cron:match-swing',
          meta: { fixtureId: match.fixtureId, messageId: result.messageId || null, slot: slot.key.slice(-1) },
        });
        return;
      }
      // Пост не вышел (повтор, выключенный публикатор, сбой) — слот свободен.
      await releaseIdempotency(slot.key, { claimId: slot.claimId, fixtureId: match.fixtureId }, cfg);
      if (result?.duplicate) await completeIdempotency(DONE_KEY(match.fixtureId), { fixtureId: match.fixtureId }, cfg).catch(() => null);
    } catch (error) {
      // Исход публикации неизвестен — слот не освобождаем: лучше пропустить пост, чем превысить лимит.
      summary.failed += 1;
      await record(cfg, {
        severity: 'warning',
        source: 'channel_publisher',
        eventType: 'channel_swing_post',
        code: String(error?.code || 'CHANNEL_SWING_POST_FAILED'),
        message: String(error?.message || error).slice(0, 300),
        endpoint: 'cron:match-swing',
        meta: { fixtureId: match.fixtureId, deliveryUncertain: error?.deliveryUncertain === true },
      });
    }
  }

  async function processMatchSwings(cfg, scheduledAt = new Date(now())) {
    const summary = { ok: true, checked: 0, swings: 0, sent: 0, duplicate: 0, previews: 0, channelPosted: 0, channelCapped: 0, truncated: 0, failed: 0 };
    let storage = false;
    try {
      storage = hasSupabase(cfg) === true;
    } catch {
      storage = false;
    }
    if (!storage) return { ...summary, reason: 'storage_unavailable' };
    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt.getTime() : now();

    let points;
    try {
      points = await recentPoints(at, cfg);
    } catch {
      return { ...summary, ok: false, reason: 'points_lookup_failed' };
    }
    summary.checked = points.size;
    if (!points.size) return { ...summary, reason: 'no_live_points' };

    let matches;
    try {
      matches = await predictions([...points.keys()], cfg);
    } catch {
      return { ...summary, ok: false, reason: 'predictions_lookup_failed' };
    }

    // Личные сообщения подчиняются общему выключателю напоминаний в админке.
    let personalEnabled = true;
    if (typeof loadRuntimeControls === 'function') {
      try {
        const runtime = await loadRuntimeControls(cfg);
        personalEnabled = runtime?.value?.remindersEnabled !== false;
      } catch {
        personalEnabled = false;
      }
    }

    const swings = [];
    for (const [id, point] of points) {
      const match = matches.get(id);
      const swing = match ? matchSwing(match.probabilities, point) : null;
      if (swing) swings.push({ match, swing });
    }
    summary.swings = swings.length;
    for (const { match, swing } of swings.slice(0, MATCH_SWING_POLICY.maxSwingsPerRun)) {
      if (personalEnabled) await notifyPersonal(match, swing, cfg, summary);
      await postToChannel(match, swing, cfg, at, summary);
    }

    summary.ok = summary.failed === 0 && summary.truncated === 0;
    if (summary.sent || summary.failed || summary.truncated || summary.channelPosted || summary.previews) {
      await record(cfg, {
        severity: summary.ok ? 'info' : 'warning',
        source: 'smart_notifications',
        eventType: 'match_swing_run',
        code: summary.ok ? 'MATCH_SWING_RUN' : 'MATCH_SWING_RUN_DEGRADED',
        message: `Перелом матча: переломов ${summary.swings}, личных сообщений ${summary.sent}, постов ${summary.channelPosted}, предпросмотров ${summary.previews}, ошибок ${summary.failed}${summary.truncated ? `, список получателей обрезан (${summary.truncated})` : ''}.`,
        endpoint: 'cron:match-swing',
        meta: summary,
      });
    }
    return summary;
  }

  return Object.freeze({ processMatchSwings });
}
