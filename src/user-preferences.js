export const DEFAULT_PREFERENCES = Object.freeze({
  defaultFilter: 'top',
  reminderMinutes: 30,
  kickoffNotification: true,
  hideYouth: true,
  favoriteFirst: true,
});

export function createUserPreferencesService({
  memory,
  hasSupabase,
  supaSelectOne,
  supaUpsert,
}) {
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
      const row = await supaSelectOne(cfg, 'user_preferences', { telegram_id: `eq.${Number(userId)}` });
      return normalizePreferences(row || {});
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

  return {
    normalizePreferences,
    getPreferences,
    savePreferences,
  };
}
