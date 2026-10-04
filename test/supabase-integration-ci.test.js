import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  FRESH_BASELINE,
  POST_BASELINE_MIGRATIONS,
  buildMigrationPlan,
  validateMigrationPlan,
} from '../scripts/prepare-supabase-ci-migrations.js';

const quality = fs.readFileSync(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
);
const releaseContract = JSON.parse(
  fs.readFileSync(new URL('../release-contract.json', import.meta.url), 'utf8'),
);

test('Issue #433 fresh migration plan follows the documented baseline contract', () => {
  const plan = buildMigrationPlan('fresh');
  assert.equal(plan[0].source, FRESH_BASELINE);
  assert.equal(plan.at(-1).source, releaseContract.latestMigration);
  assert.equal(plan.length, 1 + POST_BASELINE_MIGRATIONS.length);

  const versions = plan.map((item) => item.version);
  assert.deepEqual(versions, [...versions].sort());
  assert.equal(new Set(versions).size, versions.length);
  assert.ok(plan.every((item) => /^\d{14}_.+\.sql$/.test(item.filename)));
});

test('Issue #433 upgrade plan stops before latest and appends only latest migration', () => {
  const base = buildMigrationPlan('upgrade-base');
  const latest = buildMigrationPlan('latest-only');

  assert.equal(base[0].source, releaseContract.freshInstallBaseline);
  assert.equal(base.at(-1).source, 'supabase/migrations/supabase_migration_v6_27_2.sql');
  assert.equal(latest.length, 1);
  assert.equal(latest[0].source, releaseContract.latestMigration);
  assert.ok(base.at(-1).version < latest[0].version);
});

test('Issue #433 migration plan matches release-contract and every canonical source exists', () => {
  validateMigrationPlan(
    new URL('..', import.meta.url).pathname,
    releaseContract,
  );
});

test('Issue #433 Quality contains a secret-free executable Supabase database gate', () => {
  assert.match(quality, /database-integration:/);
  assert.match(quality, /SUPABASE_CLI_VERSION: "2\.119\.0"/);
  assert.match(quality, /supabase@\$SUPABASE_CLI_VERSION/);
  assert.match(quality, /prepare-supabase-ci-migrations\.js/);
  assert.match(quality, /supabase-concurrency-gate\.js/);
  assert.match(quality, /supabase-ci-contract\.sql/);
  assert.match(quality, /backend_schema_contract_v2/);
  assert.match(quality, /backend_readiness_contract_v2/);
  assert.match(quality, /PRE_LATEST_LEGACY_FP/);
  assert.match(quality, /OLD_WORKER_READY/);
  assert.match(quality, /NEW_WORKER_READY/);
  assert.match(quality, /migration up/);
  assert.match(quality, /Fresh-install baseline unexpectedly applied/);
  assert.doesNotMatch(quality, /secrets\.SUPABASE_/);
});

test('Issue #438 CI contract proves complete v2 drift detection and rollout compatibility', () => {
  const sql = fs.readFileSync(
    new URL('../scripts/supabase-ci-contract.sql', import.meta.url),
    'utf8',
  );
  const dbContract = releaseContract.databaseContract;
  assert.equal(dbContract.version, 2);
  assert.match(dbContract.fingerprint, /^[a-f0-9]{32}$/);
  assert.match(dbContract.freshInstallFingerprint, /^[a-f0-9]{32}$/);
  assert.match(dbContract.legacyFingerprint, /^[a-f0-9]{32}$/);
  assert.match(dbContract.freshInstallLegacyFingerprint, /^[a-f0-9]{32}$/);
  assert.deepEqual(dbContract.compatibleFingerprints, [
    dbContract.fingerprint,
    dbContract.freshInstallFingerprint,
  ]);
  assert.equal(new Set(dbContract.compatibleFingerprints).size, 2);

  assert.match(sql, /backend_schema_contract_v2/);
  assert.match(sql, /backend_readiness_contract_v2/);
  assert.match(sql, /issue438_contract_probe/);
  assert.match(sql, /v2 ignored a new public table/);
  assert.match(sql, /v2 ignored a new public column/);
  assert.match(sql, /legacy backend schema fingerprint drifted/);
  assert.match(sql, /expected_legacy_fingerprint/);
  assert.match(sql, /expected_v2_fingerprint/);
  assert.doesNotMatch(sql, /6a7f0fe444f49a2a52c4603e952ee9ea/);
  assert.doesNotMatch(sql, /8b3e6ec749079296e6746d3db8ae3d2e/);

  assert.match(quality, /freshInstallLegacyFingerprint/);
  assert.match(quality, /freshInstallFingerprint/);
  assert.match(quality, /expected_legacy_fingerprint="$FRESH_LEGACY_FP"/);
  assert.match(quality, /expected_v2_fingerprint="$FRESH_V2_FP"/);
  assert.doesNotMatch(quality, /test "$LEGACY_FP" = "c2c22ec25aacfcf1b9938b0850cebf49"/);
});

test('Issue #433 keeps database integration in the same Quality workflow used by deploy', () => {
  const jobs = quality.slice(quality.indexOf('jobs:'));
  assert.match(jobs, /\n  test:/);
  assert.match(jobs, /\n  database-integration:/);
});
