-- Football Analytics v6.17 / RC108
-- Persistent Telegram webhook dedupe observability.
-- Adds aggregate duplicate counters and a service-role-only read health RPC.

alter table public.telegram_update_claims
  add column if not exists duplicate_count integer not null default 0,
  add column if not exists last_duplicate_at timestamptz;

create or replace function public.claim_telegram_update(
  p_update_key text,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rows integer := 0;
  v_lease_seconds integer := greatest(15, least(300, coalesce(p_lease_seconds, 90)));
begin
  if p_update_key is null
     or length(btrim(p_update_key)) = 0
     or length(p_update_key) > 180 then
    return false;
  end if;

  delete from public.telegram_update_claims
  where update_key in (
    select update_key
    from public.telegram_update_claims
    where expires_at < now()
    order by expires_at
    limit 200
  );

  insert into public.telegram_update_claims (
    update_key,
    status,
    claimed_at,
    locked_until,
    completed_at,
    expires_at,
    duplicate_count,
    last_duplicate_at
  )
  values (
    p_update_key,
    'processing',
    now(),
    now() + (v_lease_seconds * interval '1 second'),
    null,
    now() + interval '24 hours',
    0,
    null
  )
  on conflict (update_key) do update
  set status = 'processing',
      claimed_at = excluded.claimed_at,
      locked_until = excluded.locked_until,
      completed_at = null,
      expires_at = greatest(public.telegram_update_claims.expires_at, excluded.expires_at)
  where public.telegram_update_claims.status <> 'done'
    and public.telegram_update_claims.locked_until <= now();

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return true;
  end if;

  update public.telegram_update_claims
  set duplicate_count = duplicate_count + 1,
      last_duplicate_at = now(),
      expires_at = greatest(expires_at, now() + interval '24 hours')
  where update_key = p_update_key;

  return false;
end;
$$;

create or replace function public.telegram_webhook_dedupe_health(
  p_window_minutes integer default 60
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_window integer := greatest(5, least(1440, coalesce(p_window_minutes, 60)));
  v_since timestamptz := now() - (greatest(5, least(1440, coalesce(p_window_minutes, 60))) * interval '1 minute');
  v_ledger_rows bigint := 0;
  v_claims_recent bigint := 0;
  v_completed_recent bigint := 0;
  v_failed_recent bigint := 0;
  v_failed_current bigint := 0;
  v_active_processing bigint := 0;
  v_stale_processing bigint := 0;
  v_duplicate_attempts_retained bigint := 0;
  v_duplicate_rows_recent bigint := 0;
  v_last_duplicate_at timestamptz;
  v_oldest_stale_seconds bigint := 0;
begin
  select
    count(*),
    count(*) filter (where claimed_at >= v_since),
    count(*) filter (where completed_at >= v_since),
    count(*) filter (where status = 'failed' and claimed_at >= v_since),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'processing' and locked_until > now()),
    count(*) filter (where status = 'processing' and locked_until <= now()),
    coalesce(sum(duplicate_count), 0),
    count(*) filter (where last_duplicate_at >= v_since),
    max(last_duplicate_at),
    coalesce(max(extract(epoch from (now() - locked_until))) filter (
      where status = 'processing' and locked_until <= now()
    ), 0)::bigint
  into
    v_ledger_rows,
    v_claims_recent,
    v_completed_recent,
    v_failed_recent,
    v_failed_current,
    v_active_processing,
    v_stale_processing,
    v_duplicate_attempts_retained,
    v_duplicate_rows_recent,
    v_last_duplicate_at,
    v_oldest_stale_seconds
  from public.telegram_update_claims
  where expires_at > now();

  return jsonb_build_object(
    'window_minutes', v_window,
    'ledger_rows', v_ledger_rows,
    'claims_recent', v_claims_recent,
    'completed_recent', v_completed_recent,
    'failed_recent', v_failed_recent,
    'failed_current', v_failed_current,
    'active_processing', v_active_processing,
    'stale_processing', v_stale_processing,
    'duplicate_attempts_retained', v_duplicate_attempts_retained,
    'duplicate_rows_recent', v_duplicate_rows_recent,
    'last_duplicate_at', v_last_duplicate_at,
    'oldest_stale_seconds', v_oldest_stale_seconds,
    'generated_at', now()
  );
end;
$$;

revoke all on function public.claim_telegram_update(text, integer) from public, anon, authenticated;
revoke all on function public.telegram_webhook_dedupe_health(integer) from public, anon, authenticated;

grant execute on function public.claim_telegram_update(text, integer) to service_role;
grant execute on function public.telegram_webhook_dedupe_health(integer) to service_role;

comment on function public.telegram_webhook_dedupe_health(integer) is
  'RC108 service-role-only aggregate health for the retained Telegram webhook dedupe ledger.';

notify pgrst, 'reload schema';
