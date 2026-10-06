import { PERSONAL_WRITE_LIMITS, normalizeReminderWrite } from './personal-write-guards.js';

const REMINDER_GRACE_MS = 10 * 60_000;
const REMINDER_RETENTION_MS = 90 * 24 * 60 * 60_000;

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const number=integerCandidate(value);
  return number !== null && number>0 ? number : 0;
}

function personalDataError(message = 'Некорректные данные напоминания.') {
  const error=new Error(message);
  error.code='PERSONAL_DATA_INVALID';
  return error;
}

function reminderFixtureUnavailable(reason = 'not_cached') {
  const error=new Error('Матч не удалось подтвердить по серверным данным. Обновите список матчей и попробуйте ещё раз.');
  error.code='REMINDER_FIXTURE_UNAVAILABLE';
  error.reason=textValue(reason) || 'not_cached';
  error.retryAfter=30;
  return error;
}

function resetDeliveryState(row, { enabled = true } = {}) {
  const source=plainObject(row) || {};
  return {
    ...source,
    enabled:enabled === true,
    notified_at:null,
    kickoff_notified_at:null,
    lineup_notified_at:null,
    important_change_notified_at:null,
    prematch_claimed_at:null,
    kickoff_claimed_at:null,
    lineup_claimed_at:null,
    important_change_claimed_at:null,
    prematch_attempts:0,
    kickoff_attempts:0,
    lineup_attempts:0,
    important_change_attempts:0,
    delivery_last_error:null,
    delivery_last_attempt_at:null,
    delivery_last_success_at:null,
    delivery_disabled_reason:null,
    delivery_retry_after:null,
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
  const runtimeMemory=plainObject(memory) || {};
  if (!(runtimeMemory.reminders instanceof Map)) runtimeMemory.reminders=new Map();

  function supabaseEnabled(cfg) {
    try {
      return typeof hasSupabase === 'function' && hasSupabase(cfg) === true;
    } catch {
      return false;
    }
  }

  function requireUserId(userId) {
    const id=positiveSafeInteger(userId);
    if (!id) throw personalDataError('Некорректный пользователь.');
    return id;
  }

  function requireFixtureId(fixtureId) {
    const id=positiveSafeInteger(fixtureId);
    if (!id) throw personalDataError('Некорректный номер матча.');
    return id;
  }

  function fixtureTimestamp(row) {
    const source=plainObject(row);
    const raw=textValue(source?.fixture_date);
    if (!raw) return null;
    const timestamp=Date.parse(raw);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function reminderList(value) {
    return Array.isArray(value) ? value.filter(item=>plainObject(item)) : [];
  }

  function storedFixtureId(row) {
    const id=positiveSafeInteger(plainObject(row)?.fixture_id);
    return id || 0;
  }

  function remindersUrl(cfg) {
    const raw=textValue(plainObject(cfg)?.supabaseUrl);
    if (!raw) throw new TypeError('Supabase reminders: invalid configuration.');

    let base;
    try {
      base=new URL(raw);
    } catch {
      throw new TypeError('Supabase reminders: invalid configuration.');
    }
    if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new TypeError('Supabase reminders: invalid configuration.');
    }
    base.pathname=`${base.pathname.replace(/\/+$/g,'')}/`;
    return new URL('rest/v1/match_reminders',base);
  }

  function pruneMemory(userId, nowMs = Date.now()) {
    const key=requireUserId(userId);
    const now=typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
    const expiryCutoff=now-REMINDER_GRACE_MS;
    const retentionCutoff=now-REMINDER_RETENTION_MS;
    const source=reminderList(runtimeMemory.reminders.get(key));
    const next=source
      .map(item=>{
        const fixtureMs=fixtureTimestamp(item);
        if (item.enabled !== false && fixtureMs !== null && fixtureMs<=expiryCutoff) {
          return {
            ...item,
            enabled:false,
            delivery_disabled_reason:textValue(item.delivery_disabled_reason) || 'expired',
          };
        }
        return item;
      })
      .filter(item=>{
        if (item.enabled !== false) return true;
        const fixtureMs=fixtureTimestamp(item);
        return fixtureMs === null || fixtureMs>=retentionCutoff;
      });
    runtimeMemory.reminders.set(key,next);
    return next;
  }

  async function canonicalFixture(input, cfg) {
    const source=plainObject(input) || {};
    const fixtureId=requireFixtureId(source.fixtureId);
    if (typeof resolveCanonicalFixture !== 'function') {
      // Local/test fallback has no shared trusted cache. Production persistence
      // canonicalizes independently inside save_match_reminder_guarded_v2.
      return { ...source, fixtureId };
    }

    const rawResult=await resolveCanonicalFixture(fixtureId,cfg);
    const result=plainObject(rawResult);
    if (result?.available !== true) {
      const reason=textValue(result?.reason);
      if (reason === 'fixture_started') {
        throw personalDataError('Матч уже начинается или начался.');
      }
      throw reminderFixtureUnavailable(reason);
    }

    return {
      fixtureId:requireFixtureId(result.fixtureId ?? fixtureId),
      homeName:result.homeName,
      awayName:result.awayName,
      leagueName:result.leagueName,
      fixtureDate:result.fixtureDate,
    };
  }

  function reminderSettings(input, prefs) {
    const source=plainObject(input) || {};
    const preferences=plainObject(prefs) || {};
    const requested=integerCandidate(source.reminderMinutes ?? preferences.reminderMinutes);
    const reminderMinutes=[15,30,60].includes(requested) ? requested : 30;

    let kickoffNotify;
    if (source.kickoffNotify === undefined) {
      kickoffNotify=preferences.kickoffNotification === false ? false : true;
    } else if (source.kickoffNotify === true || source.kickoffNotify === false) {
      kickoffNotify=source.kickoffNotify;
    } else {
      throw personalDataError('Настройка уведомления о начале матча имеет некорректный формат.');
    }

    return {reminderMinutes,kickoffNotify};
  }

  async function getReminders(userId, cfg) {
    const uid=requireUserId(userId);
    const cutoff=new Date(Date.now()-REMINDER_GRACE_MS).toISOString();
    if (supabaseEnabled(cfg)) {
      if (typeof supaRpc !== 'function' || typeof supaSelectMany !== 'function') {
        throw new TypeError('Supabase reminders transport is unavailable.');
      }
      await supaRpc(cfg,'prune_match_reminders_for_user',{
        p_telegram_id:uid,
      },3000);
      const rows=await supaSelectMany(
        cfg,
        'match_reminders',
        {
          telegram_id:`eq.${uid}`,
          enabled:'eq.true',
          fixture_date:`gt.${cutoff}`,
        },
        {limit:PERSONAL_WRITE_LIMITS.reminders,order:'fixture_date.asc'},
      );
      if (!Array.isArray(rows)) throw new Error('Supabase reminders: invalid response payload.');
      return rows.filter(item=>plainObject(item));
    }

    const now=Date.now();
    return pruneMemory(uid,now)
      .filter(item=>{
        const fixtureMs=fixtureTimestamp(item);
        return item.enabled !== false && fixtureMs !== null && fixtureMs>now-REMINDER_GRACE_MS;
      })
      .sort((a,b)=>(fixtureTimestamp(a) ?? Number.MAX_SAFE_INTEGER)-(fixtureTimestamp(b) ?? Number.MAX_SAFE_INTEGER))
      .slice(0,PERSONAL_WRITE_LIMITS.reminders);
  }

  async function addReminder(userId, input, cfg) {
    const uid=requireUserId(userId);
    const source=plainObject(input) || {};
    const fixtureId=requireFixtureId(source.fixtureId);
    if (typeof getPreferences !== 'function') {
      throw new TypeError('Reminder preferences transport is unavailable.');
    }
    const prefs=await getPreferences(uid,cfg);
    const settings=reminderSettings(source,prefs);
    const rearm=source.rearm === true;

    if (supabaseEnabled(cfg)) {
      if (typeof supaRpc !== 'function') throw new TypeError('Supabase reminders RPC transport is unavailable.');
      // The database RPC resolves canonical team/league/kickoff metadata from
      // trusted server-populated caches. Client-supplied identity fields are
      // deliberately not forwarded as authoritative values.
      const rawResult=await supaRpc(cfg,'save_match_reminder_guarded_v2',{
        p_telegram_id:uid,
        p_fixture_id:fixtureId,
        p_home_name:'',
        p_away_name:'',
        p_league_name:'',
        p_fixture_date:null,
        p_remind_before_minutes:settings.reminderMinutes,
        p_kickoff_notify:settings.kickoffNotify,
        p_rearm:rearm,
        p_limit:PERSONAL_WRITE_LIMITS.reminders,
      },4000);
      const result=plainObject(rawResult);
      if (result?.allowed !== true) {
        const reason=textValue(result?.reason) || 'rejected';
        if (reason === 'limit_reached') {
          const error=new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
          error.code='REMINDERS_LIMIT';
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

      const item=plainObject(result.item);
      if (
        !item
        || positiveSafeInteger(item.telegram_id)!==uid
        || positiveSafeInteger(item.fixture_id)!==fixtureId
      ) {
        throw new Error('Supabase reminders: invalid guarded RPC response.');
      }
      return item;
    }

    const canonical=await canonicalFixture({...source,fixtureId},cfg);
    const normalized=normalizeReminderWrite({
      ...canonical,
      reminderMinutes:settings.reminderMinutes,
      kickoffNotify:settings.kickoffNotify,
    });
    const now=Date.now();
    const nowIso=new Date(now).toISOString();
    const row=resetDeliveryState({
      telegram_id:uid,
      fixture_id:normalized.fixtureId,
      home_name:normalized.homeName,
      away_name:normalized.awayName,
      league_name:normalized.leagueName,
      fixture_date:normalized.fixtureDate,
      remind_before_minutes:normalized.reminderMinutes,
      kickoff_notify:normalized.kickoffNotify,
      created_at:nowIso,
    });

    const key=uid;
    const list=pruneMemory(key,now);
    const existing=list.find(item=>storedFixtureId(item)===row.fixture_id) || null;
    const active=list.filter(item=>{
      const fixtureMs=fixtureTimestamp(item);
      return item.enabled !== false && fixtureMs !== null && fixtureMs>now-REMINDER_GRACE_MS;
    });

    if (!existing && active.length>=PERSONAL_WRITE_LIMITS.reminders) {
      const error=new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
      error.code='REMINDERS_LIMIT';
      throw error;
    }
    if (existing?.enabled === false && rearm && active.length>=PERSONAL_WRITE_LIMITS.reminders) {
      const error=new Error(`Можно создать не больше ${PERSONAL_WRITE_LIMITS.reminders} активных напоминаний.`);
      error.code='REMINDERS_LIMIT';
      throw error;
    }

    let stored;
    if (!existing) {
      stored=row;
    } else if (rearm) {
      stored=resetDeliveryState({
        ...existing,
        home_name:row.home_name,
        away_name:row.away_name,
        league_name:row.league_name,
        fixture_date:row.fixture_date,
        remind_before_minutes:row.remind_before_minutes,
        kickoff_notify:row.kickoff_notify,
        created_at:textValue(existing.created_at) || row.created_at,
      });
    } else {
      stored={
        ...existing,
        home_name:row.home_name,
        away_name:row.away_name,
        league_name:row.league_name,
        fixture_date:row.fixture_date,
        remind_before_minutes:row.remind_before_minutes,
        kickoff_notify:row.kickoff_notify,
      };
    }

    const next=[stored,...list.filter(item=>storedFixtureId(item)!==row.fixture_id)]
      .filter(item=>{
        if (item.enabled !== false) return true;
        const fixtureMs=fixtureTimestamp(item);
        return fixtureMs === null || fixtureMs>=now-REMINDER_RETENTION_MS;
      });
    runtimeMemory.reminders.set(key,next);
    return stored;
  }

  async function removeReminder(userId, fixtureId, cfg) {
    const uid=requireUserId(userId);
    const id=requireFixtureId(fixtureId);
    if (supabaseEnabled(cfg)) {
      if (typeof fetchWithTimeout !== 'function' || typeof supaHeaders !== 'function') {
        throw new TypeError('Supabase reminders delete transport is unavailable.');
      }
      const url=remindersUrl(cfg);
      url.searchParams.set('telegram_id',`eq.${uid}`);
      url.searchParams.set('fixture_id',`eq.${id}`);
      const response=await fetchWithTimeout(url,{
        method:'DELETE',
        headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
      },7000,'Supabase reminders');
      if (!response?.ok) {
        const status=integerCandidate(response?.status) ?? 0;
        throw new Error(`Supabase reminders: HTTP ${status}`);
      }
      return;
    }

    const list=reminderList(runtimeMemory.reminders.get(uid));
    runtimeMemory.reminders.set(
      uid,
      list.filter(item=>storedFixtureId(item)!==id),
    );
  }

  return {
    getReminders,
    addReminder,
    removeReminder,
  };
}
