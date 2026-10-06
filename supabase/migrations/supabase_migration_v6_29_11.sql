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

notify pgrst, 'reload schema';
