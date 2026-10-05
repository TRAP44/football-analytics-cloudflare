\set ON_ERROR_STOP on

\if :{?expected_legacy_fingerprint}
\else
  \echo 'Missing psql variable: expected_legacy_fingerprint'
  \quit 2
\endif
\if :{?expected_v2_fingerprint}
\else
  \echo 'Missing psql variable: expected_v2_fingerprint'
  \quit 2
\endif

create temp table issue438_contract_expectations (
  legacy_fingerprint text not null,
  v2_fingerprint text not null
) on commit preserve rows;

insert into issue438_contract_expectations(legacy_fingerprint, v2_fingerprint)
values (:'expected_legacy_fingerprint', :'expected_v2_fingerprint');

do $matchradar$
declare
  v_contract jsonb;
  v_contract_before text;
  v_contract_after text;
  v_contract_with_column text;
  v_contract_restored text;
  v_expected_legacy_fingerprint text;
  v_expected_v2_fingerprint text;
begin
  select legacy_fingerprint, v2_fingerprint
    into v_expected_legacy_fingerprint, v_expected_v2_fingerprint
  from issue438_contract_expectations;
  if to_regclass('public.users') is null
     or to_regclass('public.usage_daily') is null
     or to_regclass('public.provider_rate_windows') is null
     or to_regclass('public.telegram_update_claims') is null
     or to_regclass('public.scheduled_job_leases') is null
     or to_regclass('public.provider_slo_buckets') is null
     or to_regclass('public.sensitive_mutation_idempotency') is null then
    raise exception 'Supabase integration contract: required table is missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='telegram_update_claims'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='provider_rate_windows'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='scheduled_job_leases'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='provider_slo_buckets'
      and c.relrowsecurity
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='sensitive_mutation_idempotency'
      and c.relrowsecurity
  ) then
    raise exception 'Supabase integration contract: backend-only table missing RLS';
  end if;

  if not exists (
    select 1
    from pg_rules
    where schemaname = 'public'
      and tablename = 'runtime_controls'
      and rulename = 'runtime_controls_atomic_history'
  ) then
    raise exception 'Supabase integration contract: atomic runtime-control history rule is missing';
  end if;

  if to_regprocedure(
       'public.consume_analysis_quota(bigint,date,integer)'
     ) is null
     or to_regprocedure(
       'public.claim_provider_request(text,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.claim_telegram_update(text,integer)'
     ) is null
     or to_regprocedure(
       'public.claim_scheduled_job(text,text,timestamp with time zone,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.renew_scheduled_job(text,text,integer)'
     ) is null
     or to_regprocedure(
       'public.record_ops_event_occurrence(timestamp with time zone,text,text,text,text,text,text,text,integer,integer,jsonb)'
     ) is null
     or to_regprocedure(
       'public.claim_sensitive_mutation(text,bigint,text,text,text,text,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.complete_sensitive_mutation(text,text,integer)'
     ) is null
     or to_regprocedure(
       'public.fail_sensitive_mutation(text,text,boolean,integer)'
     ) is null
     or to_regprocedure(
       'public.cleanup_sensitive_mutation_idempotency(integer)'
     ) is null then
    raise exception 'Supabase integration contract: required RPC is missing';
  end if;

  if exists (
    select 1
    from pg_proc
    where oid in (
      to_regprocedure('public.consume_analysis_quota(bigint,date,integer)'),
      to_regprocedure('public.claim_provider_request(text,integer,integer)'),
      to_regprocedure('public.claim_telegram_update(text,integer)'),
      to_regprocedure(
        'public.claim_scheduled_job(text,text,timestamp with time zone,integer,integer)'
      ),
      to_regprocedure(
        'public.renew_scheduled_job(text,text,integer)'
      ),
      to_regprocedure(
        'public.record_ops_event_occurrence(timestamp with time zone,text,text,text,text,text,text,text,integer,integer,jsonb)'
      ),
      to_regprocedure(
        'public.claim_sensitive_mutation(text,bigint,text,text,text,text,integer,integer)'
      ),
      to_regprocedure(
        'public.complete_sensitive_mutation(text,text,integer)'
      ),
      to_regprocedure(
        'public.fail_sensitive_mutation(text,text,boolean,integer)'
      ),
      to_regprocedure(
        'public.cleanup_sensitive_mutation_idempotency(integer)'
      )
    )
      and prosecdef
  ) then
    raise exception 'Supabase integration contract: critical RPC unexpectedly SECURITY DEFINER';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.consume_analysis_quota(bigint,date,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_provider_request(text,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_telegram_update(text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_scheduled_job(text,text,timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.renew_scheduled_job(text,text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.claim_sensitive_mutation(text,bigint,text,text,text,text,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.complete_sensitive_mutation(text,text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.fail_sensitive_mutation(text,text,boolean,integer)',
       'EXECUTE'
     ) then
    raise exception 'Supabase integration contract: service_role missing critical RPC EXECUTE';
  end if;

  if has_function_privilege(
       'anon',
       'public.consume_analysis_quota(bigint,date,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.consume_analysis_quota(bigint,date,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_provider_request(text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_provider_request(text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_telegram_update(text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_telegram_update(text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_scheduled_job(text,text,timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_scheduled_job(text,text,timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.renew_scheduled_job(text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.renew_scheduled_job(text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_sensitive_mutation(text,bigint,text,text,text,text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_sensitive_mutation(text,bigint,text,text,text,text,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'Supabase integration contract: public role can execute backend-only RPC';
  end if;

  if not has_table_privilege(
       'service_role',
       'public.scheduled_job_leases',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'anon',
       'public.scheduled_job_leases',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.scheduled_job_leases',
       'SELECT'
     ) then
    raise exception 'Supabase integration contract: scheduled lease grants are incorrect';
  end if;

  if not has_table_privilege(
       'service_role',
       'public.sensitive_mutation_idempotency',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     or has_table_privilege(
       'anon',
       'public.sensitive_mutation_idempotency',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.sensitive_mutation_idempotency',
       'SELECT'
     ) then
    raise exception 'Supabase integration contract: sensitive mutation ledger grants are incorrect';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='ops_events'
      and column_name='occurrence_count'
      and data_type='integer'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='ops_events'
      and column_name='last_occurred_at'
      and data_type='timestamp with time zone'
  ) then
    raise exception 'Supabase integration contract: v6.26.3 ops occurrence columns missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname='public'
      and tablename='scheduled_job_leases'
      and indexname='scheduled_job_leases_group_lock_idx'
  ) then
    raise exception 'Supabase integration contract: scheduled lease overlap index missing';
  end if;

  -- Historical v1 stays frozen for an old Worker while the new DB contract
  -- is already present. This is the old-Worker/new-DB rollout guarantee.
  select public.backend_schema_fingerprint() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true
     or coalesce(v_contract->>'fingerprint','') <> v_expected_legacy_fingerprint then
    raise exception 'Supabase integration contract: legacy backend schema fingerprint drifted: %', coalesce(v_contract->>'fingerprint','');
  end if;

  if to_regprocedure('public.backend_schema_contract_v2()') is null
     or to_regprocedure('public.backend_readiness_contract_v2(text,integer)') is null then
    raise exception 'Supabase integration contract: versioned v2 schema RPC is missing';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.backend_schema_contract_v2()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.backend_readiness_contract_v2(text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.backend_schema_contract_v2()',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.backend_schema_contract_v2()',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.backend_readiness_contract_v2(text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.backend_readiness_contract_v2(text,integer)',
       'EXECUTE'
     ) then
    raise exception 'Supabase integration contract: v2 schema contract grants are incorrect';
  end if;

  select public.backend_schema_contract_v2() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true
     or coalesce((v_contract->>'version')::integer,0) <> 2
     or coalesce(v_contract->>'fingerprint','') <> v_expected_v2_fingerprint then
    raise exception 'Supabase integration contract: complete v2 schema contract drifted: %', coalesce(v_contract->>'fingerprint','');
  end if;

  -- Prove that v2 has no hidden object/column exclusion list. A new public
  -- production object and a new column must automatically change the contract,
  -- and removing the probe must restore the exact release fingerprint.
  v_contract_before := v_contract->>'fingerprint';
  create table public.issue438_contract_probe (
    id bigint primary key
  );
  select public.backend_schema_contract_v2()->>'fingerprint'
    into v_contract_after;
  if v_contract_after = v_contract_before then
    raise exception 'Supabase integration contract: v2 ignored a new public table';
  end if;

  alter table public.issue438_contract_probe
    add column probe_value text;
  select public.backend_schema_contract_v2()->>'fingerprint'
    into v_contract_with_column;
  if v_contract_with_column = v_contract_after then
    raise exception 'Supabase integration contract: v2 ignored a new public column';
  end if;

  drop table public.issue438_contract_probe;
  select public.backend_schema_contract_v2()->>'fingerprint'
    into v_contract_restored;
  if v_contract_restored <> v_contract_before then
    raise exception 'Supabase integration contract: v2 probe did not restore release fingerprint';
  end if;

  select public.backend_readiness_contract_v2(
    v_expected_v2_fingerprint,
    5
  ) into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true
     or coalesce((v_contract->>'schemaContractVersion')::integer,0) <> 2 then
    raise exception 'Supabase integration contract: v2 readiness contract failed';
  end if;

  select public.provider_slo_aggregation_contract() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: provider SLO contract failed';
  end if;

  select public.provider_incident_alert_delivery_contract() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: provider alert contract failed';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version='20260101002100'
  ) then
    raise exception 'Supabase integration contract: latest migration history entry missing';
  end if;
end
$matchradar$;

select 'MatchRadar executable Supabase schema contract passed.' as result;
