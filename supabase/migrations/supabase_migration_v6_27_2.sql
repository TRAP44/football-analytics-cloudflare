-- Football Analytics v6.27.2 / versioned complete database schema contract
-- Additive migration for Issue #438.
--
-- IMPORTANT: the historical backend_schema_fingerprint() and
-- backend_readiness_contract(text,integer) functions are intentionally left
-- unchanged so an older Worker remains ready while this migration is rolled
-- out before the matching application release.

create or replace function public.backend_schema_contract_v2()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with contract_roles(role_name) as (
  values ('anon'::name), ('authenticated'::name), ('service_role'::name)
),
parts as (
  -- Relations and RLS state. No public relation is excluded from v2.
  select
    'R|' || c.relname
      || '|kind=' || c.relkind::text
      || '|rls=' || c.relrowsecurity::text
      || '|force_rls=' || c.relforcerowsecurity::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m','f','S')

  union all

  -- Complete public column contract, including identity/generated metadata.
  select
    'C|' || c.table_name
      || '|' || c.ordinal_position
      || '|' || c.column_name
      || '|' || c.data_type
      || '|' || coalesce(c.udt_name,'')
      || '|nullable=' || c.is_nullable
      || '|default=' || coalesce(c.column_default,'')
      || '|identity=' || coalesce(c.is_identity,'NO')
      || '|identity_generation=' || coalesce(c.identity_generation,'')
      || '|generated=' || coalesce(c.is_generated,'NEVER')
      || '|generation=' || coalesce(c.generation_expression,'') as part
  from information_schema.columns c
  where c.table_schema = 'public'

  union all

  -- All public relation constraints.
  select
    'K|' || c.relname
      || '|' || pc.conname
      || '|type=' || pc.contype::text
      || '|' || pg_get_constraintdef(pc.oid, true) as part
  from pg_constraint pc
  join pg_class c on c.oid = pc.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  -- All public indexes.
  select
    'I|' || tablename || '|' || indexname || '|' || indexdef as part
  from pg_indexes
  where schemaname = 'public'

  union all

  -- Function/procedure signatures and execution-relevant attributes.
  select
    'F|' || p.proname
      || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|result=' || coalesce(pg_get_function_result(p.oid),'')
      || '|kind=' || p.prokind::text
      || '|volatility=' || p.provolatile::text
      || '|strict=' || p.proisstrict::text
      || '|definer=' || p.prosecdef::text
      || '|parallel=' || p.proparallel::text as part
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'

  union all

  -- Full RLS policy definitions for public tables.
  select
    'P|' || p.tablename
      || '|' || p.policyname
      || '|permissive=' || coalesce(p.permissive,'')
      || '|cmd=' || coalesce(p.cmd,'')
      || '|roles=' || coalesce(array_to_string(p.roles, ','),'')
      || '|qual=' || coalesce(p.qual,'')
      || '|check=' || coalesce(p.with_check,'') as part
  from pg_policies p
  where p.schemaname = 'public'

  union all

  -- User-defined trigger definitions.
  select
    'TR|' || c.relname
      || '|' || t.tgname
      || '|' || pg_get_triggerdef(t.oid, true) as part
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal

  union all

  -- Effective table/view grants for the application-facing database roles.
  select
    'G|' || c.relname
      || '|role=' || r.role_name::text
      || '|select=' || has_table_privilege(r.role_name::text, c.oid, 'SELECT')::text
      || '|insert=' || has_table_privilege(r.role_name::text, c.oid, 'INSERT')::text
      || '|update=' || has_table_privilege(r.role_name::text, c.oid, 'UPDATE')::text
      || '|delete=' || has_table_privilege(r.role_name::text, c.oid, 'DELETE')::text
      || '|truncate=' || has_table_privilege(r.role_name::text, c.oid, 'TRUNCATE')::text
      || '|references=' || has_table_privilege(r.role_name::text, c.oid, 'REFERENCES')::text
      || '|trigger=' || has_table_privilege(r.role_name::text, c.oid, 'TRIGGER')::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join contract_roles r
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m','f')

  union all

  -- Effective sequence grants for the same roles.
  select
    'S|' || c.relname
      || '|role=' || r.role_name::text
      || '|usage=' || has_sequence_privilege(r.role_name::text, c.oid, 'USAGE')::text
      || '|select=' || has_sequence_privilege(r.role_name::text, c.oid, 'SELECT')::text
      || '|update=' || has_sequence_privilege(r.role_name::text, c.oid, 'UPDATE')::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join contract_roles r
  where n.nspname = 'public'
    and c.relkind = 'S'

  union all

  -- Effective EXECUTE grants for every public function/procedure.
  select
    'X|' || p.proname
      || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|role=' || r.role_name::text
      || '|execute=' || has_function_privilege(r.role_name::text, p.oid, 'EXECUTE')::text as part
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join contract_roles r
  where n.nspname = 'public'
)
select jsonb_build_object(
  'ok', count(*) > 0,
  'version', 2,
  'fingerprint', md5(coalesce(string_agg(part, E'\n' order by part), '')),
  'parts', count(*),
  'scope', 'all-public-relations-columns-constraints-indexes-functions-policies-triggers-and-app-role-grants',
  'checkedAt', now()
)
from parts;
$$;

revoke all on function public.backend_schema_contract_v2()
  from public, anon, authenticated;
grant execute on function public.backend_schema_contract_v2()
  to service_role;

comment on function public.backend_schema_contract_v2() is
  'Version 2 complete public database contract. Includes every public relation/column/constraint/index/function/policy/trigger plus effective anon/authenticated/service_role grants; no rollout exclusions.';

create or replace function public.backend_readiness_contract_v2(
  p_expected_fingerprint text,
  p_auth_window_minutes integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_legacy_fingerprint jsonb;
  v_legacy jsonb;
  v_contract jsonb;
  v_contract_ok boolean := false;
  v_schema_ok boolean := false;
  v_failure_reasons jsonb := '[]'::jsonb;
  v_auth_window integer := greatest(1, least(coalesce(p_auth_window_minutes, 5), 60));
begin
  -- Reuse all existing readiness/security/auth checks while deliberately
  -- satisfying only the historical v1 fingerprint with its current value.
  -- This keeps v1 backward compatible and moves the new release gate to v2.
  select public.backend_schema_fingerprint() into v_legacy_fingerprint;

  select public.backend_readiness_contract(
    coalesce(v_legacy_fingerprint->>'fingerprint', ''),
    v_auth_window
  )
  into v_legacy;

  select public.backend_schema_contract_v2() into v_contract;

  v_contract_ok :=
    coalesce((v_contract->>'ok')::boolean, false)
    and coalesce((v_contract->>'version')::integer, 0) = 2
    and length(btrim(coalesce(p_expected_fingerprint, ''))) > 0
    and coalesce(v_contract->>'fingerprint', '') = coalesce(p_expected_fingerprint, '');

  v_schema_ok :=
    coalesce((v_legacy->'schema'->>'ok')::boolean, false)
    and v_contract_ok;

  v_failure_reasons := coalesce(v_legacy->'failureReasons', '[]'::jsonb);
  if not v_contract_ok then
    v_failure_reasons := v_failure_reasons || jsonb_build_array('schema_contract_v2');
  end if;

  return v_legacy || jsonb_build_object(
    'ok', coalesce((v_legacy->>'ok')::boolean, false) and v_contract_ok,
    'status',
      case
        when coalesce((v_legacy->>'ok')::boolean, false) and v_contract_ok
          then 'ok'
        else 'not_ready'
      end,
    'schemaContractVersion', 2,
    'schema',
      coalesce(v_legacy->'schema', '{}'::jsonb)
      || jsonb_build_object(
        'ok', v_schema_ok,
        'status', case when v_schema_ok then 'ok' else 'drift' end,
        'contractVersion', 2,
        'fingerprint', jsonb_build_object(
          'ok', v_contract_ok,
          'status', case when v_contract_ok then 'ok' else 'fingerprint_mismatch' end,
          'fingerprint', coalesce(v_contract->>'fingerprint', ''),
          'expected', coalesce(p_expected_fingerprint, ''),
          'parts', coalesce((v_contract->>'parts')::integer, 0),
          'checkedAt', v_contract->'checkedAt'
        ),
        'versionedContract', v_contract
      ),
    'failureReasons', v_failure_reasons
  );
end;
$$;

revoke all on function public.backend_readiness_contract_v2(text,integer)
  from public, anon, authenticated;
grant execute on function public.backend_readiness_contract_v2(text,integer)
  to service_role;

comment on function public.backend_readiness_contract_v2(text,integer) is
  'Service-role-only readiness contract for DB contract version 2. Preserves legacy checks but gates the release on the complete v2 fingerprint.';

-- Freeze the historical v1 fingerprint for old-Worker/new-DB rollout compatibility.
-- The complete current-release contract is backend_schema_contract_v2(); only the
-- legacy v1 contract excludes the v2 RPCs so deployed pre-v2 Workers remain ready.
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

notify pgrst, 'reload schema';
