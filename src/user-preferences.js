import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from './smart-notification-policy.js';

export const DEFAULT_PREFERENCES = Object.freeze({
  defaultFilter: 'top',
  reminderMinutes: 30,
  kickoffNotification: true,
  hideYouth: true,
  favoriteFirst: true,
  notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES,
});

const ALLOWED_FILTERS = new Set(['top','favorites','all']);
const ALLOWED_REMINDER_MINUTES = new Set([15,30,60]);

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveUserId(value) {
  const number=integerCandidate(value);
  return number !== null && number>0 ? number : 0;
}

function strictBoolean(value, fallback) {
  return value === true || value === false ? value : fallback;
}

function normalizedFilter(value) {
  if (typeof value !== 'string') return DEFAULT_PREFERENCES.defaultFilter;
  const filter=value.trim();
  return ALLOWED_FILTERS.has(filter) ? filter : DEFAULT_PREFERENCES.defaultFilter;
}

function normalizedReminderMinutes(value) {
  const minutes=integerCandidate(value);
  return minutes !== null && ALLOWED_REMINDER_MINUTES.has(minutes)
    ? minutes
    : DEFAULT_PREFERENCES.reminderMinutes;
}

export function createUserPreferencesService({
  memory,
  hasSupabase,
  supaSelectOne,
  supaUpsert,
}) {
  const runtimeMemory=plainObject(memory) || {};
  if (!(runtimeMemory.preferences instanceof Map)) runtimeMemory.preferences=new Map();

  function supabaseEnabled(cfg) {
    try {
      return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function requireUserId(value) {
    const id=positiveUserId(value);
    if (id) return id;
    const error=new TypeError('Некорректный Telegram user ID для настроек.');
    error.code='PERSONAL_DATA_INVALID';
    throw error;
  }

  function normalizePreferences(row = {}) {
    const source=plainObject(row) || {};
    const rawFilter=source.default_filter ?? source.defaultFilter;
    const reminder=source.reminder_minutes ?? source.reminderMinutes;
    const kickoff=source.kickoff_notification ?? source.kickoffNotification;
    const hideYouth=source.hide_youth ?? source.hideYouth;
    const favoriteFirst=source.favorite_first ?? source.favoriteFirst;
    const notificationPreferences=source.notification_preferences
      ?? source.notificationPreferences
      ?? DEFAULT_PREFERENCES.notificationPreferences;

    return {
      defaultFilter:normalizedFilter(rawFilter ?? DEFAULT_PREFERENCES.defaultFilter),
      reminderMinutes:normalizedReminderMinutes(reminder ?? DEFAULT_PREFERENCES.reminderMinutes),
      kickoffNotification:strictBoolean(kickoff,DEFAULT_PREFERENCES.kickoffNotification),
      hideYouth:strictBoolean(hideYouth,DEFAULT_PREFERENCES.hideYouth),
      favoriteFirst:strictBoolean(favoriteFirst,DEFAULT_PREFERENCES.favoriteFirst),
      notificationPreferences:normalizeNotificationPreferences(notificationPreferences),
    };
  }

  async function getPreferences(userId, cfg) {
    const telegramId=requireUserId(userId);
    if (supabaseEnabled(cfg)) {
      if (typeof supaSelectOne !== 'function') {
        throw new TypeError('Supabase preferences read transport is unavailable.');
      }
      const row=await supaSelectOne(
        cfg,
        'user_preferences',
        {telegram_id:`eq.${telegramId}`},
      );
      if (row !== null && !plainObject(row)) {
        throw new Error('Supabase user_preferences: invalid response payload.');
      }
      return normalizePreferences(row || {});
    }
    return normalizePreferences(runtimeMemory.preferences.get(telegramId) || {});
  }

  async function savePreferences(userId, input, cfg) {
    const telegramId=requireUserId(userId);
    const source=plainObject(input) || {};
    const current=await getPreferences(telegramId,cfg);
    const next=normalizePreferences({
      defaultFilter:source.defaultFilter ?? current.defaultFilter,
      reminderMinutes:source.reminderMinutes ?? current.reminderMinutes,
      kickoffNotification:source.kickoffNotification ?? current.kickoffNotification,
      hideYouth:source.hideYouth ?? current.hideYouth,
      favoriteFirst:source.favoriteFirst ?? current.favoriteFirst,
      notificationPreferences:source.notificationPreferences
        ?? source.notification_preferences
        ?? current.notificationPreferences,
    });
    const row={
      telegram_id:telegramId,
      default_filter:next.defaultFilter,
      reminder_minutes:next.reminderMinutes,
      kickoff_notification:next.kickoffNotification,
      hide_youth:next.hideYouth,
      favorite_first:next.favoriteFirst,
      notification_preferences:next.notificationPreferences,
      updated_at:new Date().toISOString(),
    };

    if (supabaseEnabled(cfg)) {
      if (typeof supaUpsert !== 'function') {
        throw new TypeError('Supabase preferences write transport is unavailable.');
      }
      await supaUpsert(cfg,'user_preferences',row,'telegram_id');
    } else {
      runtimeMemory.preferences.set(telegramId,row);
    }
    return next;
  }

  return {
    normalizePreferences,
    getPreferences,
    savePreferences,
  };
}
