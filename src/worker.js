const memory = {
  users: new Map(),
  usage: new Map(),
  cache: new Map(),
  history: new Map(),
  favorites: new Map(),
  reminders: new Map(),
  preferences: new Map(),
  provider: { name: 'API-Football', plan: 'UNKNOWN', dailyLimit: null, dailyRemaining: null, minuteLimit: null, minuteRemaining: null, updatedAt: null },
};

const enc = new TextEncoder();

const DEFAULT_PREFERENCES = Object.freeze({
  defaultFilter: 'top',
  reminderMinutes: 30,
  kickoffNotification: true,
  hideYouth: true,
  favoriteFirst: true,
});


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function intEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
}

function config(env) {
  return {
    devMode: boolEnv(env.DEV_MODE, false),
    apiFootballKey: env.API_FOOTBALL_KEY || '',
    tavilyKey: env.TAVILY_KEY || '',
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
    liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
    limits: {
      FREE: intEnv(env.FREE_DAILY_LIMIT, 3),
      PRO: intEnv(env.PRO_DAILY_LIMIT, 20),
      PREMIUM: intEnv(env.PREMIUM_DAILY_LIMIT, 100),
    },
  };
}

function hasSupabase(cfg) {
  return Boolean(cfg.supabaseUrl && cfg.supabaseKey);
}

function supaHeaders(cfg, extra = {}) {
  // New Supabase sb_secret_* keys are opaque API keys, not JWTs.
  // Send them only in the apikey header. Putting sb_secret_* in
  // Authorization: Bearer makes PostgREST try to parse it as a JWT
  // and can produce PGRST303 / JWT validation errors.
  return {
    apikey: cfg.supabaseKey,
    'content-type': 'application/json',
    ...extra,
  };
}

async function supaSelectOne(cfg, table, params) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: supaHeaders(cfg) });
  if (!r.ok) throw new Error(`Supabase ${table}: HTTP ${r.status}`);
  const rows = await r.json();
  return rows?.[0] || null;
}

async function supaSelectMany(cfg, table, params = {}, { limit = 20, order = '' } = {}) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  url.searchParams.set('select', '*');
  url.searchParams.set('limit', String(limit));
  if (order) url.searchParams.set('order', order);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: supaHeaders(cfg) });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
  }
  return await r.json();
}

async function supaUpsert(cfg, table, rows, onConflict) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const r = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

async function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmacSha256(enc.encode('WebAppData'), botToken);
  const calculated = bytesToHex(await hmacSha256(new Uint8Array(secretKey), dataCheckString));
  if (!constantTimeEqual(calculated.toLowerCase(), receivedHash.toLowerCase())) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 24 * 60 * 60) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function getRequestUser(request, cfg) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  let user = await validateTelegramInitData(initData, cfg.botToken);
  if (!user && cfg.devMode) {
    user = { id: 999001, username: 'dev_user', first_name: 'DEV', last_name: 'User' };
  }
  if (!user) return null;
  await upsertUser(user, cfg);
  return user;
}

async function upsertUser(user, cfg) {
  const record = {
    telegram_id: Number(user.id),
    username: user.username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    photo_url: user.photo_url || null,
    updated_at: new Date().toISOString(),
  };

  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'users', record, 'telegram_id');
    return;
  }
  const old = memory.users.get(Number(user.id)) || { plan: 'FREE', created_at: new Date().toISOString() };
  memory.users.set(Number(user.id), { ...old, ...record });
}

async function getUserRecord(userId, cfg) {
  if (hasSupabase(cfg)) {
    return await supaSelectOne(cfg, 'users', { telegram_id: `eq.${Number(userId)}` });
  }
  return memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
}

async function getUsage(userId, cfg) {
  const date = todayUtc();
  if (hasSupabase(cfg)) {
    const row = await supaSelectOne(cfg, 'usage_daily', {
      telegram_id: `eq.${Number(userId)}`,
      usage_date: `eq.${date}`,
    });
    return Number(row?.analyses || 0);
  }
  return Number(memory.usage.get(`${userId}:${date}`) || 0);
}

async function incrementUsage(userId, cfg) {
  const date = todayUtc();
  const next = (await getUsage(userId, cfg)) + 1;
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'usage_daily', {
      telegram_id: Number(userId),
      usage_date: date,
      analyses: next,
      updated_at: new Date().toISOString(),
    }, 'telegram_id,usage_date');
  } else {
    memory.usage.set(`${userId}:${date}`, next);
  }
  return next;
}

async function getQuota(userId, cfg) {
  const user = await getUserRecord(userId, cfg);
  let plan = user?.plan || 'FREE';
  if (plan !== 'FREE' && user?.subscription_until && new Date(user.subscription_until) < new Date()) plan = 'FREE';
  const used = await getUsage(userId, cfg);
  const limit = cfg.limits[plan] || cfg.limits.FREE;
  return { plan, used, limit, left: Math.max(0, limit - used) };
}

async function getCache(cacheKey, cfg) {
  if (hasSupabase(cfg)) {
    const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
    if (!row || new Date(row.expires_at) <= new Date()) return null;
    return row.payload;
  }
  const item = memory.cache.get(cacheKey);
  if (!item || item.expiresAt <= Date.now()) return null;
  return item.payload;
}

async function setCache(cacheKey, fixtureId, payload, cfg, minutes = cfg.cacheMinutes) {
  const ttlMinutes = Number.isFinite(Number(minutes)) ? Math.max(1 / 6, Number(minutes)) : cfg.cacheMinutes;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'analysis_cache', {
      cache_key: cacheKey,
      fixture_id: Number(fixtureId),
      payload,
      expires_at: expiresAt,
    }, 'cache_key');
  } else {
    memory.cache.set(cacheKey, { payload, expiresAt: Date.parse(expiresAt) });
  }
}

async function recordHistory(userId, payload, cfg) {
  const match = payload?.match;
  if (!match?.fixtureId) return;
  const row = {
    telegram_id: Number(userId),
    fixture_id: Number(match.fixtureId),
    home_name: match.home?.name || '',
    away_name: match.away?.name || '',
    league_name: match.league || '',
    fixture_date: match.date || null,
    home_logo: match.home?.logo || null,
    away_logo: match.away?.logo || null,
    viewed_at: new Date().toISOString(),
  };
  if (hasSupabase(cfg)) {
    try { await supaUpsert(cfg, 'analysis_history', row, 'telegram_id,fixture_id'); } catch (e) { console.warn('history write skipped', e?.message || e); }
    return;
  }
  const key = Number(userId);
  const list = memory.history.get(key) || [];
  const next = [row, ...list.filter(x => Number(x.fixture_id) !== Number(row.fixture_id))].slice(0, 20);
  memory.history.set(key, next);
}

async function getHistory(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'analysis_history', { telegram_id: `eq.${Number(userId)}` }, { limit: 20, order: 'viewed_at.desc' });
    } catch (e) {
      console.warn('history read skipped', e?.message || e);
      return [];
    }
  }
  return memory.history.get(Number(userId)) || [];
}


async function getFavorites(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'favorites', { telegram_id: `eq.${Number(userId)}` }, { limit: 50, order: 'created_at.desc' });
    } catch (e) {
      console.warn('favorites read skipped', e?.message || e);
      return [];
    }
  }
  return memory.favorites.get(Number(userId)) || [];
}

async function addFavorite(userId, team, cfg) {
  const row = {
    telegram_id: Number(userId),
    team_id: Number(team.id),
    team_name: String(team.name || ''),
    team_logo: String(team.logo || ''),
    created_at: new Date().toISOString(),
  };
  if (!Number.isFinite(row.team_id) || row.team_id <= 0 || !row.team_name) throw new Error('Некорректная команда.');
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'favorites', row, 'telegram_id,team_id');
    return row;
  }
  const key = Number(userId);
  const list = memory.favorites.get(key) || [];
  memory.favorites.set(key, [row, ...list.filter(x => Number(x.team_id) !== row.team_id)].slice(0, 50));
  return row;
}

async function removeFavorite(userId, teamId, cfg) {
  const id = Number(teamId);
  if (hasSupabase(cfg)) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/favorites`);
    url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
    url.searchParams.set('team_id', `eq.${id}`);
    const r = await fetch(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) });
    if (!r.ok) throw new Error(`Supabase favorites: HTTP ${r.status}`);
    return;
  }
  const key = Number(userId);
  memory.favorites.set(key, (memory.favorites.get(key) || []).filter(x => Number(x.team_id) !== id));
}

function normalizePreferences(row = {}) {
  const allowedFilters = new Set(['top', 'favorites', 'all']);
  const rawFilter = row.default_filter ?? row.defaultFilter ?? DEFAULT_PREFERENCES.defaultFilter;
  const reminder = Number(row.reminder_minutes ?? row.reminderMinutes ?? DEFAULT_PREFERENCES.reminderMinutes);
  return {
    defaultFilter: allowedFilters.has(String(rawFilter)) ? String(rawFilter) : DEFAULT_PREFERENCES.defaultFilter,
    reminderMinutes: [15, 30, 60].includes(reminder) ? reminder : DEFAULT_PREFERENCES.reminderMinutes,
    kickoffNotification: row.kickoff_notification ?? row.kickoffNotification ?? DEFAULT_PREFERENCES.kickoffNotification,
    hideYouth: row.hide_youth ?? row.hideYouth ?? DEFAULT_PREFERENCES.hideYouth,
    favoriteFirst: row.favorite_first ?? row.favoriteFirst ?? DEFAULT_PREFERENCES.favoriteFirst,
  };
}

async function getPreferences(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      const row = await supaSelectOne(cfg, 'user_preferences', { telegram_id: `eq.${Number(userId)}` });
      return normalizePreferences(row || {});
    } catch (e) {
      console.warn('preferences read skipped', e?.message || e);
      return { ...DEFAULT_PREFERENCES };
    }
  }
  return normalizePreferences(memory.preferences.get(Number(userId)) || {});
}

async function savePreferences(userId, input, cfg) {
  const current = await getPreferences(userId, cfg);
  const next = normalizePreferences({
    defaultFilter: input.defaultFilter ?? current.defaultFilter,
    reminderMinutes: input.reminderMinutes ?? current.reminderMinutes,
    kickoffNotification: input.kickoffNotification ?? current.kickoffNotification,
    hideYouth: input.hideYouth ?? current.hideYouth,
    favoriteFirst: input.favoriteFirst ?? current.favoriteFirst,
  });
  const row = {
    telegram_id: Number(userId),
    default_filter: next.defaultFilter,
    reminder_minutes: next.reminderMinutes,
    kickoff_notification: Boolean(next.kickoffNotification),
    hide_youth: Boolean(next.hideYouth),
    favorite_first: Boolean(next.favoriteFirst),
    updated_at: new Date().toISOString(),
  };
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'user_preferences', row, 'telegram_id');
  } else {
    memory.preferences.set(Number(userId), row);
  }
  return next;
}

async function getReminders(userId, cfg) {
  if (hasSupabase(cfg)) {
    try {
      return await supaSelectMany(cfg, 'match_reminders', { telegram_id: `eq.${Number(userId)}`, enabled: 'eq.true' }, { limit: 50, order: 'fixture_date.asc' });
    } catch (e) {
      console.warn('reminders read skipped', e?.message || e);
      return [];
    }
  }
  return memory.reminders.get(Number(userId)) || [];
}

async function addReminder(userId, input, cfg) {
  const prefs = await getPreferences(userId, cfg);
  const requestedMinutes = Number(input.reminderMinutes ?? prefs.reminderMinutes);
  const reminderMinutes = [15, 30, 60].includes(requestedMinutes) ? requestedMinutes : 30;
  const kickoffNotify = input.kickoffNotify === undefined ? Boolean(prefs.kickoffNotification) : Boolean(input.kickoffNotify);
  const row = {
    telegram_id: Number(userId),
    fixture_id: Number(input.fixtureId),
    home_name: String(input.homeName || ''),
    away_name: String(input.awayName || ''),
    league_name: String(input.leagueName || ''),
    fixture_date: input.fixtureDate ? new Date(input.fixtureDate).toISOString() : null,
    enabled: true,
    remind_before_minutes: reminderMinutes,
    kickoff_notify: kickoffNotify,
    notified_at: null,
    kickoff_notified_at: null,
    created_at: new Date().toISOString(),
  };
  if (!Number.isFinite(row.fixture_id) || row.fixture_id <= 0 || !row.fixture_date || !row.home_name || !row.away_name) {
    throw new Error('Некорректные данные напоминания.');
  }
  if (Date.parse(row.fixture_date) <= Date.now() + 5 * 60_000) throw new Error('Матч уже начинается или начался.');
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'match_reminders', row, 'telegram_id,fixture_id');
    return row;
  }
  const key = Number(userId);
  const list = memory.reminders.get(key) || [];
  memory.reminders.set(key, [row, ...list.filter(x => Number(x.fixture_id) !== row.fixture_id)].slice(0, 50));
  return row;
}

async function removeReminder(userId, fixtureId, cfg) {
  const id = Number(fixtureId);
  if (hasSupabase(cfg)) {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
    url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
    url.searchParams.set('fixture_id', `eq.${id}`);
    const r = await fetch(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) });
    if (!r.ok) throw new Error(`Supabase reminders: HTTP ${r.status}`);
    return;
  }
  const key = Number(userId);
  memory.reminders.set(key, (memory.reminders.get(key) || []).filter(x => Number(x.fixture_id) !== id));
}

async function patchReminder(row, patch, cfg) {
  if (!hasSupabase(cfg)) return;
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
  url.searchParams.set('telegram_id', `eq.${Number(row.telegram_id)}`);
  url.searchParams.set('fixture_id', `eq.${Number(row.fixture_id)}`);
  const r = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`Supabase reminders patch: HTTP ${r.status}`);
}

async function sendTelegramMessage(chatId, text, cfg) {
  if (!cfg.botToken) return false;
  const r = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: Number(chatId), text, disable_web_page_preview: true }),
  });
  return r.ok;
}

async function processDueReminders(cfg) {
  if (!hasSupabase(cfg) || !cfg.botToken) return { checked: 0, sent: 0, kickoffSent: 0 };
  const now = Date.now();
  const from = new Date(now - 10 * 60_000).toISOString();
  const toMs = now + 75 * 60_000;
  let rows = [];
  try {
    rows = await supaSelectMany(cfg, 'match_reminders', {
      enabled: 'eq.true',
      fixture_date: `gte.${from}`,
    }, { limit: 200, order: 'fixture_date.asc' });
    rows = rows.filter(x => Date.parse(x.fixture_date) <= toMs);
  } catch (e) {
    console.warn('reminder scheduler skipped', e?.message || e);
    return { checked: 0, sent: 0, kickoffSent: 0 };
  }

  let sent = 0;
  let kickoffSent = 0;
  for (const row of rows) {
    const kickoffMs = Date.parse(row.fixture_date);
    if (!Number.isFinite(kickoffMs)) continue;
    const deltaMinutes = (kickoffMs - now) / 60000;
    const remindBefore = [15, 30, 60].includes(Number(row.remind_before_minutes)) ? Number(row.remind_before_minutes) : 30;
    const kickoffEnabled = row.kickoff_notify !== false;

    try {
      // Around kickoff, prefer a single kickoff message instead of sending two notifications at once.
      if (kickoffEnabled && !row.kickoff_notified_at && deltaMinutes <= 5 && deltaMinutes >= -10) {
        const text = `🔴 Матч начинается\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\n\nОткройте Football Manager: LIVE-центр появится, когда провайдер обновит статус.`;
        if (await sendTelegramMessage(row.telegram_id, text, cfg)) {
          await patchReminder(row, {
            kickoff_notified_at: new Date().toISOString(),
            notified_at: row.notified_at || new Date().toISOString(),
          }, cfg);
          kickoffSent++;
        }
        continue;
      }

      if (!row.notified_at && deltaMinutes > 5 && deltaMinutes <= remindBefore) {
        const minutes = Math.max(1, Math.round(deltaMinutes));
        const text = `⚽ Скоро матч\n\n${row.home_name} — ${row.away_name}${row.league_name ? `\n${row.league_name}` : ''}\nСтарт примерно через ${minutes} мин.\n\nОткройте Football Manager для свежего предматчевого анализа.`;
        if (await sendTelegramMessage(row.telegram_id, text, cfg)) {
          await patchReminder(row, { notified_at: new Date().toISOString() }, cfg);
          sent++;
        }
      }
    } catch (e) {
      console.warn('reminder send failed', e?.message || e);
    }
  }
  return { checked: rows.length, sent, kickoffSent };
}

function inferFootballPlan(dailyLimit) {
  const n = Number(dailyLimit || 0);
  if (n >= 150000) return 'MEGA';
  if (n >= 75000) return 'ULTRA';
  if (n >= 7500) return 'PRO';
  if (n > 0) return 'FREE';
  return 'UNKNOWN';
}

function updateProviderFromHeaders(response) {
  const readNum = name => {
    const v = response.headers.get(name);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const dailyLimit = readNum('x-ratelimit-requests-limit');
  const dailyRemaining = readNum('x-ratelimit-requests-remaining');
  const minuteLimit = readNum('x-ratelimit-limit');
  const minuteRemaining = readNum('x-ratelimit-remaining');
  memory.provider = {
    name: 'API-Football',
    plan: inferFootballPlan(dailyLimit),
    dailyLimit,
    dailyRemaining,
    minuteLimit,
    minuteRemaining,
    updatedAt: new Date().toISOString(),
  };
}

function providerSnapshot() {
  return { ...(memory.provider || {}), liveOddsReady: ['PRO','ULTRA','MEGA'].includes(memory.provider?.plan || '') };
}

function liveRefreshSeconds() {
  const plan = memory.provider?.plan || 'UNKNOWN';
  if (plan === 'MEGA' || plan === 'ULTRA') return 15;
  if (plan === 'PRO') return 30;
  return 60;
}

function paidQuotaHealthy() {
  const p = memory.provider || {};
  if (!['PRO','ULTRA','MEGA'].includes(p.plan)) return false;
  if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < 50) return false;
  if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < 5) return false;
  return true;
}

async function apiFootball(path, params, cfg) {
  if (!cfg.apiFootballKey) throw new Error('API_FOOTBALL_KEY не настроен в Cloudflare.');
  const url = new URL(`https://v3.football.api-sports.io${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const r = await fetch(url, {
    headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
  });
  updateProviderFromHeaders(r);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 429) throw new Error('API-Football временно достиг лимита запросов. Попробуйте чуть позже.');
    throw new Error(`API-Football HTTP ${r.status}`);
  }
  const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
  if (errors.length) throw new Error(`API-Football: ${errors.join('; ')}`);
  return Array.isArray(body.response) ? body.response : [];
}

async function tavilySearch(query, cfg) {
  if (!cfg.tavilyKey) return { answer: '', results: [] };
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.tavilyKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${query}. Дай только проверяемые факты. Итоговую краткую сводку сформулируй на русском языке.`,
        topic: 'general',
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!r.ok) return { answer: '', results: [] };
    const body = await r.json();
    return {
      answer: String(body.answer || ''),
      results: (body.results || []).slice(0, 5).map(x => ({
        title: x.title || '', url: x.url || '', content: x.content || '',
      })),
    };
  } catch {
    return { answer: '', results: [] };
  }
}

function parsePercent(value) {
  const num = Number(String(value ?? '').replace('%', '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}
function round1(n) { return Math.round(n * 10) / 10; }
function normalizeThree(a, b, c) {
  const sum = a + b + c;
  if (!sum) return null;
  return { home: round1(a / sum * 100), draw: round1(b / sum * 100), away: round1(c / sum * 100) };
}
function extractMarket(oddsRows) {
  const samples = [];
  for (const row of oddsRows || []) {
    for (const bookmaker of row.bookmakers || []) {
      const bet = (bookmaker.bets || []).find(b => String(b.name || '').toLowerCase().includes('match winner'));
      if (!bet) continue;
      const vals = bet.values || [];
      const home = Number(vals.find(v => String(v.value).toLowerCase() === 'home')?.odd);
      const draw = Number(vals.find(v => String(v.value).toLowerCase() === 'draw')?.odd);
      const away = Number(vals.find(v => String(v.value).toLowerCase() === 'away')?.odd);
      if (home > 1 && draw > 1 && away > 1) samples.push({ home, draw, away });
    }
  }
  if (!samples.length) return null;
  const avg = key => samples.reduce((s, x) => s + x[key], 0) / samples.length;
  const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), bookmakers: samples.length };
}
function extractLiveMarket(rows) {
  const candidates = [];
  const pushValues = (name, values, update = '') => {
    const key = String(name || '').toLowerCase();
    if (!/(match winner|winner|1x2|fulltime result|full time result)/i.test(key)) return;
    let home = null, draw = null, away = null;
    for (const v of values || []) {
      const label = String(v.value ?? v.name ?? v.label ?? '').trim().toLowerCase();
      const odd = Number(v.odd ?? v.odds ?? v.price);
      if (!(odd > 1)) continue;
      if (['home','1'].includes(label) || label.includes('home')) home = odd;
      else if (['draw','x'].includes(label) || label.includes('draw')) draw = odd;
      else if (['away','2'].includes(label) || label.includes('away')) away = odd;
    }
    if (home && draw && away) candidates.push({ home, draw, away, update });
  };
  for (const row of rows || []) {
    const update = row.update || row.updated_at || row.updatedAt || '';
    for (const bet of row.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
    for (const bookmaker of row.bookmakers || []) {
      for (const bet of bookmaker.bets || bookmaker.odds || []) pushValues(bet.name || bet.bet || bet.id, bet.values || bet.outcomes || [], update);
    }
  }
  if (!candidates.length) return null;
  const avg = key => candidates.reduce((sum, x) => sum + x[key], 0) / candidates.length;
  const odds = { home: round1(avg('home')), draw: round1(avg('draw')), away: round1(avg('away')) };
  return { odds, probabilities: normalizeThree(1 / odds.home, 1 / odds.draw, 1 / odds.away), sources: candidates.length, updatedAt: candidates.find(x => x.update)?.update || '' };
}

function extractPrediction(rows) {
  const p = rows?.[0]?.predictions;
  if (!p) return null;
  const home = parsePercent(p.percent?.home), draw = parsePercent(p.percent?.draw), away = parsePercent(p.percent?.away);
  return {
    probabilities: home !== null && draw !== null && away !== null ? normalizeThree(home, draw, away) : null,
    winner: p.winner?.name || '',
    winnerComment: p.winner?.comment || '',
    advice: p.advice || '',
    underOver: p.under_over || '',
    goals: p.goals || null,
  };
}
function combineProbabilities(market, model) {
  const m = market?.probabilities, p = model?.probabilities;
  if (m && p) return normalizeThree(m.home * 0.55 + p.home * 0.45, m.draw * 0.55 + p.draw * 0.45, m.away * 0.55 + p.away * 0.45);
  return m || p || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function ymd(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : todayUtc();
}

function teamResult(fixture, teamId) {
  const homeId = Number(fixture.teams?.home?.id || 0);
  const awayId = Number(fixture.teams?.away?.id || 0);
  const isHome = homeId === Number(teamId);
  const isAway = awayId === Number(teamId);
  if (!isHome && !isAway) return null;
  const hg = Number(fixture.goals?.home ?? 0);
  const ag = Number(fixture.goals?.away ?? 0);
  const gf = isHome ? hg : ag;
  const ga = isHome ? ag : hg;
  return {
    date: fixture.fixture?.date || '',
    venue: isHome ? 'home' : 'away',
    opponent: isHome ? fixture.teams?.away?.name || '' : fixture.teams?.home?.name || '',
    opponentLogo: isHome ? fixture.teams?.away?.logo || '' : fixture.teams?.home?.logo || '',
    league: fixture.league?.name || '',
    gf,
    ga,
    result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
  };
}

function summarizeFormRows(rows, teamId, preferredVenue) {
  const all = (rows || [])
    .map(x => teamResult(x, teamId))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
  const last = all.slice(0, 5);
  const venue = all.filter(x => x.venue === preferredVenue).slice(0, 3);
  const summarize = list => {
    if (!list.length) return null;
    const wins = list.filter(x => x.result === 'W').length;
    const draws = list.filter(x => x.result === 'D').length;
    const losses = list.filter(x => x.result === 'L').length;
    const gf = list.reduce((s, x) => s + x.gf, 0);
    const ga = list.reduce((s, x) => s + x.ga, 0);
    return {
      sample: list.length,
      wins, draws, losses,
      ppg: round1((wins * 3 + draws) / list.length),
      gfAvg: round1(gf / list.length),
      gaAvg: round1(ga / list.length),
      gdAvg: round1((gf - ga) / list.length),
      bttsPct: round1(list.filter(x => x.gf > 0 && x.ga > 0).length / list.length * 100),
      over25Pct: round1(list.filter(x => x.gf + x.ga >= 3).length / list.length * 100),
      cleanSheetPct: round1(list.filter(x => x.ga === 0).length / list.length * 100),
      form: list.map(x => x.result).join(''),
      matches: list,
    };
  };
  return { overall: summarize(last), venue: summarize(venue), preferredVenue };
}

async function getRecentTeamForm(teamId, preferredVenue, fixtureDate, fixtureId, cfg) {
  if (!teamId) return null;
  const targetMs = Number.isFinite(Date.parse(fixtureDate || '')) ? Date.parse(fixtureDate) : Date.now();
  const to = ymd(new Date(targetMs - 60_000));
  const from = ymd(new Date(targetMs - 90 * 86400_000));
  const cacheKey = `teamform:${Number(teamId)}:${preferredVenue}:${to}:v2`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return cached;
  const rows = await apiFootball('/fixtures', { team: Number(teamId), from, to }, cfg);
  const usable = rows.filter(x => {
    const id = Number(x.fixture?.id || 0);
    const dateMs = Date.parse(x.fixture?.date || '');
    return id !== Number(fixtureId) && isFinishedStatus(x.fixture?.status?.short) && Number.isFinite(dateMs) && dateMs < targetMs;
  });
  const summary = summarizeFormRows(usable, teamId, preferredVenue);
  await setCache(cacheKey, Number(fixtureId || teamId), summary, cfg, 120);
  return summary;
}

function formProbabilities(homeForm, awayForm) {
  const h = homeForm?.overall, a = awayForm?.overall;
  if (!h?.sample || !a?.sample) return null;
  const hv = homeForm?.venue?.sample >= 2 ? homeForm.venue.ppg : h.ppg;
  const av = awayForm?.venue?.sample >= 2 ? awayForm.venue.ppg : a.ppg;
  let edge = 4; // conservative home-field prior
  edge += clamp((h.ppg - a.ppg) * 8, -18, 18);
  edge += clamp((h.gdAvg - a.gdAvg) * 2.6, -10, 10);
  edge += clamp((hv - av) * 3.5, -8, 8);
  edge = clamp(edge, -24, 24);
  const draw = clamp(28.5 - Math.abs(edge) * 0.24, 20, 29);
  const remaining = 100 - draw;
  const homeShare = 1 / (1 + Math.exp(-edge / 8.5));
  return normalizeThree(remaining * homeShare, draw, remaining * (1 - homeShare));
}

function h2hProbabilities(h2h) {
  const total = Number(h2h?.homeWins || 0) + Number(h2h?.draws || 0) + Number(h2h?.awayWins || 0);
  if (!total) return null;
  return normalizeThree(Number(h2h.homeWins || 0) + 1, Number(h2h.draws || 0) + 1, Number(h2h.awayWins || 0) + 1);
}

function blendProbabilitySignals({ market, model, form, h2h }) {
  const candidates = [
    ['market', market?.probabilities, 0.42],
    ['apiPrediction', model?.probabilities, 0.24],
    ['recentForm', form, 0.26],
    ['h2h', h2h, 0.08],
  ].filter(([, p]) => p && [p.home, p.draw, p.away].every(x => Number.isFinite(Number(x))));
  if (!candidates.length) return { probabilities: null, weights: {}, signals: [] };
  const weightSum = candidates.reduce((s, x) => s + x[2], 0);
  const weights = {};
  let home = 0, draw = 0, away = 0;
  const signals = [];
  for (const [name, p, rawWeight] of candidates) {
    const w = rawWeight / weightSum;
    weights[name] = round1(w * 100);
    home += Number(p.home) * w;
    draw += Number(p.draw) * w;
    away += Number(p.away) * w;
    signals.push({ name, probabilities: p, weight: round1(w * 100) });
  }
  return { probabilities: normalizeThree(home, draw, away), weights, signals };
}

function applyAbsenceAdjustment(probabilities, absences) {
  if (!probabilities) return null;
  const homeCount = Math.min(6, absences?.home?.length || 0);
  const awayCount = Math.min(6, absences?.away?.length || 0);
  const shift = clamp((awayCount - homeCount) * 0.55, -3.3, 3.3);
  return normalizeThree(probabilities.home + shift, probabilities.draw, probabilities.away - shift);
}

function poissonGoalModel(homeForm, awayForm) {
  const h = homeForm?.overall, a = awayForm?.overall;
  if (!h?.sample || !a?.sample || h.sample < 3 || a.sample < 3) return null;
  const hv = homeForm?.venue?.sample >= 2 ? homeForm.venue : h;
  const av = awayForm?.venue?.sample >= 2 ? awayForm.venue : a;
  const homeLambda = clamp(((h.gfAvg + a.gaAvg + hv.gfAvg + av.gaAvg) / 4) + 0.12, 0.35, 3.4);
  const awayLambda = clamp(((a.gfAvg + h.gaAvg + av.gfAvg + hv.gaAvg) / 4) - 0.03, 0.25, 3.2);
  const total = homeLambda + awayLambda;
  const underOrEqual2 = Math.exp(-total) * (1 + total + (total * total) / 2);
  const over25 = clamp((1 - underOrEqual2) * 100, 0, 100);
  const btts = clamp((1 - Math.exp(-homeLambda)) * (1 - Math.exp(-awayLambda)) * 100, 0, 100);
  return {
    homeExpected: round1(homeLambda),
    awayExpected: round1(awayLambda),
    totalExpected: round1(total),
    over25: round1(over25),
    btts: round1(btts),
  };
}

function outcomeName(probabilities, homeName, awayName) {
  if (!probabilities) return 'Недостаточно данных';
  const rows = [
    { key: 'home', label: homeName || 'П1', value: Number(probabilities.home) },
    { key: 'draw', label: 'Ничья', value: Number(probabilities.draw) },
    { key: 'away', label: awayName || 'П2', value: Number(probabilities.away) },
  ].sort((a, b) => b.value - a.value);
  return rows[0]?.label || 'Недостаточно данных';
}

function signalDisagreement(signals, finalP) {
  if (!finalP || !signals?.length) return null;
  const values = signals.map(s => (
    Math.abs(Number(s.probabilities.home) - Number(finalP.home)) +
    Math.abs(Number(s.probabilities.draw) - Number(finalP.draw)) +
    Math.abs(Number(s.probabilities.away) - Number(finalP.away))
  ) / 3);
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

function confidenceModel(signals, finalP, homeForm, awayForm) {
  const coverage = clamp((signals?.length || 0) / 4, 0, 1);
  const formSample = Math.min(1, Math.min(homeForm?.overall?.sample || 0, awayForm?.overall?.sample || 0) / 5);
  const disagreement = signalDisagreement(signals, finalP) ?? 18;
  const score = Math.round(clamp(38 + coverage * 34 + formSample * 12 - disagreement * 0.65, 30, 88));
  return {
    score,
    label: score >= 72 ? 'Высокая' : score >= 55 ? 'Средняя' : 'Низкая',
    disagreement,
    coverage: round1(coverage * 100),
  };
}

function buildAnalysisNotes({ probabilities, market, model, homeForm, awayForm, h2h, absences, lineups, news, homeName, awayName, minutesToKickoff, confidence }) {
  const factors = [];
  const risks = [];
  const hp = homeForm?.overall?.ppg, ap = awayForm?.overall?.ppg;
  if (Number.isFinite(hp) && Number.isFinite(ap) && Math.abs(hp - ap) >= 0.35) {
    factors.push(`${hp > ap ? homeName : awayName} лучше по форме последних матчей: ${Math.max(hp, ap).toFixed(1)} против ${Math.min(hp, ap).toFixed(1)} очка за игру.`);
  }
  if (market?.probabilities) {
    const leader = outcomeName(market.probabilities, homeName, awayName);
    factors.push(`Рынок 1X2 сильнее всего оценивает вариант «${leader}».`);
  }
  if (model?.winner) factors.push(`Прогноз API-Football указывает: ${model.winner}.`);
  const homeAbs = absences?.home?.length || 0, awayAbs = absences?.away?.length || 0;
  if (Math.abs(homeAbs - awayAbs) >= 2) factors.push(`${homeAbs > awayAbs ? homeName : awayName} имеет больше отмеченных потерь состава (${Math.max(homeAbs, awayAbs)} против ${Math.min(homeAbs, awayAbs)}).`);
  const h2hTotal = (h2h?.homeWins || 0) + (h2h?.draws || 0) + (h2h?.awayWins || 0);
  if (h2hTotal >= 3 && Math.abs((h2h.homeWins || 0) - (h2h.awayWins || 0)) >= 2) factors.push(`В последних очных матчах преимущество по победам у ${h2h.homeWins > h2h.awayWins ? homeName : awayName}.`);
  if (!market) risks.push('Нет доступной линии 1X2 — итог сильнее зависит от статистических источников.');
  if (!model?.probabilities) risks.push('API-Football не отдал процентный prediction для этого матча.');
  if ((homeForm?.overall?.sample || 0) < 4 || (awayForm?.overall?.sample || 0) < 4) risks.push('Небольшая выборка недавних матчей одной из команд.');
  if (confidence?.disagreement >= 10) risks.push('Источники заметно расходятся между собой — уверенность модели снижена.');
  if (minutesToKickoff !== null && minutesToKickoff <= 120 && !lineups?.home && !lineups?.away) risks.push('Подтверждённые стартовые составы ещё не доступны.');
  if (!news?.answer) risks.push('Не удалось получить свежий новостной контекст из веб-поиска.');
  if (!factors.length && probabilities) factors.push(`Наибольшая расчётная вероятность сейчас у варианта «${outcomeName(probabilities, homeName, awayName)}».`);
  return { factors: factors.slice(0, 5), risks: risks.slice(0, 5) };
}
function formatAbsences(rows, homeId, awayId) {
  const out = { home: [], away: [] };
  for (const item of rows || []) {
    const e = { name: item.player?.name || 'Игрок', type: item.player?.type || '', reason: item.player?.reason || '' };
    if (Number(item.team?.id) === Number(homeId)) out.home.push(e);
    if (Number(item.team?.id) === Number(awayId)) out.away.push(e);
  }
  return out;
}
function formatLineups(rows, homeId, awayId) {
  const out = { home: null, away: null };
  for (const x of rows || []) {
    const lineup = {
      formation: x.formation || '', coach: x.coach?.name || '',
      startXI: (x.startXI || []).map(v => v.player?.name).filter(Boolean),
      substitutes: (x.substitutes || []).map(v => v.player?.name).filter(Boolean),
    };
    if (Number(x.team?.id) === Number(homeId)) out.home = lineup;
    if (Number(x.team?.id) === Number(awayId)) out.away = lineup;
  }
  return out;
}
function formatH2H(rows, homeId, awayId) {
  let homeWins = 0, draws = 0, awayWins = 0;
  const matches = [];
  for (const x of rows || []) {
    const hg = Number(x.goals?.home ?? 0), ag = Number(x.goals?.away ?? 0);
    const hId = Number(x.teams?.home?.id), aId = Number(x.teams?.away?.id);
    let winnerId = null;
    if (hg > ag) winnerId = hId;
    if (ag > hg) winnerId = aId;
    if (!winnerId) draws++; else if (winnerId === Number(homeId)) homeWins++; else if (winnerId === Number(awayId)) awayWins++;
    matches.push({ date: x.fixture?.date || '', home: x.teams?.home?.name || '', away: x.teams?.away?.name || '', score: `${hg}:${ag}` });
  }
  return { homeWins, draws, awayWins, matches: matches.slice(0, 5) };
}

const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);
const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

function isLiveStatus(status) { return LIVE_STATUSES.has(String(status || '').toUpperCase()); }
function isFinishedStatus(status) { return FINISHED_STATUSES.has(String(status || '').toUpperCase()); }

function statusLabel(status, elapsed) {
  const s = String(status || '').toUpperCase();
  const labels = {
    NS: 'Не начался', TBD: 'Время уточняется', '1H': '1-й тайм', HT: 'Перерыв', '2H': '2-й тайм',
    ET: 'Доп. время', BT: 'Перерыв', P: 'Пенальти', INT: 'Прерван', LIVE: 'LIVE',
    FT: 'Завершён', AET: 'Завершён после доп. времени', PEN: 'Завершён по пенальти',
    PST: 'Перенесён', CANC: 'Отменён', ABD: 'Прерван', AWD: 'Тех. результат', WO: 'Без игры',
  };
  const base = labels[s] || s || 'Статус неизвестен';
  return isLiveStatus(s) && Number.isFinite(Number(elapsed)) ? `${base} · ${Number(elapsed)}′` : base;
}

function normalizeStatValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  return String(value);
}

const STAT_KEYS = [
  ['Ball Possession', 'Владение'],
  ['Total Shots', 'Удары'],
  ['Shots on Goal', 'В створ'],
  ['Shots off Goal', 'Мимо'],
  ['Blocked Shots', 'Блокированные'],
  ['Corner Kicks', 'Угловые'],
  ['Offsides', 'Офсайды'],
  ['Fouls', 'Фолы'],
  ['Yellow Cards', 'Жёлтые'],
  ['Red Cards', 'Красные'],
  ['Goalkeeper Saves', 'Сейвы'],
  ['Total passes', 'Передачи'],
  ['Passes accurate', 'Точные передачи'],
  ['Passes %', 'Точность передач'],
  ['expected_goals', 'xG'],
];

function formatLiveStatistics(rows, homeId, awayId) {
  const byTeam = new Map();
  for (const row of rows || []) {
    const id = Number(row.team?.id || 0);
    const values = {};
    for (const stat of row.statistics || []) values[String(stat.type || '')] = normalizeStatValue(stat.value);
    byTeam.set(id, { teamId: id, teamName: row.team?.name || '', values });
  }
  const home = byTeam.get(Number(homeId)) || { teamId: Number(homeId), values: {} };
  const away = byTeam.get(Number(awayId)) || { teamId: Number(awayId), values: {} };
  const items = STAT_KEYS.map(([key, label]) => ({
    key, label, home: home.values[key] ?? null, away: away.values[key] ?? null,
  })).filter(x => x.home !== null || x.away !== null);
  return { home, away, items };
}

function translateEvent(type, detail) {
  const t = String(type || '').toLowerCase();
  const d = String(detail || '').toLowerCase();
  if (t === 'goal') {
    if (d.includes('own')) return '⚽ Автогол';
    if (d.includes('missed')) return '❌ Незабитый пенальти';
    if (d.includes('penalty')) return '⚽ Гол с пенальти';
    return '⚽ Гол';
  }
  if (t === 'card') {
    if (d.includes('red')) return '🟥 Красная карточка';
    if (d.includes('second yellow')) return '🟥 Вторая жёлтая';
    return '🟨 Жёлтая карточка';
  }
  if (t === 'subst') return '🔄 Замена';
  if (t === 'var') return '📺 VAR';
  return detail || type || 'Событие';
}

function formatLiveEvents(rows, homeId, awayId) {
  return (rows || []).map((event, index) => ({
    id: `${event.time?.elapsed || 0}-${event.time?.extra || 0}-${index}`,
    minute: Number(event.time?.elapsed || 0),
    extra: Number(event.time?.extra || 0),
    teamId: Number(event.team?.id || 0),
    side: Number(event.team?.id) === Number(homeId) ? 'home' : Number(event.team?.id) === Number(awayId) ? 'away' : '',
    teamName: event.team?.name || '',
    player: event.player?.name || '',
    assist: event.assist?.name || '',
    type: event.type || '',
    detail: event.detail || '',
    label: translateEvent(event.type, event.detail),
    comments: event.comments || '',
  })).sort((a, b) => a.minute - b.minute || a.extra - b.extra);
}

function scoreSnapshot(fixture) {
  return {
    home: fixture.goals?.home ?? null,
    away: fixture.goals?.away ?? null,
    halftime: fixture.score?.halftime || null,
    fulltime: fixture.score?.fulltime || null,
    extratime: fixture.score?.extratime || null,
    penalty: fixture.score?.penalty || null,
  };
}

function embeddedLiveData(fixture) {
  return {
    events: Array.isArray(fixture.events) ? fixture.events : [],
    lineups: Array.isArray(fixture.lineups) ? fixture.lineups : [],
    statistics: Array.isArray(fixture.statistics) ? fixture.statistics : [],
    players: Array.isArray(fixture.players) ? fixture.players : [],
  };
}


const TOP_LEAGUE_IDS = new Set([
  1, 2, 3, 4, 9, 15, 39, 45, 61, 66, 71, 78, 81, 88, 94, 128, 135, 137, 140, 143, 203, 253, 307, 848,
]);


const BIG_TEAM_RE = /arsenal|liverpool|chelsea|manchester (city|united)|tottenham|newcastle|real madrid|barcelona|atletico madrid|bayern|dortmund|paris saint|psg|inter|milan|juventus|napoli|roma|benfica|porto|sporting|ajax|psv|feyenoord|inter miami|flamengo|palmeiras|river plate|boca juniors/i;
const YOUTH_RESERVE_RE = /\bu-?1[789]\b|\bu-?2[013]\b|under ?(17|18|19|20|21|23)|youth|reserve|reserves|development|primavera|juniors?/i;

function isYouthReserveMatch(leagueName = '', homeName = '', awayName = '') {
  return YOUTH_RESERVE_RE.test(`${leagueName || ''} ${homeName || ''} ${awayName || ''}`);
}

function matchInterestScore({ leagueId, leagueName, country, homeName, awayName, status, date }) {
  let score = 18;
  if (isTopLeague(leagueId, leagueName)) score += 34;
  const group = leagueGroup(leagueId, leagueName, country);
  if (group === 'international') score += 14;
  if (BIG_TEAM_RE.test(homeName || '')) score += 13;
  if (BIG_TEAM_RE.test(awayName || '')) score += 13;
  if (isLiveStatus(status)) score += 8;
  if (date) {
    const mins = Math.abs((Date.parse(date) - Date.now()) / 60000);
    if (mins <= 180) score += 5;
  }
  if (YOUTH_RESERVE_RE.test(`${leagueName || ''} ${homeName || ''} ${awayName || ''}`)) score -= 40;
  return Math.max(5, Math.min(99, Math.round(score)));
}

function leagueGroup(leagueId, leagueName = '', country = '') {
  const id = Number(leagueId);
  const n = String(leagueName).toLowerCase();
  const c = String(country).toLowerCase();
  if ([1,2,3,4,9,15,848].includes(id) || /champions|europa|conference|world cup|euro|copa america|club world/.test(n)) return 'international';
  if (id === 39 || id === 45 || c === 'england') return 'england';
  if (id === 140 || id === 143 || c === 'spain') return 'spain';
  if (id === 135 || id === 137 || c === 'italy') return 'italy';
  if (id === 78 || id === 81 || c === 'germany') return 'germany';
  if (id === 61 || id === 66 || c === 'france') return 'france';
  return 'other';
}

function isTopLeague(leagueId, leagueName = '') {
  if (YOUTH_RESERVE_RE.test(String(leagueName || ''))) return false;
  if (TOP_LEAGUE_IDS.has(Number(leagueId))) return true;
  return /premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|world cup|copa america|major league soccer|primeira liga/i.test(String(leagueName));
}

function matchStatusRank(status) {
  if (isLiveStatus(status)) return 0;
  if (['NS','TBD'].includes(status)) return 1;
  if (isFinishedStatus(status)) return 2;
  return 3;
}

async function apiMe(request, cfg, user) {
  const [quota, record, favorites, reminders, preferences] = await Promise.all([
    getQuota(user.id, cfg),
    getUserRecord(user.id, cfg),
    getFavorites(user.id, cfg),
    getReminders(user.id, cfg),
    getPreferences(user.id, cfg),
  ]);
  return json({
    user: {
      id: user.id,
      username: user.username || '',
      firstName: user.first_name || '',
      photoUrl: user.photo_url || '',
      createdAt: record?.created_at || null,
      subscriptionUntil: record?.subscription_until || null,
    },
    quota,
    preferences,
    stats: { favorites: favorites.length, reminders: reminders.length },
  });
}

async function apiHistory(request, cfg, user) {
  const rows = await getHistory(user.id, cfg);
  return json({
    items: rows.map(x => ({
      fixtureId: Number(x.fixture_id),
      homeName: x.home_name || '',
      awayName: x.away_name || '',
      leagueName: x.league_name || '',
      fixtureDate: x.fixture_date || '',
      homeLogo: x.home_logo || '',
      awayLogo: x.away_logo || '',
      viewedAt: x.viewed_at || '',
    })),
  });
}


async function apiFavorites(request, cfg, user) {
  if (request.method === 'GET') {
    const rows = await getFavorites(user.id, cfg);
    return json({ items: rows.map(x => ({ teamId: Number(x.team_id), teamName: x.team_name || '', teamLogo: x.team_logo || '' })) });
  }
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const row = await addFavorite(user.id, { id: body.teamId, name: body.teamName, logo: body.teamLogo }, cfg);
    return json({ ok: true, item: { teamId: row.team_id, teamName: row.team_name, teamLogo: row.team_logo } });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const teamId = Number(url.searchParams.get('teamId'));
    if (!teamId) return json({ error: 'teamId обязателен.' }, 400);
    await removeFavorite(user.id, teamId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiReminders(request, cfg, user) {
  if (request.method === 'GET') {
    const rows = await getReminders(user.id, cfg);
    return json({ items: rows.map(x => ({
      fixtureId: Number(x.fixture_id), homeName: x.home_name || '', awayName: x.away_name || '',
      leagueName: x.league_name || '', fixtureDate: x.fixture_date || '', notifiedAt: x.notified_at || null,
      remindBeforeMinutes: Number(x.remind_before_minutes || 30), kickoffNotify: x.kickoff_notify !== false, kickoffNotifiedAt: x.kickoff_notified_at || null,
    })) });
  }
  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const row = await addReminder(user.id, body, cfg);
    return json({ ok: true, item: { fixtureId: row.fixture_id, fixtureDate: row.fixture_date } });
  }
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const fixtureId = Number(url.searchParams.get('fixtureId'));
    if (!fixtureId) return json({ error: 'fixtureId обязателен.' }, 400);
    await removeReminder(user.id, fixtureId, cfg);
    return json({ ok: true });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiPreferences(request, cfg, user) {
  if (request.method === 'GET') return json({ preferences: await getPreferences(user.id, cfg) });
  if (request.method === 'PUT' || request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const preferences = await savePreferences(user.id, body, cfg);
    return json({ ok: true, preferences });
  }
  return json({ error: 'Метод не поддерживается.' }, 405);
}

async function apiMatches(request, cfg) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
  const isToday = date === todayUtc();
  const cacheKey = `matches:${date}:v3`;

  // Today's list is refreshed every ~60 seconds so LIVE score/status does not
  // stay stale for 20 minutes. Yesterday/tomorrow remain heavily cached.
  const cached = await getCache(cacheKey, cfg);
  if (cached?.matches) return json({ ...cached, cached: true });

  let fixtures;
  try {
    fixtures = await apiFootball('/fixtures', { date }, cfg);
  } catch (error) {
    const message = String(error?.message || error);
    if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
      throw new Error('API-Football временно достиг лимита запросов. Подождите около минуты и нажмите обновить.');
    }
    throw error;
  }

  const matches = fixtures
    .filter(f => !['CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(f.fixture?.status?.short || ''))
    .map(f => {
      const status = f.fixture?.status?.short || '';
      const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
      const leagueId = Number(f.league?.id || 0);
      const leagueName = f.league?.name || '';
      const country = f.league?.country || '';
      const homeName = f.teams?.home?.name || '';
      const awayName = f.teams?.away?.name || '';
      return {
        fixtureId: f.fixture?.id,
        date: f.fixture?.date,
        status,
        statusLong: f.fixture?.status?.long || '',
        statusLabel: statusLabel(status, elapsed),
        elapsed,
        finished: isFinishedStatus(status),
        live: isLiveStatus(status),
        score: scoreSnapshot(f),
        leagueId,
        league: leagueName,
        country,
        leagueLogo: f.league?.logo || '',
        isTop: isTopLeague(leagueId, leagueName),
        group: leagueGroup(leagueId, leagueName, country),
        youthReserve: isYouthReserveMatch(leagueName, homeName, awayName),
        interestScore: matchInterestScore({ leagueId, leagueName, country, homeName, awayName, status, date: f.fixture?.date }),
        home: { id: f.teams?.home?.id, name: homeName, logo: f.teams?.home?.logo || '' },
        away: { id: f.teams?.away?.id, name: awayName, logo: f.teams?.away?.logo || '' },
      };
    })
    .sort((a, b) =>
      matchStatusRank(a.status) - matchStatusRank(b.status) ||
      Number(b.interestScore || 0) - Number(a.interestScore || 0) ||
      Number(b.isTop) - Number(a.isTop) ||
      String(a.date || '').localeCompare(String(b.date || ''))
    )
    .slice(0, 120);

  const payload = { date, matches, refreshedAt: new Date().toISOString(), provider: providerSnapshot() };
  await setCache(cacheKey, 0, payload, cfg, isToday ? 1 : cfg.cacheMinutes);
  return json({ ...payload, cached: false });
}

async function apiMatchCenter(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId'));
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'fixtureId обязателен.' }, 400);

  // Shared across all users. During LIVE it expires after 60 seconds.
  const baseCacheKey = `match-center:${fixtureId}:v2`;
  const cached = await getCache(baseCacheKey, cfg);
  if (cached) return json({ ...cached, cached: true });

  const fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);

  const status = fixture.fixture?.status?.short || '';
  const elapsed = Number(fixture.fixture?.status?.elapsed ?? 0) || null;
  const live = isLiveStatus(status);
  const finished = isFinishedStatus(status);
  const homeId = fixture.teams?.home?.id;
  const awayId = fixture.teams?.away?.id;
  const embedded = embeddedLiveData(fixture);
  const leagueName = fixture.league?.name || '';
  const homeName = fixture.teams?.home?.name || '';
  const awayName = fixture.teams?.away?.name || '';
  const limitedCoverage = isYouthReserveMatch(leagueName, homeName, awayName);

  // Free-plan guard: youth/reserve competitions often expose only score/status.
  // Do not burn extra /events + /statistics calls when coverage is predictably low.
  // For senior competitions, targeted fallbacks are still allowed when embedded
  // fixture data does not contain details.
  let events = embedded.events;
  let statistics = embedded.statistics;
  if (!limitedCoverage && (live || finished) && !events.length) {
    events = await apiFootball('/fixtures/events', { fixture: fixtureId }, cfg).catch(() => []);
  }
  if (!limitedCoverage && (live || finished) && !statistics.length) {
    statistics = await apiFootball('/fixtures/statistics', { fixture: fixtureId }, cfg).catch(() => []);
  }

  let liveOdds = null;
  if (live && !limitedCoverage && cfg.liveOddsEnabled && paidQuotaHealthy()) {
    const liveOddsRows = await apiFootball('/odds/live', { fixture: fixtureId }, cfg).catch(() => []);
    liveOdds = extractLiveMarket(liveOddsRows);
  }
  const refreshSeconds = live ? liveRefreshSeconds() : 0;

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: live ? 'live' : finished ? 'finished' : 'upcoming',
    match: {
      fixtureId,
      date: fixture.fixture?.date || '',
      status,
      statusLong: fixture.fixture?.status?.long || '',
      statusLabel: statusLabel(status, elapsed),
      elapsed,
      venue: fixture.fixture?.venue?.name || '',
      city: fixture.fixture?.venue?.city || '',
      league: leagueName,
      country: fixture.league?.country || '',
      score: scoreSnapshot(fixture),
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    events: formatLiveEvents(events, homeId, awayId),
    statistics: formatLiveStatistics(statistics, homeId, awayId),
    lineups: formatLineups(embedded.lineups, homeId, awayId),
    availability: {
      events: events.length > 0,
      statistics: statistics.length > 0,
      lineups: embedded.lineups.length > 0,
      players: embedded.players.length > 0,
      limitedCoverage,
    },
    liveOdds,
    provider: providerSnapshot(),
    refreshSeconds,
    note: limitedCoverage
      ? 'Молодёжный/резервный турнир: в бесплатном режиме не делаем дополнительные запросы за событиями и статистикой, чтобы не тратить лимит API. Счёт и статус обновляются.'
      : (!events.length && !statistics.length)
        ? 'Для этого турнира или конкретного матча провайдер не отдаёт детальные события/статистику. Счёт и статус всё равно обновляются.'
        : '',
  };

  await setCache(baseCacheKey, fixtureId, payload, cfg, live ? Math.max(1/6, refreshSeconds / 60) : finished ? 720 : 5);
  return json({ ...payload, cached: false });
}

async function apiAnalyze(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const fixtureId = Number(body?.fixtureId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'Некорректный fixtureId.' }, 400);

  const cacheKey = `fixture:${fixtureId}:v3-analysis-engine`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) {
    await recordHistory(user.id, cached, cfg);
    return json({ ...cached, cached: true, quota: await getQuota(user.id, cfg) });
  }

  const quotaBefore = await getQuota(user.id, cfg);
  if (quotaBefore.left <= 0) return json({ error: `Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`, quota: quotaBefore }, 429);

  const fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);

  const homeId = fixture.teams?.home?.id, awayId = fixture.teams?.away?.id;
  const homeName = fixture.teams?.home?.name || '', awayName = fixture.teams?.away?.name || '';
  const leagueName = fixture.league?.name || '';

  const kickoffMs = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
  const status = fixture.fixture?.status?.short || '';
  const shouldFetchLineups = isLiveStatus(status) ||
    (minutesToKickoff !== null && minutesToKickoff <= 120 && minutesToKickoff >= -240);
  const detailedCoverage = !isYouthReserveMatch(leagueName, homeName, awayName);

  const basePromises = [
    apiFootball('/injuries', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/predictions', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/odds', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 }, cfg).catch(() => []),
    shouldFetchLineups ? apiFootball('/fixtures/lineups', { fixture: fixtureId }, cfg).catch(() => []) : Promise.resolve([]),
    tavilySearch(`${homeName} ${awayName} injuries team news probable lineups latest`, cfg),
  ];

  if (detailedCoverage) {
    basePromises.push(
      getRecentTeamForm(homeId, 'home', fixture.fixture?.date, fixtureId, cfg).catch(() => null),
      getRecentTeamForm(awayId, 'away', fixture.fixture?.date, fixtureId, cfg).catch(() => null),
    );
  } else {
    basePromises.push(Promise.resolve(null), Promise.resolve(null));
  }

  const [injuries, predictions, odds, h2hRows, lineupsRows, web, homeForm, awayForm] = await Promise.all(basePromises);
  const market = extractMarket(odds);
  const apiPrediction = extractPrediction(predictions);
  const h2h = formatH2H(h2hRows, homeId, awayId);
  const absences = formatAbsences(injuries, homeId, awayId);
  const lineups = formatLineups(lineupsRows, homeId, awayId);
  const recentFormProb = formProbabilities(homeForm, awayForm);
  const h2hProb = h2hProbabilities(h2h);
  const blended = blendProbabilitySignals({ market, model: apiPrediction, form: recentFormProb, h2h: h2hProb });
  const probabilities = applyAbsenceAdjustment(blended.probabilities, absences);
  const goalModel = poissonGoalModel(homeForm, awayForm);
  const confidence = confidenceModel(blended.signals, probabilities, homeForm, awayForm);
  const notes = buildAnalysisNotes({
    probabilities, market, model: apiPrediction, homeForm, awayForm, h2h, absences, lineups, news: web,
    homeName, awayName, minutesToKickoff, confidence,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    analysisVersion: '2.5.0',
    match: {
      fixtureId, date: fixture.fixture?.date || '', status: fixture.fixture?.status?.short || '',
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      league: leagueName, country: fixture.league?.country || '',
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    probabilities,
    confidence,
    likelyOutcome: outcomeName(probabilities, homeName, awayName),
    modelBreakdown: {
      weights: blended.weights,
      signals: blended.signals,
      method: 'Динамическое объединение рынка, API prediction, недавней формы и H2H с небольшим консервативным учётом потерь состава.',
    },
    market,
    apiPrediction,
    recentForm: { home: homeForm, away: awayForm },
    goalModel,
    absences,
    lineups,
    h2h,
    insights: notes.factors,
    risks: notes.risks,
    news: web,
    completeness: {
      score: [fixture, market, apiPrediction, injuries.length, h2hRows.length, lineupsRows.length, web.answer, homeForm?.overall, awayForm?.overall, goalModel].filter(Boolean).length,
      max: 10,
    },
    provider: providerSnapshot(),
    disclaimer: 'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
  };

  await setCache(cacheKey, fixtureId, payload, cfg);
  await incrementUsage(user.id, cfg);
  await recordHistory(user.id, payload, cfg);
  return json({ ...payload, cached: false, quota: await getQuota(user.id, cfg) });
}

export default {
  async fetch(request, env) {
    const cfg = config(env);
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        ok: true,
        version: '2.6.0-paid-api-ready',
        database: hasSupabase(cfg) ? 'supabase' : 'memory',
        devMode: cfg.devMode,
      });
    }

    if (url.pathname === '/health/supabase') {
      if (!cfg.supabaseUrl || !cfg.supabaseKey) {
        return json({
          ok: false,
          reason: 'missing_runtime_env',
          supabaseUrlPresent: Boolean(cfg.supabaseUrl),
          supabaseKeyPresent: Boolean(cfg.supabaseKey),
        }, 503);
      }
      try {
        const testUrl = new URL(`${cfg.supabaseUrl}/rest/v1/users`);
        testUrl.searchParams.set('select', 'telegram_id');
        testUrl.searchParams.set('limit', '1');
        const r = await fetch(testUrl, { headers: supaHeaders(cfg) });
        const body = await r.text();
        return json({
          ok: r.ok,
          status: r.status,
          database: 'supabase',
          responsePreview: body.slice(0, 180),
        }, r.ok ? 200 : 502);
      } catch (error) {
        return json({ ok: false, database: 'supabase', error: String(error?.message || error) }, 502);
      }
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) return json({ error: 'Откройте приложение внутри Telegram.' }, 401);

      if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
      if (request.method === 'GET' && url.pathname === '/api/provider') return json({ provider: providerSnapshot() });
      if (request.method === 'GET' && url.pathname === '/api/matches') return await apiMatches(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/match-center') return await apiMatchCenter(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/history') return await apiHistory(request, cfg, user);
      if (url.pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
      if (url.pathname === '/api/reminders') return await apiReminders(request, cfg, user);
      if (url.pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
      if (request.method === 'POST' && url.pathname === '/api/analyze') return await apiAnalyze(request, cfg, user);
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || 'Ошибка сервера.' }, 502);
    }
  },

  async scheduled(controller, env, ctx) {
    const cfg = config(env);
    ctx.waitUntil(processDueReminders(cfg));
  },
};
