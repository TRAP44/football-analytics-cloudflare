-- MatchRadar production index audit helper (#493)
-- Read-only diagnostics. This script must never drop or alter indexes.
--
-- Run only after a representative production/soft-launch traffic window.
-- Use the output together with EXPLAIN (ANALYZE, BUFFERS) before removing anything.

with indexes as (
  select
    s.schemaname,
    s.relname as table_name,
    s.indexrelname as index_name,
    s.idx_scan,
    s.idx_tup_read,
    s.idx_tup_fetch,
    pg_relation_size(s.indexrelid) as index_bytes,
    pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
    i.indisunique as is_unique,
    i.indisprimary as is_primary,
    pg_get_indexdef(s.indexrelid) as index_definition,
    pg_get_expr(i.indpred, i.indrelid) as predicate,
    pg_get_expr(i.indexprs, i.indrelid) as expression
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
  where s.schemaname = 'public'
),
constraints as (
  select distinct conindid as indexrelid
  from pg_constraint
  where conindid <> 0
),
usage as (
  select
    i.*,
    exists (
      select 1
      from pg_constraint c
      join pg_class ci on ci.oid = c.conindid
      where ci.relname = i.index_name
        and c.connamespace = 'public'::regnamespace
    ) as backs_constraint,
    case
      when i.is_primary then 'keep_primary'
      when i.is_unique then 'keep_unique'
      when exists (
        select 1
        from pg_constraint c
        join pg_class ci on ci.oid = c.conindid
        where ci.relname = i.index_name
          and c.connamespace = 'public'::regnamespace
      ) then 'keep_constraint'
      when i.idx_scan > 0 then 'observed_used'
      else 'needs_review'
    end as preliminary_classification
  from indexes i
)
select
  table_name,
  index_name,
  preliminary_classification,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  index_bytes,
  index_size,
  is_primary,
  is_unique,
  backs_constraint,
  index_definition,
  predicate,
  expression
from usage
order by
  case preliminary_classification
    when 'needs_review' then 0
    when 'observed_used' then 1
    else 2
  end,
  index_bytes desc,
  table_name,
  index_name;

-- Redundancy candidates: indexes whose ordered key columns are a prefix of
-- another index on the same table. Treat this as a review hint only.
with idx as (
  select
    n.nspname as schema_name,
    t.relname as table_name,
    c.relname as index_name,
    i.indexrelid,
    i.indrelid,
    i.indisunique,
    i.indisprimary,
    i.indkey,
    i.indnkeyatts,
    pg_get_indexdef(i.indexrelid) as definition
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_class t on t.oid = i.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
),
pairs as (
  select
    a.table_name,
    a.index_name as narrower_index,
    b.index_name as covering_index,
    a.definition as narrower_definition,
    b.definition as covering_definition
  from idx a
  join idx b
    on a.indrelid = b.indrelid
   and a.indexrelid <> b.indexrelid
   and a.indisprimary = false
   and a.indisunique = false
   and a.indnkeyatts <= b.indnkeyatts
   and (a.indkey::int2[])[1:a.indnkeyatts] = (b.indkey::int2[])[1:a.indnkeyatts]
)
select distinct *
from pairs
order by table_name, narrower_index, covering_index;

-- Stats freshness context. Low uptime / recently reset stats are not enough
-- evidence to remove an apparently unused index.
select
  now() as captured_at,
  pg_postmaster_start_time() as database_started_at,
  now() - pg_postmaster_start_time() as statistics_window;
