// @ts-check

/**
 * Normalize the minimal request fields that gate the full analysis flow.
 * This module is intentionally side-effect free so the HTTP boundary can be
 * exercised behaviorally without duplicating provider/model internals.
 *
 * @param {unknown} body
 */
export function parseAnalyzeRequest(body) {
  const input = body && typeof body === 'object' ? body : {};
  const fixtureId = Number(input.fixtureId);
  return Object.freeze({
    fixtureId,
    validFixtureId: Number.isFinite(fixtureId) && fixtureId > 0,
    origin: String(input.origin || 'miniapp').slice(0, 30),
    recheckRequested: Boolean(input.recheck),
    newsImpactRecheck: Boolean(input.newsImpactRecheck),
  });
}

/**
 * @param {{left?: number, used?: number, limit?: number}} quota
 * @param {{freeRecheck?: boolean, passCandidate?: boolean}} options
 */
export function analyzeQuotaDecision(quota = {}, { freeRecheck = false, passCandidate = false } = {}) {
  const left = Number(quota.left || 0);
  const allowed = Boolean(freeRecheck || passCandidate || left > 0);
  if (allowed) return Object.freeze({ allowed: true, status: 200, reason: '' });

  const used = Number(quota.used || 0);
  const limit = Number(quota.limit || 0);
  return Object.freeze({
    allowed: false,
    status: 429,
    reason: 'quota_exhausted',
    message: `Лимит исчерпан: ${used}/${limit} анализов сегодня.`,
  });
}
