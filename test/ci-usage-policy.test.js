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

test('Quality cancels superseded PR runs without cancelling trusted main gates',()=>{
  assert.match(quality,/group: quality-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.sha \}\}/);
  assert.match(quality,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.doesNotMatch(quality,/cancel-in-progress: true/);
  assert.match(quality,/paths-ignore:[\s\S]*"docs\/\*\*"[\s\S]*"\*\*\/\*\.md"/);
  assert.match(quality,/database-integration:[\s\S]*runs-on: \[self-hosted, Linux, X64\]/);
  assert.match(quality,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
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


test('closed pull requests cancel queued self-hosted CI without consuming a runner',()=>{
  for (const [name,workflow] of [
    ['Quality',quality],
    ['CodeQL',codeql],
    ['Privileged Access Audit',privileged],
  ]) {
    assert.match(
      workflow,
      /pull_request:[\s\S]*types: \[opened, synchronize, reopened, closed\]/,
      `${name} must receive the closed event so workflow-level concurrency can cancel the queued PR run`,
    );
    assert.match(
      workflow,
      /if: \$\{\{ github\.event_name != 'pull_request' \|\| github\.event\.action != 'closed' \}\}/,
      `${name} must skip runner jobs for the synthetic close/cancellation run`,
    );
  }

  assert.equal(
    (quality.match(/if: \$\{\{ github\.event_name != 'pull_request' \|\| github\.event\.action != 'closed' \}\}/g) || []).length,
    1,
    'the ephemeral Quality test job must skip on pull_request.closed',
  );
  assert.match(
    quality,
    /database-integration:[\s\S]*if: \$\{\{ github\.event_name != 'pull_request' \|\| \(github\.event\.action != 'closed' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\) \}\}/,
    'the self-hosted Quality database job must both skip closed PRs and reject fork PR code',
  );
});


test('main Quality runs use commit-scoped concurrency while security checks keep PR-scoped cancellation',()=>{
  assert.match(
    quality,
    /group: quality-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.sha \}\}/,
  );
  assert.match(quality,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);

  
  assert.match(
    codeql,
    /group: codeql-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/,
  );
  assert.match(
    privileged,
    /group: privileged-access-audit-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/,
  );
  assert.doesNotMatch(codeql,/group: codeql-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.doesNotMatch(privileged,/group: privileged-access-audit-\$\{\{ github\.ref \}\}/);
});
