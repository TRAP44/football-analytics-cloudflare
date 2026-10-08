import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');

test('RC114 binds rollback confirmation to both expected version and version id', () => {
  assert.match(workflow, /Type ROLLBACK:<expected_version>:<version_id> to confirm the exact rollback target/);
  assert.match(
    workflow,
    /inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\)/
  );
  assert.doesNotMatch(workflow, /if: inputs\.confirm == 'ROLLBACK'/);
});

test('RC114 preserves fail-closed rollback provenance and target validation', () => {
  assert.match(workflow, /RC113 verify rollback workflow provenance/);
  assert.match(workflow, /Rollback must be dispatched from main/);
  assert.match(workflow, /Stale rollback workflow blocked/);
  assert.match(workflow, /expected_version must look like 6\.94\.0-rc102/);
  assert.match(workflow, /version_id format is invalid/);
});

test('RC114 records exact-target confirmation before the destructive rollback command', () => {
  const confirmationIndex = workflow.indexOf('RC114 rollback target confirmation verified');
  const rollbackIndex = workflow.indexOf('npx wrangler rollback "$VERSION_ID" --yes');
  assert.ok(confirmationIndex >= 0);
  assert.ok(rollbackIndex > confirmationIndex);
  assert.match(workflow, /Operator confirmation is bound to expected version \$EXPECTED_VERSION and version ID \$VERSION_ID/);
  assert.match(workflow, /scripts\/rollback-smoke\.js "\$ROLLBACK_URL" "\$EXPECTED_VERSION"/);
});



test('RC114 preflight validates an exact Cloudflare UUID before any provider request',()=>{
  const preflightStart=workflow.indexOf('- name: Rollback preflight');
  const probeStart=workflow.indexOf('- name: RC115 verify rollback target exists');
  assert.ok(preflightStart>=0 && probeStart>preflightStart);
  const block=workflow.slice(preflightStart,probeStart);
  assert.match(block,/if \[\[ ! "\$VERSION_ID" =~ \^\[0-9a-fA-F\]\{8\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{4\}-\[0-9a-fA-F\]\{12\}\$ \]\]; then/);
  assert.match(block,/version_id format is invalid\.[\s\S]*exit 1/);
  assert.doesNotMatch(block,/npx wrangler versions view/);
});

test('RC114 preflight UUID validation rejects malformed or shell-injected targets',()=>{
  const matched=workflow.match(/if \[\[ ! "\$VERSION_ID" =~ (\^[^\n]+?\$) \]\]; then/);
  assert.ok(matched,'Missing anchored VERSION_ID regex');
  const re=new RegExp(matched[1]);
  for(const id of [
    '11111111-2222-3333-4444-555555555555',
    'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
  ]) assert.equal(re.test(id),true);
  for(const bad of [
    '', 'not-a-version-id', '11111111-2222-3333-4444-55555555555X',
    '11111111222233334444555555555555',
    '11111111-2222-3333-4444-555555555555;echo hi',
    '11111111-2222-3333-4444-555555555555\nother',
    'a'.repeat(80),
  ]) assert.equal(re.test(bad),false,bad);
});

test('RC114 exact operator confirmation stays attached to both release and UUID',()=>{
  const jobs=workflow.slice(workflow.indexOf('jobs:'));
  assert.match(jobs,/if: \$\{\{ inputs\.confirm == format\('ROLLBACK:\{0\}:\{1\}', inputs\.expected_version, inputs\.version_id\) \}\}/);
  assert.match(jobs,/VERSION_ID: \$\{\{ inputs\.version_id \}\}/);
  assert.match(jobs,/EXPECTED_VERSION: \$\{\{ inputs\.expected_version \}\}/);
  assert.doesNotMatch(jobs,/if: \$\{\{ inputs\.confirm == 'ROLLBACK' \}\}/);
});

test('RC114 refuses deployment mutation until version lookup and stamped release checks succeed',()=>{
  const confirm=workflow.indexOf('RC114 rollback target confirmation verified');
  const lookup=workflow.indexOf('- name: RC115 verify rollback target exists');
  const stamp=workflow.indexOf('- name: RC117 verify rollback release identity');
  const mutation=workflow.indexOf('- name: Roll back Worker');
  const post=workflow.indexOf('- name: RC119 verify exact rollback deployment target');
  assert.ok(confirm>=0 && lookup>confirm && stamp>lookup && mutation>stamp && post>mutation);
  assert.match(workflow.slice(stamp,mutation),/scripts\/verify-rollback-target\.js/);
  assert.match(workflow.slice(post),/Cloudflare did not confirm 100% production traffic/);
});
