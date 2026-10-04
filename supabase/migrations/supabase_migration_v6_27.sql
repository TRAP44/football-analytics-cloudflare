-- MatchRadar v6.27 / distributed sensitive mutation idempotency
-- Additive, backward-compatible migration. This must be applied before the
-- Worker starts requiring persistent sensitive-mutation coordination.

create table if not exists public.sensitive_mutation_idempotency (
  operation_key text primary key,
  actor_id bigint not null,
  method text not null,
  path text not null,
  request_digest text not null,
  idempotency_key_hash text,
  state text not null default 'inflight',
  retryable boolean not null default false,
  lease_token text,
  locked_until timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  constraint sensitive_mutation_operation_key_hash_check
    check (operation_key ~ '^[0-9a-f]{64}$'),
  constraint sensitive_mutation_actor_check
    check (actor_id > 0),
  constraint sensitive_mutation_method_check
    check (method in ('POST','PUT','PATCH','DELETE')),
  constraint sensitive_mutation_path_check
    check (path like '/api/%' and char_length(path) <= 160),
  constraint sensitive_mutation_request_digest_check
    check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint sensitive_mutation_idempotency_key_hash_check
    check (idempotency_key_hash is null or idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  constraint sensitive_mutation_state_check
    check (state in ('inflight','completed','failed'))
);

create index if not exists sensitive_mutation_idempotency_expiry_idx
  on public.sensitive_mutation_idempotency(expires_at);

create index if not exists sensitive_mutation_idempotency_actor_path_idx
  on public.sensitive_mutation_idempotency(actor_id,path,created_at desc);

alter table public.sensitive_mutation_idempotency enable row level security;

revoke all privileges on table public.sensitive_mutation_idempotency
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.sensitive_mutation_idempotency
  to service_role;

comment on table public.sensitive_mutation_idempotency is
  'Backend-only distributed idempotency ledger for sensitive API mutations. Stores digests only, never raw request bodies, Telegram initData, tokens, or client idempotency keys.';

create or replace function public.claim_sensitive_mutation(
  p_operation_key text,
  p_actor_id bigint,
  p_method text,
  p_path text,
  p_request_digest text,
  p_idempotency_key_hash text default null,
  p_lease_seconds integer default 300,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,300),600));
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_token text := md5(
    coalesce(p_operation_key,'') || ':' || v_now::text || ':' || random()::text
  );
  v_existing public.sensitive_mutation_idempotency%rowtype;
  v_rows integer := 0;
begin
  if p_operation_key is null or p_operation_key !~ '^[0-9a-f]{64}$'
     or p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$'
     or p_actor_id is null or p_actor_id <= 0
     or p_method not in ('POST','PUT','PATCH','DELETE')
     or p_path is null or p_path !~ '^/api/' or char_length(p_path) > 160
     or (
       p_idempotency_key_hash is not null
       and p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     ) then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'invalid_input'
    );
  end if;

  -- Bounded opportunistic retention cleanup; the expiry index keeps this cheap.
  delete from public.sensitive_mutation_idempotency
  where ctid in (
    select ctid
    from public.sensitive_mutation_idempotency
    where expires_at <= v_now
    order by expires_at
    limit 32
  );

  insert into public.sensitive_mutation_idempotency (
    operation_key,
    actor_id,
    method,
    path,
    request_digest,
    idempotency_key_hash,
    state,
    retryable,
    lease_token,
    locked_until,
    expires_at,
    created_at,
    last_claimed_at
  )
  values (
    p_operation_key,
    p_actor_id,
    p_method,
    p_path,
    p_request_digest,
    p_idempotency_key_hash,
    'inflight',
    false,
    v_token,
    v_now + make_interval(secs => v_lease_seconds),
    v_now + make_interval(secs => v_retention_seconds),
    v_now,
    v_now
  )
  on conflict (operation_key) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return jsonb_build_object(
      'claimed', true,
      'state', 'inflight',
      'reason', 'claimed',
      'leaseToken', v_token,
      'lockedUntil', v_now + make_interval(secs => v_lease_seconds),
      'expiresAt', v_now + make_interval(secs => v_retention_seconds)
    );
  end if;

  select *
  into v_existing
  from public.sensitive_mutation_idempotency
  where operation_key = p_operation_key
  for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'claim_race'
    );
  end if;

  if v_existing.actor_id <> p_actor_id
     or v_existing.method <> p_method
     or v_existing.path <> p_path
     or v_existing.request_digest <> p_request_digest
     or v_existing.idempotency_key_hash is distinct from p_idempotency_key_hash then
    return jsonb_build_object(
      'claimed', false,
      'state', v_existing.state,
      'reason', 'request_conflict'
    );
  end if;

  if v_existing.state = 'completed' and v_existing.expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'completed',
      'reason', 'duplicate_completed',
      'expiresAt', v_existing.expires_at
    );
  end if;

  if v_existing.state = 'inflight'
     and coalesce(v_existing.locked_until, v_existing.expires_at) > v_now
     and v_existing.expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'inflight',
      'reason', 'duplicate_inflight',
      'lockedUntil', v_existing.locked_until,
      'expiresAt', v_existing.expires_at
    );
  end if;

  if v_existing.state = 'failed'
     and not v_existing.retryable
     and v_existing.expires_at > v_now then
    return jsonb_build_object(
      'claimed', false,
      'state', 'failed',
      'reason', 'duplicate_failed',
      'expiresAt', v_existing.expires_at
    );
  end if;

  update public.sensitive_mutation_idempotency
  set state='inflight',
      retryable=false,
      lease_token=v_token,
      locked_until=v_now + make_interval(secs => v_lease_seconds),
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      last_claimed_at=v_now,
      completed_at=null,
      failed_at=null
  where operation_key=p_operation_key;

  return jsonb_build_object(
    'claimed', true,
    'state', 'inflight',
    'reason', case
      when v_existing.state='failed' and v_existing.retryable then 'retry_failed'
      else 'reclaimed'
    end,
    'leaseToken', v_token,
    'lockedUntil', v_now + make_interval(secs => v_lease_seconds),
    'expiresAt', v_now + make_interval(secs => v_retention_seconds)
  );
end;
$$;

create or replace function public.complete_sensitive_mutation(
  p_operation_key text,
  p_lease_token text,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_rows integer := 0;
begin
  update public.sensitive_mutation_idempotency
  set state='completed',
      retryable=false,
      locked_until=null,
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      completed_at=v_now,
      failed_at=null
  where operation_key=p_operation_key
    and state='inflight'
    and lease_token=p_lease_token;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok',v_rows=1,'updated',v_rows=1,'state','completed');
end;
$$;

create or replace function public.fail_sensitive_mutation(
  p_operation_key text,
  p_lease_token text,
  p_retryable boolean,
  p_retention_seconds integer default 300
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_retention_seconds integer := greatest(60, least(coalesce(p_retention_seconds,300),3600));
  v_rows integer := 0;
begin
  update public.sensitive_mutation_idempotency
  set state='failed',
      retryable=coalesce(p_retryable,false),
      locked_until=null,
      expires_at=v_now + make_interval(secs => v_retention_seconds),
      failed_at=v_now,
      completed_at=null
  where operation_key=p_operation_key
    and state='inflight'
    and lease_token=p_lease_token;

  get diagnostics v_rows = row_count;
  return jsonb_build_object(
    'ok',v_rows=1,
    'updated',v_rows=1,
    'state','failed',
    'retryable',coalesce(p_retryable,false)
  );
end;
$$;

create or replace function public.cleanup_sensitive_mutation_idempotency(
  p_limit integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := greatest(1,least(coalesce(p_limit,1000),5000));
  v_rows integer := 0;
begin
  delete from public.sensitive_mutation_idempotency
  where ctid in (
    select ctid
    from public.sensitive_mutation_idempotency
    where expires_at <= clock_timestamp()
    order by expires_at
    limit v_limit
  );
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) from public, anon, authenticated, service_role;
revoke all on function public.complete_sensitive_mutation(
  text,text,integer
) from public, anon, authenticated, service_role;
revoke all on function public.fail_sensitive_mutation(
  text,text,boolean,integer
) from public, anon, authenticated, service_role;
revoke all on function public.cleanup_sensitive_mutation_idempotency(
  integer
) from public, anon, authenticated, service_role;

grant execute on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) to service_role;
grant execute on function public.complete_sensitive_mutation(
  text,text,integer
) to service_role;
grant execute on function public.fail_sensitive_mutation(
  text,text,boolean,integer
) to service_role;
grant execute on function public.cleanup_sensitive_mutation_idempotency(
  integer
) to service_role;

comment on function public.claim_sensitive_mutation(
  text,bigint,text,text,text,text,integer,integer
) is 'Atomic distributed claim for sensitive mutation execution ownership.';
comment on function public.complete_sensitive_mutation(
  text,text,integer
) is 'Marks the current lease owner completed without storing response or request payload.';
comment on function public.fail_sensitive_mutation(
  text,text,boolean,integer
) is 'Marks the current lease owner failed and records endpoint-aware retry eligibility.';
comment on function public.cleanup_sensitive_mutation_idempotency(
  integer
) is 'Bounded backend cleanup for expired sensitive mutation idempotency rows.';

-- Preserve the established structural readiness fingerprint during the
-- additive v6.27 rollout so the currently deployed Worker remains compatible
-- while this migration is applied before the new Worker.
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
      'sensitive_mutation_idempotency'
    )
    and not (
      (c.table_name = 'analysis_cache' and c.column_name in ('provider','source_updated_at','freshness_status','updated_at'))
      or (c.table_name = 'odds_snapshots' and c.column_name in ('provider','bookmaker_count','source_updated_at'))
      or (c.table_name = 'model_predictions' and c.column_name in ('data_provenance','model_inputs_version'))
      or (c.table_name = 'ops_events' and c.column_name in ('transition_key','occurrence_count','last_occurred_at'))
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
      'scheduled_job_leases',
      'provider_slo_buckets',
      'sensitive_mutation_idempotency'
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
      'sensitive_mutation_idempotency'
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
      'record_provider_slo_observation',
      'read_provider_slo_buckets',
      'provider_slo_aggregation_contract',
      'claim_provider_incident_alert_delivery_v2',
      'begin_provider_incident_alert_delivery_send',
      'record_ops_event_occurrence',
      'claim_sensitive_mutation',
      'complete_sensitive_mutation',
      'fail_sensitive_mutation',
      'cleanup_sensitive_mutation_idempotency'
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


notify pgrst, 'reload schema';
