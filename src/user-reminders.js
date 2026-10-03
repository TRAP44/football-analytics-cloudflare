import { PERSONAL_WRITE_LIMITS, normalizeReminderWrite } from './personal-write-guards.js';

const REMINDER_GRACE_MS = 10 * 60_000;
const REMINDER_RETENTION_MS = 90 * 24 * 60 * 60_000;

function positiveSafeInteger(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function personalDataError(message = 'Некорректные данные напоминания.') {
  const error = new Error(message);
  error.code = 'PERSONAL_DATA_INVALID';
  return error;
}

function reminderFixtureUnavailable(reason = 'not_cached') {
  const error = new Error('Матч не удалось подтвердить по серверным данным. Обновите список матчей и попробуйте ещё раз.');
  error.code = 'REMINDER_FIXTURE_UNAVAILABLE';
  error.reason = String(reason || 'not_cached');
  error.retryAfter = 30;
  return error;
}

function resetDeliveryState(row, { enabled = true } = {}) {
  return {
    ...row,
    enabled,
    notified_at: null,
    kickoff_notified_at: null,
    lineup_notified_at: null,
    important_change_notified_at: null,
    prematch_claimed_at: null,
    kickoff_claimed_at: null,
    lineup_claimed_at: null,
    important_change_claimed_at: null,
    prematch_attempts: 0,
    kickoff_attempts: 0,
    lineup_attempts: 0,
    important_change_attempts: 0,
    delivery_last_error: null,
    delivery_last_attempt_at: null,
    delivery_last_success_at: null,
    delivery_disabled_reason: null,
    delivery_retry_after: null,
  };
}

export function createUserRemindersService({
  memory,
  hasSupabase,
  supaSelectMany,
  supaRpc,
  fetchWithTimeout,
  supaHeaders,
  getPreferences,
  resolveCanonicalFixture,
}) {
  function requireUserId(userId) {
    const id = positiveSafeInteger(userId);
    if (!id) throw personalDataError('Некорректный пользователь.');
    return id;
  }

  function requireFixtureId(fixtureId) {
    const id = positiveSafeInteger(fixtureId);
    if (!id) throw personalDataError('Некорректный номер матча.');
    return id;
  }

  function pruneMemory(userId, nowMs = Date.now()) {
    const key = requireUserId(userId);
    const expiryCutoff = nowMs - REMINDER_GRACE_MS;
    const retentionCutoff = nowMs - REMINDER_RETENTION_MS;
    const source = memory.reminders.get(key) || [];
    const next = source
      .map(item => {
        const fixtureMs = Date.parse(item?.fixture_date || '');
        if (item?.enabled !== false && Number.isFinite(fixtureMs) && fixtureMs <= expiryCutoff) {
          return {
            ...item,
            enabled: false,
            delivery_disabled_reason: item.delivery_disabled_reason || 'expired',
          };
        }
        return item;
      })
      .filter(item => {
        if (item?.enabled !== false) return true;
        const fixtureMs = Date.parse(item?.fixture_date || '');
        return !Number.isFinite(fixtureMs) || fixtureMs >= retentionCutoff;
      });
    memory.reminders.set(key, next);
    return next;
  }

  async function canonicalFixture(input, cfg) {
    const fixtureId = requireFixtureId(input?.fixtureId);
    if (typeof resolveCanonicalFixture !== 'function') {
      // Local/test fallback has no shared trusted cache. Production persistence
      // canonicalizes independently inside save_match_reminder_guarded_v2.
      return { ...input, fixtureId };
    }

    const result = await resolveCanonicalFixture(fixtureId, cfg);
    if (!result?.available) {
      if (String(result?.reason || '') === 'fixture_started') {
        throw personalDataError('Матч уже начинается или начался.');
      }
      throw reminderFixtureUnavailable(result?.reason);
    }

    return {
      fixtureId: requireFixtureId(result.fixtureId ?? fixtureId),
      homeName: result.homeName,
      awayName: result.awayName,
      leagueName: result.leagueName,
      fixtureDate: result.fixtureDate,
    };
  }

  function reminderSettings(input, prefs) {
    const requested = Number(input?.reminderMinutes ?? prefs?.reminderMinutes);
    return {
      reminderMinutes: [15, 30, 60].includes(requested) ? requested : 30,
      kickoffNotify: input?.kickoffNotify === undefined
        ? Boolean(prefs?.kickoffNotification)
        : Boolean(input.kickoffNotify),
    };
  }

  async function getReminders(userId, cfg) {
    const uid = requireUserId(userId);
    const cutoff = new Date(Date.now() - REMINDER_GRACE_MS).toISOString();
    if (hasSupabase(cfg)) {
      await supaRpc(cfg, 'prune_match_reminders_for_user', {
        p_telegram_id: uid,
      }, 3000);
      return await supaSelectMany(
        cfg,
        'match_reminders',
        {
          telegram_id: `eq.${uid}`,
          enabled: 'eq.true',
          fixture_date: `gt.${cutoff}`,
        },
        { limit: 50, order: 'fixture_date.asc' },
      );
    }
    return pruneMemory(uid)
      .filter(item => item.enabled !== false && Date.parse(item.fixture_date || '') > Date.now() - REMINDER_GRACE_MS)
      .sort((a, b) => Date.parse(a.fixture_date || '') - Date.parse(b.fixture_date || ''))
      .slice(0, PERSONAL_WRITE_LIMITS.reminders);
  }

  async function addReminder(userId, input, cfg) {
    const uid = requireUserId(userId);
    const fixtureId = requireFixtureId(input?.fixtureId);
    const prefs = await getPreferences(uid, cfg);
    const settings = reminderSettings(input, prefs);
    const rearm = input?.rearm === true;

    if (hasSupabase(cfg)) {
      // The database RPC resolves canonical team/league/kickoff metadata from
      // trusted server-populated caches. Client-supplied identity fields are
      // deliberately not forwarded as authoritative values.
      const result = await supaRpc(cfg, 'save_match_reminder_guarded_v2', {
        p_telegram_id: uid,
        p_fixture_id: fixtureId,
        p_home_name: '',
        p_away_name: '',
        p_league_name: '',
        p_fixture_date: null,
        p_remind_before_minutes: settings.reminderMinutes,
        p_kickoff_notify: settings.kickoffNotify,
        p_rearm: rearm,
        p_limit: PERSONAL_WRITE_LIMITS.reminders,
      }, 4000);
      if (!result?.allowed) {
        const reason = String(result?.reason || 'rejected');
        if (reason === 'limit_reached') {
          const error = new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
          error.code = 'REMINDERS_LIMIT';
          throw error;
        }
        if (reason === 'fixture_started') {
          throw personalDataError('Матч уже начинается или начался.');
        }
        if (['fixture_unavailable','not_cached'].includes(reason)) {
          throw reminderFixtureUnavailable(reason);
        }
        throw personalDataError();
      }
      return result.item;
    }

    const canonical = await canonicalFixture({ ...input, fixtureId }, cfg);
    const normalized = normalizeReminderWrite({
      ...canonical,
      reminderMinutes: settings.reminderMinutes,
      kickoffNotify: settings.kickoffNotify,
    });
    const nowIso = new Date().toISOString();
    const row = resetDeliveryState({
      telegram_id: uid,
      fixture_id: normalized.fixtureId,
      home_name: normalized.homeName,
      away_name: normalized.awayName,
      league_name: normalized.leagueName,
      fixture_date: normalized.fixtureDate,
      remind_before_minutes: normalized.reminderMinutes,
      kickoff_notify: normalized.kickoffNotify,
      created_at: nowIso,
    });

    const key = uid;
    const list = pruneMemory(key);
    const existing = list.find(item => Number(item.fixture_id) === row.fixture_id) || null;
    const active = list.filter(item => item.enabled !== false && Date.parse(item.fixture_date || '') > Date.now() - REMINDER_GRACE_MS);

    if (!existing && active.length >= PERSONAL_WRITE_LIMITS.reminders) {
      const error = new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
      error.code = 'REMINDERS_LIMIT';
      throw error;
    }
    if (existing?.enabled === false && rearm && active.length >= PERSONAL_WRITE_LIMITS.reminders) {
      const error = new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
      error.code = 'REMINDERS_LIMIT';
      throw error;
    }

    let stored;
    if (!existing) {
      stored = row;
    } else if (rearm) {
      stored = resetDeliveryState({
        ...existing,
        home_name: row.home_name,
        away_name: row.away_name,
        league_name: row.league_name,
        fixture_date: row.fixture_date,
        remind_before_minutes: row.remind_before_minutes,
        kickoff_notify: row.kickoff_notify,
        created_at: existing.created_at || row.created_at,
      });
    } else {
      stored = {
        ...existing,
        home_name: row.home_name,
        away_name: row.away_name,
        league_name: row.league_name,
        fixture_date: row.fixture_date,
        remind_before_minutes: row.remind_before_minutes,
        kickoff_notify: row.kickoff_notify,
      };
    }

    const next = [stored, ...list.filter(item => Number(item.fixture_id) !== row.fixture_id)]
      .filter(item => {
        if (item.enabled !== false) return true;
        const fixtureMs = Date.parse(item.fixture_date || '');
        return !Number.isFinite(fixtureMs) || fixtureMs >= Date.now() - REMINDER_RETENTION_MS;
      });
    memory.reminders.set(key, next);
    return stored;
  }

  async function removeReminder(userId, fixtureId, cfg) {
    const uid = requireUserId(userId);
    const id = requireFixtureId(fixtureId);
    if (hasSupabase(cfg)) {
      const url = new URL(`${cfg.supabaseUrl}/rest/v1/match_reminders`);
      url.searchParams.set('telegram_id', `eq.${uid}`);
      url.searchParams.set('fixture_id', `eq.${id}`);
      const r = await fetchWithTimeout(url, { method: 'DELETE', headers: supaHeaders(cfg, { Prefer: 'return=minimal' }) }, 7000, 'Supabase reminders');
      if (!r.ok) throw new Error(`Supabase reminders: HTTP ${r.status}`);
      return;
    }
    const key = uid;
    memory.reminders.set(key, (memory.reminders.get(key) || []).filter(item => Number(item.fixture_id) !== id));
  }

  return {
    getReminders,
    addReminder,
    removeReminder,
  };
}
