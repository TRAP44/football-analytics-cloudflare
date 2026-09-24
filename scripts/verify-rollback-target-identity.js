import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findWorkersMessage(value) {
  if (!value) return '';

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWorkersMessage(item);
      if (found) return found;
    }
    return '';
  }

  if (typeof value !== 'object') return '';

  if (typeof value['workers/message'] === 'string') return value['workers/message'];
  if (value.annotations && typeof value.annotations === 'object' && typeof value.annotations['workers/message'] === 'string') {
    return value.annotations['workers/message'];
  }

  for (const child of Object.values(value)) {
    const found = findWorkersMessage(child);
    if (found) return found;
  }

  return '';
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function verifyRollbackTargetIdentity(payload, expectedVersion) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Cloudflare version payload must be a JSON object.');
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$/.test(expectedVersion || '')) {
    throw new Error('Expected rollback release version has an invalid format.');
  }

  const message = findWorkersMessage(payload).trim();
  if (!message) {
    throw new Error('Cloudflare version metadata is missing workers/message.');
  }

  const pattern = new RegExp(`^release=${escapeRegex(expectedVersion)} sha=([0-9a-f]{40})$`, 'i');
  const match = message.match(pattern);
  if (!match) {
    throw new Error(`Cloudflare version identity mismatch; expected release=${expectedVersion} sha=<40-hex>.`);
  }

  return {
    release: expectedVersion,
    sha: match[1].toLowerCase(),
    message
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  const [jsonPath, expectedVersion, versionId] = process.argv.slice(2);

  if (!jsonPath || !expectedVersion || !versionId) {
    console.error('Usage: node scripts/verify-rollback-target-identity.js <version-json> <expected-version> <version-id>');
    process.exit(1);
  }

  try {
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const identity = verifyRollbackTargetIdentity(payload, expectedVersion);
    console.log(`RC117 rollback target identity verified: version_id=${versionId} release=${identity.release} sha=${identity.sha}`);
  } catch (error) {
    console.error(`RC117 rollback target identity check failed: ${error?.message || error}`);
    process.exit(1);
  }
}
