-- Football Analytics v6.26.3 / security incident occurrence accuracy
-- Additive migration: retain true occurrence volume for transition-key-deduplicated
-- operational events while keeping legacy ops_events readers compatible.

alter table public.ops_events
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists last_occurred_at timestamptz;

comment on column public.ops_events.occurrence_count is
  'Number of occurrences represented by this deduplicated ops event row. Defaults to one for legacy/non-deduplicated events.';

comment on column public.ops_events.last_occurred_at is
  'Timestamp of the most recent occurrence represented by this deduplicated ops event row.';

create or replace function public.record_ops_event_occurrence(
  p_created_at timestamptz,
  p_severity text,
  p_source text,
  p_event_type text,
  p_transition_key text,
  p_code text default '',
  p_message text default '',
  p_endpoint text default '',
  p_status integer default null,
  p_duration_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_count integer := 0;
  v_last timestamptz;
begin
  if p_transition_key is null
     or length(btrim(p_transition_key)) = 0
     or length(p_transition_key) > 220 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition_key');
  end if;

  if p_severity not in ('info','warning','error','critical') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_severity');
  end if;

  insert into public.ops_events (
    created_at,
    severity,
    source,
    event_type,
    code,
    message,
    endpoint,
    status,
    duration_ms,
    metadata,
    transition_key,
    occurrence_count,
    last_occurred_at
  )
  values (
    v_created_at,
    p_severity,
    left(coalesce(p_source,'worker'),80),
    left(coalesce(p_event_type,'runtime'),100),
    left(coalesce(p_code,''),100),
    left(coalesce(p_message,''),500),
    left(coalesce(p_endpoint,''),160),
    p_status,
    case when p_duration_ms is null then null else greatest(0,p_duration_ms) end,
    coalesce(p_metadata,'{}'::jsonb)
      || jsonb_build_object('occurrenceCount',1,'lastOccurredAt',v_created_at),
    p_transition_key,
    1,
    v_created_at
  )
  on conflict (transition_key) do update
  set occurrence_count = public.ops_events.occurrence_count + 1,
      last_occurred_at = greatest(
        coalesce(public.ops_events.last_occurred_at, public.ops_events.created_at),
        excluded.last_occurred_at
      ),
      metadata = coalesce(public.ops_events.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'occurrenceCount', public.ops_events.occurrence_count + 1,
          'lastOccurredAt', greatest(
            coalesce(public.ops_events.last_occurred_at, public.ops_events.created_at),
            excluded.last_occurred_at
          )
        )
  returning occurrence_count, last_occurred_at
  into v_count, v_last;

  return jsonb_build_object(
    'ok', true,
    'occurrenceCount', v_count,
    'lastOccurredAt', v_last
  );
end;
$$;

revoke all on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) from public, anon, authenticated;

grant execute on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) to service_role;

comment on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) is
  'Service-role-only atomic insert/increment for transition-key-deduplicated ops events.';

-- Keep the established readiness fingerprint stable while the additive
-- observability columns/RPC roll out ahead of the matching Worker.
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
      'provider_slo_buckets'
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
      'provider_slo_buckets'
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
      'provider_slo_buckets'
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
      'record_provider_slo_observation',
      'read_provider_slo_buckets',
      'provider_slo_aggregation_contract',
      'claim_provider_incident_alert_delivery_v2',
      'begin_provider_incident_alert_delivery_send',
      'record_ops_event_occurrence'
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
