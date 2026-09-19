const memory = {
  users: new Map(),
  usage: new Map(),
  cache: new Map(),
  history: new Map(),
  favorites: new Map(),
  reminders: new Map(),
  preferences: new Map(),
  oddsSnapshots: new Map(),
  billingPayments: new Map(),
  modelPredictions: new Map(),
  opsEvents: [],
  integrity: { lastRun: null, recentIssues: [] },
  releaseReadiness: null,
  telemetry: {
    startedAt: new Date().toISOString(),
    apiRequests: 0,
    apiSuccess: 0,
    apiErrors: 0,
    rateLimits: 0,
    cacheHits: 0,
    cacheMisses: 0,
    staleCacheHits: 0,
    cacheWrites: 0,
    cacheWriteErrors: 0,
    supabaseErrors: 0,
    routeErrors: 0,
    integrityRuns: 0,
    integrityWarnings: 0,
    integrityErrors: 0,
    integrityQuarantined: 0,
    integrityDuplicates: 0,
  },
  provider: { name: 'API-Football', plan: 'UNKNOWN', dailyLimit: null, dailyRemaining: null, minuteLimit: null, minuteRemaining: null, updatedAt: null, cooldownUntil: null, lastError: '', lastStatus: null, lastLatencyMs: null, lastRequestAt: null, lastSuccessAt: null },
};

const enc = new TextEncoder();
const APP_VERSION = '4.4.0-match-center-2';
const MAX_MEMORY_OPS_EVENTS = 50;

const DEFAULT_PREFERENCES = Object.freeze({
  defaultFilter: 'top',
  reminderMinutes: 30,
  kickoffNotification: true,
  hideYouth: true,
  favoriteFirst: true,
});

const SUBSCRIPTION_PERIOD_SECONDS = 2592000;

const BILLING_PLANS = Object.freeze({
  PRO: {
    title: 'Football Analytics PRO',
    description: '20 анализов в день, расширенные функции и приоритетные обновления.',
    stars: 199,
    dailyLimit: 20,
  },
  PREMIUM: {
    title: 'Football Analytics PREMIUM',
    description: '100 анализов в день, максимальные лимиты и расширенные уведомления.',
    stars: 399,
    dailyLimit: 100,
  },
});

const MODEL_BASE_WEIGHTS = Object.freeze({
  market: 0.42,
  apiPrediction: 0.24,
  recentForm: 0.26,
  h2h: 0.08,
});

const CALIBRATION_CACHE_KEY = 'model-calibration:global:v3.7';
const CALIBRATION_CACHE_MINUTES = 360;


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-app-version': APP_VERSION,
      'vary': 'x-telegram-init-data',
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

function telegramIdList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map(x => Number(x))
    .filter(x => Number.isFinite(x) && x > 0);
}

function config(env) {
  return {
    devMode: boolEnv(env.DEV_MODE, false),
    apiFootballKey: env.API_FOOTBALL_KEY || '',
    tavilyKey: env.TAVILY_KEY || '',
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    adminTelegramIds: telegramIdList(env.ADMIN_TELEGRAM_IDS),
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
    liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
    // Монетизацию сознательно держим выключенной до финального этапа проекта.
    // Старый webhook может оставаться настроенным: pre-checkout будет отклонён,
    // а UI оплаты не показывается, пока флаг не включён явно.
    monetizationEnabled: boolEnv(env.MONETIZATION_ENABLED, false),
    opsRetentionDays: intEnv(env.OPS_RETENTION_DAYS, 14),
    limits: {
      FREE: intEnv(env.FREE_DAILY_LIMIT, 3),
      PRO: intEnv(env.PRO_DAILY_LIMIT, 20),
      PREMIUM: intEnv(env.PREMIUM_DAILY_LIMIT, 100),
    },
    starsPrices: {
      PRO: intEnv(env.PRO_STARS_PRICE, BILLING_PLANS.PRO.stars),
      PREMIUM: intEnv(env.PREMIUM_STARS_PRICE, BILLING_PLANS.PREMIUM.stars),
    },
  };
}

function isAdminUser(user, cfg) {
  if (!user?.id) return false;
  if (cfg.devMode) return true;
  return (cfg.adminTelegramIds || []).includes(Number(user.id));
}

function publicDataCapabilities() {
  const paid = ['PRO', 'ULTRA', 'MEGA'].includes(String(memory.provider?.plan || '').toUpperCase());
  const healthy = paidQuotaHealthy();
  return {
    visibility: 'public',
    mode: paid ? 'expanded' : 'standard',
    label: paid ? 'Расширенное покрытие' : 'Стандартное покрытие',
    refreshSeconds: liveRefreshSeconds(),
    features: {
      events: true,
      matchStatistics: true,
      lineupsFallback: Boolean(paid && healthy),
      playerStats: Boolean(paid && healthy),
      injuries: Boolean(paid && healthy),
      liveOdds: Boolean(paid && healthy),
      oddsMovement: Boolean(paid && healthy),
    },
    note: paid
      ? 'Расширенный режим активируется автоматически при доступной квоте провайдера.'
      : 'Сейчас приложение экономит запросы. После перехода провайдера на расширенный план дополнительные LIVE-данные включатся автоматически.',
  };
}

function adminForbidden() {
  return json({ error: 'Этот технический раздел доступен только администратору.', code: 'ADMIN_ONLY' }, 403);
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

async function supaInsertIgnore(cfg, table, rows, onConflict) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const r = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(cfg, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaPatch(cfg, table, filters, patch) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filters || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
    body: JSON.stringify(patch || {}),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

async function supaDelete(cfg, table, filters = {}) {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filters || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method: 'DELETE',
    headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Supabase ${table}: HTTP ${r.status}${text ? ` — ${text.slice(0, 180)}` : ''}`);
  }
}

function bumpTelemetry(key, amount = 1) {
  if (!memory.telemetry) return;
  const current = Number(memory.telemetry[key] || 0);
  memory.telemetry[key] = current + Number(amount || 0);
}

function redactOpsString(value, max = 500) {
  return String(value ?? '')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sb_secret_[A-Za-z0-9_-]+/gi, 'sb_secret_[redacted]')
    .replace(/x-apisports-key\s*[:=]\s*[^\s,;]+/gi, 'x-apisports-key=[redacted]')
    .slice(0, max);
}

function safeOpsMetadata(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (/token|secret|password|authorization|api.?key|init.?data/i.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = redactOpsString(value, 240);
    else if (Array.isArray(value)) out[key] = value.slice(0, 12).map(x => typeof x === 'string' ? redactOpsString(x, 120) : x);
    else if (typeof value === 'object') {
      try { out[key] = JSON.parse(redactOpsString(JSON.stringify(value), 600)); }
      catch { out[key] = redactOpsString(String(value), 240); }
    }
  }
  return out;
}

async function recordOpsEvent(cfg, event = {}) {
  const row = {
    created_at: new Date().toISOString(),
    severity: ['info','warning','error','critical'].includes(String(event.severity || '')) ? String(event.severity) : 'info',
    source: redactOpsString(event.source || 'worker', 80),
    event_type: redactOpsString(event.eventType || 'runtime', 100),
    code: redactOpsString(event.code || '', 100),
    message: redactOpsString(event.message || '', 500),
    endpoint: redactOpsString(event.endpoint || '', 160),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : null,
    duration_ms: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Math.round(Number(event.durationMs))) : null,
    metadata: safeOpsMetadata(event.meta || {}),
  };
  memory.opsEvents.unshift(row);
  memory.opsEvents = memory.opsEvents.slice(0, MAX_MEMORY_OPS_EVENTS);
  if (!hasSupabase(cfg)) return row;
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    await fetch(url, {
      method: 'POST',
      headers: supaHeaders(cfg, { Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
  } catch {
    // Observability must never become a new failure mode for the product.
  }
  return row;
}

async function cleanupOpsEvents(cfg) {
  if (!hasSupabase(cfg)) return { skipped: true };
  const days = Math.max(1, Number(cfg.opsRetentionDays || 14));
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  try {
    await supaDelete(cfg, 'ops_events', { created_at: `lt.${cutoff}` });
    return { ok: true, cutoff };
  } catch (error) {
    return { ok: false, error: redactOpsString(error?.message || error, 180) };
  }
}


async function cleanupIntegrityData(cfg) {
  if (!hasSupabase(cfg)) return;
  const cutoff = new Date(Date.now() - cfg.opsRetentionDays * 86400000).toISOString();
  try { await supaDelete(cfg, 'match_integrity_events', { observed_at: `lt.${cutoff}` }); } catch {}
  try { await supaDelete(cfg, 'match_integrity_runs', { observed_at: `lt.${cutoff}` }); } catch {}
}

function telemetrySnapshot() {
  const t = memory.telemetry || {};
  const requests = Number(t.apiRequests || 0);
  const hits = Number(t.cacheHits || 0);
  const misses = Number(t.cacheMisses || 0);
  const stale = Number(t.staleCacheHits || 0);
  const cacheLookups = hits + misses + stale;
  return {
    startedAt: t.startedAt || null,
    uptimeSeconds: t.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(t.startedAt)) / 1000)) : null,
    apiRequests: requests,
    apiSuccess: Number(t.apiSuccess || 0),
    apiErrors: Number(t.apiErrors || 0),
    rateLimits: Number(t.rateLimits || 0),
    quotaBlocks: Number(t.quotaBlocks || 0),
    apiSuccessRate: requests ? Math.round((Number(t.apiSuccess || 0) / requests) * 1000) / 10 : null,
    cacheHits: hits,
    cacheMisses: misses,
    staleCacheHits: stale,
    cacheWrites: Number(t.cacheWrites || 0),
    cacheWriteErrors: Number(t.cacheWriteErrors || 0),
    cacheHitRate: cacheLookups ? Math.round((hits / cacheLookups) * 1000) / 10 : null,
    supabaseErrors: Number(t.supabaseErrors || 0),
    routeErrors: Number(t.routeErrors || 0),
    integrityRuns: Number(t.integrityRuns || 0),
    integrityWarnings: Number(t.integrityWarnings || 0),
    integrityErrors: Number(t.integrityErrors || 0),
    integrityQuarantined: Number(t.integrityQuarantined || 0),
    integrityDuplicates: Number(t.integrityDuplicates || 0),
    note: 'Runtime counters describe the current Cloudflare Worker isolate; provider quota values come from API-Football response headers.',
  };
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

function billingPlanConfig(plan, cfg) {
  const key = String(plan || '').toUpperCase();
  if (!BILLING_PLANS[key]) return null;
  return {
    key,
    ...BILLING_PLANS[key],
    stars: Number(cfg.starsPrices?.[key] || BILLING_PLANS[key].stars),
    dailyLimit: Number(cfg.limits?.[key] || BILLING_PLANS[key].dailyLimit),
  };
}

async function invoiceSignature(base, botToken) {
  return bytesToHex(await hmacSha256(enc.encode(botToken), base)).slice(0, 24);
}

async function makeInvoicePayload(userId, plan, botToken) {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(6));
  const nonce = bytesToHex(nonceBytes);
  const base = `fa1|${Number(userId)}|${String(plan).toUpperCase()}|${nonce}`;
  return `${base}|${await invoiceSignature(base, botToken)}`;
}

async function parseInvoicePayload(payload, botToken) {
  const parts = String(payload || '').split('|');
  if (parts.length !== 5 || parts[0] !== 'fa1') return null;
  const [, uidRaw, planRaw, nonce, sig] = parts;
  const uid = Number(uidRaw);
  const plan = String(planRaw || '').toUpperCase();
  if (!Number.isSafeInteger(uid) || !BILLING_PLANS[plan] || !/^[0-9a-f]{12}$/i.test(nonce) || !/^[0-9a-f]{24}$/i.test(sig)) return null;
  const base = `fa1|${uid}|${plan}|${nonce}`;
  const expected = await invoiceSignature(base, botToken);
  if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return null;
  return { userId: uid, plan, nonce };
}

async function telegramApi(method, cfg, body = {}) {
  if (!cfg.botToken) throw new Error('TELEGRAM_BOT_TOKEN не настроен.');
  const r = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) throw new Error(data?.description || `Telegram ${method}: HTTP ${r.status}`);
  return data.result;
}

async function updateUserSubscription(userId, fields, cfg) {
  const patch = { ...fields, plan_updated_at: new Date().toISOString() };
  if (hasSupabase(cfg)) {
    await supaPatch(cfg, 'users', { telegram_id: `eq.${Number(userId)}` }, patch);
  } else {
    const old = memory.users.get(Number(userId)) || { telegram_id: Number(userId), plan: 'FREE' };
    memory.users.set(Number(userId), { ...old, ...patch });
  }
}

async function saveBillingPayment(row, cfg) {
  if (!row?.telegram_payment_charge_id) return;
  if (hasSupabase(cfg)) {
    await supaUpsert(cfg, 'billing_payments', row, 'telegram_payment_charge_id');
  } else {
    memory.billingPayments.set(String(row.telegram_payment_charge_id), row);
  }
}

async function applySuccessfulPayment(userId, payment, cfg, fallbackDate = Math.floor(Date.now() / 1000)) {
  if (!payment || payment.currency !== 'XTR') return false;
  const parsed = await parseInvoicePayload(payment.invoice_payload, cfg.botToken);
  if (!parsed || Number(parsed.userId) !== Number(userId)) return false;
  const planCfg = billingPlanConfig(parsed.plan, cfg);
  if (!planCfg || Number(payment.total_amount) !== Number(planCfg.stars)) return false;

  const expiresUnix = Number(payment.subscription_expiration_date || 0)
    || (Number(fallbackDate || Math.floor(Date.now() / 1000)) + SUBSCRIPTION_PERIOD_SECONDS);
  const expiresAt = new Date(expiresUnix * 1000).toISOString();

  const chargeId = String(payment.telegram_payment_charge_id || '');
  if (!chargeId) return false;

  await saveBillingPayment({
    telegram_payment_charge_id: chargeId,
    telegram_id: Number(userId),
    plan: parsed.plan,
    stars_amount: Number(payment.total_amount),
    currency: 'XTR',
    invoice_payload: String(payment.invoice_payload || ''),
    provider_payment_charge_id: payment.provider_payment_charge_id || null,
    subscription_expiration_date: expiresAt,
    is_recurring: Boolean(payment.is_recurring),
    is_first_recurring: Boolean(payment.is_first_recurring),
    status: 'paid',
    created_at: new Date(Number(fallbackDate || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }, cfg);

  await updateUserSubscription(userId, {
    plan: parsed.plan,
    subscription_until: expiresAt,
    subscription_canceled: false,
    telegram_payment_charge_id: chargeId,
  }, cfg);
  return true;
}

async function billingWebhookStatus(request, cfg) {
  if (!cfg.botToken || !cfg.webhookSecret) {
    return { ready: false, reason: 'webhook_not_configured', expectedUrl: `${new URL(request.url).origin}/telegram/webhook` };
  }
  const expectedUrl = `${new URL(request.url).origin}/telegram/webhook`;
  try {
    const info = await telegramApi('getWebhookInfo', cfg);
    const ready = String(info?.url || '') === expectedUrl;
    return {
      ready,
      expectedUrl,
      currentUrl: info?.url || '',
      pendingUpdates: Number(info?.pending_update_count || 0),
      lastError: info?.last_error_message || '',
      reason: ready ? '' : 'webhook_url_mismatch',
    };
  } catch (e) {
    return { ready: false, reason: 'webhook_check_failed', expectedUrl, error: String(e?.message || e) };
  }
}

async function syncBillingFromStars(userId, cfg) {
  const tx = await telegramApi('getStarTransactions', cfg, { offset: 0, limit: 100 });
  const list = Array.isArray(tx?.transactions) ? tx.transactions : [];
  let best = null;

  for (const item of list) {
    const source = item?.source;
    if (!source || source.type !== 'user' || source.transaction_type !== 'invoice_payment') continue;
    if (Number(source.user?.id) !== Number(userId)) continue;
    const parsed = await parseInvoicePayload(source.invoice_payload, cfg.botToken);
    if (!parsed || Number(parsed.userId) !== Number(userId)) continue;
    const planCfg = billingPlanConfig(parsed.plan, cfg);
    if (!planCfg || Number(item.amount) !== Number(planCfg.stars)) continue;
    const period = Number(source.subscription_period || SUBSCRIPTION_PERIOD_SECONDS);
    const expiresUnix = Number(item.date || 0) + period;
    if (!best || expiresUnix > best.expiresUnix) best = { item, source, parsed, expiresUnix };
  }

  if (!best || best.expiresUnix * 1000 <= Date.now()) {
    return { synced: false, quota: await getQuota(userId, cfg) };
  }

  await applySuccessfulPayment(userId, {
    currency: 'XTR',
    total_amount: Number(best.item.amount),
    invoice_payload: best.source.invoice_payload,
    telegram_payment_charge_id: String(best.item.id || ''),
    provider_payment_charge_id: '',
    subscription_expiration_date: best.expiresUnix,
    is_recurring: true,
    is_first_recurring: false,
  }, cfg, Number(best.item.date || Math.floor(Date.now() / 1000)));

  return { synced: true, quota: await getQuota(userId, cfg) };
}

async function handleTelegramWebhook(request, cfg) {
  if (!cfg.webhookSecret) return json({ ok: false, error: 'webhook_secret_missing' }, 503);
  const provided = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!constantTimeEqual(String(provided), String(cfg.webhookSecret))) return json({ ok: false }, 403);

  let update = {};
  try { update = await request.json(); } catch { return json({ ok: false }, 400); }

  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    if (!cfg.monetizationEnabled) {
      await telegramApi('answerPreCheckoutQuery', cfg, {
        pre_checkout_query_id: q.id,
        ok: false,
        error_message: 'Оплата временно отключена: мы завершаем основной функционал сервиса.',
      });
      return json({ ok: true });
    }
    let ok = false;
    let errorMessage = 'Не удалось проверить подписку.';
    try {
      const parsed = await parseInvoicePayload(q.invoice_payload, cfg.botToken);
      const planCfg = parsed ? billingPlanConfig(parsed.plan, cfg) : null;
      ok = Boolean(
        parsed
        && Number(parsed.userId) === Number(q.from?.id)
        && q.currency === 'XTR'
        && planCfg
        && Number(q.total_amount) === Number(planCfg.stars)
      );
      if (!ok) errorMessage = 'Параметры подписки не совпадают. Откройте приложение и создайте счёт заново.';
    } catch {}
    await telegramApi('answerPreCheckoutQuery', cfg, {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: errorMessage }),
    });
    return json({ ok: true });
  }

  const msg = update.message;
  if (msg?.successful_payment) {
    await applySuccessfulPayment(msg.from?.id, msg.successful_payment, cfg, Number(msg.date || Math.floor(Date.now() / 1000)));
    return json({ ok: true });
  }

  if (msg?.refunded_payment) {
    const refund = msg.refunded_payment;
    const userId = Number(msg.from?.id || 0);
    const chargeId = String(refund.telegram_payment_charge_id || '');
    if (hasSupabase(cfg) && chargeId) {
      await supaPatch(cfg, 'billing_payments', { telegram_payment_charge_id: `eq.${chargeId}` }, { status: 'refunded', updated_at: new Date().toISOString() });
    }
    const record = userId ? await getUserRecord(userId, cfg) : null;
    if (record && String(record.telegram_payment_charge_id || '') === chargeId) {
      await updateUserSubscription(userId, {
        plan: 'FREE',
        subscription_until: new Date().toISOString(),
        subscription_canceled: true,
        telegram_payment_charge_id: null,
      }, cfg);
    }
    return json({ ok: true });
  }

  if (update.subscription) {
    const sub = update.subscription;
    const parsed = await parseInvoicePayload(sub.invoice_payload, cfg.botToken);
    if (parsed && Number(parsed.userId) === Number(sub.user?.id)) {
      if (sub.state === 'canceled') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: true }, cfg);
      } else if (sub.state === 'active') {
        await updateUserSubscription(parsed.userId, { subscription_canceled: false }, cfg);
      }
    }
    return json({ ok: true });
  }

  if (msg?.text && /^\/start(?:@\w+)?(?:\s|$)/i.test(msg.text)) {
    const appUrl = new URL(request.url).origin;
    await telegramApi('sendMessage', cfg, {
      chat_id: msg.chat?.id,
      text: '⚽ Football Analytics\n\nОткройте приложение, чтобы выбрать матч и получить анализ.',
      reply_markup: {
        inline_keyboard: [[{ text: '⚽ Открыть приложение', web_app: { url: appUrl } }]],
      },
    });
  }

  return json({ ok: true });
}

async function apiBillingPlans(request, cfg, user) {
  const webhook = await billingWebhookStatus(request, cfg);
  const quota = await getQuota(user.id, cfg);
  const record = await getUserRecord(user.id, cfg);
  return json({
    ready: webhook.ready,
    reason: webhook.reason || '',
    webhook: { expectedUrl: webhook.expectedUrl, currentUrl: webhook.currentUrl || '', lastError: webhook.lastError || '' },
    current: {
      plan: quota.plan,
      subscriptionUntil: record?.subscription_until || null,
      canceled: Boolean(record?.subscription_canceled),
    },
    plans: {
      FREE: { stars: 0, dailyLimit: cfg.limits.FREE },
      PRO: { stars: billingPlanConfig('PRO', cfg).stars, dailyLimit: cfg.limits.PRO },
      PREMIUM: { stars: billingPlanConfig('PREMIUM', cfg).stars, dailyLimit: cfg.limits.PREMIUM },
    },
  });
}

async function apiBillingInvoice(request, cfg, user) {
  const webhook = await billingWebhookStatus(request, cfg);
  if (!webhook.ready) return json({ error: 'Оплата ещё не активирована: Telegram webhook не настроен.', webhook }, 503);

  let body = {};
  try { body = await request.json(); } catch {}
  const plan = String(body.plan || '').toUpperCase();
  const planCfg = billingPlanConfig(plan, cfg);
  if (!planCfg) return json({ error: 'Неизвестный тариф.' }, 400);

  const quota = await getQuota(user.id, cfg);
  const record = await getUserRecord(user.id, cfg);
  if (quota.plan !== 'FREE' && record?.subscription_until && new Date(record.subscription_until) > new Date()) {
    return json({ error: quota.plan === plan ? 'Этот тариф уже активен.' : 'Сначала отключите автопродление текущего тарифа и дождитесь окончания оплаченного периода.' }, 409);
  }

  const payload = await makeInvoicePayload(user.id, plan, cfg.botToken);
  const invoiceUrl = await telegramApi('createInvoiceLink', cfg, {
    title: planCfg.title,
    description: planCfg.description,
    payload,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `${plan} · 30 дней`, amount: planCfg.stars }],
    subscription_period: SUBSCRIPTION_PERIOD_SECONDS,
  });
  return json({ invoiceUrl, plan, stars: planCfg.stars });
}

async function apiBillingSync(request, cfg, user) {
  return json(await syncBillingFromStars(user.id, cfg));
}

async function apiBillingSubscription(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = body.action === 'resume' ? 'resume' : 'cancel';
  const record = await getUserRecord(user.id, cfg);
  const chargeId = String(record?.telegram_payment_charge_id || '');
  if (!chargeId) return json({ error: 'Активная подписка Telegram Stars не найдена.' }, 404);
  await telegramApi('editUserStarSubscription', cfg, {
    user_id: Number(user.id),
    telegram_payment_charge_id: chargeId,
    is_canceled: action === 'cancel',
  });
  await updateUserSubscription(user.id, { subscription_canceled: action === 'cancel' }, cfg);
  return json({ ok: true, canceled: action === 'cancel' });
}

async function getCacheEntry(cacheKey, cfg, allowExpired = false) {
  // L1 cache inside the current Worker isolate. This reduces Supabase reads and
  // also gives us a tiny fallback during a transient database problem.
  const local = memory.cache.get(cacheKey);
  if (local && local.expiresAt > Date.now()) {
    bumpTelemetry('cacheHits');
    return { payload: local.payload, expired: false, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory' };
  }

  if (hasSupabase(cfg)) {
    try {
      const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
      if (!row) {
        bumpTelemetry('cacheMisses');
        if (allowExpired && local) {
          bumpTelemetry('staleCacheHits');
          return { payload: local.payload, expired: true, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory-stale' };
        }
        return null;
      }
      const expiresAtMs = Date.parse(row.expires_at);
      const expired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : true;
      memory.cache.set(cacheKey, { payload: row.payload, expiresAt: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() - 1 });
      if (expired && !allowExpired) {
        bumpTelemetry('cacheMisses');
        return null;
      }
      if (expired) bumpTelemetry('staleCacheHits');
      else bumpTelemetry('cacheHits');
      return { payload: row.payload, expired, expiresAt: row.expires_at, layer: 'supabase' };
    } catch (error) {
      bumpTelemetry('supabaseErrors');
      if (local && (allowExpired || local.expiresAt > Date.now())) {
        if (local.expiresAt <= Date.now()) bumpTelemetry('staleCacheHits');
        else bumpTelemetry('cacheHits');
        recordOpsEvent(cfg, {
          severity: 'warning', source: 'cache', eventType: 'supabase_cache_read_fallback', code: 'CACHE_DB_READ',
          message: error?.message || error, meta: { cacheKey },
        }).catch(() => {});
        return { payload: local.payload, expired: local.expiresAt <= Date.now(), expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory-fallback' };
      }
      throw error;
    }
  }

  if (!local) {
    bumpTelemetry('cacheMisses');
    return null;
  }
  const expired = local.expiresAt <= Date.now();
  if (expired && !allowExpired) {
    bumpTelemetry('cacheMisses');
    return null;
  }
  if (expired) bumpTelemetry('staleCacheHits');
  else bumpTelemetry('cacheHits');
  return { payload: local.payload, expired, expiresAt: new Date(local.expiresAt).toISOString(), layer: 'memory' };
}

async function getCache(cacheKey, cfg) {
  return (await getCacheEntry(cacheKey, cfg, false))?.payload || null;
}

async function getStaleCache(cacheKey, cfg) {
  return (await getCacheEntry(cacheKey, cfg, true))?.payload || null;
}

async function setCache(cacheKey, fixtureId, payload, cfg, minutes = cfg.cacheMinutes) {
  const ttlMinutes = Number.isFinite(Number(minutes)) ? Math.max(1 / 6, Number(minutes)) : cfg.cacheMinutes;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const expiresAtMs = Date.parse(expiresAt);
  // Always keep an L1 copy. Supabase remains the persistent/shared cache.
  memory.cache.set(cacheKey, { payload, expiresAt: expiresAtMs });
  bumpTelemetry('cacheWrites');
  if (!hasSupabase(cfg)) return;
  try {
    await supaUpsert(cfg, 'analysis_cache', {
      cache_key: cacheKey,
      fixture_id: Number(fixtureId),
      payload,
      expires_at: expiresAt,
    }, 'cache_key');
  } catch (error) {
    bumpTelemetry('cacheWriteErrors');
    bumpTelemetry('supabaseErrors');
    recordOpsEvent(cfg, {
      severity: 'warning', source: 'cache', eventType: 'supabase_cache_write_fallback', code: 'CACHE_DB_WRITE',
      message: error?.message || error, meta: { cacheKey, fixtureId: Number(fixtureId || 0) },
    }).catch(() => {});
    // Cache persistence is an optimization. Do not fail a successful user request
    // only because the shared cache could not be written.
  }
}

function predictionOutcomeKey(probabilities) {
  if (!probabilities) return '';
  const rows = [
    ['home', Number(probabilities.home)],
    ['draw', Number(probabilities.draw)],
    ['away', Number(probabilities.away)],
  ].filter(([, value]) => Number.isFinite(value));
  if (rows.length !== 3) return '';
  rows.sort((a, b) => b[1] - a[1]);
  return rows[0]?.[0] || '';
}

function predictionOutcomeLabel(key, homeName = 'Хозяева', awayName = 'Гости') {
  if (key === 'home') return homeName;
  if (key === 'away') return awayName;
  if (key === 'draw') return 'Ничья';
  return '—';
}

function topProbabilityValue(row) {
  return Math.max(Number(row?.home_prob || 0), Number(row?.draw_prob || 0), Number(row?.away_prob || 0));
}

function actualOutcomeFromGoals(homeGoals, awayGoals) {
  const h = Number(homeGoals), a = Number(awayGoals);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return '';
  if (h > a) return 'home';
  if (a > h) return 'away';
  return 'draw';
}

function regulationScore(fixture) {
  const full = fixture?.score?.fulltime || fixture?.score?.fullTime || null;
  let home = Number(full?.home), away = Number(full?.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    home = Number(fixture?.goals?.home ?? fixture?.score?.home);
    away = Number(fixture?.goals?.away ?? fixture?.score?.away);
  }
  return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
}

function fixtureIdentity(fixture) {
  return Number(fixture?.fixture?.id || fixture?.fixtureId || fixture?.id || 0);
}

function fixtureStatusShort(fixture) {
  return String(fixture?.fixture?.status?.short || fixture?.status || '');
}

function scoreBrier(row, actualOutcome) {
  const probs = {
    home: Math.max(0, Math.min(1, Number(row.home_prob || 0) / 100)),
    draw: Math.max(0, Math.min(1, Number(row.draw_prob || 0) / 100)),
    away: Math.max(0, Math.min(1, Number(row.away_prob || 0) / 100)),
  };
  const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
  return Math.round((sum / 3) * 10000) / 10000;
}

function validThreeProbabilities(probabilities) {
  return Boolean(probabilities && ['home','draw','away'].every(key => Number.isFinite(Number(probabilities[key]))));
}

function rowFinalProbabilities(row) {
  const raw = [row?.home_prob, row?.draw_prob, row?.away_prob];
  if (raw.some(value => value === null || value === undefined || value === '')) return null;
  const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
  if (!validThreeProbabilities(p)) return null;
  return normalizeThree(p.home, p.draw, p.away);
}

function rowRawProbabilities(row) {
  const raw = [row?.raw_home_prob, row?.raw_draw_prob, row?.raw_away_prob];
  if (raw.some(value => value === null || value === undefined || value === '')) return rowFinalProbabilities(row);
  const p = { home: Number(raw[0]), draw: Number(raw[1]), away: Number(raw[2]) };
  if (!validThreeProbabilities(p)) return rowFinalProbabilities(row);
  return normalizeThree(p.home, p.draw, p.away) || rowFinalProbabilities(row);
}

function brierFromProbabilities(probabilities, actualOutcome) {
  if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
  const probs = {
    home: Math.max(0, Math.min(1, Number(probabilities.home) / 100)),
    draw: Math.max(0, Math.min(1, Number(probabilities.draw) / 100)),
    away: Math.max(0, Math.min(1, Number(probabilities.away) / 100)),
  };
  const sum = ['home','draw','away'].reduce((acc, key) => acc + Math.pow(probs[key] - (actualOutcome === key ? 1 : 0), 2), 0);
  return Math.round((sum / 3) * 10000) / 10000;
}

function logLossFromProbabilities(probabilities, actualOutcome) {
  if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(actualOutcome || ''))) return null;
  const p = Math.max(0.01, Math.min(0.99, Number(probabilities[actualOutcome]) / 100));
  return -Math.log(p);
}

function temperatureScaleProbabilities(probabilities, temperature = 1) {
  if (!validThreeProbabilities(probabilities)) return probabilities || null;
  const t = clamp(Number(temperature) || 1, 0.8, 1.35);
  if (Math.abs(t - 1) < 0.001) return normalizeThree(probabilities.home, probabilities.draw, probabilities.away);
  const exponent = 1 / t;
  const h = Math.pow(Math.max(0.0001, Number(probabilities.home) / 100), exponent);
  const d = Math.pow(Math.max(0.0001, Number(probabilities.draw) / 100), exponent);
  const a = Math.pow(Math.max(0.0001, Number(probabilities.away) / 100), exponent);
  return normalizeThree(h, d, a);
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function signalProbabilitySnapshot(signals) {
  const out = {};
  for (const signal of signals || []) {
    if (!signal?.name || !validThreeProbabilities(signal.probabilities)) continue;
    out[String(signal.name)] = normalizeThree(signal.probabilities.home, signal.probabilities.draw, signal.probabilities.away);
  }
  return out;
}

function predictedOutcomeForProbabilities(probabilities) {
  return predictionOutcomeKey(probabilities);
}

function averageMetric(rows, fn) {
  const values = (rows || []).map(fn).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function fitTemperatureCalibration(rows) {
  const valid = (rows || [])
    .filter(row => ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row))
    .sort((a, b) => Date.parse(a.kickoff_at || 0) - Date.parse(b.kickoff_at || 0));
  if (valid.length < 50) {
    return { active: false, temperature: 1, sample: valid.length, trainSample: 0, validationSample: 0, baselineLogLoss: null, calibratedLogLoss: null, improvement: null };
  }

  const validationCount = Math.max(10, Math.min(50, Math.floor(valid.length * 0.2)));
  const train = valid.slice(0, valid.length - validationCount);
  const validation = valid.slice(valid.length - validationCount);
  if (train.length < 40 || validation.length < 10) {
    return { active: false, temperature: 1, sample: valid.length, trainSample: train.length, validationSample: validation.length, baselineLogLoss: null, calibratedLogLoss: null, improvement: null };
  }

  let bestTemperature = 1;
  let bestTrainLoss = Infinity;
  for (let t = 0.8; t <= 1.3501; t += 0.05) {
    const temperature = Math.round(t * 100) / 100;
    const loss = averageMetric(train, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), temperature), row.actual_outcome));
    if (Number.isFinite(loss) && loss < bestTrainLoss) {
      bestTrainLoss = loss;
      bestTemperature = temperature;
    }
  }

  const baselineValidation = averageMetric(validation, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const candidateValidation = averageMetric(validation, row => logLossFromProbabilities(temperatureScaleProbabilities(rowRawProbabilities(row), bestTemperature), row.actual_outcome));
  const gain = Number.isFinite(baselineValidation) && Number.isFinite(candidateValidation) ? baselineValidation - candidateValidation : 0;
  // Guardrail: a temperature learned on the training slice is activated only if it also helps on newer holdout matches.
  const active = Math.abs(bestTemperature - 1) >= 0.04 && gain >= 0.005;
  return {
    active,
    temperature: active ? bestTemperature : 1,
    candidateTemperature: bestTemperature,
    sample: valid.length,
    trainSample: train.length,
    validationSample: validation.length,
    baselineLogLoss: Number.isFinite(baselineValidation) ? Math.round(baselineValidation * 1000) / 1000 : null,
    calibratedLogLoss: Number.isFinite(candidateValidation) ? Math.round(candidateValidation * 1000) / 1000 : null,
    improvement: Number.isFinite(baselineValidation) && baselineValidation > 0 ? Math.round((gain / baselineValidation) * 1000) / 10 : null,
  };
}

function signalCalibrationStats(rows) {
  const names = Object.keys(MODEL_BASE_WEIGHTS);
  return names.map(name => {
    const samples = [];
    for (const row of rows || []) {
      const signalMap = parseJsonObject(row?.signal_probabilities);
      const probabilities = signalMap?.[name];
      if (!validThreeProbabilities(probabilities) || !['home','draw','away'].includes(String(row?.actual_outcome || ''))) continue;
      samples.push({ probabilities, actualOutcome: String(row.actual_outcome) });
    }
    const briers = samples.map(x => brierFromProbabilities(x.probabilities, x.actualOutcome)).filter(Number.isFinite);
    const hits = samples.filter(x => predictedOutcomeForProbabilities(x.probabilities) === x.actualOutcome).length;
    const avgBrier = briers.length ? average(briers) : null;
    return {
      name,
      sample: samples.length,
      accuracy: pct(hits, samples.length),
      avgBrier: Number.isFinite(avgBrier) ? Math.round(avgBrier * 1000) / 1000 : null,
      baseWeight: MODEL_BASE_WEIGHTS[name],
    };
  });
}

function adaptiveSignalWeights(stats) {
  const eligible = (stats || []).filter(x => x.sample >= 30 && Number.isFinite(Number(x.avgBrier)));
  const active = eligible.length >= 2;
  if (!active) return { active: false, weights: { ...MODEL_BASE_WEIGHTS }, stats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] })) };

  const unnormalized = {};
  for (const item of stats || []) {
    const base = Number(MODEL_BASE_WEIGHTS[item.name] || 0);
    if (!base) continue;
    let adjusted = base;
    if (item.sample >= 30 && Number.isFinite(Number(item.avgBrier))) {
      // Uniform 1X2 has Brier ~= 0.222. Convert skill into a small, strongly capped weight adjustment.
      const qualityFactor = clamp(0.2222 / Math.max(0.12, Number(item.avgBrier)), 0.85, 1.15);
      const shrink = Math.min(1, item.sample / 100) * 0.65;
      adjusted = base * (1 + (qualityFactor - 1) * shrink);
      adjusted = clamp(adjusted, base * 0.88, base * 1.12);
    }
    unnormalized[item.name] = adjusted;
  }
  const sum = Object.values(unnormalized).reduce((acc, value) => acc + Number(value || 0), 0) || 1;
  const weights = Object.fromEntries(Object.entries(unnormalized).map(([name, value]) => [name, Number(value) / sum]));
  return {
    active: true,
    weights,
    stats: (stats || []).map(x => ({ ...x, currentWeight: Number(weights[x.name] ?? MODEL_BASE_WEIGHTS[x.name] ?? 0) })),
  };
}

function baselineCalibrationProfile(sample = 0, stats = []) {
  return {
    version: '3.7',
    generatedAt: new Date().toISOString(),
    mode: sample >= 20 ? 'shadow' : 'baseline',
    sample,
    temperature: 1,
    temperatureActive: false,
    weightsActive: false,
    signalWeights: { ...MODEL_BASE_WEIGHTS },
    signalStats: (stats || []).map(x => ({ ...x, currentWeight: MODEL_BASE_WEIGHTS[x.name] || 0 })),
    temperatureValidation: { sample, trainSample: 0, validationSample: 0, baselineLogLoss: null, calibratedLogLoss: null, improvement: null },
    note: sample >= 20 ? 'Калибратор собирает выборку в теневом режиме. Итоговые вероятности пока не меняются.' : 'Сначала нужно накопить завершённые предматчевые прогнозы.',
  };
}

function buildCalibrationProfile(rows) {
  const valid = (rows || []).filter(row => ['home','draw','away'].includes(String(row.actual_outcome || '')));
  const signalStats = signalCalibrationStats(valid);
  const temperature = fitTemperatureCalibration(valid);
  const weights = adaptiveSignalWeights(signalStats);
  const active = Boolean(temperature.active || weights.active);
  const shadow = !active && (valid.length >= 20 || signalStats.some(x => x.sample >= 10));
  return {
    version: '3.7',
    generatedAt: new Date().toISOString(),
    mode: active ? 'active' : shadow ? 'shadow' : 'baseline',
    sample: valid.length,
    temperature: temperature.active ? temperature.temperature : 1,
    temperatureActive: Boolean(temperature.active),
    weightsActive: Boolean(weights.active),
    signalWeights: weights.active ? weights.weights : { ...MODEL_BASE_WEIGHTS },
    signalStats: weights.stats,
    temperatureValidation: temperature,
    note: active
      ? 'Калибровка включена только после проверки на более новых holdout-матчах; изменения весов ограничены защитными пределами.'
      : shadow
        ? 'Данные уже собираются, но защитные пороги ещё не разрешили менять итоговые вероятности.'
        : 'Недостаточно завершённых прогнозов для безопасной автоматической калибровки.',
  };
}

async function getCalibrationProfile(cfg, { force = false } = {}) {
  if (!force) {
    try {
      const cached = await getCache(CALIBRATION_CACHE_KEY, cfg);
      if (cached?.version === '3.7') return cached;
    } catch {}
  }

  let rows = [];
  if (hasSupabase(cfg)) {
    try {
      const since = new Date(Date.now() - 365 * 86400_000).toISOString();
      rows = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' });
    } catch (error) {
      return baselineCalibrationProfile(0, []);
    }
  } else {
    rows = [...memory.modelPredictions.values()].filter(x => x.status === 'settled');
  }
  const profile = buildCalibrationProfile(rows);
  try { await setCache(CALIBRATION_CACHE_KEY, 0, profile, cfg, CALIBRATION_CACHE_MINUTES); } catch {}
  return profile;
}

async function captureModelPrediction(payload, cfg) {
  const match = payload?.match;
  const probabilities = payload?.probabilities;
  const fixtureId = Number(match?.fixtureId || 0);
  const kickoffMs = Date.parse(match?.date || '');
  const status = String(match?.status || '').toUpperCase();
  if (!fixtureId || !probabilities || !Number.isFinite(kickoffMs)) return false;
  if (!['NS', 'TBD'].includes(status)) return false;
  // Backtest only genuine pre-match snapshots, never a prediction captured after kickoff.
  if (kickoffMs <= Date.now() + 120_000) return false;
  const predictedOutcome = predictionOutcomeKey(probabilities);
  if (!predictedOutcome) return false;

  const row = {
    fixture_id: fixtureId,
    analysis_version: String(payload.analysisVersion || '3.7.0-model-calibration'),
    captured_at: new Date().toISOString(),
    kickoff_at: new Date(kickoffMs).toISOString(),
    league_id: Number(match.leagueId || 0) || null,
    league_name: String(match.league || ''),
    home_id: Number(match.home?.id || 0) || null,
    away_id: Number(match.away?.id || 0) || null,
    home_name: String(match.home?.name || ''),
    away_name: String(match.away?.name || ''),
    home_prob: Number(probabilities.home),
    draw_prob: Number(probabilities.draw),
    away_prob: Number(probabilities.away),
    predicted_outcome: predictedOutcome,
    confidence_score: Number(payload.confidence?.score || 0) || null,
    signal_names: (payload.modelBreakdown?.signals || []).map(x => String(x?.name || '')).filter(Boolean),
    signal_weights: payload.modelBreakdown?.weights || {},
    signal_probabilities: signalProbabilitySnapshot(payload.modelBreakdown?.signals || []),
    raw_home_prob: Number.isFinite(Number(payload.rawProbabilities?.home)) ? Number(payload.rawProbabilities.home) : Number(probabilities.home),
    raw_draw_prob: Number.isFinite(Number(payload.rawProbabilities?.draw)) ? Number(payload.rawProbabilities.draw) : Number(probabilities.draw),
    raw_away_prob: Number.isFinite(Number(payload.rawProbabilities?.away)) ? Number(payload.rawProbabilities.away) : Number(probabilities.away),
    calibration_mode: String(payload.modelCalibration?.mode || 'baseline'),
    calibration_temperature: Number(payload.modelCalibration?.temperature || 1),
    calibration_sample: Number(payload.modelCalibration?.sample || 0),
    calibration_weights: payload.modelCalibration?.signalWeights || {},
    data_mode: String(payload.dataPolicy?.mode || ''),
    completeness_score: Number(payload.completeness?.score || 0),
    completeness_max: Number(payload.completeness?.max || 0),
    home_expected_goals: Number.isFinite(Number(payload.goalModel?.homeExpected)) ? Number(payload.goalModel.homeExpected) : null,
    away_expected_goals: Number.isFinite(Number(payload.goalModel?.awayExpected)) ? Number(payload.goalModel.awayExpected) : null,
    over25_prob: Number.isFinite(Number(payload.goalModel?.over25)) ? Number(payload.goalModel.over25) : null,
    btts_prob: Number.isFinite(Number(payload.goalModel?.btts)) ? Number(payload.goalModel.btts) : null,
    status: 'pending',
  };

  if (hasSupabase(cfg)) {
    try {
      // fixture_id is the primary key: the FIRST pre-match snapshot stays immutable.
      await supaInsertIgnore(cfg, 'model_predictions', row, 'fixture_id');
      return true;
    } catch (error) {
      // Keep v3.6 installations functional until the optional v3.7 ALTER migration is applied.
      try {
        const legacyRow = { ...row };
        for (const key of ['signal_probabilities','raw_home_prob','raw_draw_prob','raw_away_prob','calibration_mode','calibration_temperature','calibration_sample','calibration_weights']) delete legacyRow[key];
        await supaInsertIgnore(cfg, 'model_predictions', legacyRow, 'fixture_id');
        console.warn('v3.7 calibration columns are not available yet; prediction stored in legacy format');
        return true;
      } catch (legacyError) {
        console.warn('model prediction capture skipped', legacyError?.message || error?.message || error);
        return false;
      }
    }
  }
  if (!memory.modelPredictions.has(fixtureId)) memory.modelPredictions.set(fixtureId, row);
  return true;
}

async function settlePredictionsFromFixtures(fixtures, cfg) {
  const finished = (fixtures || []).filter(f => isFinishedStatus(fixtureStatusShort(f)) && fixtureIdentity(f));
  if (!finished.length) return { checked: 0, settled: 0 };
  const ids = [...new Set(finished.map(fixtureIdentity).filter(Boolean))];
  let rows = [];
  if (hasSupabase(cfg)) {
    try {
      rows = await supaSelectMany(cfg, 'model_predictions', {
        status: 'eq.pending',
        fixture_id: `in.(${ids.join(',')})`,
      }, { limit: Math.min(500, ids.length + 10) });
    } catch (error) {
      console.warn('model prediction settle read skipped', error?.message || error);
      return { checked: 0, settled: 0 };
    }
  } else {
    rows = ids.map(id => memory.modelPredictions.get(Number(id))).filter(x => x?.status === 'pending');
  }
  if (!rows.length) return { checked: 0, settled: 0 };

  const fixtureMap = new Map(finished.map(f => [fixtureIdentity(f), f]));
  let settled = 0;
  for (const row of rows) {
    const fixture = fixtureMap.get(Number(row.fixture_id));
    const score = regulationScore(fixture);
    if (!score) continue;
    const actualOutcome = actualOutcomeFromGoals(score.home, score.away);
    if (!actualOutcome) continue;
    const totalGoals = score.home + score.away;
    const bttsActual = score.home > 0 && score.away > 0;
    const over25Actual = totalGoals >= 3;
    const patch = {
      status: 'settled',
      settled_at: new Date().toISOString(),
      actual_home_goals: score.home,
      actual_away_goals: score.away,
      actual_outcome: actualOutcome,
      correct: String(row.predicted_outcome || '') === actualOutcome,
      brier_score: scoreBrier(row, actualOutcome),
      over25_actual: over25Actual,
      over25_correct: row.over25_prob === null || row.over25_prob === undefined ? null : (Number(row.over25_prob) >= 50) === over25Actual,
      btts_actual: bttsActual,
      btts_correct: row.btts_prob === null || row.btts_prob === undefined ? null : (Number(row.btts_prob) >= 50) === bttsActual,
    };
    if (hasSupabase(cfg)) {
      try {
        await supaPatch(cfg, 'model_predictions', { fixture_id: `eq.${Number(row.fixture_id)}`, status: 'eq.pending' }, patch);
        settled++;
      } catch (error) {
        console.warn('model prediction settle patch skipped', error?.message || error);
      }
    } else {
      memory.modelPredictions.set(Number(row.fixture_id), { ...row, ...patch });
      settled++;
    }
  }
  return { checked: rows.length, settled };
}

function average(values) {
  const rows = (values || []).map(Number).filter(Number.isFinite);
  return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function qualityBucket(rows, label) {
  const valid = (rows || []).filter(x => typeof x.correct === 'boolean');
  return {
    label,
    sample: valid.length,
    accuracy: pct(valid.filter(x => x.correct).length, valid.length),
    avgBrier: valid.length ? Math.round((average(valid.map(x => x.brier_score)) || 0) * 1000) / 1000 : null,
  };
}

function buildModelQuality(settledRows, pendingRows, days, calibrationProfile = null) {
  const rows = (settledRows || []).filter(x => ['home','draw','away'].includes(String(x.actual_outcome || '')));
  const evaluated = rows.length;
  const correct = rows.filter(x => x.correct === true).length;
  const brier = average(rows.map(x => x.brier_score));
  const logLossValues = rows.map(row => {
    const key = String(row.actual_outcome || '');
    const p = Math.max(0.01, Math.min(0.99, Number(row[`${key}_prob`] || 0) / 100));
    return -Math.log(p);
  });
  const avgLogLoss = average(logLossValues);

  const calibrationDefs = [
    ['34–44%', 34, 45], ['45–54%', 45, 55], ['55–64%', 55, 65], ['65–74%', 65, 75], ['75%+', 75, 101],
  ];
  const calibration = calibrationDefs.map(([label, min, max]) => {
    const group = rows.filter(x => { const p = topProbabilityValue(x); return p >= min && p < max; });
    return {
      label, sample: group.length,
      avgPredicted: group.length ? Math.round((average(group.map(topProbabilityValue)) || 0) * 10) / 10 : null,
      hitRate: pct(group.filter(x => x.correct === true).length, group.length),
    };
  });

  const confidence = [
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) < 55), 'Низкая'),
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 55 && Number(x.confidence_score || 0) < 72), 'Средняя'),
    qualityBucket(rows.filter(x => Number(x.confidence_score || 0) >= 72), 'Высокая'),
  ];

  const outcome = ['home','draw','away'].map(key => {
    const group = rows.filter(x => String(x.predicted_outcome || '') === key);
    return { key, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length) };
  });

  const signalNames = ['market','apiPrediction','recentForm','h2h'];
  const signals = signalNames.map(name => {
    const group = rows.filter(x => Array.isArray(x.signal_names) && x.signal_names.includes(name));
    return { name, sample: group.length, accuracy: pct(group.filter(x => x.correct === true).length, group.length), avgBrier: group.length ? Math.round((average(group.map(x => x.brier_score)) || 0) * 1000) / 1000 : null };
  });

  const signalPerformance = signalCalibrationStats(rows);
  const v37Rows = rows.filter(row => /^(?:3\.(?:[7-9]|[1-9]\d)|[4-9]\.)/.test(String(row.analysis_version || '')) && ['home','draw','away'].includes(String(row.actual_outcome || '')) && rowRawProbabilities(row));
  const rawBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const finalBrier = averageMetric(v37Rows, row => brierFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
  const rawLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowRawProbabilities(row), row.actual_outcome));
  const finalLogLoss = averageMetric(v37Rows, row => logLossFromProbabilities(rowFinalProbabilities(row), row.actual_outcome));
  const calibrationImpact = {
    sample: v37Rows.length,
    rawBrier: Number.isFinite(rawBrier) ? Math.round(rawBrier * 1000) / 1000 : null,
    finalBrier: Number.isFinite(finalBrier) ? Math.round(finalBrier * 1000) / 1000 : null,
    brierDelta: Number.isFinite(rawBrier) && Number.isFinite(finalBrier) ? Math.round((rawBrier - finalBrier) * 1000) / 1000 : null,
    rawLogLoss: Number.isFinite(rawLogLoss) ? Math.round(rawLogLoss * 1000) / 1000 : null,
    finalLogLoss: Number.isFinite(finalLogLoss) ? Math.round(finalLogLoss * 1000) / 1000 : null,
    logLossDelta: Number.isFinite(rawLogLoss) && Number.isFinite(finalLogLoss) ? Math.round((rawLogLoss - finalLogLoss) * 1000) / 1000 : null,
  };

  const over25Rows = rows.filter(x => typeof x.over25_correct === 'boolean');
  const bttsRows = rows.filter(x => typeof x.btts_correct === 'boolean');
  const recent = rows.slice(0, 12).map(row => ({
    fixtureId: Number(row.fixture_id), kickoffAt: row.kickoff_at, league: row.league_name || '',
    home: row.home_name || '', away: row.away_name || '',
    score: `${Number(row.actual_home_goals)}:${Number(row.actual_away_goals)}`,
    predictedOutcome: row.predicted_outcome || '', actualOutcome: row.actual_outcome || '',
    predictedLabel: predictionOutcomeLabel(row.predicted_outcome, row.home_name, row.away_name),
    topProbability: Math.round(topProbabilityValue(row) * 10) / 10,
    correct: row.correct === true, brier: Number(row.brier_score), confidence: Number(row.confidence_score || 0) || null,
  }));

  return {
    periodDays: days,
    generatedAt: new Date().toISOString(),
    sample: { settled: evaluated, pending: (pendingRows || []).length, ready: evaluated >= 20, calibrationReady: evaluated >= 50 },
    headline: {
      accuracy: pct(correct, evaluated),
      avgBrier: brier === null ? null : Math.round(brier * 1000) / 1000,
      avgLogLoss: avgLogLoss === null ? null : Math.round(avgLogLoss * 1000) / 1000,
      avgTopProbability: evaluated ? Math.round((average(rows.map(topProbabilityValue)) || 0) * 10) / 10 : null,
    },
    calibration,
    confidence,
    outcome,
    signals,
    signalPerformance,
    calibrationEngine: calibrationProfile || baselineCalibrationProfile(evaluated, signalPerformance),
    calibrationImpact,
    secondary: {
      over25: { sample: over25Rows.length, accuracy: pct(over25Rows.filter(x => x.over25_correct === true).length, over25Rows.length) },
      btts: { sample: bttsRows.length, accuracy: pct(bttsRows.filter(x => x.btts_correct === true).length, bttsRows.length) },
    },
    recent,
    methodology: {
      snapshot: 'Для каждого fixture сохраняется первый расчёт, сделанный до стартового свистка. Поздние перерасчёты не перезаписывают его.',
      outcome: 'Точность исхода = доля матчей, где максимальная вероятность 1X2 совпала с фактическим исходом.',
      brier: 'Brier score учитывает все три вероятности 1X2; ниже — лучше. В интерфейсе он показан вместе с размером выборки.',
      warning: evaluated < 20 ? 'Выборка пока мала: цифры считаются технической диагностикой, а не доказанной точностью модели.' : '',
    },
  };
}

async function apiModelQuality(request, cfg) {
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get('days') || 90);
  const days = [30, 90, 180, 365].includes(requestedDays) ? requestedDays : 90;
  const forceCalibration = url.searchParams.get('refresh') === '1';
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  let settled = [], pending = [];
  if (hasSupabase(cfg)) {
    try {
      [settled, pending] = await Promise.all([
        supaSelectMany(cfg, 'model_predictions', { status: 'eq.settled', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
        supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${since}` }, { limit: 500, order: 'kickoff_at.desc' }),
      ]);
    } catch (error) {
      return json({ available: false, reason: 'Таблица backtest ещё не создана. Выполните supabase_migration_v3_6.sql.', detail: String(error?.message || error).slice(0, 180) });
    }
  } else {
    const all = [...memory.modelPredictions.values()].filter(x => Date.parse(x.kickoff_at || '') >= Date.parse(since));
    settled = all.filter(x => x.status === 'settled').sort((a,b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at));
    pending = all.filter(x => x.status === 'pending');
  }
  const calibrationProfile = await getCalibrationProfile(cfg, { force: forceCalibration }).catch(() => baselineCalibrationProfile(settled.length));
  return json({ available: true, ...buildModelQuality(settled, pending, days, calibrationProfile) });
}

async function settleBacktestDaily(cfg) {
  if (!hasSupabase(cfg) || !cfg.apiFootballKey) return { skipped: 'no_persistent_database_or_provider' };
  const d = new Date(Date.now() - 86400_000);
  const date = d.toISOString().slice(0, 10);
  const markerKey = `backtest:settled:${date}:v1`;
  if (await getCache(markerKey, cfg)) return { skipped: 'already_checked', date };
  const start = `${date}T00:00:00.000Z`;
  const end = new Date(Date.parse(start) + 86400_000).toISOString();
  let pending = [];
  try {
    pending = await supaSelectMany(cfg, 'model_predictions', { status: 'eq.pending', kickoff_at: `gte.${start}` }, { limit: 200, order: 'kickoff_at.asc' });
  } catch (error) {
    console.warn('daily backtest pending read skipped', error?.message || error);
    return { skipped: 'prediction_table_unavailable' };
  }
  pending = pending.filter(x => Date.parse(x.kickoff_at || '') < Date.parse(end));
  if (!pending.length) {
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: 0 }, cfg, 1440);
    return { date, pending: 0, settled: 0 };
  }
  if (!freeQuotaHealthy(12, 3)) return { skipped: 'provider_quota_guard', date, pending: pending.length };
  try {
    const fixtures = await apiFootball('/fixtures', { date }, cfg);
    const result = await settlePredictionsFromFixtures(fixtures, cfg);
    await setCache(markerKey, 0, { checkedAt: new Date().toISOString(), pending: pending.length, settled: result.settled }, cfg, 1440);
    return { date, pending: pending.length, settled: result.settled };
  } catch (error) {
    console.warn('daily backtest settle skipped', error?.message || error);
    return { skipped: 'provider_error', date };
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
    ...memory.provider,
    name: 'API-Football',
    plan: dailyLimit !== null ? inferFootballPlan(dailyLimit) : (memory.provider?.plan || 'UNKNOWN'),
    dailyLimit: dailyLimit ?? memory.provider?.dailyLimit ?? null,
    dailyRemaining: dailyRemaining ?? memory.provider?.dailyRemaining ?? null,
    minuteLimit: minuteLimit ?? memory.provider?.minuteLimit ?? null,
    minuteRemaining: minuteRemaining ?? memory.provider?.minuteRemaining ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function quotaUsed(limit, remaining) {
  if (limit === null || limit === undefined || remaining === null || remaining === undefined || limit === '' || remaining === '') return null;
  const l = Number(limit), r = Number(remaining);
  return Number.isFinite(l) && Number.isFinite(r) ? Math.max(0, l - r) : null;
}

function quotaUsedPct(limit, remaining) {
  const l = Number(limit), used = quotaUsed(limit, remaining);
  return Number.isFinite(l) && l > 0 && Number.isFinite(used) ? Math.round((used / l) * 1000) / 10 : null;
}

function providerSnapshot() {
  const paid = ['PRO','ULTRA','MEGA'].includes(memory.provider?.plan || '');
  const cooldownUntil = memory.provider?.cooldownUntil || null;
  const cooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());
  const dailyUsed = quotaUsed(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
  const minuteUsed = quotaUsed(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
  const dailyUsedPct = quotaUsedPct(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
  const minuteUsedPct = quotaUsedPct(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
  let health = 'ok';
  if ((memory.provider?.plan || 'UNKNOWN') === 'UNKNOWN' && !memory.provider?.updatedAt) health = 'waiting';
  else if (cooldownActive || memory.provider?.lastError === 'rate_limit') health = 'critical';
  else if (memory.provider?.lastError || (Number.isFinite(Number(memory.provider?.minuteRemaining)) && Number(memory.provider.minuteRemaining) <= 2) || (Number.isFinite(dailyUsedPct) && dailyUsedPct >= 90)) health = 'warning';
  return {
    visibility: 'admin',
    ...(memory.provider || {}),
    dailyUsed,
    minuteUsed,
    dailyUsedPct,
    minuteUsedPct,
    health,
    liveOddsReady: paid,
    playerStatsReady: paid,
    oddsMovementReady: paid,
    cooldownActive,
    cooldownUntil: cooldownActive ? cooldownUntil : null,
  };
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

function footballError(message, code = 'FOOTBALL_API', retryAfter = 0) {
  const error = new Error(message);
  error.code = code;
  error.retryAfter = Math.max(0, Number(retryAfter || 0));
  return error;
}

function isFootballRateLimitError(error) {
  return ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN'].includes(String(error?.code || ''))
    || /too many requests|rate.?limit|requests per minute|лимит запросов/i.test(String(error?.message || ''));
}

function footballCooldownRemaining() {
  const until = Date.parse(memory.provider?.cooldownUntil || '');
  return Number.isFinite(until) ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
}

function freeQuotaHealthy(minDaily = 25, minMinute = 5) {
  const p = memory.provider || {};
  if (['PRO','ULTRA','MEGA'].includes(p.plan)) return true;
  if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < minDaily) return false;
  if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < minMinute) return false;
  return !providerSnapshot().cooldownActive;
}

async function apiFootball(path, params, cfg, options = {}) {
  if (!cfg.apiFootballKey) {
    await recordOpsEvent(cfg, { severity: 'critical', source: 'provider', eventType: 'configuration', code: 'FOOTBALL_CONFIG', message: 'API_FOOTBALL_KEY отсутствует.' });
    throw footballError('API_FOOTBALL_KEY не настроен в Cloudflare.', 'FOOTBALL_CONFIG');
  }

  const cooldown = footballCooldownRemaining();
  if (cooldown > 0) {
    bumpTelemetry('quotaBlocks');
    throw footballError(`API-Football на паузе после ограничения. Повторите примерно через ${cooldown} сек.`, 'FOOTBALL_COOLDOWN', cooldown);
  }
  if (Number(memory.provider?.minuteRemaining) === 0 && memory.provider?.updatedAt) {
    const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(memory.provider.updatedAt)) / 1000));
    const waitSec = Math.max(1, 60 - ageSec);
    if (waitSec > 0 && ageSec < 60) {
      memory.provider.cooldownUntil = new Date(Date.now() + waitSec * 1000).toISOString();
      bumpTelemetry('quotaBlocks');
      throw footballError(`Минутная квота API-Football исчерпана. Повторите примерно через ${waitSec} сек.`, 'FOOTBALL_COOLDOWN', waitSec);
    }
  }

  const url = new URL(`https://v3.football.api-sports.io${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const startedAt = Date.now();
  bumpTelemetry('apiRequests');
  memory.provider.lastRequestAt = new Date(startedAt).toISOString();
  let r;
  try {
    r = await fetch(url, {
      headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    bumpTelemetry('apiErrors');
    memory.provider.lastStatus = null;
    memory.provider.lastLatencyMs = durationMs;
    memory.provider.lastError = 'network_error';
    await recordOpsEvent(cfg, {
      severity: 'error', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_NETWORK',
      message: error?.message || 'Network error', endpoint: path, durationMs,
    });
    throw footballError('Не удалось подключиться к API-Football.', 'FOOTBALL_NETWORK');
  }

  const durationMs = Date.now() - startedAt;
  updateProviderFromHeaders(r);
  memory.provider.lastStatus = r.status;
  memory.provider.lastLatencyMs = durationMs;
  const body = await r.json().catch(() => ({}));

  if (r.status === 429) {
    const retryHeader = Number(r.headers.get('retry-after') || 0);
    const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 65;
    memory.provider.cooldownUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
    memory.provider.lastError = 'rate_limit';
    bumpTelemetry('apiErrors');
    bumpTelemetry('rateLimits');
    await recordOpsEvent(cfg, {
      severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT',
      message: `API-Football HTTP 429; retry ${retryAfter}s`, endpoint: path, status: r.status, durationMs,
      meta: { retryAfter, plan: memory.provider?.plan || 'UNKNOWN', minuteRemaining: memory.provider?.minuteRemaining, dailyRemaining: memory.provider?.dailyRemaining },
    });
    throw footballError(`API-Football достиг минутного лимита. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_RATE_LIMIT', retryAfter);
  }
  if (!r.ok) {
    memory.provider.lastError = `http_${r.status}`;
    bumpTelemetry('apiErrors');
    await recordOpsEvent(cfg, {
      severity: r.status >= 500 ? 'error' : 'warning', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_HTTP',
      message: `API-Football HTTP ${r.status}`, endpoint: path, status: r.status, durationMs,
    });
    throw footballError(`API-Football временно недоступен (HTTP ${r.status}).`, 'FOOTBALL_HTTP');
  }

  const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
  if (errors.length) {
    const message = errors.join('; ');
    memory.provider.lastError = message.slice(0, 160);
    bumpTelemetry('apiErrors');
    if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
      memory.provider.cooldownUntil = new Date(Date.now() + 65_000).toISOString();
      bumpTelemetry('rateLimits');
      await recordOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT_BODY',
        message, endpoint: path, status: r.status, durationMs,
      });
      throw footballError('API-Football достиг лимита запросов. Покажем кэш, если он есть.', 'FOOTBALL_RATE_LIMIT', 65);
    }
    await recordOpsEvent(cfg, {
      severity: 'warning', source: 'provider', eventType: 'api_response', code: 'FOOTBALL_RESPONSE',
      message, endpoint: path, status: r.status, durationMs,
    });
    throw footballError(`API-Football: ${message}`, 'FOOTBALL_RESPONSE');
  }

  memory.provider.lastError = '';
  memory.provider.lastSuccessAt = new Date().toISOString();
  bumpTelemetry('apiSuccess');
  if (options.responseType === 'any') return body.response ?? null;
  return Array.isArray(body.response) ? body.response : [];
}

async function probeSupabase(cfg) {
  if (!hasSupabase(cfg)) return { configured: false, ok: false, status: 'not_configured', latencyMs: null, cache: null };
  const startedAt = Date.now();
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
    url.searchParams.set('select', 'cache_key,expires_at');
    url.searchParams.set('order', 'expires_at.desc');
    url.searchParams.set('limit', '200');
    const r = await fetch(url, { headers: supaHeaders(cfg, { Prefer: 'count=exact' }) });
    const latencyMs = Date.now() - startedAt;
    if (!r.ok) {
      bumpTelemetry('supabaseErrors');
      const text = await r.text().catch(() => '');
      return { configured: true, ok: false, status: `http_${r.status}`, latencyMs, detail: redactOpsString(text, 180), cache: null };
    }
    const rows = await r.json().catch(() => []);
    const now = Date.now();
    const fresh = rows.filter(x => Date.parse(x.expires_at || '') > now).length;
    const stale = rows.filter(x => Date.parse(x.expires_at || '') <= now).length;
    const range = r.headers.get('content-range') || '';
    const totalRaw = range.includes('/') ? range.split('/').pop() : '';
    const total = /^\d+$/.test(totalRaw) ? Number(totalRaw) : rows.length;
    return {
      configured: true,
      ok: true,
      status: 'ok',
      latencyMs,
      cache: { total, sampled: rows.length, freshInSample: fresh, staleInSample: stale, newestExpiry: rows?.[0]?.expires_at || null },
    };
  } catch (error) {
    bumpTelemetry('supabaseErrors');
    return { configured: true, ok: false, status: 'network_error', latencyMs: Date.now() - startedAt, detail: redactOpsString(error?.message || error, 180), cache: null };
  }
}

async function readRecentOpsEvents(cfg, limit = 10) {
  const fallback = () => ({ persistent: false, migrationReady: false, items: memory.opsEvents.slice(0, limit) });
  if (!hasSupabase(cfg)) return fallback();
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/ops_events`);
    url.searchParams.set('select', 'created_at,severity,source,event_type,code,message,endpoint,status,duration_ms,metadata');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(Math.max(1, Math.min(20, limit))));
    const r = await fetch(url, { headers: supaHeaders(cfg) });
    if (!r.ok) return fallback();
    const items = await r.json().catch(() => []);
    return { persistent: true, migrationReady: true, items };
  } catch {
    return fallback();
  }
}

async function collectDiagnostics(cfg) {
  const [supabase, ops, integrity] = await Promise.all([
    probeSupabase(cfg),
    readRecentOpsEvents(cfg, 12),
    readIntegrityDiagnostics(cfg, 12),
  ]);
  const provider = providerSnapshot();
  let overall;
  if (supabase.configured && !supabase.ok) overall = { state: 'critical', label: 'Нужна проверка Supabase' };
  else if (provider.health === 'critical') overall = { state: 'critical', label: 'API-Football временно ограничен' };
  else if (!ops.migrationReady && hasSupabase(cfg)) overall = { state: 'warning', label: 'Выполните migration v3.8' };
  else if (!integrity.migrationReady && hasSupabase(cfg)) overall = { state: 'warning', label: 'Выполните migration v3.9' };
  else if (integrity.lastRun?.health === 'critical') overall = { state: 'warning', label: 'Есть проблемы качества футбольных данных' };
  else if (provider.health === 'warning' || integrity.lastRun?.health === 'warning' || Number(memory.telemetry?.routeErrors || 0) > 0 || Number(memory.telemetry?.cacheWriteErrors || 0) > 0) overall = { state: 'warning', label: 'Есть предупреждения' };
  else if (provider.health === 'waiting') overall = { state: 'waiting', label: 'Ожидаем первый запрос к API' };
  else overall = { state: 'ok', label: 'Системы работают штатно' };

  const recommendations = [];
  if (supabase.ok && !ops.migrationReady && hasSupabase(cfg)) recommendations.push('Выполните supabase_migration_v3_8.sql, чтобы журнал ошибок сохранялся между перезапусками Worker.');
  if (!integrity.migrationReady && hasSupabase(cfg)) recommendations.push('Выполните supabase_migration_v3_9.sql, чтобы проверки качества матчей сохранялись и были видны после перезапуска Worker.');
  if (provider.cooldownActive) recommendations.push(`API-Football находится на паузе ещё примерно ${footballCooldownRemaining()} сек.; приложение должно использовать сохранённый кэш.`);
  if (supabase.configured && !supabase.ok) recommendations.push('Проверьте SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY и доступность PostgREST.');
  if (Number(provider.dailyUsedPct) >= 90) recommendations.push('Дневная квота API-Football использована более чем на 90%; до сброса лимита работаем в экономном режиме.');
  if (Number(integrity.lastRun?.quarantined || 0) > 0) recommendations.push(`Integrity Guard скрыл ${Number(integrity.lastRun.quarantined)} подозрительных матч(а/ей) из последней выборки. Проверьте список issue codes ниже.`);
  if (Number(integrity.lastRun?.warnings || 0) > 0 && !Number(integrity.lastRun?.quarantined || 0)) recommendations.push('В последней выборке есть предупреждения целостности данных; приложение оставило матчи доступными, но пометило их для контроля.');
  if (!recommendations.length) recommendations.push('Критичных действий сейчас не требуется.');

  return {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    overall,
    provider,
    supabase,
    runtime: telemetrySnapshot(),
    observability: { persistent: ops.persistent, migrationReady: ops.migrationReady, retentionDays: cfg.opsRetentionDays, recentEvents: ops.items },
    integrity,
    recommendations,
  };
}

async function apiDiagnostics(request, cfg) {
  return json(await collectDiagnostics(cfg));
}

async function probeOptionalTable(cfg, table) {
  if (!hasSupabase(cfg)) return { ok: false, status: 'not_configured' };
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', '*');
    url.searchParams.set('limit', '1');
    const r = await fetch(url, { headers: supaHeaders(cfg) });
    if (r.ok) return { ok: true, status: 'ok' };
    return { ok: false, status: `http_${r.status}` };
  } catch (error) {
    return { ok: false, status: 'network_error', detail: redactOpsString(error?.message || error, 120) };
  }
}

function releaseCheck(id, label, state, detail, blocking = false) {
  return { id, label, state, detail, blocking: Boolean(blocking) };
}

async function apiReleaseReadiness(request, cfg) {
  const now = Date.now();
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  if (!force && memory.releaseReadiness?.value && now - Number(memory.releaseReadiness.at || 0) < 30000) {
    return json({ ...memory.releaseReadiness.value, cached: true });
  }

  const [diagnostics, modelTable] = await Promise.all([
    collectDiagnostics(cfg),
    probeOptionalTable(cfg, 'model_predictions'),
  ]);
  const provider = diagnostics.provider || {};
  const checks = [
    releaseCheck('football_api', 'API-Football key', cfg.apiFootballKey ? 'pass' : 'fail', cfg.apiFootballKey ? 'Ключ доступен Worker.' : 'API_FOOTBALL_KEY отсутствует.', true),
    releaseCheck('supabase_config', 'Supabase config', hasSupabase(cfg) ? 'pass' : 'fail', hasSupabase(cfg) ? 'URL и service key доступны runtime.' : 'Не хватает SUPABASE_URL или service key.', true),
    releaseCheck('supabase_online', 'Supabase/PostgREST', diagnostics.supabase?.ok ? 'pass' : 'fail', diagnostics.supabase?.ok ? `Ответ ${Number(diagnostics.supabase?.latencyMs || 0)} мс.` : `Статус: ${diagnostics.supabase?.status || 'offline'}.`, true),
    releaseCheck('model_backtest', 'Backtest schema v3.6+', modelTable.ok ? 'pass' : 'fail', modelTable.ok ? 'Таблица model_predictions доступна.' : `model_predictions: ${modelTable.status}.`, true),
    releaseCheck('observability', 'Observability schema v3.8', diagnostics.observability?.migrationReady ? 'pass' : 'warn', diagnostics.observability?.migrationReady ? 'Постоянный журнал ops_events доступен.' : 'Журнал работает только в памяти Worker.', false),
    releaseCheck('integrity', 'Data Integrity schema v3.9', diagnostics.integrity?.migrationReady ? 'pass' : 'fail', diagnostics.integrity?.migrationReady ? 'История integrity-проверок доступна.' : 'Нужна migration v3.9.', true),
    releaseCheck('provider_health', 'Состояние API-Football', provider.health === 'critical' ? 'fail' : provider.health === 'warning' || provider.health === 'waiting' ? 'warn' : 'pass', provider.health === 'waiting' ? 'Ещё не было успешного provider-запроса после старта Worker.' : `Health: ${provider.health || 'unknown'}.`, provider.health === 'critical'),
    releaseCheck('telegram', 'Telegram bot runtime', cfg.botToken ? 'pass' : 'warn', cfg.botToken ? 'TELEGRAM_BOT_TOKEN доступен.' : 'Без bot token не будут работать Telegram-уведомления.', false),
    releaseCheck('production_mode', 'Production mode', cfg.devMode ? 'warn' : 'pass', cfg.devMode ? 'DEV_MODE=true — перед релизом выключить.' : 'DEV_MODE=false.', false),
    releaseCheck('monetization', 'Монетизация', cfg.monetizationEnabled ? 'warn' : 'pass', cfg.monetizationEnabled ? 'Монетизация включена, хотя текущий план проекта — запускать её в финале.' : 'Оплата корректно остаётся на паузе.', false),
    releaseCheck('integrity_last_run', 'Последняя проверка матчей', diagnostics.integrity?.lastRun?.health === 'critical' ? 'warn' : 'pass', diagnostics.integrity?.lastRun ? `Health: ${diagnostics.integrity.lastRun.health || 'ok'}, quality ${Number(diagnostics.integrity.lastRun.qualityScore || 0)}%.` : 'Проверка появится после загрузки каталога матчей.', false),
  ];

  const blockers = checks.filter(x => x.state === 'fail' && x.blocking);
  const warnings = checks.filter(x => x.state === 'warn' || (x.state === 'fail' && !x.blocking));
  const passed = checks.filter(x => x.state === 'pass').length;
  const score = Math.round((passed / checks.length) * 100);
  const status = blockers.length ? 'blocked' : warnings.length ? 'warning' : 'ready';
  const label = blockers.length ? 'Есть блокирующие проверки' : warnings.length ? 'Ядро готово, есть предупреждения' : 'Core release candidate готов';

  const value = {
    available: true,
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    label,
    score,
    checks,
    blockers: blockers.map(x => x.id),
    warnings: warnings.map(x => x.id),
    diagnostics,
    policy: {
      monetizationExpected: 'paused',
      paymentTestingRequiredNow: false,
      providerUpgradeRequiredNow: false,
      note: 'v4.2 проверяет готовность основной бесплатной части. Оплата и переход на расширенный API остаются отдельными будущими этапами.',
    },
  };
  memory.releaseReadiness = { at: now, value };
  return json(value);
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


function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatPlayerLeaders(rows, homeId, awayId) {
  const sides = { home: [], away: [] };
  for (const teamRow of rows || []) {
    const teamId = Number(teamRow.team?.id || 0);
    const side = teamId === Number(homeId) ? 'home' : teamId === Number(awayId) ? 'away' : '';
    if (!side) continue;
    for (const entry of teamRow.players || []) {
      const st = entry.statistics?.[0] || {};
      const rating = numericValue(st.games?.rating);
      const minutes = numericValue(st.games?.minutes) || 0;
      const goals = numericValue(st.goals?.total) || 0;
      const assists = numericValue(st.goals?.assists) || 0;
      const saves = numericValue(st.goals?.saves) || 0;
      const shotsOn = numericValue(st.shots?.on) || 0;
      const keyPasses = numericValue(st.passes?.key) || 0;
      const tackles = numericValue(st.tackles?.total) || 0;
      const interceptions = numericValue(st.tackles?.interceptions) || 0;
      if (!minutes && rating === null && !goals && !assists && !saves && !shotsOn && !keyPasses) continue;
      const impact = (rating || 0) * 10 + goals * 20 + assists * 14 + saves * 2 + shotsOn * 2 + keyPasses * 1.5 + tackles + interceptions;
      sides[side].push({
        id: Number(entry.player?.id || 0),
        name: entry.player?.name || 'Игрок',
        photo: entry.player?.photo || '',
        position: st.games?.position || '',
        rating: rating !== null ? Math.round(rating * 10) / 10 : null,
        minutes,
        goals,
        assists,
        saves,
        shotsOn,
        keyPasses,
        tackles,
        interceptions,
        impact: Math.round(impact * 10) / 10,
      });
    }
  }
  for (const side of ['home','away']) {
    sides[side].sort((a,b) => b.impact - a.impact || (b.rating || 0) - (a.rating || 0) || b.minutes - a.minutes);
    sides[side] = sides[side].slice(0, 6);
  }
  return sides;
}

function livePressure(statistics) {
  const rows = statistics?.items || [];
  if (!rows.length) return null;
  const get = key => rows.find(x => x.key === key) || {};
  const val = (x, side) => numericValue(x?.[side]) || 0;
  const totalShots = get('Total Shots');
  const shotsOn = get('Shots on Goal');
  const corners = get('Corner Kicks');
  const possession = get('Ball Possession');
  const reds = get('Red Cards');
  const saves = get('Goalkeeper Saves');
  const score = side => (
    val(shotsOn, side) * 4.2 +
    val(totalShots, side) * 1.25 +
    val(corners, side) * 1.4 +
    val(possession, side) * 0.07 +
    val(saves, side === 'home' ? 'away' : 'home') * 0.8 -
    val(reds, side) * 7
  );
  const h = Math.max(0, score('home'));
  const a = Math.max(0, score('away'));
  if (h + a < 1) return null;
  const home = Math.round(h / (h + a) * 100);
  const away = 100 - home;
  const diff = home - away;
  return {
    home, away,
    leader: Math.abs(diff) < 10 ? 'balanced' : diff > 0 ? 'home' : 'away',
    note: 'Эвристика давления по ударам, владению, угловым, сейвам и карточкам. Это не вероятность победы.',
  };
}

async function getOddsSnapshots(fixtureId, cfg, limit = 12) {
  if (hasSupabase(cfg)) {
    try {
      const rows = await supaSelectMany(cfg, 'odds_snapshots', {
        fixture_id: `eq.${Number(fixtureId)}`,
        market: 'eq.1x2',
      }, { limit, order: 'snapshot_time.desc' });
      return (rows || []).map(x => ({
        at: x.snapshot_time,
        home: Number(x.home_odd), draw: Number(x.draw_odd), away: Number(x.away_odd),
        homeProb: Number(x.home_prob), drawProb: Number(x.draw_prob), awayProb: Number(x.away_prob),
        sources: Number(x.source_count || 0),
      }));
    } catch { return []; }
  }
  return (memory.oddsSnapshots.get(Number(fixtureId)) || []).slice(-limit).reverse();
}

async function saveOddsSnapshot(fixtureId, market, cfg) {
  if (!market?.odds) return false;
  const previous = await getOddsSnapshots(fixtureId, cfg, 1);
  const prev = previous[0];
  const now = new Date();
  const changed = !prev || ['home','draw','away'].some(k => Math.abs(Number(market.odds[k]) - Number(prev[k])) >= 0.03);
  const oldEnough = !prev?.at || (now.getTime() - Date.parse(prev.at)) >= 120000;
  if (!changed && !oldEnough) return false;
  const p = market.probabilities || {};
  const row = {
    fixture_id: Number(fixtureId), market: '1x2', snapshot_time: now.toISOString(),
    home_odd: Number(market.odds.home), draw_odd: Number(market.odds.draw), away_odd: Number(market.odds.away),
    home_prob: Number(p.home || 0), draw_prob: Number(p.draw || 0), away_prob: Number(p.away || 0),
    source_count: Number(market.sources || market.bookmakers || 0),
  };
  if (hasSupabase(cfg)) {
    try { await supaUpsert(cfg, 'odds_snapshots', row); return true; } catch { return false; }
  }
  const list = memory.oddsSnapshots.get(Number(fixtureId)) || [];
  list.push({ at: row.snapshot_time, home: row.home_odd, draw: row.draw_odd, away: row.away_odd, homeProb: row.home_prob, drawProb: row.draw_prob, awayProb: row.away_prob, sources: row.source_count });
  memory.oddsSnapshots.set(Number(fixtureId), list.slice(-50));
  return true;
}

function buildOddsMovement(snapshots, current) {
  if (!current?.odds) return null;
  const history = Array.isArray(snapshots) ? snapshots.filter(x => x && x.at) : [];
  const baseline = history.length ? history[history.length - 1] : null;
  if (!baseline) return { sample: 1, baseline: null, current: current.odds, probabilityChange: null };
  const currentP = current.probabilities || normalizeThree(1/current.odds.home,1/current.odds.draw,1/current.odds.away) || {};
  const baseP = (baseline.homeProb || baseline.drawProb || baseline.awayProb)
    ? { home: baseline.homeProb, draw: baseline.drawProb, away: baseline.awayProb }
    : normalizeThree(1/baseline.home,1/baseline.draw,1/baseline.away) || {};
  const delta = key => Math.round(((Number(currentP[key] || 0) - Number(baseP[key] || 0)) * 10)) / 10;
  return {
    sample: history.length + 1,
    from: baseline.at,
    baseline: { home: baseline.home, draw: baseline.draw, away: baseline.away },
    current: current.odds,
    probabilityChange: { home: delta('home'), draw: delta('draw'), away: delta('away') },
  };
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

async function getRecentTeamForm(teamId, preferredVenue, fixtureDate, fixtureId, cfg, { allowNetwork = true } = {}) {
  if (!teamId) return null;
  const targetMs = Number.isFinite(Date.parse(fixtureDate || '')) ? Date.parse(fixtureDate) : Date.now();
  const to = ymd(new Date(targetMs - 60_000));
  const from = ymd(new Date(targetMs - 90 * 86400_000));
  const cacheKey = `teamform:${Number(teamId)}:${preferredVenue}:${to}:v2`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return cached;
  if (!allowNetwork) return null;
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

function blendProbabilitySignals({ market, model, form, h2h, weightOverrides = null }) {
  const configured = weightOverrides && typeof weightOverrides === 'object' ? weightOverrides : MODEL_BASE_WEIGHTS;
  const candidates = [
    ['market', market?.probabilities, Number(configured.market ?? MODEL_BASE_WEIGHTS.market)],
    ['apiPrediction', model?.probabilities, Number(configured.apiPrediction ?? MODEL_BASE_WEIGHTS.apiPrediction)],
    ['recentForm', form, Number(configured.recentForm ?? MODEL_BASE_WEIGHTS.recentForm)],
    ['h2h', h2h, Number(configured.h2h ?? MODEL_BASE_WEIGHTS.h2h)],
  ].filter(([, p, w]) => p && [p.home, p.draw, p.away].every(x => Number.isFinite(Number(x))) && Number.isFinite(w) && w > 0);
  if (!candidates.length) return { probabilities: null, weights: {}, signals: [] };
  const weightSum = candidates.reduce((sum, x) => sum + x[2], 0);
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
function normalizeLineupPlayer(entry) {
  const p = entry?.player || {};
  if (!p?.name) return null;
  return {
    id: Number(p.id || 0),
    name: p.name || 'Игрок',
    number: p.number ?? null,
    pos: p.pos || '',
    grid: p.grid || '',
    photo: p.photo || '',
  };
}

function formatLineups(rows, homeId, awayId) {
  const out = { home: null, away: null };
  for (const x of rows || []) {
    const lineup = {
      formation: x.formation || '',
      coach: x.coach?.name || '',
      coachPhoto: x.coach?.photo || '',
      startXI: (x.startXI || []).map(normalizeLineupPlayer).filter(Boolean),
      substitutes: (x.substitutes || []).map(normalizeLineupPlayer).filter(Boolean),
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
    SUSP: 'Приостановлен', PST: 'Перенесён', CANC: 'Отменён', ABD: 'Прерван', AWD: 'Тех. результат', WO: 'Без игры',
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


const COMPETITIONS = new Map([
  [1,   { name: 'Чемпионат мира', short: 'ЧМ', group: 'international', category: 'national', tier: 'elite', priority: 100 }],
  [2,   { name: 'Лига чемпионов УЕФА', short: 'ЛЧ', group: 'international', category: 'continental', tier: 'elite', priority: 100 }],
  [3,   { name: 'Лига Европы УЕФА', short: 'ЛЕ', group: 'international', category: 'continental', tier: 'elite', priority: 94 }],
  [4,   { name: 'Евро', short: 'Евро', group: 'international', category: 'national', tier: 'elite', priority: 98 }],
  [9,   { name: 'Копа Америка', short: 'Копа Америка', group: 'international', category: 'national', tier: 'elite', priority: 96 }],
  [15,  { name: 'Клубный чемпионат мира', short: 'КЧМ', group: 'international', category: 'continental', tier: 'elite', priority: 92 }],
  [39,  { name: 'Премьер-лига', short: 'АПЛ', group: 'england', category: 'league', tier: 'elite', priority: 100 }],
  [40,  { name: 'Чемпионшип', short: 'Чемпионшип', group: 'england', category: 'league', tier: 'major', priority: 72 }],
  [45,  { name: 'Кубок Англии', short: 'FA Cup', group: 'england', category: 'cup', tier: 'major', priority: 84 }],
  [48,  { name: 'Кубок английской лиги', short: 'EFL Cup', group: 'england', category: 'cup', tier: 'major', priority: 76 }],
  [61,  { name: 'Лига 1', short: 'Лига 1', group: 'france', category: 'league', tier: 'elite', priority: 92 }],
  [62,  { name: 'Лига 2', short: 'Лига 2', group: 'france', category: 'league', tier: 'major', priority: 60 }],
  [66,  { name: 'Кубок Франции', short: 'Кубок Франции', group: 'france', category: 'cup', tier: 'major', priority: 70 }],
  [71,  { name: 'Серия A Бразилии', short: 'Бразилия A', group: 'brazil', category: 'league', tier: 'major', priority: 78 }],
  [78,  { name: 'Бундеслига', short: 'Бундеслига', group: 'germany', category: 'league', tier: 'elite', priority: 94 }],
  [79,  { name: '2. Бундеслига', short: '2. Бундеслига', group: 'germany', category: 'league', tier: 'major', priority: 62 }],
  [81,  { name: 'Кубок Германии', short: 'DFB-Pokal', group: 'germany', category: 'cup', tier: 'major', priority: 74 }],
  [88,  { name: 'Эредивизи', short: 'Эредивизи', group: 'netherlands', category: 'league', tier: 'major', priority: 78 }],
  [94,  { name: 'Примейра-лига', short: 'Португалия', group: 'portugal', category: 'league', tier: 'major', priority: 78 }],
  [128, { name: 'Профессиональная лига Аргентины', short: 'Аргентина', group: 'argentina', category: 'league', tier: 'major', priority: 76 }],
  [135, { name: 'Серия A', short: 'Серия A', group: 'italy', category: 'league', tier: 'elite', priority: 94 }],
  [136, { name: 'Серия B', short: 'Серия B', group: 'italy', category: 'league', tier: 'major', priority: 62 }],
  [137, { name: 'Кубок Италии', short: 'Кубок Италии', group: 'italy', category: 'cup', tier: 'major', priority: 74 }],
  [140, { name: 'Ла Лига', short: 'Ла Лига', group: 'spain', category: 'league', tier: 'elite', priority: 96 }],
  [141, { name: 'Сегунда', short: 'Сегунда', group: 'spain', category: 'league', tier: 'major', priority: 62 }],
  [143, { name: 'Кубок Испании', short: 'Кубок Испании', group: 'spain', category: 'cup', tier: 'major', priority: 76 }],
  [203, { name: 'Суперлига Турции', short: 'Турция', group: 'turkey', category: 'league', tier: 'major', priority: 68 }],
  [253, { name: 'MLS', short: 'MLS', group: 'usa', category: 'league', tier: 'major', priority: 72 }],
  [307, { name: 'Саудовская Про-лига', short: 'Saudi Pro League', group: 'saudi', category: 'league', tier: 'major', priority: 70 }],
  [848, { name: 'Лига конференций УЕФА', short: 'ЛК', group: 'international', category: 'continental', tier: 'elite', priority: 88 }],
]);

const BIG_TEAM_RE = /arsenal|liverpool|chelsea|manchester (city|united)|tottenham|newcastle|real madrid|barcelona|atletico madrid|bayern|dortmund|paris saint|psg|inter|milan|juventus|napoli|roma|benfica|porto|sporting|ajax|psv|feyenoord|inter miami|flamengo|palmeiras|river plate|boca juniors/i;
const YOUTH_RESERVE_RE = /\bu-?1[789]\b|\bu-?2[013]\b|under ?(17|18|19|20|21|23)|youth|reserve|reserves|development|primavera|juniors?|academy/i;
const WOMEN_RE = /women|femen|femin|wsl|liga f|frauen|d1 f|feminine/i;
const FRIENDLY_RE = /friendly|friendlies|club friendly|товарищ/i;
const CUP_RE = /cup|copa|coppa|pokal|taça|taca|coupe|кубок/i;
const LOWER_RE = /division 3|division 4|third|fourth|regional|amateur|non league|national league north|national league south/i;

const COUNTRY_RU = new Map(Object.entries({
  England:'Англия', Spain:'Испания', Italy:'Италия', Germany:'Германия', France:'Франция',
  Portugal:'Португалия', Netherlands:'Нидерланды', Belgium:'Бельгия', Turkey:'Турция', Scotland:'Шотландия',
  Brazil:'Бразилия', Argentina:'Аргентина', USA:'США', Mexico:'Мексика', Colombia:'Колумбия',
  Ecuador:'Эквадор', Uruguay:'Уругвай', Chile:'Чили', Paraguay:'Парагвай', Peru:'Перу',
  'Saudi-Arabia':'Саудовская Аравия', 'Saudi Arabia':'Саудовская Аравия', Japan:'Япония', Korea:'Южная Корея',
  Australia:'Австралия', Russia:'Россия', Ukraine:'Украина', Poland:'Польша', Greece:'Греция',
  Austria:'Австрия', Switzerland:'Швейцария', Denmark:'Дания', Sweden:'Швеция', Norway:'Норвегия',
  'Czech-Republic':'Чехия', 'Czech Republic':'Чехия', Romania:'Румыния', Croatia:'Хорватия', Serbia:'Сербия',
  World:'Мир', Europe:'Европа', Africa:'Африка', Asia:'Азия',
}));

function normalizeCountryName(country = '') {
  const raw = String(country || '').trim();
  return COUNTRY_RU.get(raw) || raw || 'Мир';
}

function isYouthReserveMatch(leagueName = '', homeName = '', awayName = '') {
  return YOUTH_RESERVE_RE.test(`${leagueName || ''} ${homeName || ''} ${awayName || ''}`);
}

function detectCompetitionCategory(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  const hay = `${leagueName} ${country} ${homeName} ${awayName}`;
  if (isYouthReserveMatch(leagueName, homeName, awayName)) return 'youth';
  if (WOMEN_RE.test(hay)) return 'women';
  if (FRIENDLY_RE.test(leagueName)) return 'friendly';
  if (known?.category) return known.category;
  if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/i.test(leagueName)) return 'international';
  if (CUP_RE.test(leagueName)) return 'cup';
  if (LOWER_RE.test(leagueName)) return 'lower';
  return 'league';
}

function leagueGroup(leagueId, leagueName = '', country = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known?.group) return known.group;
  const n = String(leagueName).toLowerCase();
  const c = String(country).toLowerCase();
  if (/champions|europa|conference|world cup|euro|copa america|nations league|club world/.test(n)) return 'international';
  if (c === 'england') return 'england';
  if (c === 'spain') return 'spain';
  if (c === 'italy') return 'italy';
  if (c === 'germany') return 'germany';
  if (c === 'france') return 'france';
  if (c === 'portugal') return 'portugal';
  if (c === 'netherlands') return 'netherlands';
  if (c === 'brazil') return 'brazil';
  if (c === 'argentina') return 'argentina';
  return 'other';
}

function normalizeCompetition(leagueId, leagueName = '', country = '', homeName = '', awayName = '') {
  const id = Number(leagueId || 0);
  const known = COMPETITIONS.get(id);
  const category = detectCompetitionCategory(id, leagueName, country, homeName, awayName);
  const youth = category === 'youth';
  const friendly = category === 'friendly';
  const lower = category === 'lower';
  let tier = known?.tier || 'standard';
  let priority = Number(known?.priority || 45);
  const lname = String(leagueName || '').toLowerCase();
  if (!known && category === 'cup') priority = 52;
  if (!known && category === 'international') priority = 74;
  if (!known && /libertadores/.test(lname)) { tier = 'elite'; priority = 90; }
  if (!known && /sudamericana/.test(lname)) { tier = 'major'; priority = 82; }
  if (!known && /nations league/.test(lname)) { tier = 'major'; priority = 84; }
  if (!known && /afc champions|caf champions|concacaf champions/.test(lname)) { tier = 'major'; priority = 80; }
  if (category === 'women') { tier = 'standard'; priority = Math.max(priority, 50); }
  if (lower) { tier = 'basic'; priority = Math.min(priority, 28); }
  if (friendly) { tier = 'basic'; priority = Math.min(priority, 24); }
  if (youth) { tier = 'basic'; priority = 8; }
  const group = known?.group || leagueGroup(id, leagueName, country);
  return {
    id,
    originalName: String(leagueName || ''),
    name: known?.name || String(leagueName || 'Турнир'),
    shortName: known?.short || known?.name || String(leagueName || 'Турнир'),
    country: normalizeCountryName(country),
    countryRaw: String(country || ''),
    group,
    category,
    tier,
    priority,
    youth,
    friendly,
    lower,
    featured: priority >= 80 && !youth && !friendly && !lower,
  };
}

function isTopLeague(leagueId, leagueName = '') {
  const known = COMPETITIONS.get(Number(leagueId));
  if (known) return known.priority >= 80;
  if (YOUTH_RESERVE_RE.test(String(leagueName || ''))) return false;
  return /premier league|la liga|serie a|bundesliga|ligue 1|champions league|europa league|conference league|world cup|copa america|major league soccer|primeira liga/i.test(String(leagueName));
}

function normalizeRoundLabel(round = '') {
  const raw = String(round || '').trim();
  if (!raw) return '';
  let m = raw.match(/Regular Season\s*-\s*(\d+)/i);
  if (m) return `Тур ${m[1]}`;
  m = raw.match(/Round\s*(\d+)/i);
  if (m) return `Раунд ${m[1]}`;
  m = raw.match(/Group Stage\s*-?\s*(.*)/i);
  if (m) return m[1] ? `Групповой этап · ${m[1]}` : 'Групповой этап';
  if (/Round of 32/i.test(raw)) return '1/16 финала';
  if (/Round of 16/i.test(raw)) return '1/8 финала';
  if (/Quarter/i.test(raw)) return '1/4 финала';
  if (/Semi/i.test(raw)) return '1/2 финала';
  if (/Final/i.test(raw) && !/Semi|Quarter/i.test(raw)) return 'Финал';
  if (/Play-?offs?/i.test(raw)) return raw.replace(/Play-?offs?/i, 'Плей-офф');
  return raw;
}

function matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date }) {
  const comp = competition || normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
  let score = Math.max(8, Math.min(72, Number(comp.priority || 45)));
  if (BIG_TEAM_RE.test(homeName || '')) score += 12;
  if (BIG_TEAM_RE.test(awayName || '')) score += 12;
  if (isLiveStatus(status)) score += 8;
  if (date) {
    const mins = Math.abs((Date.parse(date) - Date.now()) / 60000);
    if (mins <= 180) score += 5;
  }
  if (comp.youth) score -= 28;
  if (comp.friendly) score -= 18;
  if (comp.lower) score -= 14;
  return Math.max(5, Math.min(99, Math.round(score)));
}

function catalogRank(match) {
  const cat = match?.competition?.category || match?.category || '';
  if (match?.live) return 0;
  if (match?.competition?.featured || match?.featured) return 1;
  if (cat === 'continental' || cat === 'national' || cat === 'international') return 2;
  if (cat === 'league' || cat === 'cup') return 3;
  if (cat === 'women') return 4;
  if (cat === 'friendly') return 6;
  if (cat === 'youth' || cat === 'lower') return 7;
  return 5;
}

function matchStatusRank(status) {
  if (isLiveStatus(status)) return 0;
  if (['NS','TBD'].includes(status)) return 1;
  if (isFinishedStatus(status)) return 2;
  return 3;
}


const KNOWN_FIXTURE_STATUSES = new Set(['TBD','NS','1H','HT','2H','ET','BT','P','SUSP','INT','FT','AET','PEN','PST','CANC','ABD','AWD','WO','LIVE']);
const INTEGRITY_SEVERITY_WEIGHT = Object.freeze({ info: 4, warning: 13, error: 38 });

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fixtureScorePair(fixture) {
  const home = finiteNonNegative(fixture?.goals?.home);
  const away = finiteNonNegative(fixture?.goals?.away);
  return { home, away };
}

function previousMatchMap(payload) {
  const map = new Map();
  for (const row of payload?.matches || []) {
    const id = Number(row?.fixtureId || 0);
    if (id > 0) map.set(id, row);
  }
  return map;
}

function validateFixtureIntegrity(fixture, requestedDate = '', previous = null) {
  const issues = [];
  const add = (severity, code, message, meta = {}) => issues.push({ severity, code, message, meta });
  const fixtureId = Number(fixture?.fixture?.id || 0);
  const date = String(fixture?.fixture?.date || '');
  const kickoffMs = Date.parse(date);
  const status = String(fixture?.fixture?.status?.short || '').toUpperCase();
  const elapsedRaw = fixture?.fixture?.status?.elapsed;
  const elapsed = elapsedRaw === null || elapsedRaw === undefined ? null : Number(elapsedRaw);
  const leagueId = Number(fixture?.league?.id || 0);
  const leagueName = String(fixture?.league?.name || '').trim();
  const homeId = Number(fixture?.teams?.home?.id || 0);
  const awayId = Number(fixture?.teams?.away?.id || 0);
  const homeName = String(fixture?.teams?.home?.name || '').trim();
  const awayName = String(fixture?.teams?.away?.name || '').trim();
  const score = fixtureScorePair(fixture);

  if (!Number.isFinite(fixtureId) || fixtureId <= 0) add('error', 'FIXTURE_ID_MISSING', 'Матч не имеет корректного fixture id.');
  if (!Number.isFinite(kickoffMs)) add('error', 'KICKOFF_INVALID', 'Некорректное время начала матча.', { date });
  if (!homeName || !awayName) add('error', 'TEAM_NAME_MISSING', 'У одной из команд отсутствует название.');
  if (homeId <= 0 || awayId <= 0) add('error', 'TEAM_ID_MISSING', 'У одной из команд отсутствует корректный team id.');
  if ((homeId > 0 && homeId === awayId) || (homeName && awayName && homeName.toLowerCase() === awayName.toLowerCase())) add('error', 'SAME_TEAM', 'Хозяева и гости определены как одна команда.');
  if (!leagueId || !leagueName) add('warning', 'LEAGUE_INCOMPLETE', 'Неполные данные турнира.', { leagueId, leagueName });
  if (!status || !KNOWN_FIXTURE_STATUSES.has(status)) add('warning', 'STATUS_UNKNOWN', 'Неизвестный статус матча.', { status });

  const rawScores = [fixture?.goals?.home, fixture?.goals?.away, fixture?.score?.halftime?.home, fixture?.score?.halftime?.away, fixture?.score?.fulltime?.home, fixture?.score?.fulltime?.away];
  if (rawScores.some(v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) < 0)) add('error', 'SCORE_NEGATIVE', 'Обнаружено отрицательное значение счёта.');

  if (isLiveStatus(status)) {
    if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'LIVE_BEFORE_KICKOFF', 'LIVE-статус получен задолго до времени начала.', { minutesAhead: Math.round((kickoffMs - Date.now()) / 60000) });
    if (elapsed !== null && (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 150)) add('warning', 'ELAPSED_INVALID', 'Подозрительное значение игровой минуты.', { elapsed });
    if (score.home === null || score.away === null) add('warning', 'LIVE_SCORE_MISSING', 'LIVE-матч пришёл без полного текущего счёта.');
  }

  if (isFinishedStatus(status)) {
    if (Number.isFinite(kickoffMs) && kickoffMs > Date.now() + 20 * 60000) add('error', 'FINISHED_BEFORE_KICKOFF', 'Завершённый статус получен до времени начала.');
    if (score.home === null || score.away === null) add('warning', 'FINAL_SCORE_MISSING', 'Завершённый матч пришёл без итогового счёта.');
    if (status === 'FT') {
      const ftHome = finiteNonNegative(fixture?.score?.fulltime?.home);
      const ftAway = finiteNonNegative(fixture?.score?.fulltime?.away);
      if (ftHome !== null && ftAway !== null && score.home !== null && score.away !== null && (ftHome !== score.home || ftAway !== score.away)) {
        add('warning', 'FINAL_SCORE_CONFLICT', 'Текущий и fulltime счёт не совпадают.', { goals: `${score.home}:${score.away}`, fulltime: `${ftHome}:${ftAway}` });
      }
    }
  }

  if (['NS','TBD'].includes(status) && Number.isFinite(kickoffMs) && Date.now() - kickoffMs > 6 * 3600000) {
    add('warning', 'STALE_PREMATCH_STATUS', 'Матч давно должен был начаться, но статус всё ещё предматчевый.', { hoursLate: Math.round((Date.now() - kickoffMs) / 3600000) });
  }
  if (['NS','TBD'].includes(status) && ((score.home || 0) > 0 || (score.away || 0) > 0)) add('warning', 'PREMATCH_WITH_SCORE', 'Предматчевый статус содержит ненулевой счёт.');

  if (!fixture?.teams?.home?.logo || !fixture?.teams?.away?.logo) add('info', 'TEAM_LOGO_MISSING', 'У одной из команд отсутствует логотип.');
  if (!fixture?.league?.logo) add('info', 'LEAGUE_LOGO_MISSING', 'У турнира отсутствует логотип.');

  if (Number.isFinite(kickoffMs) && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    const requestedNoon = Date.parse(`${requestedDate}T12:00:00Z`);
    if (Number.isFinite(requestedNoon) && Math.abs(kickoffMs - requestedNoon) > 38 * 3600000) add('warning', 'DATE_WINDOW_MISMATCH', 'Время матча сильно выходит за запрошенную дату.', { requestedDate, fixtureDate: date });
  }

  if (previous) {
    const prevStatus = String(previous.status || '').toUpperCase();
    const prevElapsed = Number(previous.elapsed);
    const prevHome = finiteNonNegative(previous?.score?.home);
    const prevAway = finiteNonNegative(previous?.score?.away);
    if ((isLiveStatus(prevStatus) || isFinishedStatus(prevStatus)) && ['NS','TBD'].includes(status)) add('warning', 'STATUS_REGRESSION', 'Статус матча откатился к предматчевому.', { previousStatus: prevStatus, currentStatus: status });
    if (isFinishedStatus(prevStatus) && !isFinishedStatus(status)) add('warning', 'FINISHED_STATUS_REGRESSION', 'Ранее завершённый матч вернулся в незавершённый статус.', { previousStatus: prevStatus, currentStatus: status });
    if (isLiveStatus(prevStatus) && isLiveStatus(status) && Number.isFinite(prevElapsed) && Number.isFinite(elapsed) && elapsed + 3 < prevElapsed) add('warning', 'ELAPSED_REGRESSION', 'Игровая минута уменьшилась относительно предыдущего снимка.', { previousElapsed: prevElapsed, currentElapsed: elapsed });
    if (prevHome !== null && prevAway !== null && score.home !== null && score.away !== null && (score.home < prevHome || score.away < prevAway)) add('warning', 'SCORE_REGRESSION', 'Счёт уменьшился относительно предыдущего снимка; возможна VAR-коррекция или конфликт данных.', { previous: `${prevHome}:${prevAway}`, current: `${score.home}:${score.away}` });
  }

  const quarantine = issues.some(x => x.severity === 'error');
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const errors = issues.filter(x => x.severity === 'error').length;
  const infos = issues.filter(x => x.severity === 'info').length;
  const qualityScore = Math.max(0, Math.min(100, 100 - warnings * INTEGRITY_SEVERITY_WEIGHT.warning - errors * INTEGRITY_SEVERITY_WEIGHT.error - infos * INTEGRITY_SEVERITY_WEIGHT.info));
  const state = quarantine ? 'error' : warnings ? 'warning' : infos ? 'incomplete' : 'clean';
  return { fixtureId, state, qualityScore, quarantine, warnings, errors, infos, issues };
}

function integritySignature(fixture) {
  const leagueId = Number(fixture?.league?.id || 0);
  const homeId = Number(fixture?.teams?.home?.id || 0);
  const awayId = Number(fixture?.teams?.away?.id || 0);
  const ms = Date.parse(fixture?.fixture?.date || '');
  const minute = Number.isFinite(ms) ? Math.floor(ms / 60000) : 0;
  return `${leagueId}:${homeId}:${awayId}:${minute}`;
}

function runMatchIntegrityGuard(fixtures, requestedDate, previousPayload = null) {
  const previous = previousMatchMap(previousPayload);
  const accepted = [];
  const issues = [];
  const seenIds = new Set();
  const seenSignatures = new Map();
  let quarantined = 0, duplicates = 0, warningMatches = 0, incompleteMatches = 0, cleanMatches = 0, repaired = 0;

  for (const fixture of fixtures || []) {
    const fixtureId = Number(fixture?.fixture?.id || 0);
    let result = validateFixtureIntegrity(fixture, requestedDate, previous.get(fixtureId));
    if (fixtureId > 0 && seenIds.has(fixtureId)) {
      duplicates++;
      result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_FIXTURE_ID', message: 'Повтор fixture id в одном ответе API.', meta: { fixtureId } }] };
    }
    const signature = integritySignature(fixture);
    if (!result.quarantine && signature && seenSignatures.has(signature)) {
      duplicates++;
      const firstId = seenSignatures.get(signature);
      result = { ...result, state: 'error', quarantine: true, errors: result.errors + 1, qualityScore: 0, issues: [...result.issues, { severity: 'error', code: 'DUPLICATE_MATCH_SIGNATURE', message: 'Найден дубликат того же матча с другим fixture id.', meta: { firstFixtureId: firstId, duplicateFixtureId: fixtureId } }] };
    }
    if (fixtureId > 0) seenIds.add(fixtureId);
    if (!result.quarantine && signature) seenSignatures.set(signature, fixtureId);

    for (const issue of result.issues) {
      if (issue.severity === 'info') continue;
      issues.push({ fixtureId: fixtureId || null, ...issue, home: fixture?.teams?.home?.name || '', away: fixture?.teams?.away?.name || '', league: fixture?.league?.name || '' });
    }

    if (result.quarantine) {
      quarantined++;
      continue;
    }
    if (result.state === 'warning') warningMatches++;
    else if (result.state === 'incomplete') incompleteMatches++;
    else cleanMatches++;
    accepted.push({ fixture, integrity: { state: result.state, score: result.qualityScore, warnings: result.warnings, infos: result.infos, issues: result.issues.filter(x => x.severity !== 'info').slice(0, 3).map(x => ({ severity: x.severity, code: x.code, message: x.message })) } });
  }

  const inspected = (fixtures || []).length;
  const errors = issues.filter(x => x.severity === 'error').length;
  const warnings = issues.filter(x => x.severity === 'warning').length;
  const qualityScore = inspected ? Math.round((accepted.reduce((sum, x) => sum + Number(x.integrity?.score || 0), 0) / inspected) * 10) / 10 : 100;
  const quarantinePct = inspected ? quarantined / inspected * 100 : 0;
  const health = quarantinePct >= 10 || errors >= 5 ? 'critical' : (quarantined || warnings ? 'warning' : 'ok');
  return {
    accepted,
    report: { requestedDate, inspected, accepted: accepted.length, clean: cleanMatches, incomplete: incompleteMatches, warningMatches, quarantined, duplicates, repaired, warnings, errors, qualityScore, health },
    issues,
  };
}

async function persistIntegrityRun(cfg, report, issues) {
  const runId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const run = { runId, observedAt, ...report };
  memory.integrity.lastRun = run;
  memory.integrity.recentIssues = (issues || []).slice(0, 30).map(x => ({ observed_at: observedAt, run_id: runId, ...x }));
  bumpTelemetry('integrityRuns');
  bumpTelemetry('integrityWarnings', Number(report?.warnings || 0));
  bumpTelemetry('integrityErrors', Number(report?.errors || 0));
  bumpTelemetry('integrityQuarantined', Number(report?.quarantined || 0));
  bumpTelemetry('integrityDuplicates', Number(report?.duplicates || 0));
  if (!hasSupabase(cfg)) return run;
  try {
    await supaUpsert(cfg, 'match_integrity_runs', {
      run_id: runId,
      observed_at: observedAt,
      fixture_date: report?.requestedDate || null,
      inspected: Number(report?.inspected || 0), accepted: Number(report?.accepted || 0), clean: Number(report?.clean || 0), incomplete: Number(report?.incomplete || 0),
      warning_matches: Number(report?.warningMatches || 0), quarantined: Number(report?.quarantined || 0), duplicates: Number(report?.duplicates || 0), repaired: Number(report?.repaired || 0),
      warning_count: Number(report?.warnings || 0), error_count: Number(report?.errors || 0), quality_score: Number(report?.qualityScore || 0), health: report?.health || 'ok', metadata: {},
    }, 'run_id');
    const rows = (issues || []).slice(0, 60).map(issue => ({
      run_id: runId, observed_at: observedAt, fixture_date: report?.requestedDate || null, fixture_id: issue.fixtureId ? Number(issue.fixtureId) : null,
      severity: issue.severity || 'warning', issue_code: issue.code || 'DATA_QUALITY', message: String(issue.message || '').slice(0, 400),
      home_name: String(issue.home || '').slice(0, 120), away_name: String(issue.away || '').slice(0, 120), league_name: String(issue.league || '').slice(0, 160), metadata: safeOpsMetadata(issue.meta || {}),
    }));
    if (rows.length) await supaUpsert(cfg, 'match_integrity_events', rows);
  } catch (error) {
    bumpTelemetry('supabaseErrors');
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'persistence', code: 'INTEGRITY_DB_WRITE', message: error?.message || error, meta: { inspected: report?.inspected, quarantined: report?.quarantined } }).catch(() => {});
  }
  return run;
}

async function readIntegrityDiagnostics(cfg, limit = 12) {
  const fallback = () => ({ persistent: false, migrationReady: false, lastRun: memory.integrity.lastRun, recentIssues: memory.integrity.recentIssues.slice(0, limit) });
  if (!hasSupabase(cfg)) return { ...fallback(), migrationReady: true };
  try {
    const runs = await supaSelectMany(cfg, 'match_integrity_runs', {}, { limit: 1, order: 'observed_at.desc' });
    const events = await supaSelectMany(cfg, 'match_integrity_events', {}, { limit: Math.max(1, Math.min(30, limit)), order: 'observed_at.desc' });
    const row = runs?.[0] || null;
    const lastRun = row ? {
      runId: row.run_id, observedAt: row.observed_at, requestedDate: row.fixture_date, inspected: Number(row.inspected || 0), accepted: Number(row.accepted || 0), clean: Number(row.clean || 0), incomplete: Number(row.incomplete || 0),
      warningMatches: Number(row.warning_matches || 0), quarantined: Number(row.quarantined || 0), duplicates: Number(row.duplicates || 0), repaired: Number(row.repaired || 0), warnings: Number(row.warning_count || 0), errors: Number(row.error_count || 0), qualityScore: Number(row.quality_score || 0), health: row.health || 'ok',
    } : null;
    return { persistent: true, migrationReady: true, lastRun, recentIssues: events || [] };
  } catch {
    return fallback();
  }
}

async function apiDataIntegrity(request, cfg) {
  const data = await readIntegrityDiagnostics(cfg, 24);
  return json({ available: true, version: APP_VERSION, generatedAt: new Date().toISOString(), ...data });
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
    billing: {
      plan: quota.plan,
      subscriptionUntil: record?.subscription_until || null,
      canceled: Boolean(record?.subscription_canceled),
      paymentChargeIdPresent: Boolean(record?.telegram_payment_charge_id),
    },
    features: {
      monetizationEnabled: cfg.monetizationEnabled,
      isAdmin: isAdminUser(user, cfg),
      role: isAdminUser(user, cfg) ? 'admin' : 'user',
      dataCapabilities: publicDataCapabilities(),
    },
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


const SEARCH_COMPETITION_ALIASES = new Map([
  [1, 'world cup чемпионат мира чм fifa'],
  [2, 'champions league ucl лига чемпионов лч'],
  [3, 'europa league uel лига европы ле'],
  [4, 'euro european championship евро'],
  [9, 'copa america копа америка'],
  [15, 'club world cup клубный чемпионат мира кчм'],
  [39, 'premier league epl english premier league апл премьер лига англия'],
  [40, 'championship efl championship чемпионшип англия'],
  [45, 'fa cup кубок англии'],
  [48, 'efl cup carabao cup league cup кубок лиги англия'],
  [61, 'ligue 1 лига 1 франция'],
  [62, 'ligue 2 лига 2 франция'],
  [66, 'coupe de france кубок франции'],
  [71, 'brasileirao serie a brazil бразилия серия а'],
  [78, 'bundesliga бундеслига германия'],
  [79, '2 bundesliga вторая бундеслига германия'],
  [81, 'dfb pokal кубок германии'],
  [88, 'eredivisie эредивизи нидерланды'],
  [94, 'primeira liga португалия примейра лига'],
  [128, 'argentina liga profesional аргентина'],
  [135, 'serie a italy серия а италия'],
  [136, 'serie b italy серия b италия'],
  [137, 'coppa italia кубок италии'],
  [140, 'la liga laliga примера испания ла лига'],
  [141, 'segunda division сегунда испания'],
  [143, 'copa del rey кубок испании'],
  [203, 'super lig turkey суперлига турция'],
  [253, 'mls major league soccer сша'],
  [307, 'saudi pro league саудовская про лига'],
  [848, 'conference league uecl лига конференций лк'],
]);

function searchText(value = '') {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function competitionCountryByGroup(group = '') {
  const map = {
    england: 'Англия', spain: 'Испания', italy: 'Италия', germany: 'Германия', france: 'Франция',
    portugal: 'Португалия', netherlands: 'Нидерланды', brazil: 'Бразилия', argentina: 'Аргентина',
    turkey: 'Турция', usa: 'США', saudi: 'Саудовская Аравия', international: 'Международные',
  };
  return map[String(group || '')] || 'Мир';
}

function searchKnownCompetitions(query = '') {
  const q = searchText(query);
  const season = new Date().getUTCFullYear();
  const rows = [];
  for (const [id, item] of COMPETITIONS.entries()) {
    const aliases = SEARCH_COMPETITION_ALIASES.get(Number(id)) || '';
    const hay = searchText(`${item.name || ''} ${item.short || ''} ${aliases} ${competitionCountryByGroup(item.group)}`);
    if (q && !hay.includes(q)) continue;
    let score = Number(item.priority || 0);
    if (q) {
      const name = searchText(item.name || '');
      const short = searchText(item.short || '');
      if (name === q || short === q) score += 120;
      else if (name.startsWith(q) || short.startsWith(q)) score += 70;
      else if (hay.includes(q)) score += 30;
    }
    rows.push({
      leagueId: Number(id), season,
      name: item.name || `Турнир ${id}`,
      shortName: item.short || item.name || `Турнир ${id}`,
      country: competitionCountryByGroup(item.group),
      category: item.category || 'league', tier: item.tier || 'standard', group: item.group || 'other',
      priority: Number(item.priority || 0), score,
    });
  }
  return rows.sort((a,b) => b.score - a.score || b.priority - a.priority).slice(0, q ? 8 : 10);
}

function normalizeSearchTeam(row = {}, query = '') {
  const team = row?.team || row || {};
  const name = String(team.name || '');
  const q = searchText(query);
  const n = searchText(name);
  let score = 0;
  if (q && n === q) score += 140;
  else if (q && n.startsWith(q)) score += 90;
  else if (q && n.includes(q)) score += 50;
  if (BIG_TEAM_RE.test(name)) score += 25;
  const youthReserve = YOUTH_RESERVE_RE.test(name);
  if (youthReserve) score -= 45;
  if (team.national) score += 10;
  return {
    id: Number(team.id || 0), name,
    code: String(team.code || ''), country: normalizeCountryName(team.country || ''), countryRaw: String(team.country || ''),
    logo: String(team.logo || ''), national: Boolean(team.national), founded: Number(team.founded || 0) || null,
    youthReserve, venue: row?.venue ? { name: row.venue.name || '', city: row.venue.city || '' } : null,
    score,
  };
}

async function apiSearch(request, cfg) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const q = searchText(query);
  const competitions = searchKnownCompetitions(query);
  if (!q) return json({ query: '', teams: [], competitions, provider: publicDataCapabilities(), hint: 'Введите название команды или турнира.' });
  if (q.length < 3) return json({ query, teams: [], competitions, provider: publicDataCapabilities(), hint: 'Для поиска команды введите минимум 3 символа.' });

  const cacheKey = `search:teams:${encodeURIComponent(q)}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached?.teams) return json({ ...cached, competitions, cached: true, provider: publicDataCapabilities() });

  let rows = [];
  let warning = '';
  try {
    if (!freeQuotaHealthy(8, 2)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Поиск показан из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
      return json({ query, teams: [], competitions, cached: false, warning: 'Поиск команд временно не запущен: бережём остаток бесплатной квоты API.', provider: publicDataCapabilities() });
    }
    rows = await apiFootball('/teams', { search: query }, cfg);
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Не удалось обновить поиск — показаны сохранённые результаты.', provider: publicDataCapabilities() });
    if (isFootballRateLimitError(error)) warning = 'API-Football временно ограничил поиск команд. Повторите чуть позже.';
    else throw error;
  }

  const seen = new Set();
  const teams = rows.map(x => normalizeSearchTeam(x, query))
    .filter(x => x.id > 0 && x.name && !seen.has(x.id) && seen.add(x.id))
    .sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 16);
  const payload = { query, teams, warning, refreshedAt: new Date().toISOString() };
  await setCache(cacheKey, 0, payload, cfg, 720);
  return json({ ...payload, competitions, cached: false, provider: publicDataCapabilities() });
}

async function apiMatches(request, cfg) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
  const isToday = date === todayUtc();
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const isYesterday = date === yesterday.toISOString().slice(0, 10);
  const cacheKey = `matches:${date}:v6-integrity`;

  const cached = await getCache(cacheKey, cfg);
  if (cached?.matches) return json({ ...cached, cached: true, stale: false });
  const previousPayload = await getStaleCache(cacheKey, cfg).catch(() => null);

  let fixtures;
  try {
    fixtures = await apiFootball('/fixtures', { date }, cfg);
  } catch (error) {
    const stale = previousPayload || await getStaleCache(cacheKey, cfg);
    if (stale?.matches && isFootballRateLimitError(error)) {
      return json({
        ...stale, cached: true, stale: true,
        warning: 'Показаны последние сохранённые данные: API-Football временно ограничил частоту запросов.',
        retryAfter: Number(error?.retryAfter || 60),
      });
    }
    throw error;
  }

  const integrityRun = runMatchIntegrityGuard(fixtures, date, previousPayload);
  await persistIntegrityRun(cfg, integrityRun.report, integrityRun.issues).catch(() => null);
  const verifiedFixtures = integrityRun.accepted;

  // Reuse the verified fixtures request we already made to settle tracked predictions at zero additional provider cost.
  await settlePredictionsFromFixtures(verifiedFixtures.map(x => x.fixture), cfg).catch(() => null);

  const matches = verifiedFixtures
    .filter(entry => !['CANC', 'PST', 'ABD', 'AWD', 'WO'].includes(entry.fixture?.fixture?.status?.short || ''))
    .map(entry => {
      const f = entry.fixture;
      const integrity = entry.integrity;
      const status = f.fixture?.status?.short || '';
      const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
      const leagueId = Number(f.league?.id || 0);
      const leagueName = f.league?.name || '';
      const country = f.league?.country || '';
      const homeName = f.teams?.home?.name || '';
      const awayName = f.teams?.away?.name || '';
      const competition = normalizeCompetition(leagueId, leagueName, country, homeName, awayName);
      const top = competition.featured || isTopLeague(leagueId, leagueName);
      const live = isLiveStatus(status);
      const finished = isFinishedStatus(status);
      const round = f.league?.round || '';
      const roundLabel = normalizeRoundLabel(round);
      return {
        fixtureId: f.fixture?.id,
        date: f.fixture?.date,
        status,
        statusLong: f.fixture?.status?.long || '',
        statusLabel: statusLabel(status, elapsed),
        elapsed,
        finished,
        live,
        score: scoreSnapshot(f),
        leagueId,
        season: Number(f.league?.season || 0) || null,
        league: competition.name,
        leagueOriginal: leagueName,
        leagueShort: competition.shortName,
        round,
        roundLabel,
        country: competition.country,
        countryRaw: country,
        leagueLogo: f.league?.logo || '',
        isTop: top,
        featured: Boolean(competition.featured),
        group: competition.group,
        category: competition.category,
        competition,
        youthReserve: competition.youth,
        lowPriority: competition.youth || competition.friendly || competition.lower,
        coverageTier: competition.youth || competition.lower ? 'basic' : competition.tier === 'elite' ? 'enhanced' : 'standard',
        interestScore: matchInterestScore({ competition, leagueId, leagueName, country, homeName, awayName, status, date: f.fixture?.date }),
        integrity,
        home: { id: f.teams?.home?.id, name: homeName, logo: f.teams?.home?.logo || '' },
        away: { id: f.teams?.away?.id, name: awayName, logo: f.teams?.away?.logo || '' },
      };
    })
    .sort((a, b) =>
      matchStatusRank(a.status) - matchStatusRank(b.status) ||
      catalogRank(a) - catalogRank(b) ||
      Number(b.interestScore || 0) - Number(a.interestScore || 0) ||
      Number(b.competition?.priority || 0) - Number(a.competition?.priority || 0) ||
      String(a.date || '').localeCompare(String(b.date || ''))
    )
    .slice(0, 120);

  const catalog = {
    featured: matches.filter(x => x.featured).length,
    live: matches.filter(x => x.live).length,
    major: matches.filter(x => ['elite','major'].includes(x.competition?.tier)).length,
    cups: matches.filter(x => x.category === 'cup').length,
    international: matches.filter(x => ['continental','national','international'].includes(x.category)).length,
    hiddenLowPriority: matches.filter(x => x.lowPriority).length,
  };
  const payload = { date, matches, catalog, integrity: integrityRun.report, refreshedAt: new Date().toISOString(), provider: publicDataCapabilities() };
  const ttl = isToday ? 1 : isYesterday ? 720 : cfg.cacheMinutes;
  await setCache(cacheKey, 0, payload, cfg, ttl);
  return json({ ...payload, cached: false, stale: false });
}


function normalizeStandingRow(row = {}) {
  const all = row?.all || {};
  const goals = all?.goals || {};
  return {
    rank: Number(row?.rank || 0),
    team: {
      id: Number(row?.team?.id || 0),
      name: String(row?.team?.name || ''),
      logo: String(row?.team?.logo || ''),
    },
    points: Number(row?.points || 0),
    goalsDiff: Number(row?.goalsDiff || 0),
    played: Number(all?.played || 0),
    win: Number(all?.win || 0),
    draw: Number(all?.draw || 0),
    lose: Number(all?.lose || 0),
    goalsFor: Number(goals?.for || 0),
    goalsAgainst: Number(goals?.against || 0),
    form: String(row?.form || '').slice(-6),
    description: String(row?.description || ''),
  };
}

async function apiTournament(request, cfg) {
  const url = new URL(request.url);
  const leagueId = Number(url.searchParams.get('leagueId'));
  const season = Number(url.searchParams.get('season'));
  if (!Number.isFinite(leagueId) || leagueId <= 0) return json({ error: 'leagueId обязателен.' }, 400);
  if (!Number.isFinite(season) || season < 2000 || season > 2100) return json({ error: 'season обязателен.' }, 400);

  const cacheKey = `tournament:${leagueId}:${season}:standings:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });

  // Таблица — дополнительный запрос. На FREE не тратим последний запрос минутной квоты.
  const minuteRemaining = Number(memory.provider?.minuteRemaining);
  if (Number.isFinite(minuteRemaining) && minuteRemaining <= 1) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Таблица показана из сохранённого кэша: минутная квота API почти исчерпана.', provider: publicDataCapabilities() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: 'Таблица временно не запрашивается: бережём последний запрос минутной квоты API-Football.',
      provider: publicDataCapabilities(),
    });
  }

  try {
    const response = await apiFootball('/standings', { league: leagueId, season }, cfg);
    const league = response?.[0]?.league || {};
    const groups = Array.isArray(league?.standings) ? league.standings : [];
    const normalizedGroups = groups.map((rows, index) => ({
      name: groups.length > 1 ? `Группа ${index + 1}` : '',
      rows: (Array.isArray(rows) ? rows : []).map(normalizeStandingRow).filter(x => x.team.id),
    })).filter(g => g.rows.length);
    const standings = normalizedGroups.flatMap(g => g.rows);
    const payload = {
      leagueId,
      season,
      available: standings.length > 0,
      league: {
        id: Number(league?.id || leagueId),
        name: String(league?.name || ''),
        country: normalizeCountryName(league?.country || ''),
        logo: String(league?.logo || ''),
        flag: String(league?.flag || ''),
        season: Number(league?.season || season),
      },
      groups: normalizedGroups,
      standings,
      refreshedAt: new Date().toISOString(),
      reason: standings.length ? '' : 'Провайдер не вернул таблицу для этого турнира и сезона.',
    };
    await setCache(cacheKey, 0, payload, cfg, 360);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить таблицу — показана последняя сохранённая версия.', provider: publicDataCapabilities() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: `Таблица сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`,
      provider: publicDataCapabilities(),
    });
  }
}


function normalizeTeamHubMatch(f, teamId) {
  const homeId = Number(f.teams?.home?.id || 0);
  const awayId = Number(f.teams?.away?.id || 0);
  const isHome = homeId === Number(teamId);
  const opponent = isHome ? f.teams?.away : f.teams?.home;
  const status = String(f.fixture?.status?.short || '');
  const elapsed = Number(f.fixture?.status?.elapsed ?? 0) || null;
  const competition = normalizeCompetition(Number(f.league?.id || 0), f.league?.name || '', f.league?.country || '', f.teams?.home?.name || '', f.teams?.away?.name || '');
  const result = isFinishedStatus(status) ? teamResult(f, teamId) : null;
  return {
    fixtureId: Number(f.fixture?.id || 0), date: f.fixture?.date || '', status,
    statusLong: f.fixture?.status?.long || '', statusLabel: statusLabel(status, elapsed), elapsed,
    live: isLiveStatus(status), finished: isFinishedStatus(status), score: scoreSnapshot(f),
    venue: isHome ? 'home' : 'away', result: result?.result || '', goalsFor: result?.gf ?? null, goalsAgainst: result?.ga ?? null,
    opponent: { id: Number(opponent?.id || 0), name: String(opponent?.name || ''), logo: String(opponent?.logo || '') },
    home: { id: homeId, name: f.teams?.home?.name || '', logo: f.teams?.home?.logo || '' },
    away: { id: awayId, name: f.teams?.away?.name || '', logo: f.teams?.away?.logo || '' },
    leagueId: Number(f.league?.id || 0), season: Number(f.league?.season || 0) || null,
    league: competition.name, leagueShort: competition.shortName, leagueLogo: f.league?.logo || '', country: competition.country,
    round: f.league?.round || '', roundLabel: normalizeRoundLabel(f.league?.round || ''), competition,
  };
}

function choosePrimaryTeamCompetition(matches = []) {
  const byLeague = new Map();
  for (const m of matches) {
    const id = Number(m.leagueId || 0);
    if (!id || m.competition?.youth || m.competition?.friendly) continue;
    const cur = byLeague.get(id) || { count: 0, item: m, priority: Number(m.competition?.priority || 0) };
    cur.count += 1;
    if (Number(m.competition?.priority || 0) > cur.priority) { cur.priority = Number(m.competition?.priority || 0); cur.item = m; }
    byLeague.set(id, cur);
  }
  const best = [...byLeague.values()].sort((a,b) => (b.count*10+b.priority) - (a.count*10+a.priority))[0];
  if (!best?.item) return null;
  const m = best.item;
  return { leagueId:Number(m.leagueId), season:Number(m.season || new Date().getFullYear()), name:m.league||'Турнир', shortName:m.leagueShort||m.league||'Турнир', logo:m.leagueLogo||'', country:m.country||'', category:m.competition?.category||'', tier:m.competition?.tier||'standard', priority:Number(m.competition?.priority||0) };
}

async function cachedTeamStanding(teamId, competition, cfg) {
  if (!competition?.leagueId || !competition?.season) return null;
  const cached = await getCache(`tournament:${Number(competition.leagueId)}:${Number(competition.season)}:standings:v1`, cfg);
  const row = cached?.standings?.find?.(x => Number(x.team?.id) === Number(teamId));
  if (!row) return null;
  return { rank:Number(row.rank||0), points:Number(row.points||0), played:Number(row.played||0), win:Number(row.win||0), draw:Number(row.draw||0), lose:Number(row.lose||0), goalsFor:Number(row.goalsFor||0), goalsAgainst:Number(row.goalsAgainst||0), goalsDiff:Number(row.goalsDiff||0), form:String(row.form||'') };
}

async function apiTeam(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  if (!Number.isFinite(teamId) || teamId <= 0) return json({ error: 'teamId обязателен.' }, 400);
  const fromDate = new Date(); fromDate.setUTCDate(fromDate.getUTCDate() - 45);
  const toDate = new Date(); toDate.setUTCDate(toDate.getUTCDate() + 45);
  const from = fromDate.toISOString().slice(0,10), to = toDate.toISOString().slice(0,10);
  const cacheKey = `teamhub:${teamId}:${from}:${to}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, standing: await cachedTeamStanding(teamId, cached.primaryCompetition, cfg), cached:true, stale:false, provider:publicDataCapabilities() });
  let fixtures;
  try { fixtures = await apiFootball('/fixtures', { team:teamId, from, to }, cfg); }
  catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale && isFootballRateLimitError(error)) return json({ ...stale, standing:await cachedTeamStanding(teamId, stale.primaryCompetition, cfg), cached:true, stale:true, warning:'Страница команды показана из последнего кэша из-за лимита API.', provider:publicDataCapabilities() });
    throw error;
  }
  const usable = (fixtures||[]).filter(f => !['CANC','ABD','AWD','WO'].includes(String(f.fixture?.status?.short||'')));
  const normalized = usable.map(f => normalizeTeamHubMatch(f, teamId)).filter(x => x.fixtureId);
  const now = Date.now();
  const recent = normalized.filter(x => x.finished).sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0)).slice(0,8);
  const upcoming = normalized.filter(x => !x.finished && (x.live || Date.parse(x.date||0) >= now - 3*60*60*1000)).sort((a,b)=>(a.live===b.live ? Date.parse(a.date||0)-Date.parse(b.date||0) : a.live ? -1 : 1)).slice(0,8);
  let rawTeam = null;
  for (const f of usable) {
    if (Number(f.teams?.home?.id)===teamId) { rawTeam=f.teams.home; break; }
    if (Number(f.teams?.away?.id)===teamId) { rawTeam=f.teams.away; break; }
  }
  const team = { id:teamId, name:String(rawTeam?.name || url.searchParams.get('name') || `Команда ${teamId}`), logo:String(rawTeam?.logo || url.searchParams.get('logo') || '') };
  const completedRaw = usable.filter(f => isFinishedStatus(f.fixture?.status?.short));
  const form = summarizeFormRows(completedRaw, teamId, 'home')?.overall || null;
  const primaryCompetition = choosePrimaryTeamCompetition(normalized);
  const standing = await cachedTeamStanding(teamId, primaryCompetition, cfg);
  const payload = { team, primaryCompetition, standing, form, recent, upcoming, liveNow:upcoming.find(x=>x.live)||null, nextMatch:upcoming.find(x=>!x.live)||upcoming[0]||null, refreshedAt:new Date().toISOString() };
  await setCache(cacheKey, teamId, payload, cfg, 120);
  return json({ ...payload, cached:false, stale:false, provider:publicDataCapabilities() });
}


function teamStatsNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function teamStatsAvg(value) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function teamStatsRate(part, total) {
  const p = teamStatsNum(part), t = teamStatsNum(total);
  return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
}

function normalizeTeamSeasonStatistics(row, fallback = {}) {
  const fixtures = row?.fixtures || {};
  const played = fixtures.played || {};
  const wins = fixtures.wins || {};
  const draws = fixtures.draws || {};
  const loses = fixtures.loses || {};
  const goalsFor = row?.goals?.for || {};
  const goalsAgainst = row?.goals?.against || {};
  const totalPlayed = teamStatsNum(played.total);
  const points = teamStatsNum(wins.total) * 3 + teamStatsNum(draws.total);
  const homePlayed = teamStatsNum(played.home), awayPlayed = teamStatsNum(played.away);
  const homePoints = teamStatsNum(wins.home) * 3 + teamStatsNum(draws.home);
  const awayPoints = teamStatsNum(wins.away) * 3 + teamStatsNum(draws.away);
  const gf = teamStatsNum(goalsFor?.total?.total), ga = teamStatsNum(goalsAgainst?.total?.total);
  const clean = row?.clean_sheet || {}, failed = row?.failed_to_score || {};
  const biggest = row?.biggest || {};
  const penalties = row?.penalty || {};
  const lineups = Array.isArray(row?.lineups) ? row.lineups : [];
  const mostUsedLineup = [...lineups].sort((a,b) => teamStatsNum(b?.played) - teamStatsNum(a?.played))[0] || null;
  return {
    available: Boolean(row && (row.team?.id || fallback.teamId)),
    team: {
      id: Number(row?.team?.id || fallback.teamId || 0),
      name: String(row?.team?.name || fallback.teamName || ''),
      logo: String(row?.team?.logo || fallback.teamLogo || ''),
    },
    league: {
      id: Number(row?.league?.id || fallback.leagueId || 0),
      name: String(row?.league?.name || fallback.leagueName || ''),
      country: normalizeCountryName(row?.league?.country || fallback.country || ''),
      logo: String(row?.league?.logo || fallback.leagueLogo || ''),
      season: Number(row?.league?.season || fallback.season || 0),
    },
    form: String(row?.form || ''),
    fixtures: {
      played: { home: homePlayed, away: awayPlayed, total: totalPlayed },
      wins: { home: teamStatsNum(wins.home), away: teamStatsNum(wins.away), total: teamStatsNum(wins.total) },
      draws: { home: teamStatsNum(draws.home), away: teamStatsNum(draws.away), total: teamStatsNum(draws.total) },
      losses: { home: teamStatsNum(loses.home), away: teamStatsNum(loses.away), total: teamStatsNum(loses.total) },
    },
    goals: {
      for: { home: teamStatsNum(goalsFor?.total?.home), away: teamStatsNum(goalsFor?.total?.away), total: gf, average: teamStatsAvg(goalsFor?.average?.total) },
      against: { home: teamStatsNum(goalsAgainst?.total?.home), away: teamStatsNum(goalsAgainst?.total?.away), total: ga, average: teamStatsAvg(goalsAgainst?.average?.total) },
      difference: gf - ga,
    },
    cleanSheets: { home: teamStatsNum(clean.home), away: teamStatsNum(clean.away), total: teamStatsNum(clean.total) },
    failedToScore: { home: teamStatsNum(failed.home), away: teamStatsNum(failed.away), total: teamStatsNum(failed.total) },
    biggest: {
      winHome: String(biggest?.wins?.home || ''), winAway: String(biggest?.wins?.away || ''),
      lossHome: String(biggest?.loses?.home || ''), lossAway: String(biggest?.loses?.away || ''),
      goalsForHome: teamStatsNum(biggest?.goals?.for?.home), goalsForAway: teamStatsNum(biggest?.goals?.for?.away),
      goalsAgainstHome: teamStatsNum(biggest?.goals?.against?.home), goalsAgainstAway: teamStatsNum(biggest?.goals?.against?.away),
    },
    penalties: {
      scored: teamStatsNum(penalties?.scored?.total), missed: teamStatsNum(penalties?.missed?.total), total: teamStatsNum(penalties?.total),
    },
    mostUsedLineup: mostUsedLineup ? { formation: String(mostUsedLineup.formation || ''), played: teamStatsNum(mostUsedLineup.played) } : null,
    derived: {
      points,
      ppg: totalPlayed ? Math.round((points / totalPlayed) * 100) / 100 : null,
      homePpg: homePlayed ? Math.round((homePoints / homePlayed) * 100) / 100 : null,
      awayPpg: awayPlayed ? Math.round((awayPoints / awayPlayed) * 100) / 100 : null,
      winRate: teamStatsRate(wins.total, totalPlayed),
      cleanSheetRate: teamStatsRate(clean.total, totalPlayed),
      failedToScoreRate: teamStatsRate(failed.total, totalPlayed),
      goalsForPerMatch: totalPlayed ? Math.round((gf / totalPlayed) * 100) / 100 : null,
      goalsAgainstPerMatch: totalPlayed ? Math.round((ga / totalPlayed) * 100) / 100 : null,
    },
  };
}

async function apiTeamIntelligence(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  const leagueId = Number(url.searchParams.get('leagueId'));
  const season = Number(url.searchParams.get('season'));
  if (!teamId || !leagueId || !season) return json({ error: 'teamId, leagueId и season обязательны.' }, 400);
  const cacheKey = `team:intelligence:${teamId}:${leagueId}:${season}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
  if (!freeQuotaHealthy(15, 2)) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Сезонная статистика показана из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
    return json({ available: false, quotaGuard: true, reason: 'Сезонная статистика временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
  }
  try {
    const row = await apiFootball('/teams/statistics', { team: teamId, league: leagueId, season }, cfg, { responseType: 'any' });
    const stats = normalizeTeamSeasonStatistics(row, {
      teamId, leagueId, season,
      teamName: url.searchParams.get('teamName') || '', teamLogo: url.searchParams.get('teamLogo') || '',
      leagueName: url.searchParams.get('leagueName') || '', country: url.searchParams.get('country') || '', leagueLogo: url.searchParams.get('leagueLogo') || '',
    });
    const payload = { available: stats.available, stats, refreshedAt: new Date().toISOString(), reason: stats.available ? '' : 'Провайдер не вернул сезонную статистику для этой команды.' };
    await setCache(cacheKey, teamId, payload, cfg, 360);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить сезонную статистику — показана сохранённая версия.', provider: publicDataCapabilities() });
    return json({ available: false, reason: `Сезонная статистика сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
  }
}

function normalizeSquadPosition(position) {
  const p = String(position || '').toLowerCase();
  if (p.includes('goal')) return { key: 'goalkeeper', label: 'Вратари', order: 1 };
  if (p.includes('def')) return { key: 'defender', label: 'Защитники', order: 2 };
  if (p.includes('mid')) return { key: 'midfielder', label: 'Полузащитники', order: 3 };
  if (p.includes('att')) return { key: 'attacker', label: 'Нападающие', order: 4 };
  return { key: 'other', label: 'Другие', order: 5 };
}

function normalizeTeamSquad(rows, teamId) {
  const row = (Array.isArray(rows) ? rows : []).find(x => Number(x?.team?.id) === Number(teamId)) || rows?.[0] || null;
  if (!row) return { available: false, team: { id: Number(teamId) }, players: [], groups: [], summary: { total: 0, averageAge: null } };
  const players = (Array.isArray(row.players) ? row.players : []).map(p => {
    const pos = normalizeSquadPosition(p.position);
    return {
      id: Number(p.id || 0), name: String(p.name || ''), age: Number(p.age || 0) || null,
      number: Number(p.number || 0) || null, position: String(p.position || ''), positionKey: pos.key, positionLabel: pos.label,
      photo: String(p.photo || ''), order: pos.order,
    };
  }).filter(p => p.id || p.name).sort((a,b) => a.order - b.order || (a.number || 999) - (b.number || 999) || a.name.localeCompare(b.name));
  const ages = players.map(p => p.age).filter(Boolean);
  const groupMap = new Map();
  for (const p of players) {
    if (!groupMap.has(p.positionKey)) groupMap.set(p.positionKey, { key: p.positionKey, label: p.positionLabel, order: p.order, players: [] });
    groupMap.get(p.positionKey).players.push(p);
  }
  const groups = [...groupMap.values()].sort((a,b) => a.order - b.order);
  return {
    available: players.length > 0,
    team: { id: Number(row.team?.id || teamId), name: String(row.team?.name || ''), logo: String(row.team?.logo || '') },
    players, groups,
    summary: {
      total: players.length,
      averageAge: ages.length ? Math.round((ages.reduce((a,b)=>a+b,0) / ages.length) * 10) / 10 : null,
      goalkeepers: players.filter(p => p.positionKey === 'goalkeeper').length,
      defenders: players.filter(p => p.positionKey === 'defender').length,
      midfielders: players.filter(p => p.positionKey === 'midfielder').length,
      attackers: players.filter(p => p.positionKey === 'attacker').length,
    },
  };
}

async function apiTeamSquad(request, cfg) {
  const url = new URL(request.url);
  const teamId = Number(url.searchParams.get('teamId'));
  if (!teamId) return json({ error: 'teamId обязателен.' }, 400);
  const cacheKey = `team:squad:${teamId}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) return json({ ...cached, cached: true, stale: false, provider: publicDataCapabilities() });
  if (!freeQuotaHealthy(10, 2)) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Состав показан из кэша: бережём лимит API-Football.', provider: publicDataCapabilities() });
    return json({ available: false, quotaGuard: true, reason: 'Состав временно не запрашивается: сохраняем остаток квоты API-Football.', provider: publicDataCapabilities() });
  }
  try {
    const rows = await apiFootball('/players/squads', { team: teamId }, cfg);
    const squad = normalizeTeamSquad(rows, teamId);
    const payload = { ...squad, refreshedAt: new Date().toISOString(), reason: squad.available ? '' : 'Провайдер не вернул текущий состав команды.' };
    await setCache(cacheKey, teamId, payload, cfg, 720);
    return json({ ...payload, cached: false, stale: false, provider: publicDataCapabilities() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить состав — показана сохранённая версия.', provider: publicDataCapabilities() });
    return json({ available: false, reason: `Состав сейчас недоступен: ${String(error?.message || error).slice(0, 180)}`, provider: publicDataCapabilities() });
  }
}

async function apiMatchCenter(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId'));
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'fixtureId обязателен.' }, 400);

  // Shared across all users. During LIVE it expires after 60 seconds.
  const baseCacheKey = `match-center:${fixtureId}:v7-match-center-2`;
  const cached = await getCache(baseCacheKey, cfg);
  if (cached) return json({ ...cached, cached: true });

  let fixture;
  try {
    fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  } catch (error) {
    const stale = await getStaleCache(baseCacheKey, cfg);
    if (stale && isFootballRateLimitError(error)) {
      return json({ ...stale, cached: true, stale: true, warning: 'LIVE-данные временно показаны из последнего кэша из-за лимита API.', retryAfter: Number(error?.retryAfter || 60) });
    }
    throw error;
  }
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);
  const centerIntegrity = validateFixtureIntegrity(fixture, '', null);
  if (centerIntegrity.quarantine) {
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'MATCH_CENTER_REJECTED', message: 'Match Center отклонил structurally invalid fixture.', meta: { fixtureId, issues: centerIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
    return json({ error: 'Данные этого матча не прошли проверку целостности. Попробуйте позже.', code: 'MATCH_DATA_INVALID', integrity: centerIntegrity }, 409);
  }

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
  let playerRows = embedded.players;
  if (!limitedCoverage && (live || finished) && !events.length) {
    events = await apiFootball('/fixtures/events', { fixture: fixtureId }, cfg).catch(() => []);
  }
  if (!limitedCoverage && (live || finished) && !statistics.length) {
    statistics = await apiFootball('/fixtures/statistics', { fixture: fixtureId }, cfg).catch(() => []);
  }
  // Player-level fixture statistics are useful but expensive on the free plan.
  // Fetch them automatically only when the provider plan/quota can sustain it.
  if (!limitedCoverage && (live || finished) && !playerRows.length && paidQuotaHealthy()) {
    playerRows = await apiFootball('/fixtures/players', { fixture: fixtureId }, cfg).catch(() => []);
  }

  // v4.3 Expanded Football Data: once a paid provider plan is active and the
  // quota is healthy, enrich Match Center with official lineups and absences.
  // On FREE these calls stay disabled, so the current economical behaviour is preserved.
  let lineupRows = embedded.lineups;
  let injuryRows = [];
  const kickoffMsCenter = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoffCenter = Number.isFinite(kickoffMsCenter)
    ? Math.round((kickoffMsCenter - Date.now()) / 60000)
    : null;
  const lineupsWindow = live || finished || (
    minutesToKickoffCenter !== null && minutesToKickoffCenter <= 120 && minutesToKickoffCenter >= -300
  );
  if (!limitedCoverage && paidQuotaHealthy() && lineupsWindow && !lineupRows.length) {
    lineupRows = await apiFootball('/fixtures/lineups', { fixture: fixtureId }, cfg).catch(() => []);
  }
  if (!limitedCoverage && paidQuotaHealthy() && !finished) {
    injuryRows = await apiFootball('/injuries', { fixture: fixtureId }, cfg).catch(() => []);
  }

  let liveOdds = null;
  let oddsMovement = null;
  if (live && !limitedCoverage && cfg.liveOddsEnabled && paidQuotaHealthy()) {
    const liveOddsRows = await apiFootball('/odds/live', { fixture: fixtureId }, cfg).catch(() => []);
    liveOdds = extractLiveMarket(liveOddsRows);
    if (liveOdds) {
      await saveOddsSnapshot(fixtureId, liveOdds, cfg);
      const snapshots = await getOddsSnapshots(fixtureId, cfg, 12);
      oddsMovement = buildOddsMovement(snapshots, liveOdds);
    }
  }
  const refreshSeconds = live ? liveRefreshSeconds() : 0;
  const formattedStatistics = formatLiveStatistics(statistics, homeId, awayId);
  const playerLeaders = formatPlayerLeaders(playerRows, homeId, awayId);
  const lineups = formatLineups(lineupRows, homeId, awayId);
  const absences = formatAbsences(injuryRows, homeId, awayId);
  const pressure = live ? livePressure(formattedStatistics) : null;

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
      referee: fixture.fixture?.referee || '',
      timezone: fixture.fixture?.timezone || '',
      league: leagueName,
      leagueId: Number(fixture.league?.id || 0),
      leagueLogo: fixture.league?.logo || '',
      country: fixture.league?.country || '',
      round: fixture.league?.round || '',
      score: scoreSnapshot(fixture),
      integrity: { state: centerIntegrity.state, score: centerIntegrity.qualityScore, warnings: centerIntegrity.warnings, issues: centerIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    events: formatLiveEvents(events, homeId, awayId),
    statistics: formattedStatistics,
    livePressure: pressure,
    playerLeaders,
    lineups,
    absences,
    availability: {
      events: events.length > 0,
      statistics: statistics.length > 0,
      lineups: lineupRows.length > 0,
      players: playerLeaders.home.length > 0 || playerLeaders.away.length > 0,
      injuries: injuryRows.length > 0,
      limitedCoverage,
    },
    dataCapabilities: publicDataCapabilities(),
    liveOdds,
    oddsMovement,
    provider: publicDataCapabilities(),
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


async function cachedSeasonStatsForComparison(teamId, leagueId, season, cfg) {
  if (!teamId || !leagueId || !season) return null;
  const cached = await getStaleCache(`team:intelligence:${Number(teamId)}:${Number(leagueId)}:${Number(season)}:v1`, cfg);
  return cached?.stats?.available ? cached.stats : null;
}

function comparisonNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function comparisonMetric({ key, label, homeValue, awayValue, format = 'number', better = 'higher', minGap = 0, note = '' }) {
  const home = comparisonNumber(homeValue);
  const away = comparisonNumber(awayValue);
  if (home === null || away === null) return null;
  const gap = Math.abs(home - away);
  let edge = 'even';
  if (gap > Number(minGap || 0)) {
    const homeBetter = better === 'lower' ? home < away : home > away;
    edge = homeBetter ? 'home' : 'away';
  }
  return { key, label, homeValue: home, awayValue: away, format, better, edge, note };
}

function buildMatchComparison({ homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats, goalModel, h2h, absences, hasInjuryData }) {
  const hOverall = homeForm?.overall || null;
  const aOverall = awayForm?.overall || null;
  const hVenue = homeForm?.venue || null;
  const aVenue = awayForm?.venue || null;
  const hSeason = homeSeasonStats?.derived || null;
  const aSeason = awaySeasonStats?.derived || null;

  const metrics = [
    comparisonMetric({ key:'form_ppg', label:'Форма · очки/матч', homeValue:hOverall?.ppg, awayValue:aOverall?.ppg, format:'decimal', minGap:.14, note:'Последние 5 завершённых матчей.' }),
    comparisonMetric({ key:'venue_ppg', label:'Дома / в гостях', homeValue:hVenue?.ppg, awayValue:aVenue?.ppg, format:'decimal', minGap:.14, note:'Хозяева дома против гостей на выезде.' }),
    comparisonMetric({ key:'attack', label:'Атака · гол/матч', homeValue:(hSeason && aSeason) ? hSeason.goalsForPerMatch : hOverall?.gfAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsForPerMatch : aOverall?.gfAvg, format:'decimal', minGap:.14, note:(hSeason && aSeason) ? 'Сезонная статистика из уже загруженного кэша.' : 'Недавняя результативность.' }),
    comparisonMetric({ key:'defense', label:'Оборона · пропущено', homeValue:(hSeason && aSeason) ? hSeason.goalsAgainstPerMatch : hOverall?.gaAvg, awayValue:(hSeason && aSeason) ? aSeason.goalsAgainstPerMatch : aOverall?.gaAvg, format:'decimal', better:'lower', minGap:.14, note:'Меньше — лучше.' }),
    comparisonMetric({ key:'clean_sheets', label:'Сухие матчи', homeValue:(hSeason && aSeason) ? hSeason.cleanSheetRate : hOverall?.cleanSheetPct, awayValue:(hSeason && aSeason) ? aSeason.cleanSheetRate : aOverall?.cleanSheetPct, format:'percent', minGap:8, note:(hSeason && aSeason) ? 'Доля матчей сезона без пропущенных.' : 'Доля в последних матчах.' }),
    comparisonMetric({ key:'expected_goals', label:'Голевая оценка модели', homeValue:goalModel?.homeExpected, awayValue:goalModel?.awayExpected, format:'decimal', minGap:.14, note:'Poisson-эвристика по доступной форме.' }),
    comparisonMetric({ key:'table_rank', label:'Место в таблице', homeValue:homeStanding?.rank, awayValue:awayStanding?.rank, format:'rank', better:'lower', minGap:0, note:'Показывается только если таблица турнира уже была загружена.' }),
    ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) ? comparisonMetric({ key:'h2h', label:'Победы в H2H', homeValue:h2h?.homeWins, awayValue:h2h?.awayWins, format:'integer', minGap:0, note:'Последние доступные очные встречи.' }) : null,
    hasInjuryData ? comparisonMetric({ key:'absences', label:'Отмеченные потери', homeValue:absences?.home?.length || 0, awayValue:absences?.away?.length || 0, format:'integer', better:'lower', minGap:0, note:'Только подтверждённые провайдером отсутствия.' }) : null,
  ].filter(Boolean);

  const descriptions = {
    form_ppg: 'лучше текущая форма', venue_ppg: 'сильнее профиль дома/в гостях', attack: 'выше результативность',
    defense: 'меньше пропускает', clean_sheets: 'чаще сохраняет ворота сухими', expected_goals: 'выше голевая оценка модели',
    table_rank: 'выше позиция в таблице', h2h: 'больше побед в очных матчах', absences: 'меньше отмеченных потерь состава',
  };
  const advantages = { home: [], away: [] };
  let homeEdges = 0, awayEdges = 0, even = 0;
  for (const metric of metrics) {
    if (metric.edge === 'home') { homeEdges += 1; if (advantages.home.length < 4) advantages.home.push(descriptions[metric.key] || metric.label); }
    else if (metric.edge === 'away') { awayEdges += 1; if (advantages.away.length < 4) advantages.away.push(descriptions[metric.key] || metric.label); }
    else even += 1;
  }

  let balanceLabel = 'Баланс доступных метрик близкий';
  if (homeEdges >= awayEdges + 2) balanceLabel = `${homeName} впереди по большему числу доступных метрик`;
  else if (awayEdges >= homeEdges + 2) balanceLabel = `${awayName} впереди по большему числу доступных метрик`;

  const sources = ['последние матчи', 'дом/выезд'];
  if (homeSeasonStats && awaySeasonStats) sources.push('кэш сезонной статистики');
  if (homeStanding && awayStanding) sources.push('кэш таблицы');
  if ((Number(h2h?.homeWins||0)+Number(h2h?.awayWins||0)+Number(h2h?.draws||0)) > 0) sources.push('H2H');
  if (hasInjuryData) sources.push('потери состава');

  return {
    metrics,
    advantages,
    score: { home: homeEdges, away: awayEdges, even },
    balanceLabel,
    dataReuse: {
      separateApiRequests: 0,
      seasonStatsCached: Boolean(homeSeasonStats && awaySeasonStats),
      standingsCached: Boolean(homeStanding && awayStanding),
      sources,
      note: 'Вкладка сравнения сама не делает дополнительных запросов к API-Football: она собирается из данных текущего анализа и уже существующего кэша.',
    },
  };
}

async function apiAnalyze(request, cfg, user) {
  let body = {};
  try { body = await request.json(); } catch {}
  const fixtureId = Number(body?.fixtureId);
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'Некорректный fixtureId.' }, 400);

  const cacheKey = `fixture:${fixtureId}:v7-integrity`;
  const cached = await getCache(cacheKey, cfg);
  if (cached) {
    await recordHistory(user.id, cached, cfg);
    return json({ ...cached, cached: true, stale: false, quota: await getQuota(user.id, cfg) });
  }

  const staleBefore = await getStaleCache(cacheKey, cfg);
  const quotaBefore = await getQuota(user.id, cfg);
  if (quotaBefore.left <= 0) return json({ error: `Лимит исчерпан: ${quotaBefore.used}/${quotaBefore.limit} анализов сегодня.`, quota: quotaBefore }, 429);

  let fixture;
  try {
    fixture = (await apiFootball('/fixtures', { id: fixtureId }, cfg))[0];
  } catch (error) {
    if (staleBefore && isFootballRateLimitError(error)) {
      await recordHistory(user.id, staleBefore, cfg);
      return json({ ...staleBefore, cached: true, stale: true, warning: 'Показан последний сохранённый анализ: футбольный API временно ограничил запросы.', retryAfter: Number(error?.retryAfter || 60), quota: quotaBefore });
    }
    throw error;
  }
  if (!fixture) return json({ error: 'Матч не найден.' }, 404);
  const analysisIntegrity = validateFixtureIntegrity(fixture, '', null);
  if (analysisIntegrity.quarantine) {
    await recordOpsEvent(cfg, { severity: 'warning', source: 'integrity', eventType: 'single_fixture_guard', code: 'ANALYSIS_REJECTED', message: 'Анализ отклонён: fixture не прошёл структурную проверку.', meta: { fixtureId, issues: analysisIntegrity.issues.filter(x => x.severity === 'error').map(x => x.code) } }).catch(() => {});
    return json({ error: 'Данные матча выглядят противоречиво, поэтому анализ временно заблокирован.', code: 'MATCH_DATA_INVALID', integrity: analysisIntegrity, quota: quotaBefore }, 409);
  }
  // If this fixture has already finished, settle any earlier immutable pre-match snapshot without another football API call.
  if (isFinishedStatus(fixture.fixture?.status?.short)) await settlePredictionsFromFixtures([fixture], cfg).catch(() => null);

  const homeId = fixture.teams?.home?.id, awayId = fixture.teams?.away?.id;
  const homeName = fixture.teams?.home?.name || '', awayName = fixture.teams?.away?.name || '';
  const leagueName = fixture.league?.name || '';

  const kickoffMs = fixture.fixture?.date ? Date.parse(fixture.fixture.date) : NaN;
  const minutesToKickoff = Number.isFinite(kickoffMs) ? Math.round((kickoffMs - Date.now()) / 60000) : null;
  const status = fixture.fixture?.status?.short || '';
  const detailedCoverage = !isYouthReserveMatch(leagueName, homeName, awayName);
  const providerPlan = memory.provider?.plan || 'UNKNOWN';
  const paid = ['PRO','ULTRA','MEGA'].includes(providerPlan);
  const healthyFree = freeQuotaHealthy(30, 6);
  const minuteRemaining = Number(memory.provider?.minuteRemaining);
  const lowMinuteBudget = !paid && Number.isFinite(minuteRemaining) && minuteRemaining < 5;
  const veryLowMinuteBudget = !paid && Number.isFinite(minuteRemaining) && minuteRemaining < 3;
  const canFetchLineups = detailedCoverage && (paid || freeQuotaHealthy(15, 5)) && (
    isLiveStatus(status) || (minutesToKickoff !== null && minutesToKickoff <= 90 && minutesToKickoff >= -240)
  );
  const canFetchFreshForm = detailedCoverage && (paid || healthyFree);
  const canFetchH2H = detailedCoverage && (paid || !lowMinuteBudget);
  const canFetchInjuries = paid || !veryLowMinuteBudget;

  const skipped = [];
  if (!canFetchFreshForm && detailedCoverage) skipped.push('Свежая форма команд: сохранён API-лимит; используем кэш, если он есть.');
  if (!canFetchLineups && detailedCoverage && minutesToKickoff !== null && minutesToKickoff <= 120) skipped.push('Составы: запрос отложен из-за лимита или до публикации стартовых XI.');
  if (!canFetchH2H && detailedCoverage) skipped.push('H2H временно пропущен: осталось мало запросов в минутном окне.');
  if (!canFetchInjuries) skipped.push('Травмы временно пропущены: осталось критически мало запросов в минутном окне.');
  if (!detailedCoverage) skipped.push('Молодёжный/резервный турнир: расширенные запросы ограничены из-за слабого покрытия.');

  let injuries = [], predictions = [], odds = [], h2hRows = [], lineupsRows = [];
  try {
    [injuries, predictions, odds, h2hRows] = await Promise.all([
      canFetchInjuries ? apiFootball('/injuries', { fixture: fixtureId }, cfg).catch(() => []) : Promise.resolve([]),
      apiFootball('/predictions', { fixture: fixtureId }, cfg).catch(() => []),
      apiFootball('/odds', { fixture: fixtureId }, cfg).catch(() => []),
      canFetchH2H ? apiFootball('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 5 }, cfg).catch(() => []) : Promise.resolve([]),
    ]);
    if (canFetchLineups) lineupsRows = await apiFootball('/fixtures/lineups', { fixture: fixtureId }, cfg).catch(() => []);
  } catch (error) {
    if (staleBefore && isFootballRateLimitError(error)) {
      await recordHistory(user.id, staleBefore, cfg);
      return json({ ...staleBefore, cached: true, stale: true, warning: 'Показан последний сохранённый анализ: API временно достиг лимита.', retryAfter: Number(error?.retryAfter || 60), quota: quotaBefore });
    }
    throw error;
  }

  const webPromise = tavilySearch(`${homeName} ${awayName} injuries team news probable lineups latest`, cfg);
  const homeFormPromise = detailedCoverage
    ? getRecentTeamForm(homeId, 'home', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const awayFormPromise = detailedCoverage
    ? getRecentTeamForm(awayId, 'away', fixture.fixture?.date, fixtureId, cfg, { allowNetwork: canFetchFreshForm }).catch(() => null)
    : Promise.resolve(null);
  const [web, homeForm, awayForm] = await Promise.all([webPromise, homeFormPromise, awayFormPromise]);

  // v3.5 Match Comparison: reuse only already cached deep team data.
  // This adds Supabase cache reads but deliberately makes zero extra API-Football calls.
  const leagueId = Number(fixture.league?.id || 0);
  const season = Number(fixture.league?.season || 0) || null;
  const comparisonCompetition = { leagueId, season };
  const [homeStanding, awayStanding, homeSeasonStats, awaySeasonStats] = await Promise.all([
    cachedTeamStanding(homeId, comparisonCompetition, cfg).catch(() => null),
    cachedTeamStanding(awayId, comparisonCompetition, cfg).catch(() => null),
    cachedSeasonStatsForComparison(homeId, leagueId, season, cfg).catch(() => null),
    cachedSeasonStatsForComparison(awayId, leagueId, season, cfg).catch(() => null),
  ]);

  const market = extractMarket(odds);
  const apiPrediction = extractPrediction(predictions);
  const h2h = formatH2H(h2hRows, homeId, awayId);
  const absences = formatAbsences(injuries, homeId, awayId);
  const lineups = formatLineups(lineupsRows, homeId, awayId);
  const recentFormProb = formProbabilities(homeForm, awayForm);
  const h2hProb = h2hProbabilities(h2h);
  const calibrationProfile = await getCalibrationProfile(cfg).catch(() => baselineCalibrationProfile());
  const baselineBlend = blendProbabilitySignals({ market, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: MODEL_BASE_WEIGHTS });
  const blended = calibrationProfile.weightsActive
    ? blendProbabilitySignals({ market, model: apiPrediction, form: recentFormProb, h2h: h2hProb, weightOverrides: calibrationProfile.signalWeights })
    : baselineBlend;
  const rawProbabilities = applyAbsenceAdjustment(baselineBlend.probabilities, absences);
  const weightedProbabilities = applyAbsenceAdjustment(blended.probabilities, absences);
  const probabilities = calibrationProfile.temperatureActive
    ? temperatureScaleProbabilities(weightedProbabilities, calibrationProfile.temperature)
    : weightedProbabilities;
  const goalModel = poissonGoalModel(homeForm, awayForm);
  const comparison = buildMatchComparison({
    homeName, awayName, homeForm, awayForm, homeStanding, awayStanding, homeSeasonStats, awaySeasonStats,
    goalModel, h2h, absences, hasInjuryData: injuries.length > 0,
  });
  const confidence = confidenceModel(blended.signals, probabilities, homeForm, awayForm);
  const notes = buildAnalysisNotes({
    probabilities, market, model: apiPrediction, homeForm, awayForm, h2h, absences, lineups, news: web,
    homeName, awayName, minutesToKickoff, confidence,
  });
  if (calibrationProfile.mode === 'active') {
    notes.factors.unshift(`Калибратор v3.7 активен на базе ${Number(calibrationProfile.sample || 0)} завершённых прогнозов; корректировки ограничены защитными порогами.`);
  } else if (calibrationProfile.mode === 'shadow') {
    notes.risks.push('Калибратор пока работает в теневом режиме: выборка собирается, но итоговые вероятности ещё не корректируются автоматически.');
  }

  const availableSignals = [
    market && 'market',
    apiPrediction && 'apiPrediction',
    homeForm?.overall && awayForm?.overall && 'recentForm',
    h2hRows.length && 'h2h',
    injuries.length && 'injuries',
    lineupsRows.length && 'lineups',
    web.answer && 'web',
  ].filter(Boolean);

  const payload = {
    generatedAt: new Date().toISOString(),
    analysisVersion: '4.3.0-admin-expanded-data',
    match: {
      fixtureId, date: fixture.fixture?.date || '', status: fixture.fixture?.status?.short || '',
      venue: fixture.fixture?.venue?.name || '', city: fixture.fixture?.venue?.city || '',
      leagueId, season, league: leagueName, country: fixture.league?.country || '',
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
      integrity: { state: analysisIntegrity.state, score: analysisIntegrity.qualityScore, warnings: analysisIntegrity.warnings, issues: analysisIntegrity.issues.filter(x => x.severity !== 'info').slice(0, 3) },
    },
    probabilities,
    rawProbabilities,
    modelCalibration: {
      version: calibrationProfile.version || '3.7',
      mode: calibrationProfile.mode || 'baseline',
      sample: Number(calibrationProfile.sample || 0),
      temperature: Number(calibrationProfile.temperature || 1),
      temperatureActive: Boolean(calibrationProfile.temperatureActive),
      weightsActive: Boolean(calibrationProfile.weightsActive),
      signalWeights: calibrationProfile.signalWeights || { ...MODEL_BASE_WEIGHTS },
      validation: calibrationProfile.temperatureValidation || null,
      note: calibrationProfile.note || '',
    },
    confidence,
    likelyOutcome: outcomeName(probabilities, homeName, awayName),
    modelBreakdown: {
      weights: blended.weights,
      signals: blended.signals,
      method: 'Рынок, API prediction, форма и H2H объединяются динамически. v3.7 может безопасно корректировать веса и резкость вероятностей только после backtest-проверки на holdout-матчах.',
    },
    dataPolicy: {
      dataMode: paid ? 'expanded' : 'standard',
      mode: paid ? 'full' : healthyFree ? 'balanced-free' : 'quota-saver',
      availableSignals,
      skipped,
    },
    dataCapabilities: publicDataCapabilities(),
    market, apiPrediction, recentForm: { home: homeForm, away: awayForm }, goalModel, comparison, absences, lineups, h2h,
    insights: notes.factors, risks: [...(notes.risks || []), ...skipped], news: web,
    completeness: {
      score: [fixture, market, apiPrediction, injuries.length, h2hRows.length, lineupsRows.length, web.answer, homeForm?.overall, awayForm?.overall, goalModel].filter(Boolean).length,
      max: 10,
    },
    provider: publicDataCapabilities(),
    disclaimer: 'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
  };

  let ttl = cfg.cacheMinutes;
  if (isFinishedStatus(status)) ttl = 720;
  else if (minutesToKickoff !== null && minutesToKickoff <= 120) ttl = 10;
  else if (minutesToKickoff !== null && minutesToKickoff > 360) ttl = 45;
  await setCache(cacheKey, fixtureId, payload, cfg, ttl);
  await captureModelPrediction(payload, cfg);
  await incrementUsage(user.id, cfg);
  await recordHistory(user.id, payload, cfg);
  return json({ ...payload, cached: false, stale: false, quota: await getQuota(user.id, cfg) });
}

export default {
  async fetch(request, env) {
    const cfg = config(env);
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({
        ok: true,
        version: APP_VERSION,
        database: hasSupabase(cfg) ? 'supabase' : 'memory',
        monetization: cfg.monetizationEnabled ? 'enabled' : 'paused',
        observability: 'enabled',
        dataIntegrity: 'enabled',
        performanceUx: 'enabled',
        visualDesign: 'enabled',
        releaseHardening: 'enabled',
        adminSecurity: 'enabled',
        expandedDataReady: 'enabled',
        matchCenter2: 'enabled',
        devMode: cfg.devMode,
      });
    }

    if (url.pathname === '/health/supabase') {
      return json({
        ok: false,
        error: 'Техническая проверка Supabase перенесена в защищённую админ-диагностику Mini App.',
        code: 'ADMIN_DIAGNOSTICS_ONLY',
      }, 404);
    }

    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      try {
        return await handleTelegramWebhook(request, cfg);
      } catch (error) {
        console.error('telegram webhook', error);
        bumpTelemetry('routeErrors');
        await recordOpsEvent(cfg, { severity: 'error', source: 'telegram', eventType: 'webhook', code: 'TELEGRAM_WEBHOOK', message: error?.message || error, endpoint: '/telegram/webhook' });
        return json({ ok: false }, 200);
      }
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) return json({ error: 'Откройте приложение внутри Telegram.' }, 401);

      if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
      if (request.method === 'GET' && url.pathname === '/api/data-capabilities') return json({ dataCapabilities: publicDataCapabilities() });

      // v4.3 Admin Security: technical endpoints are protected server-side.
      // Hiding cards in the UI is not considered authorization.
      if (request.method === 'GET' && url.pathname === '/api/provider') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return json({ provider: providerSnapshot() });
      }
      if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiDiagnostics(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/release-readiness') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiReleaseReadiness(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/data-integrity') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiDataIntegrity(request, cfg);
      }
      if (request.method === 'GET' && url.pathname === '/api/model-quality') {
        if (!isAdminUser(user, cfg)) return adminForbidden();
        return await apiModelQuality(request, cfg);
      }
      if (url.pathname.startsWith('/api/billing/')) {
        if (!cfg.monetizationEnabled) return json({ error: 'Монетизация отложена до финального этапа проекта.' }, 404);
        if (request.method === 'GET' && url.pathname === '/api/billing/plans') return await apiBillingPlans(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/invoice') return await apiBillingInvoice(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/sync') return await apiBillingSync(request, cfg, user);
        if (request.method === 'POST' && url.pathname === '/api/billing/subscription') return await apiBillingSubscription(request, cfg, user);
      }
      if (request.method === 'GET' && url.pathname === '/api/search') return await apiSearch(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/matches') return await apiMatches(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/tournament') return await apiTournament(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team') return await apiTeam(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team/intelligence') return await apiTeamIntelligence(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/team/squad') return await apiTeamSquad(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/match-center') return await apiMatchCenter(request, cfg);
      if (request.method === 'GET' && url.pathname === '/api/history') return await apiHistory(request, cfg, user);
      if (url.pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
      if (url.pathname === '/api/reminders') return await apiReminders(request, cfg, user);
      if (url.pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
      if (request.method === 'POST' && url.pathname === '/api/analyze') return await apiAnalyze(request, cfg, user);
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) {
      console.error(error);
      const retryAfter = Number(error?.retryAfter || 0);
      const rateLimited = isFootballRateLimitError(error);
      const status = rateLimited ? 429 : 502;
      if (!rateLimited) {
        bumpTelemetry('routeErrors');
        await recordOpsEvent(cfg, {
          severity: 'error', source: 'api', eventType: 'route_error', code: error?.code || 'SERVER_ERROR',
          message: error?.message || 'Ошибка сервера.', endpoint: url.pathname, status,
        });
      }
      return json({
        error: error?.message || 'Ошибка сервера.',
        code: error?.code || 'SERVER_ERROR',
        retryAfter: retryAfter || undefined,
        provider: publicDataCapabilities(),
      }, status);
    }
  },

  async scheduled(controller, env, ctx) {
    const cfg = config(env);
    const scheduledAt = new Date(Number(controller?.scheduledTime || Date.now()));
    const tasks = [
      ['reminders', processDueReminders(cfg)],
      ['backtest', settleBacktestDaily(cfg)],
    ];
    if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() < 15) {
      tasks.push(['ops_cleanup', cleanupOpsEvents(cfg)]);
      tasks.push(['integrity_cleanup', cleanupIntegrityData(cfg)]);
    }
    ctx.waitUntil((async () => {
      const results = await Promise.allSettled(tasks.map(([, promise]) => promise));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          await recordOpsEvent(cfg, { severity: 'error', source: 'cron', eventType: 'scheduled_task', code: 'CRON_TASK', message: results[i].reason?.message || results[i].reason, meta: { task: tasks[i][0] } });
        }
      }
    })());
  },
};
