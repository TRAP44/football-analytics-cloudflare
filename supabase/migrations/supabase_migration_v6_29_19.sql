-- Fix ISO-date recognition with standard_conforming_strings enabled.
-- Keep server-owned canonical identity, five-minute cutoff and service-only grants.
create or replace function public.resolve_match_reminder_fixture(
  p_fixture_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_candidate record;
  v_fixture_date timestamptz;
begin
  if p_fixture_id is null or p_fixture_id <= 0 then
    return jsonb_build_object('available', false, 'reason', 'invalid_input');
  end if;

  for v_candidate in
  with candidates as (
    select
      1 as priority,
      coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) as observed_at,
      ac.payload->'match'->'home'->>'name' as home_name,
      ac.payload->'match'->'away'->>'name' as away_name,
      ac.payload->'match'->>'league' as league_name,
      case
        when ac.payload->'match'->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          then ac.payload->'match'->>'date'
        else null
      end as fixture_date,
      'match_center'::text as source
    from public.analysis_cache ac
    where ac.fixture_id = p_fixture_id
      and ac.cache_key like 'match-center:%'
      and coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) >= now() - interval '36 hours'
      and jsonb_typeof(ac.payload->'match') = 'object'
      and ac.payload->'match'->>'fixtureId' = p_fixture_id::text

    union all

    select
      2 as priority,
      coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) as observed_at,
      fixture_row->'teams'->'home'->>'name' as home_name,
      fixture_row->'teams'->'away'->>'name' as away_name,
      fixture_row->'league'->>'name' as league_name,
      case
        when fixture_row->'fixture'->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          then fixture_row->'fixture'->>'date'
        else null
      end as fixture_date,
      'provider_fixtures_cache'::text as source
    from public.analysis_cache ac
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ac.payload->'fixtures') = 'array'
        then ac.payload->'fixtures'
        else '[]'::jsonb
      end
    ) fixture_row
    where ac.cache_key like 'provider-fixtures:%'
      and coalesce(ac.source_updated_at, ac.updated_at, ac.created_at) >= now() - interval '36 hours'
      and fixture_row->'fixture'->>'id' = p_fixture_id::text

    union all

    select
      3 as priority,
      mp.captured_at as observed_at,
      mp.home_name,
      mp.away_name,
      mp.league_name,
      mp.kickoff_at::text as fixture_date,
      'model_prediction'::text as source
    from public.model_predictions mp
    where mp.fixture_id = p_fixture_id
      and mp.captured_at >= now() - interval '36 hours'
  )
  select *
  from candidates
  where fixture_date is not null
    and btrim(coalesce(home_name, '')) <> ''
    and btrim(coalesce(away_name, '')) <> ''
  order by priority asc, observed_at desc
  loop
    begin
      v_fixture_date := v_candidate.fixture_date::timestamptz;
    exception when data_exception then
      continue;
    end;

  if v_fixture_date <= now() + interval '5 minutes' then
    return jsonb_build_object('available', false, 'reason', 'fixture_started');
  end if;

  return jsonb_build_object(
    'available', true,
    'reason', 'canonical',
    'source', v_candidate.source,
    'fixtureId', p_fixture_id,
    'homeName', left(btrim(v_candidate.home_name), 160),
    'awayName', left(btrim(v_candidate.away_name), 160),
    'leagueName', left(btrim(coalesce(v_candidate.league_name, '')), 160),
    'fixtureDate', v_fixture_date,
    'observedAt', v_candidate.observed_at
  );
  end loop;
  return jsonb_build_object('available', false, 'reason', 'not_cached');
end;
$$;
