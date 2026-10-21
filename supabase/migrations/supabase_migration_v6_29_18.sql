-- Durable recovery of lost REST responses. No lease is adopted from a row
-- belonging to an unknown caller, and delayed cache writes cannot replace a
-- newer version. Existing claim/renew/complete RPCs retain their contracts.

create table if not exists public.scheduled_job_claim_receipts (
  request_token uuid primary key,
  job_key text not null,
  group_key text not null,
  scheduled_at timestamptz not null,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists scheduled_job_claim_receipts_expiry_idx
  on public.scheduled_job_claim_receipts(expires_at);
alter table public.scheduled_job_claim_receipts enable row level security;
revoke all on table public.scheduled_job_claim_receipts from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.scheduled_job_claim_receipts to service_role;

create or replace function public.claim_scheduled_job_owned(
  p_job_key text,
  p_group_key text,
  p_scheduled_at timestamptz,
  p_owner_token uuid,
  p_lease_seconds integer default 720,
  p_retention_seconds integer default 172800
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_job_key,''));
  v_group text := btrim(coalesce(p_group_key,''));
  v_row public.scheduled_job_leases%rowtype;
  v_receipt public.scheduled_job_claim_receipts%rowtype;
  v_claim jsonb;
begin
  if v_key='' or length(v_key)>180 or v_group='' or length(v_group)>120
     or p_scheduled_at is null or not isfinite(p_scheduled_at) or p_owner_token is null then
    return jsonb_build_object('claimed',false,'reason','invalid_input');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('matchradar:scheduled-job'),pg_catalog.hashtext(v_group)
  );
  select * into v_receipt from public.scheduled_job_claim_receipts
    where request_token=p_owner_token for update;
  if found then
    if v_receipt.job_key<>v_key or v_receipt.group_key<>v_group
       or v_receipt.scheduled_at<>p_scheduled_at then
      return jsonb_build_object('claimed',false,'reason','invalid_input');
    end if;
    if (v_receipt.result->>'claimed')::boolean is not true then return v_receipt.result; end if;
    select * into v_row from public.scheduled_job_leases where job_key=v_key for update;
    if found and v_row.lease_token=p_owner_token::text and v_row.group_key=v_group
       and v_row.scheduled_at=p_scheduled_at and v_row.status='running'
       and v_row.locked_until>clock_timestamp() then
      return jsonb_build_object('claimed',true,'reason','ownership_confirmed',
        'jobKey',v_row.job_key,'groupKey',v_row.group_key,'leaseToken',v_row.lease_token,
        'scheduledAt',v_row.scheduled_at,'lockedUntil',v_row.locked_until);
    end if;
    -- A delayed replay cannot reacquire an expired/released/replaced lease.
    return jsonb_build_object('claimed',false,'reason','ownership_lost','jobKey',v_key,'groupKey',v_group);
  end if;
  -- Retain receipts for at least the lease/retention horizon. Bounded cleanup
  -- never removes proof for a still-running owner; no user data is stored.
  delete from public.scheduled_job_claim_receipts where request_token in (
    select r.request_token from public.scheduled_job_claim_receipts r
    where r.expires_at<=clock_timestamp() and not exists (
      select 1 from public.scheduled_job_leases j where j.job_key=r.job_key
        and j.lease_token=r.request_token::text and j.status='running' and j.locked_until>clock_timestamp()
    ) order by r.expires_at limit 32 for update skip locked
  );
  v_claim := public.claim_scheduled_job(v_key,v_group,p_scheduled_at,p_lease_seconds,p_retention_seconds);
  if (v_claim->>'claimed')::boolean is true then
    update public.scheduled_job_leases set lease_token=p_owner_token::text
      where job_key=v_key and lease_token=(v_claim->>'leaseToken') returning * into v_row;
    if not found then raise exception 'Scheduled owner transition failed'; end if;
    v_claim := v_claim || jsonb_build_object('leaseToken',v_row.lease_token);
  end if;
  insert into public.scheduled_job_claim_receipts(request_token,job_key,group_key,scheduled_at,result,expires_at)
    values(p_owner_token,v_key,v_group,p_scheduled_at,v_claim,
      clock_timestamp()+greatest(300,least(coalesce(p_retention_seconds,172800),604800),
        greatest(30,least(coalesce(p_lease_seconds,720),1800)))*interval '1 second');
  return v_claim;
end;
$$;

create or replace function public.guard_analysis_cache_version()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
begin
  -- Includes legacy REST upserts still in flight during a rolling deployment.
  if new.updated_at<old.updated_at then return null; end if;
  return new;
end;
$$;

drop trigger if exists analysis_cache_version_guard on public.analysis_cache;
create trigger analysis_cache_version_guard before update on public.analysis_cache
  for each row execute function public.guard_analysis_cache_version();

create or replace function public.write_analysis_cache_versioned(
  p_cache_key text,
  p_fixture_id bigint,
  p_payload jsonb,
  p_expires_at timestamptz,
  p_provider text,
  p_source_updated_at timestamptz,
  p_freshness_status text,
  p_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_row public.analysis_cache%rowtype;
begin
  if p_cache_key is null or p_cache_key='' or length(p_cache_key)>1000
     or p_fixture_id is null or p_fixture_id<0 or p_payload is null
     or p_updated_at is null or not isfinite(p_updated_at)
     or p_expires_at is null or not isfinite(p_expires_at) then
    return jsonb_build_object('stored',false,'reason','invalid_input');
  end if;
  if p_expires_at<=clock_timestamp() then
    return jsonb_build_object('stored',false,'reason','expired');
  end if;
  insert into public.analysis_cache(cache_key,fixture_id,payload,expires_at,
    provider,source_updated_at,freshness_status,updated_at)
  values(p_cache_key,p_fixture_id,p_payload,p_expires_at,p_provider,
    p_source_updated_at,p_freshness_status,p_updated_at)
  on conflict(cache_key) do update set
    fixture_id=excluded.fixture_id,payload=excluded.payload,expires_at=excluded.expires_at,
    provider=excluded.provider,source_updated_at=excluded.source_updated_at,
    freshness_status=excluded.freshness_status,updated_at=excluded.updated_at
  where public.analysis_cache.updated_at<excluded.updated_at
  returning * into v_row;
  if found then return jsonb_build_object('stored',true,'reason','stored'); end if;
  -- Exact content comparison also covers JSON object key reordering. A newer
  -- different snapshot is not confirmation of this operation's durability.
  select * into v_row from public.analysis_cache where cache_key=p_cache_key;
  if found and v_row.updated_at=p_updated_at and v_row.fixture_id=p_fixture_id
     and v_row.payload=p_payload and v_row.expires_at=p_expires_at
     and v_row.provider is not distinct from p_provider
     and v_row.source_updated_at is not distinct from p_source_updated_at
     and v_row.freshness_status is not distinct from p_freshness_status then
    return jsonb_build_object('stored',true,'reason','same');
  end if;
  return jsonb_build_object('stored',false,'reason','superseded');
end;
$$;

revoke all on function public.claim_scheduled_job_owned(text,text,timestamptz,uuid,integer,integer),
  public.guard_analysis_cache_version(),
  public.write_analysis_cache_versioned(text,bigint,jsonb,timestamptz,text,timestamptz,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_scheduled_job_owned(text,text,timestamptz,uuid,integer,integer),
  public.guard_analysis_cache_version(),
  public.write_analysis_cache_versioned(text,bigint,jsonb,timestamptz,text,timestamptz,text,timestamptz)
  to service_role;

-- Preserve the frozen v1 contract; v2 covers the new RPCs and trigger.
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
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency',
      'match_picks',
      'referral_rewards',
      'scheduled_job_claim_receipts'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name in ('transition_key','occurrence_count','last_occurred_at'))
      or (c.table_name = 'user_preferences' and c.column_name = 'notification_preferences')
      or (c.table_name = 'runtime_controls' and c.column_name = 'ai_enabled')
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
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency',
      'match_picks',
      'referral_rewards',
      'scheduled_job_claim_receipts'
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
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency',
      'match_picks',
      'referral_rewards',
      'scheduled_job_claim_receipts'
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
      'release_scheduled_job',
      'renew_scheduled_job',
      'record_provider_slo_observation',
      'read_provider_slo_buckets',
      'provider_slo_aggregation_contract',
      'claim_provider_incident_alert_delivery_v2',
      'begin_provider_incident_alert_delivery_send',
      'record_ops_event_occurrence',
      'claim_sensitive_mutation',
      'complete_sensitive_mutation',
      'fail_sensitive_mutation',
      'cleanup_sensitive_mutation_idempotency',
      'backend_schema_contract_v2',
      'backend_readiness_contract_v2',
      'claim_scheduled_job_owned',
      'write_analysis_cache_versioned',
      'guard_analysis_cache_version',
      'grant_referral_rewards',
      'reserve_referral_bonus',
      'refund_referral_bonus'
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

revoke all on function public.backend_schema_fingerprint()
  from public, anon, authenticated;
grant execute on function public.backend_schema_fingerprint()
  to service_role;

notify pgrst, 'reload schema';

-- Every public part remains covered. Separating the additive recovery objects
-- allows the exact new production hash to be derived from the already reviewed
-- base hash plus the independently measured recovery hash, before rollout.
create or replace function public.backend_schema_contract_v2()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
with contract_roles(role_name) as (
  values ('anon'::name), ('authenticated'::name), ('service_role'::name)
),
parts as (
  -- Relations and RLS state. No public relation is excluded from v2.
  select
    'R|' || c.relname
      || '|kind=' || c.relkind::text
      || '|rls=' || c.relrowsecurity::text
      || '|force_rls=' || c.relforcerowsecurity::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m','f','S')

  union all

  -- Complete public column contract, including identity/generated metadata.
  select
    'C|' || c.table_name
      || '|' || c.ordinal_position
      || '|' || c.column_name
      || '|' || c.data_type
      || '|' || coalesce(c.udt_name,'')
      || '|nullable=' || c.is_nullable
      || '|default=' || coalesce(c.column_default,'')
      || '|identity=' || coalesce(c.is_identity,'NO')
      || '|identity_generation=' || coalesce(c.identity_generation,'')
      || '|generated=' || coalesce(c.is_generated,'NEVER')
      || '|generation=' || coalesce(c.generation_expression,'') as part
  from information_schema.columns c
  where c.table_schema = 'public'

  union all

  -- All public relation constraints.
  select
    'K|' || c.relname
      || '|' || pc.conname
      || '|type=' || pc.contype::text
      || '|' || pg_get_constraintdef(pc.oid, true) as part
  from pg_constraint pc
  join pg_class c on c.oid = pc.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'

  union all

  -- All public indexes.
  select
    'I|' || tablename || '|' || indexname || '|' || indexdef as part
  from pg_indexes
  where schemaname = 'public'

  union all

  -- Function/procedure signatures and execution-relevant attributes.
  select
    'F|' || p.proname
      || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|result=' || coalesce(pg_get_function_result(p.oid),'')
      || '|kind=' || p.prokind::text
      || '|volatility=' || p.provolatile::text
      || '|strict=' || p.proisstrict::text
      || '|definer=' || p.prosecdef::text
      || '|parallel=' || p.proparallel::text as part
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'

  union all

  -- Full RLS policy definitions for public tables.
  select
    'P|' || p.tablename
      || '|' || p.policyname
      || '|permissive=' || coalesce(p.permissive,'')
      || '|cmd=' || coalesce(p.cmd,'')
      || '|roles=' || coalesce(array_to_string(p.roles, ','),'')
      || '|qual=' || coalesce(p.qual,'')
      || '|check=' || coalesce(p.with_check,'') as part
  from pg_policies p
  where p.schemaname = 'public'

  union all

  -- User-defined trigger definitions.
  select
    'TR|' || c.relname
      || '|' || t.tgname
      || '|' || pg_get_triggerdef(t.oid, true) as part
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal

  union all

  -- Effective table/view grants for the application-facing database roles.
  select
    'G|' || c.relname
      || '|role=' || r.role_name::text
      || '|select=' || has_table_privilege(r.role_name::text, c.oid, 'SELECT')::text
      || '|insert=' || has_table_privilege(r.role_name::text, c.oid, 'INSERT')::text
      || '|update=' || has_table_privilege(r.role_name::text, c.oid, 'UPDATE')::text
      || '|delete=' || has_table_privilege(r.role_name::text, c.oid, 'DELETE')::text
      || '|truncate=' || has_table_privilege(r.role_name::text, c.oid, 'TRUNCATE')::text
      || '|references=' || has_table_privilege(r.role_name::text, c.oid, 'REFERENCES')::text
      || '|trigger=' || has_table_privilege(r.role_name::text, c.oid, 'TRIGGER')::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join contract_roles r
  where n.nspname = 'public'
    and c.relkind in ('r','p','v','m','f')

  union all

  -- Effective sequence grants for the same roles.
  select
    'S|' || c.relname
      || '|role=' || r.role_name::text
      || '|usage=' || has_sequence_privilege(r.role_name::text, c.oid, 'USAGE')::text
      || '|select=' || has_sequence_privilege(r.role_name::text, c.oid, 'SELECT')::text
      || '|update=' || has_sequence_privilege(r.role_name::text, c.oid, 'UPDATE')::text as part
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join contract_roles r
  where n.nspname = 'public'
    and c.relkind = 'S'

  union all

  -- Effective EXECUTE grants for every public function/procedure.
  select
    'X|' || p.proname
      || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      || '|role=' || r.role_name::text
      || '|execute=' || has_function_privilege(r.role_name::text, p.oid, 'EXECUTE')::text as part
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join contract_roles r
  where n.nspname = 'public'
),
partitioned as (
  select part, part ~ '^(R|C|K|I|P|G)\|scheduled_job_claim_receipts\|'
    or part ~ '^(F|X)\|(claim_scheduled_job_owned|write_analysis_cache_versioned|guard_analysis_cache_version)\('
    or part ~ '^TR\|analysis_cache\|analysis_cache_version_guard\|' as recovery
  from parts
), hashes as (
  select count(*) as parts,
    md5(coalesce(string_agg(part,E'\n' order by part) filter(where not recovery),'')) as base_hash,
    md5(coalesce(string_agg(part,E'\n' order by part) filter(where recovery),'')) as recovery_hash
  from partitioned
)
select jsonb_build_object(
  'ok',parts>0,'version',2,
  'algorithm','partitioned-durable-v1',
  'fingerprint',md5(base_hash || E'\n' || recovery_hash),
  'baseFingerprint',base_hash,'recoveryFingerprint',recovery_hash,'parts',parts,
  'scope','all-public-relations-columns-constraints-indexes-functions-policies-triggers-and-app-role-grants',
  'checkedAt',now()
) from hashes;
$$;

revoke all on function public.backend_schema_contract_v2() from public,anon,authenticated;
grant execute on function public.backend_schema_contract_v2() to service_role;

notify pgrst, 'reload schema';
