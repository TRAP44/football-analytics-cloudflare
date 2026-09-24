import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const deploy=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC126 schema confirmation remains present after later release bumps',()=>{
  assert.match(worker,/function combineSupabaseSchemaProbeAttempts/);
  assert.match(worker,/async function probeSupabaseSchemaDriftConfirmed/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmation'/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmationSelfTest'/);
});
test('RC126 confirms transient schema probe failures before incident',()=>{
  assert.match(worker,/function combineSupabaseSchemaProbeAttempts/);
  assert.match(worker,/async function probeSupabaseSchemaDriftConfirmed/);
  assert.match(worker,/const second = await probeSupabaseSchemaDrift\(cfg\)/);
  assert.match(worker,/combined\.recovered/);
  assert.match(worker,/combined\.confirmedFailure/);
  assert.match(worker,/supabaseSchemaProbeRecoveries/);
  assert.match(worker,/supabaseSchemaProbeConfirmedFailures/);
});

test('RC126 production monitor records transient schema recovery separately',()=>{
  assert.match(worker,/code:'SCHEMA_PROBE_RECOVERED'/);
  assert.match(worker,/schemaProbeAttempts:/);
  assert.match(worker,/schemaProbeRecovered:/);
  assert.match(worker,/schemaProbeConfirmedFailure:/);
  assert.match(worker,/probeSupabaseSchemaDriftConfirmed\(cfg\)/);
});

test('RC126 keeps confirmed drift fail-closed in release and production readiness',()=>{
  assert.match(worker,/function supabaseSchemaProbeConfirmationSelfTest/);
  assert.match(worker,/releaseCheck\('supabase_schema_probe_confirmation'/);
  assert.match(worker,/productionCheck\('supabase_schema_probe_confirmation'/);
  assert.match(worker,/Schema drift: отсутствуют или несовместимы/);
});

test('RC126 exposes and smoke-tests schema confirmation health flags',()=>{
  assert.match(worker,/supabaseSchemaProbeConfirmation: 'enabled'/);
  assert.match(worker,/supabaseSchemaProbeConfirmationSelfTest: supabaseSchemaProbeConfirmationSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmation'/);
  assert.match(smoke,/'supabaseSchemaProbeConfirmationSelfTest'/);
});

test('RC126 confirmation guard coexists with the later RC127 schema migration',()=>{
  assert.equal(fs.existsSync('supabase/migrations/supabase_migration_v6_18.sql'),true);
  assert.equal(fs.existsSync('supabase/baseline/supabase_baseline_v6_18.sql'),true);
});
