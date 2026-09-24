import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_18.sql','utf8');
const hotfix=fs.readFileSync('supabase/migrations/supabase_migration_v6_18_1.sql','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');
const deploy=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const app=fs.readFileSync('public/app.js','utf8');

test('RC129 has a single production identity while preserving RC127 hardening',()=>{
  assert.equal(pkg.version,'6.105.0');
  assert.match(worker,/const APP_VERSION = '6\.105\.0-rc129'/);
  assert.match(worker,/const RC_NAME = 'RC129'/);
  assert.match(app,/const CLIENT_VERSION = '6\.105\.0-rc129'/);
  assert.match(deploy,/RELEASE_VERSION: "6\.105\.0-rc129"/);
});

test('RC127 atomically reserves and refunds analysis quota',()=>{
  assert.match(migration,/create or replace function public\.consume_analysis_quota/);
  assert.match(migration,/on conflict \(telegram_id, usage_date\)/);
  assert.match(migration,/where public\.usage_daily\.analyses < p_limit/);
  assert.match(migration,/create or replace function public\.refund_analysis_quota/);
  assert.match(worker,/async function reserveAnalysisQuota/);
  assert.match(worker,/supaRpc\(cfg, 'consume_analysis_quota'/);
  assert.match(worker,/refundAnalysisQuota\(user\.id,usageReservation,cfg\)/);
  assert.match(hotfix,/insert into public\.users\(telegram_id\)/);
  assert.match(hotfix,/on conflict \(telegram_id\) do nothing/);
  assert.match(hotfix,/p_telegram_id <= 0/);
  assert.doesNotMatch(worker,/if \(!freeRecheck\) await incrementUsage\(user\.id, cfg\)/);
});

test('RC127 globally protects API-Football minute quota',()=>{
  assert.match(migration,/create table if not exists public\.provider_rate_windows/);
  assert.match(migration,/create or replace function public\.claim_provider_request/);
  assert.match(worker,/async function claimDistributedProviderBudget/);
  assert.match(worker,/p_bucket_key:'api-football:minute'/);
  assert.match(worker,/providerDistributedBlocks/);
});

test('RC127 uses atomic daily digest delivery claims',()=>{
  assert.match(migration,/create or replace function public\.claim_daily_digest/);
  assert.match(migration,/create or replace function public\.complete_daily_digest/);
  assert.match(migration,/create or replace function public\.release_daily_digest/);
  assert.match(worker,/async function claimDigestDelivery/);
  assert.match(worker,/const claimed=await claimDigestDelivery\(row,date,cfg\)/);
});

test('RC127 uses full schema fingerprint plus selected compatibility probes',()=>{
  assert.match(migration,/create or replace function public\.backend_schema_fingerprint/);
  assert.match(worker,/const EXPECTED_SCHEMA_FINGERPRINT = 'c2c22ec25aacfcf1b9938b0850cebf49'/);
  assert.match(worker,/async function readSupabaseSchemaFingerprint/);
  assert.match(worker,/missing\.push\('schema_fingerprint'\)/);
});

test('RC127 separates liveness and readiness and deploy smoke requires readiness',()=>{
  assert.match(worker,/url\.pathname === '\/health\/live'/);
  assert.match(worker,/url\.pathname === '\/health\/ready'/);
  assert.match(worker,/async function readinessSnapshot/);
  assert.match(worker,/recentSupabaseAuthFailures/);
  assert.match(smoke,/\/health\/ready/);
  assert.match(smoke,/Readiness schema fingerprint failed/);
});

test('RC127 fails analysis coordination closed during shared-lock outage',()=>{
  assert.match(worker,/code:'ANALYSIS_LOCK_FAIL_CLOSED'/);
  assert.match(worker,/return \{claimed:false,key,claimId:'',shared:false,degraded:true,unavailable:true\}/);
  assert.match(worker,/analysisLockFailClosed: 'enabled'/);
  assert.match(worker,/analysisLockFailOpen: 'disabled'/);
});

test('RC127 shortens Telegram initData lifetime for sensitive operations',()=>{
  assert.match(worker,/adminSensitive \? 15 \* 60 : mutation \? 2 \* 60 \* 60 : 24 \* 60 \* 60/);
  assert.match(worker,/validateTelegramInitData\(initData, cfg\.botToken, initDataMaxAgeSeconds\)/);
});

test('RC127 backend-only RPCs are explicitly least-privilege',()=>{
  assert.match(migration,/revoke execute on function public\.consume_analysis_quota\(bigint,date,integer\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.consume_analysis_quota\(bigint,date,integer\) to service_role/);
  assert.match(migration,/revoke truncate, references, trigger on table/);
});
