import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundJobsDispatchUrl,
  dispatchBackgroundJobs,
  dispatchRepository,
} from '../src/github-dispatch-runtime.js';

const respond = status => async () => new Response(null, { status });

test('dispatch posts workflow_dispatch for main and reports success', async () => {
  let seen;
  const result = await dispatchBackgroundJobs({ githubDispatchToken: 'github_pat_x' }, {
    fetchImpl: async (url, init) => { seen = { url, init }; return new Response(null, { status: 204 }); },
  });
  assert.deepEqual(result, { dispatched: true, reason: '', status: 204 });
  assert.equal(seen.url, backgroundJobsDispatchUrl('TRAP44/football-analytics-cloudflare'));
  assert.equal(seen.init.headers['x-github-api-version'], '2022-11-28');
  assert.equal(seen.init.headers['user-agent'], 'MatchRadar-Background-Jobs');
  assert.equal(seen.init.redirect, 'manual');
  assert.deepEqual(JSON.parse(seen.init.body),{ref:'main',inputs:{settlement_recovery:'off'}});
});

test('dispatch explains failures without throwing or exposing the token', async () => {
  const cfg = { githubDispatchToken: 'github_pat_secret' };
  assert.equal((await dispatchBackgroundJobs({}, { fetchImpl: respond(204) })).reason, 'token_missing');
  assert.equal((await dispatchBackgroundJobs({ githubDispatchToken: 'a b' }, { fetchImpl: respond(204) })).reason, 'token_invalid');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: respond(401) })).reason, 'token_rejected');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: respond(403) })).reason, 'token_rejected');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: respond(404) })).reason, 'workflow_or_repository_not_found');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: respond(422) })).reason, 'dispatch_rejected');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: respond(502) })).reason, 'github_unavailable');
  assert.equal((await dispatchBackgroundJobs(cfg, { fetchImpl: async () => { throw new Error('boom github_pat_secret'); } })).reason, 'network_error');
  const slow = await dispatchBackgroundJobs(cfg, {
    timeoutMs: 5,
    fetchImpl: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  assert.equal(slow.reason, 'timeout');
  for (const value of [slow, await dispatchBackgroundJobs(cfg, { fetchImpl: respond(401) })]) {
    assert.doesNotMatch(JSON.stringify(value), /github_pat_secret/);
  }
});

test('only a plain owner/repo can be targeted', () => {
  assert.equal(dispatchRepository(''), 'TRAP44/football-analytics-cloudflare');
  assert.equal(dispatchRepository('owner/repo.name'), 'owner/repo.name');
  for (const bad of ['owner', 'owner/repo/extra', '../x/y', 'owner/..', 'owner/re po', 'https://api.github.com/x']) {
    assert.equal(dispatchRepository(bad), '', bad);
  }
});


test('GitHub rate limits are distinguished from rejected credentials without retrying a dispatch',async()=>{
  for(const [status,headers] of [[429,{}],[403,{'x-ratelimit-remaining':'0'}],[403,{'retry-after':'30'}]]){
    let calls=0;
    const result=await dispatchBackgroundJobs({githubDispatchToken:'test_token'},{fetchImpl:async()=>{calls++;return new Response(null,{status,headers});}});
    assert.equal(result.reason,'rate_limited');assert.equal(calls,1);
  }
});
