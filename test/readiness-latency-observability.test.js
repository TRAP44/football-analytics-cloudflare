import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

test('readiness exposes per-check latency without changing fail-closed dependencies', () => {
  assert.match(worker, /async function measureReadinessCheck\(task\)/);
  assert.match(worker, /measureReadinessCheck\(\(\)=>probeSupabaseConfirmed\(cfg\)\)/);
  assert.match(worker, /measureReadinessCheck\(\(\)=>probeSupabaseSchemaDriftConfirmed\(cfg\)\)/);
  assert.match(worker, /measureReadinessCheck\(\(\)=>readBackendSecurityContract\(cfg\)\)/);
  assert.match(worker, /measureReadinessCheck\(\(\)=>readRecentSupabaseAuthFailures\(cfg,5\)\)/);
  assert.match(worker, /const ok=Boolean\(supabase\.ok && schema\.ok && security\.ok && telegramConfigured && \(!authFailures\.available \|\| authFailures\.count===0\)\)/);
  assert.match(worker, /latencyMs:Date\.now\(\)-startedAt/);
  assert.match(worker, /latencyMs:supabaseCheck\.latencyMs/);
  assert.match(worker, /latencyMs:schemaCheck\.latencyMs/);
  assert.match(worker, /latencyMs:securityCheck\.latencyMs/);
  assert.match(worker, /recentSupabaseAuthFailuresLatencyMs:authFailuresCheck\.latencyMs/);
});
