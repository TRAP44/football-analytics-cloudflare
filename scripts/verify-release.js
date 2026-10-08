import fs from 'node:fs';
import { auditFrontendAssetContract } from './frontend-asset-audit.js';
import { CLIENT_API_CONTRACT, CLIENT_RELEASE_CHANNEL, CLIENT_VERSION, FRONTEND_ASSET_REVISION, SUPABASE_SCHEMA_HINT } from '../public/modules/app-runtime.js';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const releaseContract = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));
function readSourceTree(root, extension='.js') {
  if (!fs.existsSync(root)) return '';
  const out=[];
  const visit=dir => {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=dir+'/'+entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(extension)) out.push(fs.readFileSync(path,'utf8'));
    }
  };
  visit(root);
  return out.join('\n');
}
const worker = readSourceTree('src');
const providerSloIncidents = fs.readFileSync('src/provider-slo-incidents.js','utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const viewChrome = fs.readFileSync('public/modules/view-chrome.js', 'utf8');
const navigationShell = fs.readFileSync('public/modules/navigation-shell.js', 'utf8');
const adminDiagnostics = fs.readFileSync('public/modules/admin-diagnostics.js', 'utf8');
const adminLaunchFunnel = fs.readFileSync('public/modules/admin-launch-funnel.js', 'utf8');
const adminBetaDashboard = fs.readFileSync('public/modules/admin-beta-dashboard.js', 'utf8');
const adminProductionReadiness = fs.readFileSync('public/modules/admin-production-readiness.js', 'utf8');
const adminReleaseReadiness = fs.readFileSync('public/modules/admin-release-readiness.js', 'utf8');
const adminModelQuality = fs.readFileSync('public/modules/admin-model-quality.js', 'utf8');
const adminCalibrationControl = fs.readFileSync('public/modules/admin-calibration-control.js', 'utf8');
const adminModelRemediation = fs.readFileSync('public/modules/admin-model-remediation.js', 'utf8');
const adminRcRegression = fs.readFileSync('public/modules/admin-rc-regression.js', 'utf8');
const adminOverview = fs.readFileSync('public/modules/admin-overview.js', 'utf8');
const betaFeedback = fs.readFileSync('public/modules/beta-feedback.js', 'utf8');
const profileDataCapabilities = fs.readFileSync('public/modules/profile-data-capabilities.js', 'utf8');
const profileAccessState = fs.readFileSync('public/modules/profile-access-state.js', 'utf8');
const profileSummary = fs.readFileSync('public/modules/profile-summary.js', 'utf8');
const journeyState = fs.readFileSync('public/modules/journey-state.js', 'utf8');
const favoriteTeamsRenderer = fs.readFileSync('public/modules/favorite-teams-renderer.js', 'utf8');
const reminderList = fs.readFileSync('public/modules/reminder-list.js', 'utf8');
const myTeamsRenderer = fs.readFileSync('public/modules/my-teams-renderer.js', 'utf8');
const historyRenderer = fs.readFileSync('public/modules/history-renderer.js', 'utf8');
const aiTrackRecordRenderer = fs.readFileSync('public/modules/ai-track-record-renderer.js', 'utf8');
const globalSearchRenderer = fs.readFileSync('public/modules/global-search-renderer.js', 'utf8');
const globalSearchController = fs.readFileSync('public/modules/global-search-controller.js', 'utf8');
const matchCenterController = fs.readFileSync('public/modules/match-center-controller.js', 'utf8');
const analysisController = fs.readFileSync('public/modules/analysis-controller.js', 'utf8');
const launchFunnelFrontend = app + '\n' + adminLaunchFunnel;
const appRuntime = fs.readFileSync('public/modules/app-runtime.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const statusHtml = fs.readFileSync('public/status.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const publicShellStyles = fs.readFileSync('public/styles/public-shell.css', 'utf8');
const premiumUiStyles = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const rollbackWorkflow = fs.readFileSync('.github/workflows/rollback-production.yml', 'utf8');
const rollbackSmoke = fs.readFileSync('scripts/rollback-smoke.js', 'utf8');
const rollbackTargetVerifier = fs.readFileSync('scripts/verify-rollback-target.js', 'utf8');
const rollbackDeploymentVerifier = fs.readFileSync('scripts/verify-rollback-deployment.js', 'utf8');
const productionReleasePostconditionVerifier = fs.readFileSync('scripts/verify-production-release-postcondition.js', 'utf8');
const postDeploySmoke = fs.readFileSync('scripts/post-deploy-smoke.js', 'utf8');
const releaseIdentityModule = fs.readFileSync('src/release-identity.js', 'utf8');
const releaseEventAttributionModule = fs.readFileSync('src/release-event-attribution.js', 'utf8');
const postDeployRegressionModule = fs.readFileSync('src/post-deploy-regression.js', 'utf8');
const postDeployRegressionLifecycleModule = fs.readFileSync('src/post-deploy-regression-lifecycle.js', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
const readme = fs.readFileSync('README_CLOUDFLARE_RU.md', 'utf8');
const qaChecklist = fs.readFileSync('QA_RELEASE_CHECKLIST_RU.md', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');
const failures = [];
const expected = String(releaseContract.runtimeVersion || '');
const runtimeMatch = /^(\d+\.\d+\.\d+)-rc(\d+)$/i.exec(expected);
const expectedRc = runtimeMatch ? `RC${runtimeMatch[2]}` : '';
const expectedChannel = runtimeMatch ? `rc${runtimeMatch[2]}` : '';
const baselinePath = String(releaseContract.freshInstallBaseline || '');
const latestMigrationPath = String(releaseContract.latestMigration || '');
const latestMigrationMatch = /supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(latestMigrationPath);
const latestMigrationVersion = latestMigrationMatch
  ? latestMigrationMatch[1].replaceAll('_','.')
  : '';
const baseline = baselinePath && fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : '';
function regressionContract(path, marker) {
  if (!fs.existsSync(path)) return false;
  return fs.readFileSync(path, 'utf8').includes(marker);
}
const rootSql = fs.readdirSync('.').filter(name => /^supabase_(?:baseline|migration)_.*\.sql$/i.test(name));
if (rootSql.length) failures.push(`Supabase SQL must live under supabase/: ${rootSql.join(', ')}`);


if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock version must match package.json');

if (releaseContract.applicationVersion !== pkg.version) failures.push('release-contract applicationVersion must match package.json');
if (!runtimeMatch || runtimeMatch[1] !== pkg.version) failures.push('release-contract runtimeVersion must be <package.version>-rc<number>');
if (!baselinePath || !fs.existsSync(baselinePath)) failures.push('release-contract freshInstallBaseline must reference an existing file');
if (!latestMigrationPath || !fs.existsSync(latestMigrationPath)) failures.push('release-contract latestMigration must reference an existing file');
if (!latestMigrationVersion) failures.push('release-contract latestMigration must use supabase_migration_v<version>.sql naming');
if (releaseContract.databaseContract?.version !== 2) failures.push('release-contract databaseContract.version must remain 2');
if (releaseContract.databaseContract?.rpc !== 'backend_readiness_contract_v2') failures.push('release-contract databaseContract.rpc must remain backend_readiness_contract_v2');
if (!releaseContract.databaseContract?.compatibleFingerprints?.includes(releaseContract.databaseContract?.fingerprint)) failures.push('release-contract compatibleFingerprints must include the production fingerprint');
if (!releaseContract.databaseContract?.compatibleFingerprints?.includes(releaseContract.databaseContract?.freshInstallFingerprint)) failures.push('release-contract compatibleFingerprints must include the fresh-install fingerprint');
if (releaseContract.databaseContract?.privateContracts?.analysisUsage?.version !== 1) failures.push('release-contract private analysisUsage contract version must remain 1');
if (releaseContract.databaseContract?.privateContracts?.analysisUsage?.readinessField !== 'schema.privateAnalysisUsage') failures.push('release-contract private analysisUsage readiness field must remain schema.privateAnalysisUsage');
if (releaseContract.databaseContract?.privateContracts?.analysisUsage?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_28.sql') failures.push('release-contract private analysisUsage source migration drifted');
if (releaseContract.databaseContract?.runtimeControlAtomicHistory?.version !== 1) failures.push('release-contract runtimeControlAtomicHistory contract version must remain 1');
if (releaseContract.databaseContract?.runtimeControlAtomicHistory?.readinessField !== 'backendSecurity.rule_violations') failures.push('release-contract runtimeControlAtomicHistory readiness field must remain backendSecurity.rule_violations');
if (releaseContract.databaseContract?.runtimeControlAtomicHistory?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_29_1.sql') failures.push('release-contract runtimeControlAtomicHistory source migration drifted');
if (releaseContract.databaseContract?.personalWriteGuards?.version !== 'v2') failures.push('release-contract personalWriteGuards version must remain v2');
if (releaseContract.databaseContract?.personalWriteGuards?.favoritesLimit !== 50) failures.push('release-contract personalWriteGuards favoritesLimit must remain 50');
if (releaseContract.databaseContract?.personalWriteGuards?.favoritePlayersLimit !== 50) failures.push('release-contract personalWriteGuards favoritePlayersLimit must remain 50');
if (releaseContract.databaseContract?.personalWriteGuards?.remindersLimit !== 50) failures.push('release-contract personalWriteGuards remindersLimit must remain 50');
if (releaseContract.databaseContract?.personalWriteGuards?.canonicalReminders !== true) failures.push('release-contract personalWriteGuards canonicalReminders must remain enabled');
if (releaseContract.databaseContract?.personalWriteGuards?.explicitRearm !== true) failures.push('release-contract personalWriteGuards explicitRearm must remain enabled');
if (releaseContract.databaseContract?.personalWriteGuards?.reminderRetentionDays !== 90) failures.push('release-contract personalWriteGuards reminderRetentionDays must remain 90');
if (releaseContract.databaseContract?.personalWriteGuards?.readinessField !== 'schema.personalWriteGuards') failures.push('release-contract personalWriteGuards readiness field drifted');
if (releaseContract.databaseContract?.personalWriteGuards?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_29_2.sql') failures.push('release-contract personalWriteGuards source migration drifted');
if (releaseContract.databaseContract?.providerSloReadBoundary?.version !== 1) failures.push('release-contract providerSloReadBoundary version must remain 1');
if (releaseContract.databaseContract?.providerSloReadBoundary?.volatility !== 'stable') failures.push('release-contract providerSloReadBoundary volatility must remain stable');
if (releaseContract.databaseContract?.providerSloReadBoundary?.implicitUpperBound !== 'statement_timestamp') failures.push('release-contract providerSloReadBoundary implicit upper bound must remain statement_timestamp');
if (releaseContract.databaseContract?.providerSloReadBoundary?.readinessField !== 'backendSecurity.function_violations') failures.push('release-contract providerSloReadBoundary readiness field drifted');
if (releaseContract.databaseContract?.providerSloReadBoundary?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_29_3.sql') failures.push('release-contract providerSloReadBoundary source migration drifted');
if (releaseContract.databaseContract?.sensitiveMutationLeaseFinalization?.version !== 1) failures.push('release-contract sensitiveMutationLeaseFinalization version must remain 1');
if (releaseContract.databaseContract?.sensitiveMutationLeaseFinalization?.activeLeaseRequired !== true) failures.push('release-contract sensitiveMutationLeaseFinalization active lease guard must remain enabled');
if (releaseContract.databaseContract?.sensitiveMutationLeaseFinalization?.readinessField !== 'backendSecurity.function_violations') failures.push('release-contract sensitiveMutationLeaseFinalization readiness field drifted');
if (releaseContract.databaseContract?.sensitiveMutationLeaseFinalization?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_29_11.sql') failures.push('release-contract sensitiveMutationLeaseFinalization source migration drifted');
if (releaseContract.databaseContract?.serviceRolePrivilegeBoundary?.sourceMigration !== 'supabase/migrations/supabase_migration_v6_29_12.sql') failures.push('release-contract serviceRolePrivilegeBoundary source migration drifted');

if (!worker.includes(`const APP_VERSION = '${expected}'`)) failures.push(`Worker version must be ${expected}`);
if (!expectedRc || !worker.includes(`const RC_NAME = '${expectedRc}'`)) failures.push(`Worker RC name must be ${expectedRc || 'derived from runtimeVersion'}`);
if (CLIENT_VERSION !== expected) failures.push(`Client version must be ${expected}`);
if (!expectedChannel || CLIENT_RELEASE_CHANNEL !== expectedChannel) failures.push(`Client release channel must be ${expectedChannel || 'derived from runtimeVersion'}`);
if (!worker.includes(`const API_CONTRACT_VERSION = ${CLIENT_API_CONTRACT};`)) failures.push('Client and worker API contract versions must match');
if (latestMigrationVersion && !SUPABASE_SCHEMA_HINT.includes(`миграции до v${latestMigrationVersion}`)) failures.push('Client Supabase schema hint must match release-contract latestMigration');
if (latestMigrationVersion && !worker.includes(`миграции до v${latestMigrationVersion}`)) failures.push('Worker Supabase schema guidance must match release-contract latestMigration');
for (const finding of auditFrontendAssetContract({
  packageVersion:pkg.version,
  runtimeRevision:FRONTEND_ASSET_REVISION,
  surfaces:{
    public:html,
    admin:adminHtml,
    status:statusHtml,
  },
  headers:staticHeaders,
})) {
  failures.push(`Frontend asset contract: ${finding}`);
}
if (!premiumUiStyles.includes('--mr-touch-target: 44px')) failures.push('Public UI canonical touch-target contract is missing');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_9.sql')) failures.push('Missing v6.9 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_10.sql')) failures.push('Missing v6.10 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_11.sql')) failures.push('Missing v6.11 migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_11_1.sql')) failures.push('Missing v6.11.1 default-ACL migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_12.sql')) failures.push('Missing v6.12 bot-digest migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_13.sql')) failures.push('Missing v6.13 referee-history migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_14.sql')) failures.push('Missing v6.14 persistent-AI-history migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_15.sql')) failures.push('Missing v6.15 media-launch attribution migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_16.sql')) failures.push('Missing v6.16 persistent Telegram dedupe migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_17.sql')) failures.push('Missing v6.17 Telegram dedupe observability migration');
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_18.sql')) failures.push('Missing v6.18 RC127 hardening migration');
if (fs.existsSync('supabase/baseline/supabase_baseline_v6_17.sql')) failures.push('Obsolete v6.17 fresh-install baseline must be removed');
if (!fs.existsSync(baselinePath)) failures.push('Missing unified v6.19 baseline');
if (fs.existsSync('supabase/baseline/supabase_baseline_v6_16.sql')) failures.push('Obsolete v6.16 fresh-install baseline must be removed');
if (fs.existsSync('supabase/baseline/supabase_baseline_v6_15.sql')) failures.push('Obsolete v6.15 fresh-install baseline must be removed');
if (fs.existsSync('supabase/baseline/supabase_baseline_v6_9.sql')) failures.push('Obsolete v6.9 fresh-install baseline must be removed');
if (!fs.existsSync('test/supabase-baseline-rc99.test.js')) failures.push('Missing RC99 Supabase baseline regression test');
for (const marker of [
  'create table if not exists public.model_calibration_transitions',
  'create or replace function public.backend_security_contract()',
  'create or replace function public.backend_default_acl_contract()',
  'create table if not exists public.bot_digest_subscriptions',
  'create table if not exists public.referee_match_history',
  'add column if not exists ai_signal_code',
  'create table if not exists public.growth_events',
  'create table if not exists public.telegram_update_claims',
  'create or replace function public.claim_telegram_update',
  'create or replace function public.telegram_webhook_dedupe_health'
]) {
  if (!baseline.toLowerCase().includes(marker.toLowerCase())) failures.push(`RC99 unified baseline is missing: ${marker}`);
}
if (!fs.existsSync('src/release-identity.js')) failures.push('Missing runtime release identity module');
if (!fs.existsSync('src/release-event-attribution.js')) failures.push('Missing release-scoped ops attribution module');
if (!fs.existsSync('src/post-deploy-regression.js')) failures.push('Missing post-deploy regression module');
if (!fs.existsSync('src/post-deploy-regression-lifecycle.js')) failures.push('Missing post-deploy regression lifecycle module');
if (!postDeployRegressionLifecycleModule.includes('planPostDeployRegressionLifecycle') || !worker.includes('postDeployRegressionLifecycleAction')) failures.push('Post-deploy regression lifecycle is missing');

if (!postDeployRegressionModule.includes('postDeployRegressionReport') || !worker.includes('postDeployRegressionState')) failures.push('Post-deploy 15/30/60 regression monitoring is missing');

if (!releaseEventAttributionModule.includes('scopeOpsEventsToDeployment') || !worker.includes('releaseExcludedPriorDeploymentEvents')) failures.push('Release-scoped incident attribution is missing');

if (!wrangler.includes('"version_metadata"') || !wrangler.includes('"binding": "CF_VERSION_METADATA"')) failures.push('Cloudflare version metadata binding is missing');
if (!worker.includes("runtimeReleaseIdentity") || !releaseIdentityModule.includes("cloudflareVersionId") || !releaseIdentityModule.includes("deploySha")) failures.push('Worker runtime release identity integration is missing');
if (!deployWorkflow.includes('--tag "${{ env.DEPLOY_SHA }}"')) failures.push('Production deploy must tag the Cloudflare version with deploy SHA');
if (!deployWorkflow.includes('EXPECTED_RUNTIME_SHA="$DEPLOY_SHA"') || !deployWorkflow.includes('EXPECTED_RUNTIME_SHA="$ACTIVE_RUNTIME_SHA"') || !deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "$RELEASE_VERSION" "$EXPECTED_RUNTIME_SHA"')) failures.push('Production smoke must verify the exact active runtime SHA');
if (!fs.existsSync('test/production-deploy-noop-smoke-rc144.test.js')) failures.push('Missing no-op production deploy smoke regression test');
if (!deployWorkflow.includes('PRODUCTION_URL: "https://football-analytics-cloudflare.wok-side.workers.dev"') || !deployWorkflow.includes('SMOKE_URL="${CONFIGURED_URL:-${DEPLOYMENT_URL:-$PRODUCTION_URL}}"')) failures.push('No-op production deploy must retain a canonical smoke URL when Worker deploy is skipped');
if (!productionReleasePostconditionVerifier.includes("annotations?.['workers/tag']")) failures.push('Production release verifier must validate the Cloudflare version tag');
if (!fs.existsSync('src/access-control.js')) failures.push('Missing access-control module');
if (!fs.existsSync('scripts/post-deploy-smoke.js')) failures.push('Missing post-deploy smoke test');
if (!fs.existsSync('.github/workflows/deploy-production.yml')) failures.push('Missing production deploy workflow');
if (!fs.existsSync('.github/workflows/rollback-production.yml')) failures.push('Missing production rollback workflow');
if (!rollbackWorkflow.includes('allow_legacy_unverified:')) failures.push('Rollback workflow must keep the legacy target override explicit and default-off');
if (!rollbackWorkflow.includes('scripts/verify-rollback-target.js')) failures.push('Rollback workflow must verify release identity before rollback');
if (!rollbackTargetVerifier.includes("annotations?.['workers/message']")) failures.push('Rollback target verifier must read Cloudflare version release metadata');
if (!fs.existsSync('test/rollback-legacy-confirmation-rc118.test.js')) failures.push('Missing RC118 legacy rollback confirmation regression test');
if (!rollbackWorkflow.includes('legacy_confirm:') || !rollbackWorkflow.includes('LEGACY_CONFIRM: ${{ inputs.legacy_confirm }}')) failures.push('RC118 rollback workflow must collect exact legacy acknowledgement');
if (!rollbackWorkflow.includes('"$ALLOW_LEGACY_UNVERIFIED" "$LEGACY_CONFIRM"')) failures.push('RC118 rollback workflow must pass legacy acknowledgement to the target verifier');
if (!rollbackTargetVerifier.includes('LEGACY-UNVERIFIED:${expectedVersion}:${expectedId}')) failures.push('RC118 verifier must bind legacy acknowledgement to expected release and version ID');
if (!fs.existsSync('test/rollback-deployment-postcondition-rc119.test.js')) failures.push('Missing RC119 rollback deployment postcondition regression test');
if (!rollbackWorkflow.includes('RC119 verify exact rollback deployment target')) failures.push('RC119 exact rollback deployment postcondition gate is missing');
if (!rollbackWorkflow.includes('npx wrangler deployments status --json')) failures.push('RC119 rollback workflow must read current Cloudflare deployment state');
if (!rollbackWorkflow.includes('verify-rollback-deployment.js "$DEPLOYMENT_STATUS_JSON" "$VERSION_ID"')) failures.push('RC119 rollback workflow must verify the requested version ID after mutation');
if (!rollbackDeploymentVerifier.includes('must serve 100% of production traffic')) failures.push('RC119 verifier must require exclusive 100% traffic on the requested rollback version');
if (!fs.existsSync('test/production-release-postcondition-rc120.test.js')) failures.push('Missing RC120 production release postcondition regression test');
if (!deployWorkflow.includes('RC120 verify active production release identity')) failures.push('RC120 production control-plane identity gate is missing');
if (!deployWorkflow.includes('npx wrangler deployments status --json') || !deployWorkflow.includes('npx wrangler versions list --json')) failures.push('RC120 deploy workflow must read active deployment and version metadata');
if (!deployWorkflow.includes('verify-production-release-postcondition.js "$DEPLOYMENT_STATUS_JSON" "$VERSIONS_JSON" "$RELEASE_VERSION" "$DEPLOY_SHA"')) failures.push('RC120 deploy workflow must bind active production identity to release and deploy SHA');
if (!productionReleasePostconditionVerifier.includes('Production deployment must have one version at 100% traffic') || !productionReleasePostconditionVerifier.includes("annotations?.['workers/message']")) failures.push('RC120 verifier must require exclusive traffic and stamped release identity');
if (!fs.existsSync('test/rollback-runtime-parity-rc121.test.js')) failures.push('Missing RC121 rollback runtime parity regression test');
if (!rollbackSmoke.includes("'/api/app-manifest'") || !rollbackSmoke.includes("'/api/public-status'")) failures.push('RC121 rollback smoke must verify restored public release metadata');
if (!rollbackSmoke.includes("'/api/me', '/api/release-readiness', '/api/calibration-control', '/api/launch-funnel'")) failures.push('RC121 rollback smoke must re-verify protected route auth boundaries');
if (!staticHeaders.includes('Content-Security-Policy:')) failures.push('Missing static asset Content-Security-Policy');
if (!staticHeaders.includes("script-src 'self' https://telegram.org")) failures.push('CSP must allow the official Telegram Mini App SDK');
if (!deployWorkflow.includes('exit 1')) failures.push('Production deployment must fail closed without Cloudflare credentials');
if (!deployWorkflow.includes(`RELEASE_VERSION: "${expected}"`)) failures.push('Production deploy must pin the verified release-contract runtime version');
if (!deployWorkflow.includes('--message "release=${{ env.RELEASE_VERSION }} sha=${{ env.DEPLOY_SHA }}"')) failures.push('Production deploy message must bind release version and deploy SHA');
if (!deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "$RELEASE_VERSION" "$EXPECTED_RUNTIME_SHA"')) failures.push('Production smoke must verify the same release identity used for deployment');
if (!wrangler.includes('"/health/*"')) failures.push('All health probes must be routed through the Worker');
if (!/id="adminRoleBadge"[^>]*data-admin-only[^>]*hidden/.test(adminHtml)) failures.push('Admin role badge must use the fail-closed admin-only visibility contract');
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/i.test(styles)) failures.push('Global hidden elements must remain display:none');
if (!app.includes("badge.textContent = admin ? '🔐 Администратор' : '';")) failures.push('Client must clear the admin badge for non-admin users');
if (!app.includes("el.toggleAttribute('inert', !admin)")) failures.push('Admin-only elements must be inert for non-admin users');
if (!/const photoUrl\s*=\s*safeUrl\(\s*typeof user\.photoUrl\s*===\s*'string'\s*\?\s*user\.photoUrl\s*:\s*''\s*\)/.test(profileSummary)) failures.push('profile photo must use type-checked Telegram photoUrl through safeUrl');
if (!styles.includes('.avatar img')) failures.push('Profile avatar image styling is missing');
if (!fs.existsSync('test/user-flow-contract.test.js')) failures.push('Missing user-flow regression test');
if (!fs.existsSync('test/accessibility-navigation.test.js')) failures.push('Missing accessibility navigation regression test');
if (!fs.existsSync('test/navigation-shell.test.js')) failures.push('Missing navigation shell behavioral regression test');
if (!fs.existsSync('test/admin-launch-funnel-extraction.test.js')) failures.push('Missing admin launch funnel extraction regression test');
if (!fs.existsSync('test/admin-beta-dashboard-extraction.test.js')) failures.push('Missing admin beta dashboard extraction regression test');
if (!fs.existsSync('test/admin-production-readiness-extraction.test.js')) failures.push('Missing admin production readiness extraction regression test');
if (!app.includes("import('./modules/admin-production-readiness.js')") || !adminProductionReadiness.includes('export function createAdminProductionReadinessModule')) failures.push('Admin production readiness lazy extraction contract is missing');
if (app.includes('function productionStateLabel') || app.includes('Проверяю объединение запросов') || app.includes('Быстрые сохранённые данные')) failures.push('Admin production readiness implementation leaked back into shared app root');
if (!fs.existsSync('test/admin-release-readiness-extraction.test.js')) failures.push('Missing admin release readiness extraction regression test');
if (!app.includes("import('./modules/admin-release-readiness.js')") || !adminReleaseReadiness.includes('export function createAdminReleaseReadinessModule')) failures.push('Admin release readiness lazy extraction contract is missing');
if (app.includes('function releaseStateLabel') || app.includes('Проверяю обязательные зависимости ядра') || app.includes('class="release-check')) failures.push('Admin release readiness implementation leaked back into shared app root');
if (!fs.existsSync('test/admin-model-quality-extraction.test.js')) failures.push('Missing admin model quality extraction regression test');
if (!app.includes("import('./modules/admin-model-quality.js')") || !adminModelQuality.includes('export function createAdminModelQualityModule')) failures.push('Admin model quality lazy extraction contract is missing');
if (app.includes('function qualityPct(value)') || app.includes('Калибратор вероятностей')) failures.push('Admin model quality implementation leaked back into shared app root');
if (!app.includes('function outcomeShortLabel(key)') || !adminModelRemediation.includes('async function runModelRemediation()')) failures.push('Model quality extraction captured shared logic or remediation boundary is missing');
if (/runCalibrationControlAction|runModelRemediation|\/api\/calibration-control|\/api\/model-remediation/.test(adminModelQuality)) failures.push('Admin model quality module must remain read-only');
if (!fs.existsSync('test/admin-calibration-control-extraction.test.js')) failures.push('Missing admin calibration control extraction regression test');
if (!app.includes("import('./modules/admin-calibration-control.js')") || !adminCalibrationControl.includes('export function createAdminCalibrationControlModule')) failures.push('Admin calibration control lazy extraction contract is missing');
if (app.includes('function calibrationTransitionLabel(action)') || app.includes('Загружаю состояние жизненного цикла')) failures.push('Admin calibration control implementation leaked back into shared app root');
if (!fs.existsSync('test/admin-model-remediation-extraction.test.js')) failures.push('Missing admin model remediation extraction regression test');
if (!app.includes("import('./modules/admin-model-remediation.js')") || !adminModelRemediation.includes('export function createAdminModelRemediationModule')) failures.push('Admin model remediation lazy extraction contract is missing');
if (app.includes('function remediationActionLabel') || app.includes("action: 'resolve_drift'") || app.includes("action: 'reset_circuit'")) failures.push('Admin model remediation implementation leaked back into shared app root');
if (!app.includes('confirmAction: message => window.confirm(message)') || !app.includes('loadModelQuality')) failures.push('Admin model remediation destructive-action dependencies must stay explicit');
if (!fs.existsSync('test/admin-rc-regression-extraction.test.js')) failures.push('Missing admin RC regression extraction regression test');
if (!app.includes("import('./modules/admin-rc-regression.js')") || !adminRcRegression.includes('export function createAdminRcRegressionModule')) failures.push('Admin RC regression lazy extraction contract is missing');
if (app.includes('function rcStateText(status)') || app.includes('Запускаю безопасную регрессионную проверку')) failures.push('Admin RC regression implementation leaked back into shared app root');
if (!app.includes('function runClientContractSmoke()') || !app.includes('runClientContractSmoke,')) failures.push('Client contract smoke must remain in composition root and be explicitly injected into RC regression');
if (adminRcRegression.includes('function runClientContractSmoke()') || adminRcRegression.includes('document.querySelector') || adminRcRegression.includes('window.Telegram')) failures.push('Admin RC regression module must not own cross-app client smoke/browser integration');
if (!fs.existsSync('test/admin-overview-extraction.test.js')) failures.push('Missing admin overview extraction regression test');
if (!app.includes("import('./modules/admin-overview.js')") || !adminOverview.includes('export function createAdminOverviewModule')) failures.push('Admin overview lazy extraction contract is missing');
if (app.includes("const enabled = ['analysisEnabled', 'searchEnabled', 'liveEnabled']")) failures.push('Admin overview implementation leaked back into shared app root');
if (!app.includes('function applyAdminVisibility()') || !app.includes('function organizeAdminConsole()') || !app.includes('async function loadAdvancedAdminTools()')) failures.push('Admin access and boot orchestration must remain in the composition root');
if (/applyAdminVisibility|organizeAdminConsole|loadAdvancedAdminTools|querySelectorAll\('\[data-admin-only\]'\)/.test(adminOverview)) failures.push('Admin overview module must not own access or boot orchestration');
if (!adminModelRemediation.includes('async function runModelRemediation()') || !adminModelRemediation.includes('async function resolveSettlementDriftFromUi(fixtureId, action)') || !adminModelRemediation.includes('async function resetSettlementCircuitFromUi()')) failures.push('Calibration extraction captured remediation actions or remediation boundary is missing');
if (/\/api\/model-remediation|runModelRemediation|resolveSettlementDriftFromUi|resetSettlementCircuitFromUi/.test(adminCalibrationControl)) failures.push('Admin calibration control module must not own remediation logic');
if (!adminCalibrationControl.includes('confirmAction(') || !adminCalibrationControl.includes('refreshModelQuality(true)')) failures.push('Calibration control side effects must remain explicitly injected');
if (!app.includes("import('./modules/admin-beta-dashboard.js')") || !adminBetaDashboard.includes('export function createAdminBetaDashboardModule')) failures.push('Admin beta dashboard lazy extraction contract is missing');
if (app.includes('Verified normal users') || app.includes('function betaTimingLabel')) failures.push('Admin beta dashboard implementation leaked back into shared app root');
if (!fs.existsSync('test/beta-feedback-extraction.test.js')) failures.push('Missing beta feedback extraction regression test');
if (!app.includes("import('./modules/beta-feedback.js')") || !betaFeedback.includes('export function createBetaFeedbackModule')) failures.push('Beta feedback lazy extraction contract is missing');
if (app.includes("const category=String($('betaFeedbackCategory')") || app.includes('Спасибо. Сообщение добавлено в beta-наблюдение')) failures.push('Beta feedback implementation leaked back into shared app root');
if (!betaFeedback.includes("/api/beta-feedback") || !betaFeedback.includes('async function submitBetaFeedback()') || !betaFeedback.includes('function setBetaFeedbackOpen(open)')) failures.push('Beta feedback module contract is incomplete');
if (/setBetaFeedbackOpen|submitBetaFeedback|betaFeedbackSending|\/api\/beta-feedback/.test(adminBetaDashboard)) failures.push('Admin beta dashboard must not own beta feedback lifecycle');
if (!fs.existsSync('test/profile-data-capabilities-extraction.test.js')) failures.push('Missing profile data capabilities extraction regression test');
if (!app.includes("import { createProfileDataCapabilitiesModule } from './modules/profile-data-capabilities.js'") || !profileDataCapabilities.includes('export function createProfileDataCapabilitiesModule')) failures.push('Profile data capabilities extraction contract is missing');
if (!app.includes('const { renderDataCapabilities } = createProfileDataCapabilitiesModule({ state, elementById: $ });')) failures.push('Profile data capabilities must be wired synchronously from the composition root');
if (app.includes('function renderDataCapabilities()') || app.includes("$('dataModeRefresh').textContent = features.liveRefresh")) failures.push('Profile data capabilities implementation leaked back into shared app root');
if (/\bapi\s*\(|fetch\s*\(|state\.[A-Za-z0-9_]+\s*=/.test(profileDataCapabilities)) failures.push('Profile data capabilities module must remain read-only and network-free');
if (!fs.existsSync('test/profile-access-state-extraction.test.js')) failures.push('Missing profile access state extraction regression test');
if (!app.includes("import { createProfileAccessStateModule } from './modules/profile-access-state.js'") || !profileAccessState.includes('export function createProfileAccessStateModule')) failures.push('Profile access state extraction contract is missing');
if (!app.includes('const { renderProfileAccessState } = createProfileAccessStateModule({') || !app.includes('onRetry: () => openProfileView()')) failures.push('Profile access state retry dependency must stay explicitly wired from the composition root');
if (app.includes('function renderProfileAccessState(') || app.includes('Профиль временно недоступен')) failures.push('Profile access state implementation leaked back into shared app root');
if (/openProfileView|\bapi\s*\(|fetch\s*\(|state\./.test(profileAccessState)) failures.push('Profile access state module must not own profile loading or network lifecycle');
if (!fs.existsSync('test/profile-summary-extraction.test.js')) failures.push('Missing profile summary extraction regression test');
if (!app.includes("import { createProfileSummaryModule } from './modules/profile-summary.js'") || !profileSummary.includes('export function createProfileSummaryModule')) failures.push('Profile summary extraction contract is missing');
if (!app.includes('const { renderProfileSummary } = createProfileSummaryModule({') || !app.includes('renderProfileSummary();')) failures.push('Profile summary must be synchronously wired from the composition root');
if (app.includes('const profileButtonLabel =') || app.includes("$('profileUsage').textContent")) failures.push('Profile summary implementation leaked back into shared app root');
if (/applyInterfacePreferences|renderFavoriteTeams|renderMyTeams|renderReminderList|renderBilling|applyAdminVisibility|renderDataCapabilities|applyRuntimeUi|renderAdminOverview/.test(profileSummary)) failures.push('Profile summary module captured downstream profile orchestration');
if (!app.includes('renderReminderList();') || !app.includes('renderBilling();') || !app.includes('applyAdminVisibility();') || !app.includes('renderDataCapabilities();')) failures.push('Profile downstream orchestration must remain in the composition root');
if (!fs.existsSync('test/journey-state-extraction.test.js')) failures.push('Missing journey state extraction regression test');
if (!app.includes("import { createJourneyStateModule } from './modules/journey-state.js'") || !journeyState.includes('export function createJourneyStateModule')) failures.push('Journey state extraction contract is missing');
if (!app.includes('const { renderJourneyState } = createJourneyStateModule({')) failures.push('Journey state renderer must be wired synchronously from the composition root');
if (app.includes('function renderJourneyState(') || app.includes('analysisStateRetry')) failures.push('Journey state implementation leaked back into shared app root');
if (/openMatchCenter|analyzeMatch|\bapi\s*\(|fetch\s*\(|state\./.test(journeyState)) failures.push('Journey state module must not own match or AI lifecycle');
if (!fs.existsSync('test/favorite-teams-renderer-extraction.test.js')) failures.push('Missing favorite teams renderer extraction regression test');
if (!app.includes("import { createFavoriteTeamsRenderer } from './modules/favorite-teams-renderer.js'") || !favoriteTeamsRenderer.includes('export function createFavoriteTeamsRenderer')) failures.push('Favorite teams renderer extraction contract is missing');
if (!app.includes('const { renderFavoriteTeams } = createFavoriteTeamsRenderer({') || !app.includes('onRetryLoad: () => loadFavorites()') || !app.includes('onRemoveFavorite: team => toggleFavorite(team)') || !app.includes('onOpenTeam: team => openTeam(team)')) failures.push('Favorite teams lifecycle dependencies must remain explicitly wired from the composition root');
if (app.includes('function renderFavoriteTeams()') || app.includes('Избранных команд пока нет')) failures.push('Favorite teams renderer implementation leaked back into shared app root');
if (!fs.existsSync('test/reminder-list-extraction.test.js')) failures.push('Missing reminder list extraction regression test');
if (!app.includes("import { createReminderListModule } from './modules/reminder-list.js'") || !reminderList.includes('export function createReminderListModule')) failures.push('Reminder list extraction contract is missing');
if (!app.includes('const { renderReminderList } = createReminderListModule({') || !app.includes('onRemove: fixtureId => handleReminderRemove(fixtureId)')) failures.push('Reminder list callbacks must stay explicitly wired from the composition root');
if (app.includes('function reminderDeliveryBadge(item)') || app.includes("document.querySelectorAll('.reminder-remove')")) failures.push('Reminder list rendering implementation leaked back into shared app root');
if (!app.includes('async function handleReminderRemove(fixtureId)') || !app.includes("method: 'DELETE'") || !app.includes('state.reminderMutations.add(fixtureId)')) failures.push('Reminder mutation lifecycle must remain in the composition root');
if (/\/api\/reminders|state\.profile\s*=|toast\s*\(|renderProfile\s*\(|renderAnalysis\s*\(/.test(reminderList)) failures.push('Reminder list module captured mutation or business lifecycle');
if (!fs.existsSync('test/my-teams-renderer-extraction.test.js')) failures.push('Missing my teams renderer extraction regression test');
if (!app.includes("import { createMyTeamsRenderer } from './modules/my-teams-renderer.js'") || !myTeamsRenderer.includes('export function createMyTeamsRenderer')) failures.push('My Teams renderer extraction contract is missing');
if (!app.includes('const { renderMyTeams } = createMyTeamsRenderer({') || !app.includes('onOpenTeam: team => openTeam(team)') || !app.includes('onOpenMatch: (fixtureId, button) => openMatchCenter(fixtureId, button)')) failures.push('My Teams navigation dependencies must remain explicitly wired from composition root');
if (app.includes('function renderMyTeams()') || app.includes('Загружаю ваши команды…')) failures.push('My Teams renderer implementation leaked back into shared app root');
if (/function openTeam|async function analyzeMatch|\/api\//.test(myTeamsRenderer)) failures.push('My Teams renderer captured navigation, analysis or network lifecycle');
const myTeamsWiring = app.slice(app.indexOf('const { renderMyTeams } = createMyTeamsRenderer({'), app.indexOf('\n});', app.indexOf('const { renderMyTeams } = createMyTeamsRenderer({')) + 4);
if (/\bisLiveMatch\b|\bisFinishedMatch\b|\bscoreText\b/.test(myTeamsWiring)) failures.push('My Teams extraction must not create eager references to nonexistent legacy match helpers');
if (/async function loadFavorites|async function toggleFavorite|function openTeam|\/api\/favorites|showView\('matchesView'\)/.test(favoriteTeamsRenderer)) failures.push('Favorite teams renderer must not own loading, mutation, navigation or team lifecycle');
if (!fs.existsSync('test/history-renderer-extraction.test.js')) failures.push('Missing history renderer extraction regression test');
if (!app.includes("import('./modules/history-renderer.js')") || !historyRenderer.includes('export function createHistoryRenderer')) failures.push('History renderer extraction contract is missing');
if (!app.includes('onReloadHistory: force => loadHistory(force)') || !app.includes("onOpenSearch: () => showView('searchView')") || !app.includes('onOpenHistoryAnalysis: (fixtureId, button) => openHistoryAnalysis(fixtureId, button)')) failures.push('History renderer lifecycle dependencies must remain explicitly wired from composition root');
if (app.includes('class="history-item"') || app.includes('История пока пуста')) failures.push('History renderer implementation leaked back into shared app root');
if (!app.includes('async function loadHistory(showLoader = true)') || !app.includes('async function openHistoryAnalysis(fixtureId, btn)')) failures.push('History loading and analysis lifecycle must remain in the composition root');
if (/\/api\/history|\/api\/history-analysis|requestMatchCenter|showView\(/.test(historyRenderer)) failures.push('History renderer captured network, fallback or navigation lifecycle');
if (!fs.existsSync('test/ai-track-record-renderer-extraction.test.js')) failures.push('Missing AI track record renderer extraction regression test');
if (!app.includes("import('./modules/ai-track-record-renderer.js')") || !aiTrackRecordRenderer.includes('export function createAiTrackRecordRenderer')) failures.push('AI track record renderer extraction contract is missing');
if (!app.includes('onRetry: () => loadAiTrackRecord()')) failures.push('AI track record retry lifecycle must remain explicitly wired from composition root');
if (app.includes('Здесь нет рекламного «процента побед»') || app.includes('class="ai-track-card"')) failures.push('AI track record renderer implementation leaked back into shared app root');
if (!app.includes('async function loadAiTrackRecord()') || !app.includes("/api/ai-track-record?days=180")) failures.push('AI track record loading lifecycle must remain in composition root');
if (/\/api\/ai-track-record|\bapi\s*\(|fetch\s*\(/.test(aiTrackRecordRenderer)) failures.push('AI track record renderer captured network lifecycle');
if (!fs.existsSync('test/global-search-renderer-extraction.test.js')) failures.push('Missing global search renderer extraction regression test');
if (!fs.existsSync('test/global-search-controller-issue441.test.js')) failures.push('Missing global search controller regression test');
if (!app.includes("import { createGlobalSearchRenderer } from './modules/global-search-renderer.js'") || !globalSearchRenderer.includes('export function createGlobalSearchRenderer')) failures.push('Global search renderer extraction contract is missing');
if (!app.includes("import { createGlobalSearchController } from './modules/global-search-controller.js'") || !globalSearchController.includes('export function createGlobalSearchController')) failures.push('Global search controller extraction contract is missing');
if (!app.includes('createGlobalSearchController({') || !app.includes('onRetry: () => runGlobalSearch({ manual:true })') || !app.includes('onSetMode: mode => setGlobalSearchMode(mode)') || !app.includes('bindGlobalSearchControls();')) failures.push('Global search lifecycle dependencies must remain explicitly wired from composition root');
if (app.includes('function renderGlobalSearch()') || app.includes('class="search-result-block compact-entity-results"') || app.includes('class="empty search-empty-state"')) failures.push('Global search renderer implementation leaked back into shared app root');
if (app.includes('async function runGlobalSearch(') || !globalSearchController.includes('async function runGlobalSearch(') || !globalSearchController.includes('/api/search?q=')) failures.push('Global search network lifecycle must remain in extracted controller');
if (/\/api\/search|\bapi\s*\(|sendProductAction|sendActionError/.test(globalSearchRenderer)) failures.push('Global search renderer captured network or telemetry lifecycle');
if (!fs.existsSync('test/match-center-controller-issue459.test.js')) failures.push('Missing Match Center controller regression test');
if (!app.includes("import('./modules/match-center-controller.js')") || !matchCenterController.includes('export function createMatchCenterController')) failures.push('Match Center controller lazy extraction contract is missing');
if (!app.includes('async function ensureMatchCenterController()') || !app.includes('createMatchCenterController({') || !app.includes('suspendLiveRefresh();') || !app.includes('resumeLiveRefresh();')) failures.push('Match Center request/live lifecycle dependencies must remain explicitly wired from composition root');
if (app.includes('matchCenterInFlight:') || app.includes('matchCenterRequestSeq:') || app.includes('liveRefreshTimer:') || app.includes('liveRefreshWasActive:')) failures.push('Match Center mutable timer/inflight ownership leaked back into shared app state');
const matchCenterRequestWrapper = app.slice(app.indexOf('async function requestMatchCenter('), app.indexOf('function signedPp', app.indexOf('async function requestMatchCenter(')));
const matchCenterOpenWrapper = app.slice(app.indexOf('async function openMatchCenter('), app.indexOf('function syncAnalysisBusyUi', app.indexOf('async function openMatchCenter(')));
if (!matchCenterRequestWrapper.includes('ensureMatchCenterController()') || matchCenterRequestWrapper.includes('/api/match-center')) failures.push('Match Center request wrapper must delegate without owning network implementation');
if (!matchCenterOpenWrapper.includes('ensureMatchCenterController()') || matchCenterOpenWrapper.includes("showView('analysisView')")) failures.push('Match Center open wrapper must delegate without owning navigation implementation');
if (app.includes('function scheduleLiveRefresh(')) failures.push('Match Center live scheduler leaked back into shared app root');
if (!matchCenterController.includes('/api/match-center?') || !matchCenterController.includes('function scheduleLiveRefresh(') || !matchCenterController.includes('async function openMatchCenter(')) failures.push('Match Center controller boundary is incomplete');
if (!fs.existsSync('test/analysis-controller-issue461.test.js')) failures.push('Missing AI analysis controller regression test');
if (!app.includes("import('./modules/analysis-controller.js')") || !analysisController.includes('export function createAnalysisController')) failures.push('AI analysis controller lazy extraction contract is missing');
if (!app.includes('async function ensureAnalysisController()') || !app.includes('createAnalysisController({')) failures.push('AI analysis controller dependencies must remain explicitly wired from composition root');
const analysisWrapper = app.slice(app.indexOf('async function analyzeMatch('), app.indexOf('function historyItemFromAnalysis', app.indexOf('async function analyzeMatch(')));
if (!analysisWrapper.includes('ensureAnalysisController()') || analysisWrapper.includes('/api/analyze')) failures.push('AI analyze wrapper must delegate without owning network/recovery implementation');
if (app.includes('async function loadAnalysisAccessSnapshot(') || app.includes("await api('/api/analyze'")) failures.push('AI analysis request/recovery implementation leaked back into shared app root');
if (!analysisController.includes('async function loadAnalysisAccessSnapshot(') || !analysisController.includes("await api('/api/analyze'") || !analysisController.includes("requestSeq===safeRead(state,'analysisRequestSeq')") || !analysisController.includes("currentView()==='analysisView'")) failures.push('AI analysis controller boundary is incomplete');
if (!app.includes("import('./modules/admin-launch-funnel.js')") || !adminLaunchFunnel.includes('export function createAdminLaunchFunnelModule')) failures.push('Admin launch funnel lazy extraction contract is missing');
if (app.includes('Собираю first-party воронку') || app.includes('newsImpactRecoveryIncidentSloBreachImpactRanking')) failures.push('Admin launch funnel implementation leaked back into shared app root');
if (!app.includes("createNavigationShell({") || !navigationShell.includes('export function createNavigationShell')) failures.push('Frontend navigation shell extraction contract is missing');
if (navigationShell.includes('stopLiveRefresh') || navigationShell.includes('liveRefreshTimer')) failures.push('Navigation shell must not own live refresh lifecycle');
if (!app.includes('onLeaveView: ({ from, to, options }) => {')) failures.push('Navigation lifecycle dependency must remain explicitly injected');
if (!fs.existsSync('test/unified-search.test.js')) failures.push('Missing unified search regression test');
if (!worker.includes("pathname === '/api/history-analysis'")) failures.push('Missing quota-safe history analysis route');
if (!app.includes('tg.BackButton.onClick(handleBackNavigation)')) failures.push('Telegram BackButton navigation is not wired');
if (!globalSearchController.includes('function nextRequestSeq()') || !globalSearchController.includes('seq!==currentRequestSeq()') || !globalSearchController.includes('query!==currentQuery()')) failures.push('Global search stale-response guard is missing');
if (!worker.includes('searchLeagueFixtures:true')) failures.push('League fixture search capability is missing');
if (!worker.includes('loadSearchCompetitionMatches')) failures.push('League fixture search loader is missing');
if (!globalSearchController.includes('remoteMatches:entityRows(') || !globalSearchController.includes("safeRead(data,'matches')")) failures.push('Client does not hydrate server-side league matches');
if (!fs.existsSync('test/interaction-safety.test.js')) failures.push('Missing interaction-safety regression test');
if (!app.includes('analysisActionPending: false')) failures.push('Analysis duplicate-submit guard is missing');
if (!matchCenterController.includes('let requestSeq=0') || !matchCenterController.includes('if (seq!==requestSeq) return null')) failures.push('Match-center stale-response guard is missing');
if (!app.includes('favoriteMutations: new Set()')) failures.push('Favorite mutation guard is missing');
if (!app.includes('reminderMutations: new Set()')) failures.push('Reminder mutation guard is missing');
if (!fs.existsSync('test/quick-reminder-onboarding.test.js')) failures.push('Missing RC44 quick-reminder/onboarding regression test');
if (!fs.existsSync('test/main-screen-focus.test.js')) failures.push('Missing RC44 focused-home regression test');
if (!fs.existsSync('test/ai-instructor-bot.test.js')) failures.push('Missing RC44 AI-instructor/bot regression test');
if (!fs.existsSync('test/ai-instructor-rc41.test.js')) failures.push('Missing RC41 AI-intelligence regression test');
if (!fs.existsSync('test/live-ai-rc44.test.js')) failures.push('Missing RC44 AI LIVE regression test');
if (!fs.existsSync('test/ai-experience-rc45.test.js')) failures.push('Missing RC45 ranking/bot regression test');
if (!fs.existsSync('test/ai-instructor-rc46.test.js')) failures.push('Missing RC46 AI trust/intent regression test');
if (!fs.existsSync('test/telegram-button-ui-rc47.test.js')) failures.push('Missing RC47 Telegram button-first regression test');
if (!fs.existsSync('test/telegram-inline-ai-rc48.test.js')) failures.push('Missing RC48 Telegram inline-AI regression test');
if (!fs.existsSync('test/public-product-rc49.test.js')) failures.push('Missing RC49 public-product regression test');
if (!fs.existsSync('test/fm-ai-news-rc50.test.js')) failures.push('Missing RC50 FM AI News regression test');
if (!fs.existsSync('test/media-launch-ux-rc51.test.js')) failures.push('Missing RC51 media-launch UX regression test');
if (!fs.existsSync('test/media-launch-hardening-rc52.test.js')) failures.push('Missing RC52 media-launch hardening regression test');
if (!fs.existsSync('test/media-launch-package-rc53.test.js')) failures.push('Missing RC53 media-launch package regression test');
if (!fs.existsSync('test/launch-conversion-rc54.test.js')) failures.push('Missing RC54 launch conversion regression test');
if (!fs.existsSync('test/launch-search-quality-rc55.test.js')) failures.push('Missing RC55 search-quality regression test');
if (!fs.existsSync('test/match-discovery-rc56.test.js')) failures.push('Missing RC56 match-discovery regression test');
if (!fs.existsSync('test/match-selection-rc57.test.js')) failures.push('Missing RC57 match-selection regression test');
if (!fs.existsSync('test/one-tap-ai-handoff-rc58.test.js')) failures.push('Missing RC58 one-tap handoff regression test');
if (!fs.existsSync('test/ai-freshness-rc59.test.js')) failures.push('Missing RC59 AI freshness regression test');
if (!fs.existsSync('test/pre-kickoff-delta-rc60.test.js')) failures.push('Missing RC60 pre-kickoff delta regression test');
if (!fs.existsSync('test/kickoff-handoff-rc61.test.js')) failures.push('Missing RC61 kickoff handoff regression test');
if (!fs.existsSync('test/post-match-review-rc62.test.js')) failures.push('Missing RC62 post-match review regression test');
if (!fs.existsSync('test/post-match-return-rc63.test.js')) failures.push('Missing RC63 post-match return regression test');
if (!fs.existsSync('test/ai-track-record-rc64.test.js')) failures.push('Missing RC64 AI track record regression test');
if (!fs.existsSync('test/media-share-deeplink-rc65.test.js')) failures.push('Missing RC65 media share regression test');
if (!fs.existsSync('test/primary-telegram-bot-migration-prep.test.js')) failures.push('Missing primary Telegram bot migration regression test');
if (!fs.existsSync('src/telegram-primary-identity.js')) failures.push('Missing primary Telegram bot identity resolver');
else {
  const primaryTelegramIdentity = fs.readFileSync('src/telegram-primary-identity.js','utf8');
  if (!primaryTelegramIdentity.includes('telegram:bot-username:v2:')) failures.push('Primary Telegram bot username cache must be identity-aware');
  if (!primaryTelegramIdentity.includes("crypto.subtle.digest('SHA-256'")) failures.push('Primary Telegram bot cache identity fingerprint is missing');
}
if (worker.includes('telegram:bot-username:v1')) failures.push('Legacy global Telegram bot username cache key must not be used');
if (!worker.includes('resolvePrimaryTelegramBotUsername') || !worker.includes('telegramBotStartUrl(username,startParam)')) failures.push('Primary Telegram bot identity/deep-link migration contract is incomplete');
if (!fs.existsSync('PRIMARY_TELEGRAM_BOT_MIGRATION_PREP_RU.md')) failures.push('Missing primary Telegram bot migration runbook');
else {
  const primaryMigrationPrep = fs.readFileSync('PRIMARY_TELEGRAM_BOT_MIGRATION_PREP_RU.md','utf8');
  for (const marker of ['@MatchRadarAIBot','@MANAGERPLAYER_BOT','TELEGRAM_WEBHOOK_SECRET','getWebhookInfo','GET /api/me','Rollback procedure']) {
    if (!primaryMigrationPrep.includes(marker)) failures.push(`Primary Telegram migration runbook is missing: ${marker}`);
  }
}
const primaryMigrationRegression = fs.readFileSync('test/primary-telegram-bot-migration-prep.test.js','utf8');
if (!primaryMigrationRegression.includes('MatchRadarAIBot')) failures.push('Primary Telegram migration regression must target @MatchRadarAIBot');
if (!primaryMigrationRegression.includes('channel publisher CTA use the current primary bot identity resolver')) failures.push('Primary Telegram migration regression must cover channel CTA identity');
if (!primaryMigrationRegression.includes('/api/me and admin identity remain keyed by Telegram user id')) failures.push('Primary Telegram migration regression must cover /api/me and admin identity');
if (!fs.existsSync('test/media-traffic-guard-rc66.test.js')) failures.push('Missing RC66 media traffic guard regression test');
if (!fs.existsSync('test/media-publisher-kit-rc67.test.js')) failures.push('Missing RC67 media publisher regression test');
if (!fs.existsSync('test/ai-instructor-rc43.test.js')) failures.push('Missing RC43 persistent-AI regression test');
if (!fs.existsSync('test/ai-instructor-rc42.test.js')) failures.push('Missing RC42 referee/AI-focus regression test');
if (!worker.includes('function loadRefereeHistoryProfile')) failures.push('RC44 referee history loader is missing');
if (!worker.includes('saveRefereeMatchHistory')) failures.push('RC44 referee history collector is missing');
if (!fs.existsSync('test/phase4-2-brand-premium-ui.test.js')) failures.push('Missing Phase 4.2 brand/UI regression test');
if (!fs.existsSync('public/assets/brand/matchradar-mark.svg') || !fs.existsSync('public/assets/brand/matchradar-avatar.svg') || !fs.existsSync('public/assets/brand/matchradar-wordmark.svg')) failures.push('MatchRadar brand assets are incomplete');
if (!html.includes('MatchRadar') || /FutLens|FM AI/.test(html) || /FutLens|FM AI/.test(app)) failures.push('MatchRadar public brand replacement is incomplete');
if (!app.includes('function renderAiFocus')) failures.push('RC44 AI focus card is missing');
if (!worker.includes('createRefereeIntelligenceRuntime') || !app.includes('function renderAiFocus')) failures.push('RC44 referee/AI focus contract is missing');
if (!worker.includes('function buildLineupImpact')) failures.push('RC44 lineup impact engine is missing');
if (!worker.includes('function marketMovementNote')) failures.push('RC44 market movement explanation is missing');
if (!worker.includes('processDailyDigests')) failures.push('RC44 daily bot digest is missing');
if (!worker.includes('buildAiInstructor') || !worker.includes('processDailyDigests')) failures.push('RC44 AI/digest contract is missing');
if (!worker.includes('function buildAiInstructor')) failures.push('AI football instructor engine is missing');
if (!worker.includes('referee:safeText(fixture?.fixture?.referee,180)')) failures.push('Pre-match referee context is missing');
if (!app.includes('function aiInstructorHtml')) failures.push('AI instructor UI is missing');
if (!html.includes('boot-card boot-card-simple') || !html.includes('MatchRadar') || !html.includes('Видим, что меняет матч.') || !html.includes('Загружаем матчи…') || html.includes('id="bootVersion"')) failures.push('MatchRadar minimal public startup is missing');
if (!worker.includes('createTelegramBotOrchestrationRuntime') || !worker.includes('buildAiInstructor')) failures.push('RC44 AI/bot contract is missing');
if (!html.includes('id="dailyOverview"') || !html.includes('id="homePersonalMatchBtn"') || html.includes('id="homeLiveCard"') || html.includes('id="homeTeamsBtn"') || html.includes('id="homeFavoriteBtn"')) failures.push('Phase 4.1 clean Home priority contract is missing');
if (!html.includes('id="quotaText" hidden')) failures.push('Main-screen quota must be hidden by default');
if (!worker.includes('focusedMatchHome:true') || !worker.includes('contextualLeagueFilter:true')) failures.push('RC44 focused-home capability contract is missing');
if (!html.includes('id="firstRunGuideFavorite"') || html.includes('id="homeFavoriteBtn"') || app.includes("homeFavoriteBtn")) failures.push('Phase 4.1 first-run onboarding / clean Home contract is missing');
if (!app.includes('data-quick-reminder')) failures.push('Quick reminder action is missing from match cards');
if (!app.includes('data-quick-reminder') || !app.includes('firstRunGuide')) failures.push('RC44 quick-reminder/first-run contract is missing');
if (!app.includes('profileStale: false')) failures.push('Profile fail-soft state is missing');
if (!fs.existsSync('test/entity-state-safety.test.js')) failures.push('Missing entity-state safety regression test');
if (!app.includes('teamHubRequestSeq: 0')) failures.push('Team hub stale-response guard is missing');
if (!app.includes('tournamentStandingsRequestSeq: 0')) failures.push('Tournament standings stale-response guard is missing');
if (!app.includes("favoritesLoading: false")) failures.push('Favorites explicit loading state is missing');
if (!app.includes("remindersLoading: false")) failures.push('Reminders explicit loading state is missing');
if (!fs.existsSync('test/personal-data-write-consistency.test.js')) failures.push('Missing personal-data write consistency regression test');
if (!app.includes('favoritesRevision: 0')) failures.push('Favorites read/write revision guard is missing');
if (!app.includes('remindersRevision: 0')) failures.push('Reminders read/write revision guard is missing');
if (!worker.includes('function publicReminder')) failures.push('Reminder write response must expose the normalized reminder item');
if (!fs.existsSync('test/analysis-history-transition.test.js')) failures.push('Missing analysis/history transition regression test');
if (!app.includes('historyOpenRequestSeq: 0')) failures.push('History-open stale response guard is missing');
if (!app.includes('historyRevision: 0')) failures.push('History read/write revision guard is missing');
const analysisSecondaryRefreshNonBlocking =
  analysisController.includes('const secondaryTasks=[')
  && analysisController.includes('.then(()=>refreshHistory(false))')
  && analysisController.includes("safeRead(state,'remindersLoaded')!==true")
  && analysisController.includes('Promise.resolve().then(()=>refreshReminders())')
  && analysisController.includes("safeRead(state,'favoritesLoaded')!==true")
  && analysisController.includes('Promise.resolve().then(()=>refreshFavorites())')
  && analysisController.includes('void Promise.allSettled(secondaryTasks)');
if (!analysisSecondaryRefreshNonBlocking) failures.push('Analysis result must keep conditional secondary history/reminder/favorites refresh non-blocking');
if (app.includes('state.currentAnalysis = data;\n    if (isAdmin()')) failures.push('analyzeMatch must let renderAnalysis compare the previous fixture before assignment');
if (!fs.existsSync('test/russian-ui-localization.test.js')) failures.push('Missing Russian UI localization regression test');
if (!adminHtml.includes('id="quotaFeatureSkipped"') || adminHtml.includes('quotaFeatureПропущено')) failures.push('Provider skipped-counter DOM id is inconsistent');
if (!app.includes('function humanizeTechnicalText(value)')) failures.push('Admin technical-text localization helper is missing');
if (!app.includes("const assetVersion = CLIENT_VERSION.split('-')[0]")) failures.push('Client contract smoke must derive the current asset version dynamically');
if (app.includes('6.14.0-rc22') || worker.includes('6.14.0-rc22')) failures.push('Stale RC22 release checks remain');
if (!html.includes('<html lang="ru">') || !app.includes('function humanizeTechnicalText(value)')) failures.push('Russian UI localization contract is missing');
if (!adminHtml.includes('<html lang="ru">')) failures.push('Admin Russian localization contract is missing');
if (!app.includes('Качество выборки:') || !app.includes('Перепроверить AI сейчас')) failures.push('Prematch Russian localization contract is missing');
if (!app.includes('friendlyErrorMessage') || !app.includes('humanizeTechnicalText')) failures.push('Dynamic Russian localization contract is missing');
if (!app.includes('function humanizeTechnicalText(value)')) failures.push('Admin text humanization contract is missing');
if (!app.includes('Центр матча') && !app.includes('Матч-центр')) failures.push('Match-center Russian localization contract is missing');

const migration = fs.readFileSync('supabase/migrations/supabase_migration_v6_10.sql', 'utf8');
if (!migration.includes('transition_model_calibration')) failures.push('Missing atomic calibration transition RPC');
if (!migration.includes('alter table public.model_calibration_validations enable row level security')) failures.push('Missing validation-table RLS remediation');

const securityMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_11.sql', 'utf8');
if (!securityMigration.includes('backend_security_contract')) failures.push('Missing backend security contract RPC');
if (!securityMigration.includes('revoke all privileges on all tables in schema public')) failures.push('Missing backend-table privilege lockdown');

const defaultAclMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_11_1.sql', 'utf8');
if (!defaultAclMigration.includes('application_owners')) failures.push('Missing application-owner default ACL audit');
if (!defaultAclMigration.includes('backend_default_acl_contract')) failures.push('Missing default ACL security contract RPC');

if (!publicShellStyles.includes('grid-template-columns:repeat(4,minmax(0,1fr))') || !publicShellStyles.includes('transform:none')) failures.push('Bottom navigation final four-column cascade/position guard is missing');
if (!staticHeaders.includes('/styles/public-shell.css') || !staticHeaders.includes('/index.html') || !staticHeaders.includes('Cache-Control: no-cache, max-age=0, must-revalidate')) failures.push('Mini App shell cache revalidation headers are missing');


if (!fs.existsSync('supabase/migrations/supabase_migration_v6_26.sql')) failures.push('Missing v6.26 scheduled-job lease migration');
else {
  const scheduledLeaseMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_26.sql','utf8').toLowerCase();
  for (const marker of [
    'create table if not exists public.scheduled_job_leases',
    'alter table public.scheduled_job_leases enable row level security',
    'create or replace function public.claim_scheduled_job',
    'create or replace function public.complete_scheduled_job',
    'create or replace function public.release_scheduled_job',
    'grant execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)',
    "'scheduled_job_leases'"
  ]) {
    if (!scheduledLeaseMigration.includes(marker.toLowerCase())) failures.push(`v6.26 scheduled lease migration is missing: ${marker}`);
  }
}
if (!worker.includes("createScheduledLeaseRuntime") || !worker.includes("claimScheduledJob") || !worker.includes("scheduled_job_leases")) failures.push('Issue #404 scheduled lease integration is incomplete');
if (!worker.includes("CRON_TASK_DEGRADED") || !worker.includes("CRON_TASK_SKIPPED") || !worker.includes("CRON_EXECUTION_SKIPPED") || !worker.includes("dailyScheduledTaskKey")) failures.push('Issue #404 scheduled result/idempotency/observability contract is incomplete');

if (!fs.existsSync('supabase/migrations/supabase_migration_v6_26_1.sql')) failures.push('Missing v6.26.1 scheduled-job lease privilege hardening migration');
else {
  const scheduledLeasePrivilegeMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_26_1.sql','utf8').toLowerCase();
  for (const marker of [
    'revoke all privileges on table public.scheduled_job_leases',
    'revoke truncate, references, trigger',
    'from service_role',
    'grant select, insert, update, delete',
    'to service_role',
    'revoke execute on function public.claim_scheduled_job(text,text,timestamptz,integer,integer)'
  ]) {
    if (!scheduledLeasePrivilegeMigration.includes(marker.toLowerCase())) failures.push(`v6.26.1 scheduled lease privilege migration is missing: ${marker}`);
  }
}

if (!fs.existsSync('supabase/migrations/supabase_migration_v6_26_2.sql')) failures.push('Missing v6.26.2 provider observability/alert lease migration');
else {
  const providerReliabilityMigration=fs.readFileSync('supabase/migrations/supabase_migration_v6_26_2.sql','utf8').toLowerCase();
  for (const marker of [
    'create table if not exists public.provider_slo_buckets',
    'create or replace function public.record_provider_slo_observation',
    'on conflict (bucket_started_at,provider,operation) do update',
    'create or replace function public.read_provider_slo_buckets',
    "delivery_phase in ('legacy','claimed','sending','retry')",
    'create or replace function public.claim_provider_incident_alert_delivery_v2',
    'create or replace function public.begin_provider_incident_alert_delivery_send',
    'stale_claim_reclaimed',
    'stale_sending_lease',
    'revoke all privileges on table public.provider_incident_alert_deliveries'
  ]) {
    if (!providerReliabilityMigration.includes(marker.toLowerCase())) failures.push(`v6.26.2 provider reliability migration is missing: ${marker}`);
  }
}
if (!fs.existsSync('supabase/migrations/supabase_migration_v6_26_3.sql')) failures.push('Missing v6.26.3 security occurrence migration');
else {
  const securityOccurrenceMigration=fs.readFileSync('supabase/migrations/supabase_migration_v6_26_3.sql','utf8').toLowerCase();
  for (const marker of [
    'add column if not exists occurrence_count integer not null default 1',
    'add column if not exists last_occurred_at timestamptz',
    'create or replace function public.record_ops_event_occurrence',
    'on conflict (transition_key) do update',
    'occurrence_count = public.ops_events.occurrence_count + 1',
    "'occurrencecount', public.ops_events.occurrence_count + 1",
    'security invoker',
    'grant execute on function public.record_ops_event_occurrence'
  ]) {
    if (!securityOccurrenceMigration.includes(marker.toLowerCase())) failures.push(`v6.26.3 security occurrence migration is missing: ${marker}`);
  }
}
if (!worker.includes("record_ops_event_occurrence") || !worker.includes("occurrenceCount:1") || !worker.includes("lastOccurredAt:createdAt")) failures.push('Issue #407 atomic ops occurrence persistence is incomplete');

if (!worker.includes('read_provider_slo_buckets') || !worker.includes('providerSloWindowsFromBuckets') || !worker.includes('flushProviderSloWindow')) failures.push('Issue #405 distributed provider SLO aggregation is incomplete');
if (!providerSloIncidents.includes('windowIntegrity') || !providerSloIncidents.includes('windowCadence')) failures.push('Issue #405 provider SLO cadence validation is incomplete');
if (!worker.includes('claim_provider_incident_alert_delivery_v2') || !worker.includes('begin_provider_incident_alert_delivery_send')) failures.push('Issue #405 provider alert lease recovery is incomplete');
if (!worker.includes('providerIncidentBotIdentity(cfg.botToken)')) failures.push('Issue #405 stable provider alert bot identity is incomplete');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata is consistent for ${expected}.`);

// Historical RC44-RC143 feature flags were implementation details of the
// former monolithic runtime. The public release gate is anchored to the
// current extracted-module architecture and the executable RC144 test suite.
const releaseTestRunner = fs.readFileSync('scripts/run-release-tests.js','utf8');
for (const criticalTest of [
  'test/access-control.test.js',
  'test/analysis-quality-runtime-boundaries.test.js',
  'test/availability-quality-rc144.test.js',
  'test/deployment-workflow.test.js',
  'test/provider-launch-capacity-gate.test.js',
  'test/public-launch-first-run.test.js',
  'test/readiness-contract.test.js',
  'test/security-public-traffic-hardening.test.js',
  'test/supabase-integration-ci.test.js',
  'test/telegram-search-runtime-boundaries.test.js',
]) {
  if (!releaseTestRunner.includes(`'${criticalTest}'`)) {
    failures.push(`Current release test manifest is missing: ${criticalTest}`);
  }
}
if (!Array.isArray(releaseContract.qualityGate) || !releaseContract.qualityGate.includes('npm run test:release')) {
  failures.push('release-contract qualityGate must execute the current release-critical test suite');
}
for (const [marker,label] of [
  ['createAnalysisQualityRuntime','analysis quality runtime'],
  ['createSearchDiscoveryRuntime','search discovery runtime'],
  ['createProviderSloRuntime','provider SLO runtime'],
  ['createRefereeIntelligenceRuntime','referee intelligence runtime'],
  ['createTelegramBotOrchestrationRuntime','Telegram orchestration runtime'],
]) {
  if (!worker.includes(marker)) failures.push(`Current extracted ${label} is missing`);
}
for (const marker of [
  "import { createGlobalSearchController } from './modules/global-search-controller.js'",
  "import('./modules/match-center-controller.js')",
  "import('./modules/analysis-controller.js')",
]) {
  if (!app.includes(marker)) failures.push(`Current public composition contract is missing: ${marker}`);
}
if (!fs.existsSync('test/availability-quality-rc144.test.js')) failures.push('Missing current RC144 availability-quality regression test');

if (!fs.existsSync('MEDIA_LAUNCH_RU.md')) failures.push('Missing RC53 media launch kit');
if (!fs.readFileSync('public/privacy.html','utf8').includes('События launch-аналитики хранятся до 90 дней')) failures.push('RC53 privacy attribution disclosure is missing');

const launchMigration = fs.readFileSync('supabase/migrations/supabase_migration_v6_15.sql','utf8');
if (!launchMigration.includes('create table if not exists public.growth_events')) failures.push('RC53 growth_events table is missing');
if (!launchMigration.includes('alter table public.growth_events enable row level security')) failures.push('RC53 growth_events RLS is missing');
if (!launchMigration.includes('revoke all on table public.growth_events from anon, authenticated')) failures.push('RC53 growth_events anon/auth lockdown is missing');
if (!launchMigration.includes('grant select, insert, delete on table public.growth_events to service_role')) failures.push('RC53 growth_events backend grant is missing');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Release contracts verified for ${expected}.`);
