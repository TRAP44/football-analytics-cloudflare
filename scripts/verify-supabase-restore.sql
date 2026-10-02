-- MatchRadar isolated Supabase restore acceptance.
-- Runs only against the disposable local Supabase database created by CI.

do $$
declare
  table_name text;
  qualified_name text;
  rls_enabled boolean;
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
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then
    raise exception 'restore acceptance: anon/authenticated received unexpected public-schema write privileges';
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
end
$$;

select public.backend_schema_fingerprint();
