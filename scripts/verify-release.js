import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
const expected = `${pkg.version}-rc31`;
const failures = [];

if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock version must match package.json');

if (!worker.includes(`const APP_VERSION = '${expected}'`)) failures.push(`Worker version must be ${expected}`);
if (!worker.includes("const RC_NAME = 'RC31'")) failures.push('Worker RC name must be RC31');
if (!app.includes(`const CLIENT_VERSION = '${expected}'`)) failures.push(`Client version must be ${expected}`);
if (!app.includes("const CLIENT_RELEASE_CHANNEL = 'rc31'")) failures.push('Client release channel must be rc31');
if (!html.includes(`/app.js?v=${pkg.version}`) || !html.includes(`/styles.css?v=${pkg.version}`)) failures.push('Static asset versions must match package version');
if (!fs.existsSync('supabase_migration_v6_9.sql')) failures.push('Missing v6.9 migration');
if (!fs.existsSync('supabase_migration_v6_10.sql')) failures.push('Missing v6.10 migration');
if (!fs.existsSync('supabase_migration_v6_11.sql')) failures.push('Missing v6.11 migration');
if (!fs.existsSync('supabase_migration_v6_11_1.sql')) failures.push('Missing v6.11.1 default-ACL migration');
if (!fs.existsSync('supabase_baseline_v6_9.sql')) failures.push('Missing v6.9 baseline');
if (!fs.existsSync('src/access-control.js')) failures.push('Missing access-control module');
if (!fs.existsSync('scripts/post-deploy-smoke.js')) failures.push('Missing post-deploy smoke test');
if (!fs.existsSync('.github/workflows/deploy-production.yml')) failures.push('Missing production deploy workflow');
if (!fs.existsSync('.github/workflows/rollback-production.yml')) failures.push('Missing production rollback workflow');
if (!staticHeaders.includes('Content-Security-Policy:')) failures.push('Missing static asset Content-Security-Policy');
if (!staticHeaders.includes("script-src 'self' https://telegram.org")) failures.push('CSP must allow the official Telegram Mini App SDK');
if (!deployWorkflow.includes('exit 1')) failures.push('Production deployment must fail closed without Cloudflare credentials');
if (!deployWorkflow.includes('--message "RC31 ${{ env.DEPLOY_SHA }}"')) failures.push('Production deploy message must identify RC31');
if (!deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "6.23.0-rc31"')) failures.push('Production smoke must verify 6.22.0-rc31');
if (!wrangler.includes('"/health/*"')) failures.push('All health probes must be routed through the Worker');
if (!/id="adminRoleBadge"[^>]*data-admin-only[^>]*hidden/.test(html)) failures.push('Admin role badge must use the fail-closed admin-only visibility contract');
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/i.test(styles)) failures.push('Global hidden elements must remain display:none');
if (!app.includes("badge.textContent = admin ? '🔐 Администратор' : '';")) failures.push('Client must clear the admin badge for non-admin users');
if (!app.includes("el.toggleAttribute('inert', !admin)")) failures.push('Admin-only elements must be inert for non-admin users');
if (!app.includes('const photoUrl = safeUrl(user.photoUrl);')) failures.push('profile photo must use Telegram photoUrl through safeUrl');
if (!styles.includes('.avatar img')) failures.push('Profile avatar image styling is missing');
if (!fs.existsSync('test/user-flow-contract.test.js')) failures.push('Missing user-flow regression test');
if (!worker.includes("url.pathname === '/api/history-analysis'")) failures.push('Missing quota-safe history analysis route');
if (!app.includes('tg.BackButton.onClick(handleBackNavigation)')) failures.push('Telegram BackButton navigation is not wired');
if (!app.includes('state.globalSearch.requestSeq')) failures.push('Global search stale-response guard is missing');
if (!fs.existsSync('test/interaction-safety.test.js')) failures.push('Missing interaction-safety regression test');
if (!app.includes('analysisActionPending: false')) failures.push('Analysis duplicate-submit guard is missing');
if (!app.includes('matchCenterRequestSeq: 0')) failures.push('Match-center stale-response guard is missing');
if (!app.includes('favoriteMutations: new Set()')) failures.push('Favorite mutation guard is missing');
if (!app.includes('reminderMutations: new Set()')) failures.push('Reminder mutation guard is missing');
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
if (!app.includes('void Promise.allSettled([loadHistory(false), loadReminders()])')) failures.push('Analysis result must not wait for secondary history/reminder refresh');
if (app.includes('state.currentAnalysis = data;\n    if (isAdmin()')) failures.push('analyzeMatch must let renderAnalysis compare the previous fixture before assignment');
if (!fs.existsSync('test/russian-ui-localization.test.js')) failures.push('Missing Russian UI localization regression test');
if (!html.includes('id="quotaFeatureSkipped"') || html.includes('quotaFeatureПропущено')) failures.push('Provider skipped-counter DOM id is inconsistent');
if (!app.includes('function humanizeTechnicalText(value)')) failures.push('Admin technical-text localization helper is missing');
if (!app.includes("const assetVersion = CLIENT_VERSION.split('-')[0]")) failures.push('Client contract smoke must derive the current asset version dynamically');
if (app.includes('6.14.0-rc22') || worker.includes('6.14.0-rc22')) failures.push('Stale RC22 release checks remain');
if (!worker.includes("russianUiLocalization: 'enabled'")) failures.push('Russian UI localization health contract is missing');
if (!worker.includes("adminRussianLocalization: 'enabled'")) failures.push('Admin Russian localization health contract is missing');
if (!worker.includes("prematchRussianLocalization: 'enabled'")) failures.push('Prematch Russian localization health contract is missing');
if (!worker.includes("dynamicRussianLocalization: 'enabled'")) failures.push('Dynamic Russian localization health contract is missing');
if (!worker.includes("adminTextHumanization: 'enabled'")) failures.push('Admin text humanization health contract is missing');
if (!worker.includes("matchCenterRussianLocalization: 'enabled'")) failures.push('Match-center Russian localization health contract is missing');

const migration = fs.readFileSync('supabase_migration_v6_10.sql', 'utf8');
if (!migration.includes('transition_model_calibration')) failures.push('Missing atomic calibration transition RPC');
if (!migration.includes('alter table public.model_calibration_validations enable row level security')) failures.push('Missing validation-table RLS remediation');

const securityMigration = fs.readFileSync('supabase_migration_v6_11.sql', 'utf8');
if (!securityMigration.includes('backend_security_contract')) failures.push('Missing backend security contract RPC');
if (!securityMigration.includes('revoke all privileges on all tables in schema public')) failures.push('Missing backend-table privilege lockdown');

const defaultAclMigration = fs.readFileSync('supabase_migration_v6_11_1.sql', 'utf8');
if (!defaultAclMigration.includes('application_owners')) failures.push('Missing application-owner default ACL audit');
if (!defaultAclMigration.includes('backend_default_acl_contract')) failures.push('Missing default ACL security contract RPC');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata is consistent for ${expected}.`);
