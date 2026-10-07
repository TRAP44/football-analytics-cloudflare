-- MatchRadar v6.29.12 / service-role privilege boundary convergence
-- Forward hardening for the RC19 default-ACL contract.
--
-- Production had retained Supabase-created broad service_role defaults. Later
-- tables therefore inherited TRUNCATE/REFERENCES/TRIGGER/MAINTAIN and sequences
-- inherited UPDATE even though the application contract only needs DML on
-- tables and USAGE/SELECT on sequences. Normalize current objects and defaults,
-- then make both release gates reject a regression.

revoke all privileges on all tables in schema public from service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

revoke all privileges on all sequences in schema public from service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on tables from service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

alter default privileges for role postgres in schema public
  revoke all privileges on functions from service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

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
    and (
      acl.grantee = 0
      or r.rolname in ('anon', 'authenticated')
      or (
        r.rolname = 'service_role'
        and (
          acl.is_grantable
          or (d.defaclobjtype = 'r' and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
          or (d.defaclobjtype = 'S' and acl.privilege_type not in ('USAGE', 'SELECT'))
          or (d.defaclobjtype = 'f' and acl.privilege_type <> 'EXECUTE')
        )
      )
    )
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
  'Service-role-only audit of application-owner default ACLs, including forbidden service_role privileges.';

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

  union

  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    case
      when acl.is_grantable then format('grant:service_role:%s:grant_option', acl.privilege_type)
      else format('grant:service_role:%s', acl.privilege_type)
    end::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r'::"char", c.relowner))
  ) acl
  join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and r.rolname = 'service_role'
    and (
      acl.is_grantable
      or acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
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

  union

  select
    format('%I.%I', n.nspname, c.relname)::text as object_name,
    case
      when acl.is_grantable then format('grant:service_role:%s:grant_option', acl.privilege_type)
      else format('grant:service_role:%s', acl.privilege_type)
    end::text as reason
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('S'::"char", c.relowner))
  ) acl
  join pg_catalog.pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and c.relkind = 'S'
    and r.rolname = 'service_role'
    and (
      acl.is_grantable
      or acl.privilege_type not in ('USAGE', 'SELECT')
    )
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
    'search_path_mutable'::text as reason
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (
      select 1
      from pg_catalog.unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
      where cfg.setting like 'search_path=%'
    )

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

  union

  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))::text as object_name,
    'provider_slo_read_boundary_drift'::text as reason
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and p.proname='read_provider_slo_buckets'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)=
      'p_since timestamp with time zone, p_until timestamp with time zone, p_limit integer'
    and (
      p.provolatile <> 's'
      or lower(pg_catalog.pg_get_functiondef(p.oid)) not like '%statement_timestamp()%'
      or lower(pg_catalog.pg_get_functiondef(p.oid)) like '%clock_timestamp()%'
    )

  union

  select
    format('%I.%I(%s)', n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))::text as object_name,
    'sensitive_mutation_finalizer_lease_guard_drift'::text as reason
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and (
      (p.proname='complete_sensitive_mutation'
        and pg_catalog.pg_get_function_identity_arguments(p.oid)=
          'p_operation_key text, p_lease_token text, p_retention_seconds integer')
      or
      (p.proname='fail_sensitive_mutation'
        and pg_catalog.pg_get_function_identity_arguments(p.oid)=
          'p_operation_key text, p_lease_token text, p_retryable boolean, p_retention_seconds integer')
    )
    and (
      pg_catalog.regexp_replace(
        lower(pg_catalog.pg_get_functiondef(p.oid)),
        '[[:space:]]+',
        '',
        'g'
      ) not like '%andlocked_untilisnotnull%'
      or pg_catalog.regexp_replace(
        lower(pg_catalog.pg_get_functiondef(p.oid)),
        '[[:space:]]+',
        '',
        'g'
      ) not like '%andlocked_until>v_now%'
    )
),
rule_violations as (
  select
    'public.runtime_controls.runtime_controls_atomic_history'::text as object_name,
    'atomic_history_rule_missing_or_invalid'::text as reason
  where not exists (
    select 1
    from pg_catalog.pg_rewrite r
    where r.ev_class = 'public.runtime_controls'::regclass
      and r.rulename = 'runtime_controls_atomic_history'
      and r.ev_type = '2'
      and not r.is_instead
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%on update to public.runtime_controls%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%old.revision is distinct from new.revision%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%insert into runtime_control_history%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%x-runtime-action%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%x-runtime-reason-hex%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%x-runtime-app-version%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%x-runtime-source-revision%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%requestedaction%'
      and lower(pg_catalog.pg_get_ruledef(r.oid, false)) like '%lockdown_release%'
  )
),
contract as (
  select
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from schema_violations), '[]'::jsonb) as schema_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from table_violations), '[]'::jsonb) as table_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from sequence_violations), '[]'::jsonb) as sequence_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from function_violations), '[]'::jsonb) as function_items,
    coalesce((select jsonb_agg(jsonb_build_object('object', object_name, 'reason', reason) order by object_name, reason) from rule_violations), '[]'::jsonb) as rule_items
)
select jsonb_build_object(
  'ok', jsonb_array_length(schema_items) = 0
    and jsonb_array_length(table_items) = 0
    and jsonb_array_length(sequence_items) = 0
    and jsonb_array_length(function_items) = 0
    and jsonb_array_length(rule_items) = 0,
  'checked_at', current_timestamp,
  'schema_violations', schema_items,
  'table_violations', table_items,
  'sequence_violations', sequence_items,
  'function_violations', function_items,
  'rule_violations', rule_items
)
from contract;
$$;

revoke all on function public.backend_security_contract()
  from public, anon, authenticated, service_role;
grant execute on function public.backend_security_contract()
  to service_role;

comment on function public.backend_security_contract() is
  'Service-role-only security/readiness audit covering least-privilege public grants/RLS/function safety, atomic runtime history, the Provider SLO read boundary and active-lease sensitive mutation finalization.';

do $$
declare
  v_security jsonb;
  v_default_acl jsonb;
begin
  select public.backend_security_contract() into v_security;
  select public.backend_default_acl_contract() into v_default_acl;

  if not coalesce((v_security->>'ok')::boolean, false) then
    raise exception 'v6.29.12 backend security contract failed: %', v_security;
  end if;
  if not coalesce((v_default_acl->>'ok')::boolean, false) then
    raise exception 'v6.29.12 default ACL contract failed: %', v_default_acl;
  end if;
end;
$$;

notify pgrst, 'reload schema';
