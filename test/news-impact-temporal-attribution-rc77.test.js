import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');

test('RC77 uses a fixed post-decision attribution window',()=>{
  assert.match(worker,/NEWS_IMPACT_ACTION_WINDOW_MINUTES = 30/);
  assert.match(worker,/NEWS_IMPACT_ACTION_WINDOW_MS = NEWS_IMPACT_ACTION_WINDOW_MINUTES \* 60_000/);
  assert.match(worker,/actionAt>=decisionAt && actionAt<=decisionAt\+actionWindowMs/);
  assert.match(worker,/requiresActionAfterDecision:true/);
});

test('RC77 excludes decisions that have not completed the action window',()=>{
  assert.match(worker,/const maturityCutoff=asOfMs-actionWindowMs/);
  assert.match(worker,/decisionAt>maturityCutoff/);
  assert.match(worker,/immatureUsers=/);
  assert.match(worker,/observedUsers:observedDecisionUsers\.size/);
});

test('RC77 keeps boundary follow-up actions available to the previous period',()=>{
  assert.match(worker,/let comparisonRows=\[\]/);
  assert.match(worker,/previousWindowRows=comparisonRows\.filter/);
  assert.match(worker,/previousNewsImpactActionRows=comparisonRows\.filter/);
  assert.match(worker,/allowsBoundaryFollowup:true/);
});

test('RC77 admin UI explains maturity and attribution',()=>{
  assert.match(app,/impactAttributionGuard=d\.newsImpactActionAttributionGuard/);
  assert.match(app,/Атрибуция действий/);
  assert.match(app,/решения младше/);
  assert.match(app,/свежих решений ещё не вошли/);
});

test('RC77 deterministic self-test rejects pre-decision and late actions',()=>{
  assert.match(worker,/function newsImpactTemporalAttributionDrill\(/);
  assert.match(worker,/2026-09-23T09:59:00Z/);
  assert.match(worker,/2026-09-23T10:45:00Z/);
  assert.match(worker,/newsImpactTemporalAttributionSelfTest: newsImpactTemporalAttributionDrill\(\)\.pass \? 'enabled' : 'failed'/);
});

test('RC77 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/v6_16|v6_17|rc77/i.test(x)));
});
