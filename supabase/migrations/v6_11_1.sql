-- Football Analytics v6.11.1 / RC19
-- Verifies default privileges for the roles that own application relations.
-- Supabase platform-owned defaults are intentionally outside this contract.

create or replace function public.backend_default_acl_contract()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
with application_owners as (
  select distinct c.relowner as owner_oid
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
violations as (
  select
    pg_catalog.pg_get_userbyid(d.defaclrole)::text as owner_role,
    case d.defaclobjtype
      when 'r' then 'table'
      when 'S' then 'sequence'
      when 'f' then 'function'
      else d.defaclobjtype::text
    end as object_type,
    coalesce(r.rolname, 'PUBLIC')::text as grantee,
    acl.privilege_type::text as privilege_type
  from pg_catalog.pg_default_acl d
  join application_owners owners on owners.owner_oid = d.defaclrole
  join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and d.defaclobjtype in ('r', 'S', 'f')
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
contract as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'owner_role', owner_role,
        'object_type', object_type,
        'grantee', grantee,
        'privilege', privilege_type
      )
      order by owner_role, object_type, grantee, privilege_type
    ),
    '[]'::jsonb
  ) as items
  from violations
)
select jsonb_build_object(
  'ok', jsonb_array_length(items) = 0,
  'checked_at', current_timestamp,
  'default_acl_violations', items
)
from contract;
$$;

revoke all on function public.backend_default_acl_contract() from public, anon, authenticated;
grant execute on function public.backend_default_acl_contract() to service_role;

comment on function public.backend_default_acl_contract() is
  'RC19 service-role-only audit of default ACLs for roles that own public application relations.';

notify pgrst, 'reload schema';
