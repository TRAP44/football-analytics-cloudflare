-- Audited runtime-control writes through PostgREST. A PATCH data-modifying CTE
-- cannot target a table with the immutable DO ALSO history rule. Keep that rule
-- and perform the same CAS as plain SQL inside a service-only invoker function.
create or replace function public.commit_runtime_controls_v2(
  p_expected_revision integer,
  p_controls jsonb,
  p_action text,
  p_reason text,
  p_app_version text,
  p_actor_id bigint,
  p_source_revision integer default null
)
returns setof public.runtime_controls
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  previous public.runtime_controls%rowtype;
  committed public.runtime_controls%rowtype;
  v_snapshot jsonb;
  headers jsonb;
  source_snapshot jsonb;
  target_controls jsonb;
  was_locked boolean;
  next_locked boolean;
  key text;
begin
  if current_user <> 'service_role' then raise exception 'Runtime mutation requires service role' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647
    or p_actor_id is null or p_actor_id<1 or p_actor_id>9007199254740991
    or p_action is null or p_action not in ('update','defaults','rollback','lockdown','lockdown_release')
    or p_reason is null or length(p_reason)>240 or p_reason ~ '[[:cntrl:]]'
    or p_app_version is null or length(btrim(p_app_version))<1 or length(p_app_version)>120 or p_app_version ~ '[[:cntrl:]]'
    or jsonb_typeof(p_controls) is distinct from 'object' then
    raise exception 'Invalid runtime mutation input' using errcode='22023';
  end if;
  for key in select jsonb_object_keys(p_controls) loop
    if key not in ('maintenance_mode','analysis_enabled','search_enabled','live_enabled','reminders_enabled','expanded_data_enabled','auto_settlement_recovery_enabled','ai_enabled','message') then
      raise exception 'Unknown runtime field' using errcode='22023';
    end if;
  end loop;
  foreach key in array array['maintenance_mode','analysis_enabled','search_enabled','live_enabled','reminders_enabled','expanded_data_enabled','auto_settlement_recovery_enabled','ai_enabled'] loop
    if jsonb_typeof(p_controls->key) is distinct from 'boolean' then raise exception 'Invalid runtime flag' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(p_controls->'message') is distinct from 'string' or length(p_controls->>'message')>280 or p_controls->>'message' ~ '[[:cntrl:]]'
    or (p_action='rollback' and (p_source_revision is null or p_source_revision<1))
    or (p_action<>'rollback' and p_source_revision is not null) then
    raise exception 'Invalid runtime mutation metadata' using errcode='22023';
  end if;
  if coalesce((public.backend_security_contract()->>'ok')::boolean,false) is not true then
    raise exception 'Runtime security contract unavailable' using errcode='42501';
  end if;
  select * into previous from public.runtime_controls where id='global' for update;
  if not found or previous.revision<>p_expected_revision then return; end if;
  if p_action='rollback' and (p_source_revision>=previous.revision or not exists(select 1 from public.runtime_control_history where revision=p_source_revision)) then
    raise exception 'Runtime rollback source unavailable' using errcode='22023';
  end if;
  was_locked := previous.maintenance_mode and not previous.analysis_enabled and not previous.search_enabled
    and not previous.live_enabled and not previous.reminders_enabled and not previous.expanded_data_enabled and not previous.auto_settlement_recovery_enabled;
  next_locked := (p_controls->>'maintenance_mode')::boolean and not (p_controls->>'analysis_enabled')::boolean
    and not (p_controls->>'search_enabled')::boolean and not (p_controls->>'live_enabled')::boolean
    and not (p_controls->>'reminders_enabled')::boolean and not (p_controls->>'expanded_data_enabled')::boolean
    and not (p_controls->>'auto_settlement_recovery_enabled')::boolean;
  if (was_locked and p_action='update' and not next_locked)
    or (p_action='lockdown' and (not next_locked or (p_controls->>'ai_enabled')::boolean))
    or (p_action='lockdown_release' and ((p_controls->>'maintenance_mode')::boolean
      or not (p_controls->>'analysis_enabled')::boolean or not (p_controls->>'search_enabled')::boolean
      or not (p_controls->>'live_enabled')::boolean or not (p_controls->>'reminders_enabled')::boolean
      or not (p_controls->>'expanded_data_enabled')::boolean or not (p_controls->>'ai_enabled')::boolean
      or (p_controls->>'auto_settlement_recovery_enabled')::boolean)) then
    raise exception 'Runtime lockdown action mismatch' using errcode='22023';
  end if;
  if p_action='rollback' then
    select h.snapshot into source_snapshot from public.runtime_control_history h where h.revision=p_source_revision;
    target_controls := jsonb_build_object('maintenance_mode',source_snapshot->'maintenanceMode','analysis_enabled',source_snapshot->'analysisEnabled',
      'search_enabled',source_snapshot->'searchEnabled','live_enabled',source_snapshot->'liveEnabled','reminders_enabled',source_snapshot->'remindersEnabled',
      'expanded_data_enabled',source_snapshot->'expandedDataEnabled','auto_settlement_recovery_enabled',source_snapshot->'autoSettlementRecoveryEnabled',
      'ai_enabled',coalesce(nullif(source_snapshot->'aiEnabled','null'::jsonb),'true'::jsonb),'message',coalesce(nullif(source_snapshot->'message','null'::jsonb),'""'::jsonb));
    if p_controls is distinct from target_controls then raise exception 'Runtime rollback payload mismatch' using errcode='22023'; end if;
  end if;
  v_snapshot := jsonb_build_object('maintenanceMode',previous.maintenance_mode,'analysisEnabled',previous.analysis_enabled,
    'searchEnabled',previous.search_enabled,'liveEnabled',previous.live_enabled,'remindersEnabled',previous.reminders_enabled,
    'expandedDataEnabled',previous.expanded_data_enabled,'autoSettlementRecoveryEnabled',previous.auto_settlement_recovery_enabled,
    'aiEnabled',previous.ai_enabled,'message',previous.message,'revision',previous.revision);
  insert into public.runtime_control_history(revision,action,reason,snapshot,app_version,changed_by,source_revision,created_at)
    values(previous.revision,'baseline','Базовое состояние перед изменением настроек',v_snapshot || jsonb_build_object('updatedAt',previous.updated_at),p_app_version,p_actor_id,null,previous.updated_at)
    on conflict(revision) do nothing;
  if not exists(select 1 from public.runtime_control_history h where h.revision=previous.revision
    and (h.snapshot || jsonb_build_object('aiEnabled',coalesce(nullif(h.snapshot->'aiEnabled','null'::jsonb),'true'::jsonb),'message',coalesce(nullif(h.snapshot->'message','null'::jsonb),'""'::jsonb))) @> v_snapshot) then
    raise exception 'Runtime baseline history mismatch' using errcode='23514';
  end if;
  headers := coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  perform set_config('request.headers',(headers || jsonb_build_object('x-runtime-action',p_action,
    'x-runtime-reason-hex',encode(convert_to(p_reason,'UTF8'),'hex'),'x-runtime-app-version',p_app_version,
    'x-runtime-source-revision',coalesce(p_source_revision::text,'')))::text,true);
  update public.runtime_controls set
    maintenance_mode=(p_controls->>'maintenance_mode')::boolean,
    analysis_enabled=(p_controls->>'analysis_enabled')::boolean,
    search_enabled=(p_controls->>'search_enabled')::boolean,
    live_enabled=(p_controls->>'live_enabled')::boolean,
    reminders_enabled=(p_controls->>'reminders_enabled')::boolean,
    expanded_data_enabled=(p_controls->>'expanded_data_enabled')::boolean,
    auto_settlement_recovery_enabled=(p_controls->>'auto_settlement_recovery_enabled')::boolean,
    ai_enabled=(p_controls->>'ai_enabled')::boolean,
    message=p_controls->>'message',revision=p_expected_revision+1,updated_at=clock_timestamp(),updated_by=p_actor_id
    where id='global' and revision=p_expected_revision returning * into committed;
  if not found then return; end if;
  v_snapshot := jsonb_build_object('maintenanceMode',committed.maintenance_mode,'analysisEnabled',committed.analysis_enabled,
    'searchEnabled',committed.search_enabled,'liveEnabled',committed.live_enabled,'remindersEnabled',committed.reminders_enabled,
    'expandedDataEnabled',committed.expanded_data_enabled,'autoSettlementRecoveryEnabled',committed.auto_settlement_recovery_enabled,
    'aiEnabled',committed.ai_enabled,'message',committed.message,'revision',committed.revision,'requestedAction',p_action);
  if not exists(select 1 from public.runtime_control_history h where h.revision=committed.revision
    and h.snapshot @> v_snapshot and h.changed_by=p_actor_id and h.reason=p_reason and h.app_version=p_app_version
    and h.action=case when p_action in ('defaults','rollback') then p_action else 'update' end
    and h.source_revision is not distinct from p_source_revision) then
    raise exception 'Runtime atomic history unconfirmed' using errcode='23514';
  end if;
  return next committed;
end;
$$;
revoke all on function public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.commit_runtime_controls_v2(integer,jsonb,text,text,text,bigint,integer) to service_role;

-- Preserve the frozen legacy compatibility hash. Full v2 coverage is retained
-- by a separate runtime partition, enabling a no-downtime compatibility bridge.
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
      'refund_referral_bonus',
      'commit_runtime_controls_v2'
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

  union all

  -- The runtime mutation body/search path are security-relevant. Retain full
  -- F/X coverage as well, including any unexpected overload or EXECUTE grant.
  select 'RT|' || p.proname || '|source=' || md5(p.prosrc)
    || '|config=' || coalesce(array_to_string(p.proconfig,','),'')
    || '|defaults=' || coalesce(pg_get_expr(p.proargdefaults,0),'') as part
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='commit_runtime_controls_v2'
),
partitioned as (
  select part, part ~ '^(R|C|K|I|P|G)\|scheduled_job_claim_receipts\|'
    or part ~ '^(F|X)\|(claim_scheduled_job_owned|write_analysis_cache_versioned|guard_analysis_cache_version)\('
    or part ~ '^TR\|analysis_cache\|analysis_cache_version_guard\|' as recovery,
    part ~ '^(F|X)\|commit_runtime_controls_v2\(' or part ~ '^RT\|commit_runtime_controls_v2\|' as runtime_mutation
  from parts
), hashes as (
  select count(*) as parts,
    md5(coalesce(string_agg(part,E'\n' order by part) filter(where not recovery and not runtime_mutation),'')) as base_hash,
    md5(coalesce(string_agg(part,E'\n' order by part) filter(where recovery),'')) as recovery_hash,
    md5(coalesce(string_agg(part,E'\n' order by part) filter(where runtime_mutation),'')) as runtime_hash
  from partitioned
)
select jsonb_build_object(
  'ok',parts>0,'version',2,
  'algorithm','partitioned-durable-runtime-v1',
  'fingerprint',md5(base_hash || E'\n' || recovery_hash || E'\n' || runtime_hash),
  'baseFingerprint',base_hash,'recoveryFingerprint',recovery_hash,'runtimeMutationFingerprint',runtime_hash,'parts',parts,
  'scope','all-public-relations-columns-constraints-indexes-functions-policies-triggers-and-app-role-grants',
  'checkedAt',now()
) from hashes;
$$;

revoke all on function public.backend_schema_contract_v2() from public,anon,authenticated;
grant execute on function public.backend_schema_contract_v2() to service_role;

notify pgrst, 'reload schema';
