import { PERSONAL_WRITE_LIMITS, normalizeReminderWrite } from './personal-write-guards.js';

export function createUserRemindersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
  getPreferences,
}) {
  async function getReminders(userId, cfg) {
    if (hasSupabase(cfg)) {
      return await supaSelectMany(cfg, 'match_reminders', { telegram_id: `eq.${Number(userId)}`, enabled: 'eq.true' }, { limit: 50, order: 'fixture_date.asc' });
    }
    return memory.reminders.get(Number(userId)) || [];
  }

  async function addReminder(userId, input, cfg) {
    const prefs = await getPreferences(userId, cfg);
    const normalized = normalizeReminderWrite({
      ...input,
      reminderMinutes: input.reminderMinutes ?? prefs.reminderMinutes,
      kickoffNotify: input.kickoffNotify === undefined ? Boolean(prefs.kickoffNotification) : Boolean(input.kickoffNotify),
    });
    const row = {
      telegram_id: Number(userId),
      fixture_id: normalized.fixtureId,
      home_name: normalized.homeName,
      away_name: normalized.awayName,
      league_name: normalized.leagueName,
      fixture_date: normalized.fixtureDate,
      enabled: true,
      remind_before_minutes: normalized.reminderMinutes,
      kickoff_notify: normalized.kickoffNotify,
      notified_at: null,
      kickoff_notified_at: null,
      prematch_claimed_at: null,
      kickoff_claimed_at: null,
      prematch_attempts: 0,
      kickoff_attempts: 0,
      delivery_last_error: null,
      delivery_last_attempt_at: null,
      delivery_last_success_at: null,
      delivery_disabled_reason: null,
      delivery_retry_after: null,
      created_at: new Date().toISOString(),
    };
    if (hasSupabase(cfg)) {
      const result = await supaRpc(cfg, 'save_match_reminder_guarded', {
        p_telegram_id: row.telegram_id,
        p_fixture_id: row.fixture_id,
        p_home_name: row.home_name,
        p_away_name: row.away_name,
        p_league_name: row.league_name,
        p_fixture_date: row.fixture_date,
        p_remind_before_minutes: row.remind_before_minutes,
        p_kickoff_notify: row.kickoff_notify,
        p_limit: PERSONAL_WRITE_LIMITS.reminders,
      }, 4000);
      if (!result?.allowed) {
        const reason = String(result?.reason || 'rejected');
        const error = new Error(reason === 'limit_reached'
          ? `Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`
          : reason === 'fixture_started'
            ? 'Матч уже начинается или начался.'
            : 'Некорректные данные напоминания.');
        error.code = reason === 'limit_reached' ? 'REMINDERS_LIMIT' : 'PERSONAL_DATA_INVALID';
        throw error;
      }
      return result.item || row;
    }
    const key = Number(userId);
    const list = memory.reminders.get(key) || [];
    const existing = list.some(x => Number(x.fixture_id) === row.fixture_id);
    const active = list.filter(x => x.enabled !== false && Date.parse(x.fixture_date || '') > Date.now() - 10 * 60_000);
    if (!existing && active.length >= PERSONAL_WRITE_LIMITS.reminders) {
      const error = new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
      error.code = 'REMINDERS_LIMIT';
      throw error;
    }
    memory.reminders.set(key, [row, ...list.filter(x => Number(x.fixture_id) !== row.fixture_id)].slice(0, PERSONAL_WRITE_LIMITS.reminders));
    return row;
  }

  async function removeReminder(userId, fixtureId, cfg) {
    const id = Number(fixtureId);
    if (hasSupabase(cfg)) {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
      url.searchParams.set('telegram_id', `eq.${Number(userId)}`);
      url.searchParams.set('fixture_id', `eq.${id}`);
      const r = await fetchWithTimeout(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) }, 7000, 'Supabase reminders');
      if (!r.ok) throw new Error(`Supabase reminders: HTTP ${r.status}`);
      return;
    }
    const key = Number(userId);
    memory.reminders.set(key, (memory.reminders.get(key) || []).filter(x => Number(x.fixture_id) !== id));
  }

  return {
    getReminders,
    addReminder,
    removeReminder,
  };
}
