import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectMergedPullRequest, fetchAssociatedPullRequests, verifyMainPrProvenance } from '../scripts/verify-main-pr-provenance.js';

const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');

test('RC111 verifies the checked-out revision is exactly DEPLOY_SHA',()=>{
  assert.match(workflow,/RC111 verify deployment provenance/);
  assert.match(workflow,/VERIFIED_SHA="\$\(git rev-parse HEAD\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$VERIFIED_SHA" \]\]/);
  assert.match(workflow,/Production provenance check failed/);
  assert.match(workflow,/does not match checked-out revision/);
});

test('RC111 retains the current-main race guard before deploy',()=>{
  assert.match(workflow,/CURRENT_MAIN_SHA="\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow,/\[\[ "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]/);
  assert.match(workflow,/Stale production deploy blocked/);
  assert.match(workflow,/Checked-out SHA and current main both match deploy SHA/);
});


test('RC111 deploys a verified merged-PR snapshot even when newer runtime main changes are pending',()=>{
  assert.match(workflow,/git merge-base --is-ancestor "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/git diff --name-only "\$DEPLOY_SHA" "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/test\/\*\|docs\/\*\|\*\.md/);
  assert.match(workflow,/Verified release snapshot accepted/);
  assert.match(workflow,/newer unverified production-relevant main changes remain pending/);
  assert.match(workflow,/UNSAFE_MAIN_DRIFT/);
});

test('RC111 keeps manual production deploy pinned to current main when runtime drift exists',()=>{
  assert.match(workflow,/GITHUB_EVENT_NAME.*workflow_dispatch/);
  assert.match(workflow,/Manual deploy requires current main when production-relevant drift exists/);
  assert.match(workflow,/Stale production deploy blocked/);
});


test('production deploy accepts merged-PR provenance or an exact successful Quality run on current main',()=>{
  assert.match(workflow,/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/);
  assert.match(workflow,/P1 gate: verify production deploy provenance/);
  assert.match(workflow,/github\.event\.workflow_run\.name/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion/);
  assert.match(workflow,/\$DEPLOY_SHA.*\$CURRENT_MAIN_SHA/);
  assert.match(workflow,/Direct-main production provenance verified/);
});


test('production provenance still fails closed for unverified or stale direct-main revisions',()=>{
  assert.match(workflow,/has neither merged-PR provenance nor an exact successful Quality run on current main/);
  assert.match(workflow,/exit 1/);
});


const REPOSITORY='TRAP44/football-analytics-cloudflare';
const COMMIT_SHA='0123456789abcdef0123456789abcdef01234567';
const MERGED_PULL={
  number:42,
  state:'closed',
  merged_at:'2026-10-01T12:00:00.000Z',
  base:{ref:'main',repo:{full_name:REPOSITORY}},
};

test('merged PR selector rejects open, unmerged, wrong-branch and cross-repository evidence',()=>{
  const invalid=[
    {...MERGED_PULL,state:'open'},
    {...MERGED_PULL,merged_at:null},
    {...MERGED_PULL,base:{...MERGED_PULL.base,ref:'staging'}},
    {...MERGED_PULL,base:{...MERGED_PULL.base,repo:{full_name:'other/repository'}}},
    {...MERGED_PULL,number:'42'},
  ];
  assert.equal(selectMergedPullRequest(invalid,'main',REPOSITORY),null);
  assert.deepEqual(selectMergedPullRequest([...invalid,MERGED_PULL],'main',REPOSITORY),MERGED_PULL);
  assert.equal(selectMergedPullRequest({},'main',REPOSITORY),null);
});

test('PR provenance lookup validates repository, SHA and token before making any request',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls+=1;throw new Error('Unexpected network call');};
  for(const [repository,sha,token,pattern] of [
    ['not-a-repository',COMMIT_SHA,'secret',/owner\/name/],
    [REPOSITORY,'short-sha','secret',/40-character commit SHA/],
    [REPOSITORY,COMMIT_SHA,'',/GITHUB_TOKEN is required/],
  ]) {
    await assert.rejects(
      fetchAssociatedPullRequests({repository,sha,token,fetchImpl}),
      pattern,
    );
  }
  assert.equal(calls,0);
});

test('PR provenance lookup uses the exact commit-associated endpoint and fails closed on bad responses',async()=>{
  let request=null;
  const pulls=await fetchAssociatedPullRequests({
    repository:REPOSITORY,
    sha:COMMIT_SHA,
    token:'test-token',
    fetchImpl:async(url,options)=>{
      request={url,options};
      return {ok:true,status:200,json:async()=>[MERGED_PULL]};
    },
  });
  assert.deepEqual(pulls,[MERGED_PULL]);
  assert.equal(request.url,
    'https://api.github.com/repos/'+REPOSITORY+'/commits/'+COMMIT_SHA+'/pulls');
  assert.equal(request.options.headers.Authorization,'Bearer test-token');
  assert.equal(request.options.headers.Accept,'application/vnd.github+json');
  assert.ok(request.options.signal,'Lookup must have an abort deadline');

  await assert.rejects(
    fetchAssociatedPullRequests({
      repository:REPOSITORY,sha:COMMIT_SHA,token:'test-token',
      fetchImpl:async()=>({ok:false,status:403}),
    }),
    /provenance lookup failed with HTTP 403/,
  );
  await assert.rejects(
    fetchAssociatedPullRequests({
      repository:REPOSITORY,sha:COMMIT_SHA,token:'test-token',
      fetchImpl:async()=>({ok:true,json:async()=>({not:'a list'})}),
    }),
    /returned an invalid payload/,
  );
});

test('production PR provenance accepts a genuine merged PR only for the target repository and branch',async()=>{
  const verify=(items)=>verifyMainPrProvenance({
    repository:REPOSITORY,
    sha:COMMIT_SHA,
    token:'test-token',
    fetchImpl:async()=>({ok:true,json:async()=>items}),
  });
  assert.deepEqual(await verify([MERGED_PULL]),MERGED_PULL);
  for(const pull of [
    {...MERGED_PULL,state:'open'},
    {...MERGED_PULL,merged_at:null},
    {...MERGED_PULL,base:{ref:'staging',repo:{full_name:REPOSITORY}}},
    {...MERGED_PULL,base:{ref:'main',repo:{full_name:'attacker/repo'}}},
  ]) {
    await assert.rejects(
      verify([pull]),
      /not associated with a merged PR into main/,
    );
  }
});

test('direct-main provenance bypass stays limited to exact successful Quality runs on current main',()=>{
  assert.match(workflow,/GITHUB_EVENT_NAME" == "workflow_run"/);
  assert.match(workflow,/github\.event\.workflow_run\.name \}\}" == "Quality"/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion \}\}" == "success"/);
  assert.match(workflow,/"\$DEPLOY_SHA" == "\$CURRENT_MAIN_SHA"/);
  assert.match(workflow,/Production deploy blocked:[\s\S]*neither merged-PR provenance nor an exact successful Quality run/);
});
