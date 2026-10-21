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
\if :{?expected_latest_migration_version}
\else
  \echo 'Missing psql variable: expected_latest_migration_version'
  \quit 2
\endif

begin;

create temp table issue438_contract_expectations (
  legacy_fingerprint text not null,
  v2_fingerprint text not null,
  latest_migration_version text not null
) on commit preserve rows;

insert into issue438_contract_expectations(
  legacy_fingerprint,
  v2_fingerprint,
  latest_migration_version
)
values (
  :'expected_legacy_fingerprint',
  :'expected_v2_fingerprint',
  :'expected_latest_migration_version'
);

do $matchradar$
declare
  v_contract jsonb;
  v_contract_before text;
  v_contract_after text;
  v_contract_with_column text;
  v_contract_restored text;
  v_expected_legacy_fingerprint text;
  v_expected_v2_fingerprint text;
  v_expected_latest_migration_version text;
begin
  select legacy_fingerprint, v2_fingerprint, latest_migration_version
    into v_expected_legacy_fingerprint, v_expected_v2_fingerprint, v_expected_latest_migration_version
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

  select public.personal_write_guard_contract() into v_contract;
  if coalesce((v_contract->>'ok')::boolean, false) is not true
     or coalesce((v_contract->>'favoritesLimit')::integer, 0) <> 50
     or coalesce((v_contract->>'favoritePlayersLimit')::integer, 0) <> 50
     or coalesce((v_contract->>'remindersLimit')::integer, 0) <> 50
     or coalesce((v_contract->>'canonicalReminders')::boolean, false) is not true
     or coalesce((v_contract->>'explicitRearm')::boolean, false) is not true
     or coalesce((v_contract->>'reminderRetentionDays')::integer, 0) <> 90 then
    raise exception 'Supabase integration contract: personal write guard contract drifted: %', v_contract;
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
     )
     or not has_function_privilege(
       'service_role',
       'public.cleanup_sensitive_mutation_idempotency(integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_ops_event_occurrence(timestamp with time zone,text,text,text,text,text,text,text,integer,integer,jsonb)',
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
     )
     or has_function_privilege(
       'anon',
       'public.complete_sensitive_mutation(text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.complete_sensitive_mutation(text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.fail_sensitive_mutation(text,text,boolean,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.fail_sensitive_mutation(text,text,boolean,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.cleanup_sensitive_mutation_idempotency(integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.cleanup_sensitive_mutation_idempotency(integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.record_ops_event_occurrence(timestamp with time zone,text,text,text,text,text,text,text,integer,integer,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.record_ops_event_occurrence(timestamp with time zone,text,text,text,text,text,text,text,integer,integer,jsonb)',
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
     or coalesce((v_contract->>'schemaContractVersion')::integer,0) <> 2
     or coalesce((v_contract->'schema'->'privateAnalysisUsage'->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: v2 readiness/private usage contract failed: %', v_contract;
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
    where version=v_expected_latest_migration_version
  ) then
    raise exception 'Supabase integration contract: latest migration history entry missing: %',
      v_expected_latest_migration_version;
  end if;
end
$matchradar$;

-- Atomic runtime-control history lives in pg_rewrite and is not part of the
-- structural v2 fingerprint. Rename it temporarily to prove readiness fails
-- closed, then restore it without recreating the rule body.
alter rule runtime_controls_atomic_history on public.runtime_controls
  rename to issue478_atomic_history_probe;

do $atomic_history_probe$
declare
  v_security jsonb;
  v_readiness jsonb;
  v_expected text;
begin
  select public.backend_security_contract() into v_security;
  if coalesce((v_security->>'ok')::boolean,false) is true
     or not exists (
       select 1
       from jsonb_array_elements(coalesce(v_security->'rule_violations','[]'::jsonb)) item
       where item->>'reason'='atomic_history_rule_missing_or_invalid'
     ) then
    raise exception 'Supabase integration contract: missing atomic history rule was not rejected: %', v_security;
  end if;

  select v2_fingerprint into v_expected
  from issue438_contract_expectations;
  select public.backend_readiness_contract_v2(v_expected,5) into v_readiness;
  if coalesce((v_readiness->>'ok')::boolean,false) is true then
    raise exception 'Supabase integration contract: readiness stayed green without atomic history rule: %', v_readiness;
  end if;
end
$atomic_history_probe$;

alter rule issue478_atomic_history_probe on public.runtime_controls
  rename to runtime_controls_atomic_history;

do $atomic_history_restored$
declare
  v_security jsonb;
begin
  select public.backend_security_contract() into v_security;
  if coalesce((v_security->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: atomic history security contract did not recover: %', v_security;
  end if;
end
$atomic_history_restored$;

-- The structural v2 fingerprint intentionally does not include function proconfig.
-- Prove that the readiness security contract closes that gap by rejecting a
-- backend-only public function whose search_path is inherited from the session.
create function public.issue438_search_path_probe()
returns integer
language sql
security invoker
as $issue438_search_path_probe$
  select 1;
$issue438_search_path_probe$;

revoke all on function public.issue438_search_path_probe()
  from public, anon, authenticated, service_role;
grant execute on function public.issue438_search_path_probe()
  to service_role;

do $search_path_probe$
declare
  v_contract jsonb;
begin
  select public.backend_security_contract() into v_contract;

  if coalesce((v_contract->>'ok')::boolean,false) is true then
    raise exception 'Supabase integration contract: mutable function search_path was not rejected';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(
      coalesce(v_contract->'function_violations','[]'::jsonb)
    ) item
    where item->>'reason'='search_path_mutable'
      and item->>'object' like 'public.issue438_search_path_probe(%'
  ) then
    raise exception 'Supabase integration contract: search_path_mutable violation missing: %', v_contract;
  end if;
end
$search_path_probe$;

drop function public.issue438_search_path_probe();

-- Prove private durable usage drift is release-blocking even though public v2
-- fingerprint intentionally remains unchanged.
revoke usage on schema private from service_role;

do $private_usage_probe$
declare
  v_contract jsonb;
  v_expected text;
begin
  select v2_fingerprint into v_expected
  from issue438_contract_expectations;

  select public.backend_readiness_contract_v2(v_expected,5) into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is true
     or coalesce((v_contract->'schema'->'privateAnalysisUsage'->>'ok')::boolean,false) is true
     or not (coalesce(v_contract->'failureReasons','[]'::jsonb) ? 'analysis_usage_private_contract') then
    raise exception 'Supabase integration contract: private durable usage drift was not rejected: %', v_contract;
  end if;
end
$private_usage_probe$;

grant usage on schema private to service_role;

do $private_usage_restored$
declare
  v_contract jsonb;
  v_expected text;
begin
  select v2_fingerprint into v_expected
  from issue438_contract_expectations;

  select public.backend_readiness_contract_v2(v_expected,5) into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true
     or coalesce((v_contract->'schema'->'privateAnalysisUsage'->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: private durable usage readiness did not recover: %', v_contract;
  end if;
end
$private_usage_restored$;

do $search_path_restored$
declare
  v_contract jsonb;
begin
  select public.backend_security_contract() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: security contract did not recover after search-path probe: %', v_contract;
  end if;
end
$search_path_restored$;

-- Durable recovery regressions: real function bodies and transactional state.
set local role service_role;
do $durable_recovery$
declare
  v_at timestamptz := clock_timestamp();
  v_a uuid := '11111111-1111-4111-8111-111111119760';
  v_b uuid := '22222222-2222-4222-8222-222222229760';
  v_c uuid := '33333333-3333-4333-8333-333333339760';
  v_result jsonb;
  v_until timestamptz;
  v_xmin text;
  v_count integer;
begin
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_a,720,172800);
  if (v_result->>'claimed')::boolean is not true then raise exception 'Owned acquisition failed'; end if;
  v_until:=(v_result->>'lockedUntil')::timestamptz;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_a,1800,604800);
  if (v_result->>'claimed')::boolean is not true or (v_result->>'lockedUntil')::timestamptz<>v_until then
    raise exception 'An owned replay changed its horizon'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_b,720,172800);
  if (v_result->>'claimed')::boolean is not false then raise exception 'Another request adopted an owner'; end if;
  update public.scheduled_job_leases set locked_until=clock_timestamp()-interval '1 second' where job_key='issue976:owned';
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_a,720,172800);
  if (v_result->>'claimed')::boolean is not false then raise exception 'Expired replay reacquired its lease'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_b,720,172800);
  if (v_result->>'claimed')::boolean is not false then raise exception 'Denied replay acquired a lease'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_c,720,172800);
  if (v_result->>'claimed')::boolean is not true then raise exception 'Fresh request could not replace an expired owner'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_a,720,172800);
  if (v_result->>'claimed')::boolean is not false then raise exception 'Old replay replaced a newer owner'; end if;
  if public.complete_scheduled_job('issue976:owned',v_c::text) is not true then raise exception 'Owner completion failed'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:owned','issue976-global',v_at,v_c,720,172800);
  if (v_result->>'claimed')::boolean is not false then raise exception 'Completed replay acquired work again'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:other','issue976-other',v_at,v_c,720,172800);
  if v_result->>'reason'<>'invalid_input' then raise exception 'Receipt identity changed'; end if;

  v_result:=public.claim_scheduled_job_owned('issue976:new','issue976-mixed',v_at,v_a,720,172800);
  -- The UUID cannot be reused for a different logical operation.
  if v_result->>'reason'<>'invalid_input' then raise exception 'Cross-job receipt adopted'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:new','issue976-mixed',v_at,'44444444-4444-4444-8444-444444449760',720,172800);
  if (v_result->>'claimed')::boolean is not true then raise exception 'New mixed owner failed'; end if;
  v_result:=public.claim_scheduled_job('issue976:legacy','issue976-mixed',v_at,720,172800);
  if v_result->>'reason'<>'overlap' then raise exception 'Legacy bypassed new global owner'; end if;
  if public.complete_scheduled_job('issue976:new','44444444-4444-4444-8444-444444449760') is not true then raise exception 'Mixed owner completion failed'; end if;
  v_result:=public.claim_scheduled_job('issue976:legacy','issue976-mixed',v_at,720,172800);
  if (v_result->>'claimed')::boolean is not true then raise exception 'Legacy fresh acquisition failed'; end if;
  v_result:=public.claim_scheduled_job_owned('issue976:blocked','issue976-mixed',v_at,'55555555-5555-4555-8555-555555559760',720,172800);
  if v_result->>'reason'<>'overlap' then raise exception 'New owner bypassed legacy global owner'; end if;

  -- Cleanup is bounded and keeps an active owner's proof even with old expiry.
  update public.scheduled_job_claim_receipts set expires_at=v_at-interval '1 hour'
    where request_token='44444444-4444-4444-8444-444444449760';
  update public.scheduled_job_leases set status='running',locked_until=v_at+interval '1 hour'
    where job_key='issue976:new';
  insert into public.scheduled_job_claim_receipts(request_token,job_key,group_key,scheduled_at,result,expires_at)
    select md5('issue976-expired-'||n)::uuid,'issue976:expired:'||n,'issue976-expired',v_at,'{"claimed":false}',v_at-interval '1 hour'
    from generate_series(1,100) n;
  v_result:=public.claim_scheduled_job_owned('issue976:cleanup','issue976-cleanup',v_at,'66666666-6666-4666-8666-666666669760',720,172800);
  select count(*) into v_count from public.scheduled_job_claim_receipts where group_key='issue976-expired';
  if v_count<>68 or not exists(select 1 from public.scheduled_job_claim_receipts where request_token='44444444-4444-4444-8444-444444449760') then
    raise exception 'Receipt cleanup exceeded its bound or removed active proof'; end if;

  v_result:=public.write_analysis_cache_versioned('issue976:cache',0,'{"a":1,"b":2}',v_at+interval '1 hour','test',null,'unknown',v_at);
  if (v_result->>'stored')::boolean is not true then raise exception 'Cache write failed'; end if;
  select xmin::text into v_xmin from public.analysis_cache where cache_key='issue976:cache';
  v_result:=public.write_analysis_cache_versioned('issue976:cache',0,'{"b":2,"a":1}',v_at+interval '1 hour','test',null,'unknown',v_at);
  if v_result->>'reason'<>'same' or (select xmin::text from public.analysis_cache where cache_key='issue976:cache')<>v_xmin then raise exception 'Identical cache replay rewrote its row'; end if;
  v_result:=public.write_analysis_cache_versioned('issue976:cache',0,'{"a":3}',v_at+interval '1 hour','test',null,'unknown',v_at+interval '1 second');
  v_result:=public.write_analysis_cache_versioned('issue976:cache',0,'{"a":1}',v_at+interval '1 hour','test',null,'unknown',v_at);
  if (v_result->>'stored')::boolean is not false then raise exception 'Stale cache replay reported durability'; end if;
  update public.analysis_cache set payload='{"a":0}',updated_at=v_at where cache_key='issue976:cache';
  if (select payload from public.analysis_cache where cache_key='issue976:cache')<>'{"a":3}'::jsonb then raise exception 'Legacy delayed write replaced new cache'; end if;
  -- Actual post-match finalization uses a conditional PATCH without updated_at.
  update public.analysis_cache set payload='{"state":"sent"}',expires_at=v_at+interval '2 hours'
    where cache_key='issue976:cache' and payload='{"a":3}';
  get diagnostics v_count=row_count;
  if v_count<>1 or (select payload->>'state' from public.analysis_cache where cache_key='issue976:cache')<>'sent' then raise exception 'Post-match sent marker was blocked'; end if;
end
$durable_recovery$;
reset role;

do $durable_contract$
declare v_before jsonb; v_after jsonb;
begin
  if has_function_privilege('anon','public.claim_scheduled_job_owned(text,text,timestamptz,uuid,integer,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.write_analysis_cache_versioned(text,bigint,jsonb,timestamptz,text,timestamptz,text,timestamptz)','EXECUTE')
    or has_table_privilege('anon','public.scheduled_job_claim_receipts','SELECT')
    or has_table_privilege('authenticated','public.scheduled_job_claim_receipts','UPDATE') then raise exception 'Recovery data exposed to frontend roles'; end if;
  v_before:=public.backend_schema_contract_v2();
  grant execute on function public.claim_scheduled_job_owned(text,text,timestamptz,uuid,integer,integer) to anon;
  v_after:=public.backend_schema_contract_v2();
  if v_after->>'fingerprint'=v_before->>'fingerprint' or v_after->>'baseFingerprint'<>v_before->>'baseFingerprint' then raise exception 'Recovery grant drift escaped full fingerprint'; end if;
  revoke execute on function public.claim_scheduled_job_owned(text,text,timestamptz,uuid,integer,integer) from anon;
  alter table public.scheduled_job_claim_receipts disable row level security;
  if public.backend_schema_contract_v2()->>'fingerprint'=v_before->>'fingerprint' then raise exception 'Recovery RLS drift escaped fingerprint'; end if;
  alter table public.scheduled_job_claim_receipts enable row level security;
  grant select on public.users to anon;
  v_after:=public.backend_schema_contract_v2();
  if v_after->>'fingerprint'=v_before->>'fingerprint' or v_after->>'recoveryFingerprint'<>v_before->>'recoveryFingerprint' then raise exception 'Unrelated base grant drift escaped full fingerprint'; end if;
  revoke select on public.users from anon;
  if public.backend_schema_contract_v2()->>'fingerprint'<>v_before->>'fingerprint' then raise exception 'Contract did not recover after drift tests'; end if;
end
$durable_contract$;

rollback;

select 'MatchRadar executable Supabase schema contract passed.' as result;
