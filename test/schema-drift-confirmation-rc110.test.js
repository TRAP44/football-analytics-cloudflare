import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC110 combines schema drift attempts without hiding confirmed drift',()=>{
  assert.match(worker,/function combineSchemaDriftAttempts/);
  assert.match(worker,/attempts:1/);
  assert.match(worker,/attempts:2/);
  assert.match(worker,/recovered:true/);
  assert.match(worker,/confirmedFailure:true/);
  assert.match(worker,/initialMissing/);
  assert.match(worker,/function schemaDriftConfirmationSelfTest/);
  assert.match(worker,/confirmed\.missing\?\.\[0\]==='calibration_transitions'/);
});

test('RC110 retries the full schema contract only after initial drift',()=>{
  const start=worker.indexOf('async function probeSupabaseSchemaDriftConfirmed');
  const end=worker.indexOf('\nfunction schemaDriftConfirmationSelfTest',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/const first=await probeSupabaseSchemaDrift\(cfg\)/);
  assert.match(block,/if \(first\.ok \|\| !hasSupabase\(cfg\)\) return combineSchemaDriftAttempts\(first\)/);
  assert.match(block,/retryDelayMs.*250/);
  assert.match(block,/const second=await probeSupabaseSchemaDrift\(cfg\)/);
  assert.match(block,/schemaDriftProbeRecoveries/);
  assert.match(block,/schemaDriftConfirmedFailures/);
});

test('RC110 production and release paths use confirmed schema drift',()=>{
  const monitor=worker.slice(worker.indexOf('async function runProductionMonitor'),worker.indexOf('async function apiProductionMonitor'));
  const release=worker.slice(worker.indexOf('async function apiReleaseReadiness'),worker.indexOf('function responseJsonSafe'));
  assert.match(monitor,/probeSupabaseSchemaDriftConfirmed\(cfg\)/);
  assert.match(monitor,/schemaProbeAttempts/);
  assert.match(monitor,/schemaProbeRecovered/);
  assert.match(monitor,/schemaProbeConfirmedFailure/);
  assert.match(release,/probeSupabaseSchemaDriftConfirmed\(cfg\)/);
});

test('RC110 records recovered schema probes separately',()=>{
  assert.match(worker,/eventType:'schema_probe'/);
  assert.match(worker,/code:'SUPABASE_SCHEMA_PROBE_RECOVERED'/);
  assert.match(worker,/Initial Supabase schema probe reported drift but the confirmation probe passed/);
});

test('RC110 release production and health gates enforce schema confirmation',()=>{
  assert.match(worker,/releaseCheck\('schema_drift_confirmation'/);
  assert.match(worker,/productionCheck\('schema_drift_confirmation'/);
  assert.match(worker,/schemaDriftConfirmation: 'enabled'/);
  assert.match(worker,/schemaDriftConfirmationSelfTest: schemaDriftConfirmationSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke,/'schemaDriftConfirmation'/);
  assert.match(smoke,/'schemaDriftConfirmationSelfTest'/);
});

test('RC110 admin diagnostics expose schema confirmation telemetry',()=>{
  assert.match(app,/Подтверждение Schema Drift/);
  assert.match(app,/schemaDriftProbeRecoveries/);
  assert.match(app,/schemaDriftConfirmedFailures/);
});
