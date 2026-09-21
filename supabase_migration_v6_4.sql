-- Football Analytics v6.4 / RC12
-- Interrupted Run Reconciliation & Bounded Retry.
-- Safe to run when the RC11 run-ledger columns already exist.

alter table public.prediction_integrity_actions
  add column if not exists updated_at timestamptz not null default now();

alter table public.prediction_integrity_actions
  add column if not exists finished_at timestamptz;

alter table public.prediction_integrity_actions
  add column if not exists attempt_no integer not null default 1;

alter table public.prediction_integrity_actions
  add column if not exists retry_of_action_id uuid;

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_status_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_status_check
  check (status in ('started', 'completed', 'partial', 'failed', 'interrupted'));

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_attempt_no_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_attempt_no_check
  check (attempt_no between 1 and 3);

update public.prediction_integrity_actions
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

update public.prediction_integrity_actions
set finished_at = coalesce(finished_at, updated_at, created_at, now())
where status in ('completed', 'partial', 'failed', 'interrupted')
  and finished_at is null;

create index if not exists prediction_integrity_actions_started_ledger_idx
  on public.prediction_integrity_actions (updated_at asc)
  where action_type = 'auto_recover' and status = 'started';

create index if not exists prediction_integrity_actions_retry_lineage_idx
  on public.prediction_integrity_actions (created_at desc)
  where action_type = 'auto_recover';

comment on column public.prediction_integrity_actions.updated_at is
  'RC12 run-ledger heartbeat/finalization timestamp used to detect stale started automatic settlement runs.';

comment on column public.prediction_integrity_actions.finished_at is
  'RC12 terminal timestamp. NULL only while the remediation action is actively started.';

comment on column public.prediction_integrity_actions.attempt_no is
  'RC12 bounded retry number for the same exact automatic settlement fixture batch, from 1 to 3.';

comment on column public.prediction_integrity_actions.retry_of_action_id is
  'RC12 previous interrupted auto_recover action id when this run continues the same exact fixture batch lineage.';
