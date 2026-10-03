-- MatchRadar v6.25.1 / Smart Notification delivery ownership hardening
-- Introduces an explicit pre-send CAS state so a successful Telegram send cannot
-- be blindly replayed when final persistence is ambiguous.

alter table public.smart_notification_deliveries
  add column if not exists send_started_at timestamptz;

alter table public.smart_notification_deliveries
  drop constraint if exists smart_notification_deliveries_status_check;

alter table public.smart_notification_deliveries
  add constraint smart_notification_deliveries_status_check
  check (status in ('claimed','sending','sent','retry_pending','unknown','terminal_failed'));

create or replace function public.begin_smart_notification_delivery_send(
  p_telegram_id bigint,
  p_dedupe_key text,
  p_claimed_at timestamptz,
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_attempts integer;
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 3), 10));
begin
  select attempts
  into v_attempts
  from public.smart_notification_deliveries
  where telegram_id = p_telegram_id
    and dedupe_key = p_dedupe_key
    and status = 'claimed'
    and claimed_at = p_claimed_at
  for update;

  if not found then
    return jsonb_build_object('started', false, 'reason', 'claim_lost');
  end if;

  if v_attempts > v_max_attempts then
    update public.smart_notification_deliveries
    set status = 'terminal_failed',
        retry_at = null,
        last_error = 'Maximum delivery attempts exceeded.',
        updated_at = v_now
    where telegram_id = p_telegram_id
      and dedupe_key = p_dedupe_key
      and status = 'claimed'
      and claimed_at = p_claimed_at;

    return jsonb_build_object('started', false, 'reason', 'max_retries', 'attempts', v_attempts);
  end if;

  update public.smart_notification_deliveries
  set status = 'sending',
      send_started_at = v_now,
      updated_at = v_now
  where telegram_id = p_telegram_id
    and dedupe_key = p_dedupe_key
    and status = 'claimed'
    and claimed_at = p_claimed_at;

  if not found then
    return jsonb_build_object('started', false, 'reason', 'claim_lost');
  end if;

  return jsonb_build_object('started', true, 'reason', 'sending', 'attempts', v_attempts);
end;
$$;

create or replace function public.finalize_smart_notification_delivery(
  p_telegram_id bigint,
  p_dedupe_key text,
  p_claimed_at timestamptz,
  p_status text,
  p_error text default '',
  p_retry_after_seconds integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_updated integer := 0;
  v_now timestamptz := now();
  v_retry_seconds integer := greatest(0, least(coalesce(p_retry_after_seconds, 0), 86400));
begin
  if p_status not in ('sent','retry_pending','unknown','terminal_failed') then
    return jsonb_build_object('updated', false, 'reason', 'invalid_status');
  end if;

  update public.smart_notification_deliveries
  set status = p_status,
      sent_at = case when p_status = 'sent' then v_now else sent_at end,
      retry_at = case
        when p_status = 'retry_pending' and v_retry_seconds > 0
          then v_now + make_interval(secs => v_retry_seconds)
        else null
      end,
      last_error = left(coalesce(p_error, ''), 240),
      updated_at = v_now
  where telegram_id = p_telegram_id
    and dedupe_key = p_dedupe_key
    and status in ('claimed','sending')
    and claimed_at = p_claimed_at;

  get diagnostics v_updated = row_count;
  return jsonb_build_object(
    'updated', v_updated = 1,
    'reason', case when v_updated = 1 then 'finalized' else 'claim_lost' end
  );
end;
$$;

revoke execute on function public.begin_smart_notification_delivery_send(bigint,text,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.begin_smart_notification_delivery_send(bigint,text,timestamptz,integer)
  to service_role;

-- Reassert least privilege for the replaced finalizer.
revoke execute on function public.finalize_smart_notification_delivery(bigint,text,timestamptz,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.finalize_smart_notification_delivery(bigint,text,timestamptz,text,text,integer)
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
