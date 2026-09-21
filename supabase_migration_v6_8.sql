-- Football Analytics v6.8 / RC16
-- Calibration Promotion Gate & Holdout Validation.

create table if not exists public.model_calibration_validations (
  candidate_fingerprint text primary key,
  created_at timestamptz not null default now(),
  profile_version text not null,
  decision text not null check (decision in ('baseline','shadow','held','promoted')),
  trusted_sample integer not null default 0 check (trusted_sample >= 0),
  train_sample integer not null default 0 check (train_sample >= 0),
  validation_sample integer not null default 0 check (validation_sample >= 0),
  temperature_candidate double precision,
  temperature_active boolean not null default false,
  candidate_weights jsonb not null default '{}'::jsonb,
  weights_active boolean not null default false,
  baseline_brier double precision,
  candidate_brier double precision,
  baseline_log_loss double precision,
  candidate_log_loss double precision,
  brier_gain double precision,
  log_loss_gain double precision,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists model_calibration_validations_created_idx
  on public.model_calibration_validations (created_at desc);

create index if not exists model_calibration_validations_decision_idx
  on public.model_calibration_validations (decision, created_at desc);

comment on table public.model_calibration_validations is
  'RC16 immutable-ish audit snapshots for calibration promotion decisions based on trusted chronological holdout matches.';
