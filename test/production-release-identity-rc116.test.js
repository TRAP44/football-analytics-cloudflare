import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const verifier = fs.readFileSync('scripts/verify-release.js', 'utf8');

test('RC116 defines one production release identity for deployment and smoke', () => {
  assert.match(workflow, /RELEASE_VERSION: "6\.120\.0-rc144"/);
  assert.match(
    workflow,
    /command: deploy --keep-vars --tag "\$\{\{ env\.DEPLOY_SHA \}\}" --message "release=\$\{\{ env\.RELEASE_VERSION \}\} sha=\$\{\{ env\.DEPLOY_SHA \}\}"/
  );
  assert.match(workflow, /EXPECTED_RUNTIME_SHA="\$DEPLOY_SHA"/);
  assert.match(workflow, /EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"/);
  assert.match(
    workflow,
    /post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA"/
  );
});

test('RC116 Cloudflare version metadata is machine-readable and commit-bound', () => {
  const deployCommand = workflow.match(/command: deploy[^\n]+/)?.[0] || '';
  assert.match(deployCommand, /release=\$\{\{ env\.RELEASE_VERSION \}\}/);
  assert.match(deployCommand, /sha=\$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(deployCommand, /--tag "\$\{\{ env\.DEPLOY_SHA \}\}"/);
  assert.doesNotMatch(deployCommand, /--message "RC109 /);
});

test('RC116 release verifier locks the identity contract', () => {
  assert.match(verifier, /Production deploy must pin the verified release-contract runtime version/);
  assert.match(verifier, /Production deploy message must bind release version and deploy SHA/);
  assert.match(verifier, /Production smoke must verify the same release identity used for deployment/);
});



test('RC116 production release version matches package and release contract',()=>{
  const contract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  assert.equal(contract.applicationVersion,pkg.version);
  assert.equal(contract.runtimeVersion.split('-rc')[0],pkg.version);
  assert.match(contract.runtimeVersion,/^\d+\.\d+\.\d+-rc\d+$/);
  assert.ok(workflow.includes('RELEASE_VERSION: "'+contract.runtimeVersion+'"'));
});

test('RC116 post-deploy verification binds both the active SHA and Cloudflare version ID',()=>{
  assert.match(workflow,/ACTIVE_RUNTIME_VERSION_ID: \$\{\{ steps\.production_changes\.outputs\.previous_version_id \}\}/);
  assert.match(workflow,/VERIFIED_VERSION_ID: \$\{\{ steps\.release_identity\.outputs\.active_version_id \}\}/);
  assert.match(workflow,/EXPECTED_RUNTIME_SHA="\$DEPLOY_SHA"\s+EXPECTED_VERSION_ID="\$VERIFIED_VERSION_ID"/);
  assert.match(workflow,/EXPECTED_RUNTIME_SHA="\$ACTIVE_RUNTIME_SHA"\s+EXPECTED_VERSION_ID="\$ACTIVE_RUNTIME_VERSION_ID"/);
  assert.match(workflow,/post-deploy-smoke\.js "\$SMOKE_URL" "\$RELEASE_VERSION" "\$EXPECTED_RUNTIME_SHA" "\$EXPECTED_VERSION_ID"/);
  assert.match(workflow,/if \[\[ ! "\$EXPECTED_VERSION_ID" =~ \^\[0-9a-fA-F-\]\{36\}\$ \]\]; then/);
});

test('RC116 release control-plane verification precedes runtime acceptance',()=>{
  assert.match(workflow,/node scripts\/verify-production-release-postcondition\.js "\$DEPLOYMENT_STATUS_JSON" "\$VERSIONS_JSON" "\$RELEASE_VERSION" "\$DEPLOY_SHA"/);
  assert.match(workflow,/if \[\[ "\$verified" != "true" \]\]; then[\s\S]*Cloudflare did not confirm the expected production release identity/);
  assert.match(workflow,/echo "active_version_id=\$ACTIVE_VERSION_ID" >> "\$GITHUB_OUTPUT"/);
  assert.ok(workflow.indexOf('RC120 verify active production release identity')
    < workflow.indexOf('Verify production deployment'));
});

test('RC116 recovery candidate is immutably bound to the same release identity',()=>{
  assert.match(workflow,/npx wrangler versions upload --keep-vars --preview-alias "\$RECOVERY_ALIAS" --tag "\$DEPLOY_SHA" --message "release=\$RELEASE_VERSION sha=\$DEPLOY_SHA"/);
  assert.match(workflow,/post-deploy-smoke\.js "\$RECOVERY_URL" "\$RELEASE_VERSION" "\$DEPLOY_SHA" "\$RECOVERY_VERSION_ID"/);
});
