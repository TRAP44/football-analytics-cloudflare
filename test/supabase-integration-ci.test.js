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
  assert.equal(base.at(-1).source, 'supabase/migrations/supabase_migration_v6_27.sql');
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
  assert.match(quality, /migration up/);
  assert.match(quality, /Fresh-install baseline unexpectedly applied/);
  assert.doesNotMatch(quality, /secrets\.SUPABASE_/);
});

test('Issue #433 keeps database integration in the same Quality workflow used by deploy', () => {
  const jobs = quality.slice(quality.indexOf('jobs:'));
  assert.match(jobs, /\n  test:/);
  assert.match(jobs, /\n  database-integration:/);
});
