-- MatchRadar v6.25.2 / Reminder canonicalization, explicit rearm and retention
-- Backward-compatible hardening for user reminders. Production callers resolve
-- canonical fixture metadata from server-populated cache before persistence.

create or replace function public.resolve_match_reminder_fixture(
  p_fixture_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_candidate record;
begin
  if p_fixture_id is null or p_fixture_id <= 0 then
    return jsonb_build_object('available', false, 'reason', 'invalid_input');
  end if;

  with candidates as (
    select
      1 as priority,
      coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) as observed_at,
      nullif(ac.payload->'match'->>'home', '') as unused_home_object,
      ac.payload->'match'->'home'->>'name' as home_name,
      ac.payload->'match'->'away'->>'name' as away_name,
      ac.payload->'match'->>'league' as league_name,
      case
        when ac.payload->'match'->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}T'
          then (ac.payload->'match'->>'date')::timestamptz
        else null
      end as fixture_date,
      'match_center'::text as source
    from public.analysis_cache ac
    where ac.fixture_id = p_fixture_id
      and ac.cache_key like 'match-center:%'
      and jsonb_typeof(ac.payload->'match') = 'object'
      and ac.payload->'match'->>'fixtureId' = p_fixture_id::text

    union all

    select
      2 as priority,
      coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) as observed_at,
      null::text as unused_home_object,
      fixture_row->'teams'->'home'->>'name' as home_name,
      fixture_row->'teams'->'away'->>'name' as away_name,
      fixture_row->'league'->>'name' as league_name,
      case
        when fixture_row->'fixture'->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}T'
          then (fixture_row->'fixture'->>'date')::timestamptz
        else null
      end as fixture_date,
      'provider_fixtures_cache'::text as source
    from public.analysis_cache ac
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ac.payload->'fixtures') = 'array'
        then ac.payload->'fixtures'
        else '[]'::jsonb
      end
    ) fixture_row
    where ac.cache_key like 'provider-fixtures:%'
      and fixture_row->'fixture'->>'id' = p_fixture_id::text

    union all

    select
      3 as priority,
      mp.captured_at as observed_at,
      null::text as unused_home_object,
      mp.home_name,
      mp.away_name,
      mp.league_name,
      mp.kickoff_at as fixture_date,
      'model_prediction'::text as source
    from public.model_predictions mp
    where mp.fixture_id = p_fixture_id
  )
  select *
  into v_candidate
  from candidates
  where observed_at >= now() - interval '36 hours'
    and fixture_date is not null
    and btrim(coalesce(home_name, '')) <> ''
    and btrim(coalesce(away_name, '')) <> ''
  order by priority asc, observed_at desc
  limit 1;

  if not found then
    return jsonb_build_object('available', false, 'reason', 'not_cached');
  end if;

  if v_candidate.fixture_date <= now() + interval '5 minutes' then
    return jsonb_build_object('available', false, 'reason', 'fixture_started');
  end if;

  return jsonb_build_object(
    'available', true,
    'reason', 'canonical',
    'source', v_candidate.source,
    'fixtureId', p_fixture_id,
    'homeName', left(btrim(v_candidate.home_name), 160),
    'awayName', left(btrim(v_candidate.away_name), 160),
    'leagueName', left(btrim(coalesce(v_candidate.league_name, '')), 160),
    'fixtureDate', v_candidate.fixture_date,
    'observedAt', v_candidate.observed_at
  );
end;
$$;

create or replace function public.prune_match_reminders_for_user(
  p_telegram_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_disabled integer := 0;
  v_deleted integer := 0;
begin
  if p_telegram_id is null or p_telegram_id <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:reminders'),
    (p_telegram_id % 2147483647)::integer
  );

  update public.match_reminders
  set enabled = false,
      delivery_disabled_reason = case
        when btrim(coalesce(delivery_disabled_reason, '')) = '' then 'expired'
        else delivery_disabled_reason
      end,
      prematch_claimed_at = null,
      kickoff_claimed_at = null,
      lineup_claimed_at = null,
      important_change_claimed_at = null
  where telegram_id = p_telegram_id
    and enabled = true
    and fixture_date <= now() - interval '10 minutes';

  get diagnostics v_disabled = row_count;

  delete from public.match_reminders
  where telegram_id = p_telegram_id
    and enabled = false
    and fixture_date < now() - interval '90 days';

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'disabled', v_disabled,
    'deleted', v_deleted,
    'retentionDays', 90
  );
end;
$$;

create or replace function public.save_match_reminder_guarded_v2(
  p_telegram_id bigint,
  p_fixture_id bigint,
  p_home_name text,
  p_away_name text,
  p_league_name text,
  p_fixture_date timestamptz,
  p_remind_before_minutes integer,
  p_kickoff_notify boolean,
  p_rearm boolean default false,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_count integer := 0;
  v_existing public.match_reminders%rowtype;
  v_row public.match_reminders%rowtype;
  v_canonical jsonb;
  v_home text;
  v_away text;
  v_league text;
  v_fixture_date timestamptz;
begin
  if p_telegram_id is null or p_telegram_id <= 0
     or p_fixture_id is null or p_fixture_id <= 0
     or p_telegram_id > 9007199254740991
     or p_fixture_id > 9007199254740991 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;
  if p_remind_before_minutes not in (15, 30, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  -- Canonical identity is resolved inside the persistence boundary. The
  -- legacy metadata arguments remain only for signature compatibility and are
  -- never trusted for team names, league or kickoff.
  v_canonical := public.resolve_match_reminder_fixture(p_fixture_id);
  if coalesce((v_canonical->>'available')::boolean, false) is not true then
    return jsonb_build_object(
      'allowed', false,
      'reason', case
        when v_canonical->>'reason' = 'fixture_started' then 'fixture_started'
        else 'fixture_unavailable'
      end
    );
  end if;

  v_home := btrim(coalesce(v_canonical->>'homeName', ''));
  v_away := btrim(coalesce(v_canonical->>'awayName', ''));
  v_league := btrim(coalesce(v_canonical->>'leagueName', ''));
  begin
    v_fixture_date := (v_canonical->>'fixtureDate')::timestamptz;
  exception when others then
    return jsonb_build_object('allowed', false, 'reason', 'fixture_unavailable');
  end;

  if v_home = '' or v_away = ''
     or char_length(v_home) > 160
     or char_length(v_away) > 160
     or char_length(v_league) > 160
     or v_fixture_date is null then
    return jsonb_build_object('allowed', false, 'reason', 'fixture_unavailable');
  end if;
  if v_fixture_date <= now() + interval '5 minutes' then
    return jsonb_build_object('allowed', false, 'reason', 'fixture_started');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:reminders'),
    (p_telegram_id % 2147483647)::integer
  );

  perform public.prune_match_reminders_for_user(p_telegram_id);

  select *
  into v_existing
  from public.match_reminders
  where telegram_id = p_telegram_id
    and fixture_id = p_fixture_id
  for update;

  if found then
    if coalesce(p_rearm, false) then
      if v_existing.enabled = false then
        select count(*)::integer into v_count
        from public.match_reminders
        where telegram_id = p_telegram_id
          and enabled = true
          and fixture_date > now() - interval '10 minutes';

        if v_count >= v_limit then
          return jsonb_build_object(
            'allowed', false,
            'reason', 'limit_reached',
            'count', v_count,
            'limit', v_limit
          );
        end if;
      end if;

      update public.match_reminders
      set home_name = v_home,
          away_name = v_away,
          league_name = v_league,
          fixture_date = v_fixture_date,
          enabled = true,
          remind_before_minutes = p_remind_before_minutes,
          kickoff_notify = coalesce(p_kickoff_notify, true),
          notified_at = null,
          kickoff_notified_at = null,
          lineup_notified_at = null,
          important_change_notified_at = null,
          prematch_claimed_at = null,
          kickoff_claimed_at = null,
          lineup_claimed_at = null,
          important_change_claimed_at = null,
          prematch_attempts = 0,
          kickoff_attempts = 0,
          lineup_attempts = 0,
          important_change_attempts = 0,
          delivery_last_error = null,
          delivery_last_attempt_at = null,
          delivery_last_success_at = null,
          delivery_disabled_reason = null,
          delivery_retry_after = null
      where telegram_id = p_telegram_id
        and fixture_id = p_fixture_id
      returning * into v_row;

      return jsonb_build_object(
        'allowed', true,
        'reason', 'rearmed',
        'item', to_jsonb(v_row)
      );
    end if;

    update public.match_reminders
    set home_name = v_home,
        away_name = v_away,
        league_name = v_league,
        fixture_date = v_fixture_date,
        remind_before_minutes = p_remind_before_minutes,
        kickoff_notify = coalesce(p_kickoff_notify, true)
    where telegram_id = p_telegram_id
      and fixture_id = p_fixture_id
    returning * into v_row;

    return jsonb_build_object(
      'allowed', true,
      'reason', 'updated',
      'item', to_jsonb(v_row)
    );
  end if;

  select count(*)::integer into v_count
  from public.match_reminders
  where telegram_id = p_telegram_id
    and enabled = true
    and fixture_date > now() - interval '10 minutes';

  if v_count >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'limit_reached',
      'count', v_count,
      'limit', v_limit
    );
  end if;

  insert into public.match_reminders(
    telegram_id,
    fixture_id,
    home_name,
    away_name,
    league_name,
    fixture_date,
    enabled,
    remind_before_minutes,
    kickoff_notify,
    notified_at,
    kickoff_notified_at,
    lineup_notified_at,
    important_change_notified_at,
    prematch_claimed_at,
    kickoff_claimed_at,
    lineup_claimed_at,
    important_change_claimed_at,
    prematch_attempts,
    kickoff_attempts,
    lineup_attempts,
    important_change_attempts,
    delivery_last_error,
    delivery_last_attempt_at,
    delivery_last_success_at,
    delivery_disabled_reason,
    delivery_retry_after,
    created_at
  )
  values (
    p_telegram_id,
    p_fixture_id,
    v_home,
    v_away,
    v_league,
    v_fixture_date,
    true,
    p_remind_before_minutes,
    coalesce(p_kickoff_notify, true),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    0,
    0,
    0,
    null,
    null,
    null,
    null,
    null,
    now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'created',
    'count', v_count + 1,
    'limit', v_limit,
    'item', to_jsonb(v_row)
  );
end;
$$;

-- Compatibility wrapper for the currently deployed Worker during rollout.
-- Omitting explicit rearm is always idempotent and never resets delivery state.
create or replace function public.save_match_reminder_guarded(
  p_telegram_id bigint,
  p_fixture_id bigint,
  p_home_name text,
  p_away_name text,
  p_league_name text,
  p_fixture_date timestamptz,
  p_remind_before_minutes integer,
  p_kickoff_notify boolean,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
  select public.save_match_reminder_guarded_v2(
    p_telegram_id,
    p_fixture_id,
    p_home_name,
    p_away_name,
    p_league_name,
    p_fixture_date,
    p_remind_before_minutes,
    p_kickoff_notify,
    false,
    p_limit
  );
$$;

create or replace function public.personal_write_guard_contract()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'version', 'v2',
    'favoritesLimit', 50,
    'remindersLimit', 50,
    'canonicalReminders', true,
    'explicitRearm', true,
    'reminderRetentionDays', 90
  );
$$;

revoke execute on function public.resolve_match_reminder_fixture(bigint)
  from public, anon, authenticated;
grant execute on function public.resolve_match_reminder_fixture(bigint)
  to service_role;

revoke execute on function public.prune_match_reminders_for_user(bigint)
  from public, anon, authenticated;
grant execute on function public.prune_match_reminders_for_user(bigint)
  to service_role;

revoke execute on function public.save_match_reminder_guarded_v2(bigint,bigint,text,text,text,timestamptz,integer,boolean,boolean,integer)
  from public, anon, authenticated;
grant execute on function public.save_match_reminder_guarded_v2(bigint,bigint,text,text,text,timestamptz,integer,boolean,boolean,integer)
  to service_role;

revoke execute on function public.save_match_reminder_guarded(bigint,bigint,text,text,text,timestamptz,integer,boolean,integer)
  from public, anon, authenticated;
grant execute on function public.save_match_reminder_guarded(bigint,bigint,text,text,text,timestamptz,integer,boolean,integer)
  to service_role;

revoke execute on function public.personal_write_guard_contract()
  from public, anon, authenticated;
grant execute on function public.personal_write_guard_contract()
  to service_role;

create or replace function public.backend_schema_fingerprint()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with parts as (
  select
    'C|' || c.table_name || '|' || c.ordinal_position || '|' || c.column_name || '|' ||
    c.data_type || '|' || coalesce(c.udt_name,'') || '|' || c.is_nullable || '|' ||
    coalesce(c.column_default,'') as part
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
      or (c.table_name = 'user_preferences' and c.column_name = 'notification_preferences')
      or (c.table_name = 'match_reminders' and c.column_name in (
        'lineup_notified_at','lineup_claimed_at','lineup_attempts',
        'important_change_notified_at','important_change_claimed_at','important_change_attempts'
      ))
    )
  union all
  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements'
    )
    and tc.constraint_name <> 'user_preferences_notification_preferences_object_check'
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements'
    )
    and not (tablename = 'ops_events' and indexname = 'ops_events_transition_key_key')
  union all
  select
    'F|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
    pg_get_function_result(p.oid) || '|definer=' || p.prosecdef::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in (
      'save_favorite_guarded',
      'save_favorite_player_guarded',
      'save_match_reminder_guarded',
      'save_match_reminder_guarded_v2',
      'resolve_match_reminder_fixture',
      'prune_match_reminders_for_user',
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
      'claim_smart_notification_delivery',
      'finalize_smart_notification_delivery',
      'begin_smart_notification_delivery_send',
      'activate_pass_entitlement',
      'consume_pass_entitlement',
      'refund_pass_entitlement_usage',
      'refund_pass_entitlement',
      'backend_readiness_contract'
    )
)
select jsonb_build_object(
  'ok', true,
  'fingerprint', md5(string_agg(part, E'\n' order by part)),
  'parts', count(*),
  'checked_at', now()
)
from parts;
$$;

revoke execute on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;





notify pgrst, 'reload schema';
