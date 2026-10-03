-- MatchRadar v6.26 / Scheduled job isolation and distributed cron leases
-- Additive, backward-compatible coordination for Cloudflare scheduled handlers.

create table if not exists public.scheduled_job_leases (
  job_key text primary key,
  group_key text not null,
  status text not null default 'running' check (status in ('running','done','failed')),
  lease_token text not null,
  scheduled_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  locked_until timestamptz not null,
  completed_at timestamptz,
  expires_at timestamptz not null,
  check (char_length(job_key) between 1 and 180),
  check (char_length(group_key) between 1 and 120),
  check (char_length(lease_token) between 16 and 80)
);

create index if not exists scheduled_job_leases_group_lock_idx
  on public.scheduled_job_leases (group_key, locked_until)
  where status = 'running';

create index if not exists scheduled_job_leases_expires_idx
  on public.scheduled_job_leases (expires_at);

alter table public.scheduled_job_leases enable row level security;
revoke all privileges on table public.scheduled_job_leases from public, anon, authenticated;
grant select, insert, update, delete on table public.scheduled_job_leases to service_role;

create or replace function public.claim_scheduled_job(
  p_job_key text,
  p_group_key text,
  p_scheduled_at timestamptz,
  p_lease_seconds integer default 720,
  p_retention_seconds integer default 172800
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_job_key text := btrim(coalesce(p_job_key,''));
  v_group_key text := btrim(coalesce(p_group_key,''));
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,720),1800));
  v_retention_seconds integer := greatest(300, least(coalesce(p_retention_seconds,172800),604800));
  v_token text := md5(random()::text || clock_timestamp()::text || coalesce(p_job_key,'') || txid_current()::text);
  v_existing public.scheduled_job_leases%rowtype;
  v_overlap text;
  v_row public.scheduled_job_leases%rowtype;
begin
  if v_job_key='' or v_group_key=''
     or char_length(v_job_key)>180
     or char_length(v_group_key)>120
     or p_scheduled_at is null then
    return jsonb_build_object('claimed',false,'reason','invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:scheduled-job'),
    pg_catalog.hashtext(v_group_key)
  );

  delete from public.scheduled_job_leases
  where job_key in (
    select job_key
    from public.scheduled_job_leases
    where expires_at < v_now
    order by expires_at asc
    limit 200
  );

  select *
  into v_existing
  from public.scheduled_job_leases
  where job_key=v_job_key
  for update;

  if found then
    if v_existing.status='done' and v_existing.expires_at>v_now then
      return jsonb_build_object(
        'claimed',false,
        'reason','duplicate',
        'jobKey',v_job_key,
        'groupKey',v_group_key,
        'lockedUntil',v_existing.locked_until
      );
    end if;
    if v_existing.locked_until>v_now then
      return jsonb_build_object(
        'claimed',false,
        'reason',case when v_existing.status='running' then 'duplicate_active' else 'cooldown' end,
        'jobKey',v_job_key,
        'groupKey',v_group_key,
        'lockedUntil',v_existing.locked_until
      );
    end if;
  end if;

  select job_key
  into v_overlap
  from public.scheduled_job_leases
  where group_key=v_group_key
    and job_key<>v_job_key
    and status='running'
    and locked_until>v_now
  order by locked_until desc
  limit 1;

  if found then
    return jsonb_build_object(
      'claimed',false,
      'reason','overlap',
      'jobKey',v_job_key,
      'groupKey',v_group_key,
      'overlapJobKey',v_overlap
    );
  end if;

  insert into public.scheduled_job_leases(
    job_key,group_key,status,lease_token,scheduled_at,claimed_at,locked_until,completed_at,expires_at
  )
  values(
    v_job_key,
    v_group_key,
    'running',
    v_token,
    p_scheduled_at,
    v_now,
    v_now + v_lease_seconds * interval '1 second',
    null,
    v_now + v_retention_seconds * interval '1 second'
  )
  on conflict (job_key) do update
  set group_key=excluded.group_key,
      status='running',
      lease_token=excluded.lease_token,
      scheduled_at=excluded.scheduled_at,
      claimed_at=excluded.claimed_at,
      locked_until=excluded.locked_until,
      completed_at=null,
      expires_at=excluded.expires_at
  returning * into v_row;

  return jsonb_build_object(
    'claimed',true,
    'reason','claimed',
    'jobKey',v_row.job_key,
    'groupKey',v_row.group_key,
    'leaseToken',v_row.lease_token,
    'scheduledAt',v_row.scheduled_at,
    'lockedUntil',v_row.locked_until
  );
end;
$$;

create or replace function public.complete_scheduled_job(
  p_job_key text,
  p_lease_token text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_rows integer := 0;
begin
  update public.scheduled_job_leases
  set status='done',
      completed_at=clock_timestamp(),
      locked_until=clock_timestamp()
  where job_key=btrim(coalesce(p_job_key,''))
    and lease_token=coalesce(p_lease_token,'')
    and status='running';

  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

create or replace function public.release_scheduled_job(
  p_job_key text,
  p_lease_token text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_rows integer := 0;
begin
  update public.scheduled_job_leases
  set status='failed',
      completed_at=null,
      locked_until=clock_timestamp() + interval '5 seconds'
  where job_key=btrim(coalesce(p_job_key,''))
    and lease_token=coalesce(p_lease_token,'')
    and status='running';

  get diagnostics v_rows=row_count;
  return v_rows=1;
end;
$$;

revoke execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.complete_scheduled_job(text,text)
  from public, anon, authenticated;
revoke execute on function public.release_scheduled_job(text,text)
  from public, anon, authenticated;

grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  to service_role;
grant execute on function public.complete_scheduled_job(text,text)
  to service_role;
grant execute on function public.release_scheduled_job(text,text)
  to service_role;

comment on table public.scheduled_job_leases is
  'Backend-only leases and idempotency markers for Cloudflare scheduled jobs.';

-- Preserve the existing structural fingerprint during this additive rollout.
-- The new lease surface is verified explicitly by schema drift probes instead.
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
    and c.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
      or (c.table_name = 'user_preferences' and c.column_name = 'notification_preferences')
      or (c.table_name = 'match_reminders' and c.column_name in (
        'lineup_notified_at','lineup_claimed_at','lineup_attempts',
        'important_change_notified_at','important_change_claimed_at','important_change_attempts'
      ))
    )
  union all
  select
    'K|' || tc.table_name || '|' || tc.constraint_name || '|' || tc.constraint_type || '|' ||
    coalesce(pg_get_constraintdef(pc.oid, true),'')
  from information_schema.table_constraints tc
  join pg_constraint pc on pc.conname = tc.constraint_name
  join pg_namespace pn on pn.oid = pc.connamespace and pn.nspname = 'public'
  where tc.table_schema = 'public'
    and tc.table_name not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases'
    )
    and tc.constraint_name <> 'user_preferences_notification_preferences_object_check'
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename not in (
      'provider_incident_alert_deliveries',
      'analysis_timeline_snapshots',
      'favorite_players',
      'smart_notification_deliveries',
      'user_entitlements',
      'scheduled_job_leases'
    )
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
      'save_favorite_player_guarded',
      'save_match_reminder_guarded',
      'save_match_reminder_guarded_v2',
      'resolve_match_reminder_fixture',
      'prune_match_reminders_for_user',
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
      'claim_smart_notification_delivery',
      'finalize_smart_notification_delivery',
      'begin_smart_notification_delivery_send',
      'activate_pass_entitlement',
      'consume_pass_entitlement',
      'refund_pass_entitlement_usage',
      'refund_pass_entitlement',
      'backend_readiness_contract',
      'claim_scheduled_job',
      'complete_scheduled_job',
      'release_scheduled_job'
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

revoke execute on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;

notify pgrst, 'reload schema';
