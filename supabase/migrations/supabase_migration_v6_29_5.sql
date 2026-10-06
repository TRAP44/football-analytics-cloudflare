-- MatchRadar v6.29.5 / scheduled lease retention hardening
-- Forward hotfix for v6.26/v6.27.1.
-- Keep scheduled-job retention at least as long as the active ownership lease.

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
  v_retention_seconds := greatest(v_retention_seconds, v_lease_seconds);

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

revoke all on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)
  to service_role;

create or replace function public.renew_scheduled_job(
  p_job_key text,
  p_lease_token text,
  p_lease_seconds integer default 720
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_job_key text := btrim(coalesce(p_job_key,''));
  v_lease_token text := coalesce(p_lease_token,'');
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds,720),1800));
  v_next_locked_until timestamptz;
  v_locked_until timestamptz;
begin
  if v_job_key='' or char_length(v_job_key)>180
     or v_lease_token='' or char_length(v_lease_token)>80 then
    return jsonb_build_object('renewed',false,'reason','invalid_input');
  end if;

  v_next_locked_until := v_now + v_lease_seconds * interval '1 second';

  update public.scheduled_job_leases
  set locked_until=greatest(locked_until,v_next_locked_until),
      expires_at=greatest(expires_at,locked_until,v_next_locked_until)
  where job_key=v_job_key
    and lease_token=v_lease_token
    and status='running'
    and locked_until>v_now
  returning locked_until into v_locked_until;

  if found then
    return jsonb_build_object(
      'renewed',true,
      'reason','renewed',
      'jobKey',v_job_key,
      'lockedUntil',v_locked_until,
      'leaseSeconds',v_lease_seconds
    );
  end if;

  return jsonb_build_object(
    'renewed',false,
    'reason','ownership_lost',
    'jobKey',v_job_key
  );
end;
$$;

revoke all on function public.renew_scheduled_job(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.renew_scheduled_job(text,text,integer)
  to service_role;

comment on function public.claim_scheduled_job(text,text,timestamptz,integer,integer) is
  'Atomic scheduled-job ownership claim with retention guaranteed to cover the initial lease.';
comment on function public.renew_scheduled_job(text,text,integer) is
  'Renews active scheduled-job ownership without shortening it and extends retention through the lease horizon.';

notify pgrst, 'reload schema';
