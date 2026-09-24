import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const EPSILON = 1e-9;

function normalizedTrafficVersions(deployment) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    throw new Error('Cloudflare deployment status must be a JSON object.');
  }
  if (!Array.isArray(deployment.versions) || deployment.versions.length === 0) {
    throw new Error('Cloudflare deployment status must include at least one traffic version.');
  }

  return deployment.versions.map((entry, index) => {
    const versionId = String(entry?.version_id || '');
    const percentage = Number(entry?.percentage);
    if (!versionId) throw new Error(`Deployment traffic entry ${index + 1} is missing version_id.`);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Deployment traffic entry ${index + 1} has an invalid percentage.`);
    }
    return { versionId, percentage };
  });
}

export function verifyRollbackDeployment(deployment, expectedVersionId) {
  const expectedId = String(expectedVersionId || '');
  if (!expectedId) throw new Error('Expected rollback version ID is required.');

  const traffic = normalizedTrafficVersions(deployment);
  const active = traffic.filter(entry => entry.percentage > EPSILON);
  const totalPercentage = traffic.reduce((sum, entry) => sum + entry.percentage, 0);
  const expected = active.find(entry => entry.versionId === expectedId);

  if (Math.abs(totalPercentage - 100) > EPSILON) {
    throw new Error(`Cloudflare deployment traffic must total 100%; got ${totalPercentage}%.`);
  }
  if (!expected) {
    throw new Error(`Rollback target ${expectedId} is not serving production traffic.`);
  }
  if (Math.abs(expected.percentage - 100) > EPSILON || active.length !== 1) {
    const allocation = active.map(entry => `${entry.versionId}@${entry.percentage}%`).join(', ');
    throw new Error(`Rollback target ${expectedId} must serve 100% of production traffic; current allocation: ${allocation || 'none'}.`);
  }

  return {
    ok: true,
    deploymentId: typeof deployment.id === 'string' ? deployment.id : '',
    versionId: expected.versionId,
    percentage: expected.percentage,
  };
}

function main() {
  const [statusPath, expectedVersionId] = process.argv.slice(2);
  if (!statusPath || !expectedVersionId) {
    throw new Error('Usage: node scripts/verify-rollback-deployment.js <deployment-status-json> <version-id>');
  }

  const deployment = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const result = verifyRollbackDeployment(deployment, expectedVersionId);
  console.log(`Verified rollback deployment ${result.deploymentId || 'unknown'}: ${result.versionId}@${result.percentage}%.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
