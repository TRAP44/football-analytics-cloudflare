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



test('provenance API lookup rejects malformed GitHub response payloads',async()=>{
  for(const body of [null,{},'merged',true,42]){
    await assert.rejects(
      fetchAssociatedPullRequests({
        repository:'TRAP44/football-analytics-cloudflare',
        sha:'d'.repeat(40),
        token:'test-token',
        fetchImpl:async()=>response(body),
      }),
      /invalid payload/,
    );
  }
});

test('successful provenance requires a positive safe merged PR and refuses unrelated evidence',async()=>{
  const valid={
    number:25,
    state:'closed',
    merged_at:'2026-10-04T14:00:00Z',
    base:{ref:'main',repo:{full_name:'TRAP44/football-analytics-cloudflare'}},
  };
  const verify=items=>verifyMainPrProvenance({
    repository:'TRAP44/football-analytics-cloudflare',sha:'e'.repeat(40),
    token:'test-token',fetchImpl:async()=>response(items),
  });
  assert.equal((await verify([valid])).number,25);
  for(const item of [
    {...valid,number:0},
    {...valid,number:'25'},
    {...valid,number:Number.MAX_SAFE_INTEGER+1},
    {...valid,base:{ref:'main',repo:{full_name:'other/repo'}}},
  ]){
    await assert.rejects(verify([item]),/not associated with a merged PR into main/);
  }
});

test('provenance API sends only the exact commit endpoint with a bounded abort signal',async()=>{
  let observed;
  await fetchAssociatedPullRequests({
    repository:'TRAP44/football-analytics-cloudflare',sha:'f'.repeat(40),token:'test-token',
    fetchImpl:async(url,options)=>{observed={url,options};return response([]);},
  });
  assert.equal(observed.url,
    'https://api.github.com/repos/TRAP44/football-analytics-cloudflare/commits/'+ 'f'.repeat(40) +'/pulls');
  assert.equal(observed.options.headers.Authorization,'Bearer test-token');
  assert.equal(observed.options.headers['X-GitHub-Api-Version'],'2022-11-28');
  assert.ok(observed.options.signal);
});

test('production Quality provenance gate executes before installing deploy credentials',()=>{
  const identity=workflow.indexOf('- name: "P1 gate: verify production deploy provenance"');
  const install=workflow.indexOf('- name: Install pinned dependencies');
  const credentials=workflow.indexOf('- name: Check Cloudflare credentials');
  const deploy=workflow.indexOf('- name: Deploy Worker');
  assert.ok(identity>=0 && install>identity && credentials>install && deploy>credentials);
  assert.match(workflow,/pull-requests: read/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion.*success/);
  assert.match(workflow,/Direct-main production provenance verified/);
});
