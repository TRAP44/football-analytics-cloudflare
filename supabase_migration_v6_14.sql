-- Football Analytics v6.14 / RC43
-- Persist compact AI verdict snapshots in the user's backend-only analysis history.

alter table public.analysis_history
  add column if not exists ai_signal_code text not null default '',
  add column if not exists ai_signal_label text not null default '',
  add column if not exists ai_confidence integer,
  add column if not exists ai_risk text not null default '',
  add column if not exists ai_outcome text not null default '',
  add column if not exists ai_total text not null default '',
  add column if not exists ai_btts text not null default '',
  add column if not exists analysis_version text not null default '';

alter table public.analysis_history
  drop constraint if exists analysis_history_ai_confidence_check;

alter table public.analysis_history
  add constraint analysis_history_ai_confidence_check
  check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100));

comment on column public.analysis_history.ai_signal_label is
  'RC43 compact AI instructor action snapshot shown on already analyzed match cards.';

notify pgrst, 'reload schema';
