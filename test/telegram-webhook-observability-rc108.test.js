import { workerRuntime } from '../test-support/worker-root.js';
import { readFileSync as readContractSource } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-dedupe.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-diagnostics.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-production-readiness.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_17.sql','utf8');
const baseline=fs.readFileSync('supabase/baseline/supabase_baseline_v6_19.sql','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC108 persists duplicate counters without weakening webhook claim semantics',()=>{
  assert.match(migration,/add column if not exists duplicate_count integer not null default 0/);
  assert.match(migration,/add column if not exists last_duplicate_at timestamptz/);
  assert.match(migration,/duplicate_count = duplicate_count \+ 1/);
  assert.match(migration,/last_duplicate_at = now\(\)/);
  assert.match(migration,/where public\.telegram_update_claims\.status <> 'done'/);
  assert.match(migration,/public\.telegram_update_claims\.locked_until <= now\(\)/);
});

test('RC108 health RPC is aggregate-only and service-role-only',()=>{
  assert.match(migration,/create or replace function public\.telegram_webhook_dedupe_health/);
  assert.match(migration,/returns jsonb/);
  assert.match(migration,/security invoker/);
  assert.doesNotMatch(migration,/security definer/i);
  assert.match(migration,/stale_processing/);
  assert.match(migration,/duplicate_attempts_retained/);
  assert.match(migration,/revoke all on function public\.telegram_webhook_dedupe_health\(integer\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.telegram_webhook_dedupe_health\(integer\) to service_role/);
});

test('RC108 classifies dedupe health without treating normal duplicates as an incident',()=>{
  assert.match(worker,/function telegramDedupeHealthState/);
  assert.match(worker,/stale >= 5 \|\| failedRecent >= 5/);
  assert.match(worker,/stale > 0 \|\| failedRecent > 0 \|\| failedCurrent > 0/);
  assert.match(worker,/function telegramDedupeObservabilitySelfTest/);
  assert.match(worker,/duplicateAttemptsRetained/);
});

test('RC108 production monitor and readiness consume persistent dedupe health',()=>{
  assert.match(readContractSource(new URL('../src/production-monitor-runtime.js', import.meta.url), 'utf8'),/readTelegramDedupeHealth\(cfg,60\)/);
  assert.match(readContractSource(new URL('../src/production-monitor-runtime.js', import.meta.url), 'utf8'),/telegramDedupeState: telegramWebhook\.state/);
  assert.match(readContractSource(new URL('../src/release-readiness-runtime.js', import.meta.url), 'utf8'),/productionCheck\('telegram_dedupe_observability'/);
  assert.match(readContractSource(new URL('../src/admin-operational-api.js', import.meta.url), 'utf8'),/releaseCheck\('telegram_webhook_dedupe_observability'/);
  assert.match(readContractSource(new URL('../src/app-capabilities.js',import.meta.url),'utf8'),/telegramWebhookPersistentDedupe:\s*true/);
  assert.equal(workerRuntime.telegramDedupeObservabilitySelfTest().pass,true);
  assert.match(smoke,/'telegramWebhookPersistentDedupe'/);
  assert.match(smoke,/'telegramWebhookPersistentDedupe'/);
});

test('RC108 admin diagnostics expose claims duplicates stale and failed counts',()=>{
  assert.match(app,/Telegram webhook dedupe/);
  assert.match(app,/telegramWebhook\.duplicateAttemptsRetained/);
  assert.match(app,/telegramWebhook\.staleProcessing/);
  assert.match(app,/telegramWebhook\.failedCurrent/);
});

test('RC108 fresh-install baseline contains v6.17 observability',()=>{
  assert.match(baseline,/unified fresh-install baseline/);
  assert.match(baseline,/add column if not exists duplicate_count/);
  assert.match(baseline,/create or replace function public\.telegram_webhook_dedupe_health/);
});

test('RC108 duplicate metrics remain aggregate and never expose individual Telegram ids',()=>{
  const start=migration.indexOf('create or replace function public.telegram_webhook_dedupe_health');
  const segment=migration.slice(start);
  assert.ok(start>=0);
  assert.match(segment,/duplicate_attempts_retained/);
  assert.match(segment,/duplicate_rows_recent/);
  assert.match(segment,/last_duplicate_at/);
  assert.match(segment,/count\(\*\)/);
  assert.match(segment,/returns jsonb/);
  assert.match(segment,/security invoker/);
  assert.doesNotMatch(segment,/security definer/i);
});
