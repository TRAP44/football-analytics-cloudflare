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
  provider: { name: 'API-Football', plan: 'UNKNOWN', dailyLimit: null, dailyRemaining: null, minuteLimit: null, minuteRemaining: null, updatedAt: null, cooldownUntil: null, lastError: '' },
};

const enc = new TextEncoder();

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
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
    liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
    // Монетизацию сознательно держим выключенной до финального этапа проекта.
    // Старый webhook может оставаться настроенным: pre-checkout будет отклонён,
    // а UI оплаты не показывается, пока флаг не включён явно.
    monetizationEnabled: boolEnv(env.MONETIZATION_ENABLED, false),
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
  if (hasSupabase(cfg)) {
    const row = await supaSelectOne(cfg, 'analysis_cache', { cache_key: `eq.${cacheKey}` });
    if (!row) return null;
    const expired = new Date(row.expires_at) <= new Date();
    if (expired && !allowExpired) return null;
    return { payload: row.payload, expired, expiresAt: row.expires_at };
  }
  const item = memory.cache.get(cacheKey);
  if (!item) return null;
  const expired = item.expiresAt <= Date.now();
  if (expired && !allowExpired) return null;
  return { payload: item.payload, expired, expiresAt: new Date(item.expiresAt).toISOString() };
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
    ...memory.provider,
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
  const paid = ['PRO','ULTRA','MEGA'].includes(memory.provider?.plan || '');
  const cooldownUntil = memory.provider?.cooldownUntil || null;
  const cooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());
  return {
    ...(memory.provider || {}),
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

async function apiFootball(path, params, cfg) {
  if (!cfg.apiFootballKey) throw footballError('API_FOOTBALL_KEY не настроен в Cloudflare.', 'FOOTBALL_CONFIG');

  const cooldown = footballCooldownRemaining();
  if (cooldown > 0) {
    throw footballError(`API-Football на паузе после ограничения. Повторите примерно через ${cooldown} сек.`, 'FOOTBALL_COOLDOWN', cooldown);
  }
  // Если предыдущий ответ уже показал 0 запросов в минутном окне,
  // не отправляем заведомо лишний запрос. Ждём до минуты от последнего ответа.
  if (Number(memory.provider?.minuteRemaining) === 0 && memory.provider?.updatedAt) {
    const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(memory.provider.updatedAt)) / 1000));
    const waitSec = Math.max(1, 60 - ageSec);
    if (waitSec > 0 && ageSec < 60) {
      memory.provider.cooldownUntil = new Date(Date.now() + waitSec * 1000).toISOString();
      throw footballError(`Минутная квота API-Football исчерпана. Повторите примерно через ${waitSec} сек.`, 'FOOTBALL_COOLDOWN', waitSec);
    }
  }

  const url = new URL(`https://v3.football.api-sports.io${path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const r = await fetch(url, {
    headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
  });
  updateProviderFromHeaders(r);
  const body = await r.json().catch(() => ({}));

  if (r.status === 429) {
    const retryHeader = Number(r.headers.get('retry-after') || 0);
    const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 65;
    memory.provider.cooldownUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
    memory.provider.lastError = 'rate_limit';
    throw footballError(`API-Football достиг минутного лимита. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_RATE_LIMIT', retryAfter);
  }
  if (!r.ok) {
    memory.provider.lastError = `http_${r.status}`;
    throw footballError(`API-Football временно недоступен (HTTP ${r.status}).`, 'FOOTBALL_HTTP');
  }

  const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
  if (errors.length) {
    const message = errors.join('; ');
    memory.provider.lastError = message.slice(0, 160);
    if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
      memory.provider.cooldownUntil = new Date(Date.now() + 65_000).toISOString();
      throw footballError('API-Football достиг лимита запросов. Покажем кэш, если он есть.', 'FOOTBALL_RATE_LIMIT', 65);
    }
    throw footballError(`API-Football: ${message}`, 'FOOTBALL_RESPONSE');
  }

  memory.provider.lastError = '';
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
    features: { monetizationEnabled: cfg.monetizationEnabled },
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
  if (!q) return json({ query: '', teams: [], competitions, provider: providerSnapshot(), hint: 'Введите название команды или турнира.' });
  if (q.length < 3) return json({ query, teams: [], competitions, provider: providerSnapshot(), hint: 'Для поиска команды введите минимум 3 символа.' });

  const cacheKey = `search:teams:${encodeURIComponent(q)}:v1`;
  const cached = await getCache(cacheKey, cfg);
  if (cached?.teams) return json({ ...cached, competitions, cached: true, provider: providerSnapshot() });

  let rows = [];
  let warning = '';
  try {
    if (!freeQuotaHealthy(8, 2)) {
      const stale = await getStaleCache(cacheKey, cfg);
      if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Поиск показан из кэша: бережём лимит API-Football.', provider: providerSnapshot() });
      return json({ query, teams: [], competitions, cached: false, warning: 'Поиск команд временно не запущен: бережём остаток бесплатной квоты API.', provider: providerSnapshot() });
    }
    rows = await apiFootball('/teams', { search: query }, cfg);
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale?.teams) return json({ ...stale, competitions, cached: true, stale: true, warning: 'Не удалось обновить поиск — показаны сохранённые результаты.', provider: providerSnapshot() });
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
  return json({ ...payload, competitions, cached: false, provider: providerSnapshot() });
}

async function apiMatches(request, cfg) {
  const url = new URL(request.url);
  const requested = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayUtc();
  const isToday = date === todayUtc();
  const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const isYesterday = date === yesterday.toISOString().slice(0, 10);
  const cacheKey = `matches:${date}:v5-catalog`;

  const cached = await getCache(cacheKey, cfg);
  if (cached?.matches) return json({ ...cached, cached: true, stale: false });

  let fixtures;
  try {
    fixtures = await apiFootball('/fixtures', { date }, cfg);
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale?.matches && isFootballRateLimitError(error)) {
      return json({
        ...stale, cached: true, stale: true,
        warning: 'Показаны последние сохранённые данные: API-Football временно ограничил частоту запросов.',
        retryAfter: Number(error?.retryAfter || 60),
      });
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
  const payload = { date, matches, catalog, refreshedAt: new Date().toISOString(), provider: providerSnapshot() };
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
  if (cached) return json({ ...cached, cached: true, stale: false, provider: providerSnapshot() });

  // Таблица — дополнительный запрос. На FREE не тратим последний запрос минутной квоты.
  const minuteRemaining = Number(memory.provider?.minuteRemaining);
  if (Number.isFinite(minuteRemaining) && minuteRemaining <= 1) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Таблица показана из сохранённого кэша: минутная квота API почти исчерпана.', provider: providerSnapshot() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: 'Таблица временно не запрашивается: бережём последний запрос минутной квоты API-Football.',
      provider: providerSnapshot(),
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
    return json({ ...payload, cached: false, stale: false, provider: providerSnapshot() });
  } catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale) return json({ ...stale, cached: true, stale: true, warning: 'Не удалось обновить таблицу — показана последняя сохранённая версия.', provider: providerSnapshot() });
    return json({
      leagueId, season, standings: [], groups: [], available: false,
      reason: `Таблица сейчас недоступна: ${String(error?.message || error).slice(0, 180)}`,
      provider: providerSnapshot(),
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
  if (cached) return json({ ...cached, standing: await cachedTeamStanding(teamId, cached.primaryCompetition, cfg), cached:true, stale:false, provider:providerSnapshot() });
  let fixtures;
  try { fixtures = await apiFootball('/fixtures', { team:teamId, from, to }, cfg); }
  catch (error) {
    const stale = await getStaleCache(cacheKey, cfg);
    if (stale && isFootballRateLimitError(error)) return json({ ...stale, standing:await cachedTeamStanding(teamId, stale.primaryCompetition, cfg), cached:true, stale:true, warning:'Страница команды показана из последнего кэша из-за лимита API.', provider:providerSnapshot() });
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
  return json({ ...payload, cached:false, stale:false, provider:providerSnapshot() });
}

async function apiMatchCenter(request, cfg) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get('fixtureId'));
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) return json({ error: 'fixtureId обязателен.' }, 400);

  // Shared across all users. During LIVE it expires after 60 seconds.
  const baseCacheKey = `match-center:${fixtureId}:v4`;
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
      league: leagueName,
      country: fixture.league?.country || '',
      score: scoreSnapshot(fixture),
      home: { id: homeId, name: homeName, logo: fixture.teams?.home?.logo || '' },
      away: { id: awayId, name: awayName, logo: fixture.teams?.away?.logo || '' },
    },
    events: formatLiveEvents(events, homeId, awayId),
    statistics: formattedStatistics,
    livePressure: pressure,
    playerLeaders,
    lineups: formatLineups(embedded.lineups, homeId, awayId),
    availability: {
      events: events.length > 0,
      statistics: statistics.length > 0,
      lineups: embedded.lineups.length > 0,
      players: playerLeaders.home.length > 0 || playerLeaders.away.length > 0,
      limitedCoverage,
    },
    liveOdds,
    oddsMovement,
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

  const cacheKey = `fixture:${fixtureId}:v4-quality-engine`;
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
    analysisVersion: '3.3.0-search-discovery',
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
      method: 'Динамическое объединение рынка, API prediction, формы и H2H. При низкой квоте низкоприоритетные запросы пропускаются вместо ошибки.',
    },
    dataPolicy: {
      providerPlan,
      mode: paid ? 'full' : healthyFree ? 'balanced-free' : 'quota-saver',
      availableSignals,
      skipped,
    },
    market, apiPrediction, recentForm: { home: homeForm, away: awayForm }, goalModel, absences, lineups, h2h,
    insights: notes.factors, risks: [...(notes.risks || []), ...skipped], news: web,
    completeness: {
      score: [fixture, market, apiPrediction, injuries.length, h2hRows.length, lineupsRows.length, web.answer, homeForm?.overall, awayForm?.overall, goalModel].filter(Boolean).length,
      max: 10,
    },
    provider: providerSnapshot(),
    disclaimer: 'Расчёт основан на доступных статистических сигналах и не гарантирует исход матча. Это не финансовая рекомендация.',
  };

  let ttl = cfg.cacheMinutes;
  if (isFinishedStatus(status)) ttl = 720;
  else if (minutesToKickoff !== null && minutesToKickoff <= 120) ttl = 10;
  else if (minutesToKickoff !== null && minutesToKickoff > 360) ttl = 45;
  await setCache(cacheKey, fixtureId, payload, cfg, ttl);
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
        version: '3.3.0-search-discovery',
        database: hasSupabase(cfg) ? 'supabase' : 'memory',
        monetization: cfg.monetizationEnabled ? 'enabled' : 'paused',
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

    if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
      try {
        return await handleTelegramWebhook(request, cfg);
      } catch (error) {
        console.error('telegram webhook', error);
        return json({ ok: false }, 200);
      }
    }

    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    try {
      const user = await getRequestUser(request, cfg);
      if (!user) return json({ error: 'Откройте приложение внутри Telegram.' }, 401);

      if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
      if (request.method === 'GET' && url.pathname === '/api/provider') return json({ provider: providerSnapshot() });
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
      const status = isFootballRateLimitError(error) ? 429 : 502;
      return json({
        error: error?.message || 'Ошибка сервера.',
        code: error?.code || 'SERVER_ERROR',
        retryAfter: retryAfter || undefined,
        provider: providerSnapshot(),
      }, status);
    }
  },

  async scheduled(controller, env, ctx) {
    const cfg = config(env);
    ctx.waitUntil(processDueReminders(cfg));
  },
};
