-- MatchRadar v6.27.1 / Renewable scheduled execution lease heartbeat
-- Additive patch for Issue #436. Safe to apply before the Worker rollout.

create or replace function public.renew_scheduled_job(
  p_job_key text,
  p_lease_token text,
  p_lease_seconds integer default 720
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_job_key text := btrim(coalesce(p_job_key,''));
  v_lease_token text := coalesce(p_lease_token,'');
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,720),1800));
  v_locked_until timestamptz;
begin
  if v_job_key='' or char_length(v_job_key)>180
     or v_lease_token='' or char_length(v_lease_token)>80 then
    return jsonb_build_object('renewed',false,'reason','invalid_input');
  end if;

  update public.scheduled_job_leases
  set locked_until=v_now + v_lease_seconds * interval '1 second'
  where job_key=v_job_key
    and lease_token=v_lease_token
    and status='running'
    and locked_until>v_now
  returning locked_until into v_locked_until;

  if found then
    return jsonb_build_object(
      'renewed',true,
      'reason','renewed',
      'jobKey',v_job_key,
      'lockedUntil',v_locked_until,
      'leaseSeconds',v_lease_seconds
    );
  end if;

  return jsonb_build_object(
    'renewed',false,
    'reason','ownership_lost',
    'jobKey',v_job_key
  );
end;
$$;

-- Completion and release are valid only while the caller still owns an active
-- lease. An expired owner cannot settle a row after its ownership window ended.
create or replace function public.complete_scheduled_job(
  p_job_key text,
  p_lease_token text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  update public.scheduled_job_leases
  set status='done',
      completed_at=v_now,
      locked_until=v_now
  where job_key=btrim(coalesce(p_job_key,''))
    and lease_token=coalesce(p_lease_token,'')
    and status='running'
    and locked_until>v_now;

  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.release_scheduled_job(
  p_job_key text,
  p_lease_token text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  update public.scheduled_job_leases
  set status='failed',
      completed_at=null,
      locked_until=v_now + interval '5 seconds'
  where job_key=btrim(coalesce(p_job_key,''))
    and lease_token=coalesce(p_lease_token,'')
    and status='running'
    and locked_until>v_now;

  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke all on function public.renew_scheduled_job(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_scheduled_job(text,text,integer)
  to service_role;

revoke execute on function public.complete_scheduled_job(text,text)
  from public, anon, authenticated;
revoke execute on function public.release_scheduled_job(text,text)
  from public, anon, authenticated;
grant execute on function public.complete_scheduled_job(text,text)
  to service_role;
grant execute on function public.release_scheduled_job(text,text)
  to service_role;

comment on function public.renew_scheduled_job(text,text,integer) is
  'Renews an active scheduled-job lease only for its current token owner.';
comment on function public.complete_scheduled_job(text,text) is
  'Completes a scheduled-job lease only while the caller still owns an active lease.';
comment on function public.release_scheduled_job(text,text) is
  'Releases a scheduled-job lease only while the caller still owns an active lease.';

-- Keep the established structural readiness fingerprint stable during this
-- additive patch rollout. The heartbeat RPC is validated explicitly by CI.
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
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name in ('transition_key','occurrence_count','last_occurred_at'))
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
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency'
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
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency'
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
      'backend_readiness_contract',
      'claim_scheduled_job',
      'complete_scheduled_job',
      'release_scheduled_job',
      'renew_scheduled_job',
      'record_provider_slo_observation',
      'read_provider_slo_buckets',
      'provider_slo_aggregation_contract',
      'claim_provider_incident_alert_delivery_v2',
      'begin_provider_incident_alert_delivery_send',
      'record_ops_event_occurrence',
      'claim_sensitive_mutation',
      'complete_sensitive_mutation',
      'fail_sensitive_mutation',
      'cleanup_sensitive_mutation_idempotency'
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




notify pgrst, 'reload schema';
