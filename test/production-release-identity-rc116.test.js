import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const verifier = fs.readFileSync('scripts/verify-release.js', 'utf8');

test('RC116 defines one production release identity for deployment and smoke', () => {
  assert.match(workflow, /RELEASE_VERSION: "6\.107\.0-rc131"/);
  assert.match(
    workflow,
    /command: deploy --keep-vars --message "release=\$\{\{ env\.RELEASE_VERSION \}\} sha=\$\{\{ env\.DEPLOY_SHA \}\}"/
  );
  assert.match(
    workflow,
    /post-deploy-smoke\.js "\$SMOKE_URL" "\$\{\{ env\.RELEASE_VERSION \}\}"/
  );
});

test('RC116 Cloudflare version metadata is machine-readable and commit-bound', () => {
  const deployCommand = workflow.match(/command: deploy[^\n]+/)?.[0] || '';
  assert.match(deployCommand, /release=\$\{\{ env\.RELEASE_VERSION \}\}/);
  assert.match(deployCommand, /sha=\$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.doesNotMatch(deployCommand, /--message "RC109 /);
});

test('RC116 release verifier locks the identity contract', () => {
  assert.match(verifier, /Production deploy must pin the verified release version/);
  assert.match(verifier, /Production deploy message must bind release version and deploy SHA/);
  assert.match(verifier, /Production smoke must verify the same release identity used for deployment/);
});
