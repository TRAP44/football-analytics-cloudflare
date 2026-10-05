-- MatchRadar production index evidence audit (Issue #493)
-- READ-ONLY by design. This script must never drop/create/reindex database objects.
-- Capture output at the beginning and end of a representative production/soft-launch window.
-- Compare idx_scan deltas; cumulative zero usage alone is not sufficient evidence for removal.

begin transaction read only;

-- 1) Establish the statistics observation window. If stats_reset changes between
-- snapshots, index counters are not directly comparable and the window must restart.
select
  current_database() as database_name,
  stats_reset,
  xact_commit,
  xact_rollback,
  tup_returned,
  tup_fetched,
  tup_inserted,
  tup_updated,
  tup_deleted
from pg_stat_database
where datname = current_database();

-- 2) Table workload context. An index on an empty/near-empty feature table is
-- classified as future-operational until that feature receives representative traffic.
select
  relname as table_name,
  n_live_tup,
  seq_scan,
  idx_scan,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by n_live_tup desc, relname;

-- 3) Index-level usage and size evidence. The evidence_class is intentionally
-- conservative and is not an instruction to drop anything.
with index_stats as (
  select
    schemaname,
    relname as table_name,
    indexrelname as index_name,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
  from pg_stat_user_indexes
  where schemaname = 'public'
),
index_meta as (
  select
    n.nspname as schemaname,
    t.relname as table_name,
    i.relname as index_name,
    pg_relation_size(i.oid) as bytes,
    pg_get_indexdef(i.oid) as index_def,
    ix.indisunique,
    ix.indisprimary
  from pg_index ix
  join pg_class t on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
),
table_stats as (
  select relname as table_name, n_live_tup
  from pg_stat_user_tables
  where schemaname = 'public'
)
select
  m.table_name,
  m.index_name,
  coalesce(s.idx_scan, 0) as idx_scan,
  coalesce(s.idx_tup_read, 0) as idx_tup_read,
  coalesce(s.idx_tup_fetch, 0) as idx_tup_fetch,
  coalesce(t.n_live_tup, 0) as n_live_tup,
  pg_size_pretty(m.bytes) as index_size,
  m.indisunique,
  m.indisprimary,
  case
    when m.indisprimary or m.indisunique then 'required_keep'
    when coalesce(s.idx_scan, 0) > 0 then 'observed_used'
    when coalesce(t.n_live_tup, 0) = 0 then 'future_operational_retain'
    else 'needs_representative_traffic'
  end as evidence_class,
  m.index_def
from index_meta m
left join index_stats s using (schemaname, table_name, index_name)
left join table_stats t using (table_name)
order by coalesce(s.idx_scan, 0), m.bytes desc, m.table_name, m.index_name;

-- 4) Exact structural duplicates. This query is deliberately stricter than
-- "same leading column": it compares key columns, operator classes, collation,
-- sort options, expression trees, predicates and uniqueness.
with idx as (
  select
    n.nspname,
    t.relname as table_name,
    i.relname as index_name,
    ix.indexrelid,
    ix.indrelid,
    ix.indkey,
    ix.indclass,
    ix.indcollation,
    ix.indoption,
    ix.indexprs,
    ix.indpred,
    ix.indisunique,
    ix.indisprimary,
    pg_get_indexdef(i.oid) as index_def
  from pg_index ix
  join pg_class t on t.oid = ix.indrelid
  join pg_class i on i.oid = ix.indexrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
)
select
  a.table_name,
  a.index_name as index_a,
  b.index_name as index_b,
  a.indisunique,
  a.indisprimary,
  a.index_def as definition_a,
  b.index_def as definition_b
from idx a
join idx b
  on a.indrelid = b.indrelid
 and a.indexrelid < b.indexrelid
 and a.indkey = b.indkey
 and a.indclass = b.indclass
 and a.indcollation = b.indcollation
 and a.indoption = b.indoption
 and coalesce(pg_get_expr(a.indexprs, a.indrelid), '') = coalesce(pg_get_expr(b.indexprs, b.indrelid), '')
 and coalesce(pg_get_expr(a.indpred, a.indrelid), '') = coalesce(pg_get_expr(b.indpred, b.indrelid), '')
 and a.indisunique = b.indisunique
order by a.table_name, a.index_name, b.index_name;

rollback;
