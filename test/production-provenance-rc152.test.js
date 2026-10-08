import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectMergedPullRequest } from '../scripts/verify-main-pr-provenance.js';

test('production release keeps merged-PR provenance gate enabled',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  assert.match(workflow,/verify-main-pr-provenance\.js/);
  assert.match(workflow,/DEPLOY_SHA/);
});



test('RC152 provenance gate executes before release rebuild, credentials and deployment',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  const sequence=[
    'Checkout verified revision',
    'RC110 guard against stale production deploy',
    'P1 gate: verify production deploy provenance',
    'Install pinned dependencies',
    'Re-verify release artifact',
    'Check Cloudflare credentials',
    'Detect pending production artifact changes',
    'Deploy Worker',
  ];
  let last=-1;
  for(const step of sequence){
    const index=workflow.indexOf(step);
    assert.ok(index>last,'Incorrect production gate order: '+step);
    last=index;
  }
  assert.match(workflow,/environment: production/);
});

test('RC152 allows direct-main provenance only after a successful exact-SHA Quality run',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  const start=workflow.indexOf('- name: "P1 gate: verify production deploy provenance"');
  const end=workflow.indexOf('- name: Install pinned dependencies',start);
  assert.ok(start>=0 && end>start);
  const block=workflow.slice(start,end);
  assert.match(block,/node scripts\/verify-main-pr-provenance\.js "\$GITHUB_REPOSITORY" "\$DEPLOY_SHA" main/);
  assert.match(block,/GITHUB_EVENT_NAME" == "workflow_run"/);
  assert.match(block,/github\.event\.workflow_run\.name/);
  assert.match(block,/github\.event\.workflow_run\.conclusion/);
  assert.match(block,/"\$DEPLOY_SHA" == "\$CURRENT_MAIN_SHA"/);
  assert.match(block,/Production deploy blocked:[\s\S]*neither merged-PR provenance nor an exact successful Quality run/);
});

test('RC152 manually dispatched deployments reject old commits even when only tests changed',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  const first=workflow.indexOf('- name: RC110 guard against stale production deploy');
  const last=workflow.indexOf('- name: Use Node.js 22',first);
  const section=workflow.slice(first,last);
  const guard=section.indexOf('Manual deploy requires the exact current main SHA');
  const drift=section.indexOf('git diff --name-only "$DEPLOY_SHA" "$CURRENT_MAIN_SHA"');
  assert.ok(guard>0 && drift>guard);
  assert.match(section,/if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "workflow_dispatch" && "\$DEPLOY_SHA" != "\$CURRENT_MAIN_SHA" \]\]; then/);
  assert.match(section.slice(0,drift),/exit 1/);
});

test('RC152 merged PR evidence requires the correct base repo, branch and positive PR number',()=>{
  const repo='TRAP44/football-analytics-cloudflare';
  const pull={
    number:42,state:'closed',merged_at:'2026-10-08T10:00:00Z',
    base:{ref:'main',repo:{full_name:repo}},
  };
  assert.equal(selectMergedPullRequest([pull],'main',repo)?.number,42);
  for(const bad of [
    {...pull,number:0},
    {...pull,number:'42'},
    {...pull,state:'open'},
    {...pull,merged_at:null},
    {...pull,base:{ref:'staging',repo:{full_name:repo}}},
    {...pull,base:{ref:'main',repo:{full_name:'other/repository'}}},
  ]){
    assert.equal(selectMergedPullRequest([bad],'main',repo),null);
  }
});
