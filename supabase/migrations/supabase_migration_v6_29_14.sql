-- MatchRadar v6.29.14 / verified LIVE pressure observations
-- Append-only: history starts at deployment; earlier minutes are not backfilled.
-- Service only. No browser role has table access or row-level policies.
create table if not exists public.live_pressure_snapshots (
  snapshot_key text primary key,
  fixture_id bigint not null check (fixture_id > 0),
  captured_at timestamptz not null,
  match_minute integer check (match_minute is null or match_minute between 0 and 180),
  home_pressure double precision not null check (home_pressure between 0 and 100),
  away_pressure double precision not null check (away_pressure between 0 and 100),
  source text not null default 'verified' check (source = 'verified'),
  created_at timestamptz not null default now(),
  constraint live_pressure_snapshot_key_size check (length(snapshot_key) between 10 and 100),
  constraint live_pressure_sum check (abs(home_pressure + away_pressure - 100) <= 2)
);
create index if not exists live_pressure_snapshots_fixture_captured_idx
  on public.live_pressure_snapshots(fixture_id, captured_at desc);
alter table public.live_pressure_snapshots enable row level security;
revoke all on table public.live_pressure_snapshots from public, anon, authenticated, service_role;
grant select, insert on table public.live_pressure_snapshots to service_role;
