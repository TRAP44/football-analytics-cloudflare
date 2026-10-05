-- MatchRadar v6.28 / durable analysis usage compensation (#467)
-- Backward-compatible rollout:
--   * the durable ledger lives in an unexposed private schema;
--   * existing public RPC signatures stay unchanged;
--   * legacy callers keep the legacy behavior;
--   * durable behavior is opt-in through internal Worker request headers.
--
-- This keeps backend_schema_contract_v2 stable while giving the new Worker
-- an idempotent reserve/commit/refund lifecycle for quota and limited Pass usage.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.analysis_usage_reservations (
  operation_id uuid primary key,
  kind text not null check (kind in ('quota','pass')),
  telegram_id bigint not null check (telegram_id > 0),
  usage_date date,
  entitlement_id bigint,
  fixture_id bigint,
  status text not null default 'reserved'
    check (status in ('reserved','committed','refunded')),
  reserved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  check (
    (kind = 'quota' and usage_date is not null and entitlement_id is null)
    or
    (kind = 'pass' and usage_date is null and entitlement_id is not null and entitlement_id > 0)
  )
);

create index if not exists analysis_usage_reservations_status_age_idx
  on private.analysis_usage_reservations(status, reserved_at);

create index if not exists analysis_usage_reservations_user_idx
  on private.analysis_usage_reservations(telegram_id, status, reserved_at desc);

alter table private.analysis_usage_reservations enable row level security;
revoke all privileges on table private.analysis_usage_reservations
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table private.analysis_usage_reservations
  to service_role;

comment on table private.analysis_usage_reservations is
  'Backend-only idempotency ledger for AI analysis quota and limited Pass reservations. No raw Telegram initData, API keys, request bodies, or payment secrets are stored.';

create or replace function private.analysis_usage_request_headers()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_raw text;
begin
  v_raw := current_setting('request.headers', true);
  if v_raw is null or btrim(v_raw) = '' then
    return '{}'::jsonb;
  end if;

  begin
    return v_raw::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
end;
$$;

revoke all on function private.analysis_usage_request_headers()
  from public, anon, authenticated;
grant execute on function private.analysis_usage_request_headers()
  to service_role;

create or replace function private.finalize_analysis_usage_reservation(
  p_operation_id uuid,
  p_disposition text,
  p_expected_kind text default null,
  p_expected_telegram_id bigint default null,
  p_expected_usage_date date default null,
  p_expected_entitlement_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.analysis_usage_reservations%rowtype;
  v_action text := lower(btrim(coalesce(p_disposition, '')));
  v_target_status text;
  v_used integer := null;
begin
  if p_operation_id is null or v_action not in ('commit','refund') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select *
  into v_row
  from private.analysis_usage_reservations
  where operation_id = p_operation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'operation_not_found');
  end if;

  if p_expected_kind is not null and v_row.kind <> p_expected_kind then
    return jsonb_build_object('ok', false, 'reason', 'operation_kind_mismatch');
  end if;
  if p_expected_telegram_id is not null and v_row.telegram_id <> p_expected_telegram_id then
    return jsonb_build_object('ok', false, 'reason', 'operation_user_mismatch');
  end if;
  if p_expected_usage_date is not null and v_row.usage_date is distinct from p_expected_usage_date then
    return jsonb_build_object('ok', false, 'reason', 'operation_usage_date_mismatch');
  end if;
  if p_expected_entitlement_id is not null and v_row.entitlement_id is distinct from p_expected_entitlement_id then
    return jsonb_build_object('ok', false, 'reason', 'operation_entitlement_mismatch');
  end if;

  v_target_status := case when v_action = 'commit' then 'committed' else 'refunded' end;

  if v_row.status = v_target_status then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'status', v_target_status,
      'operationId', v_row.operation_id
    );
  end if;

  if v_row.status <> 'reserved' then
    return jsonb_build_object(
      'ok', false,
      'reason', 'operation_state_conflict',
      'status', v_row.status,
      'operationId', v_row.operation_id
    );
  end if;

  if v_action = 'refund' and v_row.kind = 'quota' then
    update public.usage_daily
    set analyses = greatest(0, analyses - 1),
        updated_at = now()
    where telegram_id = v_row.telegram_id
      and usage_date = v_row.usage_date
      and analyses > 0
    returning analyses into v_used;

    if v_used is null then
      select analyses
      into v_used
      from public.usage_daily
      where telegram_id = v_row.telegram_id
        and usage_date = v_row.usage_date;
    end if;
  elsif v_action = 'refund' and v_row.kind = 'pass' then
    update public.user_entitlements
    set usage_count = greatest(0, usage_count - 1),
        updated_at = now()
    where id = v_row.entitlement_id
      and telegram_id = v_row.telegram_id
      and usage_limit is not null
      and usage_count > 0
    returning usage_count into v_used;

    if v_used is null then
      select usage_count
      into v_used
      from public.user_entitlements
      where id = v_row.entitlement_id
        and telegram_id = v_row.telegram_id;
    end if;
  end if;

  update private.analysis_usage_reservations
  set status = v_target_status,
      updated_at = now(),
      finalized_at = now()
  where operation_id = v_row.operation_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'status', v_target_status,
    'operationId', v_row.operation_id,
    'used', coalesce(v_used, 0)
  );
end;
$$;

revoke all on function private.finalize_analysis_usage_reservation(uuid,text,text,bigint,date,bigint)
  from public, anon, authenticated;
grant execute on function private.finalize_analysis_usage_reservation(uuid,text,text,bigint,date,bigint)
  to service_role;

create or replace function private.reconcile_analysis_usage_reservations(
  p_stale_seconds integer default 1800,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
declare
  v_stale_seconds integer := greatest(300, least(coalesce(p_stale_seconds,1800),86400));
  v_limit integer := greatest(1, least(coalesce(p_limit,100),500));
  v_row private.analysis_usage_reservations%rowtype;
  v_result jsonb;
  v_reconciled integer := 0;
  v_failed integer := 0;
  v_pending integer := 0;
  v_cleaned integer := 0;
begin
  for v_row in
    select *
    from private.analysis_usage_reservations
    where status = 'reserved'
      and reserved_at <= now() - make_interval(secs => v_stale_seconds)
    order by reserved_at
    limit v_limit
    for update skip locked
  loop
    begin
      v_result := private.finalize_analysis_usage_reservation(
        v_row.operation_id,
        'refund',
        v_row.kind,
        v_row.telegram_id,
        v_row.usage_date,
        v_row.entitlement_id
      );

      if coalesce((v_result->>'ok')::boolean, false)
         and v_result->>'status' = 'refunded' then
        v_reconciled := v_reconciled + 1;
      else
        v_failed := v_failed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  delete from private.analysis_usage_reservations
  where ctid in (
    select ctid
    from private.analysis_usage_reservations
    where status in ('committed','refunded')
      and finalized_at < now() - interval '30 days'
    order by finalized_at
    limit 500
  );
  get diagnostics v_cleaned = row_count;

  select count(*)
  into v_pending
  from private.analysis_usage_reservations
  where status = 'reserved';

  return jsonb_build_object(
    'ok', v_failed = 0,
    'reconciliation', true,
    'reconciled', v_reconciled,
    'failed', v_failed,
    'pending', v_pending,
    'cleaned', v_cleaned
  );
end;
$$;

revoke all on function private.reconcile_analysis_usage_reservations(integer,integer)
  from public, anon, authenticated;
grant execute on function private.reconcile_analysis_usage_reservations(integer,integer)
  to service_role;

create or replace function public.consume_analysis_quota(
  p_telegram_id bigint,
  p_usage_date date,
  p_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_used integer;
  v_headers jsonb := private.analysis_usage_request_headers();
  v_durable boolean := lower(coalesce(v_headers->>'x-analysis-usage-lifecycle','')) = 'durable-v1';
  v_operation_text text := lower(btrim(coalesce(v_headers->>'x-analysis-operation-id','')));
  v_operation_id uuid;
  v_existing private.analysis_usage_reservations%rowtype;
begin
  if p_telegram_id is null or p_telegram_id <= 0 or p_usage_date is null or p_limit is null or p_limit < 1 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', greatest(coalesce(p_limit,0),0), 'reason', 'invalid_input');
  end if;

  if v_durable then
    if v_operation_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('allowed', false, 'used', 0, 'limit', p_limit, 'reason', 'invalid_operation_id');
    end if;
    v_operation_id := v_operation_text::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text, 0));

    select *
    into v_existing
    from private.analysis_usage_reservations
    where operation_id = v_operation_id
    for update;

    if found then
      if v_existing.kind <> 'quota'
         or v_existing.telegram_id <> p_telegram_id
         or v_existing.usage_date is distinct from p_usage_date then
        return jsonb_build_object('allowed', false, 'used', 0, 'limit', p_limit, 'reason', 'operation_conflict');
      end if;

      select analyses
      into v_used
      from public.usage_daily
      where telegram_id = p_telegram_id and usage_date = p_usage_date;

      if v_existing.status in ('reserved','committed') then
        return jsonb_build_object(
          'allowed', true,
          'reserved', true,
          'durable', true,
          'operationId', v_operation_id,
          'used', coalesce(v_used,0),
          'limit', p_limit,
          'reason', 'duplicate_' || v_existing.status
        );
      end if;

      return jsonb_build_object(
        'allowed', false,
        'reserved', false,
        'durable', true,
        'operationId', v_operation_id,
        'used', coalesce(v_used,0),
        'limit', p_limit,
        'reason', 'operation_refunded'
      );
    end if;
  end if;

  insert into public.users(telegram_id)
  values (p_telegram_id)
  on conflict (telegram_id) do nothing;

  insert into public.usage_daily(telegram_id, usage_date, analyses, updated_at)
  values (p_telegram_id, p_usage_date, 1, now())
  on conflict (telegram_id, usage_date)
  do update set
    analyses = public.usage_daily.analyses + 1,
    updated_at = now()
  where public.usage_daily.analyses < p_limit
  returning analyses into v_used;

  if v_used is null then
    select analyses into v_used
    from public.usage_daily
    where telegram_id = p_telegram_id and usage_date = p_usage_date;

    return jsonb_build_object(
      'allowed', false,
      'reserved', false,
      'durable', v_durable,
      'operationId', case when v_durable then v_operation_id else null end,
      'used', coalesce(v_used,0),
      'limit', p_limit,
      'reason', 'quota_exhausted'
    );
  end if;

  if v_durable then
    insert into private.analysis_usage_reservations(
      operation_id, kind, telegram_id, usage_date, status, reserved_at, updated_at
    )
    values (
      v_operation_id, 'quota', p_telegram_id, p_usage_date, 'reserved', now(), now()
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reserved', true,
    'durable', v_durable,
    'operationId', case when v_durable then v_operation_id else null end,
    'used', v_used,
    'limit', p_limit,
    'reason', case when v_durable then 'reserved_durable' else 'reserved' end
  );
end;
$$;

create or replace function public.refund_analysis_quota(
  p_telegram_id bigint,
  p_usage_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_used integer;
  v_headers jsonb := private.analysis_usage_request_headers();
  v_durable boolean := lower(coalesce(v_headers->>'x-analysis-usage-lifecycle','')) = 'durable-v1';
  v_action text := lower(btrim(coalesce(v_headers->>'x-analysis-usage-action','')));
  v_operation_text text := lower(btrim(coalesce(v_headers->>'x-analysis-operation-id','')));
  v_operation_id uuid;
begin
  if v_durable and v_action = 'reconcile' then
    return private.reconcile_analysis_usage_reservations(1800, 100);
  end if;

  if v_durable then
    if v_action not in ('commit','refund')
       or v_operation_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_lifecycle_request');
    end if;
    v_operation_id := v_operation_text::uuid;
    return private.finalize_analysis_usage_reservation(
      v_operation_id,
      v_action,
      'quota',
      p_telegram_id,
      p_usage_date,
      null
    );
  end if;

  update public.usage_daily
  set analyses = greatest(0, analyses - 1),
      updated_at = now()
  where telegram_id = p_telegram_id
    and usage_date = p_usage_date
    and analyses > 0
  returning analyses into v_used;

  if v_used is null then
    select analyses into v_used
    from public.usage_daily
    where telegram_id = p_telegram_id and usage_date = p_usage_date;
  end if;

  return jsonb_build_object('used', coalesce(v_used,0), 'refunded', true);
end;
$$;

create or replace function public.consume_pass_entitlement(
  p_telegram_id bigint,
  p_entitlement_id bigint,
  p_fixture_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_row public.user_entitlements%rowtype;
  v_now timestamptz := now();
  v_headers jsonb := private.analysis_usage_request_headers();
  v_durable boolean := lower(coalesce(v_headers->>'x-analysis-usage-lifecycle','')) = 'durable-v1';
  v_operation_text text := lower(btrim(coalesce(v_headers->>'x-analysis-operation-id','')));
  v_operation_id uuid;
  v_existing private.analysis_usage_reservations%rowtype;
begin
  if p_telegram_id is null or p_telegram_id <= 0
     or p_entitlement_id is null or p_entitlement_id <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  if v_durable then
    if v_operation_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('allowed', false, 'reason', 'invalid_operation_id');
    end if;
    v_operation_id := v_operation_text::uuid;
    perform pg_advisory_xact_lock(hashtextextended(v_operation_id::text, 0));

    select *
    into v_existing
    from private.analysis_usage_reservations
    where operation_id = v_operation_id
    for update;

    if found then
      if v_existing.kind <> 'pass'
         or v_existing.telegram_id <> p_telegram_id
         or v_existing.entitlement_id is distinct from p_entitlement_id
         or coalesce(v_existing.fixture_id,0) <> coalesce(p_fixture_id,0) then
        return jsonb_build_object('allowed', false, 'reason', 'operation_conflict');
      end if;

      select *
      into v_row
      from public.user_entitlements
      where id = p_entitlement_id
        and telegram_id = p_telegram_id;

      if v_existing.status in ('reserved','committed') then
        return jsonb_build_object(
          'allowed', true,
          'reserved', true,
          'durable', true,
          'operationId', v_operation_id,
          'reason', 'duplicate_' || v_existing.status,
          'entitlementId', p_entitlement_id,
          'usageCount', coalesce(v_row.usage_count,0),
          'usageLimit', v_row.usage_limit,
          'expiresAt', v_row.expires_at
        );
      end if;

      return jsonb_build_object(
        'allowed', false,
        'reserved', false,
        'durable', true,
        'operationId', v_operation_id,
        'reason', 'operation_refunded',
        'entitlementId', p_entitlement_id
      );
    end if;
  end if;

  select *
  into v_row
  from public.user_entitlements
  where id = p_entitlement_id
    and telegram_id = p_telegram_id
  for update;

  if not found then return jsonb_build_object('allowed', false, 'reason', 'not_found'); end if;
  if v_row.status <> 'active' then return jsonb_build_object('allowed', false, 'reason', v_row.status); end if;
  if v_row.starts_at > v_now then return jsonb_build_object('allowed', false, 'reason', 'not_started'); end if;
  if v_row.expires_at <= v_now then return jsonb_build_object('allowed', false, 'reason', 'expired'); end if;
  if v_row.entitlement_type = 'MATCH_PASS' and coalesce(p_fixture_id, 0) <> v_row.fixture_id then
    return jsonb_build_object('allowed', false, 'reason', 'fixture_mismatch');
  end if;
  if v_row.usage_limit is not null and v_row.usage_count >= v_row.usage_limit then
    return jsonb_build_object('allowed', false, 'reason', 'usage_exhausted');
  end if;

  if v_row.usage_limit is null then
    return jsonb_build_object(
      'allowed', true,
      'reserved', false,
      'durable', false,
      'reason', 'unlimited',
      'entitlementId', v_row.id,
      'usageCount', v_row.usage_count,
      'usageLimit', v_row.usage_limit,
      'expiresAt', v_row.expires_at
    );
  end if;

  update public.user_entitlements
  set usage_count = usage_count + 1,
      updated_at = v_now
  where id = v_row.id
  returning usage_count into v_row.usage_count;

  if v_durable then
    insert into private.analysis_usage_reservations(
      operation_id, kind, telegram_id, entitlement_id, fixture_id, status, reserved_at, updated_at
    )
    values (
      v_operation_id, 'pass', p_telegram_id, p_entitlement_id, p_fixture_id, 'reserved', v_now, v_now
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reserved', true,
    'durable', v_durable,
    'operationId', case when v_durable then v_operation_id else null end,
    'reason', case when v_durable then 'consumed_durable' else 'consumed' end,
    'entitlementId', v_row.id,
    'usageCount', v_row.usage_count,
    'usageLimit', v_row.usage_limit,
    'expiresAt', v_row.expires_at
  );
end;
$$;

create or replace function public.refund_pass_entitlement_usage(
  p_telegram_id bigint,
  p_entitlement_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_count integer;
  v_headers jsonb := private.analysis_usage_request_headers();
  v_durable boolean := lower(coalesce(v_headers->>'x-analysis-usage-lifecycle','')) = 'durable-v1';
  v_action text := lower(btrim(coalesce(v_headers->>'x-analysis-usage-action','')));
  v_operation_text text := lower(btrim(coalesce(v_headers->>'x-analysis-operation-id','')));
  v_operation_id uuid;
begin
  if p_telegram_id is null or p_telegram_id <= 0
     or p_entitlement_id is null or p_entitlement_id <= 0 then
    return jsonb_build_object('updated', false, 'reason', 'invalid_input');
  end if;

  if v_durable then
    if v_action not in ('commit','refund')
       or v_operation_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_lifecycle_request');
    end if;
    v_operation_id := v_operation_text::uuid;
    return private.finalize_analysis_usage_reservation(
      v_operation_id,
      v_action,
      'pass',
      p_telegram_id,
      null,
      p_entitlement_id
    );
  end if;

  update public.user_entitlements
  set usage_count = greatest(0, usage_count - 1),
      updated_at = now()
  where id = p_entitlement_id
    and telegram_id = p_telegram_id
    and usage_limit is not null
    and usage_count > 0
  returning usage_count into v_count;

  if v_count is null then
    return jsonb_build_object('updated', false, 'reason', 'not_refundable');
  end if;

  return jsonb_build_object(
    'updated', true,
    'reason', 'refunded',
    'entitlementId', p_entitlement_id,
    'usageCount', v_count
  );
end;
$$;

-- Preserve the established service-role-only RPC boundary after replacement.
revoke all on function public.consume_analysis_quota(bigint,date,integer)
  from public, anon, authenticated;
revoke all on function public.refund_analysis_quota(bigint,date)
  from public, anon, authenticated;
revoke all on function public.consume_pass_entitlement(bigint,bigint,bigint)
  from public, anon, authenticated;
revoke all on function public.refund_pass_entitlement_usage(bigint,bigint)
  from public, anon, authenticated;

grant execute on function public.consume_analysis_quota(bigint,date,integer)
  to service_role;
grant execute on function public.refund_analysis_quota(bigint,date)
  to service_role;
grant execute on function public.consume_pass_entitlement(bigint,bigint,bigint)
  to service_role;
grant execute on function public.refund_pass_entitlement_usage(bigint,bigint)
  to service_role;

notify pgrst, 'reload schema';
