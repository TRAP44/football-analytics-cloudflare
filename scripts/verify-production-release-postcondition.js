import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cloudflareVersionIdValid, validateReleaseIdentity } from '../src/release-identity.js';
import { assertSameScriptContent, settingsOnlyVersion, versionHasReleaseStamp } from './cloudflare-settings-version.js';

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

function stampedVersionIdentity(version, versionId, label = 'Active production version') {
  const actualMessage = typeof version.annotations?.['workers/message'] === 'string'
    ? version.annotations['workers/message'].trim() : '';
  const actualTag = typeof version.annotations?.['workers/tag'] === 'string'
    ? version.annotations['workers/tag'].trim() : '';
  const match = /^release=([^\s]+) sha=([0-9a-f]{40})$/i.exec(actualMessage);
  if (!match || !RELEASE_RE.test(match[1]) || !SHA_RE.test(match[2])) {
    throw new Error(`${label} ${versionId} release identity mismatch.`);
  }
  const messageSha = match[2].toLowerCase();
  if (!SHA_RE.test(actualTag) || actualTag.toLowerCase() !== messageSha) {
    throw new Error(`${label} ${versionId} version tag does not match deploy SHA.`);
  }

  const rcNumber = /-rc([0-9]+)$/i.exec(match[1])?.[1] || '';
  const validation = validateReleaseIdentity({
    appVersion: match[1],
    releaseCandidate: `RC${rcNumber}`,
    deploySha: messageSha,
    cloudflareVersionId: versionId,
    cloudflareVersionTag: actualTag,
    cloudflareVersionTimestamp: version.metadata?.created_on,
  });
  if (!validation.ok) {
    throw new Error(`${label} ${versionId} release identity validation failed: ${validation.code}.`);
  }
  return {
    release: match[1],
    sha: messageSha,
    tag: actualTag.toLowerCase(),
    timestamp: new Date(validation.timestampMs).toISOString(),
  };
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
  const identity = stampedVersionIdentity(activeVersion, activeVersionId);

  return {
    deploymentId: typeof deployment.id === 'string' ? deployment.id : '',
    versionId: activeVersionId,
    ...identity,
  };
}

// Задача 0. Сколько подряд правок секретов поверх одной версии CI допускаем.
// `wrangler deployments list` отдаёт последние 10 деплоев.
const MAX_SETTINGS_CHAIN = 9;

function sameId(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

function deploymentHistory(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error('Cloudflare deployment history must be a non-empty JSON array.');
  }
  return deployments.map((entry, index) => {
    const createdMs = Date.parse(typeof entry?.created_on === 'string' ? entry.created_on : '');
    if (!Number.isFinite(createdMs)) throw new Error(`Deployment history entry ${index + 1} has an invalid created_on.`);
    return { entry, createdMs };
  }).sort((a, b) => b.createdMs - a.createdMs).map(item => item.entry);
}

function settingsOnlyActiveVersion(deployment, activeVersion) {
  const activeVersionId = activeProductionVersion(deployment);
  if (!activeVersion || typeof activeVersion !== 'object' || Array.isArray(activeVersion) || !sameId(activeVersion.id, activeVersionId)) {
    throw new Error(`Cloudflare version details do not describe active production version ${activeVersionId}.`);
  }
  if (!settingsOnlyVersion(activeVersion)) {
    throw new Error(`Active production version ${activeVersionId} has no CI release stamp and was not created by a secret change.`);
  }
  return activeVersionId;
}

// Ищет версию CI, из кода которой создана активная версия «после правки
// секрета»: идём по истории деплоев назад, пока перед нами версии, созданные
// только правкой секрета. Первая версия с отметкой CI — основа. Всё прочее
// (смешанный трафик, загрузка без отметки, пропуск в истории) — отказ.
export function resolveSettingsBaseVersionId(deployment, activeVersion, deployments, versionList) {
  const activeVersionId = settingsOnlyActiveVersion(deployment, activeVersion);
  const history = deploymentHistory(deployments);
  const latest = history[0];
  if (!sameId(activeProductionVersion(latest), activeVersionId)) {
    throw new Error('Latest deployment in Cloudflare history does not serve the active production version.');
  }
  if (typeof deployment.id === 'string' && deployment.id && !sameId(latest?.id, deployment.id)) {
    throw new Error('Latest deployment in Cloudflare history does not match deployment status.');
  }
  if (!Array.isArray(versionList)) throw new Error('Cloudflare versions list must be a JSON array.');
  const versionsById = new Map();
  for (const version of [activeVersion, ...versionList]) {
    if (!version || typeof version !== 'object' || typeof version.id !== 'string') continue;
    versionsById.set(version.id.toLowerCase(), version);
  }

  let current = activeVersionId;
  for (let index = 1; index < history.length && index <= MAX_SETTINGS_CHAIN; index += 1) {
    const previousId = activeProductionVersion(history[index]);
    if (sameId(previousId, current)) continue;
    const details = versionsById.get(previousId.toLowerCase());
    if (!details) {
      throw new Error(`Version ${previousId} from deployment history is missing from the Cloudflare versions list.`);
    }
    if (versionHasReleaseStamp(details)) return previousId;
    if (!settingsOnlyVersion(details)) {
      throw new Error(`Version ${previousId} in deployment history has no CI release stamp and was not created by a secret change.`);
    }
    current = previousId;
  }
  throw new Error('No CI-stamped version found in recent deployment history before the settings-only production version.');
}

export function resolveSettingsOnlyProductionIdentity(deployment, activeVersion, deployments, versionList, baseVersion) {
  const baseVersionId = resolveSettingsBaseVersionId(deployment, activeVersion, deployments, versionList);
  if (!baseVersion || typeof baseVersion !== 'object' || Array.isArray(baseVersion) || !sameId(baseVersion.id, baseVersionId)) {
    throw new Error(`Cloudflare version details do not describe CI-stamped base version ${baseVersionId}.`);
  }
  const base = stampedVersionIdentity(baseVersion, baseVersionId, 'CI-stamped base version');
  assertSameScriptContent(activeVersion, baseVersion);
  return {
    deploymentId: typeof deployment.id === 'string' ? deployment.id : '',
    versionId: activeVersion.id,
    release: base.release,
    sha: base.sha,
    baseVersionId,
    settingsOnly: true,
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
  if (versionsPath === '--print-settings-base-version-id' || versionsPath === '--print-settings-rollback-target') {
    const [activePath, deploymentsPath, versionListPath, basePath] = process.argv.slice(4);
    const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
    if (!activePath || !deploymentsPath || !versionListPath) {
      throw new Error(`Usage: node scripts/verify-production-release-postcondition.js <deployment-json> ${versionsPath} <active-version-json> <deployments-json> <versions-list-json>${versionsPath === '--print-settings-rollback-target' ? ' <base-version-json>' : ''}`);
    }
    if (versionsPath === '--print-settings-base-version-id') {
      console.log(resolveSettingsBaseVersionId(deployment, readJson(activePath), readJson(deploymentsPath), readJson(versionListPath)));
      return;
    }
    if (!basePath) throw new Error('Settings-only rollback target requires the CI-stamped base version JSON.');
    const active = resolveSettingsOnlyProductionIdentity(deployment, readJson(activePath), readJson(deploymentsPath), readJson(versionListPath), readJson(basePath));
    console.log(`${active.versionId} ${active.release} ${active.sha} ${active.baseVersionId}`);
    return;
  }
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
