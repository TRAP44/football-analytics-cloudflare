import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('src/worker.js', 'utf8');

for (const [label, code] of [
  ['digest delivery release', 'DIGEST_DELIVERY_RELEASE_FAILED'],
  ['post-match return claim release', 'POST_MATCH_RETURN_CLAIM_RELEASE_FAILED'],
  ['channel publish claim release', 'CHANNEL_PUBLISH_CLAIM_RELEASE_FAILED'],
  ['analysis lock release', 'ANALYSIS_LOCK_RELEASE_FAILED'],
]) {
  test(`${label} failure is observable through critical write ops`, () => {
    assert.match(worker, new RegExp(`code:'${code}'`));
  });
}

test('fail-safe TTL comments remain for retained channel/analysis claims', () => {
  assert.match(worker, /A retained claim is safer than a duplicate channel post; TTL clears it later/);
  assert.match(worker, /TTL is the final safety net if cleanup fails/);
});
