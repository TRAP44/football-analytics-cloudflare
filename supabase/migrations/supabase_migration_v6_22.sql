-- MatchRadar v6.22 / AI Timeline immutable probability snapshots
-- Additive persistence for real historical model states. No backfill: past states are never invented.

create table if not exists public.analysis_timeline_snapshots (
  snapshot_key text primary key,
  fixture_id bigint not null,
  captured_at timestamptz not null,
  match_status text not null default '',
  match_minute integer check (match_minute is null or match_minute between 0 and 180),
  home_prob double precision not null check (home_prob between 0 and 100),
  draw_prob double precision not null check (draw_prob between 0 and 100),
  away_prob double precision not null check (away_prob between 0 and 100),
  confidence_score double precision,
  completeness_score double precision,
  completeness_max double precision,
  trigger_category text not null default 'model_update'
    check (trigger_category in ('baseline','lineup','availability','odds_move','event','model_update')),
  causal_relation text not null default 'model_driven'
    check (causal_relation in ('confirmed','correlated','model_driven')),
  explanation text not null default '',
  provenance jsonb not null default '{}'::jsonb,
  analysis_version text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists analysis_timeline_snapshots_fixture_captured_idx
  on public.analysis_timeline_snapshots(fixture_id, captured_at asc);

alter table public.analysis_timeline_snapshots enable row level security;

-- Server-only, append-only application access. Browser roles cannot read or mutate history.
revoke all on table public.analysis_timeline_snapshots from public, anon, authenticated, service_role;
grant select, insert on table public.analysis_timeline_snapshots to service_role;

-- Keep the established production fingerprint stable while this additive table rolls out.
-- Presence/columns are checked separately by the worker schema probe.
create or replace function public.backend_schema_fingerprint()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with parts as (
  select
    'C|' || c.table_name || '|' || c.ordinal_position || '|' || c.column_name || '|' ||
    c.data_type || '|' || coalesce(c.udt_name,'') || '|' || c.is_nullable || '|' ||
    coalesce(c.column_default,'') as part
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name not in ('provider_incident_alert_deliveries','analysis_timeline_snapshots')
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
      or (c.table_name = 'match_reminders' and c.column_name in ('lineup_notified_at','lineup_claimed_at','lineup_attempts','important_change_notified_at','important_change_claimed_at','important_change_attempts'))
    )
  union all
  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name not in ('provider_incident_alert_deliveries','analysis_timeline_snapshots')
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename not in ('provider_incident_alert_deliveries','analysis_timeline_snapshots')
    and not (tablename = 'ops_events' and indexname = 'ops_events_transition_key_key')
  union all
  select
    'F|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
    pg_get_function_result(p.oid) || '|definer=' || p.prosecdef::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname not in (
      'save_favorite_guarded',
      'save_match_reminder_guarded',
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
      'backend_readiness_contract'
    )
)
select jsonb_build_object(
  'ok', true,
  'fingerprint', md5(string_agg(part, E'\n' order by part)),
  'parts', count(*),
  'checked_at', now()
)
from parts;
$$;

revoke execute on function public.backend_schema_fingerprint() from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint() to service_role;

notify pgrst, 'reload schema';
