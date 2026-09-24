-- Football Analytics v6.9 / RC17
-- Persistent champion-challenger calibration lifecycle and safe rollback.
-- Legacy incremental step. Fresh installs use baseline v6.18; existing upgrades must already include the pre-v6.9 schema.

create table if not exists public.model_calibration_profiles (
  fingerprint text primary key,
  profile_version text not null,
  status text not null default 'challenger'
    check (status in ('baseline','challenger','held','active','retired','rolled_back')),
  temperature double precision not null default 1 check (temperature between 0.8 and 1.35),
  temperature_active boolean not null default false,
  signal_weights jsonb not null default '{}'::jsonb,
  weights_active boolean not null default false,
  trusted_sample integer not null default 0 check (trusted_sample >= 0),
  train_sample integer not null default 0 check (train_sample >= 0),
  validation_sample integer not null default 0 check (validation_sample >= 0),
  validation_windows jsonb not null default '[]'::jsonb,
  baseline_brier double precision,
  candidate_brier double precision,
  baseline_log_loss double precision,
  candidate_log_loss double precision,
  source_cutoff timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  rollback_reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_calibration_profiles_status_idx
  on public.model_calibration_profiles (status, created_at desc);

create table if not exists public.model_calibration_state (
  id text primary key default 'global' check (id = 'global'),
  active_fingerprint text references public.model_calibration_profiles(fingerprint) on delete restrict,
  previous_fingerprint text references public.model_calibration_profiles(fingerprint) on delete restrict,
  activated_at timestamptz,
  last_evaluated_at timestamptz,
  last_rollback_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  check (active_fingerprint is null or active_fingerprint is distinct from previous_fingerprint)
);

create index if not exists model_calibration_state_active_idx
  on public.model_calibration_state (active_fingerprint)
  where active_fingerprint is not null;

create index if not exists model_calibration_state_previous_idx
  on public.model_calibration_state (previous_fingerprint)
  where previous_fingerprint is not null;

insert into public.model_calibration_state (id)
values ('global')
on conflict (id) do nothing;

alter table public.model_predictions
  add column if not exists calibration_profile_fingerprint text;

create index if not exists model_predictions_calibration_profile_idx
  on public.model_predictions (calibration_profile_fingerprint, kickoff_at desc)
  where calibration_profile_fingerprint is not null;

alter table public.model_calibration_profiles enable row level security;
alter table public.model_calibration_state enable row level security;

-- These tables are server-only. Explicit grants keep them available to the
-- Worker secret/service role under the current Supabase Data API exposure model.
revoke all on table public.model_calibration_profiles from anon, authenticated;
revoke all on table public.model_calibration_state from anon, authenticated;
grant select, insert, update, delete on table public.model_calibration_profiles to service_role;
grant select, insert, update, delete on table public.model_calibration_state to service_role;

comment on table public.model_calibration_profiles is
  'RC17 immutable-ish registry of calibration champions and challengers. The active pointer lives in model_calibration_state.';

comment on table public.model_calibration_state is
  'RC17 singleton source of truth for the active and rollback calibration fingerprints.';

comment on column public.model_predictions.calibration_profile_fingerprint is
  'Exact RC17 calibration profile used to produce the immutable pre-match probability snapshot.';
