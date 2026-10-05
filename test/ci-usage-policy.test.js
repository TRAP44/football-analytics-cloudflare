import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const quality=fs.readFileSync('.github/workflows/quality.yml','utf8');
const codeql=fs.readFileSync('.github/workflows/codeql.yml','utf8');
const privileged=fs.readFileSync('.github/workflows/privileged-access-audit.yml','utf8');
const monitor=fs.readFileSync('.github/workflows/external-production-monitor.yml','utf8');

test('CI usage policy keeps external monitoring hourly with immediate post-deploy checks',()=>{
  assert.match(monitor,/cron: "17 \* \* \* \*"/);
  assert.doesNotMatch(monitor,/7,22,37,52/);
  assert.match(monitor,/workflow_run:/);
  assert.match(monitor,/workflows: \["Deploy Production"\]/);
});

test('Quality cancels superseded PR runs and skips docs-only changes',()=>{
  assert.match(quality,/group: quality-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(quality,/cancel-in-progress: true/);
  assert.match(quality,/paths-ignore:[\s\S]*"docs\/\*\*"[\s\S]*"\*\*\/\*\.md"/);
});

test('CodeQL PR and main runs are scoped to runtime/security-relevant paths',()=>{
  assert.match(codeql,/pull_request:[\s\S]*paths:[\s\S]*"src\/\*\*"[\s\S]*"public\/\*\*"[\s\S]*"scripts\/\*\*"/);
  assert.match(codeql,/push:[\s\S]*branches: \[main\][\s\S]*paths:/);
  assert.match(codeql,/schedule:/);
});

test('privileged audit keeps weekly coverage while avoiding unrelated PR churn',()=>{
  assert.match(privileged,/pull_request:[\s\S]*paths:[\s\S]*"\.github\/workflows\/\*\*"/);
  assert.match(privileged,/scripts\/security-history-scan\.js/);
  assert.match(privileged,/schedule:[\s\S]*cron: "47 3 \* \* 1"/);
});
