import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildMigrationPlan,
  POST_BASELINE_MIGRATIONS,
} from '../scripts/prepare-supabase-ci-migrations.js';

const hotfix = fs.readFileSync(
  'supabase/migrations/supabase_migration_v6_29_1.sql',
  'utf8',
);
const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));
const ciContract = fs.readFileSync('scripts/supabase-ci-contract.sql', 'utf8');

test('Issue #478 publishes v6.29.1 as the canonical latest migration', () => {
  assert.equal(release.productionSchema, '6.29');
  assert.equal(
    release.latestMigration,
    'supabase/migrations/supabase_migration_v6_29_1.sql',
  );
  assert.equal(
    POST_BASELINE_MIGRATIONS.at(-1),
    'supabase/migrations/supabase_migration_v6_29_1.sql',
  );

  const base = buildMigrationPlan('upgrade-base');
  const latest = buildMigrationPlan('latest-only');
  assert.equal(
    base.at(-1).source,
    'supabase/migrations/supabase_migration_v6_29.sql',
  );
  assert.equal(latest.length, 1);
  assert.equal(latest[0].source, release.latestMigration);
  assert.equal(latest[0].version, '20260101002200');
  assert.match(ciContract, /where version='20260101002200'/);
});

test('Issue #478 removes the superseded public atomic RPC and restores strict readiness', () => {
  assert.match(
    hotfix,
    /drop function if exists public\.commit_runtime_controls\s*\(/i,
  );
  assert.match(
    hotfix,
    /create or replace function public\.backend_readiness_contract_v2\s*\(/i,
  );
  assert.match(
    hotfix,
    /coalesce\(v_contract->>'fingerprint', ''\) = coalesce\(p_expected_fingerprint, ''\)/i,
  );
  assert.doesNotMatch(hotfix, /69a437fa853ee80fb0b1122c32d83848/i);
});

test('Issue #478 keeps lockdown writes constraint-compatible without losing requested action', () => {
  assert.match(hotfix, /create rule runtime_controls_atomic_history/i);
  assert.match(hotfix, /in \('defaults','rollback'\)/i);
  assert.match(hotfix, /else 'update'/i);
  assert.match(hotfix, /'requestedAction'/i);
  assert.match(
    hotfix,
    /in \('update','defaults','rollback','lockdown','lockdown_release'\)/i,
  );
  assert.doesNotMatch(
    hotfix,
    /alter table public\.runtime_control_history\s+.*runtime_control_history_action_check/is,
  );
});

test('Issue #478 preserves the atomic database-rule commit point', () => {
  assert.match(hotfix, /on update to public\.runtime_controls/i);
  assert.match(hotfix, /old\.revision is distinct from new\.revision/i);
  assert.match(hotfix, /insert into public\.runtime_control_history/i);
  assert.match(hotfix, /new\.revision/i);
  assert.doesNotMatch(hotfix, /on conflict/i);
});
