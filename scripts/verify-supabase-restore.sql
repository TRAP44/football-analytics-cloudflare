\set ON_ERROR_STOP on

-- MatchRadar isolated Supabase restore acceptance.
-- Runs only against the disposable local Supabase database created by CI.

do $$
declare
  table_name text;
  qualified_name text;
  rls_enabled boolean;
  v_contract jsonb;
begin
  foreach table_name in array array[
    'users',
    'analysis_cache',
    'runtime_controls',
    'match_reminders',
    'billing_payments',
    'favorite_players',
    'smart_notification_deliveries',
    'user_entitlements'
  ]
  loop
    qualified_name := format('public.%I', table_name);

    if to_regclass(qualified_name) is null then
      raise exception 'restore acceptance: required table % is missing', qualified_name;
    end if;

    select c.relrowsecurity
      into rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = table_name
       and c.relkind in ('r', 'p');

    if coalesce(rls_enabled, false) is not true then
      raise exception 'restore acceptance: RLS is not enabled for %', qualified_name;
    end if;

    if has_table_privilege('anon', qualified_name, 'SELECT')
       or has_table_privilege('anon', qualified_name, 'INSERT')
       or has_table_privilege('anon', qualified_name, 'UPDATE')
       or has_table_privilege('anon', qualified_name, 'DELETE') then
      raise exception 'restore acceptance: anon has direct table privileges on %', qualified_name;
    end if;

    if has_table_privilege('authenticated', qualified_name, 'SELECT')
       or has_table_privilege('authenticated', qualified_name, 'INSERT')
       or has_table_privilege('authenticated', qualified_name, 'UPDATE')
       or has_table_privilege('authenticated', qualified_name, 'DELETE') then
      raise exception 'restore acceptance: authenticated has direct table privileges on %', qualified_name;
    end if;

    if not has_table_privilege('service_role', qualified_name, 'SELECT') then
      raise exception 'restore acceptance: service_role cannot read %', qualified_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ) then
    raise exception 'restore acceptance: a public table is missing RLS after restore hardening';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'::name), ('authenticated'::name)) roles(role_name)
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (
        has_table_privilege(roles.role_name::text, c.oid, 'SELECT')
        or has_table_privilege(roles.role_name::text, c.oid, 'INSERT')
        or has_table_privilege(roles.role_name::text, c.oid, 'UPDATE')
        or has_table_privilege(roles.role_name::text, c.oid, 'DELETE')
        or has_table_privilege(roles.role_name::text, c.oid, 'TRUNCATE')
        or has_table_privilege(roles.role_name::text, c.oid, 'REFERENCES')
        or has_table_privilege(roles.role_name::text, c.oid, 'TRIGGER')
      )
  ) then
    raise exception 'restore acceptance: anon/authenticated received unexpected public-schema table privileges';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'::name), ('authenticated'::name)) roles(role_name)
    where n.nspname = 'public'
      and c.relkind = 'S'
      and (
        has_sequence_privilege(roles.role_name::text, c.oid, 'USAGE')
        or has_sequence_privilege(roles.role_name::text, c.oid, 'SELECT')
        or has_sequence_privilege(roles.role_name::text, c.oid, 'UPDATE')
      )
  ) then
    raise exception 'restore acceptance: anon/authenticated received unexpected public-schema sequence privileges';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'::name), ('authenticated'::name)) roles(role_name)
    where n.nspname = 'public'
      and has_function_privilege(roles.role_name::text, p.oid, 'EXECUTE')
  ) then
    raise exception 'restore acceptance: anon/authenticated received unexpected public-schema function EXECUTE';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        not has_table_privilege('service_role', c.oid, 'SELECT')
        or not has_table_privilege('service_role', c.oid, 'INSERT')
        or not has_table_privilege('service_role', c.oid, 'UPDATE')
        or not has_table_privilege('service_role', c.oid, 'DELETE')
      )
  ) then
    raise exception 'restore acceptance: service_role is missing CRUD privileges on a public table';
  end if;

  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'user_entitlements'
       and c.contype = 'p'
  ) then
    raise exception 'restore acceptance: user_entitlements primary key is missing';
  end if;

  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'user_entitlements'
       and c.contype = 'f'
       and pg_get_constraintdef(c.oid, true) like '%users%'
  ) then
    raise exception 'restore acceptance: user_entitlements -> users foreign key is missing';
  end if;

  if to_regprocedure('public.backend_schema_fingerprint()') is null then
    raise exception 'restore acceptance: backend_schema_fingerprint() is missing';
  end if;

  if to_regprocedure('public.backend_security_contract()') is null then
    raise exception 'restore acceptance: backend_security_contract() is missing';
  end if;

  if to_regprocedure('public.backend_default_acl_contract()') is null then
    raise exception 'restore acceptance: backend_default_acl_contract() is missing';
  end if;

  if to_regprocedure('public.backend_schema_contract_v2()') is null then
    raise exception 'restore acceptance: backend_schema_contract_v2() is missing';
  end if;

  if to_regprocedure('public.backend_readiness_contract_v2(text,integer)') is null then
    raise exception 'restore acceptance: backend_readiness_contract_v2(text,integer) is missing';
  end if;

  if to_regclass('private.analysis_usage_reservations') is null then
    raise exception 'restore acceptance: private.analysis_usage_reservations is missing';
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'restore acceptance: anon/authenticated can access private schema';
  end if;

  if not has_schema_privilege('service_role', 'private', 'USAGE')
     or not has_table_privilege('service_role', 'private.analysis_usage_reservations', 'SELECT')
     or not has_table_privilege('service_role', 'private.analysis_usage_reservations', 'INSERT')
     or not has_table_privilege('service_role', 'private.analysis_usage_reservations', 'UPDATE')
     or not has_table_privilege('service_role', 'private.analysis_usage_reservations', 'DELETE') then
    raise exception 'restore acceptance: service_role private analysis ledger privileges are incomplete';
  end if;

  select public.backend_schema_contract_v2() into v_contract;
  if coalesce((v_contract->>'ok')::boolean, false) is not true
     or coalesce((v_contract->>'version')::integer, 0) <> 2
     or coalesce(v_contract->>'fingerprint', '') !~ '^[0-9a-f]{32}
    raise exception 'restore acceptance: backend_security_contract() failed';
  end if;

  if coalesce((public.backend_default_acl_contract()->>'ok')::boolean, false) is not true then
    raise exception 'restore acceptance: backend_default_acl_contract() failed';
  end if;
end
$$;

select public.backend_schema_fingerprint();
select public.backend_schema_contract_v2();
select public.backend_security_contract();
select public.backend_default_acl_contract();

     or coalesce((v_contract->>'parts')::integer, 0) <= 0 then
    raise exception 'restore acceptance: backend_schema_contract_v2() returned an invalid contract';
  end if;

  if coalesce((public.backend_security_contract()->>'ok')::boolean, false) is not true then
    raise exception 'restore acceptance: backend_security_contract() failed';
  end if;

  if coalesce((public.backend_default_acl_contract()->>'ok')::boolean, false) is not true then
    raise exception 'restore acceptance: backend_default_acl_contract() failed';
  end if;
end
$$;

select public.backend_schema_fingerprint();
select public.backend_security_contract();
select public.backend_default_acl_contract();
