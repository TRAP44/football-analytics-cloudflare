const SHA_RE = /^[0-9a-f]{40}$/i;

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

export function runtimeReleaseIdentity(metadata, { appVersion = '', releaseCandidate = '' } = {}) {
  const versionId = clean(metadata?.id, 80);
  const versionTag = clean(metadata?.tag, 120);
  const rawTimestamp = clean(metadata?.timestamp, 80);
  const timestamp = Number.isFinite(Date.parse(rawTimestamp)) ? new Date(rawTimestamp).toISOString() : null;
  const deploySha = SHA_RE.test(versionTag) ? versionTag.toLowerCase() : null;

  return {
    appVersion: clean(appVersion, 80),
    releaseCandidate: clean(releaseCandidate, 40),
    deploySha,
    cloudflareVersionId: versionId || null,
    cloudflareVersionTag: versionTag || null,
    cloudflareVersionTimestamp: timestamp,
  };
}

export function releaseIdentityComplete(identity = {}) {
  return Boolean(
    SHA_RE.test(String(identity.deploySha || ''))
    && String(identity.cloudflareVersionId || '').trim()
    && String(identity.cloudflareVersionTag || '').toLowerCase() === String(identity.deploySha || '').toLowerCase()
    && Number.isFinite(Date.parse(String(identity.cloudflareVersionTimestamp || '')))
  );
}
