-- Football Analytics v6.21 / composite production readiness contract
-- Additive migration: aggregate existing service-role readiness/security contracts
-- and minimum schema/auth checks into one PostgREST RPC round-trip.
-- Existing RPCs, tables, columns, RLS policies and grants are preserved.

create or replace function public.backend_readiness_contract(
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
  v_security jsonb;
  v_default_acl jsonb;
  v_fingerprint jsonb;
  v_personal_write_guards jsonb;
  v_incident_alert_delivery jsonb;
  v_table_checks jsonb := '[]'::jsonb;
  v_table_ok boolean := false;
  v_fingerprint_ok boolean := false;
  v_schema_ok boolean := false;
  v_security_ok boolean := false;
  v_auth_failures integer := 0;
  v_auth_window integer := greatest(1, least(coalesce(p_auth_window_minutes, 5), 60));
  v_failure_reasons jsonb := '[]'::jsonb;
begin
  -- Reuse the existing DB-side contracts instead of reimplementing their logic.
  select public.backend_security_contract() into v_security;
  select public.backend_default_acl_contract() into v_default_acl;
  select public.backend_schema_fingerprint() into v_fingerprint;
  select public.personal_write_guard_contract() into v_personal_write_guards;
  select public.provider_incident_alert_delivery_contract() into v_incident_alert_delivery;

  -- Preserve the current minimum-column readiness contract in one catalog query.
  with specs(id, table_name, columns) as (
    values
      ('users_acquisition', 'users', array['telegram_id','acquisition_source','acquisition_campaign','acquisition_content']::text[]),
      ('analysis_history_ai', 'analysis_history', array['telegram_id','fixture_id','ai_signal_code','analysis_version']::text[]),
      ('calibration_transitions', 'model_calibration_transitions', array['id','action','resulting_revision','created_at']::text[]),
      ('digest_subscriptions', 'bot_digest_subscriptions', array['telegram_id','enabled','hour_utc','delivery_claim_date','delivery_locked_until']::text[]),
      ('referee_history', 'referee_match_history', array['fixture_id','referee_key','yellow_cards']::text[]),
      ('growth_events', 'growth_events', array['id','event_name','metadata','created_at']::text[]),
      ('telegram_update_claims', 'telegram_update_claims', array['update_key','status','locked_until','expires_at','duplicate_count','last_duplicate_at']::text[]),
      ('provider_rate_windows', 'provider_rate_windows', array['bucket_key','window_started_at','request_count','updated_at']::text[]),
      ('cache_provenance', 'analysis_cache', array['cache_key','provider','source_updated_at','freshness_status','updated_at']::text[]),
      ('odds_provenance', 'odds_snapshots', array['fixture_id','provider','bookmaker_count','source_updated_at']::text[]),
      ('model_provenance', 'model_predictions', array['fixture_id','data_provenance','model_inputs_version']::text[]),
      ('provider_incident_alert_delivery', 'provider_incident_alert_deliveries', array['incident_id','transition','alert_key','destination_key','status','attempts','retry_at','unknown_at']::text[])
  ),
  checked as (
    select
      s.id,
      s.table_name,
      s.columns,
      not exists (
        select 1
        from unnest(s.columns) as required(column_name)
        where not exists (
          select 1
          from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = s.table_name
            and c.column_name = required.column_name
        )
      ) as ok
    from specs s
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'table', table_name,
          'columns', columns,
          'ok', ok,
          'status', case when ok then 'ok' else 'drift' end
        )
        order by id
      ),
      '[]'::jsonb
    ),
    coalesce(bool_and(ok), false)
  into v_table_checks, v_table_ok
  from checked;

  v_fingerprint_ok :=
    coalesce((v_fingerprint->>'ok')::boolean, false)
    and coalesce(v_fingerprint->>'fingerprint', '') = coalesce(p_expected_fingerprint, '');

  v_schema_ok :=
    v_table_ok
    and v_fingerprint_ok
    and coalesce((v_personal_write_guards->>'ok')::boolean, false)
    and coalesce((v_incident_alert_delivery->>'ok')::boolean, false);

  v_security_ok :=
    coalesce((v_security->>'ok')::boolean, false)
    and coalesce((v_default_acl->>'ok')::boolean, false);

  -- Keep the existing readiness semantics: inspect at most the newest 100
  -- auth-failure candidates within the configured window.
  select count(*)::integer
  into v_auth_failures
  from (
    select e.message
    from public.ops_events e
    where e.created_at >= now() - make_interval(mins => v_auth_window)
      and coalesce(e.message, '') ~* 'HTTP 401|PGRST303|invalid.*jwt|invalid.*api.?key'
    order by e.created_at desc
    limit 100
  ) recent_auth_failures;

  select coalesce(jsonb_agg(reason order by ordinal), '[]'::jsonb)
  into v_failure_reasons
  from (
    values
      (1, 'schema_columns', not v_table_ok),
      (2, 'schema_fingerprint', not v_fingerprint_ok),
      (3, 'personal_write_guards', not coalesce((v_personal_write_guards->>'ok')::boolean, false)),
      (4, 'provider_incident_alert_delivery_contract', not coalesce((v_incident_alert_delivery->>'ok')::boolean, false)),
      (5, 'backend_security_contract', not coalesce((v_security->>'ok')::boolean, false)),
      (6, 'backend_default_acl_contract', not coalesce((v_default_acl->>'ok')::boolean, false)),
      (7, 'recent_supabase_auth_failures', v_auth_failures > 0)
  ) failures(ordinal, reason, failed)
  where failed;

  return jsonb_build_object(
    'ok', v_schema_ok and v_security_ok and v_auth_failures = 0,
    'status', case when v_schema_ok and v_security_ok and v_auth_failures = 0 then 'ok' else 'not_ready' end,
    'checkedAt', now(),
    'connectivity', jsonb_build_object(
      'ok', true,
      'status', 'ok'
    ),
    'schema', jsonb_build_object(
      'ok', v_schema_ok,
      'status', case when v_schema_ok then 'ok' else 'drift' end,
      'tableChecks', v_table_checks,
      'fingerprint', jsonb_build_object(
        'ok', v_fingerprint_ok,
        'status', case when v_fingerprint_ok then 'ok' else 'fingerprint_mismatch' end,
        'fingerprint', coalesce(v_fingerprint->>'fingerprint', ''),
        'expected', coalesce(p_expected_fingerprint, ''),
        'parts', coalesce((v_fingerprint->>'parts')::integer, 0),
        'checkedAt', v_fingerprint->'checked_at'
      ),
      'personalWriteGuards', v_personal_write_guards,
      'providerIncidentAlertDeliveryContract', v_incident_alert_delivery
    ),
    'backendSecurity', jsonb_build_object(
      'ok', v_security_ok,
      'status', case when v_security_ok then 'ok' else 'violations' end,
      'contract', v_security,
      'defaultAcl', v_default_acl
    ),
    'recentSupabaseAuthFailures', jsonb_build_object(
      'available', true,
      'count', v_auth_failures,
      'windowMinutes', v_auth_window
    ),
    'failureReasons', v_failure_reasons
  );
end;
$$;

-- The composite readiness RPC is an operational aggregator. Exclude it from the
-- structural fingerprint so this additive migration can be applied before the
-- Worker rollout without making the currently deployed v6.20 Worker not-ready.
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

  union all

  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename <> 'provider_incident_alert_deliveries'

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

revoke execute on function public.backend_readiness_contract(text,integer) from public, anon, authenticated;
grant execute on function public.backend_readiness_contract(text,integer) to service_role;

revoke execute on function public.backend_schema_fingerprint() from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint() to service_role;

comment on function public.backend_readiness_contract(text,integer) is
  'v6.21 service-role-only composite readiness contract aggregating schema, security, ACL, fingerprint and recent Supabase auth failure checks.';

notify pgrst, 'reload schema';
