-- MatchRadar v6.29.4 / sensitive mutation lease-retention hardening
-- Forward hotfix for v6.27.
--
-- Active inflight ownership must never expire from retention before its lease
-- ends. This patch also protects legacy rows whose expires_at is already earlier
-- than locked_until by making cleanup and duplicate-claim logic lease-aware.
--
-- Public signatures, function volatility/security attributes and grants remain
-- unchanged, so established legacy and v2 schema fingerprints stay valid.

create or replace function public.claim_sensitive_mutation(
  p_operation_key text,
  p_actor_id bigint,
  p_method text,
  p_path text,
  p_request_digest text,
  p_idempotency_key_hash text default null,
  p_lease_seconds integer default 300,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,300),600));
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_token text := md5(
    coalesce(p_operation_key,'') || ':' || v_now::text || ':' || random()::text
  );
  v_existing public.sensitive_mutation_idempotency%rowtype;
  v_rows integer := 0;
begin
  -- Retention must cover the complete ownership window.
  v_retention_seconds := greatest(v_retention_seconds, v_lease_seconds);

  if p_operation_key is null or p_operation_key !~ '^[0-9a-f]{64}$'
     or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$'
     or p_actor_id is null or p_actor_id <= 0
     or p_method not in ('POST','PUT','PATCH','DELETE')
     or p_path is null or p_path !~ '^/api/' or char_length(p_path) > 160
     or (
       p_idempotency_key_hash is not null
       and p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     ) then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'invalid_input'
    );
  end if;

  -- Bounded opportunistic retention cleanup. Never delete a still-owned
  -- inflight row, including legacy rows with expires_at < locked_until.
  delete from public.sensitive_mutation_idempotency
  where ctid in (
    select ctid
    from public.sensitive_mutation_idempotency
    where expires_at <= v_now
      and (
        state <> 'inflight'
        or locked_until is null
        or locked_until <= v_now
      )
    order by expires_at
    limit 32
  );

  insert into public.sensitive_mutation_idempotency (
    operation_key,
    actor_id,
    method,
    path,
    request_digest,
    idempotency_key_hash,
    state,
    retryable,
    lease_token,
    locked_until,
    expires_at,
    created_at,
    last_claimed_at
  )
  values (
    p_operation_key,
    p_actor_id,
    p_method,
    p_path,
    p_request_digest,
    p_idempotency_key_hash,
    'inflight',
    false,
    v_token,
    v_now + make_interval(secs => v_lease_seconds),
    v_now + make_interval(secs => v_retention_seconds),
    v_now,
    v_now
  )
  on conflict (operation_key) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return jsonb_build_object(
      'claimed', true,
      'state', 'inflight',
      'reason', 'claimed',
      'leaseToken', v_token,
      'lockedUntil', v_now + make_interval(secs => v_lease_seconds),
      'expiresAt', v_now + make_interval(secs => v_retention_seconds)
    );
  end if;

  select *
  into v_existing
  from public.sensitive_mutation_idempotency
  where operation_key = p_operation_key
  for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'claim_race'
    );
  end if;

  if v_existing.actor_id <> p_actor_id
     or v_existing.method <> p_method
     or v_existing.path <> p_path
     or v_existing.request_digest <> p_request_digest
     or v_existing.idempotency_key_hash is distinct from p_idempotency_key_hash then
    return jsonb_build_object(
      'claimed', false,
      'state', v_existing.state,
      'reason', 'request_conflict'
    );
  end if;

  if v_existing.state = 'completed' and v_existing.expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'completed',
      'reason', 'duplicate_completed',
      'expiresAt', v_existing.expires_at
    );
  end if;

  -- Active ownership is authoritative even if a legacy row has an earlier
  -- retention timestamp.
  if v_existing.state = 'inflight'
     and v_existing.locked_until is not null
     and v_existing.locked_until > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'inflight',
      'reason', 'duplicate_inflight',
      'lockedUntil', v_existing.locked_until,
      'expiresAt', v_existing.expires_at
    );
  end if;

  if v_existing.state = 'failed'
     and not v_existing.retryable
     and v_existing.expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'duplicate_failed',
      'expiresAt', v_existing.expires_at
    );
  end if;

  update public.sensitive_mutation_idempotency
  set state='inflight',
      retryable=false,
      lease_token=v_token,
      locked_until=v_now + make_interval(secs => v_lease_seconds),
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      last_claimed_at=v_now,
      completed_at=null,
      failed_at=null
  where operation_key=p_operation_key;

  return jsonb_build_object(
    'claimed', true,
    'state', 'inflight',
    'reason', case
      when v_existing.state='failed' and v_existing.retryable then 'retry_failed'
      else 'reclaimed'
    end,
    'leaseToken', v_token,
    'lockedUntil', v_now + make_interval(secs => v_lease_seconds),
    'expiresAt', v_now + make_interval(secs => v_retention_seconds)
  );
end;
$$;

create or replace function public.cleanup_sensitive_mutation_idempotency(
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),5000));
  v_now timestamptz := clock_timestamp();
  v_rows integer := 0;
begin
  delete from public.sensitive_mutation_idempotency
  where ctid in (
    select ctid
    from public.sensitive_mutation_idempotency
    where expires_at <= v_now
      and (
        state <> 'inflight'
        or locked_until is null
        or locked_until <= v_now
      )
    order by expires_at
    limit v_limit
  );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_sensitive_mutation_idempotency(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) to service_role;
grant execute on function public.cleanup_sensitive_mutation_idempotency(integer)
  to service_role;

comment on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) is
  'Atomic sensitive-mutation ownership claim with retention guaranteed to cover the active lease.';
comment on function public.cleanup_sensitive_mutation_idempotency(integer) is
  'Bounded cleanup for expired sensitive-mutation rows that preserves active inflight lease ownership.';

notify pgrst, 'reload schema';
