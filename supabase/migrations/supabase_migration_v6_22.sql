-- Football Analytics v6.22 / Favorite Players
-- Additive migration for authenticated per-user player follows.
-- Smart Notification delivery is intentionally NOT implemented here.

create table if not exists public.favorite_players (
  telegram_id bigint not null references public.users(telegram_id) on delete cascade,
  player_id bigint not null check (player_id > 0),
  player_name text not null check (char_length(btrim(player_name)) between 1 and 160),
  team_id bigint not null check (team_id > 0),
  created_at timestamptz not null default now(),
  primary key (telegram_id, player_id)
);

create index if not exists favorite_players_user_created_idx
  on public.favorite_players (telegram_id, created_at desc);

alter table public.favorite_players enable row level security;
revoke all privileges on table public.favorite_players from public, anon, authenticated;
grant select, insert, update, delete on table public.favorite_players to service_role;

comment on table public.favorite_players is
  'MatchRadar backend-only user follows for Player Hub. Delivery of player notifications is handled by a future feature.';

create or replace function public.save_favorite_player_guarded(
  p_telegram_id bigint,
  p_player_id bigint,
  p_player_name text,
  p_team_id bigint,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_player_name, ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_count integer := 0;
  v_exists boolean := false;
  v_row public.favorite_players%rowtype;
begin
  if p_telegram_id is null or p_telegram_id <= 0
     or p_player_id is null or p_player_id <= 0
     or p_team_id is null or p_team_id <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  if v_name = '' or char_length(v_name) > 160 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_input');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:favorite_players'),
    (p_telegram_id % 2147483647)::integer
  );

  select exists(
    select 1
    from public.favorite_players
    where telegram_id = p_telegram_id
      and player_id = p_player_id
  ) into v_exists;

  if not v_exists then
    select count(*)::integer into v_count
    from public.favorite_players
    where telegram_id = p_telegram_id;

    if v_count >= v_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'limit_reached',
        'count', v_count,
        'limit', v_limit
      );
    end if;
  end if;

  insert into public.favorite_players(
    telegram_id,
    player_id,
    player_name,
    team_id,
    created_at
  )
  values (
    p_telegram_id,
    p_player_id,
    v_name,
    p_team_id,
    now()
  )
  on conflict (telegram_id, player_id)
  do update set
    player_name = excluded.player_name,
    team_id = excluded.team_id
  returning * into v_row;

  select count(*)::integer into v_count
  from public.favorite_players
  where telegram_id = p_telegram_id;

  return jsonb_build_object(
    'allowed', true,
    'reason', case when v_exists then 'updated' else 'created' end,
    'count', v_count,
    'limit', v_limit,
    'item', to_jsonb(v_row)
  );
end;
$$;

create or replace function public.personal_write_guard_contract()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'version', 'v2',
    'favoritesLimit', 50,
    'favoritePlayersLimit', 50,
    'remindersLimit', 50
  );
$$;

revoke execute on function public.save_favorite_player_guarded(bigint,bigint,text,bigint,integer)
  from public, anon, authenticated;
grant execute on function public.save_favorite_player_guarded(bigint,bigint,text,bigint,integer)
  to service_role;

revoke execute on function public.personal_write_guard_contract()
  from public, anon, authenticated;
grant execute on function public.personal_write_guard_contract()
  to service_role;

-- Keep the current production structural fingerprint stable during this
-- additive rollout. favorite_players is verified explicitly by schema probes
-- and the personal-write contract below instead of being hidden from readiness.
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
    and c.table_name not in ('provider_incident_alert_deliveries', 'favorite_players')
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name = 'transition_key')
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
    and tc.table_name not in ('provider_incident_alert_deliveries', 'favorite_players')
    and not (tc.table_name = 'ops_events' and tc.constraint_name = 'ops_events_transition_key_key')
  union all
  select 'I|' || indexname || '|' || indexdef
  from pg_indexes
  where schemaname = 'public'
    and tablename not in ('provider_incident_alert_deliveries', 'favorite_players')
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
