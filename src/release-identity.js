const SHA_RE = /^[0-9a-f]{40}$/i;
const CLOUDFLARE_VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)-rc([0-9]+)$/i;
const RELEASE_CANDIDATE_RE = /^RC([0-9]+)$/;
const STRICT_ISO_UTC_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const DEFAULT_MIN_TIMESTAMP_MS = Date.parse('2020-01-01T00:00:00.000Z');
const DEFAULT_MAX_FUTURE_SKEW_MS = 10 * 60_000;

export const RELEASE_IDENTITY_CODES = Object.freeze({
  VALID: 'RELEASE_IDENTITY_VALID',
  APP_VERSION_REQUIRED: 'RELEASE_IDENTITY_APP_VERSION_REQUIRED',
  APP_VERSION_INVALID: 'RELEASE_IDENTITY_APP_VERSION_INVALID',
  RELEASE_CANDIDATE_REQUIRED: 'RELEASE_IDENTITY_RELEASE_CANDIDATE_REQUIRED',
  RELEASE_CANDIDATE_INVALID: 'RELEASE_IDENTITY_RELEASE_CANDIDATE_INVALID',
  RELEASE_CANDIDATE_MISMATCH: 'RELEASE_IDENTITY_RELEASE_CANDIDATE_MISMATCH',
  DEPLOY_SHA_REQUIRED: 'RELEASE_IDENTITY_DEPLOY_SHA_REQUIRED',
  DEPLOY_SHA_INVALID: 'RELEASE_IDENTITY_DEPLOY_SHA_INVALID',
  CLOUDFLARE_VERSION_ID_REQUIRED: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_REQUIRED',
  CLOUDFLARE_VERSION_ID_INVALID: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_ID_INVALID',
  CLOUDFLARE_VERSION_TAG_REQUIRED: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TAG_REQUIRED',
  CLOUDFLARE_VERSION_TAG_INVALID: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TAG_INVALID',
  CLOUDFLARE_VERSION_TAG_MISMATCH: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TAG_MISMATCH',
  CLOUDFLARE_VERSION_TIMESTAMP_REQUIRED: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_REQUIRED',
  CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT',
  CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM',
  CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW: 'RELEASE_IDENTITY_CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW',
});

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function canonicalIsoUtc(value) {
  const raw = clean(value, 80);
  const match = STRICT_ISO_UTC_RE.exec(raw);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const timestampMs = Date.parse(raw);
  if (!Number.isFinite(timestampMs)) return null;
  const parsed = new Date(timestampMs);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)
  ) return null;
  return parsed.toISOString();
}

export function cloudflareVersionIdValid(value) {
  return CLOUDFLARE_VERSION_ID_RE.test(clean(value, 80));
}

function failure(code, field) {
  return { ok:false, code, field };
}

export function runtimeReleaseIdentity(metadata, { appVersion = '', releaseCandidate = '' } = {}) {
  const versionId = clean(metadata?.id, 80);
  const versionTag = clean(metadata?.tag, 120);
  const rawTimestamp = clean(metadata?.timestamp, 80);
  const timestamp = canonicalIsoUtc(rawTimestamp);
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

export function validateReleaseIdentity(identity = {}, options = {}) {
  const appVersion = clean(identity.appVersion, 80);
  if (!appVersion) return failure(RELEASE_IDENTITY_CODES.APP_VERSION_REQUIRED, 'appVersion');
  const appVersionMatch = APP_VERSION_RE.exec(appVersion);
  if (!appVersionMatch) return failure(RELEASE_IDENTITY_CODES.APP_VERSION_INVALID, 'appVersion');

  const releaseCandidate = clean(identity.releaseCandidate, 40);
  if (!releaseCandidate) return failure(RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_REQUIRED, 'releaseCandidate');
  const releaseCandidateMatch = RELEASE_CANDIDATE_RE.exec(releaseCandidate);
  if (!releaseCandidateMatch) return failure(RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_INVALID, 'releaseCandidate');
  if (releaseCandidateMatch[1] !== appVersionMatch[4]) {
    return failure(RELEASE_IDENTITY_CODES.RELEASE_CANDIDATE_MISMATCH, 'releaseCandidate');
  }

  const deploySha = clean(identity.deploySha, 80);
  if (!deploySha) return failure(RELEASE_IDENTITY_CODES.DEPLOY_SHA_REQUIRED, 'deploySha');
  if (!SHA_RE.test(deploySha)) return failure(RELEASE_IDENTITY_CODES.DEPLOY_SHA_INVALID, 'deploySha');

  const versionId = clean(identity.cloudflareVersionId, 80);
  if (!versionId) return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_REQUIRED, 'cloudflareVersionId');
  if (!cloudflareVersionIdValid(versionId)) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_ID_INVALID, 'cloudflareVersionId');
  }

  const versionTag = clean(identity.cloudflareVersionTag, 120);
  if (!versionTag) return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_REQUIRED, 'cloudflareVersionTag');
  if (!SHA_RE.test(versionTag)) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_INVALID, 'cloudflareVersionTag');
  }
  if (versionTag.toLowerCase() !== deploySha.toLowerCase()) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TAG_MISMATCH, 'cloudflareVersionTag');
  }

  const rawTimestamp = clean(identity.cloudflareVersionTimestamp, 80);
  if (!rawTimestamp) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_REQUIRED, 'cloudflareVersionTimestamp');
  }
  const canonicalTimestamp = canonicalIsoUtc(rawTimestamp);
  if (!canonicalTimestamp) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_INVALID_FORMAT, 'cloudflareVersionTimestamp');
  }

  const timestampMs = Date.parse(canonicalTimestamp);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const minTimestampMs = Number.isFinite(Number(options.minTimestampMs))
    ? Number(options.minTimestampMs)
    : DEFAULT_MIN_TIMESTAMP_MS;
  const maxFutureSkewMs = Math.max(
    0,
    Number.isFinite(Number(options.maxFutureSkewMs))
      ? Number(options.maxFutureSkewMs)
      : DEFAULT_MAX_FUTURE_SKEW_MS,
  );

  if (timestampMs < minTimestampMs) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_BEFORE_MINIMUM, 'cloudflareVersionTimestamp');
  }
  if (timestampMs > nowMs + maxFutureSkewMs) {
    return failure(RELEASE_IDENTITY_CODES.CLOUDFLARE_VERSION_TIMESTAMP_FUTURE_SKEW, 'cloudflareVersionTimestamp');
  }

  return {
    ok:true,
    code:RELEASE_IDENTITY_CODES.VALID,
    field:null,
    timestampMs,
  };
}

export function releaseIdentityComplete(identity = {}, options = {}) {
  return validateReleaseIdentity(identity, options).ok;
}
