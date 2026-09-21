import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase_migration_v6_10.sql', import.meta.url), 'utf8').toLowerCase();

test('RC18 transition function uses invoker security and least privilege', () => {
  assert.match(sql, /create or replace function public\.transition_model_calibration/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /revoke all on function public\.transition_model_calibration[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.transition_model_calibration[\s\S]*to service_role/);
});

test('RC18 transition function locks state and rejects stale revisions', () => {
  assert.match(sql, /where id = 'global'[\s\S]*for update/);
  assert.match(sql, /v_state\.revision <> p_expected_revision/);
  assert.match(sql, /errcode = '40001'/);
});

test('RC18 remediates RLS and audits every successful transition', () => {
  assert.match(sql, /alter table public\.model_calibration_validations enable row level security/);
  assert.match(sql, /alter table public\.model_calibration_transitions enable row level security/);
  assert.match(sql, /insert into public\.model_calibration_transitions/);
  for (const action of ['initialize', 'promote', 'rollback', 'manual_rollback', 'freeze', 'unfreeze']) {
    assert.ok(sql.includes(`'${action}'`), `missing ${action} action`);
  }
});
