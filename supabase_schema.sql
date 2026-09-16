-- Run this once in Supabase SQL Editor.

create table if not exists public.users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  plan text not null default 'FREE' check (plan in ('FREE','PRO','PREMIUM')),
  subscription_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  telegram_id bigint not null references public.users(telegram_id) on delete cascade,
  usage_date date not null,
  analyses integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (telegram_id, usage_date)
);

create table if not exists public.analysis_cache (
  cache_key text primary key,
  fixture_id bigint not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists analysis_cache_expires_at_idx
  on public.analysis_cache(expires_at);

-- The app uses SUPABASE_SERVICE_ROLE_KEY on the server only.
-- RLS blocks direct public access while service-role requests keep working.
alter table public.users enable row level security;
alter table public.usage_daily enable row level security;
alter table public.analysis_cache enable row level security;
