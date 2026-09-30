-- MatchRadar v6.24 / Smart Notifications
-- Additive preferences + persistent event delivery ledger.
-- Existing match_reminders delivery columns remain authoritative for prematch/kickoff/lineup/important-change.

alter table public.user_preferences
  add column if not exists notification_preferences jsonb not null
  default '{"enabled":true,"match":true,"teams":true,"players":true,"aiRadar":true}'::jsonb;

alter table public.user_preferences
  drop constraint if exists user_preferences_notification_preferences_object_check;

alter table public.user_preferences
  add constraint user_preferences_notification_preferences_object_check
  check (jsonb_typeof(notification_preferences) = 'object');

create table if not exists public.smart_notification_deliveries (
  telegram_id bigint not null references public.users(telegram_id) on delete cascade,
  fixture_id bigint not null check (fixture_id > 0),
  event_type text not null check (char_length(event_type) between 1 and 80),
  category text not null check (category in ('match','teams','players','aiRadar')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 240),
  status text not null default 'claimed'
    check (status in ('claimed','sent','retry_pending','unknown','terminal_failed')),
  attempts integer not null default 1 check (attempts >= 1),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  retry_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (telegram_id, dedupe_key)
);

create index if not exists smart_notification_delivery_recent_idx
  on public.smart_notification_deliveries (telegram_id, fixture_id, event_type, created_at desc);

create index if not exists smart_notification_delivery_retry_idx
  on public.smart_notification_deliveries (status, retry_at)
  where status = 'retry_pending';

alter table public.smart_notification_deliveries enable row level security;
revoke all privileges on table public.smart_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.smart_notification_deliveries to service_role;

comment on table public.smart_notification_deliveries is
  'Server-only idempotency, cooldown and retry ledger for repeatable Smart Notification events. Existing reminder delivery state is not duplicated here.';

create or replace function public.claim_smart_notification_delivery(
  p_telegram_id bigint,
  p_fixture_id bigint,
  p_event_type text,
  p_category text,
  p_dedupe_key text,
  p_cooldown_seconds integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_existing public.smart_notification_deliveries%rowtype;
  v_claim_at timestamptz := now();
  v_cooldown_seconds integer := greatest(0, least(coalesce(p_cooldown_seconds, 0), 86400));
begin
  if p_telegram_id is null or p_telegram_id <= 0
     or p_fixture_id is null or p_fixture_id <= 0
     or btrim(coalesce(p_event_type, '')) = ''
     or btrim(coalesce(p_dedupe_key, '')) = ''
     or p_category not in ('match','teams','players','aiRadar')
     or char_length(p_event_type) > 80
     or char_length(p_dedupe_key) > 240 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:smart-notifications'),
    pg_catalog.hashtext(p_telegram_id::text || ':' || p_dedupe_key)
  );

  select *
  into v_existing
  from public.smart_notification_deliveries
  where telegram_id = p_telegram_id
    and dedupe_key = p_dedupe_key
  for update;

  if found then
    if v_existing.status = 'retry_pending'
       and (v_existing.retry_at is null or v_existing.retry_at <= v_claim_at) then
      update public.smart_notification_deliveries
      set status = 'claimed',
          attempts = attempts + 1,
          claimed_at = v_claim_at,
          retry_at = null,
          updated_at = v_claim_at
      where telegram_id = p_telegram_id
        and dedupe_key = p_dedupe_key;

      return jsonb_build_object(
        'allowed', true,
        'reason', 'retry',
        'claimAt', v_claim_at
      );
    end if;

    if v_existing.status = 'claimed'
       and v_existing.claimed_at <= v_claim_at - interval '20 minutes' then
      update public.smart_notification_deliveries
      set attempts = attempts + 1,
          claimed_at = v_claim_at,
          updated_at = v_claim_at
      where telegram_id = p_telegram_id
        and dedupe_key = p_dedupe_key;

      return jsonb_build_object(
        'allowed', true,
        'reason', 'stale_claim_recovered',
        'claimAt', v_claim_at
      );
    end if;

    return jsonb_build_object(
      'allowed', false,
      'reason', case when v_existing.status = 'retry_pending' then 'retry_wait' else 'duplicate' end
    );
  end if;

  if v_cooldown_seconds > 0 and exists (
    select 1
    from public.smart_notification_deliveries d
    where d.telegram_id = p_telegram_id
      and d.fixture_id = p_fixture_id
      and d.event_type = p_event_type
      and d.status in ('claimed','sent','retry_pending','unknown')
      and coalesce(d.sent_at, d.claimed_at, d.created_at)
        > v_claim_at - make_interval(secs => v_cooldown_seconds)
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown');
  end if;

  insert into public.smart_notification_deliveries (
    telegram_id,
    fixture_id,
    event_type,
    category,
    dedupe_key,
    status,
    attempts,
    claimed_at,
    created_at,
    updated_at
  )
  values (
    p_telegram_id,
    p_fixture_id,
    btrim(p_event_type),
    p_category,
    btrim(p_dedupe_key),
    'claimed',
    1,
    v_claim_at,
    v_claim_at,
    v_claim_at
  );

  return jsonb_build_object(
    'allowed', true,
    'reason', 'created',
    'claimAt', v_claim_at
  );
end;
$$;

create or replace function public.finalize_smart_notification_delivery(
  p_telegram_id bigint,
  p_dedupe_key text,
  p_claimed_at timestamptz,
  p_status text,
  p_error text default '',
  p_retry_after_seconds integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_updated integer := 0;
  v_now timestamptz := now();
  v_retry_seconds integer := greatest(0, least(coalesce(p_retry_after_seconds, 0), 86400));
begin
  if p_status not in ('sent','retry_pending','unknown','terminal_failed') then
    return jsonb_build_object('updated', false, 'reason', 'invalid_status');
  end if;

  update public.smart_notification_deliveries
  set status = p_status,
      sent_at = case when p_status = 'sent' then v_now else sent_at end,
      retry_at = case
        when p_status = 'retry_pending' and v_retry_seconds > 0
          then v_now + make_interval(secs => v_retry_seconds)
        else null
      end,
      last_error = left(coalesce(p_error, ''), 240),
      updated_at = v_now
  where telegram_id = p_telegram_id
    and dedupe_key = p_dedupe_key
    and status = 'claimed'
    and claimed_at = p_claimed_at;

  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated = 1);
end;
$$;

revoke execute on function public.claim_smart_notification_delivery(bigint,bigint,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.claim_smart_notification_delivery(bigint,bigint,text,text,text,integer)
  to service_role;

revoke execute on function public.finalize_smart_notification_delivery(bigint,text,timestamptz,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.finalize_smart_notification_delivery(bigint,text,timestamptz,text,text,integer)
  to service_role;

-- Preserve the established structural fingerprint while additive notification
-- objects roll out. Readiness verifies these objects explicitly.
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
      'smart_notification_deliveries'
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
      'smart_notification_deliveries'
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
      'smart_notification_deliveries'
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
      'personal_write_guard_contract',
      'claim_provider_incident_alert_delivery',
      'finalize_provider_incident_alert_delivery',
      'provider_incident_alert_delivery_contract',
      'claim_smart_notification_delivery',
      'finalize_smart_notification_delivery',
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

revoke execute on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;

notify pgrst, 'reload schema';
