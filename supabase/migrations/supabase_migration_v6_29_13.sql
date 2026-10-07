-- MatchRadar v6.29.13 / ops-event release identity rollover
-- Forward fix for transition-key-deduplicated operational events.
--
-- v6.26.3 correctly increments occurrence_count atomically, but its ON CONFLICT
-- branch preserved the metadata from the first occurrence forever. That made a
-- transition first seen on an older deployment keep the old deploy/version
-- identity even when the same transition recurred on a newer release.
--
-- Keep one deduplicated row and the same RPC signature, but merge the newest
-- sanitized metadata before writing the authoritative occurrence counters.

create or replace function public.record_ops_event_occurrence(
  p_created_at timestamptz,
  p_severity text,
  p_source text,
  p_event_type text,
  p_transition_key text,
  p_code text default '',
  p_message text default '',
  p_endpoint text default '',
  p_status integer default null,
  p_duration_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_count integer := 0;
  v_last timestamptz;
begin
  if p_transition_key is null
     or length(btrim(p_transition_key)) = 0
     or length(p_transition_key) > 220 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition_key');
  end if;

  if p_severity not in ('info','warning','error','critical') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_severity');
  end if;

  insert into public.ops_events (
    created_at,
    severity,
    source,
    event_type,
    code,
    message,
    endpoint,
    status,
    duration_ms,
    metadata,
    transition_key,
    occurrence_count,
    last_occurred_at
  )
  values (
    v_created_at,
    p_severity,
    left(coalesce(p_source,'worker'),80),
    left(coalesce(p_event_type,'runtime'),100),
    left(coalesce(p_code,''),100),
    left(coalesce(p_message,''),500),
    left(coalesce(p_endpoint,''),160),
    p_status,
    case when p_duration_ms is null then null else greatest(0,p_duration_ms) end,
    coalesce(p_metadata,'{}'::jsonb)
      || jsonb_build_object('occurrenceCount',1,'lastOccurredAt',v_created_at),
    p_transition_key,
    1,
    v_created_at
  )
  on conflict (transition_key) do update
  set occurrence_count = public.ops_events.occurrence_count + 1,
      last_occurred_at = greatest(
        coalesce(public.ops_events.last_occurred_at, public.ops_events.created_at),
        excluded.last_occurred_at
      ),
      metadata = coalesce(public.ops_events.metadata,'{}'::jsonb)
        || coalesce(excluded.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'occurrenceCount', public.ops_events.occurrence_count + 1,
          'lastOccurredAt', greatest(
            coalesce(public.ops_events.last_occurred_at, public.ops_events.created_at),
            excluded.last_occurred_at
          )
        )
  returning occurrence_count, last_occurred_at
  into v_count, v_last;

  return jsonb_build_object(
    'ok', true,
    'occurrenceCount', v_count,
    'lastOccurredAt', v_last
  );
end;
$$;

revoke all on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) to service_role;

comment on function public.record_ops_event_occurrence(
  timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb
) is
  'Service-role-only atomic ops occurrence upsert; latest sanitized metadata, including deployment identity, wins on repeated transitions.';

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_ops_event_occurrence(timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb)'::regprocedure
  )
  into v_definition;

  if position('coalesce(excluded.metadata' in lower(v_definition)) = 0 then
    raise exception 'v6.29.13 ops occurrence metadata rollover contract failed';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.record_ops_event_occurrence(timestamptz,text,text,text,text,text,text,text,integer,integer,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'v6.29.13 service_role execute contract failed';
  end if;
end;
$$;

notify pgrst, 'reload schema';
