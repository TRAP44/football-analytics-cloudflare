import { PLAYER_FOLLOW_NOTIFICATION_CONTRACT } from './player-follow-contract.js';

export const SMART_NOTIFICATION_POLICY = Object.freeze({
  version: 1,
  marketThresholdPp: 5,
  aiProbabilityThresholdPp: 8,
  aiCooldownSeconds: 30 * 60,
  radarConfidenceThreshold: 75,
  radarOutcomeThreshold: 55,
  radarCooldownSeconds: 60 * 60,
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

const PAID_PLANS = new Set(['PRO','PREMIUM']);
const PLAYER_EVENTS = new Set(PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes);
const EVENT_TYPE_RE = /^(?:match|team|player|ai|radar|market)\.[a-z0-9][a-z0-9_.-]{0,78}$/;
const MAX_EVENT_KEY_LENGTH = 512;
const MAX_TIMESTAMP_MS = 8.64e15;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeBoolean(value,fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const valueNumber=integerCandidate(value);
  return valueNumber !== null && valueNumber > 0 ? valueNumber : 0;
}

function normalizePlan(value) {
  if (typeof value !== 'string') return 'FREE';
  const plan=value.trim().toUpperCase();
  return PAID_PLANS.has(plan) ? plan : 'FREE';
}

function normalizeNow(value) {
  if (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_TIMESTAMP_MS
  ) return value;
  return Date.now();
}

function inspectSubscriptionUntil(user) {
  const source=plainObject(user);
  if (!source) return {present:false,valid:true,timestamp:null};

  const hasSnake=Object.hasOwn(source,'subscription_until');
  const hasCamel=Object.hasOwn(source,'subscriptionUntil');
  if (!hasSnake && !hasCamel) return {present:false,valid:true,timestamp:null};

  const value=hasSnake ? source.subscription_until : source.subscriptionUntil;
  if (value === null || value === undefined || value === '') {
    return {present:true,valid:true,timestamp:null};
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {present:true,valid:false,timestamp:null};
  }
  const timestamp=Date.parse(value.trim());
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP_MS) {
    return {present:true,valid:false,timestamp:null};
  }
  return {present:true,valid:true,timestamp};
}

function normalizeEventType(value) {
  if (typeof value !== 'string') return '';
  const type=value.trim().toLowerCase();
  return EVENT_TYPE_RE.test(type) ? type : '';
}

function eventKeyHash(value) {
  let hash=14695981039346656037n;
  for (const byte of new TextEncoder().encode(value)) {
    hash^=BigInt(byte);
    hash=(hash*1099511628211n)&0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16,'0');
}

function normalizeEventKey(value) {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  if (
    !raw
    || raw.length > MAX_EVENT_KEY_LENGTH
    || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)
  ) return '';
  const prefix=raw
    .toLowerCase()
    .replace(/[^a-z0-9._:+-]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,96);
  return `${prefix || 'event'}-${eventKeyHash(raw)}`;
}

function clonePreferences(input) {
  return {
    enabled:safeBoolean(input.enabled,DEFAULT_NOTIFICATION_PREFERENCES.enabled),
    match:safeBoolean(input.match,DEFAULT_NOTIFICATION_PREFERENCES.match),
    teams:safeBoolean(input.teams,DEFAULT_NOTIFICATION_PREFERENCES.teams),
    players:safeBoolean(input.players,DEFAULT_NOTIFICATION_PREFERENCES.players),
    aiRadar:safeBoolean(
      input.aiRadar ?? input.ai_radar,
      DEFAULT_NOTIFICATION_PREFERENCES.aiRadar,
    ),
  };
}

export function normalizeNotificationPreferences(value = {}) {
  let input=value;
  if (typeof input === 'string') {
    try {
      const parsed=JSON.parse(input);
      input=plainObject(parsed) || {};
    } catch {
      input={};
    }
  }
  input=plainObject(input) || {};
  return Object.freeze(clonePreferences(input));
}

export function effectiveNotificationPlan(user = {},now=Date.now()) {
  const source=plainObject(user) || {};
  const plan=normalizePlan(source.plan);
  if (plan === 'FREE') return 'FREE';

  const subscription=inspectSubscriptionUntil(source);
  if (!subscription.valid) return 'FREE';
  if (subscription.timestamp !== null && subscription.timestamp <= normalizeNow(now)) return 'FREE';
  return plan;
}

export function notificationCategory(eventType='') {
  const type=normalizeEventType(eventType);
  if (!type) return '';
  if (PLAYER_EVENTS.has(type) || type.startsWith('player.')) return 'players';
  if (type.startsWith('ai.') || type.startsWith('radar.') || type.startsWith('market.')) return 'aiRadar';
  if (type.startsWith('team.')) return 'teams';
  if (type.startsWith('match.')) return 'match';
  return '';
}

export function notificationRequiredPlan(eventType='') {
  const type=normalizeEventType(eventType);
  if (!type) return '';
  if (
    PLAYER_EVENTS.has(type)
    || type.startsWith('player.')
    || type.startsWith('ai.')
    || type.startsWith('radar.')
    || type.startsWith('market.')
  ) return 'PRO';
  if (type.startsWith('match.') || type.startsWith('team.')) return 'FREE';
  return '';
}

export function notificationDecision({
  eventType,
  plan='FREE',
  preferences=DEFAULT_NOTIFICATION_PREFERENCES,
} = {}) {
  const category=notificationCategory(eventType);
  const requiredPlan=notificationRequiredPlan(eventType);
  if (!category || !requiredPlan) {
    return {allowed:false,reason:'invalid_event',category:'',requiredPlan:''};
  }

  const normalizedPreferences=normalizeNotificationPreferences(preferences);
  const normalizedPlan=normalizePlan(plan);

  if (!normalizedPreferences.enabled) {
    return {allowed:false,reason:'preference_master_disabled',category,requiredPlan};
  }
  if (normalizedPreferences[category] === false) {
    return {allowed:false,reason:'preference_category_disabled',category,requiredPlan};
  }
  if (requiredPlan !== 'FREE' && !PAID_PLANS.has(normalizedPlan)) {
    return {allowed:false,reason:'entitlement_required',category,requiredPlan};
  }
  return {allowed:true,reason:'allowed',category,requiredPlan};
}

export function publicSmartNotificationCapabilities(plan='FREE') {
  const normalizedPlan=normalizePlan(plan);
  const paid=PAID_PLANS.has(normalizedPlan);
  return Object.freeze({
    policyVersion:SMART_NOTIFICATION_POLICY.version,
    plan:normalizedPlan,
    smartAlerts:paid,
    categories:Object.freeze({
      match:Object.freeze({available:true,requiredPlan:'FREE'}),
      teams:Object.freeze({available:true,requiredPlan:'FREE'}),
      players:Object.freeze({available:paid,requiredPlan:'PRO'}),
      aiRadar:Object.freeze({available:paid,requiredPlan:'PRO'}),
    }),
    thresholds:Object.freeze({
      marketPp:SMART_NOTIFICATION_POLICY.marketThresholdPp,
      aiProbabilityPp:SMART_NOTIFICATION_POLICY.aiProbabilityThresholdPp,
      aiCooldownMinutes:Math.round(SMART_NOTIFICATION_POLICY.aiCooldownSeconds/60),
      radarConfidence:SMART_NOTIFICATION_POLICY.radarConfidenceThreshold,
      radarOutcomeProbability:SMART_NOTIFICATION_POLICY.radarOutcomeThreshold,
      radarCooldownMinutes:Math.round(SMART_NOTIFICATION_POLICY.radarCooldownSeconds/60),
    }),
    playerContract:Object.freeze({
      version:PLAYER_FOLLOW_NOTIFICATION_CONTRACT.version,
      eventTypes:Object.freeze([...PLAYER_FOLLOW_NOTIFICATION_CONTRACT.eventTypes]),
    }),
  });
}

export function smartNotificationDedupeKey({
  fixtureId,
  eventType,
  eventKey,
  playerId=null,
} = {}) {
  const fixture=positiveSafeInteger(fixtureId);
  const type=normalizeEventType(eventType);
  const key=normalizeEventKey(eventKey);
  const player=playerId === null || playerId === undefined || playerId === ''
    ? 0
    : positiveSafeInteger(playerId);

  if (!fixture || !type || !key) return '';
  if (
    (type.startsWith('player.') && !player)
    || (!type.startsWith('player.') && playerId !== null && playerId !== undefined && playerId !== '' && !player)
  ) return '';

  const parts=['v1',String(fixture),type];
  if (player) parts.push(`p${player}`);
  parts.push(key);
  const output=parts.join(':');
  return output.length <= 240 ? output : '';
}
