// Ежедневный пост в Telegram-канал (решение Сергея 12.10): «Матчи дня по версии
// модели». Раз в сутки, в утреннее окно, из предматчевых снимков модели
// (model_predictions) — без новых расчётов и без ставочных формулировок.
//
// Пока CHANNEL_DAILY_POST_ENABLED не включён, задание ничего не публикует, а раз
// в сутки пишет предпросмотр поста в ops_events — чтобы Сергей увидел текст до
// первой публикации. Повторная публикация за день невозможна: ключ
// идемпотентности `channel-daily:<дата>` в существующем журнале публикаций.

import { publishChannelMessage } from './channel-publisher.js';

const RAW_FIXTURES_CACHE_KEY = date => `provider-fixtures:${date}:v1`;
const PREVIEW_CACHE_KEY = date => `channel-daily-preview:${date}:v1`;
const POST_HOUR_UTC = 8; // 11:00 МСК
const POST_WINDOW_MINUTES = 15;
const MAX_MATCHES = 5;
const MIN_LEAD_MINUTES = 30;
const UPCOMING = new Set(['NS', 'TBD']);
const MSK_OFFSET_MS = 3 * 3600_000;
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function mskParts(ms) {
  const date = new Date(ms + MSK_OFFSET_MS);
  return {
    time: `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`,
    day: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`,
  };
}

/** Кандидаты: сегодняшние предстоящие матчи с валидным предматчевым снимком. */
export function dailyPostMatches(rows = [], predictions = {}, nowMs = Date.now(), { isMain = () => true } = {}) {
  const seen = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = plainObject(row) || {};
    const fixture = plainObject(item.fixture) || {};
    const id = positiveId(fixture.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const status = String(plainObject(fixture.status)?.short || '').toUpperCase();
    const kickoff = Date.parse(String(fixture.date || ''));
    if (!UPCOMING.has(status) || !Number.isFinite(kickoff) || kickoff - nowMs < MIN_LEAD_MINUTES * 60_000) continue;
    const p = plainObject(predictions[id]);
    if (!p) continue;
    const values = [p.home, p.draw, p.away].map(Number);
    const sum = values.reduce((total, value) => total + value, 0);
    if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 100) || sum < 98 || sum > 102) continue;
    const teams = plainObject(item.teams) || {};
    const home = cleanName(plainObject(teams.home)?.name);
    const away = cleanName(plainObject(teams.away)?.name);
    if (!home || !away) continue;
    let main = false;
    try { main = isMain(item) === true; } catch { main = false; }
    result.push({ fixtureId: id, kickoff, home, away, league: cleanName(plainObject(item.league)?.name), probabilities: { home: values[0], draw: values[1], away: values[2] }, main });
  }
  // Сначала главные матчи, потом по времени начала.
  return result
    .sort((a, b) => Number(b.main) - Number(a.main) || a.kickoff - b.kickoff)
    .slice(0, MAX_MATCHES)
    .sort((a, b) => a.kickoff - b.kickoff);
}

export function dailyPostText(matches = [], nowMs = Date.now()) {
  if (!matches.length) return '';
  const percent = value => `${Math.round(value)}%`;
  const lines = [`⚽ Матчи дня по версии модели MatchRadar — ${mskParts(nowMs).day}`, ''];
  for (const match of matches) {
    lines.push(`${mskParts(match.kickoff).time} МСК · ${match.home} — ${match.away}${match.league ? ` (${match.league})` : ''}`);
    lines.push(`${match.home} ${percent(match.probabilities.home)} · Ничья ${percent(match.probabilities.draw)} · ${match.away} ${percent(match.probabilities.away)}`);
    lines.push('');
  }
  lines.push('Оценки модели до матча: составы, объявленные позже, в них ещё не учтены. Это аналитика, а не рекомендация. Разбор каждого матча — в MatchRadar.');
  return lines.join('\n').slice(0, 3900);
}

export function createChannelDailyPostJob(deps = {}) {
  const {
    claimIdempotency,
    clock,
    completeIdempotency,
    fixtureTelegramDeepLink,
    getCache,
    getModelProbabilities,
    isMainFixture,
    loadProviderFixturesForDate,
    recordOpsEvent,
    releaseIdempotency,
    setCache,
  } = deps;

  const now = () => {
    try {
      const value = typeof clock === 'function' ? Number(clock()) : Date.now();
      return Number.isFinite(value) ? value : Date.now();
    } catch {
      return Date.now();
    }
  };

  async function todayRows(date, cfg) {
    try {
      const cached = plainObject(await getCache(RAW_FIXTURES_CACHE_KEY(date), cfg));
      if (cached && Array.isArray(cached.fixtures)) return cached.fixtures;
      const rows = await loadProviderFixturesForDate(date, cfg, { allowNetwork: true });
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function record(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return;
    try { await recordOpsEvent(cfg, event); } catch {}
  }

  async function processChannelDailyPost(cfg, scheduledAt = new Date(now())) {
    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : new Date(now());
    if (at.getUTCHours() !== POST_HOUR_UTC || at.getUTCMinutes() >= POST_WINDOW_MINUTES) return { ok: true, reason: 'outside_window' };
    const date = at.toISOString().slice(0, 10);
    const enabled = cfg?.channelDailyPostEnabled === true;

    if (!enabled) {
      // Предпросмотр — один раз за день.
      try {
        if (await getCache(PREVIEW_CACHE_KEY(date), cfg)) return { ok: true, reason: 'preview_already_recorded' };
      } catch {}
    }

    const rows = await todayRows(date, cfg);
    const ids = rows.map(row => positiveId(plainObject(plainObject(row)?.fixture)?.id)).filter(Boolean).slice(0, 200);
    let predictions = {};
    try {
      predictions = plainObject(await getModelProbabilities(ids, cfg)) || {};
    } catch {
      return { ok: false, reason: 'predictions_lookup_failed' };
    }
    const matches = dailyPostMatches(rows, predictions, at.getTime(), { isMain: isMainFixture });
    const text = dailyPostText(matches, at.getTime());
    if (!text) return { ok: true, reason: 'no_matches' };

    if (!enabled) {
      await record(cfg, {
        severity: 'info',
        source: 'channel_publisher',
        eventType: 'channel_daily_post_preview',
        code: 'CHANNEL_DAILY_POST_PREVIEW',
        message: text.slice(0, 1800),
        endpoint: 'cron:channel-daily-post',
        meta: { date, matches: matches.length, enabled: false },
      });
      try { await setCache(PREVIEW_CACHE_KEY(date), 0, { date, recordedAt: new Date(now()).toISOString() }, cfg, 1440); } catch {}
      return { ok: true, reason: 'preview_recorded', matches: matches.length };
    }

    try {
      const link = await fixtureTelegramDeepLink(cfg, matches[0].fixtureId, { source: 'channel', campaign: 'daily_post', content: 'auto' });
      const result = await publishChannelMessage({
        cfg,
        fixtureId: matches[0].fixtureId,
        text,
        ctaUrl: link?.url,
        idempotencyKey: `channel-daily:${date}`,
      }, {
        claimIdempotency: (key, meta) => claimIdempotency(key, meta, cfg),
        completeIdempotency: (key, meta) => completeIdempotency(key, meta, cfg),
        releaseIdempotency: (key, meta) => releaseIdempotency(key, meta, cfg),
      });
      if (result?.published) {
        await record(cfg, {
          severity: 'info',
          source: 'channel_publisher',
          eventType: 'channel_daily_post',
          code: 'CHANNEL_DAILY_POST_PUBLISHED',
          message: `Пост «Матчи дня» опубликован: ${matches.length} матчей.`,
          endpoint: 'cron:channel-daily-post',
          meta: { date, matches: matches.length, messageId: result.messageId || null },
        });
      }
      return { ok: result?.ok !== false, reason: result?.published ? 'published' : (result?.duplicate ? 'duplicate' : String(result?.code || result?.reason || 'not_published')), matches: matches.length };
    } catch (error) {
      await record(cfg, {
        severity: 'warning',
        source: 'channel_publisher',
        eventType: 'channel_daily_post',
        code: String(error?.code || 'CHANNEL_DAILY_POST_FAILED'),
        message: String(error?.message || error).slice(0, 300),
        endpoint: 'cron:channel-daily-post',
        meta: { date, deliveryUncertain: error?.deliveryUncertain === true },
      });
      return { ok: false, reason: 'publish_failed' };
    }
  }

  return Object.freeze({ processChannelDailyPost });
}
