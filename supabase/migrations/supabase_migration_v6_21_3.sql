-- Football Analytics v6.21.3 / important-change notification persistence
-- Additive operational migration. Dedicated atomic state for one significant pre-match change delivery.

alter table public.match_reminders
  add column if not exists important_change_notified_at timestamptz,
  add column if not exists important_change_claimed_at timestamptz,
  add column if not exists important_change_attempts integer not null default 0;

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
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_home text := btrim(coalesce(p_home_name, ''));
  v_away text := btrim(coalesce(p_away_name, ''));
  v_league text := btrim(coalesce(p_league_name, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_count integer := 0;
  v_exists boolean := false;
  v_row public.match_reminders%rowtype;
begin
  if p_telegram_id is null or p_telegram_id <= 0 or p_fixture_id is null or p_fixture_id <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;
  if v_home = '' or v_away = '' or char_length(v_home) > 160 or char_length(v_away) > 160 or char_length(v_league) > 160 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;
  if p_fixture_date is null or p_fixture_date <= now() + interval '5 minutes' then
    return jsonb_build_object('allowed', false, 'reason', 'fixture_started');
  end if;
  if p_remind_before_minutes not in (15, 30, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:reminders'),
    (p_telegram_id % 2147483647)::integer
  );

  select exists(
    select 1 from public.match_reminders
    where telegram_id = p_telegram_id and fixture_id = p_fixture_id
  ) into v_exists;

  if not v_exists then
    select count(*)::integer into v_count
    from public.match_reminders
    where telegram_id = p_telegram_id
      and enabled = true
      and fixture_date > now() - interval '10 minutes';
    if v_count >= v_limit then
      return jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'count', v_count, 'limit', v_limit);
    end if;
  end if;

  insert into public.match_reminders(
    telegram_id, fixture_id, home_name, away_name, league_name, fixture_date,
    enabled, remind_before_minutes, kickoff_notify,
    notified_at, kickoff_notified_at, lineup_notified_at, important_change_notified_at,
    prematch_claimed_at, kickoff_claimed_at, lineup_claimed_at, important_change_claimed_at,
    prematch_attempts, kickoff_attempts, lineup_attempts, important_change_attempts,
    delivery_last_error, delivery_last_attempt_at, delivery_last_success_at,
    delivery_disabled_reason, delivery_retry_after, created_at
  ) values (
    p_telegram_id, p_fixture_id, v_home, v_away, v_league, p_fixture_date,
    true, p_remind_before_minutes, coalesce(p_kickoff_notify, true),
    null, null, null, null, null, null, null, null, 0, 0, 0, 0,
    null, null, null, null, null, now()
  )
  on conflict (telegram_id, fixture_id)
  do update set
    home_name = excluded.home_name,
    away_name = excluded.away_name,
    league_name = excluded.league_name,
    fixture_date = excluded.fixture_date,
    enabled = true,
    remind_before_minutes = excluded.remind_before_minutes,
    kickoff_notify = excluded.kickoff_notify,
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
    delivery_retry_after = null,
    created_at = excluded.created_at
  returning * into v_row;

  select count(*)::integer into v_count
  from public.match_reminders
  where telegram_id = p_telegram_id
    and enabled = true
    and fixture_date > now() - interval '10 minutes';

  return jsonb_build_object(
    'allowed', true,
    'reason', case when v_exists then 'updated' else 'created' end,
    'count', v_count,
    'limit', v_limit,
    'item', to_jsonb(v_row)
  );
end;
$$;

revoke execute on function public.save_match_reminder_guarded(bigint,bigint,text,text,text,timestamptz,integer,boolean,integer)
  from public, anon, authenticated;
grant execute on function public.save_match_reminder_guarded(bigint,bigint,text,text,text,timestamptz,integer,boolean,integer)
  to service_role;

-- Keep current production fingerprint stable while this additive notification state rolls out.
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
    and c.table_name <> 'provider_incident_alert_deliveries'
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
      or (c.table_name = 'match_reminders' and c.column_name in ('lineup_notified_at','lineup_claimed_at','lineup_attempts','important_change_notified_at','important_change_claimed_at','important_change_attempts'))
    )
  union all
  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name <> 'provider_incident_alert_deliveries'
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename <> 'provider_incident_alert_deliveries'
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
      'save_match_reminder_guarded',
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
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

revoke execute on function public.backend_schema_fingerprint() from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint() to service_role;

notify pgrst, 'reload schema';
