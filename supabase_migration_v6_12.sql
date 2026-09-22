-- Football Analytics v6.12 / RC41
-- Opt-in Telegram morning digest subscriptions. Only the Worker service role
-- has table privileges; the browser never accesses this table directly.

create table if not exists public.bot_digest_subscriptions (
  telegram_id bigint primary key,
  chat_id bigint not null,
  enabled boolean not null default true,
  hour_utc smallint not null default 7 check (hour_utc between 0 and 23),
  app_url text not null default '',
  last_sent_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_digest_subscriptions_enabled_hour_idx
  on public.bot_digest_subscriptions (enabled, hour_utc)
  where enabled = true;

alter table public.bot_digest_subscriptions enable row level security;

revoke all privileges on table public.bot_digest_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.bot_digest_subscriptions to service_role;

comment on table public.bot_digest_subscriptions is
  'RC41 opt-in Telegram AI football digest subscriptions, Worker service-role only.';

notify pgrst, 'reload schema';
