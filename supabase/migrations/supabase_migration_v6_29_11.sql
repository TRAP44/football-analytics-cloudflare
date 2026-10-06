-- MatchRadar v6.29.11 / sensitive mutation finalization lease ownership
-- Forward hotfix for v6.27/v6.29.4.
--
-- Terminal settlement is valid only while the caller still owns the active
-- lease. Expired owners must fail closed and let a fresh claimant decide the
-- operation outcome. Public signatures, return shapes, attributes and grants
-- remain unchanged, so established fingerprints stay valid.

create or replace function public.complete_sensitive_mutation(
  p_operation_key text,
  p_lease_token text,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_rows integer := 0;
begin
  update public.sensitive_mutation_idempotency
  set state='completed',
      retryable=false,
      locked_until=null,
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      completed_at=v_now,
      failed_at=null
  where operation_key=p_operation_key
    and state='inflight'
    and lease_token=p_lease_token
    and locked_until is not null
    and locked_until>v_now;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok',v_rows=1,'updated',v_rows=1,'state','completed');
end;
$$;

create or replace function public.fail_sensitive_mutation(
  p_operation_key text,
  p_lease_token text,
  p_retryable boolean,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_rows integer := 0;
begin
  update public.sensitive_mutation_idempotency
  set state='failed',
      retryable=coalesce(p_retryable,false),
      locked_until=null,
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      failed_at=v_now,
      completed_at=null
  where operation_key=p_operation_key
    and state='inflight'
    and lease_token=p_lease_token
    and locked_until is not null
    and locked_until>v_now;

  get diagnostics v_rows = row_count;
  return jsonb_build_object(
    'ok',v_rows=1,
    'updated',v_rows=1,
    'state','failed',
    'retryable',coalesce(p_retryable,false)
  );
end;
$$;

revoke all on function public.complete_sensitive_mutation(text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_sensitive_mutation(text,text,boolean,integer)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_sensitive_mutation(text,text,integer)
  to service_role;
grant execute on function public.fail_sensitive_mutation(text,text,boolean,integer)
  to service_role;

comment on function public.complete_sensitive_mutation(text,text,integer) is
  'Marks a sensitive mutation completed only while the caller still owns an active lease.';
comment on function public.fail_sensitive_mutation(text,text,boolean,integer) is
  'Marks a sensitive mutation failed only while the caller still owns an active lease.';

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
  'Service-role-only security/readiness audit covering public grants/RLS/function safety, atomic runtime history, the Provider SLO read boundary and active-lease sensitive mutation finalization.';


notify pgrst, 'reload schema';
