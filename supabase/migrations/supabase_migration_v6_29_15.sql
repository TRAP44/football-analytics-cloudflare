-- MatchRadar v6.29.15 / AI switch in runtime controls
-- Adds runtime_controls.ai_enabled (default true): the admin can turn off
-- Cloudflare Workers AI (match explanation ordering and free-text questions)
-- without a deploy. Security lockdown turns it off together with the rest.
--
-- Rollout order: apply this migration first (the production deploy gate
-- requires it), then deploy the Worker that accepts the new v2 fingerprint.
-- The previous Worker ignores the column (AI stays enabled by default); the new
-- Worker also works before the migration: it treats AI as enabled and does not
-- write ai_enabled until the column exists.
--
-- Legacy v1 fingerprint stays frozen: backend_schema_fingerprint() excludes the
-- new column, as earlier additive columns were excluded. The atomic history
-- rule is recreated with aiEnabled in the snapshot so rollbacks restore it;
-- securityLockdown keeps its historical definition.

alter table public.runtime_controls
  add column if not exists ai_enabled boolean not null default true;

-- Freeze the historical v1 fingerprint: the new column is excluded.
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
      or (c.table_name = 'runtime_controls' and c.column_name = 'ai_enabled')
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
      'cleanup_sensitive_mutation_idempotency',
      'backend_schema_contract_v2',
      'backend_readiness_contract_v2'
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

revoke all on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;


-- create or replace keeps the rule in place atomically (no window without the
-- history rule, no drop statement).
create or replace rule runtime_controls_atomic_history as
on update to public.runtime_controls
where old.revision is distinct from new.revision
do also
  insert into public.runtime_control_history (
    revision,
    action,
    reason,
    snapshot,
    app_version,
    changed_by,
    source_revision,
    created_at
  )
  values (
    new.revision,
    case
      when (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-action'
      ) in ('defaults','rollback')
      then left(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-action',
        40
      )
      else 'update'
    end,
    case
      when coalesce(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-reason-hex',
        ''
      ) ~ '^([0-9a-fA-F]{2})*$'
      then left(
        convert_from(
          decode(
            coalesce(
              coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
                ->> 'x-runtime-reason-hex',
              ''
            ),
            'hex'
          ),
          'UTF8'
        ),
        240
      )
      else ''
    end,
    jsonb_build_object(
      'maintenanceMode', new.maintenance_mode,
      'analysisEnabled', new.analysis_enabled,
      'searchEnabled', new.search_enabled,
      'liveEnabled', new.live_enabled,
      'remindersEnabled', new.reminders_enabled,
      'expandedDataEnabled', new.expanded_data_enabled,
      'autoSettlementRecoveryEnabled', new.auto_settlement_recovery_enabled,
      'aiEnabled', new.ai_enabled,
      'securityLockdown',
        new.maintenance_mode
        and not new.analysis_enabled
        and not new.search_enabled
        and not new.live_enabled
        and not new.reminders_enabled
        and not new.expanded_data_enabled
        and not new.auto_settlement_recovery_enabled,
      'requestedAction',
        case
          when (
            coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
              ->> 'x-runtime-action'
          ) in ('update','defaults','rollback','lockdown','lockdown_release')
          then left(
            coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
              ->> 'x-runtime-action',
            40
          )
          else 'update'
        end,
      'message', new.message,
      'revision', new.revision,
      'updatedAt', new.updated_at
    ),
    left(
      coalesce(
        nullif(
          coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
            ->> 'x-runtime-app-version',
          ''
        ),
        'database'
      ),
      120
    ),
    new.updated_by,
    case
      when coalesce(
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision',
        ''
      ) ~ '^[0-9]{1,10}$'
      and (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision'
      )::bigint <= 2147483647
      then (
        coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb
          ->> 'x-runtime-source-revision'
      )::integer
      else null
    end,
    coalesce(new.updated_at, now())
  );

comment on rule runtime_controls_atomic_history on public.runtime_controls is
  'Atomically appends an immutable runtime-control revision (including aiEnabled since v6.29.15). Lockdown intent is preserved in snapshot.requestedAction while persisted action remains constraint-compatible.';

notify pgrst, 'reload schema';
