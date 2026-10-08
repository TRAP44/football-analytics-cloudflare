import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

test('Stars runtime pagination dependencies are defined before billing runtime is created',()=>{
  const maxPages=/\bconst STAR_SYNC_MAX_PAGES\s*=\s*(\d+)\s*;/.exec(worker);
  const pageSize=/\bconst STAR_SYNC_PAGE_SIZE\s*=\s*(\d+)\s*;/.exec(worker);
  assert.ok(maxPages,'STAR_SYNC_MAX_PAGES must be defined in worker composition root');
  assert.ok(pageSize,'STAR_SYNC_PAGE_SIZE must be defined in worker composition root');
  assert.ok(Number(maxPages[1])>=1 && Number(maxPages[1])<=10);
  assert.ok(Number(pageSize[1])>=1 && Number(pageSize[1])<=100);
  assert.match(worker,/createBillingRuntime\(\{[\s\S]*?\bSTAR_SYNC_MAX_PAGES\s*,\s*STAR_SYNC_PAGE_SIZE\s*,/);
});

test('billing plan catalog remains reachable through the actual billing runtime wiring',()=>{
  assert.match(worker,/function billingPlanConfig\(\.\.\.args\) \{ return getBillingRuntime\(\)\.billingPlanConfig\(\.\.\.args\); \}/);
  assert.match(worker,/function apiBillingPlans\(\.\.\.args\) \{ return getBillingApiRuntime\(\)\.apiBillingPlans\(\.\.\.args\); \}/);
});
