-- Football Analytics v6.11 / RC19
-- Locks the public schema to the Cloudflare Worker service role and exposes a
-- machine-readable security contract for release gates.

-- The browser never talks to Supabase directly. Keep schema discovery usable,
-- but prevent public object creation and all direct data access.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

do $$
declare
  relation record;
begin
  for relation in
    select n.nspname, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %I.%I enable row level security', relation.nspname, relation.relname);
  end loop;
end;
$$;

revoke all privileges on all tables in schema public from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Stop future migrations from silently recreating the old broad grants.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

create or replace function public.backend_security_contract()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
with schema_violations as (
  select
    n.nspname::text as object_name,
    format('grant:%s:%s', coalesce(r.rolname, 'PUBLIC'), acl.privilege_type)::text as reason
  from pg_catalog.pg_namespace n
  cross join lateral pg_catalog.aclexplode(
    coalesce(n.nspacl, pg_catalog.acldefault('n'::"char", n.nspowner))
  ) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and acl.privilege_type = 'CREATE'
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
table_violations as (
  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    'rls_disabled'::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity

  union

  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    'view_not_security_invoker'::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and not (coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true'])

  union

  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    format('grant:%s:%s', coalesce(r.rolname, 'PUBLIC'), acl.privilege_type)::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))
  ) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
sequence_violations as (
  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    format('grant:%s:%s', coalesce(r.rolname, 'PUBLIC'), acl.privilege_type)::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('S'::"char", c.relowner))
  ) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and c.relkind = 'S'
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
function_violations as (
  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))::text as object_name,
    'security_definer'::text as reason
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and p.prosecdef

  union

  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))::text as object_name,
    format('grant:%s:%s', coalesce(r.rolname, 'PUBLIC'), acl.privilege_type)::text as reason
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f'::"char", p.proowner))
  ) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
contract as (
  select
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from schema_violations), '[]'::jsonb) as schema_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from table_violations), '[]'::jsonb) as table_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from sequence_violations), '[]'::jsonb) as sequence_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from function_violations), '[]'::jsonb) as function_items
)
select jsonb_build_object(
  'ok', jsonb_array_length(schema_items) = 0
    and jsonb_array_length(table_items) = 0
    and jsonb_array_length(sequence_items) = 0
    and jsonb_array_length(function_items) = 0,
  'checked_at', current_timestamp,
  'schema_violations', schema_items,
  'table_violations', table_items,
  'sequence_violations', sequence_items,
  'function_violations', function_items
)
from contract;
$$;

revoke all on function public.backend_security_contract() from public, anon, authenticated;
grant execute on function public.backend_security_contract() to service_role;

comment on function public.backend_security_contract() is
  'RC19 service-role-only audit of public-schema RLS, relation grants, sequence grants and RPC execution security.';

notify pgrst, 'reload schema';
