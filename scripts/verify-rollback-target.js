import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELEASE_MESSAGE_RE = /^release=([0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+) sha=([0-9a-f]{40})$/i;

function legacyAllowed(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

export function verifyRollbackTarget(version, expectedVersion, expectedId, allowLegacyUnverified = false) {
  if (!version || typeof version !== 'object' || Array.isArray(version)) {
    throw new Error('Cloudflare rollback target metadata must be a JSON object.');
  }
  if (version.id !== expectedId) {
    throw new Error(`Cloudflare resolved version ID ${version.id || 'unknown'} instead of requested ${expectedId}.`);
  }

  const message = version.annotations?.['workers/message'];
  const match = RELEASE_MESSAGE_RE.exec(typeof message === 'string' ? message.trim() : '');

  if (match) {
    const [, releaseVersion, deploySha] = match;
    if (releaseVersion !== expectedVersion) {
      throw new Error(`Rollback target release identity mismatch: expected ${expectedVersion}, metadata reports ${releaseVersion}.`);
    }
    return { mode: 'stamped', releaseVersion, deploySha };
  }

  if (!legacyAllowed(allowLegacyUnverified)) {
    throw new Error(
      'Rollback target has no RC116 release identity metadata. Set allow_legacy_unverified=true only after independently verifying a legacy target.'
    );
  }

  return { mode: 'legacy-unverified', releaseVersion: null, deploySha: null };
}

function main() {
  const [metadataPath, expectedVersion, expectedId, allowLegacyUnverified = 'false'] = process.argv.slice(2);
  if (!metadataPath || !expectedVersion || !expectedId) {
    throw new Error(
      'Usage: node scripts/verify-rollback-target.js <metadata-json> <expected-version> <version-id> [allow-legacy-unverified]'
    );
  }

  const version = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const result = verifyRollbackTarget(version, expectedVersion, expectedId, allowLegacyUnverified);
  if (result.mode === 'stamped') {
    console.log(`Verified rollback target release=${result.releaseVersion} sha=${result.deploySha}.`);
  } else {
    console.log('Legacy rollback target accepted only because the explicit unverified override is enabled.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}
