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
// Метка «предпросмотр за день записан» — через тот же журнал идемпотентности,
// что и публикации: заявка вставляется в общую базу атомарно (ревью Codex #860),
// поэтому другой изолят или следующий запуск cron-runner не продублирует части.
const PREVIEW_CLAIM_KEY = date => `telegram:channel-publish:v1:daily-preview:${date}`;
const POST_HOUR_UTC = 8; // 11:00 МСК
const POST_WINDOW_MINUTES = 15;
const MAX_MATCHES = 5;
const MIN_LEAD_MINUTES = 30;
const UPCOMING = new Set(['NS', 'TBD']);
const MSK_OFFSET_MS = 3 * 3600_000;
const PREDICTION_CHUNK = 200;
const MAX_PREDICTION_CHUNKS = 5;
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

// Календарный день по Москве: матч в 22:30 UTC — это уже следующий день МСК
// (ревью Codex #860), в пост «на сегодня» он не попадает.
function mskDateKey(ms) {
  return new Date(ms + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function upcomingToday(item, nowMs) {
  const fixture = plainObject(item.fixture) || {};
  const status = String(plainObject(fixture.status)?.short || '').toUpperCase();
  const kickoff = Date.parse(String(fixture.date || ''));
  if (!UPCOMING.has(status) || !Number.isFinite(kickoff) || kickoff - nowMs < MIN_LEAD_MINUTES * 60_000) return null;
  return mskDateKey(kickoff) === mskDateKey(nowMs) ? kickoff : null;
}

function safeMain(isMain, item) {
  try { return isMain(item) === true; } catch { return false; }
}

/**
 * Id подходящих матчей для запроса снимков модели: сначала главные, потом по
 * времени начала — чтобы лимит запроса не отрезал главные матчи дня.
 */
export function dailyPostCandidateIds(rows = [], nowMs = Date.now(), { isMain = () => true } = {}) {
  const seen = new Set();
  const result = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = plainObject(row) || {};
    const id = positiveId(plainObject(item.fixture)?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kickoff = upcomingToday(item, nowMs);
    if (kickoff === null) continue;
    result.push({ id, kickoff, main: safeMain(isMain, item) });
  }
  return result
    .sort((a, b) => Number(b.main) - Number(a.main) || a.kickoff - b.kickoff)
    .map(entry => ({ id: entry.id, main: entry.main }));
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
    const kickoff = upcomingToday(item, nowMs);
    if (kickoff === null) continue;
    const p = plainObject(predictions[id]);
    if (!p) continue;
    const values = [p.home, p.draw, p.away].map(Number);
    const sum = values.reduce((total, value) => total + value, 0);
    if (!values.every(value => Number.isFinite(value) && value >= 0 && value <= 100) || sum < 98 || sum > 102) continue;
    const teams = plainObject(item.teams) || {};
    const home = cleanName(plainObject(teams.home)?.name);
    const away = cleanName(plainObject(teams.away)?.name);
    if (!home || !away) continue;
    const main = safeMain(isMain, item);
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

// Журнал ops_events хранит сообщения до 500 символов, а пост с 4–5 матчами
// длиннее (ревью Codex #860). Предпросмотр пишется частями по строкам, чтобы
// Сергей видел ровно тот текст, который потом будет опубликован.
const PREVIEW_PART_CHARS = 480;
const MAX_PREVIEW_PARTS = 12;
export function previewParts(text = '') {
  const parts = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    // Отдельная строка длиннее части режется — на практике строки короче 200.
    const pieces = line.length > PREVIEW_PART_CHARS ? line.match(new RegExp(`[\\s\\S]{1,${PREVIEW_PART_CHARS}}`, 'g')) : [line];
    for (const piece of pieces) {
      const next = current ? `${current}\n${piece}` : piece;
      if (next.length > PREVIEW_PART_CHARS && current) {
        parts.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current.trim()) parts.push(current);
  return parts.slice(0, MAX_PREVIEW_PARTS);
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

  // true — событие сохранено в Supabase (а не только в памяти изолята).
  async function record(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      const row = await recordOpsEvent(cfg, event);
      return row?._persistenceStatus === 'persistent';
    } catch {
      return false;
    }
  }

  async function processChannelDailyPost(cfg, scheduledAt = new Date(now())) {
    const at = scheduledAt instanceof Date && Number.isFinite(scheduledAt.getTime()) ? scheduledAt : new Date(now());
    if (at.getUTCHours() !== POST_HOUR_UTC || at.getUTCMinutes() >= POST_WINDOW_MINUTES) return { ok: true, reason: 'outside_window' };
    const date = at.toISOString().slice(0, 10);
    const enabled = cfg?.channelDailyPostEnabled === true;

    const rows = await todayRows(date, cfg);
    // Снимки модели запрашиваются частями по 200 id, главные матчи — первыми
    // (ревью Codex #860): в насыщенный день главный матч не теряется за лимитом.
    const candidates = dailyPostCandidateIds(rows, at.getTime(), { isMain: isMainFixture });
    const predictions = {};
    // Порядок кандидатов совпадает с порядком отбора в пост, поэтому, когда
    // снимки найдены для MAX_MATCHES кандидатов, следующие части уже ничего не меняют.
    let found = 0;
    for (let chunk = 0; chunk < MAX_PREDICTION_CHUNKS && found < MAX_MATCHES; chunk += 1) {
      const part = candidates.slice(chunk * PREDICTION_CHUNK, (chunk + 1) * PREDICTION_CHUNK);
      if (!part.length) break;
      try {
        Object.assign(predictions, plainObject(await getModelProbabilities(part.map(entry => entry.id), cfg)) || {});
      } catch {
        return { ok: false, reason: 'predictions_lookup_failed' };
      }
      found = candidates.filter(entry => predictions[entry.id]).length;
    }
    const matches = dailyPostMatches(rows, predictions, at.getTime(), { isMain: isMainFixture });
    const text = dailyPostText(matches, at.getTime());
    if (!text) return { ok: true, reason: 'no_matches' };

    if (!enabled) {
      // Предпросмотр — один раз за день: сначала заявка в общей базе.
      let claim;
      try {
        claim = await claimIdempotency(PREVIEW_CLAIM_KEY(date), { fixtureId: 0 }, cfg);
      } catch {
        claim = { unavailable: true };
      }
      if (claim?.unavailable === true) return { ok: false, reason: 'preview_claim_unavailable' };
      if (claim?.claimed !== true) return { ok: true, reason: 'preview_already_recorded' };
      const parts = previewParts(text);
      let persisted = 0;
      for (let index = 0; index < parts.length; index += 1) {
        if (await record(cfg, {
          severity: 'info',
          source: 'channel_publisher',
          eventType: 'channel_daily_post_preview',
          code: 'CHANNEL_DAILY_POST_PREVIEW',
          message: parts[index],
          endpoint: 'cron:channel-daily-post',
          meta: { date, matches: matches.length, enabled: false, part: index + 1, parts: parts.length },
        })) persisted += 1;
      }
      // Метка «предпросмотр записан» — только если в журнале все части
      // (ревью Codex #860); иначе следующий запуск в окне повторит запись.
      if (persisted !== parts.length) {
        // Заявка снимается — следующий запуск в окне запишет предпросмотр заново.
        try { await releaseIdempotency(PREVIEW_CLAIM_KEY(date), { claimId: claim.claimId }, cfg); } catch {}
        return { ok: false, reason: 'preview_not_persisted', matches: matches.length };
      }
      try { await completeIdempotency(PREVIEW_CLAIM_KEY(date), { claimId: claim.claimId, fixtureId: 0 }, cfg); } catch {}
      // Полный текст — ещё и в кеше предпросмотра (на сутки), для удобства.
      try { await setCache(PREVIEW_CACHE_KEY(date), 0, { date, recordedAt: new Date(now()).toISOString(), text }, cfg, 1440); } catch {}
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
