import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_12.sql', 'utf8');

test('AI verdict summarizes outcome total btts and action', () => {
  assert.match(worker, /const verdict =/);
  assert.match(worker, /total:/);
  assert.match(worker, /btts:/);
  assert.match(app, /Вердикт AI за 10 секунд/);
  assert.match(css, /\.ai-verdict-grid/);
});

test('pre-match intelligence explains market movement and lineup impact', () => {
  assert.match(worker, /previousMarketSnapshots/);
  assert.match(worker, /buildOddsMovement/);
  assert.match(worker, /function marketMovementNote/);
  assert.match(worker, /function buildLineupImpact/);
  assert.match(app, /ai-market-note/);
  assert.match(app, /ai-lineup-note/);
});

test('referee is normalized into a structured context object', () => {
  assert.match(worker, /function refereeProfile/);
  assert.match(worker, /refereeProfile:refereeData/);
  assert.match(app, /refereeProfile\?\.name/);
});

test('telegram morning digest is opt-in and persisted securely', () => {
  assert.match(worker, /callback_data:\s*'digest:on'/);
  assert.match(worker, /callback_data:\s*'digest:off'/);
  assert.match(worker, /processDailyDigests/);
  assert.match(worker, /bot_digest_subscriptions/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all privileges.*anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete.*service_role/i);
});

test('RC41 health publishes the new AI contracts', () => {
  assert.match(worker, /aiTenSecondVerdict:\s*'enabled'/);
  assert.match(worker, /preMatchMarketMovement:\s*'enabled'/);
  assert.match(worker, /lineupImpactBrief:\s*'enabled'/);
  assert.match(worker, /dailyBotDigest:\s*'enabled'/);
});
