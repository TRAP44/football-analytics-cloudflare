import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');

test('RC100 probes required Supabase tables and columns without DDL', () => {
  assert.match(worker, /async function probeTableColumns\(/);
  assert.match(worker, /async function probeSupabaseSchemaDrift\(/);
  for (const marker of [
    "id: 'users_acquisition'",
    "id: 'analysis_history_ai'",
    "id: 'calibration_transitions'",
    "id: 'digest_subscriptions'",
    "id: 'referee_history'",
    "id: 'growth_events'"
  ]) assert.ok(worker.includes(marker), marker);
  assert.doesNotMatch(worker, /probeSupabaseSchemaDrift[\s\S]{0,3500}(insert into|alter table|create table|drop table)/i);
});

test('RC100 drift summary fails closed when a required slice is missing', () => {
  assert.match(worker, /function summarizeSupabaseSchemaChecks\(/);
  assert.match(worker, /status: missing\.length === 0 \? 'ok' : 'drift'/);
  assert.match(worker, /drift\.missing\.length === 1/);
  assert.match(worker, /drift\.missing\[0\] === 'growth_events'/);
});

test('RC100 blocks Release Readiness on Supabase schema drift', () => {
  assert.match(worker, /releaseCheck\('supabase_schema_drift'/);
  assert.match(worker, /Schema drift: отсутствуют или несовместимы/);
  assert.match(worker, /releaseCheck\('supabase_schema_drift_selftest'/);
});

test('RC100 exposes and smoke-tests schema drift health flags', () => {
  assert.match(worker, /supabaseSchemaDriftGuard: 'enabled'/);
  assert.match(worker, /supabaseSchemaDriftSelfTest: supabaseSchemaDriftSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.ok(smoke.includes("'supabaseSchemaDriftGuard'"));
  assert.ok(smoke.includes("'supabaseSchemaDriftSelfTest'"));
});

test('RC100 does not require a new Supabase migration', () => {
  const files=fs.readdirSync('.').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|rc100/i.test(x)));
});
