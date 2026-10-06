-- MatchRadar v6.29.3 / stable provider SLO read boundary
-- Forward hotfix for v6.26.2.
--
-- read_provider_slo_buckets() is declared STABLE. Its implicit upper bound must
-- therefore be stable for the surrounding statement as well. statement_timestamp()
-- preserves the intended "read through now" behavior without using a clock value
-- that can change during one statement.
--
-- The public signature, volatility, return shape and grants remain unchanged, so
-- the established legacy and v2 schema fingerprints remain valid.

create or replace function public.read_provider_slo_buckets(
  p_since timestamptz,
  p_until timestamptz default null,
  p_limit integer default 5000
)
returns table(
  bucket_started_at timestamptz,
  provider text,
  operation text,
  attempts bigint,
  requests bigint,
  successes bigint,
  failures bigint,
  retries bigint,
  timeouts bigint,
  network_errors bigint,
  rate_limits bigint,
  http_errors bigint,
  invalid_responses bigint,
  latency_sum_ms bigint,
  latency_samples bigint,
  max_latency_ms integer,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.bucket_started_at,b.provider,b.operation,
    b.attempts,b.requests,b.successes,b.failures,b.retries,b.timeouts,b.network_errors,
    b.rate_limits,b.http_errors,b.invalid_responses,b.latency_sum_ms,b.latency_samples,
    b.max_latency_ms,b.updated_at
  from public.provider_slo_buckets b
  where b.bucket_started_at >= p_since
    and b.bucket_started_at < coalesce(p_until,statement_timestamp())
  order by b.bucket_started_at asc,b.provider asc,b.operation asc
  limit greatest(1,least(coalesce(p_limit,5000),10000));
$$;

revoke all on function public.read_provider_slo_buckets(timestamptz,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.read_provider_slo_buckets(timestamptz,timestamptz,integer)
  to service_role;

comment on function public.read_provider_slo_buckets(timestamptz,timestamptz,integer) is
  'Service-role-only distributed Provider SLO bucket reader with a statement-stable implicit upper bound.';

notify pgrst, 'reload schema';
