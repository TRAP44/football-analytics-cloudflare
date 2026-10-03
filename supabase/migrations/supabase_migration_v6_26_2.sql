-- MatchRadar v6.26.2 / Provider distributed SLO aggregation and alert lease recovery
-- Issue #405. Additive/backward-compatible with the already running v6.26/v6.26.1 Worker.
-- Existing v1 alert claim RPC remains available for rollback compatibility.

create table if not exists public.provider_slo_buckets (
  bucket_started_at timestamptz not null,
  provider text not null,
  operation text not null,
  attempts bigint not null default 0 check (attempts >= 0),
  requests bigint not null default 0 check (requests >= 0),
  successes bigint not null default 0 check (successes >= 0),
  failures bigint not null default 0 check (failures >= 0),
  retries bigint not null default 0 check (retries >= 0),
  timeouts bigint not null default 0 check (timeouts >= 0),
  network_errors bigint not null default 0 check (network_errors >= 0),
  rate_limits bigint not null default 0 check (rate_limits >= 0),
  http_errors bigint not null default 0 check (http_errors >= 0),
  invalid_responses bigint not null default 0 check (invalid_responses >= 0),
  latency_sum_ms bigint not null default 0 check (latency_sum_ms >= 0),
  latency_samples bigint not null default 0 check (latency_samples >= 0),
  max_latency_ms integer not null default 0 check (max_latency_ms >= 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_started_at, provider, operation),
  check (char_length(provider) between 1 and 80),
  check (char_length(operation) between 1 and 180)
);

create index if not exists provider_slo_buckets_updated_idx
  on public.provider_slo_buckets(updated_at desc);

alter table public.provider_slo_buckets enable row level security;
revoke all privileges on table public.provider_slo_buckets
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.provider_slo_buckets
  to service_role;

create or replace function public.record_provider_slo_observation(
  p_provider text,
  p_operation text,
  p_outcome text,
  p_error_type text default null,
  p_latency_ms integer default null,
  p_observed_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_bucket timestamptz;
  v_provider text := left(btrim(coalesce(p_provider,'provider')),80);
  v_operation text := left(btrim(coalesce(p_operation,'unknown')),180);
  v_outcome text := lower(btrim(coalesce(p_outcome,'')));
  v_error text := upper(btrim(coalesce(p_error_type,'')));
  v_latency integer := greatest(0, least(coalesce(p_latency_ms,0),120000));
  v_request bigint := 0;
  v_success bigint := 0;
  v_failure bigint := 0;
  v_retry bigint := 0;
  v_timeout bigint := 0;
  v_network bigint := 0;
  v_rate_limit bigint := 0;
  v_http bigint := 0;
  v_invalid bigint := 0;
begin
  if v_provider='' or v_operation='' or v_outcome not in ('retrying','success','failed','rate_limited') then
    return jsonb_build_object('ok',false,'reason','invalid_input');
  end if;

  v_bucket := date_trunc('hour',v_now)
    + floor(extract(minute from v_now) / 15) * interval '15 minutes';

  if v_outcome='retrying' then
    v_retry := 1;
  else
    v_request := 1;
    if v_outcome='success' then
      v_success := 1;
    else
      v_failure := 1;
    end if;
  end if;

  if v_outcome<>'success' then
    if v_error in ('PROVIDER_TIMEOUT','UPSTREAM_TIMEOUT') then
      v_timeout := case when v_outcome='retrying' then 0 else 1 end;
    elsif v_error in ('PROVIDER_NETWORK_ERROR','FOOTBALL_NETWORK') then
      v_network := case when v_outcome='retrying' then 0 else 1 end;
    elsif v_error in ('PROVIDER_RATE_LIMITED','FOOTBALL_RATE_LIMIT','FOOTBALL_RATE_LIMIT_BODY') or v_outcome='rate_limited' then
      v_rate_limit := case when v_outcome='retrying' then 0 else 1 end;
    elsif v_error in ('PROVIDER_INVALID_RESPONSE','FOOTBALL_INVALID_RESPONSE') then
      v_invalid := case when v_outcome='retrying' then 0 else 1 end;
    elsif v_error in ('PROVIDER_HTTP_ERROR','FOOTBALL_HTTP','FOOTBALL_RESPONSE') then
      v_http := case when v_outcome='retrying' then 0 else 1 end;
    end if;
  end if;

  insert into public.provider_slo_buckets(
    bucket_started_at,provider,operation,
    attempts,requests,successes,failures,retries,timeouts,network_errors,
    rate_limits,http_errors,invalid_responses,latency_sum_ms,latency_samples,max_latency_ms,updated_at
  )
  values(
    v_bucket,v_provider,v_operation,
    1,v_request,v_success,v_failure,v_retry,v_timeout,v_network,
    v_rate_limit,v_http,v_invalid,v_latency,1,v_latency,clock_timestamp()
  )
  on conflict (bucket_started_at,provider,operation) do update
  set attempts=public.provider_slo_buckets.attempts+excluded.attempts,
      requests=public.provider_slo_buckets.requests+excluded.requests,
      successes=public.provider_slo_buckets.successes+excluded.successes,
      failures=public.provider_slo_buckets.failures+excluded.failures,
      retries=public.provider_slo_buckets.retries+excluded.retries,
      timeouts=public.provider_slo_buckets.timeouts+excluded.timeouts,
      network_errors=public.provider_slo_buckets.network_errors+excluded.network_errors,
      rate_limits=public.provider_slo_buckets.rate_limits+excluded.rate_limits,
      http_errors=public.provider_slo_buckets.http_errors+excluded.http_errors,
      invalid_responses=public.provider_slo_buckets.invalid_responses+excluded.invalid_responses,
      latency_sum_ms=public.provider_slo_buckets.latency_sum_ms+excluded.latency_sum_ms,
      latency_samples=public.provider_slo_buckets.latency_samples+excluded.latency_samples,
      max_latency_ms=greatest(public.provider_slo_buckets.max_latency_ms,excluded.max_latency_ms),
      updated_at=clock_timestamp();

  return jsonb_build_object(
    'ok',true,
    'bucketStartedAt',v_bucket,
    'provider',v_provider,
    'operation',v_operation
  );
end;
$$;

create or replace function public.read_provider_slo_buckets(
  p_since timestamptz,
  p_until timestamptz default null,
  p_limit integer default 5000
)
returns table(
  bucket_started_at timestamptz,
  provider text,
  operation text,
  attempts bigint,
  requests bigint,
  successes bigint,
  failures bigint,
  retries bigint,
  timeouts bigint,
  network_errors bigint,
  rate_limits bigint,
  http_errors bigint,
  invalid_responses bigint,
  latency_sum_ms bigint,
  latency_samples bigint,
  max_latency_ms integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.bucket_started_at,b.provider,b.operation,
    b.attempts,b.requests,b.successes,b.failures,b.retries,b.timeouts,b.network_errors,
    b.rate_limits,b.http_errors,b.invalid_responses,b.latency_sum_ms,b.latency_samples,
    b.max_latency_ms,b.updated_at
  from public.provider_slo_buckets b
  where b.bucket_started_at >= p_since
    and b.bucket_started_at < coalesce(p_until,clock_timestamp())
  order by b.bucket_started_at asc,b.provider asc,b.operation asc
  limit greatest(1,least(coalesce(p_limit,5000),10000));
$$;

create or replace function public.provider_slo_aggregation_contract()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select jsonb_build_object(
  'ok',
    to_regclass('public.provider_slo_buckets') is not null
    and to_regprocedure('public.record_provider_slo_observation(text,text,text,text,integer,timestamp with time zone)') is not null
    and to_regprocedure('public.read_provider_slo_buckets(timestamp with time zone,timestamp with time zone,integer)') is not null,
  'version','v1',
  'table',to_regclass('public.provider_slo_buckets') is not null,
  'recordRpc',to_regprocedure('public.record_provider_slo_observation(text,text,text,text,integer,timestamp with time zone)') is not null,
  'readRpc',to_regprocedure('public.read_provider_slo_buckets(timestamp with time zone,timestamp with time zone,integer)') is not null
);
$$;

-- Expand the delivery-state machine without removing any existing state.
alter table public.provider_incident_alert_deliveries
  drop constraint if exists provider_incident_alert_deliveries_status_check;
alter table public.provider_incident_alert_deliveries
  add constraint provider_incident_alert_deliveries_status_check
  check (status in ('claimed','sending','sent','retry_pending','terminal_failed','unknown'));

-- v1 remains for the currently running/rollback Worker. It still acquires directly into "sending",
-- but it can safely recover an expired v2 "claimed" row after rollback.

create or replace function public.claim_provider_incident_alert_delivery(
  p_incident_id text,
  p_transition text,
  p_alert_key text,
  p_destination_key text,
  p_destination_slot integer,
  p_max_attempts integer default 3,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts,3), 10));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,120), 900));
  v_row public.provider_incident_alert_deliveries%rowtype;
begin
  if p_incident_id is null or btrim(p_incident_id) = ''
     or p_transition is null or btrim(p_transition) = ''
     or p_alert_key is null or btrim(p_alert_key) = ''
     or p_destination_key is null or char_length(btrim(p_destination_key)) < 8
     or p_destination_slot is null or p_destination_slot < 0 then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'invalid_input',
      'attempts', 0
    );
  end if;

  insert into public.provider_incident_alert_deliveries(
    incident_id,
    transition,
    alert_key,
    destination_key,
    destination_slot,
    status,
    attempts,
    claimed_at,
    locked_until,
    created_at,
    updated_at
  )
  values (
    left(btrim(p_incident_id),200),
    left(btrim(p_transition),80),
    left(btrim(p_alert_key),280),
    left(btrim(p_destination_key),160),
    p_destination_slot,
    'sending',
    1,
    v_now,
    v_now + make_interval(secs => v_lease_seconds),
    v_now,
    v_now
  )
  on conflict do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'acquired', true,
      'status', 'sending',
      'reason', 'created',
      'attempts', v_row.attempts,
      'retryAt', null
    );
  end if;

  select *
  into v_row
  from public.provider_incident_alert_deliveries
  where alert_key = left(btrim(p_alert_key),280)
    and destination_key = left(btrim(p_destination_key),160)
  for update;

  if not found then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'identity_conflict',
      'attempts', 0
    );
  end if;

  if v_row.incident_id <> left(btrim(p_incident_id),200)
     or v_row.transition <> left(btrim(p_transition),80) then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'identity_mismatch',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'sent' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'sent',
      'reason', 'already_sent',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'terminal_failed' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'terminal_failed',
      'reason', 'terminal_failure',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'unknown' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'unknown',
      'reason', 'ambiguous_delivery_suppressed',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'claimed' then
    if v_row.attempts >= v_max_attempts then
      update public.provider_incident_alert_deliveries
      set status='terminal_failed',
          terminal_at=coalesce(terminal_at,v_now),
          locked_until=null,
          last_error_code=coalesce(last_error_code,'MAX_ATTEMPTS'),
          last_error=coalesce(last_error,'Maximum automatic delivery attempts reached.'),
          updated_at=v_now
      where id=v_row.id
      returning * into v_row;
      return jsonb_build_object('acquired',false,'status','terminal_failed','reason','max_attempts','attempts',v_row.attempts);
    end if;

    if v_row.locked_until is not null and v_row.locked_until > v_now then
      return jsonb_build_object('acquired',false,'status','claimed','reason','in_flight','attempts',v_row.attempts);
    end if;

    update public.provider_incident_alert_deliveries
    set status='sending',
        attempts=attempts+1,
        claimed_at=v_now,
        locked_until=v_now + make_interval(secs => v_lease_seconds),
        updated_at=v_now
    where id=v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'acquired',true,'status','sending','reason','stale_claim_reclaimed',
      'attempts',v_row.attempts,'retryAt',null
    );
  end if;

  if v_row.status = 'sending' then
    if v_row.locked_until is null or v_row.locked_until <= v_now then
      update public.provider_incident_alert_deliveries
      set status = 'unknown',
          unknown_at = v_now,
          locked_until = null,
          last_error_code = 'STALE_SENDING_LEASE',
          last_error = 'Delivery lease expired before the Telegram result was durably finalized.',
          updated_at = v_now
      where id = v_row.id
      returning * into v_row;

      return jsonb_build_object(
        'acquired', false,
        'status', 'unknown',
        'reason', 'stale_sending_lease',
        'attempts', v_row.attempts
      );
    end if;

    return jsonb_build_object(
      'acquired', false,
      'status', 'sending',
      'reason', 'in_flight',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'retry_pending' then
    if v_row.attempts >= v_max_attempts then
      update public.provider_incident_alert_deliveries
      set status = 'terminal_failed',
          retry_at = null,
          terminal_at = coalesce(terminal_at,v_now),
          locked_until = null,
          last_error_code = coalesce(last_error_code,'MAX_ATTEMPTS'),
          last_error = coalesce(last_error,'Maximum automatic delivery attempts reached.'),
          updated_at = v_now
      where id = v_row.id
      returning * into v_row;

      return jsonb_build_object(
        'acquired', false,
        'status', 'terminal_failed',
        'reason', 'max_attempts',
        'attempts', v_row.attempts
      );
    end if;

    if v_row.retry_at is not null and v_row.retry_at > v_now then
      return jsonb_build_object(
        'acquired', false,
        'status', 'retry_pending',
        'reason', 'retry_not_due',
        'attempts', v_row.attempts,
        'retryAt', v_row.retry_at
      );
    end if;

    update public.provider_incident_alert_deliveries
    set status = 'sending',
        attempts = attempts + 1,
        claimed_at = v_now,
        locked_until = v_now + make_interval(secs => v_lease_seconds),
        retry_at = null,
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'acquired', true,
      'status', 'sending',
      'reason', 'retry_acquired',
      'attempts', v_row.attempts,
      'retryAt', null
    );
  end if;

  return jsonb_build_object(
    'acquired', false,
    'status', coalesce(v_row.status,'invalid'),
    'reason', 'unsupported_state',
    'attempts', v_row.attempts
  );
end;
$$;


create or replace function public.claim_provider_incident_alert_delivery_v2(
  p_incident_id text,
  p_transition text,
  p_alert_key text,
  p_destination_key text,
  p_destination_slot integer,
  p_max_attempts integer default 3,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts,3), 10));
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,120), 900));
  v_row public.provider_incident_alert_deliveries%rowtype;
begin
  if p_incident_id is null or btrim(p_incident_id) = ''
     or p_transition is null or btrim(p_transition) = ''
     or p_alert_key is null or btrim(p_alert_key) = ''
     or p_destination_key is null or char_length(btrim(p_destination_key)) < 8
     or p_destination_slot is null or p_destination_slot < 0 then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'invalid_input',
      'attempts', 0
    );
  end if;

  insert into public.provider_incident_alert_deliveries(
    incident_id,
    transition,
    alert_key,
    destination_key,
    destination_slot,
    status,
    attempts,
    claimed_at,
    locked_until,
    created_at,
    updated_at
  )
  values (
    left(btrim(p_incident_id),200),
    left(btrim(p_transition),80),
    left(btrim(p_alert_key),280),
    left(btrim(p_destination_key),160),
    p_destination_slot,
    'claimed',
    1,
    v_now,
    v_now + make_interval(secs => v_lease_seconds),
    v_now,
    v_now
  )
  on conflict do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'acquired', true,
      'status', 'claimed',
      'reason', 'created',
      'attempts', v_row.attempts,
      'retryAt', null
    );
  end if;

  select *
  into v_row
  from public.provider_incident_alert_deliveries
  where alert_key = left(btrim(p_alert_key),280)
    and destination_key = left(btrim(p_destination_key),160)
  for update;

  if not found then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'identity_conflict',
      'attempts', 0
    );
  end if;

  if v_row.incident_id <> left(btrim(p_incident_id),200)
     or v_row.transition <> left(btrim(p_transition),80) then
    return jsonb_build_object(
      'acquired', false,
      'status', 'invalid',
      'reason', 'identity_mismatch',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'sent' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'sent',
      'reason', 'already_sent',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'terminal_failed' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'terminal_failed',
      'reason', 'terminal_failure',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'unknown' then
    return jsonb_build_object(
      'acquired', false,
      'status', 'unknown',
      'reason', 'ambiguous_delivery_suppressed',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'claimed' then
    if v_row.attempts >= v_max_attempts then
      update public.provider_incident_alert_deliveries
      set status='terminal_failed',
          terminal_at=coalesce(terminal_at,v_now),
          locked_until=null,
          last_error_code=coalesce(last_error_code,'MAX_ATTEMPTS'),
          last_error=coalesce(last_error,'Maximum automatic delivery attempts reached.'),
          updated_at=v_now
      where id=v_row.id
      returning * into v_row;
      return jsonb_build_object('acquired',false,'status','terminal_failed','reason','max_attempts','attempts',v_row.attempts);
    end if;

    if v_row.locked_until is not null and v_row.locked_until > v_now then
      return jsonb_build_object('acquired',false,'status','claimed','reason','in_flight','attempts',v_row.attempts);
    end if;

    update public.provider_incident_alert_deliveries
    set status='claimed',
        attempts=attempts+1,
        claimed_at=v_now,
        locked_until=v_now + make_interval(secs => v_lease_seconds),
        updated_at=v_now
    where id=v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'acquired',true,'status','claimed','reason','stale_claim_reclaimed',
      'attempts',v_row.attempts,'retryAt',null
    );
  end if;

  if v_row.status = 'sending' then
    if v_row.locked_until is null or v_row.locked_until <= v_now then
      update public.provider_incident_alert_deliveries
      set status = 'unknown',
          unknown_at = v_now,
          locked_until = null,
          last_error_code = 'STALE_SENDING_LEASE',
          last_error = 'Delivery lease expired before the Telegram result was durably finalized.',
          updated_at = v_now
      where id = v_row.id
      returning * into v_row;

      return jsonb_build_object(
        'acquired', false,
        'status', 'unknown',
        'reason', 'stale_sending_lease',
        'attempts', v_row.attempts
      );
    end if;

    return jsonb_build_object(
      'acquired', false,
      'status', 'sending',
      'reason', 'in_flight',
      'attempts', v_row.attempts
    );
  end if;

  if v_row.status = 'retry_pending' then
    if v_row.attempts >= v_max_attempts then
      update public.provider_incident_alert_deliveries
      set status = 'terminal_failed',
          retry_at = null,
          terminal_at = coalesce(terminal_at,v_now),
          locked_until = null,
          last_error_code = coalesce(last_error_code,'MAX_ATTEMPTS'),
          last_error = coalesce(last_error,'Maximum automatic delivery attempts reached.'),
          updated_at = v_now
      where id = v_row.id
      returning * into v_row;

      return jsonb_build_object(
        'acquired', false,
        'status', 'terminal_failed',
        'reason', 'max_attempts',
        'attempts', v_row.attempts
      );
    end if;

    if v_row.retry_at is not null and v_row.retry_at > v_now then
      return jsonb_build_object(
        'acquired', false,
        'status', 'retry_pending',
        'reason', 'retry_not_due',
        'attempts', v_row.attempts,
        'retryAt', v_row.retry_at
      );
    end if;

    update public.provider_incident_alert_deliveries
    set status = 'claimed',
        attempts = attempts + 1,
        claimed_at = v_now,
        locked_until = v_now + make_interval(secs => v_lease_seconds),
        retry_at = null,
        updated_at = v_now
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'acquired', true,
      'status', 'claimed',
      'reason', 'retry_acquired',
      'attempts', v_row.attempts,
      'retryAt', null
    );
  end if;

  return jsonb_build_object(
    'acquired', false,
    'status', coalesce(v_row.status,'invalid'),
    'reason', 'unsupported_state',
    'attempts', v_row.attempts
  );
end;
$$;


create or replace function public.begin_provider_incident_alert_delivery_send(
  p_alert_key text,
  p_destination_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.provider_incident_alert_deliveries%rowtype;
begin
  update public.provider_incident_alert_deliveries
  set status='sending',
      updated_at=v_now
  where alert_key=left(btrim(coalesce(p_alert_key,'')),280)
    and destination_key=left(btrim(coalesce(p_destination_key,'')),160)
    and status='claimed'
    and locked_until is not null
    and locked_until>v_now
  returning * into v_row;

  if found then
    return jsonb_build_object('ok',true,'status','sending','attempts',v_row.attempts);
  end if;

  select * into v_row
  from public.provider_incident_alert_deliveries
  where alert_key=left(btrim(coalesce(p_alert_key,'')),280)
    and destination_key=left(btrim(coalesce(p_destination_key,'')),160);

  if not found then
    return jsonb_build_object('ok',false,'status','missing','reason','missing');
  end if;

  return jsonb_build_object(
    'ok',false,
    'status',v_row.status,
    'reason',case
      when v_row.status='claimed' and (v_row.locked_until is null or v_row.locked_until<=v_now) then 'claim_lease_expired'
      else 'not_claimed'
    end,
    'attempts',v_row.attempts
  );
end;
$$;

create or replace function public.provider_incident_alert_delivery_contract()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with checks as (
  select
    to_regclass('public.provider_incident_alert_deliveries') is not null as table_ok,
    to_regprocedure('public.claim_provider_incident_alert_delivery(text,text,text,text,integer,integer,integer)') is not null as claim_v1_ok,
    to_regprocedure('public.claim_provider_incident_alert_delivery_v2(text,text,text,text,integer,integer,integer)') is not null as claim_v2_ok,
    to_regprocedure('public.begin_provider_incident_alert_delivery_send(text,text)') is not null as begin_ok,
    to_regprocedure('public.finalize_provider_incident_alert_delivery(text,text,text,timestamp with time zone,integer,text,text)') is not null as finalize_ok,
    exists (
      select 1 from pg_constraint
      where conrelid='public.provider_incident_alert_deliveries'::regclass
        and conname='provider_incident_alert_delivery_identity'
        and contype='u'
    ) as identity_ok,
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='provider_incident_alert_deliveries' and c.relrowsecurity
    ) as rls_ok
)
select jsonb_build_object(
  'ok',table_ok and claim_v1_ok and claim_v2_ok and begin_ok and finalize_ok and identity_ok and rls_ok,
  'version','v2',
  'table',table_ok,
  'claimRpc',claim_v1_ok,
  'claimV2Rpc',claim_v2_ok,
  'beginRpc',begin_ok,
  'finalizeRpc',finalize_ok,
  'uniqueIdentity',identity_ok,
  'rls',rls_ok
)
from checks;
$$;

-- Least privilege for both new aggregation and existing alert ledger.
revoke all privileges on table public.provider_incident_alert_deliveries
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.provider_incident_alert_deliveries
  to service_role;
revoke all privileges on sequence public.provider_incident_alert_deliveries_id_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.provider_incident_alert_deliveries_id_seq
  to service_role;

revoke execute on function public.record_provider_slo_observation(text,text,text,text,integer,timestamptz)
  from public, anon, authenticated;
revoke execute on function public.read_provider_slo_buckets(timestamptz,timestamptz,integer)
  from public, anon, authenticated;
revoke execute on function public.provider_slo_aggregation_contract()
  from public, anon, authenticated;
revoke execute on function public.claim_provider_incident_alert_delivery(text,text,text,text,integer,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.claim_provider_incident_alert_delivery_v2(text,text,text,text,integer,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.begin_provider_incident_alert_delivery_send(text,text)
  from public, anon, authenticated;
revoke execute on function public.finalize_provider_incident_alert_delivery(text,text,text,timestamptz,integer,text,text)
  from public, anon, authenticated;
revoke execute on function public.provider_incident_alert_delivery_contract()
  from public, anon, authenticated;

grant execute on function public.record_provider_slo_observation(text,text,text,text,integer,timestamptz)
  to service_role;
grant execute on function public.read_provider_slo_buckets(timestamptz,timestamptz,integer)
  to service_role;
grant execute on function public.provider_slo_aggregation_contract()
  to service_role;
grant execute on function public.claim_provider_incident_alert_delivery(text,text,text,text,integer,integer,integer)
  to service_role;
grant execute on function public.claim_provider_incident_alert_delivery_v2(text,text,text,text,integer,integer,integer)
  to service_role;
grant execute on function public.begin_provider_incident_alert_delivery_send(text,text)
  to service_role;
grant execute on function public.finalize_provider_incident_alert_delivery(text,text,text,timestamptz,integer,text,text)
  to service_role;
grant execute on function public.provider_incident_alert_delivery_contract()
  to service_role;

create or replace function public.backend_schema_fingerprint()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with parts as (
  select
    'C|' || c.table_name || '|' || c.ordinal_position || '|' || c.column_name || '|' ||
    c.data_type || '|' || coalesce(c.udt_name,'') || '|' || c.is_nullable || '|' ||
    coalesce(c.column_default,'') as part
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
      or (c.table_name = 'user_preferences' and c.column_name = 'notification_preferences')
      or (c.table_name = 'match_reminders' and c.column_name in (
        'lineup_notified_at','lineup_claimed_at','lineup_attempts',
        'important_change_notified_at','important_change_claimed_at','important_change_attempts'
      ))
    )
  union all
  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets'
    )
    and tc.constraint_name <> 'user_preferences_notification_preferences_object_check'
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases',
      'provider_slo_buckets'
    )
    and not (tablename = 'ops_events' and indexname = 'ops_events_transition_key_key')
  union all
  select
    'F|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
    pg_get_function_result(p.oid) || '|definer=' || p.prosecdef::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in (
      'save_favorite_guarded',
      'save_favorite_player_guarded',
      'save_match_reminder_guarded',
      'save_match_reminder_guarded_v2',
      'resolve_match_reminder_fixture',
      'prune_match_reminders_for_user',
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
      'claim_smart_notification_delivery',
      'finalize_smart_notification_delivery',
      'begin_smart_notification_delivery_send',
      'activate_pass_entitlement',
      'consume_pass_entitlement',
      'refund_pass_entitlement_usage',
      'refund_pass_entitlement',
      'backend_readiness_contract',
      'claim_scheduled_job',
      'complete_scheduled_job',
      'release_scheduled_job',
      'record_provider_slo_observation',
      'read_provider_slo_buckets',
      'provider_slo_aggregation_contract',
      'claim_provider_incident_alert_delivery_v2',
      'begin_provider_incident_alert_delivery_send'
    )
)
select jsonb_build_object(
  'ok', true,
  'fingerprint', md5(string_agg(part, E'\n' order by part)),
  'parts', count(*),
  'checked_at', now()
)
from parts;
$$;

revoke execute on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;


notify pgrst, 'reload schema';
