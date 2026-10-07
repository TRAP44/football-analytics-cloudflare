import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const RELEASE_TESTS = Object.freeze([
  'test/access-control.test.js',
  'test/analysis-context-runtime-boundaries.test.js',
  'test/analysis-lifecycle-runtime-boundaries.test.js',
  'test/analysis-quality-runtime-boundaries.test.js',
  'test/analysis-runtime-boundaries.test.js',
  'test/availability-quality-rc144.test.js',
  'test/bottom-nav-smoke-startup-retry.test.js',
  'test/competition-integrity-runtime-boundaries.test.js',
  'test/dependency-security-override.test.js',
  'test/deployment-workflow.test.js',
  'test/emergency-security-lockdown.test.js',
  'test/live-match-intelligence-runtime-boundaries.test.js',
  'test/match-center-runtime-boundaries.test.js',
  'test/model-intelligence-runtime-boundaries.test.js',
  'test/one-tap-ai-handoff-rc58.test.js',
  'test/openligadb-events-rc132.test.js',
  'test/operational-orchestration-runtime.test.js',
  'test/ops-release-identity-persistence.test.js',
  'test/post-deploy-smoke.test.js',
  'test/production-deploy-noop-smoke-rc144.test.js',
  'test/production-deploy-provenance-rc111.test.js',
  'test/production-deploy-race-guard-rc110.test.js',
  'test/production-manual-deploy-guard-rc112.test.js',
  'test/production-release-identity-rc116.test.js',
  'test/production-release-postcondition-rc120.test.js',
  'test/provider-data-runtime-boundaries.test.js',
  'test/provider-fixture-runtime-boundaries.test.js',
  'test/provider-launch-capacity-gate.test.js',
  'test/public-health-hardening.test.js',
  'test/public-launch-first-run.test.js',
  'test/public-match-feed-recovery-rc125.test.js',
  'test/public-match-journey-rc123.test.js',
  'test/public-status-runtime-issue490.test.js',
  'test/public-ux-edge-cases.test.js',
  'test/readiness-contract.test.js',
  'test/release-candidate-health-contract.test.js',
  'test/release-identity.test.js',
  'test/release-runtime-identity.test.js',
  'test/security-headers.test.js',
  'test/security-public-traffic-hardening.test.js',
  'test/security-route-registry.test.js',
  'test/security-scan-rc102.test.js',
  'test/starting-xi-player-strength.test.js',
  'test/supabase-integration-ci.test.js',
  'test/telegram-primary-identity-runtime-boundaries.test.js',
  'test/telegram-search-runtime-boundaries.test.js'
]);

const missing = RELEASE_TESTS.filter(file => !fs.existsSync(file));
if (missing.length) {
  console.error('Release test manifest references missing files:');
  for (const file of missing) console.error('- ' + file);
  process.exit(1);
}

console.log(`Running ${RELEASE_TESTS.length} release-critical test files.`);
const result = spawnSync(process.execPath, ['--test', ...RELEASE_TESTS], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
