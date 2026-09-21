-- Football Analytics v6.3 / RC11
-- Settlement Circuit Breaker & Reliability SLO.
-- Run AFTER supabase_migration_v6_2.sql and BEFORE deploying Worker v6.3.

create table if not exists public.settlement_watchdog_state (
  id text primary key default 'global',
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  circuit_open_until timestamptz,
  last_run_at timestamptz,
  last_status text not null default 'never',
  last_action_id text,
  last_error text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.settlement_watchdog_state (id)
values ('global')
on conflict (id) do nothing;

alter table public.settlement_watchdog_state enable row level security;

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_action_type_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_action_type_check
  check (action_type in ('dry_run', 'recover', 'auto_recover', 'circuit_reset'));

comment on table public.settlement_watchdog_state is
  'RC11 persistent reliability state for automatic settlement recovery. Service-role backend only; no direct client policy.';

comment on column public.settlement_watchdog_state.circuit_open_until is
  'When in the future, unattended settlement recovery is blocked regardless of the runtime AUTO toggle.';
