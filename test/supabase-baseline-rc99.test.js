import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baselineUrl = new URL('../supabase/baseline/supabase_baseline_v6_19.sql', import.meta.url);
const baseline = fs.readFileSync(baselineUrl, 'utf8').toLowerCase();

test('RC99 exposes one current fresh-install Supabase baseline', () => {
  assert.equal(fs.existsSync(new URL('../supabase/baseline/supabase_baseline_v6_9.sql', import.meta.url)), false);
  assert.equal(fs.existsSync(baselineUrl), true);
  assert.match(baseline, /use only for a new supabase project/);
});

test('RC99 unified baseline includes every post-v6.9 schema layer', () => {
  const required = [
    'create table if not exists public.model_calibration_transitions',
    'create or replace function public.backend_security_contract()',
    'create or replace function public.backend_default_acl_contract()',
    'create table if not exists public.bot_digest_subscriptions',
    'create table if not exists public.referee_match_history',
    'add column if not exists ai_signal_code',
    'create table if not exists public.growth_events',
    'create table if not exists public.telegram_update_claims',
    'create or replace function public.claim_telegram_update',
    'create or replace function public.telegram_webhook_dedupe_health',
    'insert into public.users(telegram_id)',
    'create or replace function public.save_favorite_guarded',
    'create or replace function public.save_match_reminder_guarded',
    'create or replace function public.personal_write_guard_contract'
  ];
  for (const marker of required) assert.ok(baseline.includes(marker), marker);
});

test('RC99 keeps numbered migrations for existing production upgrades', () => {
  for (const name of [
    'supabase/migrations/supabase_migration_v6_9.sql',
    'supabase/migrations/supabase_migration_v6_10.sql',
    'supabase/migrations/supabase_migration_v6_11.sql',
    'supabase/migrations/supabase_migration_v6_11_1.sql',
    'supabase/migrations/supabase_migration_v6_12.sql',
    'supabase/migrations/supabase_migration_v6_13.sql',
    'supabase/migrations/supabase_migration_v6_14.sql',
    'supabase/migrations/supabase_migration_v6_15.sql',
    'supabase/migrations/supabase_migration_v6_16.sql',
    'supabase/migrations/supabase_migration_v6_17.sql',
    'supabase/migrations/supabase_migration_v6_18.sql',
    'supabase/migrations/supabase_migration_v6_18_1.sql',
    'supabase/migrations/supabase_migration_v6_19.sql',
    'supabase/migrations/supabase_migration_v6_19_1.sql'
  ]) {
    assert.equal(fs.existsSync(new URL('../' + name, import.meta.url)), true, name);
  }
});


test('RC127 fresh-install baseline keeps a valid fail-closed SQL guard', () => {
  assert.doesNotMatch(baseline, /\bdo \$\s*\n/);
  assert.match(baseline, /\bdo \$\$\s*\nbegin/);
});
