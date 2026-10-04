\set ON_ERROR_STOP on

do $matchradar$
declare
  v_contract jsonb;
begin
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

  select public.backend_schema_fingerprint() into v_contract;
  if coalesce((v_contract->>'ok')::boolean,false) is not true then
    raise exception 'Supabase integration contract: backend schema fingerprint failed';
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
    where version='20260101001700'
  ) then
    raise exception 'Supabase integration contract: latest migration history entry missing';
  end if;
end
$matchradar$;

select 'MatchRadar executable Supabase schema contract passed.' as result;
