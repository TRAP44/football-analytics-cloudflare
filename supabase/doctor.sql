-- MatchRadar / Football Analytics Supabase doctor
-- READ-ONLY: this file performs only SELECT queries.
-- It is safe to run from the Supabase SQL editor for diagnostics.
-- Compare backend_schema_contract_v2().fingerprint with ../release-contract.json.

select 'backend_schema_contract_v2' as section, public.backend_schema_contract_v2() as payload;
select 'backend_security_contract' as section, public.backend_security_contract() as payload;
select 'backend_default_acl_contract' as section, public.backend_default_acl_contract() as payload;
select 'personal_write_guard_contract' as section, public.personal_write_guard_contract() as payload;

-- RLS without policies is not automatically a vulnerability.
-- This report distinguishes deny-by-default backend-only tables from tables
-- that are actually exposed to anon/authenticated via grants.
with public_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p')
),
policy_counts as (
  select tablename, count(*)::integer as policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
  group by tablename
)
select
  t.relname as table_name,
  t.relrowsecurity as rls_enabled,
  coalesce(p.policy_count, 0) as policy_count,
  pg_catalog.has_table_privilege('anon', t.oid, 'SELECT') as anon_select,
  pg_catalog.has_table_privilege('anon', t.oid, 'INSERT') as anon_insert,
  pg_catalog.has_table_privilege('anon', t.oid, 'UPDATE') as anon_update,
  pg_catalog.has_table_privilege('anon', t.oid, 'DELETE') as anon_delete,
  pg_catalog.has_table_privilege('authenticated', t.oid, 'SELECT') as authenticated_select,
  pg_catalog.has_table_privilege('authenticated', t.oid, 'INSERT') as authenticated_insert,
  pg_catalog.has_table_privilege('authenticated', t.oid, 'UPDATE') as authenticated_update,
  pg_catalog.has_table_privilege('authenticated', t.oid, 'DELETE') as authenticated_delete
from public_tables t
left join policy_counts p on p.tablename = t.relname
where t.relrowsecurity
  and coalesce(p.policy_count, 0) = 0
order by t.relname;

-- Public functions must not be SECURITY DEFINER and must pin search_path.
select
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f','p')
  and (
    p.prosecdef
    or not exists (
      select 1
      from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
      where cfg.setting like 'search_path=%'
    )
  )
order by p.proname, arguments;

-- Public views should use security_invoker=true.
select
  c.relname as view_name,
  c.reloptions
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and not (coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true'])
order by c.relname;

-- service_role is intentionally limited to DML on public tables.
select
  c.relname as table_name,
  pg_catalog.has_table_privilege('service_role', c.oid, 'TRUNCATE') as has_truncate,
  pg_catalog.has_table_privilege('service_role', c.oid, 'REFERENCES') as has_references,
  pg_catalog.has_table_privilege('service_role', c.oid, 'TRIGGER') as has_trigger
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p','v','m','f')
  and (
    pg_catalog.has_table_privilege('service_role', c.oid, 'TRUNCATE')
    or pg_catalog.has_table_privilege('service_role', c.oid, 'REFERENCES')
    or pg_catalog.has_table_privilege('service_role', c.oid, 'TRIGGER')
  )
order by c.relname;

-- Remote rollout history summary. Repository filenames are intentionally not 1:1
-- with production rollout names; use schema contracts for correctness.
select
  count(*)::integer as remote_migration_count,
  min(version) as first_remote_version,
  max(version) as last_remote_version
from supabase_migrations.schema_migrations;
