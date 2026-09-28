import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELEASE_RE = /^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const EPSILON = 1e-9;

function activeProductionVersion(deployment) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    throw new Error('Cloudflare deployment status must be a JSON object.');
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    throw new Error('Cloudflare deployment status must include traffic versions.');
  }

  const versions = deployment.versions.map((entry, index) => {
    const versionId = String(entry?.version_id || '');
    const percentage = Number(entry?.percentage);
    if (!versionId) throw new Error(`Deployment traffic entry ${index + 1} is missing version_id.`);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Deployment traffic entry ${index + 1} has an invalid percentage.`);
    }
    return { versionId, percentage };
  });

  const total = versions.reduce((sum, entry) => sum + entry.percentage, 0);
  const active = versions.filter(entry => entry.percentage > EPSILON);
  if (Math.abs(total - 100) > EPSILON) {
    throw new Error(`Cloudflare production traffic must total 100%; got ${total}%.`);
  }
  if (active.length !== 1 || Math.abs(active[0].percentage - 100) > EPSILON) {
    const allocation = active.map(entry => `${entry.versionId}@${entry.percentage}%`).join(', ');
    throw new Error(`Production deployment must have one version at 100% traffic; current allocation: ${allocation || 'none'}.`);
  }
  return active[0].versionId;
}

export function resolveActiveProductionReleaseIdentity(deployment, versions) {
  if (!Array.isArray(versions)) {
    throw new Error('Cloudflare versions list must be a JSON array.');
  }

  const activeVersionId = activeProductionVersion(deployment);
  const activeVersion = versions.find(version => version?.id === activeVersionId);
  if (!activeVersion) {
    throw new Error(`Active production version ${activeVersionId} is missing from the recent Cloudflare versions list.`);
  }

  const actualMessage = String(activeVersion.annotations?.['workers/message'] || '').trim();
  const match = /^release=([^\s]+) sha=([0-9a-f]{40})$/i.exec(actualMessage);
  if (!match || !RELEASE_RE.test(match[1]) || !SHA_RE.test(match[2])) {
    throw new Error(`Active production version ${activeVersionId} release identity mismatch.`);
  }

  return {
    deploymentId: typeof deployment.id === 'string' ? deployment.id : '',
    versionId: activeVersionId,
    release: match[1],
    sha: match[2].toLowerCase(),
  };
}

export function verifyProductionReleasePostcondition(deployment, versions, expectedRelease, expectedSha) {
  if (!RELEASE_RE.test(String(expectedRelease || ''))) {
    throw new Error('Expected production release has an invalid format.');
  }
  if (!SHA_RE.test(String(expectedSha || ''))) {
    throw new Error('Expected deploy SHA must be a 40-character Git commit SHA.');
  }
  const active = resolveActiveProductionReleaseIdentity(deployment, versions);
  if (
    active.release.toLowerCase() !== String(expectedRelease).toLowerCase()
    || active.sha !== String(expectedSha).toLowerCase()
  ) {
    throw new Error(`Active production version ${active.versionId} release identity mismatch.`);
  }

  return {
    ok: true,
    ...active,
  };
}

function main() {
  const [deploymentPath, versionsPath, expectedRelease, expectedSha] = process.argv.slice(2);
  if (!deploymentPath || !versionsPath) {
    throw new Error('Usage: node scripts/verify-production-release-postcondition.js <deployment-json> <versions-json> <release> <sha>');
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

  if (expectedRelease === '--print-active-identity' && !expectedSha) {
    const active = resolveActiveProductionReleaseIdentity(deployment, versions);
    console.log(`${active.release} ${active.sha}`);
    return;
  }

  if (!expectedRelease || !expectedSha) {
    throw new Error('Usage: node scripts/verify-production-release-postcondition.js <deployment-json> <versions-json> <release> <sha>');
  }
  const result = verifyProductionReleasePostcondition(deployment, versions, expectedRelease, expectedSha);
  console.log(`Verified active production release ${result.release} sha=${result.sha} version_id=${result.versionId}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
