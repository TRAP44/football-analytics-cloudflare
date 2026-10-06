-- MatchRadar v6.29.9 / complete personal-write readiness contract
-- Forward hotfix for v6.29.2.
--
-- v6.29.2 restored favoritePlayersLimit, but the older readiness layer only
-- validated a subset of personal_write_guard_contract(). Keep all established
-- fingerprints unchanged and require the complete v2 payload at release time.

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
  v_personal_write jsonb := '{}'::jsonb;
  v_personal_write_ok boolean := false;
  v_schema_ok boolean := false;
  v_failure_reasons jsonb := '[]'::jsonb;
  v_auth_window integer := greatest(1, least(coalesce(p_auth_window_minutes, 5), 60));
  v_private_schema_ok boolean := false;
  v_private_table_ok boolean := false;
  v_private_columns_ok boolean := false;
  v_private_constraints_ok boolean := false;
  v_private_indexes_ok boolean := false;
  v_private_functions_ok boolean := false;
  v_private_usage_ok boolean := false;
  v_private_contract jsonb := '{}'::jsonb;
begin
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

  select public.personal_write_guard_contract() into v_personal_write;

  v_personal_write_ok :=
    coalesce((v_personal_write->>'ok')::boolean, false)
    and coalesce(v_personal_write->>'version', '') = 'v2'
    and coalesce((v_personal_write->>'favoritesLimit')::integer, 0) = 50
    and coalesce((v_personal_write->>'favoritePlayersLimit')::integer, 0) = 50
    and coalesce((v_personal_write->>'remindersLimit')::integer, 0) = 50
    and coalesce((v_personal_write->>'canonicalReminders')::boolean, false) is true
    and coalesce((v_personal_write->>'explicitRearm')::boolean, false) is true
    and coalesce((v_personal_write->>'reminderRetentionDays')::integer, 0) = 90;

  select coalesce((
    select has_schema_privilege('service_role', n.oid, 'USAGE')
      and not has_schema_privilege('service_role', n.oid, 'CREATE')
      and not has_schema_privilege('anon', n.oid, 'USAGE')
      and not has_schema_privilege('anon', n.oid, 'CREATE')
      and not has_schema_privilege('authenticated', n.oid, 'USAGE')
      and not has_schema_privilege('authenticated', n.oid, 'CREATE')
    from pg_catalog.pg_namespace n
    where n.nspname='private'
  ), false)
  into v_private_schema_ok;

  select coalesce((
    select c.relrowsecurity
      and has_table_privilege('service_role', c.oid, 'SELECT')
      and has_table_privilege('service_role', c.oid, 'INSERT')
      and has_table_privilege('service_role', c.oid, 'UPDATE')
      and has_table_privilege('service_role', c.oid, 'DELETE')
      and not has_table_privilege('service_role', c.oid, 'TRUNCATE')
      and not has_table_privilege('service_role', c.oid, 'REFERENCES')
      and not has_table_privilege('service_role', c.oid, 'TRIGGER')
      and not has_table_privilege('anon', c.oid, 'SELECT')
      and not has_table_privilege('anon', c.oid, 'INSERT')
      and not has_table_privilege('anon', c.oid, 'UPDATE')
      and not has_table_privilege('anon', c.oid, 'DELETE')
      and not has_table_privilege('anon', c.oid, 'TRUNCATE')
      and not has_table_privilege('anon', c.oid, 'REFERENCES')
      and not has_table_privilege('anon', c.oid, 'TRIGGER')
      and not has_table_privilege('authenticated', c.oid, 'SELECT')
      and not has_table_privilege('authenticated', c.oid, 'INSERT')
      and not has_table_privilege('authenticated', c.oid, 'UPDATE')
      and not has_table_privilege('authenticated', c.oid, 'DELETE')
      and not has_table_privilege('authenticated', c.oid, 'TRUNCATE')
      and not has_table_privilege('authenticated', c.oid, 'REFERENCES')
      and not has_table_privilege('authenticated', c.oid, 'TRIGGER')
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private'
      and c.relname='analysis_usage_reservations'
      and c.relkind in ('r','p')
  ), false)
  into v_private_table_ok;

  select coalesce(array_agg(
    c.column_name || ':' || c.udt_name || ':' || c.is_nullable || ':' || coalesce(c.column_default,'')
    order by c.ordinal_position
  ), array[]::text[]) = array[
    'operation_id:uuid:NO:',
    'kind:text:NO:',
    'telegram_id:int8:NO:',
    'usage_date:date:YES:',
    'entitlement_id:int8:YES:',
    'fixture_id:int8:YES:',
    'status:text:NO:''reserved''::text',
    'reserved_at:timestamptz:NO:now()',
    'updated_at:timestamptz:NO:now()',
    'finalized_at:timestamptz:YES:'
  ]::text[]
  into v_private_columns_ok
  from information_schema.columns c
  where c.table_schema='private'
    and c.table_name='analysis_usage_reservations';

  select count(*) filter (
    where pc.conname in (
      'analysis_usage_reservations_pkey',
      'analysis_usage_reservations_kind_check',
      'analysis_usage_reservations_telegram_id_check',
      'analysis_usage_reservations_status_check',
      'analysis_usage_reservations_check'
    )
  ) = 5
  and count(*) = 5
  into v_private_constraints_ok
  from pg_catalog.pg_constraint pc
  join pg_catalog.pg_class c on c.oid=pc.conrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private'
    and c.relname='analysis_usage_reservations';

  select count(*) = 3
    and bool_and(
      indexname in (
        'analysis_usage_reservations_pkey',
        'analysis_usage_reservations_status_age_idx',
        'analysis_usage_reservations_user_idx'
      )
    )
  into v_private_indexes_ok
  from pg_catalog.pg_indexes
  where schemaname='private'
    and tablename='analysis_usage_reservations';

  select
    count(*) = 3
    and bool_and(not p.prosecdef)
    and bool_and(pg_get_function_result(p.oid)='jsonb')
    and bool_and(
      (p.proname='analysis_usage_request_headers' and p.provolatile='s')
      or (p.proname in ('finalize_analysis_usage_reservation','reconcile_analysis_usage_reservations') and p.provolatile='v')
    )
    and bool_and(
      (p.proname='analysis_usage_request_headers'
        and p.proconfig = array['search_path=pg_catalog']::text[])
      or
      (p.proname in ('finalize_analysis_usage_reservation','reconcile_analysis_usage_reservations')
        and p.proconfig = array['search_path=pg_catalog, public, private']::text[])
    )
    and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
    and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  into v_private_functions_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and (
      (p.proname='analysis_usage_request_headers'
        and pg_get_function_identity_arguments(p.oid)='')
      or
      (p.proname='finalize_analysis_usage_reservation'
        and pg_get_function_identity_arguments(p.oid)=
          'p_operation_id uuid, p_disposition text, p_expected_kind text, p_expected_telegram_id bigint, p_expected_usage_date date, p_expected_entitlement_id bigint')
      or
      (p.proname='reconcile_analysis_usage_reservations'
        and pg_get_function_identity_arguments(p.oid)=
          'p_stale_seconds integer, p_limit integer')
    );

  v_private_usage_ok :=
    v_private_schema_ok
    and v_private_table_ok
    and v_private_columns_ok
    and v_private_constraints_ok
    and v_private_indexes_ok
    and v_private_functions_ok;

  v_private_contract := jsonb_build_object(
    'ok', v_private_usage_ok,
    'version', 1,
    'schema', v_private_schema_ok,
    'table', v_private_table_ok,
    'columns', v_private_columns_ok,
    'constraints', v_private_constraints_ok,
    'indexes', v_private_indexes_ok,
    'functions', v_private_functions_ok
  );

  v_schema_ok :=
    coalesce((v_legacy->'schema'->>'ok')::boolean, false)
    and v_contract_ok
    and v_personal_write_ok
    and v_private_usage_ok;

  v_failure_reasons := coalesce(v_legacy->'failureReasons', '[]'::jsonb);
  if not v_contract_ok then
    v_failure_reasons := v_failure_reasons || jsonb_build_array('schema_contract_v2');
  end if;
  if not v_personal_write_ok then
    v_failure_reasons := v_failure_reasons || jsonb_build_array('personal_write_guard_contract_v2');
  end if;
  if not v_private_usage_ok then
    v_failure_reasons := v_failure_reasons || jsonb_build_array('analysis_usage_private_contract');
  end if;

  return v_legacy || jsonb_build_object(
    'ok',
      coalesce((v_legacy->>'ok')::boolean, false)
      and v_contract_ok
      and v_personal_write_ok
      and v_private_usage_ok,
    'status',
      case
        when coalesce((v_legacy->>'ok')::boolean, false)
          and v_contract_ok
          and v_personal_write_ok
          and v_private_usage_ok
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
        'versionedContract', v_contract,
        'personalWriteGuards', v_personal_write || jsonb_build_object(
          'ok', v_personal_write_ok
        ),
        'privateAnalysisUsage', v_private_contract
      ),
    'failureReasons', v_failure_reasons
  );
end;
$$;

revoke all on function public.backend_readiness_contract_v2(text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.backend_readiness_contract_v2(text,integer)
  to service_role;

comment on function public.backend_readiness_contract_v2(text,integer) is
  'Service-role-only readiness contract for public schema v2, the complete personal-write guard payload and the private durable analysis-usage lifecycle.';

notify pgrst, 'reload schema';
