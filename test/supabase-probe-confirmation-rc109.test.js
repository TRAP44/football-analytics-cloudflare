import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-diagnostics.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

test('RC109 combines Supabase probe attempts with fail-closed confirmation semantics',()=>{
  assert.match(worker,/function combineSupabaseProbeAttempts/);
  assert.match(worker,/attempts:1/);
  assert.match(worker,/attempts:2/);
  assert.match(worker,/recovered:true/);
  assert.match(worker,/confirmedFailure:true/);
  assert.match(worker,/function supabaseProbeConfirmationSelfTest/);
  assert.match(worker,/recovered\.ok && recovered\.attempts===2 && recovered\.recovered/);
  assert.match(worker,/!confirmed\.ok && confirmed\.attempts===2 && confirmed\.confirmedFailure/);
});

test('RC109 retries only after an initial configured Supabase failure',()=>{
  const start=worker.indexOf('async function probeSupabaseConfirmed');
  const end=worker.indexOf('\nfunction supabaseProbeConfirmationSelfTest',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/const first=await probeSupabase\(cfg\)/);
  assert.match(block,/if \(first\.ok \|\| !first\.configured\) return combineSupabaseProbeAttempts\(first\)/);
  assert.match(block,/retryDelayMs.*250/);
  assert.match(block,/const second=await probeSupabase\(cfg\)/);
  assert.match(block,/supabaseProbeRecoveries/);
  assert.match(block,/supabaseProbeConfirmedFailures/);
});

test('RC109 diagnostics and production monitor use confirmed Supabase probes',()=>{
  const diagnostics=worker.slice(worker.indexOf('async function collectDiagnostics'),worker.indexOf('const CLIENT_TELEMETRY_EVENTS'));
  const monitor=worker.slice(worker.indexOf('async function runProductionMonitor'),worker.indexOf('async function apiProductionMonitor'));
  assert.match(diagnostics,/probeSupabaseConfirmed\(cfg\)/);
  assert.doesNotMatch(diagnostics,/\n\s*probeSupabase\(cfg\),/);
  assert.match(monitor,/probeSupabaseConfirmed\(cfg\)/);
  assert.match(monitor,/supabaseProbeAttempts/);
  assert.match(monitor,/supabaseProbeRecovered/);
  assert.match(monitor,/supabaseProbeConfirmedFailure/);
});

test('RC109 records transient recovery separately from an incident',()=>{
  assert.match(worker,/eventType:'supabase_probe'/);
  assert.match(worker,/code:'SUPABASE_PROBE_RECOVERED'/);
  assert.match(worker,/Initial Supabase probe failed but the confirmation probe succeeded/);
  assert.match(worker,/supabase\.recovered/);
});

test('RC109 release and production gates require the confirmation guard',()=>{
  assert.match(worker,/releaseCheck\('supabase_probe_confirmation'/);
  assert.match(worker,/productionCheck\('supabase_probe_confirmation'/);
  assert.match(worker,/supabaseProbeConfirmation: 'enabled'/);
  assert.match(worker,/supabaseProbeConfirmationSelfTest: supabaseProbeConfirmationSelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(smoke,/'supabaseProbeConfirmation'/);
  assert.match(smoke,/'supabaseProbeConfirmationSelfTest'/);
});

test('RC109 admin diagnostics expose retries and recoveries',()=>{
  assert.match(app,/Подтверждение Supabase probe/);
  assert.match(app,/supabaseProbeRecoveries/);
  assert.match(app,/supabaseProbeConfirmedFailures/);
  assert.match(app,/db\.attempts/);
  assert.match(app,/db\.recovered/);
});
