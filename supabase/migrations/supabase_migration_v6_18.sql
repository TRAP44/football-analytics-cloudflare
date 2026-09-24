-- Football Analytics v6.18 / RC127
-- Atomic analysis quota, distributed API-Football minute budget,
-- daily digest delivery claims, full schema fingerprint and stricter service-role privileges.

alter table public.bot_digest_subscriptions
  add column if not exists delivery_claim_date date,
  add column if not exists delivery_claimed_at timestamptz,
  add column if not exists delivery_locked_until timestamptz;

create table if not exists public.provider_rate_windows (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.provider_rate_windows enable row level security;
revoke all on table public.provider_rate_windows from public, anon, authenticated;
grant select, insert, update, delete on table public.provider_rate_windows to service_role;

create or replace function public.consume_analysis_quota(
  p_telegram_id bigint,
  p_usage_date date,
  p_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  if p_telegram_id is null or p_usage_date is null or p_limit is null or p_limit < 1 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', greatest(coalesce(p_limit,0),0), 'reason', 'invalid_input');
  end if;

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
      'used', coalesce(v_used,0),
      'limit', p_limit,
      'reason', 'quota_exhausted'
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'limit', p_limit,
    'reason', 'reserved'
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
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
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

create or replace function public.claim_provider_request(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds,60), 3600));
  v_limit integer := greatest(1, coalesce(p_limit,1));
  v_window timestamptz;
  v_count integer;
  v_current public.provider_rate_windows%rowtype;
begin
  if p_bucket_key is null or length(btrim(p_bucket_key)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_bucket', 'retryAfter', 1);
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );

  insert into public.provider_rate_windows(bucket_key, window_started_at, request_count, updated_at)
  values (left(p_bucket_key,160), v_window, 1, v_now)
  on conflict (bucket_key)
  do update set
    window_started_at = v_window,
    request_count = case
      when public.provider_rate_windows.window_started_at <> v_window then 1
      else public.provider_rate_windows.request_count + 1
    end,
    updated_at = v_now
  where public.provider_rate_windows.window_started_at <> v_window
     or public.provider_rate_windows.request_count < v_limit
  returning request_count into v_count;

  if v_count is not null then
    return jsonb_build_object(
      'allowed', true,
      'count', v_count,
      'limit', v_limit,
      'windowStartedAt', v_window,
      'retryAfter', 0
    );
  end if;

  select * into v_current
  from public.provider_rate_windows
  where bucket_key = left(p_bucket_key,160);

  return jsonb_build_object(
    'allowed', false,
    'count', coalesce(v_current.request_count, v_limit),
    'limit', v_limit,
    'windowStartedAt', coalesce(v_current.window_started_at, v_window),
    'retryAfter', greatest(1, ceil(extract(epoch from ((coalesce(v_current.window_started_at,v_window) + make_interval(secs => v_window_seconds)) - v_now)))::integer),
    'reason', 'distributed_rate_limit'
  );
end;
$$;

create or replace function public.claim_daily_digest(
  p_telegram_id bigint,
  p_delivery_date date,
  p_lease_seconds integer default 180
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claimed boolean := false;
begin
  update public.bot_digest_subscriptions
  set delivery_claim_date = p_delivery_date,
      delivery_claimed_at = now(),
      delivery_locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds,180),900))),
      updated_at = now()
  where telegram_id = p_telegram_id
    and enabled = true
    and last_sent_date is distinct from p_delivery_date
    and (
      delivery_claim_date is distinct from p_delivery_date
      or delivery_locked_until is null
      or delivery_locked_until <= now()
    )
  returning true into v_claimed;

  return coalesce(v_claimed,false);
end;
$$;

create or replace function public.complete_daily_digest(
  p_telegram_id bigint,
  p_delivery_date date
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_done boolean := false;
begin
  update public.bot_digest_subscriptions
  set last_sent_date = p_delivery_date,
      delivery_claim_date = null,
      delivery_claimed_at = null,
      delivery_locked_until = null,
      updated_at = now()
  where telegram_id = p_telegram_id
    and delivery_claim_date = p_delivery_date
  returning true into v_done;

  return coalesce(v_done,false);
end;
$$;

create or replace function public.release_daily_digest(
  p_telegram_id bigint,
  p_delivery_date date
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_released boolean := false;
begin
  update public.bot_digest_subscriptions
  set delivery_claim_date = null,
      delivery_claimed_at = null,
      delivery_locked_until = null,
      updated_at = now()
  where telegram_id = p_telegram_id
    and delivery_claim_date = p_delivery_date
    and last_sent_date is distinct from p_delivery_date
  returning true into v_released;

  return coalesce(v_released,false);
end;
$$;

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

  union all

  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'

  union all

  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'

  union all

  select
    'F|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
    pg_get_function_result(p.oid) || '|definer=' || p.prosecdef::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select jsonb_build_object(
  'ok', true,
  'fingerprint', md5(string_agg(part, E'\n' order by part)),
  'parts', count(*),
  'checked_at', now()
)
from parts;
$$;

revoke execute on function public.consume_analysis_quota(bigint,date,integer) from public, anon, authenticated;
revoke execute on function public.refund_analysis_quota(bigint,date) from public, anon, authenticated;
revoke execute on function public.claim_provider_request(text,integer,integer) from public, anon, authenticated;
revoke execute on function public.claim_daily_digest(bigint,date,integer) from public, anon, authenticated;
revoke execute on function public.complete_daily_digest(bigint,date) from public, anon, authenticated;
revoke execute on function public.release_daily_digest(bigint,date) from public, anon, authenticated;
revoke execute on function public.backend_schema_fingerprint() from public, anon, authenticated;

grant execute on function public.consume_analysis_quota(bigint,date,integer) to service_role;
grant execute on function public.refund_analysis_quota(bigint,date) to service_role;
grant execute on function public.claim_provider_request(text,integer,integer) to service_role;
grant execute on function public.claim_daily_digest(bigint,date,integer) to service_role;
grant execute on function public.complete_daily_digest(bigint,date) to service_role;
grant execute on function public.release_daily_digest(bigint,date) to service_role;
grant execute on function public.backend_schema_fingerprint() to service_role;

do $$
declare
  r record;
begin
  for r in select schemaname, tablename from pg_tables where schemaname='public'
  loop
    execute format('revoke truncate, references, trigger on table %I.%I from service_role', r.schemaname, r.tablename);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

notify pgrst, 'reload schema';
