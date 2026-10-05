import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeQuotaDecision,
  parseAnalyzeRequest,
} from '../src/api-analyze-preflight.js';

test('analyze request preflight normalizes valid request fields', () => {
  const parsed = parseAnalyzeRequest({
    fixtureId: '12345',
    origin: 'telegram_quick',
    recheck: true,
    newsImpactRecheck: true,
  });

  assert.deepEqual(parsed, {
    fixtureId: 12345,
    validFixtureId: true,
    origin: 'telegram_quick',
    recheckRequested: true,
    newsImpactRecheck: true,
  });
});

test('analyze request preflight rejects invalid fixture ids behaviorally', () => {
  for (const fixtureId of [0, -1, 'abc', null, undefined]) {
    const parsed = parseAnalyzeRequest({ fixtureId });
    assert.equal(parsed.validFixtureId, false);
  }
});

test('quota preflight allows normal quota, free recheck and pass access', () => {
  assert.equal(analyzeQuotaDecision({ left: 1 }, {}).allowed, true);
  assert.equal(analyzeQuotaDecision({ left: 0 }, { freeRecheck: true }).allowed, true);
  assert.equal(analyzeQuotaDecision({ left: 0 }, { passCandidate: true }).allowed, true);
});

test('quota preflight returns the same 429 contract when quota is exhausted', () => {
  const decision = analyzeQuotaDecision(
    { left: 0, used: 5, limit: 5 },
    { freeRecheck: false, passCandidate: false },
  );

  assert.deepEqual(decision, {
    allowed: false,
    status: 429,
    reason: 'quota_exhausted',
    message: 'Лимит исчерпан: 5/5 анализов сегодня.',
  });
});
