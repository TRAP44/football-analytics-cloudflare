import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const config = fs.readFileSync('.github/dependabot.yml', 'utf8');
const runbook = fs.readFileSync('docs/DEPENDABOT_RUNBOOK_RU.md', 'utf8');

test('Dependabot watches npm and GitHub Actions weekly without auto-merge', () => {
  assert.match(config, /version: 2/);
  assert.match(config, /package-ecosystem: "npm"/);
  assert.match(config, /package-ecosystem: "github-actions"/);
  assert.match(config, /interval: "weekly"/);
  assert.match(config, /timezone: "Europe\/Riga"/);
  assert.match(config, /open-pull-requests-limit: 5/);
  assert.match(config, /update-types:\n\s+- "minor"\n\s+- "patch"/);
  assert.doesNotMatch(config, /auto-merge|automerge|merge-method/);
});

test('Dependabot runbook keeps dependency updates behind Quality', () => {
  assert.match(runbook, /не выполняет merge/i);
  assert.match(runbook, /Quality gate/i);
  assert.match(runbook, /Major обновления/i);
  assert.match(runbook, /High\/Critical/i);
});
