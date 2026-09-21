-- Football Analytics v6.6 / RC14
-- Settlement Drift Review & Explicit Adjudication.

alter table public.model_predictions
  add column if not exists settlement_resolved_at timestamptz;

alter table public.model_predictions
  add column if not exists settlement_resolution_action text;

alter table public.model_predictions
  add column if not exists settlement_resolution_event_id bigint;

alter table public.model_predictions
  drop constraint if exists model_predictions_settlement_verification_state_check;

alter table public.model_predictions
  add constraint model_predictions_settlement_verification_state_check
  check (settlement_verification_state in ('unverified', 'verified', 'drift', 'adjudicated'));

alter table public.model_predictions
  drop constraint if exists model_predictions_settlement_resolution_action_check;

alter table public.model_predictions
  add constraint model_predictions_settlement_resolution_action_check
  check (
    settlement_resolution_action is null or
    settlement_resolution_action in ('keep_stored', 'accept_provider', 'void_prediction')
  );

create table if not exists public.settlement_drift_resolutions (
  source_event_id bigint primary key references public.settlement_verification_events(id) on delete restrict,
  fixture_id bigint not null,
  action text not null,
  reason text not null,
  admin_telegram_id bigint,
  before_snapshot jsonb not null default '{}'::jsonb,
  provider_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint settlement_drift_resolutions_action_check
    check (action in ('keep_stored', 'accept_provider', 'void_prediction'))
);

alter table public.settlement_drift_resolutions enable row level security;

create index if not exists settlement_drift_resolutions_fixture_idx
  on public.settlement_drift_resolutions (fixture_id, created_at desc);

create index if not exists model_predictions_settlement_resolution_idx
  on public.model_predictions (settlement_verification_state, settlement_resolved_at desc)
  where settlement_verification_state in ('drift', 'adjudicated');

comment on table public.settlement_drift_resolutions is
  'RC14 immutable admin adjudication audit for RC13 settlement drift. Service-role backend only; UI never exposes admin Telegram ID.';

comment on column public.model_predictions.settlement_resolution_action is
  'RC14 explicit resolution: keep_stored, accept_provider, or void_prediction. Never set by automatic finality verification.';
