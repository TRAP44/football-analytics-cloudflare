import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-transport.js','utf8')+'\n'+fs.readFileSync('src/telegram-dedupe.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_16.sql','utf8');
const baseline=fs.readFileSync('supabase/baseline/supabase_baseline_v6_19.sql','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC107 migration creates a backend-only persistent Telegram update ledger',()=>{
  assert.match(migration,/create table if not exists public\.telegram_update_claims/);
  assert.match(migration,/alter table public\.telegram_update_claims enable row level security/);
  assert.match(migration,/revoke all on table public\.telegram_update_claims from public, anon, authenticated/);
  assert.match(migration,/grant select, insert, update, delete on table public\.telegram_update_claims to service_role/);
  assert.match(migration,/create or replace function public\.claim_telegram_update/);
  assert.match(migration,/create or replace function public\.complete_telegram_update/);
  assert.match(migration,/create or replace function public\.release_telegram_update/);
  assert.match(migration,/security invoker/);
  assert.doesNotMatch(migration,/security definer/i);
});

test('RC107 claim lifecycle is atomic, leased, and keeps completed updates deduped',()=>{
  assert.match(migration,/on conflict \(update_key\) do update/);
  assert.match(migration,/status <> 'done'/);
  assert.match(migration,/locked_until <= now\(\)/);
  assert.match(migration,/set status = 'done'/);
  assert.match(migration,/set status = 'failed'/);
  assert.match(migration,/interval '5 seconds'/);
  assert.match(migration,/interval '24 hours'/);
});

test('RC107 Worker combines memory and persistent dedupe around webhook processing',()=>{
  const start=worker.indexOf('async function handleTelegramWebhook');
  const end=worker.indexOf('\n}',start)+2;
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/const claim=claimTelegramUpdate\(update,cfg\)/);
  assert.match(block,/await claimTelegramUpdatePersistent\(cfg,claim\.key\)/);
  assert.match(block,/deduped:true,persistent:true/);
  assert.match(block,/await completeTelegramUpdatePersistent\(cfg,claim\.key\)/);
  assert.match(block,/await releaseTelegramUpdatePersistent\(cfg,claim\.key\)/);
});

test('RC107 persistent dedupe fails open to memory with bounded Supabase latency',()=>{
  const start=worker.indexOf('async function claimTelegramUpdatePersistent');
  const end=worker.indexOf('\nfunction telegramBurstKind',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/!hasSupabase\(cfg\).*fallback/s);
  assert.match(block,/claim_telegram_update/);
  assert.match(block,/,1800\)/);
  assert.match(block,/,1200\)/);
  assert.match(block,/telegramDedupeFallbacks/);
  assert.match(block,/persistent:false, claimed:true, duplicate:false, status:'fallback'/);
});

test('RC107 release and schema gates require persistent Telegram dedupe',()=>{
  assert.match(worker,/telegram_update_claims/);
  assert.match(worker,/releaseCheck\('telegram_webhook_persistent_dedupe'/);
  assert.match(worker,/telegramWebhookPersistentDedupe: 'enabled'/);
  assert.match(worker,/telegramWebhookPersistentDedupeSelfTest: telegramPersistentDedupeSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke,/'telegramWebhookPersistentDedupe'/);
  assert.match(smoke,/'telegramWebhookPersistentDedupeSelfTest'/);
});

test('RC107 fresh-install baseline includes the persistent dedupe schema',()=>{
  assert.match(baseline,/unified fresh-install baseline/);
  assert.match(baseline,/create table if not exists public\.telegram_update_claims/);
  assert.match(baseline,/create or replace function public\.claim_telegram_update/);
});
