import { bytesToHex, constantTimeEqual, hmacSha256 } from './crypto-utils.js';
import { durableAnalysisUsageHeaders } from './analysis-usage-compensation.js';

const enc = new TextEncoder();

export const PASS_TYPES = Object.freeze({
  MATCH: 'MATCH_PASS',
  DAY: 'DAY_PASS',
  WEEKEND: 'WEEKEND_PASS',
});

export const DEFAULT_PASS_PRODUCTS = Object.freeze({
  MATCH_PASS: Object.freeze({
    title: 'Match Pass',
    description: 'Полный AI-доступ к одному выбранному матчу.',
    stars: 39,
    durationHours: 72,
  }),
  DAY_PASS: Object.freeze({
    title: 'Day Pass',
    description: 'Полный AI-доступ ко всем поддерживаемым матчам на 24 часа.',
    stars: 89,
    durationHours: 24,
  }),
  WEEKEND_PASS: Object.freeze({
    title: 'Weekend Pass',
    description: 'AI-доступ ко всем поддерживаемым матчам на 7 дней.',
    stars: 149,
    durationHours: 168,
  }),
});

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function normalizePassType(value) {
  const type = String(value || '').trim().toUpperCase();
  return Object.hasOwn(DEFAULT_PASS_PRODUCTS, type) ? type : '';
}

export function passProductConfig(type, cfg = {}) {
  const key = normalizePassType(type);
  if (!key) return null;
  const base = DEFAULT_PASS_PRODUCTS[key];
  const usageLimit = positiveInt(cfg.passUsageLimits?.[key], null);
  return {
    key,
    ...base,
    stars: positiveInt(cfg.passPrices?.[key], base.stars),
    durationHours: positiveInt(cfg.passDurations?.[key], base.durationHours),
    usageLimit,
    saleReady: key !== PASS_TYPES.WEEKEND || usageLimit !== null,
  };
}

function normalizedFixtureId(type, fixtureId) {
  const id = Number(fixtureId || 0);
  if (type === PASS_TYPES.MATCH) {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return id;
  }
  return 0;
}

async function passInvoiceSignature(base, botToken) {
  if (!botToken) return '';
  return bytesToHex(await hmacSha256(enc.encode(botToken), base)).slice(0, 24);
}

export async function createPassInvoicePayload(userId, passType, fixtureId, botToken) {
  const uid = Number(userId);
  const type = normalizePassType(passType);
  const fid = normalizedFixtureId(type, fixtureId);
  if (!Number.isSafeInteger(uid) || uid <= 0 || !type || fid === null || !botToken) {
    throw new Error('Некорректные параметры Pass-счёта.');
  }
  const nonceBytes = crypto.getRandomValues(new Uint8Array(6));
  const nonce = bytesToHex(nonceBytes);
  const base = `fa2|${uid}|${type}|${fid}|${nonce}`;
  return `${base}|${await passInvoiceSignature(base, botToken)}`;
}

export async function parsePassInvoicePayload(payload, botToken) {
  const parts = String(payload || '').split('|');
  if (parts.length !== 6 || parts[0] !== 'fa2' || !botToken) return null;
  const [, uidRaw, typeRaw, fixtureRaw, nonce, sig] = parts;
  const userId = Number(uidRaw);
  const passType = normalizePassType(typeRaw);
  const fixtureId = Number(fixtureRaw);
  if (
    !Number.isSafeInteger(userId) || userId <= 0
    || !passType
    || !Number.isSafeInteger(fixtureId) || fixtureId < 0
    || normalizedFixtureId(passType, fixtureId) === null
    || (passType !== PASS_TYPES.MATCH && fixtureId !== 0)
    || !/^[0-9a-f]{12}$/i.test(nonce)
    || !/^[0-9a-f]{24}$/i.test(sig)
  ) return null;
  const base = `fa2|${userId}|${passType}|${fixtureId}|${nonce}`;
  const expected = await passInvoiceSignature(base, botToken);
  if (!constantTimeEqual(expected.toLowerCase(), sig.toLowerCase())) return null;
  return { userId, passType, fixtureId, nonce };
}

export function passEntitlementWindow(passType, paidAt, cfg = {}) {
  const product = passProductConfig(passType, cfg);
  const startsMs = new Date(paidAt || Date.now()).getTime();
  if (!product || !Number.isFinite(startsMs)) return null;
  const startsAt = new Date(startsMs).toISOString();
  const expiresAt = new Date(startsMs + product.durationHours * 60 * 60 * 1000).toISOString();
  return { startsAt, expiresAt };
}

export function normalizeEntitlementRow(row = {}) {
  return {
    id: row.id ?? null,
    telegramId: Number(row.telegram_id ?? row.telegramId ?? 0),
    type: normalizePassType(row.entitlement_type ?? row.type),
    fixtureId: Number(row.fixture_id ?? row.fixtureId ?? 0) || 0,
    startsAt: row.starts_at ?? row.startsAt ?? null,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    usageLimit: row.usage_limit == null && row.usageLimit == null ? null : Number(row.usage_limit ?? row.usageLimit),
    usageCount: Math.max(0, Number(row.usage_count ?? row.usageCount ?? 0)),
    paymentChargeId: String(row.payment_charge_id ?? row.paymentChargeId ?? ''),
    status: String(row.status || 'active').toLowerCase(),
  };
}

export function entitlementDecision(row, { fixtureId = 0, now = Date.now() } = {}) {
  const item = normalizeEntitlementRow(row);
  if (!item.type) return { active: false, reason: 'unknown_type', item };
  if (item.status !== 'active') return { active: false, reason: item.status || 'inactive', item };

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const startsMs = new Date(item.startsAt || 0).getTime();
  const expiresMs = new Date(item.expiresAt || 0).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(startsMs) || !Number.isFinite(expiresMs)) {
    return { active: false, reason: 'invalid_window', item };
  }
  if (startsMs > nowMs) return { active: false, reason: 'not_started', item };
  if (expiresMs <= nowMs) return { active: false, reason: 'expired', item };
  if (item.usageLimit != null && (!Number.isFinite(item.usageLimit) || item.usageLimit <= item.usageCount)) {
    return { active: false, reason: 'usage_exhausted', item };
  }
  if (item.type === PASS_TYPES.MATCH && Number(fixtureId || 0) !== item.fixtureId) {
    return { active: false, reason: 'fixture_mismatch', item };
  }
  return { active: true, reason: 'active', item };
}

export function resolveEntitlementAccess({
  plan = 'FREE',
  subscriptionUntil = null,
  entitlements = [],
  fixtureId = 0,
  now = Date.now(),
} = {}) {
  const normalizedPlan = ['PRO', 'PREMIUM'].includes(String(plan || '').toUpperCase())
    ? String(plan).toUpperCase()
    : 'FREE';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const subscriptionExpiresMs = subscriptionUntil ? new Date(subscriptionUntil).getTime() : Number.POSITIVE_INFINITY;
  const subscriptionActive = normalizedPlan !== 'FREE'
    && Number.isFinite(nowMs)
    && (!subscriptionUntil || (Number.isFinite(subscriptionExpiresMs) && subscriptionExpiresMs > nowMs));

  const decisions = (entitlements || []).map(row => entitlementDecision(row, { fixtureId, now: nowMs }));
  const activePasses = decisions.filter(item => item.active).map(item => item.item);
  const hasMatchPass = activePasses.some(item => item.type === PASS_TYPES.MATCH);
  const hasDayPass = activePasses.some(item => item.type === PASS_TYPES.DAY);
  const hasWeekendPass = activePasses.some(item => item.type === PASS_TYPES.WEEKEND);
  const passActive = hasMatchPass || hasDayPass || hasWeekendPass;
  const effectiveSource = subscriptionActive ? 'subscription' : passActive ? 'pass' : 'free';

  return {
    plan: subscriptionActive ? normalizedPlan : 'FREE',
    effectiveTier: subscriptionActive ? normalizedPlan : passActive ? 'PASS' : 'FREE',
    source: effectiveSource,
    fixtureId: Number(fixtureId || 0) || null,
    subscriptionActive,
    access: {
      expandedAi: subscriptionActive || passActive,
      prematch: subscriptionActive || passActive,
      live: subscriptionActive || passActive,
      importantChanges: subscriptionActive || passActive,
      postMatchReview: subscriptionActive || passActive,
    },
    passes: {
      match: hasMatchPass,
      day: hasDayPass,
      weekend: hasWeekendPass,
      active: activePasses,
    },
    decisions: decisions.map(({ active, reason, item }) => ({
      id: item.id,
      type: item.type,
      fixtureId: item.fixtureId || null,
      active,
      reason,
      expiresAt: item.expiresAt,
      usageLimit: item.usageLimit,
      usageCount: item.usageCount,
    })),
  };
}

function passMemoryRows(memory, userId) {
  const rows = [];
  for (const row of memory.userEntitlements?.values?.() || []) {
    if (Number(row.telegram_id) === Number(userId)) rows.push(row);
  }
  return rows.sort((a, b) => String(b.expires_at || '').localeCompare(String(a.expires_at || '')));
}

export function createEntitlementService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  getUserRecord,
  markWebhookMutation = () => {},
}) {
  if (!memory.userEntitlements) memory.userEntitlements = new Map();

  async function listUserEntitlements(userId, cfg) {
    const uid = Number(userId);
    if (!Number.isSafeInteger(uid) || uid <= 0) return [];
    if (!hasSupabase(cfg)) return passMemoryRows(memory, uid);
    return await supaSelectMany(cfg, 'user_entitlements', { telegram_id: `eq.${uid}` }, {
      limit: 100,
      order: 'expires_at.desc',
    });
  }

  async function activatePassPurchase({
    telegramId,
    passType,
    fixtureId = 0,
    starsAmount,
    paymentChargeId,
    invoicePayload,
    paidAt,
  }, cfg) {
    const uid = Number(telegramId);
    const product = passProductConfig(passType, cfg);
    const fid = normalizedFixtureId(product?.key, fixtureId);
    const chargeId = String(paymentChargeId || '').trim();
    const payload = String(invoicePayload || '');
    const window = passEntitlementWindow(product?.key, paidAt, cfg);
    if (
      !Number.isSafeInteger(uid) || uid <= 0
      || !product || fid === null
      || Number(starsAmount) !== Number(product.stars)
      || !chargeId || chargeId.length > 240
      || !payload || payload.length > 512
      || !window
    ) return { activated: false, duplicate: false, reason: 'invalid_purchase' };

    markWebhookMutation(cfg, 'pass_entitlement');

    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'activate_pass_entitlement', {
        p_telegram_id: uid,
        p_entitlement_type: product.key,
        p_fixture_id: fid || null,
        p_starts_at: window.startsAt,
        p_expires_at: window.expiresAt,
        p_usage_limit: product.usageLimit,
        p_stars_amount: Number(product.stars),
        p_payment_charge_id: chargeId,
        p_invoice_payload: payload,
      }, 5000);
      return {
        activated: Boolean(result?.activated),
        duplicate: Boolean(result?.duplicate),
        reason: String(result?.reason || ''),
        entitlementId: Number(result?.entitlementId || 0) || null,
        startsAt: result?.startsAt || window.startsAt,
        expiresAt: result?.expiresAt || window.expiresAt,
      };
    }

    const existing = memory.userEntitlements.get(chargeId);
    if (existing) {
      const same = Number(existing.telegram_id) === uid
        && existing.entitlement_type === product.key
        && Number(existing.fixture_id || 0) === Number(fid || 0)
        && Number(existing.stars_amount) === Number(product.stars)
        && String(existing.invoice_payload || '') === payload;
      return { activated: false, duplicate: same, reason: same ? 'duplicate' : 'payment_charge_conflict', entitlementId: existing.id };
    }

    const row = {
      id: memory.userEntitlements.size + 1,
      telegram_id: uid,
      entitlement_type: product.key,
      fixture_id: fid || null,
      starts_at: window.startsAt,
      expires_at: window.expiresAt,
      usage_limit: product.usageLimit,
      usage_count: 0,
      stars_amount: Number(product.stars),
      payment_charge_id: chargeId,
      invoice_payload: payload,
      status: 'active',
      created_at: window.startsAt,
      updated_at: window.startsAt,
    };
    memory.userEntitlements.set(chargeId, row);
    return { activated: true, duplicate: false, reason: 'created', entitlementId: row.id, startsAt: row.starts_at, expiresAt: row.expires_at };
  }

  async function resolveUserEntitlements(userId, fixtureId, cfg, now = Date.now()) {
    const record = await getUserRecord(userId, cfg);
    let entitlements = [];
    let storeAvailable = true;
    try {
      entitlements = await listUserEntitlements(userId, cfg);
    } catch {
      // Fail closed for temporary Pass access without breaking the pre-existing
      // FREE / PRO / PREMIUM subscription path during migration or DB incidents.
      storeAvailable = false;
    }
    return {
      ...resolveEntitlementAccess({
        plan: record?.plan || 'FREE',
        subscriptionUntil: record?.subscription_until || null,
        entitlements,
        fixtureId,
        now,
      }),
      store: {
        available: storeAvailable,
        reason: storeAvailable ? '' : 'entitlement_store_unavailable',
      },
    };
  }

  async function consumeEntitlement(userId, entitlementId, fixtureId, cfg, usageOptions = {}) {
    const uid = Number(userId);
    const eid = Number(entitlementId);
    const fid = Number(fixtureId || 0);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(eid) || eid <= 0 || !Number.isSafeInteger(fid) || fid < 0) {
      return { allowed: false, reason: 'invalid_input' };
    }
    if (hasSupabase(cfg)) {
      const operationId = String(usageOptions?.operationId || '').trim();
      const extraHeaders = usageOptions?.durable === true && operationId
        ? durableAnalysisUsageHeaders(operationId)
        : {};
      return await supaRpc(cfg, 'consume_pass_entitlement', {
        p_telegram_id: uid,
        p_entitlement_id: eid,
        p_fixture_id: fid || null,
      }, 4000, extraHeaders);
    }
    const row = [...memory.userEntitlements.values()].find(item => Number(item.id) === eid && Number(item.telegram_id) === uid);
    const decision = entitlementDecision(row || {}, { fixtureId: fid, now: Date.now() });
    if (!decision.active) return { allowed: false, reason: decision.reason };
    if (row.usage_limit != null) row.usage_count = Number(row.usage_count || 0) + 1;
    row.updated_at = new Date().toISOString();
    return { allowed: true, reason: 'consumed', usageCount: Number(row.usage_count || 0), usageLimit: row.usage_limit };
  }

  async function refundEntitlementUsage(userId, entitlementId, cfg) {
    const uid = Number(userId);
    const eid = Number(entitlementId);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(eid) || eid <= 0) {
      return { updated: false, reason: 'invalid_input' };
    }
    if (hasSupabase(cfg)) {
      return await supaRpc(cfg, 'refund_pass_entitlement_usage', {
        p_telegram_id: uid,
        p_entitlement_id: eid,
      }, 4000);
    }
    const row = [...memory.userEntitlements.values()].find(item => Number(item.id) === eid && Number(item.telegram_id) === uid);
    if (!row) return { updated: false, reason: 'not_found' };
    if (row.usage_limit == null) return { updated: false, reason: 'not_limited' };
    row.usage_count = Math.max(0, Number(row.usage_count || 0) - 1);
    row.updated_at = new Date().toISOString();
    return { updated: true, reason: 'refunded', entitlementId: row.id, usageCount: row.usage_count };
  }

  async function reserveEntitlementUsage(userId, activeEntitlements, fixtureId, cfg, usageOptions = {}) {
    const candidates = (activeEntitlements || []).map(normalizeEntitlementRow);
    const unlimited = candidates.find(item => item.usageLimit == null);
    if (unlimited) {
      return {
        allowed: true,
        reserved: false,
        reason: 'unlimited',
        entitlementId: unlimited.id,
        type: unlimited.type,
      };
    }
    for (const item of candidates) {
      const consumed = await consumeEntitlement(userId, item.id, fixtureId, cfg, usageOptions);
      if (consumed?.allowed) {
        const reserved = item.usageLimit != null && consumed?.reserved !== false;
        const operationId = String(consumed?.operationId || '').trim();
        return {
          ...consumed,
          allowed: true,
          reserved,
          durable: reserved && consumed?.durable === true && Boolean(operationId),
          operationId: operationId || null,
          kind: 'pass',
          userId: uid,
          entitlementId: item.id,
          type: item.type,
        };
      }
    }
    return { allowed: false, reserved: false, reason: candidates.length ? 'usage_exhausted' : 'no_entitlement' };
  }

  async function refundPassByCharge(userId, paymentChargeId, cfg) {
    const uid = Number(userId);
    const chargeId = String(paymentChargeId || '').trim();
    if (!Number.isSafeInteger(uid) || uid <= 0 || !chargeId) return { updated: false, reason: 'invalid_input' };
    markWebhookMutation(cfg, 'pass_refund');
    if (hasSupabase(cfg)) {
      return await supaRpc(cfg, 'refund_pass_entitlement', {
        p_telegram_id: uid,
        p_payment_charge_id: chargeId,
      }, 4000);
    }
    const row = memory.userEntitlements.get(chargeId);
    if (!row || Number(row.telegram_id) !== uid) return { updated: false, reason: 'not_found' };
    row.status = 'refunded';
    row.updated_at = new Date().toISOString();
    return { updated: true, reason: 'refunded', entitlementId: row.id };
  }

  return {
    activatePassPurchase,
    consumeEntitlement,
    listUserEntitlements,
    refundEntitlementUsage,
    refundPassByCharge,
    reserveEntitlementUsage,
    resolveUserEntitlements,
  };
}
