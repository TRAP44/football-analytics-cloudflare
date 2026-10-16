// Награда за приглашение (решение Сергея 12.10): новый друг, пришедший по
// ссылке-приглашению (атрибуция на /start — growth-referral.js), после первого
// успешного разбора получает +1 бонусный AI-разбор, пригласивший — тоже
// (не больше 10 наград за 30 дней). Бонус тратится только когда закончился
// дневной лимит и возвращается, если разбор не удался. Это не покупка: без
// звёзд и без записей в user_entitlements. Все проверки и подсчёт лимита —
// атомарно в базе (supabase_migration_v6_29_17.sql).

import { createSupabaseCallBatcher } from './supabase-call-batcher.js';
import { telegramBotStartUrl } from './telegram-primary-identity.js';

export const REFERRAL_MONTHLY_CAP = 10;
export const RESERVATION_TTL_MINUTES = 15;
const INVITE_START_PREFIX = 'ref__invite__profile__r';

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
  if (typeof value === 'boolean' || value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function count(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

/** Start-параметр приглашения: тот же формат кода, что в ссылках «Поделиться матчем». */
export function inviteStartParam(referralCode) {
  const code = typeof referralCode === 'string' ? referralCode.trim().toLowerCase() : '';
  return /^[a-f0-9]{16}$/.test(code) ? `${INVITE_START_PREFIX}${code}` : '';
}

export function createReferralRewardsRuntime(deps = {}) {
  const {
    ensureReferralCode,
    hasSupabase,
    json,
    memory,
    recordGrowthEvent,
    recordOpsEvent,
    supaPatch,
    supaRpc,
    supaSelectMany,
    telegramApi,
    telegramBotUsername,
  } = deps;
  for (const [name, fn] of Object.entries({ ensureReferralCode, hasSupabase, json, supaPatch, supaRpc, supaSelectMany, telegramBotUsername })) {
    if (typeof fn !== 'function') throw new TypeError(`Referral rewards runtime requires ${name}.`);
  }
  if (!memory || typeof memory !== 'object') throw new TypeError('Referral rewards runtime requires memory.');

  function storageReady(cfg) {
    try {
      return hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  // A fresh read only filters definite non-referrals. All grants and caps stay
  // in the existing atomic RPC; an unavailable/invalid read never skips it.
  const referralAttributions = createSupabaseCallBatcher(async (cfg, ids) => {
    const uniqueIds = [...new Set(ids)];
    const keys = uniqueIds.map(id => `referral_attribution:${id}`);
    const rows = await supaSelectMany(cfg, 'growth_events', {
      event_name: 'eq.referred_first_open',
      event_key: `in.(${keys.join(',')})`,
    }, { limit: keys.length, select: 'telegram_id,event_key' });
    if (!Array.isArray(rows)) throw new Error('Invalid referral attribution payload.');
    const found = new Set();
    for (const row of rows) {
      const id = positiveId(row?.telegram_id);
      if (!uniqueIds.includes(id) || row?.event_key !== `referral_attribution:${id}` || found.has(id)) {
        throw new Error('Unexpected referral attribution row.');
      }
      found.add(id);
    }
    return ids.map(id => found.has(id));
  });

  async function definitelyNotReferred(id, cfg) {
    if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl || typeof cfg?.supabaseKey !== 'string' || !cfg.supabaseKey) return false;
    try { return await referralAttributions(cfg, id) === false; }
    catch { return false; }
  }

  async function notifyReferrer(referrerId, cfg) {
    if (typeof telegramApi !== 'function' || !positiveId(referrerId)) return;
    try {
      await telegramApi('sendMessage', cfg, {
        chat_id: referrerId,
        text: '🎁 Ваш друг пришёл по приглашению и открыл первый AI-разбор.\nВам начислен +1 бонусный разбор — он пригодится, когда закончится дневной лимит.',
      });
    } catch {}
  }

  /**
   * После успешного разбора: начислить награды, если пользователь — новый
   * приглашённый. Одна проверка на пользователя в изоляте; повтор безопасен.
   */
  async function grantReferralRewards(userId, cfg) {
    const id = positiveId(userId);
    if (!id || !storageReady(cfg)) return { granted: false, reason: 'unavailable' };
    if (!(memory.referralRewardChecked instanceof Set)) memory.referralRewardChecked = new Set();
    if (memory.referralRewardChecked.has(id)) return { granted: false, reason: 'already_checked' };
    if (memory.referralRewardChecked.size > 5000) memory.referralRewardChecked.clear();
    memory.referralRewardChecked.add(id);
    if (await definitelyNotReferred(id, cfg)) return { granted: false, reason: 'not_referred' };
    let result;
    try {
      result = plainObject(await supaRpc(cfg, 'grant_referral_rewards', { p_referred_telegram_id: id, p_monthly_cap: REFERRAL_MONTHLY_CAP }));
    } catch (error) {
      // Сбой сети — попробуем при следующем разборе.
      memory.referralRewardChecked.delete(id);
      if (typeof recordOpsEvent === 'function') {
        await recordOpsEvent(cfg, {
          severity: 'warning',
          source: 'growth',
          eventType: 'referral_reward',
          code: 'REFERRAL_REWARD_GRANT_FAILED',
          message: String(error?.message || error).slice(0, 160),
          meta: {},
        }).catch(() => null);
      }
      return { granted: false, reason: 'rpc_failed' };
    }
    if (safeRead(result, 'granted') !== true) return { granted: false, reason: String(safeRead(result, 'reason') || 'not_granted').slice(0, 40) };
    const referrerId = positiveId(safeRead(result, 'referrerId'));
    const referrerGranted = safeRead(result, 'referrerGranted') === true;
    if (typeof recordGrowthEvent === 'function') {
      await Promise.resolve(recordGrowthEvent(cfg, {
        userId: id,
        eventName: 'referral_reward_granted',
        channel: 'system',
        metadata: { referrer_rewarded: referrerGranted },
        eventKey: `referral_reward:${id}`,
      })).catch(() => null);
    }
    if (referrerGranted) await notifyReferrer(referrerId, cfg);
    return { granted: true, referrerGranted };
  }

  async function reportOps(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return;
    await Promise.resolve()
      .then(() => recordOpsEvent(cfg, { source: 'quota', eventType: 'referral_bonus_reservation', ...event }))
      .catch(() => null);
  }

  // Резерв бонуса = status used + operation_id. После успешного разбора
  // operation_id очищается (commit). Незакоммиченный резерв старше
  // RESERVATION_TTL_MINUTES возвращается: так бонус не теряется ни при
  // потерянном ответе базы, ни при сбое возврата, ни при падении воркера.
  async function releaseStaleReservations(id, cfg) {
    const before = new Date(Date.now() - RESERVATION_TTL_MINUTES * 60_000).toISOString();
    try {
      await supaPatch(cfg, 'referral_rewards', {
        telegram_id: `eq.${id}`,
        status: 'eq.used',
        operation_id: 'not.is.null',
        used_at: `lt.${before}`,
      }, { status: 'available', used_at: null, operation_id: null });
    } catch {
      // Не мешает разбору: вернётся при следующей попытке.
    }
  }

  /** Бонусный разбор, когда дневной лимит исчерпан. */
  async function reserveReferralBonus(userId, cfg) {
    const id = positiveId(userId);
    if (!id || !storageReady(cfg)) return { reserved: false, allowed: false, kind: 'bonus', reason: 'unavailable' };
    await releaseStaleReservations(id, cfg);
    const operationId = crypto.randomUUID();
    let result;
    try {
      result = plainObject(await supaRpc(cfg, 'reserve_referral_bonus', { p_telegram_id: id, p_operation_id: operationId }));
    } catch (error) {
      // Ответ потерян: если резерв зафиксировался, он не закоммичен и вернётся
      // сам через RESERVATION_TTL_MINUTES (releaseStaleReservations).
      await reportOps(cfg, {
        severity: 'warning',
        code: 'REFERRAL_BONUS_RESERVATION_OUTCOME_UNKNOWN',
        message: 'Referral bonus reservation response was lost; an uncommitted reservation is released automatically after the TTL.',
        meta: { operationId, ttlMinutes: RESERVATION_TTL_MINUTES, error: String(error?.message || error || 'unknown_error').slice(0, 180) },
      });
      return { reserved: false, allowed: false, kind: 'bonus', rewardId: null, operationId: null, remaining: 0, reason: 'rpc_failed' };
    }
    const rewardId = positiveId(safeRead(result, 'rewardId'));
    const allowed = safeRead(result, 'allowed') === true && rewardId > 0;
    return {
      reserved: allowed,
      allowed,
      kind: 'bonus',
      rewardId: allowed ? rewardId : null,
      operationId: allowed ? operationId : null,
      remaining: count(safeRead(result, 'remaining')),
      reason: String(safeRead(result, 'reason') || '').slice(0, 40),
    };
  }

  /** Есть ли неиспользованный бонус (дешёвая проверка до резерва). */
  async function hasReferralBonus(userId, cfg) {
    const id = positiveId(userId);
    if (!id || !storageReady(cfg)) return false;
    await releaseStaleReservations(id, cfg);
    const rows = await supaSelectMany(cfg, 'referral_rewards', { telegram_id: `eq.${id}`, status: 'eq.available' }, { limit: 1, select: 'id' });
    return Array.isArray(rows) && rows.length > 0;
  }

  /** Разбор выдан — бонус потрачен окончательно. */
  async function commitReferralBonus(userId, reservation, cfg) {
    const id = positiveId(userId);
    const rewardId = positiveId(safeRead(reservation, 'rewardId'));
    const operationId = String(safeRead(reservation, 'operationId') || '');
    if (!id || !rewardId || !operationId) return { committed: false, reason: 'invalid_input' };
    await supaPatch(cfg, 'referral_rewards', {
      id: `eq.${rewardId}`,
      telegram_id: `eq.${id}`,
      status: 'eq.used',
      operation_id: `eq.${operationId}`,
    }, { operation_id: null });
    return { committed: true };
  }

  async function refundReferralBonus(userId, reservation, cfg) {
    const id = positiveId(userId);
    const rewardId = positiveId(safeRead(reservation, 'rewardId'));
    const operationId = String(safeRead(reservation, 'operationId') || '');
    if (!id || !rewardId || !operationId) return { refunded: false, reason: 'invalid_input' };
    const result = plainObject(await supaRpc(cfg, 'refund_referral_bonus', { p_telegram_id: id, p_reward_id: rewardId, p_operation_id: operationId }));
    return { refunded: safeRead(result, 'refunded') === true, reason: String(safeRead(result, 'reason') || '').slice(0, 40) };
  }

  async function referralSummary(userId, cfg) {
    const id = positiveId(userId);
    if (!id || !storageReady(cfg)) return { bonusAvailable: 0, invitedThisMonth: 0 };
    await releaseStaleReservations(id, cfg);
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [available, invited] = await Promise.all([
      supaSelectMany(cfg, 'referral_rewards', { telegram_id: `eq.${id}`, status: 'eq.available' }, { limit: 200, select: 'id' }),
      supaSelectMany(cfg, 'referral_rewards', { telegram_id: `eq.${id}`, role: 'eq.referrer', granted_at: `gte.${since}` }, { limit: REFERRAL_MONTHLY_CAP + 1, select: 'id' }),
    ]);
    return {
      bonusAvailable: Array.isArray(available) ? available.length : 0,
      invitedThisMonth: Math.min(REFERRAL_MONTHLY_CAP, Array.isArray(invited) ? invited.length : 0),
    };
  }

  // GET /api/referral — ссылка-приглашение и бонусы пользователя.
  async function apiReferral(request, cfg, user) {
    const userId = positiveId(safeRead(user, 'id'));
    if (!userId) return json({ error: 'Сессия Telegram не подтверждена.', code: 'AUTH_REQUIRED' }, 401);
    if (!storageReady(cfg)) return json({ available: false, reason: 'storage_unavailable' });
    try {
      const code = await ensureReferralCode(userId, cfg);
      const startParam = inviteStartParam(code);
      if (!startParam) return json({ available: false, reason: 'code_unavailable' });
      const username = await telegramBotUsername(cfg);
      const url = telegramBotStartUrl(username, startParam);
      const summary = await referralSummary(userId, cfg);
      return json({
        available: true,
        url,
        bonusAvailable: summary.bonusAvailable,
        invitedThisMonth: summary.invitedThisMonth,
        monthlyCap: REFERRAL_MONTHLY_CAP,
      });
    } catch {
      return json({ available: false, reason: 'temporarily_unavailable' }, 503);
    }
  }

  return Object.freeze({ apiReferral, commitReferralBonus, grantReferralRewards, hasReferralBonus, reserveReferralBonus, refundReferralBonus, referralSummary });
}
