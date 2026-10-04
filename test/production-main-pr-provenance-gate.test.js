import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  fetchAssociatedPullRequests,
  selectMergedPullRequest,
  verifyMainPrProvenance,
} from '../scripts/verify-main-pr-provenance.js';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/deploy-production.yml', import.meta.url),
  'utf8',
);

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test('selectMergedPullRequest accepts only a merged PR into main', () => {
  const pull = selectMergedPullRequest([
    { number: 10, state: 'open', merged_at: null, base: { ref: 'main' } },
    { number: 11, state: 'closed', merged_at: '2026-10-04T00:00:00Z', base: { ref: 'develop' } },
    { number: 12, state: 'closed', merged_at: '2026-10-04T00:01:00Z', base: { ref: 'main' } },
  ]);
  assert.equal(pull?.number, 12);
});

test('verifyMainPrProvenance rejects a direct-push commit with no associated PR', async () => {
  await assert.rejects(
    verifyMainPrProvenance({
      repository: 'TRAP44/football-analytics-cloudflare',
      sha: 'a'.repeat(40),
      token: 'test-token',
      fetchImpl: async () => response([]),
    }),
    /not associated with a merged PR into main/,
  );
});

test('verifyMainPrProvenance rejects PRs merged into a different base branch', async () => {
  await assert.rejects(
    verifyMainPrProvenance({
      repository: 'TRAP44/football-analytics-cloudflare',
      sha: 'b'.repeat(40),
      token: 'test-token',
      fetchImpl: async () => response([
        {
          number: 99,
          state: 'closed',
          merged_at: '2026-10-04T00:00:00Z',
          base: { ref: 'release' },
        },
      ]),
    }),
    /not associated with a merged PR into main/,
  );
});

test('GitHub provenance lookup fails closed on API failure', async () => {
  await assert.rejects(
    fetchAssociatedPullRequests({
      repository: 'TRAP44/football-analytics-cloudflare',
      sha: 'c'.repeat(40),
      token: 'test-token',
      fetchImpl: async () => response({}, { ok: false, status: 503 }),
    }),
    /HTTP 503/,
  );
});

test('production workflow enforces merged-PR provenance before Cloudflare work', () => {
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /P1 gate: require merged PR provenance for production deploy/);
  assert.match(
    workflow,
    /node scripts\/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/,
  );

  const provenance = workflow.indexOf(
    'P1 gate: require merged PR provenance for production deploy',
  );
  const credentials = workflow.indexOf('- name: Check Cloudflare credentials');
  const deployWorker = workflow.indexOf('- name: Deploy Worker');
  assert.ok(provenance >= 0);
  assert.ok(credentials > provenance);
  assert.ok(deployWorker > credentials);
});
