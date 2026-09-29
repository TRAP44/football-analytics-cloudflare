-- Football Analytics v6.21.1 / post-deploy regression lifecycle transition dedupe
-- Additive migration: gives regression lifecycle transitions a durable, atomic
-- cross-isolate idempotency key without changing existing ops_events behavior.

alter table public.ops_events
  add column if not exists transition_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ops_events'::regclass
      and conname = 'ops_events_transition_key_key'
  ) then
    alter table public.ops_events
      add constraint ops_events_transition_key_key unique (transition_key);
  end if;
end;
$$;

comment on column public.ops_events.transition_key is
  'Optional durable idempotency key for operational transitions. NULL for ordinary ops events; unique when supplied by lifecycle writers.';

-- Keep the established structural fingerprint stable for this operational-only
-- idempotency column/constraint/index so the currently deployed Worker remains
-- ready while the additive migration rolls out before the matching code.
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
    and c.table_name <> 'provider_incident_alert_deliveries'
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
    )

  union all

  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name <> 'provider_incident_alert_deliveries'
    and not (
      tc.table_name = 'ops_events'
      and tc.constraint_name = 'ops_events_transition_key_key'
    )

  union all

  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename <> 'provider_incident_alert_deliveries'
    and not (
      tablename = 'ops_events'
      and indexname = 'ops_events_transition_key_key'
    )

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
