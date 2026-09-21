-- Football Analytics v6.7 / RC15
-- Trusted Metrics Gate & Two-Pass Settlement Finality.

alter table public.model_predictions
  add column if not exists settlement_verification_count integer not null default 0;

alter table public.model_predictions
  add column if not exists settlement_first_verified_at timestamptz;

alter table public.model_predictions
  drop constraint if exists model_predictions_settlement_verification_state_check;

alter table public.model_predictions
  add constraint model_predictions_settlement_verification_state_check
  check (settlement_verification_state in ('unverified', 'verified', 'confirmed', 'drift', 'adjudicated'));

alter table public.model_predictions
  drop constraint if exists model_predictions_settlement_verification_count_check;

alter table public.model_predictions
  add constraint model_predictions_settlement_verification_count_check
  check (settlement_verification_count between 0 and 2);

update public.model_predictions
set settlement_verification_count =
  case
    when settlement_verification_state = 'confirmed' then 2
    when settlement_verification_state in ('verified', 'adjudicated') then greatest(settlement_verification_count, 1)
    else settlement_verification_count
  end;

update public.model_predictions
set settlement_first_verified_at = coalesce(settlement_first_verified_at, settlement_verified_at)
where settlement_verification_state in ('verified', 'confirmed')
  and settlement_verified_at is not null;

create index if not exists model_predictions_finality_second_pass_idx
  on public.model_predictions (settlement_verification_state, settlement_verified_at asc)
  where status = 'settled'
    and settlement_verification_state in ('unverified', 'verified');

comment on column public.model_predictions.settlement_verification_count is
  'RC15 finality pass counter: 0 unverified, 1 first provider verification, 2 second-pass confirmed. Adjudicated rows are trusted by explicit admin decision.';

comment on column public.model_predictions.settlement_first_verified_at is
  'RC15 timestamp of the first matching provider finality pass. Second-pass confirmation waits at least 24 hours after the first pass.';
