import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const publicStatus = fs.readFileSync(new URL('../src/public-status.js', import.meta.url), 'utf8');
const supabaseReadiness = fs.readFileSync(new URL('../src/supabase-readiness-runtime.js', import.meta.url), 'utf8');
const readinessWiring = fs.readFileSync(new URL('../src/provider-readiness-wiring-runtime.js', import.meta.url), 'utf8');

test('readiness exposes composite latency without weakening fail-closed dependencies', () => {
  assert.match(publicStatus, /async function measureReadiness\(task\)/);
  assert.match(publicStatus, /measureReadiness\(\(\) => readCompositeReadiness\(cfg, 5\)\)/);
  assert.match(publicStatus, /const ok = composite\.valid === true && composite\.ok === true && telegramConfigured/);
  assert.match(publicStatus, /latencyMs: Math\.max\(0,endedAt-startedAt\)/);
  assert.match(publicStatus, /latencyMs: compositeCheck\.latencyMs/);
  assert.match(publicStatus, /recentSupabaseAuthFailuresLatencyMs: compositeCheck\.latencyMs/);
  assert.doesNotMatch(publicStatus, /probeSupabaseSchemaDriftConfirmed|readBackendSecurityContract|readRecentSupabaseAuthFailures/);
});

test('readiness uses a lightweight confirmed Supabase probe while diagnostics keep the deep probe', () => {
  const lightweightStart=supabaseReadiness.indexOf('async function probeSupabaseReadiness(cfg)');
  const lightweightEnd=supabaseReadiness.indexOf('async function probeSupabaseReadinessConfirmed',lightweightStart);
  assert.ok(lightweightStart>=0 && lightweightEnd>lightweightStart);
  const lightweight=supabaseReadiness.slice(lightweightStart,lightweightEnd);
  assert.match(lightweight,/analysis_cache/);
  assert.match(lightweight,/searchParams\.set\('select','cache_key'\)/);
  assert.match(lightweight,/searchParams\.set\('limit','1'\)/);
  assert.doesNotMatch(lightweight,/count=exact|expires_at/);

  const confirmedStart=supabaseReadiness.indexOf('async function probeSupabaseReadinessConfirmed');
  const confirmedEnd=supabaseReadiness.indexOf('function supabaseProbeConfirmationSelfTest',confirmedStart);
  const confirmed=supabaseReadiness.slice(confirmedStart,confirmedEnd);
  assert.match(confirmed,/const first=await probeSupabaseReadiness\(cfg\)/);
  assert.match(confirmed,/const second=await probeSupabaseReadiness\(cfg\)/);
  assert.match(confirmed,/combineSupabaseProbeAttempts/);

  assert.match(readinessWiring,/probeSupabaseConfirmed,/);
  assert.match(readinessWiring,/createDiagnosticsRuntime\(\{/);
});
test('public readiness adds a bounded completed-result cache without weakening internal readiness checks', () => {
  const health=fs.readFileSync('src/public-health.js','utf8');
  assert.match(worker,/createPublicHealthRuntime/);
  assert.match(worker,/computeReadiness:.*computeReadinessSnapshot/);
  assert.match(health,/PUBLIC_READINESS_CACHE_MS = 15_000/);
  assert.match(health,/if \(inFlight\) return await inFlight/);
  assert.match(health,/current-Number\(cached\.at \|\| 0\) < Math\.max/);
  assert.match(health,/sanitizePublicReadiness/);
});

test('recent Supabase auth failures come from the composite readiness contract', () => {
  assert.match(publicStatus,/const authFailures = plainObject\(composite\.authFailures\)/);
  assert.match(publicStatus,/recentSupabaseAuthFailures: authFailures\.available === true/);
  assert.match(readinessWiring,/createCompositeReadinessRuntime\(\{/);
  assert.match(readinessWiring,/readinessRpc: 'backend_readiness_contract_v2'/);
});
