// Задача 0: деплой после правки секрета в панели Cloudflare.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  resolveActiveProductionReleaseIdentity,
  resolveSettingsBaseVersionId,
  resolveSettingsOnlyProductionIdentity,
  settingsHistoryVersionIds,
} from '../scripts/verify-production-release-postcondition.js';
import { verifyRollbackTarget } from '../scripts/verify-rollback-target.js';
import { settingsOnlyVersion } from '../scripts/cloudflare-settings-version.js';

const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-production.yml', import.meta.url), 'utf8');

const baseId = '11111111-2222-3333-4444-555555555555';
const secretId = '22222222-3333-4444-5555-666666666666';
const secondSecretId = '33333333-4444-5555-6666-777777777777';
const previewId = '44444444-5555-6666-7777-888888888888';
const release = '6.120.0-rc144';
const sha = 'a'.repeat(40);
const etag = 'etag-script-content-0001';

function stamped({ id = baseId, sha: stampSha = sha, scriptEtag = etag, created = '2026-10-10T10:00:00.000Z' } = {}) {
  return {
    id,
    metadata: { created_on: created, source: 'wrangler' },
    annotations: { 'workers/message': `release=${release} sha=${stampSha}`, 'workers/tag': stampSha, 'workers/triggered_by': 'upload' },
    resources: { script: { etag: scriptEtag } },
  };
}

function secretVersion({ id = secretId, scriptEtag = etag, trigger = 'secret', created = '2026-10-11T10:00:00.000Z' } = {}) {
  return {
    id,
    metadata: { created_on: created, source: 'dash' },
    annotations: { 'workers/triggered_by': trigger },
    resources: { script: { etag: scriptEtag } },
  };
}

function deploymentOf(versionId, created, id = `dep-${versionId.slice(0, 8)}`) {
  return { id, created_on: created, versions: [{ version_id: versionId, percentage: 100 }] };
}

const status = deploymentOf(secretId, '2026-10-11T10:00:01.000Z');
const history = [
  deploymentOf(baseId, '2026-10-10T10:00:01.000Z'),
  deploymentOf(secretId, '2026-10-11T10:00:01.000Z'),
];

test('a version created by a secret change has no CI stamp, so the old gate refuses it', () => {
  assert.equal(settingsOnlyVersion(secretVersion()), true);
  assert.equal(settingsOnlyVersion(stamped()), false);
  // Пометка триггера у правки в панели не «secret» (проверено вживую 12.10) —
  // решает отсутствие отметки CI плюс доказательство того же кода.
  assert.equal(settingsOnlyVersion(secretVersion({ trigger: 'upload' })), true);
  assert.equal(settingsOnlyVersion({ ...stamped(), annotations: { 'workers/tag': sha } }), true, 'a copied tag without the release message is not a stamp');
  assert.throws(() => resolveActiveProductionReleaseIdentity(status, secretVersion()), /release identity mismatch/);
});

test('deployment history leads from the secret-change version back to the CI-stamped base', () => {
  assert.equal(resolveSettingsBaseVersionId(status, secretVersion(), history, [stamped()]), baseId);
  const identity = resolveSettingsOnlyProductionIdentity(status, secretVersion(), history, [stamped()], stamped());
  assert.deepEqual(
    { versionId: identity.versionId, release: identity.release, sha: identity.sha, baseVersionId: identity.baseVersionId },
    { versionId: secretId, release, sha, baseVersionId: baseId },
  );
});

test('several secret edits in a row still resolve to the same CI-stamped base', () => {
  const chainStatus = deploymentOf(secondSecretId, '2026-10-11T11:00:01.000Z');
  const chain = [...history, deploymentOf(secondSecretId, '2026-10-11T11:00:01.000Z')];
  const second = secretVersion({ id: secondSecretId, created: '2026-10-11T11:00:00.000Z' });
  assert.equal(resolveSettingsBaseVersionId(chainStatus, second, chain, [secretVersion(), stamped()]), baseId);
});

test('the base is the version that was live before, not the newest stamped upload', () => {
  // A stamped preview upload that never received traffic must not be picked.
  const versions = [stamped({ id: previewId, sha: 'b'.repeat(40), created: '2026-10-10T12:00:00.000Z' }), stamped()];
  assert.equal(resolveSettingsBaseVersionId(status, secretVersion(), history, versions), baseId);
});

test('the gate stays closed when the code cannot be proven identical', () => {
  assert.throws(
    () => resolveSettingsOnlyProductionIdentity(status, secretVersion({ scriptEtag: 'etag-other-content-02' }), history, [stamped()], stamped()),
    /different script content/,
  );
  const noEtag = secretVersion();
  delete noEtag.resources;
  assert.throws(() => resolveSettingsOnlyProductionIdentity(status, noEtag, history, [stamped()], stamped()), /etag\) is missing/);
});

test('the gate stays closed for unstamped uploads, gaps and split traffic', () => {
  // Code uploaded from the dashboard or a local `wrangler deploy` without a stamp:
  // its script hash differs from the CI version, so it is refused.
  const dashboardCode = secretVersion({ trigger: 'upload', scriptEtag: 'etag-dashboard-edit-9' });
  assert.throws(() => resolveSettingsOnlyProductionIdentity(status, dashboardCode, history, [stamped()], stamped()), /different script content/);
  // A settings edit made on top of such an upload keeps that code — also refused.
  const uploadedHistory = [history[0], deploymentOf(previewId, '2026-10-10T12:00:01.000Z'), deploymentOf(secretId, '2026-10-11T10:00:01.000Z')];
  const onUpload = secretVersion({ scriptEtag: 'etag-dashboard-edit-9' });
  assert.throws(
    () => resolveSettingsOnlyProductionIdentity(status, onUpload, uploadedHistory, [secretVersion({ id: previewId, trigger: 'upload', scriptEtag: 'etag-dashboard-edit-9' }), stamped()], stamped()),
    /different script content/,
  );
  // A dashboard settings edit (any trigger) with the CI code is accepted.
  assert.equal(resolveSettingsOnlyProductionIdentity(status, secretVersion({ trigger: 'upload' }), history, [stamped()], stamped()).baseVersionId, baseId);
  assert.throws(() => resolveSettingsBaseVersionId(status, secretVersion(), history, []), /missing from the Cloudflare versions list/);
  assert.throws(() => resolveSettingsBaseVersionId(status, secretVersion(), [history[1]], [stamped()]), /No CI-stamped version/);
  const split = { ...history[0], versions: [{ version_id: baseId, percentage: 50 }, { version_id: previewId, percentage: 50 }] };
  assert.throws(() => resolveSettingsBaseVersionId(status, secretVersion(), [split, history[1]], [stamped()]), /one version at 100% traffic/);
  assert.throws(() => resolveSettingsBaseVersionId(status, secretVersion(), [history[0]], [stamped()]), /does not serve the active production version/);
  assert.throws(() => resolveSettingsOnlyProductionIdentity(status, secretVersion(), history, [stamped()], stamped({ id: previewId })), /do not describe CI-stamped base/);
});

test('rollback target stays the secret-change version and is verified through its base', () => {
  const result = verifyRollbackTarget(secretVersion(), release, secretId, false, '', sha, stamped());
  assert.deepEqual(result, { mode: 'settings-only', releaseVersion: release, deploySha: sha, baseVersionId: baseId });
  assert.throws(() => verifyRollbackTarget(secretVersion(), release, secretId, false, '', 'b'.repeat(40), stamped()), /deploy SHA mismatch/);
  assert.throws(() => verifyRollbackTarget(secretVersion(), release, secretId, false, '', '', stamped()), /requires the expected deploy SHA/);
  assert.throws(() => verifyRollbackTarget(secretVersion({ scriptEtag: 'etag-other-content-02' }), release, secretId, false, '', sha, stamped()), /different script content/);
  assert.throws(() => verifyRollbackTarget(stamped({ id: secretId }), release, secretId, false, '', sha, stamped()), /without a CI release stamp/);
  // Without a base the old rule holds: an unstamped target is refused.
  assert.throws(() => verifyRollbackTarget(secretVersion(), release, secretId, false, '', sha), /no RC116 release identity metadata/);
});

test('CLI modes print the settings-only rollback target the workflow reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-gate-'));
  const write = (name, value) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };
  const files = [write('status.json', status), write('active.json', secretVersion()), write('history.json', history), write('list.json', [stamped()])];
  const script = new URL('../scripts/verify-production-release-postcondition.js', import.meta.url).pathname;
  const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }).trim();
  assert.equal(run(files[0], '--print-settings-base-version-id', ...files.slice(1)), baseId);
  const base = write('base.json', stamped());
  assert.equal(run(files[0], '--print-settings-rollback-target', ...files.slice(1), base), `${secretId} ${release} ${sha} ${baseId}`);
  const rollback = new URL('../scripts/verify-rollback-target.js', import.meta.url).pathname;
  const output = execFileSync(process.execPath, [rollback, files[1], release, secretId, 'false', '', sha, base], { encoding: 'utf8' });
  assert.match(output, /Verified settings-only rollback target/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('workflow: settings-only path is a fallback that forces a stamped redeploy and keeps rollback checks', () => {
  const detect = workflow.slice(
    workflow.indexOf('- name: Detect pending production artifact changes'),
    workflow.indexOf('- name: Preflight previous-known-good rollback target'),
  );
  const stampedPath = detect.indexOf('--print-active-rollback-target');
  const settingsPath = detect.indexOf('--print-settings-rollback-target');
  assert.ok(stampedPath > 0 && settingsPath > stampedPath, 'stamped identity is tried first');
  const settingsBlock = detect.slice(settingsPath);
  assert.match(settingsBlock, /previous_base_version_id=\$BASE_VERSION_ID/);
  assert.match(settingsBlock, /changed=true/);
  assert.doesNotMatch(settingsBlock.slice(0, settingsBlock.indexOf('Safe production deployment blocked')), /changed=false/);
  assert.match(settingsBlock, /Safe production deployment blocked[\s\S]*exit 1/);

  const preflight = workflow.slice(workflow.indexOf('- name: Preflight previous-known-good rollback target'), workflow.indexOf('- name: Deploy Worker'));
  const rollback = workflow.slice(workflow.indexOf('- name: Automatic rollback after failed production verification'));
  for (const block of [preflight, rollback]) {
    assert.match(block, /PREVIOUS_BASE_VERSION_ID: \$\{\{ steps\.production_changes\.outputs\.previous_base_version_id \}\}/);
    assert.match(block, /wrangler versions view "\$PREVIOUS_BASE_VERSION_ID" --json/);
    assert.match(block, /"\$PREVIOUS_SHA" "\$\{SETTINGS_BASE_ARGS\[@\]\}"/);
  }
  assert.match(preflight, /rollback-smoke\.js "\$SMOKE_URL" "\$PREVIOUS_RELEASE"/);
  assert.match(rollback, /verify-rollback-deployment\.js "\$DEPLOYMENT_STATUS_JSON" "\$PREVIOUS_VERSION_ID"/);
});

test('codex #844: every version from deployment history is fetched by its ID', () => {
  const chain = [...history, deploymentOf(secondSecretId, '2026-10-11T11:00:01.000Z'), deploymentOf(secondSecretId, '2026-10-11T12:00:01.000Z', 'dep-repeat')];
  const chainStatus = deploymentOf(secondSecretId, '2026-10-11T12:00:01.000Z', 'dep-repeat');
  // Newest first, without the active version and without duplicates.
  assert.deepEqual(settingsHistoryVersionIds(chainStatus, chain), [secretId, baseId]);
  const split = { ...history[0], versions: [{ version_id: baseId, percentage: 50 }, { version_id: previewId, percentage: 50 }] };
  assert.throws(() => settingsHistoryVersionIds(status, [split, history[1]]), /one version at 100% traffic/);

  const detect = workflow.slice(
    workflow.indexOf('- name: Detect pending production artifact changes'),
    workflow.indexOf('- name: Preflight previous-known-good rollback target'),
  );
  assert.doesNotMatch(detect, /wrangler versions list --json/);
  assert.match(detect, /history_versions\(\) \{[\s\S]*?--print-history-version-ids[\s\S]*?wrangler versions view "\$id" --json[\s\S]*?jq -s '\.'/);
  assert.match(detect, /deployments list --json > "\$DEPLOYMENTS_JSON" \\\n\s+&& history_versions \\/);
});

test('hotfix 12.10: a blocked deploy describes the versions without exposing values', async () => {
  const { describeVersion } = await import('../scripts/cloudflare-settings-version.js');
  assert.equal(describeVersion(secretVersion({ trigger: 'upload' })), `id=${secretId} trigger=upload source=dash message=none tag=none etag=present`);
  assert.equal(describeVersion(stamped()), `id=${baseId} trigger=upload source=wrangler message=release tag=present etag=present`);
  assert.match(workflow, /--describe-version 2>\/dev\/null \|\| echo unavailable\)" >> "\$GITHUB_STEP_SUMMARY"/);
});
