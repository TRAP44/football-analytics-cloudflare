import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const deployWorkflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
const expected = `${pkg.version}-rc25`;
const failures = [];

if (!worker.includes(`const APP_VERSION = '${expected}'`)) failures.push(`Worker version must be ${expected}`);
if (!worker.includes("const RC_NAME = 'RC25'")) failures.push('Worker RC name must be RC25');
if (!app.includes(`const CLIENT_VERSION = '${expected}'`)) failures.push(`Client version must be ${expected}`);
if (!app.includes("const CLIENT_RELEASE_CHANNEL = 'rc25'")) failures.push('Client release channel must be rc25');
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
