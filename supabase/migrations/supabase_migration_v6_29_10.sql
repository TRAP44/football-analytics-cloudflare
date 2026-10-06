-- MatchRadar v6.29.10 / provider SLO reader semantic readiness hardening
-- Forward hotfix for v6.29.3.
--
-- Function bodies are intentionally outside backend_schema_contract_v2. Keep the
-- established fingerprints unchanged and make the provider SLO reader's STABLE
-- time boundary an explicit backend security/readiness invariant.

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
  'Service-role-only public-schema security/readiness audit covering RLS, grants, SECURITY DEFINER, mutable function search_path, the atomic runtime-control history rule and the statement-stable Provider SLO read boundary.';

notify pgrst, 'reload schema';
