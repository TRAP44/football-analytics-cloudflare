-- Football Analytics v6.16 / RC107
-- Persistent Telegram webhook dedupe across Cloudflare Worker isolates.
-- The browser never reads this table directly; service_role is the only data-plane role.

create table if not exists public.telegram_update_claims (
  update_key text primary key,
  status text not null default 'processing' check (status in ('processing', 'done', 'failed')),
  claimed_at timestamptz not null default now(),
  locked_until timestamptz not null default now() + interval '90 seconds',
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists telegram_update_claims_expires_idx
  on public.telegram_update_claims (expires_at);

alter table public.telegram_update_claims enable row level security;
revoke all on table public.telegram_update_claims from public, anon, authenticated;
grant select, insert, update, delete on table public.telegram_update_claims to service_role;

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
    expires_at
  )
  values (
    p_update_key,
    'processing',
    now(),
    now() + (v_lease_seconds * interval '1 second'),
    null,
    now() + interval '24 hours'
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
  return v_rows = 1;
end;
$$;

create or replace function public.complete_telegram_update(p_update_key text)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rows integer := 0;
begin
  update public.telegram_update_claims
  set status = 'done',
      completed_at = now(),
      locked_until = now(),
      expires_at = greatest(expires_at, now() + interval '24 hours')
  where update_key = p_update_key;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.release_telegram_update(p_update_key text)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_rows integer := 0;
begin
  update public.telegram_update_claims
  set status = 'failed',
      completed_at = null,
      locked_until = now() + interval '5 seconds',
      expires_at = greatest(expires_at, now() + interval '1 hour')
  where update_key = p_update_key
    and status <> 'done';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_telegram_update(text, integer) from public, anon, authenticated;
revoke all on function public.complete_telegram_update(text) from public, anon, authenticated;
revoke all on function public.release_telegram_update(text) from public, anon, authenticated;

grant execute on function public.claim_telegram_update(text, integer) to service_role;
grant execute on function public.complete_telegram_update(text) to service_role;
grant execute on function public.release_telegram_update(text) to service_role;

comment on table public.telegram_update_claims is
  'RC107 persistent Telegram update claim ledger for cross-isolate webhook deduplication.';

comment on function public.claim_telegram_update(text, integer) is
  'RC107 atomically claims one Telegram update key; duplicate completed or active claims return false.';

notify pgrst, 'reload schema';
