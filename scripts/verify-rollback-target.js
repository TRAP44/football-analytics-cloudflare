import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflareVersionIdValid, RELEASE_IDENTITY_CODES } from '../src/release-identity.js';

const RELEASE_MESSAGE_RE = /^release=([0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+) sha=([0-9a-f]{40})$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;

function legacyAllowed(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

export function verifyRollbackTarget(version, expectedVersion, expectedId, allowLegacyUnverified = false, legacyConfirmation = '', expectedSha = '') {
  if (!version || typeof version !== 'object' || Array.isArray(version)) {
    throw new Error('Cloudflare rollback target metadata must be a JSON object.');
  }
  if (!cloudflareVersionIdValid(expectedId) || !cloudflareVersionIdValid(version.id)) {
    throw new Error(`Rollback target release identity validation failed: ${RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_INVALID}.`);
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
    if (expectedSha) {
      if (!SHA_RE.test(String(expectedSha))) {
        throw new Error('Expected rollback deploy SHA must be a 40-character Git commit SHA.');
      }
      if (deploySha.toLowerCase() !== String(expectedSha).toLowerCase()) {
        throw new Error(`Rollback target deploy SHA mismatch: expected ${expectedSha}, metadata reports ${deploySha}.`);
      }
    }
    return { mode: 'stamped', releaseVersion, deploySha: deploySha.toLowerCase() };
  }

  if (!legacyAllowed(allowLegacyUnverified)) {
    throw new Error(
      'Rollback target has no RC116 release identity metadata. Set allow_legacy_unverified=true only after independently verifying a legacy target.'
    );
  }

  const expectedLegacyConfirmation = `LEGACY-UNVERIFIED:${expectedVersion}:${expectedId}`;
  if (legacyConfirmation !== expectedLegacyConfirmation) {
    throw new Error(
      `Legacy rollback override requires exact confirmation ${expectedLegacyConfirmation}.`
    );
  }

  return { mode: 'legacy-unverified', releaseVersion: null, deploySha: null };
}

function main() {
  const [metadataPath, expectedVersion, expectedId, allowLegacyUnverified = 'false', legacyConfirmation = '', expectedSha = ''] = process.argv.slice(2);
  if (!metadataPath || !expectedVersion || !expectedId) {
    throw new Error(
      'Usage: node scripts/verify-rollback-target.js <metadata-json> <expected-version> <version-id> [allow-legacy-unverified] [legacy-confirmation]'
    );
  }

  const version = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const result = verifyRollbackTarget(version, expectedVersion, expectedId, allowLegacyUnverified, legacyConfirmation, expectedSha);
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
