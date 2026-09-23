-- Football Analytics v6.13 / RC42
-- Verified referee history collected only from completed match-center data.

create table if not exists public.referee_match_history (
  fixture_id bigint primary key,
  referee_key text not null,
  referee_name text not null,
  referee_country text not null default '',
  kickoff_at timestamptz,
  league_id bigint,
  yellow_cards integer not null default 0 check (yellow_cards >= 0),
  red_cards integer not null default 0 check (red_cards >= 0),
  fouls integer not null default 0 check (fouls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists referee_match_history_referee_idx on public.referee_match_history (referee_key, kickoff_at desc);
alter table public.referee_match_history enable row level security;
revoke all privileges on table public.referee_match_history from public, anon, authenticated;
grant select, insert, update, delete on table public.referee_match_history to service_role;
comment on table public.referee_match_history is 'RC42 verified referee discipline history collected from completed match-center payloads, Worker service-role only.';
notify pgrst, 'reload schema';
