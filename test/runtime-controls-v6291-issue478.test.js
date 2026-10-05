import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_1.sql', 'utf8');
const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

test('issue #478 keeps the public DB contract stable while repairing lockdown history', () => {
  assert.equal(release.productionSchema, '6.29.1');
  assert.equal(release.latestMigration, 'supabase/migrations/supabase_migration_v6_29_1.sql');
  assert.equal(release.databaseContract.fingerprint, '6a7f0fe444f49a2a52c4603e952ee9ea');
  assert.equal(release.databaseContract.freshInstallFingerprint, '8b3e6ec749079296e6746d3db8ae3d2e');
});

test('issue #478 removes the alternate pre-merge RPC and restores canonical readiness semantics', () => {
  assert.match(sql, /drop function if exists public\.commit_runtime_controls/i);
  assert.match(sql, /create or replace function public\.backend_readiness_contract_v2/i);
  assert.match(sql, /coalesce\(v_contract->>'fingerprint', ''\) = coalesce\(p_expected_fingerprint, ''\)/);
  assert.doesNotMatch(sql, /69a437fa853ee80fb0b1122c32d83848/);
});

test('issue #478 maps lockdown actions to the established constraint without losing audit intent', () => {
  assert.match(sql, /check \(action = any \(array\[/i);
  assert.match(sql, /'baseline'::text/);
  assert.match(sql, /'update'::text/);
  assert.match(sql, /'defaults'::text/);
  assert.match(sql, /'rollback'::text/);
  assert.doesNotMatch(sql, /'lockdown'::text/);
  assert.match(sql, /'requestedAction'/);
  assert.match(sql, /'lockdown','lockdown_release'/);
  assert.match(sql, /else 'update'/);
});

test('issue #478 preserves atomic state/history through the v6.29 rewrite rule', () => {
  assert.match(sql, /create rule runtime_controls_atomic_history/i);
  assert.match(sql, /on update to public\.runtime_controls/i);
  assert.match(sql, /old\.revision is distinct from new\.revision/i);
  assert.match(sql, /insert into public\.runtime_control_history/i);
  assert.match(sql, /new\.revision/);
});
