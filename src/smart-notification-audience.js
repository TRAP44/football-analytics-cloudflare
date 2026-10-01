import {
  effectiveNotificationPlan,
  notificationDecision,
} from './smart-notification-policy.js';

function positiveUserIds(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map(row => Number(row?.telegram_id || row?.telegramId || 0))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}

function chunks(values, size = 200) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

export function createSmartNotificationAudience({
  hasSupabase,
  supaSelectMany,
  getPreferences,
  getUserRecord,
  getFavoritePlayers,
} = {}) {
  async function loadRowsByUserIds(table, userIds, cfg, limitMultiplier = 1) {
    const ids = positiveUserIds(userIds.map(telegram_id => ({ telegram_id })));
    if (!ids.length) return [];
    const output = [];
    for (const batch of chunks(ids, 200)) {
      const rows = await supaSelectMany(
        cfg,
        table,
        { telegram_id: `in.(${batch.join(',')})` },
        { limit: Math.max(batch.length * limitMultiplier, batch.length) },
      );
      if (Array.isArray(rows)) output.push(...rows);
    }
    return output;
  }

  async function loadContexts(rows, cfg) {
    const userIds = positiveUserIds(rows);
    const users = new Map();
    const preferences = new Map();

    if (!userIds.length) return { users, preferences };

    if (hasSupabase?.(cfg)) {
      const [userRows, preferenceRows] = await Promise.all([
        loadRowsByUserIds('users', userIds, cfg, 1),
        loadRowsByUserIds('user_preferences', userIds, cfg, 1),
      ]);
      for (const row of userRows) users.set(Number(row.telegram_id), row);
      for (const row of preferenceRows) preferences.set(Number(row.telegram_id), row);
      return { users, preferences };
    }

    await Promise.all(userIds.map(async userId => {
      const [user, prefs] = await Promise.all([
        getUserRecord?.(userId, cfg),
        getPreferences?.(userId, cfg),
      ]);
      if (user) users.set(userId, user);
      if (prefs) preferences.set(userId, prefs);
    }));
    return { users, preferences };
  }

  async function filterRecipients(rows = [], eventType, cfg) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const { users, preferences } = await loadContexts(sourceRows, cfg);
    const eligible = [];
    let blockedByPreference = 0;
    let blockedByEntitlement = 0;

    for (const row of sourceRows) {
      const userId = Number(row?.telegram_id || 0);
      const user = users.get(userId) || { plan: 'FREE' };
      const prefs = preferences.get(userId) || {};
      const decision = notificationDecision({
        eventType,
        plan: effectiveNotificationPlan(user),
        preferences: prefs?.notificationPreferences ?? prefs?.notification_preferences ?? {},
      });
      if (decision.allowed) eligible.push(row);
      else if (decision.reason === 'entitlement_required') blockedByEntitlement += 1;
      else blockedByPreference += 1;
    }

    return {
      rows: eligible,
      checked: sourceRows.length,
      blockedByPreference,
      blockedByEntitlement,
    };
  }

  async function loadFavoritePlayersByUser(rows = [], cfg) {
    const userIds = positiveUserIds(rows);
    const byUser = new Map(userIds.map(id => [id, []]));
    if (!userIds.length) return byUser;

    if (hasSupabase?.(cfg)) {
      const favorites = await loadRowsByUserIds('favorite_players', userIds, cfg, 50);
      for (const favorite of favorites) {
        const userId = Number(favorite?.telegram_id || 0);
        const list = byUser.get(userId) || [];
        list.push(favorite);
        byUser.set(userId, list);
      }
      return byUser;
    }

    await Promise.all(userIds.map(async userId => {
      const favorites = await getFavoritePlayers?.(userId, cfg);
      byUser.set(userId, Array.isArray(favorites) ? favorites : []);
    }));
    return byUser;
  }

  return Object.freeze({
    filterRecipients,
    loadFavoritePlayersByUser,
  });
}
