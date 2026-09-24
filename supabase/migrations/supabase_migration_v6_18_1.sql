-- Football Analytics v6.18.1 / RC127 hotfix
-- Make atomic analysis quota resilient to the first-request users FK race.

create or replace function public.consume_analysis_quota(
  p_telegram_id bigint,
  p_usage_date date,
  p_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  if p_telegram_id is null or p_telegram_id <= 0 or p_usage_date is null or p_limit is null or p_limit < 1 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', greatest(coalesce(p_limit,0),0), 'reason', 'invalid_input');
  end if;

  insert into public.users(telegram_id)
  values (p_telegram_id)
  on conflict (telegram_id) do nothing;

  insert into public.usage_daily(telegram_id, usage_date, analyses, updated_at)
  values (p_telegram_id, p_usage_date, 1, now())
  on conflict (telegram_id, usage_date)
  do update set
    analyses = public.usage_daily.analyses + 1,
    updated_at = now()
  where public.usage_daily.analyses < p_limit
  returning analyses into v_used;

  if v_used is null then
    select analyses into v_used
    from public.usage_daily
    where telegram_id = p_telegram_id and usage_date = p_usage_date;

    return jsonb_build_object(
      'allowed', false,
      'used', coalesce(v_used,0),
      'limit', p_limit,
      'reason', 'quota_exhausted'
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'limit', p_limit,
    'reason', 'reserved'
  );
end;
$$;

revoke execute on function public.consume_analysis_quota(bigint,date,integer) from public, anon, authenticated;
grant execute on function public.consume_analysis_quota(bigint,date,integer) to service_role;

comment on function public.consume_analysis_quota(bigint,date,integer) is
  'RC127 v6.18.1 hotfix: atomically reserves analysis quota and self-heals the users FK race by creating a minimal user row when needed.';

notify pgrst, 'reload schema';
