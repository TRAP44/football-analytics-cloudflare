import fs from 'node:fs';
import { auditFrontendAssetContract } from './frontend-asset-audit.js';
import {
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  CLIENT_VERSION,
  FRONTEND_ASSET_REVISION,
  SUPABASE_SCHEMA_HINT,
} from '../public/modules/app-runtime.js';

function read(path) {
  return fs.readFileSync(path,'utf8');
}

function readSourceTree(root, extension='.js') {
  if (!fs.existsSync(root)) return '';
  const out=[];
  const visit=dir=>{
    for (const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path=dir+'/'+entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(extension)) out.push(read(path));
    }
  };
  visit(root);
  return out.join('\n');
}

const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const releaseContract=JSON.parse(read('release-contract.json'));
const workerTree=readSourceTree('src');
const html=read('public/index.html');
const adminHtml=read('public/admin.html');
const statusHtml=read('public/status.html');
const staticHeaders=read('public/_headers');
const premiumUiStyles=read('public/styles/premium-ui.css');
const deployWorkflow=read('.github/workflows/deploy-production.yml');
const wrangler=read('wrangler.jsonc');
const releaseTests=read('scripts/run-release-tests.js');

const failures=[];
const expected=String(releaseContract.runtimeVersion || '');
const runtimeMatch=/^(\d+\.\d+\.\d+)-rc(\d+)$/i.exec(expected);
const expectedRc=runtimeMatch ? `RC${runtimeMatch[2]}` : '';
const expectedChannel=runtimeMatch ? `rc${runtimeMatch[2]}` : '';
const baselinePath=String(releaseContract.freshInstallBaseline || '');
const latestMigrationPath=String(releaseContract.latestMigration || '');
const latestMigrationMatch=/supabase_migration_v(\d+(?:_\d+)*)\.sql$/i.exec(latestMigrationPath);
const latestMigrationVersion=latestMigrationMatch
  ? latestMigrationMatch[1].replaceAll('_','.')
  : '';

const rootSql=fs.readdirSync('.').filter(name=>/^supabase_(?:baseline|migration)_.*\.sql$/i.test(name));
if (rootSql.length) failures.push(`Supabase SQL must live under supabase/: ${rootSql.join(', ')}`);

if (lock.version!==pkg.version || lock.packages?.['']?.version!==pkg.version) {
  failures.push('package-lock version must match package.json');
}
if (releaseContract.applicationVersion!==pkg.version) {
  failures.push('release-contract applicationVersion must match package.json');
}
if (!runtimeMatch || runtimeMatch[1]!==pkg.version) {
  failures.push('release-contract runtimeVersion must be <package.version>-rc<number>');
}
if (!baselinePath || !fs.existsSync(baselinePath)) {
  failures.push('release-contract freshInstallBaseline must reference an existing file');
}
if (!latestMigrationPath || !fs.existsSync(latestMigrationPath)) {
  failures.push('release-contract latestMigration must reference an existing file');
}
if (!latestMigrationVersion) {
  failures.push('release-contract latestMigration must use supabase_migration_v<version>.sql naming');
}

const db=releaseContract.databaseContract || {};
if (db.version!==2) failures.push('release-contract databaseContract.version must remain 2');
if (db.rpc!=='backend_readiness_contract_v2') failures.push('release-contract databaseContract.rpc must remain backend_readiness_contract_v2');
if (!Array.isArray(db.compatibleFingerprints) || !db.compatibleFingerprints.includes(db.fingerprint)) {
  failures.push('release-contract compatibleFingerprints must include the production fingerprint');
}
if (!Array.isArray(db.compatibleFingerprints) || !db.compatibleFingerprints.includes(db.freshInstallFingerprint)) {
  failures.push('release-contract compatibleFingerprints must include the fresh-install fingerprint');
}

if (!workerTree.includes(`const APP_VERSION = '${expected}'`)) {
  failures.push(`Worker version must be ${expected}`);
}
if (!expectedRc || !workerTree.includes(`const RC_NAME = '${expectedRc}'`)) {
  failures.push(`Worker RC name must be ${expectedRc || 'derived from runtimeVersion'}`);
}
if (CLIENT_VERSION!==expected) failures.push(`Client version must be ${expected}`);
if (!expectedChannel || CLIENT_RELEASE_CHANNEL!==expectedChannel) {
  failures.push(`Client release channel must be ${expectedChannel || 'derived from runtimeVersion'}`);
}
if (!workerTree.includes(`const API_CONTRACT_VERSION = ${CLIENT_API_CONTRACT};`)) {
  failures.push('Client and worker API contract versions must match');
}
if (latestMigrationVersion && !SUPABASE_SCHEMA_HINT.includes(`миграции до v${latestMigrationVersion}`)) {
  failures.push('Client Supabase schema hint must match release-contract latestMigration');
}
if (latestMigrationVersion && !workerTree.includes(`миграции до v${latestMigrationVersion}`)) {
  failures.push('Worker Supabase schema guidance must match release-contract latestMigration');
}

for (const finding of auditFrontendAssetContract({
  packageVersion:pkg.version,
  runtimeRevision:FRONTEND_ASSET_REVISION,
  surfaces:{public:html,admin:adminHtml,status:statusHtml},
  headers:staticHeaders,
})) {
  failures.push(`Frontend asset contract: ${finding}`);
}

if (!premiumUiStyles.includes('--mr-touch-target: 44px')) {
  failures.push('Public UI canonical touch-target contract is missing');
}

for (const required of [
  'src/release-identity.js',
  'src/release-event-attribution.js',
  'src/post-deploy-regression.js',
  'src/post-deploy-regression-lifecycle.js',
  'scripts/post-deploy-smoke.js',
  'scripts/verify-production-release-postcondition.js',
  'scripts/verify-main-pr-provenance.js',
  'scripts/verify-rollback-target.js',
  'scripts/rollback-smoke.js',
]) {
  if (!fs.existsSync(required)) failures.push(`Missing release artifact: ${required}`);
}

if (!wrangler.includes('"version_metadata"') || !wrangler.includes('"binding": "CF_VERSION_METADATA"')) {
  failures.push('Cloudflare version metadata binding is missing');
}
if (!deployWorkflow.includes(`RELEASE_VERSION: "${expected}"`)) {
  failures.push('Production deploy must pin the verified release-contract runtime version');
}
if (!deployWorkflow.includes('verify-main-pr-provenance.js')) {
  failures.push('Production deploy must verify merged-PR provenance');
}
if (!deployWorkflow.includes('--tag "${{ env.DEPLOY_SHA }}"')) {
  failures.push('Production deploy must tag the Cloudflare version with deploy SHA');
}
if (!deployWorkflow.includes('--message "release=${{ env.RELEASE_VERSION }} sha=${{ env.DEPLOY_SHA }}"')) {
  failures.push('Production deploy message must bind release version and deploy SHA');
}
if (!deployWorkflow.includes('verify-production-release-postcondition.js')) {
  failures.push('Production deploy must verify the Cloudflare release postcondition');
}
if (!deployWorkflow.includes('post-deploy-smoke.js "$SMOKE_URL" "$RELEASE_VERSION" "$EXPECTED_RUNTIME_SHA"')) {
  failures.push('Production smoke must verify release version and exact runtime SHA');
}
if (!deployWorkflow.includes('Automatic rollback after failed production verification')) {
  failures.push('Production deploy must keep automatic rollback after failed verification');
}

for (const criticalTest of [
  'test/deployment-workflow.test.js',
  'test/production-deploy-provenance-rc111.test.js',
  'test/production-release-postcondition-rc120.test.js',
  'test/security-public-traffic-hardening.test.js',
  'test/starting-xi-player-strength.test.js',
  'test/supabase-integration-ci.test.js',
]) {
  if (!releaseTests.includes(criticalTest)) {
    failures.push(`Release test manifest is missing: ${criticalTest}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata, assets, database contract and deploy provenance are consistent for ${expected}.`);
