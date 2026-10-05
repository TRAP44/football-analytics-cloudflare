import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

test('readiness exposes composite latency without weakening fail-closed dependencies', () => {
  assert.match(worker, /async function measureReadinessCheck\(task\)/);
  assert.match(worker, /measureReadinessCheck\(\(\)=>readCompositeReadiness\(cfg,5\)\)/);
  assert.match(worker, /const ok=Boolean\(composite\.valid && composite\.ok && telegramConfigured\)/);
  assert.match(worker, /latencyMs:Date\.now\(\)-startedAt/);
  assert.match(worker, /latencyMs:compositeCheck\.latencyMs/);
  assert.match(worker, /recentSupabaseAuthFailuresLatencyMs:compositeCheck\.latencyMs/);
  assert.doesNotMatch(
    worker.slice(worker.indexOf('async function computeReadinessSnapshot'), worker.indexOf('async function readinessSnapshot')),
    /probeSupabaseSchemaDriftConfirmed\(cfg\)|readBackendSecurityContract\(cfg\)|readRecentSupabaseAuthFailures\(cfg,5\)/
  );
});


test('readiness uses a lightweight confirmed Supabase probe while diagnostics keep the deep probe', () => {
  const lightweightStart=worker.indexOf('async function probeSupabaseReadiness(cfg)');
  const lightweightEnd=worker.indexOf('async function probeSupabaseReadinessConfirmed',lightweightStart);
  assert.ok(lightweightStart>=0 && lightweightEnd>lightweightStart);
  const lightweight=worker.slice(lightweightStart,lightweightEnd);
  assert.match(lightweight,/analysis_cache/);
  assert.match(lightweight,/select','cache_key'/);
  assert.match(lightweight,/limit','1'/);
  assert.doesNotMatch(lightweight,/count=exact|Prefer: 'count=exact'|order.*expires_at/);

  const confirmedStart=worker.indexOf('async function probeSupabaseReadinessConfirmed');
  const confirmedEnd=worker.indexOf('function supabaseProbeConfirmationSelfTest',confirmedStart);
  assert.ok(confirmedStart>=0 && confirmedEnd>confirmedStart);
  const confirmed=worker.slice(confirmedStart,confirmedEnd);
  assert.match(confirmed,/const first=await probeSupabaseReadiness\(cfg\)/);
  assert.match(confirmed,/const second=await probeSupabaseReadiness\(cfg\)/);
  assert.match(confirmed,/combineSupabaseProbeAttempts/);

  const diagnostics=worker.slice(worker.indexOf('async function collectDiagnostics'),worker.indexOf('const CLIENT_TELEMETRY_EVENTS'));
  assert.match(diagnostics,/probeSupabaseConfirmed\(cfg\)/);
});


test('public readiness adds a bounded completed-result cache without weakening internal readiness checks', () => {
  const health=fs.readFileSync('src/public-health.js','utf8');
  assert.match(worker,/const publicHealthRuntime=createPublicHealthRuntime/);
  assert.match(worker,/computeReadiness:computeReadinessSnapshot/);
  assert.match(health,/PUBLIC_READINESS_CACHE_MS = 15_000/);
  assert.match(health,/if \(inFlight\) return await inFlight/);
  assert.match(health,/current-Number\(cached\.at \|\| 0\) < Math\.max/);
  assert.match(health,/sanitizePublicReadiness/);
});

test('recent Supabase auth failure readiness read filters candidates server-side without weakening local classification', () => {
  const start=worker.indexOf('async function readRecentSupabaseAuthFailures');
  const end=worker.indexOf('async function claimReleaseEvidenceLock',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/authCandidateFilter='\(message\.ilike\.\*HTTP\*401\*,message\.ilike\.\*PGRST303\*,message\.ilike\.\*invalid\*jwt\*,message\.ilike\.\*invalid\*api\*key\*\)'/);
  assert.match(block,/created_at:\`gte\.\$\{since\}\`/);
  assert.match(block,/or:authCandidateFilter/);
  assert.match(block,/limit:100,order:'created_at\.desc',select:'message,created_at'/);
  assert.match(block,/HTTP 401\|PGRST303\|invalid\.\*jwt\|invalid\.\*api\.\?key/i);
});
