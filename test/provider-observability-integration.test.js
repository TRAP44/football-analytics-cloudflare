import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const worker = fs.readFileSync('src/worker.js','utf8');
const router = fs.readFileSync('src/router.js','utf8');
const gateway = fs.readFileSync('src/api-football-gateway.js','utf8');
const secondary = fs.readFileSync('src/providers/provider-request.js','utf8');
const admin = fs.readFileSync('public/modules/admin-provider.js','utf8');
const app = fs.readFileSync('public/app.js','utf8');
const html = fs.readFileSync('public/admin.html','utf8');
const smoke = fs.readFileSync('scripts/post-deploy-smoke.js','utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_26_2.sql','utf8');

test('provider observability is wired to both primary and secondary football transports', () => {
  assert.match(worker, /createProviderObservabilityRuntime/);
  assert.match(worker, /createApiFootballGateway\(\{[\s\S]*?observeProviderRequest/);
  assert.match(worker, /createProviderRequestBoundary\(\{[\s\S]*?observeProviderRequest/);
  assert.match(gateway, /await observe\(cfg,\{/);
  assert.match(secondary, /await observe\(cfg,\{/);
  assert.match(worker, /record_provider_slo_observation/);
  assert.match(worker, /read_provider_slo_buckets/);
});

test('provider SLO persists distributed 15-minute aggregate windows through production monitoring', () => {
  assert.match(worker, /async function flushProviderSloWindow/);
  assert.match(migration, /create table if not exists public\.provider_slo_buckets/);
  assert.match(migration, /on conflict \(bucket_started_at,provider,operation\) do update/);
  assert.match(migration, /attempts=public\.provider_slo_buckets\.attempts\+excluded\.attempts/);
  assert.match(migration, /floor\(extract\(minute from v_now\) \/ 15\)/);
  assert.match(worker, /providerSloWindowsFromBuckets/);
  assert.match(worker, /includeCurrent:!providerSloSource\.distributed/);
  assert.match(worker, /code: 'PROVIDER_SLO_WINDOW'/);
  assert.match(worker, /event_type: 'slo_window'/);
  assert.match(worker, /const providerSloFlush = options\.record !== false/);
  assert.match(worker, /restoreProviderObservabilityWindow\(snapshot\)/);
  assert.match(worker, /providerSloPersistenceErrors/);
});

test('admin provider endpoint and diagnostics expose 24 hour provider SLO', () => {
  assert.match(router, /providerObservability: await providerSloReport\(cfg, 24\)/);
  assert.match(worker, /providerSloReport\(cfg,24\)/);
  assert.match(worker, /providerObservability,/);
  assert.match(app, /providerObservability: null/);
  assert.match(admin, /state\.providerObservability/);
});

test('admin UI renders SLO state, success, retry and latency without changing public match UI', () => {
  for (const id of ['providerSloState','providerSloSuccess','providerSloRetry','providerSloLatency','providerSloNote']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(admin, /SLO · 24 часа|sloLabels/);
  assert.match(admin, /successRatePct/);
  assert.match(admin, /retryRatePct/);
  assert.match(admin, /avgAttemptLatencyMs/);
});

test('provider SLO is release-gated and production-smoke checked', () => {
  assert.match(worker, /providerSloObservability: 'enabled'/);
  assert.match(worker, /providerSloSelfTest: providerSloSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke, /'providerSloObservability'/);
  assert.match(smoke, /'providerSloSelfTest'/);
});

test('provider SLO remains observational and does not add automatic rollback controls', () => {
  const start = worker.indexOf('async function flushProviderSloWindow');
  const end = worker.indexOf('async function readOpsEventsRange', start);
  assert.ok(start >= 0 && end > start);
  const block = worker.slice(start, end);
  assert.doesNotMatch(block, /rollback|runtimeControls|apiFootball\(/i);
});


test('v6.26.2 provider SLO aggregation is backend-only and service-role scoped', () => {
  assert.match(migration,/alter table public\.provider_slo_buckets enable row level security/);
  assert.match(migration,/revoke all privileges on table public\.provider_slo_buckets[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(migration,/grant select, insert, update, delete on table public\.provider_slo_buckets[\s\S]*to service_role/);
  assert.match(migration,/revoke execute on function public\.record_provider_slo_observation[\s\S]*from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.record_provider_slo_observation[\s\S]*to service_role/);
  assert.match(migration,/security invoker/g);
});
