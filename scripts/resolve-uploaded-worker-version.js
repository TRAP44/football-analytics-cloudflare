import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateReleaseIdentity } from '../src/release-identity.js';

const RELEASE_RE=/^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$/;
const SHA_RE=/^[0-9a-f]{40}$/i;
const VERSION_ID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveUploadedWorkerVersion(versions, expectedRelease, expectedSha) {
  const release=String(expectedRelease || '').trim();
  const sha=String(expectedSha || '').trim().toLowerCase();
  if (!Array.isArray(versions)) throw new Error('Cloudflare versions list must be a JSON array.');
  if (!RELEASE_RE.test(release)) throw new Error('Expected release has an invalid format.');
  if (!SHA_RE.test(sha)) throw new Error('Expected deploy SHA must be a 40-character Git commit SHA.');

  const expectedMessage=`release=${release} sha=${sha}`;
  const matches=versions.filter(version=>
    String(version?.annotations?.['workers/tag'] || '').trim().toLowerCase() === sha
    && String(version?.annotations?.['workers/message'] || '').trim().toLowerCase() === expectedMessage.toLowerCase()
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one uploaded Worker version for release ${release} sha=${sha}; found ${matches.length}.`);
  }

  const version=matches[0];
  const versionId=String(version?.id || '').trim().toLowerCase();
  if (!VERSION_ID_RE.test(versionId)) throw new Error('Uploaded Worker version ID is invalid.');
  const rcNumber=/-rc([0-9]+)$/i.exec(release)?.[1] || '';
  const validation=validateReleaseIdentity({
    appVersion:release,
    releaseCandidate:`RC${rcNumber}`,
    deploySha:sha,
    cloudflareVersionId:versionId,
    cloudflareVersionTag:sha,
    cloudflareVersionTimestamp:version?.metadata?.created_on,
  });
  if (!validation.ok) {
    throw new Error(`Uploaded Worker release identity validation failed: ${validation.code}.`);
  }
  return Object.freeze({
    versionId,
    release,
    sha,
    timestamp:new Date(validation.timestampMs).toISOString(),
  });
}

function main() {
  const [versionsPath, expectedRelease, expectedSha]=process.argv.slice(2);
  if (!versionsPath || !expectedRelease || !expectedSha) {
    throw new Error('Usage: node scripts/resolve-uploaded-worker-version.js <versions-json> <release> <sha>');
  }
  const versions=JSON.parse(fs.readFileSync(versionsPath,'utf8'));
  const result=resolveUploadedWorkerVersion(versions,expectedRelease,expectedSha);
  console.log(result.versionId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode=1;
  }
}
