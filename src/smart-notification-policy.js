import { PLAYER_FOLLOW_NOTIFICATION_CONTRACT } from './player-follow-contract.js';

export const SMART_NOTIFICATION_POLICY = Object.freeze({
  version: 1,
  marketThresholdPp: 5,
  aiProbabilityThresholdPp: 8,
  aiCooldownSeconds: 30 * 60,
  maxSignalAgeMinutes: 180,
  maxFixturesPerRun: 6,
});

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  match: true,
  teams: true,
  players: true,
  aiRadar: true,
});

const PAID_PLANS = new Set(['PRO', 'PREMIUM']);
const PLAYER_EVENTS = new Set(PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes);

function safeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeNotificationPreferences(value = {}) {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  return Object.freeze({
    enabled: safeBoolean(input.enabled, DEFAULT_NOTIFICATION_PREFERENCES.enabled),
    match: safeBoolean(input.match, DEFAULT_NOTIFICATION_PREFERENCES.match),
    teams: safeBoolean(input.teams, DEFAULT_NOTIFICATION_PREFERENCES.teams),
    players: safeBoolean(input.players, DEFAULT_NOTIFICATION_PREFERENCES.players),
    aiRadar: safeBoolean(input.aiRadar ?? input.ai_radar, DEFAULT_NOTIFICATION_PREFERENCES.aiRadar),
  });
}

export function effectiveNotificationPlan(user = {}, now = Date.now()) {
  const plan = String(user?.plan || 'FREE').toUpperCase();
  const normalized = PAID_PLANS.has(plan) ? plan : 'FREE';
  const expiresAt = Date.parse(user?.subscription_until || user?.subscriptionUntil || '');
  if (normalized !== 'FREE' && Number.isFinite(expiresAt) && expiresAt <= Number(now)) return 'FREE';
  return normalized;
}

export function notificationCategory(eventType = '') {
  const type = String(eventType || '');
  if (PLAYER_EVENTS.has(type) || type.startsWith('player.')) return 'players';
  if (type.startsWith('ai.') || type.startsWith('radar.') || type.startsWith('market.')) return 'aiRadar';
  if (type.startsWith('team.')) return 'teams';
  return 'match';
}

export function notificationRequiredPlan(eventType = '') {
  const type = String(eventType || '');
  if (PLAYER_EVENTS.has(type) || type.startsWith('player.') || type.startsWith('ai.') || type.startsWith('radar.') || type.startsWith('market.')) {
    return 'PRO';
  }
  return 'FREE';
}

export function notificationDecision({ eventType, plan = 'FREE', preferences = DEFAULT_NOTIFICATION_PREFERENCES } = {}) {
  const normalizedPreferences = normalizeNotificationPreferences(preferences);
  const normalizedPlan = PAID_PLANS.has(String(plan || '').toUpperCase()) ? String(plan).toUpperCase() : 'FREE';
  const category = notificationCategory(eventType);
  const requiredPlan = notificationRequiredPlan(eventType);

  if (!normalizedPreferences.enabled) {
    return { allowed: false, reason: 'preference_master_disabled', category, requiredPlan };
  }
  if (normalizedPreferences[category] === false) {
    return { allowed: false, reason: 'preference_category_disabled', category, requiredPlan };
  }
  if (requiredPlan !== 'FREE' && !PAID_PLANS.has(normalizedPlan)) {
    return { allowed: false, reason: 'entitlement_required', category, requiredPlan };
  }
  return { allowed: true, reason: 'allowed', category, requiredPlan };
}

export function publicSmartNotificationCapabilities(plan = 'FREE') {
  const normalizedPlan = PAID_PLANS.has(String(plan || '').toUpperCase()) ? String(plan).toUpperCase() : 'FREE';
  const paid = PAID_PLANS.has(normalizedPlan);
  return Object.freeze({
    policyVersion: SMART_NOTIFICATION_POLICY.version,
    plan: normalizedPlan,
    smartAlerts: paid,
    categories: Object.freeze({
      match: Object.freeze({ available: true, requiredPlan: 'FREE' }),
      teams: Object.freeze({ available: true, requiredPlan: 'FREE' }),
      players: Object.freeze({ available: paid, requiredPlan: 'PRO' }),
      aiRadar: Object.freeze({ available: paid, requiredPlan: 'PRO' }),
    }),
    thresholds: Object.freeze({
      marketPp: SMART_NOTIFICATION_POLICY.marketThresholdPp,
      aiProbabilityPp: SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
      aiCooldownMinutes: Math.round(SMART_NOTIFICATION_POLICY.aiCooldownSeconds / 60),
    }),
    playerContract: Object.freeze({
      version: PLAYER_FOLLOW_NOTIFICATION_CONTRACT.version,
      eventTypes: Object.freeze([...PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes]),
    }),
  });
}

export function smartNotificationDedupeKey({ fixtureId, eventType, eventKey, playerId = null } = {}) {
  const fixture = Number(fixtureId || 0);
  const type = String(eventType || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80);
  const key = String(eventKey || '').trim().toLowerCase().replace(/[^a-z0-9._:+-]+/g, '-').slice(0, 140);
  const player = Number(playerId || 0);
  if (!fixture || !type || !key) return '';
  return [`v1`, fixture, type, player > 0 ? `p${player}` : '', key].filter(Boolean).join(':').slice(0, 240);
}
