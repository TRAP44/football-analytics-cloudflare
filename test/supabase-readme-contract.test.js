import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  FRESH_BASELINE,
  POST_BASELINE_MIGRATIONS,
} from '../scripts/prepare-supabase-ci-migrations.js';

const readme = fs.readFileSync('supabase/README.md', 'utf8');
const release = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

test('Supabase README follows the executable fresh-install migration contract', () => {
  assert.ok(readme.includes(FRESH_BASELINE.replace('supabase/', '')));
  assert.ok(readme.includes('через v6.19.1 включительно'));

  for (const migration of POST_BASELINE_MIGRATIONS) {
    assert.ok(
      readme.includes(migration.replace('supabase/migrations/', '')),
      `README is missing ${migration}`,
    );
  }

  assert.equal(release.freshInstallBaseline, FRESH_BASELINE);
  assert.equal(release.latestMigration, POST_BASELINE_MIGRATIONS.at(-1));
  assert.ok(readme.includes(release.latestMigration.replace('supabase/migrations/', '')));
  assert.ok(readme.includes(`**v${release.productionSchema}**`));
});
