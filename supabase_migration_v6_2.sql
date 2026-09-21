-- Football Analytics v6.2 / RC10
-- Settlement Watchdog & runtime-gated automatic catch-up.
-- Run AFTER supabase_migration_v6_1.sql and BEFORE deploying Worker v6.2.

alter table public.runtime_controls
  add column if not exists auto_settlement_recovery_enabled boolean not null default false;

alter table public.prediction_integrity_actions
  add column if not exists trigger_source text not null default 'admin';

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_action_type_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_action_type_check
  check (action_type in ('dry_run', 'recover', 'auto_recover'));

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_status_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_status_check
  check (status in ('started', 'completed', 'partial', 'failed'));

alter table public.prediction_integrity_actions
  drop constraint if exists prediction_integrity_actions_trigger_source_check;

alter table public.prediction_integrity_actions
  add constraint prediction_integrity_actions_trigger_source_check
  check (trigger_source in ('admin', 'cron'));

update public.prediction_integrity_actions
set trigger_source = 'admin'
where trigger_source is null or trigger_source not in ('admin', 'cron');

comment on column public.runtime_controls.auto_settlement_recovery_enabled is
  'RC10 kill switch. FALSE keeps the settlement watchdog in shadow mode; TRUE permits bounded scheduled stale-pending recovery.';

comment on column public.prediction_integrity_actions.trigger_source is
  'Audit source for remediation: admin for manual recovery, cron for RC10 scheduled catch-up.';
