const memory = {
  users: new Map(),
  usage: new Map(),
  cache: new Map(),
};

const enc = new TextEncoder();

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
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
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
  return {
    apikey: cfg.supabaseKey,
    authorization: `Bearer ${cfg.supabaseKey}`,
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

async function setCache(cacheKey, fixtureId, payload, cfg) {
  const expiresAt = new Date(Date.now() + cfg.cacheMinutes * 60_000).toISOString();
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

async function apiFootball(path, params, cfg) {
  if (!cfg.apiFootballKey) throw new Error('API_FOOTBALL_KEY не настроен в Cloudflare.');
  const url = new URL(`https://v3.football.api-sports.io${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const r = await fetch(url, {
    headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
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

async function apiMe(request, cfg, user) {
  const quota = await getQuota(user.id, cfg);
  return json({
    user: { id: user.id, username: user.username || '', firstName: user.first_name || '', photoUrl: user.photo_url || '' },
    quota,
  });
}

async function apiMatches(request, cfg) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
  const fixtures = await apiFootball('/fixtures', { date }, cfg);
  const matches = fixtures
    .filter(f => ['NS', 'TBD', '1H', 'HT', '2H', 'ET', 'P', 'LIVE'].includes(f.fixture?.status?.short || 'NS'))
    .slice(0, 60)
    .map(f => ({
      fixtureId: f.fixture?.id,
      date: f.fixture?.date,
      status: f.fixture?.status?.short || '',
      league: f.league?.name || '',
      country: f.league?.country || '',
      leagueLogo: f.league?.logo || '',
      home: { id: f.teams?.home?.id, name: f.teams?.home?.name || '', logo: f.teams?.home?.logo || '' },
      away: { id: f.teams?.away?.id, name: f.teams?.away?.name || '', logo: f.teams?.away?.logo || '' },
    }));
  return json({ date, matches });
}

async function apiAnalyze(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const fixtureId = Number(body?.fixtureId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'Некорректный fixtureId.' }, 400);

  const cacheKey = `fixture:${fixtureId}:v2`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, quota: await getQuota(user.id, cfg) });

  const quotaBefore = await getQuota(user.id, cfg);
  if (quotaBefore.left <= 0) return json({ error: `Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`, quota: quotaBefore }, 429);

  const fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);

  const homeId = fixture.teams?.home?.id, awayId = fixture.teams?.away?.id;
  const homeName = fixture.teams?.home?.name || '', awayName = fixture.teams?.away?.name || '';

  const [injuries, predictions, odds, h2h, lineups, web] = await Promise.all([
    apiFootball('/injuries', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/predictions', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/odds', { fixture: fixtureId }, cfg).catch(() => []),
    apiFootball('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 }, cfg).catch(() => []),
    apiFootball('/fixtures/lineups', { fixture: fixtureId }, cfg).catch(() => []),
    tavilySearch(`${homeName} ${awayName} injuries team news probable lineups latest`, cfg),
  ]);

  const market = extractMarket(odds), model = extractPrediction(predictions);
  const payload = {
    generatedAt: new Date().toISOString(),
    match: {
      fixtureId, date: fixture.fixture?.date || '', status: fixture.fixture?.status?.short || '',
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      league: fixture.league?.name || '', country: fixture.league?.country || '',
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    probabilities: combineProbabilities(market, model),
    market,
    apiPrediction: model,
    absences: formatAbsences(injuries, homeId, awayId),
    lineups: formatLineups(lineups, homeId, awayId),
    h2h: formatH2H(h2h, homeId, awayId),
    news: web,
    completeness: { score: [fixture, market, model, injuries.length, h2h.length, lineups.length, web.answer].filter(Boolean).length, max: 7 },
    disclaimer: 'Статистическая аналитика не гарантирует исход матча и не является финансовой рекомендацией.',
  };

  await setCache(cacheKey, fixtureId, payload, cfg);
  await incrementUsage(user.id, cfg);
  return json({ ...payload, cached: false, quota: await getQuota(user.id, cfg) });
}

export default {
  async fetch(request, env) {
    const cfg = config(env);
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({ ok: true, version: '2.0.3-cloudflare', database: hasSupabase(cfg) ? 'supabase' : 'memory', devMode: cfg.devMode });
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) return json({ error: 'Откройте приложение внутри Telegram.' }, 401);

      if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
      if (request.method === 'GET' && url.pathname === '/api/matches') return await apiMatches(request, cfg);
      if (request.method === 'POST' && url.pathname === '/api/analyze') return await apiAnalyze(request, cfg, user);
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || 'Ошибка сервера.' }, 502);
    }
  },
};
