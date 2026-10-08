import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflareVersionIdValid, validateReleaseIdentity } from '../src/release-identity.js';

const RELEASE_RE = /^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$/;
const SHA_RE = /^[0-9a-f]{40}$/i;

export function activeProductionVersion(deployment) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    throw new Error('Cloudflare deployment status must be a JSON object.');
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    throw new Error('Cloudflare deployment status must include traffic versions.');
  }

  const versions = deployment.versions.map((entry, index) => {
    const versionId = entry?.version_id;
    const percentage=entry?.percentage;
    if (!versionId) throw new Error(`Deployment traffic entry ${index + 1} is missing version_id.`);
    if (!cloudflareVersionIdValid(versionId)) throw new Error(`Deployment traffic entry ${index + 1} has an invalid version_id (RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_INVALID).`);
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Deployment traffic entry ${index + 1} has an invalid percentage.`);
    }
    return { versionId, percentage };
  });

  const seen=new Set();
  for (const version of versions) {
    const id=version.versionId.toLowerCase();
    if (seen.has(id)) throw new Error('Cloudflare deployment traffic contains duplicate version IDs.');
    seen.add(id);
  }
  const total = versions.reduce((sum, entry) => sum + entry.percentage, 0);
  const active = versions.filter(entry => entry.percentage > 0);
  if (total !== 100) {
    throw new Error(`Cloudflare production traffic must total 100%; got ${total}%.`);
  }
  if (active.length !== 1 || active[0].percentage !== 100) {
    const allocation = active.map(entry => `${entry.versionId}@${entry.percentage}%`).join(', ');
    throw new Error(`Production deployment must have one version at 100% traffic; current allocation: ${allocation || 'none'}.`);
  }
  return active[0].versionId;
}

export function resolveActiveProductionReleaseIdentity(deployment, versions) {
  // Wrangler's version view returns one version, while list returns an array.
  const candidates = Array.isArray(versions) ? versions : [versions];
  if (candidates.some(version => !version || typeof version !== 'object' || Array.isArray(version))) {
    throw new Error('Cloudflare version details must be JSON objects.');
  }

  const activeVersionId = activeProductionVersion(deployment);
  const activeVersions = candidates.filter(version => typeof version?.id === 'string' && version.id.toLowerCase() === activeVersionId.toLowerCase());
  if (activeVersions.length === 0) {
    throw new Error(`Active production version ${activeVersionId} is missing from the recent Cloudflare versions list.`);
  }
  if (activeVersions.length !== 1) {
    throw new Error(`Active production version ${activeVersionId} appears multiple times in the Cloudflare versions list.`);
  }
  const [activeVersion] = activeVersions;

  const actualMessage = typeof activeVersion.annotations?.['workers/message'] === 'string'
    ? activeVersion.annotations['workers/message'].trim() : '';
  const actualTag = typeof activeVersion.annotations?.['workers/tag'] === 'string'
    ? activeVersion.annotations['workers/tag'].trim() : '';
  const match = /^release=([^\s]+) sha=([0-9a-f]{40})$/i.exec(actualMessage);
  if (!match || !RELEASE_RE.test(match[1]) || !SHA_RE.test(match[2])) {
    throw new Error(`Active production version ${activeVersionId} release identity mismatch.`);
  }
  const messageSha = match[2].toLowerCase();
  if (!SHA_RE.test(actualTag) || actualTag.toLowerCase() !== messageSha) {
    throw new Error(`Active production version ${activeVersionId} version tag does not match deploy SHA.`);
  }

  const rcNumber = /-rc([0-9]+)$/i.exec(match[1])?.[1] || '';
  const validation = validateReleaseIdentity({
    appVersion: match[1],
    releaseCandidate: `RC${rcNumber}`,
    deploySha: messageSha,
    cloudflareVersionId: activeVersionId,
    cloudflareVersionTag: actualTag,
    cloudflareVersionTimestamp: activeVersion.metadata?.created_on,
  });
  if (!validation.ok) {
    throw new Error(`Active production version ${activeVersionId} release identity validation failed: ${validation.code}.`);
  }

  return {
    deploymentId: typeof deployment.id === 'string' ? deployment.id : '',
    versionId: activeVersionId,
    release: match[1],
    sha: messageSha,
    tag: actualTag.toLowerCase(),
    timestamp: new Date(validation.timestampMs).toISOString(),
  };
}

export function verifyProductionReleasePostcondition(deployment, versions, expectedRelease, expectedSha) {
  if (typeof expectedRelease !== 'string' || !RELEASE_RE.test(expectedRelease)) {
    throw new Error('Expected production release has an invalid format.');
  }
  if (typeof expectedSha !== 'string' || !SHA_RE.test(expectedSha)) {
    throw new Error('Expected deploy SHA must be a 40-character Git commit SHA.');
  }
  const active = resolveActiveProductionReleaseIdentity(deployment, versions);
  if (
    active.release.toLowerCase() !== expectedRelease.toLowerCase()
    || active.sha !== expectedSha.toLowerCase()
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
  if (versionsPath === '--print-active-version-id' && !expectedRelease && !expectedSha) {
    // Fail closed on split traffic before fetching the specific rollback version.
    console.log(activeProductionVersion(deployment));
    return;
  }
  const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));

  if (expectedRelease === '--print-active-identity' && !expectedSha) {
    const active = resolveActiveProductionReleaseIdentity(deployment, versions);
    console.log(`${active.release} ${active.sha}`);
    return;
  }

  if (expectedRelease === '--print-active-rollback-target' && !expectedSha) {
    const active = resolveActiveProductionReleaseIdentity(deployment, versions);
    console.log(`${active.versionId} ${active.release} ${active.sha}`);
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
