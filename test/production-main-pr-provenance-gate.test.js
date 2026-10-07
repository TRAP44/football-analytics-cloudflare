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
    { number: 10, state: 'open', merged_at: null, base: { ref: 'main', repo: { full_name: 'TRAP44/football-analytics-cloudflare' } } },
    { number: 11, state: 'closed', merged_at: '2026-10-04T00:00:00Z', base: { ref: 'develop', repo: { full_name: 'TRAP44/football-analytics-cloudflare' } } },
    { number: 12, state: 'closed', merged_at: '2026-10-04T00:01:00Z', base: { ref: 'main', repo: { full_name: 'TRAP44/football-analytics-cloudflare' } } },
  ], 'main', 'TRAP44/football-analytics-cloudflare');
  assert.equal(pull?.number, 12);
});

test('selectMergedPullRequest rejects same-named branches from another base repository', () => {
  const pull=selectMergedPullRequest([
    {
      number: 13,
      state: 'closed',
      merged_at: '2026-10-04T00:02:00Z',
      base: { ref: 'main', repo: { full_name: 'TRAP44/another-repository' } },
    },
  ], 'main', 'TRAP44/football-analytics-cloudflare');
  assert.equal(pull,null);
});

test('selectMergedPullRequest rejects malformed merge timestamps', () => {
  const pull=selectMergedPullRequest([
    {
      number: 14,
      state: 'closed',
      merged_at: 'not-a-date',
      base: { ref: 'main', repo: { full_name: 'TRAP44/football-analytics-cloudflare' } },
    },
  ], 'main', 'TRAP44/football-analytics-cloudflare');
  assert.equal(pull,null);
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
          base: { ref: 'release', repo: { full_name: 'TRAP44/football-analytics-cloudflare' } },
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

test('production workflow accepts merged-PR provenance or exact successful Quality provenance before Cloudflare work', () => {
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /P1 gate: verify production deploy provenance/);
  assert.match(
    workflow,
    /node scripts\/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/,
  );
  assert.match(workflow,/GITHUB_EVENT_NAME.*workflow_run/);
  assert.match(workflow,/github\.event\.workflow_run\.name.*Quality/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion.*success/);
  assert.match(workflow,/&& "\$DEPLOY_SHA" == "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/Direct-main production provenance verified/);

  const provenance = workflow.indexOf(
    'P1 gate: verify production deploy provenance',
  );
  const credentials = workflow.indexOf('- name: Check Cloudflare credentials');
  const deployWorker = workflow.indexOf('- name: Deploy Worker');
  assert.ok(provenance >= 0);
  assert.ok(credentials > provenance);
  assert.ok(deployWorker > credentials);
});
