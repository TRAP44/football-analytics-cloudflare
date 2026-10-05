import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql=readFileSync(new URL('../scripts/supabase-index-evidence-audit.sql',import.meta.url),'utf8');

test('Issue #493 index evidence audit is strictly read-only',()=>{
  assert.match(sql,/begin transaction read only/i);
  assert.match(sql,/rollback\s*;/i);
  assert.doesNotMatch(sql,/\b(drop|create|alter|reindex|delete|update|insert|truncate)\s+(index|table|schema|into|public\.)/i);
});

test('Issue #493 audit records a stable observation window and table workload',()=>{
  assert.match(sql,/pg_stat_database/);
  assert.match(sql,/stats_reset/);
  assert.match(sql,/pg_stat_user_tables/);
  assert.match(sql,/n_live_tup/);
  assert.match(sql,/seq_scan/);
  assert.match(sql,/idx_scan/);
});

test('Issue #493 audit records index scans, tuple usage, size and definitions',()=>{
  assert.match(sql,/pg_stat_user_indexes/);
  assert.match(sql,/idx_tup_read/);
  assert.match(sql,/idx_tup_fetch/);
  assert.match(sql,/pg_relation_size/);
  assert.match(sql,/pg_get_indexdef/);
  for (const classification of [
    'required_keep',
    'observed_used',
    'future_operational_retain',
    'needs_representative_traffic',
  ]) assert.match(sql,new RegExp(classification));
});

test('Issue #493 duplicate detection compares predicate and expression structure',()=>{
  assert.match(sql,/a\.indkey = b\.indkey/);
  assert.match(sql,/a\.indclass = b\.indclass/);
  assert.match(sql,/a\.indcollation = b\.indcollation/);
  assert.match(sql,/a\.indoption = b\.indoption/);
  assert.match(sql,/pg_get_expr\(a\.indexprs/);
  assert.match(sql,/pg_get_expr\(a\.indpred/);
  assert.match(sql,/a\.indisunique = b\.indisunique/);
});
