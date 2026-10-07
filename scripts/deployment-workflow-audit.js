import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_RELEASE_GATES=Object.freeze([
  'npm audit --audit-level=high',
  'npm run security:dependencies',
  'npm run security:scan',
  'npm run security:privileged',
  'npm run lint',
  'npm run check',
  'npm test',
  'node scripts/bottom-nav-render-smoke.js',
  'npm run verify:release',
  'npm run verify:worker',
]);

function source(value) {
  return typeof value==='string' ? value : '';
}

function stripYamlComment(line) {
  let quote='';
  let escaped=false;
  for (let index=0; index<line.length; index+=1) {
    const char=line[index];
    if (quote) {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\' && quote==='"') {
        escaped=true;
        continue;
      }
      if (char===quote) quote='';
      continue;
    }
    if (char==='"' || char==="'") {
      quote=char;
      continue;
    }
    if (char==='#') return line.slice(0,index);
  }
  return line;
}

function workflowSource(value) {
  return source(value)
    .split(/\r?\n/)
    .map(stripYamlComment)
    .join('\n');
}

function stepBlock(workflow,name) {
  const text=source(workflow);
  const marker='- name: '+name;
  const index=text.indexOf(marker);
  if (index<0) return '';
  const tail=text.slice(index);
  const next=tail.slice(marker.length).search(/\n\s*- name: /);
  return next<0 ? tail : tail.slice(0,marker.length+next);
}

function requireContains(findings,label,text,needle) {
  if (!source(text).includes(needle)) findings.push(label+' is missing '+needle);
}

function requireOrder(findings,label,text,names) {
  let cursor=-1;
  for (const name of names) {
    const index=source(text).indexOf(name);
    if (index<0) {
      findings.push(label+' is missing '+name);
      continue;
    }
    if (index<=cursor) findings.push(label+' has unsafe ordering around '+name);
    cursor=Math.max(cursor,index);
  }
}

function actionRefs(workflow) {
  const refs=[];
  for (const match of source(workflow).matchAll(/\buses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    refs.push(match[1]);
  }
  return refs;
}

function isFullCommitPin(ref) {
  const at=ref.lastIndexOf('@');
  return at>0 && /^[0-9a-f]{40}$/i.test(ref.slice(at+1));
}

export function auditDeploymentWorkflowSources({
  deploy,
  rollback,
  quality,
  wrangler,
}={}) {
  const findings=[];
  const deployText=workflowSource(deploy);
  const rollbackText=workflowSource(rollback);
  const qualityText=workflowSource(quality);
  const wranglerText=source(wrangler);

  for (const marker of [
    'workflow_run:',
    'workflows: [Quality]',
    'types: [completed]',
    'branches: [main]',
    'workflow_dispatch:',
    "github.event.workflow_run.conclusion == 'success'",
    "DEPLOY_SHA: ${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
    'ref: ${{ env.DEPLOY_SHA }}',
    'git fetch --no-tags origin main',
    'CURRENT_MAIN_SHA="$(git rev-parse origin/main)"',
    'VERIFIED_SHA="$(git rev-parse HEAD)"',
    'if [[ "$DEPLOY_SHA" != "$CURRENT_MAIN_SHA" ]]',
  ]) requireContains(findings,'deploy provenance',deployText,marker);

  const reverify=stepBlock(deployText,'Re-verify release artifact');
  if (!reverify) findings.push('deploy must contain Re-verify release artifact step');
  for (const gate of REQUIRED_RELEASE_GATES) {
    requireContains(findings,'deploy re-verification',reverify,gate);
    requireContains(findings,'Quality gate',qualityText,gate);
  }

  const credentialStep=stepBlock(deployText,'Check Cloudflare credentials');
  requireContains(findings,'credential preflight',credentialStep,'CLOUDFLARE_API_TOKEN');
  requireContains(findings,'credential preflight',credentialStep,'CLOUDFLARE_ACCOUNT_ID');
  requireContains(findings,'credential preflight',credentialStep,'exit 1');
  if (/echo[^\n]*(?:\$CLOUDFLARE_API_TOKEN|\$CLOUDFLARE_ACCOUNT_ID)/.test(credentialStep)) {
    findings.push('credential preflight must not echo Cloudflare secret values');
  }

  requireOrder(findings,'production mutation path',deployText,[
    '- name: Check Cloudflare credentials',
    '- name: Detect pending production artifact changes',
    '- name: Preflight previous-known-good rollback target',
    '- name: Deploy Worker',
    '- name: RC120 verify active production release identity',
    '- name: Verify production deployment',
    '- name: Automatic rollback after failed production verification',
  ]);

  const detection=stepBlock(deployText,'Detect pending production artifact changes');
  for (const marker of [
    '--print-active-rollback-target',
    'rollback_ready=false',
    'Safe production deployment blocked',
    'automatic rollback target cannot be proven',
    'git merge-base --is-ancestor "$ACTIVE_SHA" "$DEPLOY_SHA"',
    'git diff --quiet "$ACTIVE_SHA" "$DEPLOY_SHA" -- src public wrangler.jsonc package.json package-lock.json',
    'exit 1',
  ]) requireContains(findings,'production change detection',detection,marker);

  const deployStep=stepBlock(deployText,'Deploy Worker');
  for (const marker of [
    "if: steps.production_changes.outputs.changed == 'true'",
    'deploy --keep-vars',
    '--tag "${{ env.DEPLOY_SHA }}"',
    'release=${{ env.RELEASE_VERSION }} sha=${{ env.DEPLOY_SHA }}',
  ]) requireContains(findings,'Worker deploy step',deployStep,marker);

  const identity=stepBlock(deployText,'RC120 verify active production release identity');
  for (const marker of [
    "if: steps.production_changes.outputs.changed == 'true'",
    'for attempt in 1 2 3 4 5 6 7 8 9 10; do',
    'sleep 6',
    'verify-production-release-postcondition.js',
  ]) requireContains(findings,'production identity verification',identity,marker);

  const verify=stepBlock(deployText,'Verify production deployment');
  if (/^\s*if:/m.test(verify)) {
    findings.push('production smoke verification must run for changed and unchanged runtime');
  }
  for (const marker of [
    'RUNTIME_CHANGED: ${{ steps.production_changes.outputs.changed }}',
    'ACTIVE_RUNTIME_SHA: ${{ steps.production_changes.outputs.active_sha }}',
    'EXPECTED_RUNTIME_SHA="$ACTIVE_RUNTIME_SHA"',
    'scripts/post-deploy-smoke.js',
    'scripts/bottom-nav-render-smoke.js',
  ]) requireContains(findings,'production smoke verification',verify,marker);

  const automaticRollback=stepBlock(deployText,'Automatic rollback after failed production verification');
  for (const marker of [
    "failure() && steps.production_changes.outputs.changed == 'true' && steps.deploy.outcome == 'success'",
    'npx wrangler rollback "$PREVIOUS_VERSION_ID" --yes',
    'verify-rollback-deployment.js',
    'verify-rollback-target.js',
    'scripts/rollback-smoke.js',
  ]) requireContains(findings,'automatic rollback',automaticRollback,marker);

  const allActionRefs=[
    ...actionRefs(deployText),
    ...actionRefs(rollbackText),
    ...actionRefs(qualityText),
  ];
  for (const ref of allActionRefs) {
    if (!isFullCommitPin(ref)) findings.push('GitHub Action must be pinned to a full commit SHA: '+ref);
  }
  if (allActionRefs.some(ref=>/@v\d+(?:\.|$)/i.test(ref))) {
    findings.push('mutable version-tag GitHub Actions are forbidden');
  }

  for (const marker of [
    'inputs.confirm == format(\'ROLLBACK:{0}:{1}\', inputs.expected_version, inputs.version_id)',
    'if [[ "${GITHUB_REF}" != "refs/heads/main" ]]',
    'CURRENT_MAIN_SHA="$(git rev-parse origin/main)"',
    'if [[ "$ROLLBACK_WORKFLOW_SHA" != "$CURRENT_MAIN_SHA" ]]',
    'npx wrangler versions view "$VERSION_ID" --json',
    'verify-rollback-target.js',
    'npx wrangler rollback "$VERSION_ID" --yes',
    'verify-rollback-deployment.js',
    'scripts/rollback-smoke.js "$ROLLBACK_URL" "$EXPECTED_VERSION"',
  ]) requireContains(findings,'manual rollback',rollbackText,marker);

  const rollbackMutation=rollbackText.indexOf('- name: Roll back Worker');
  const rollbackTargetCheck=rollbackText.indexOf('- name: RC117 verify rollback release identity');
  if (rollbackTargetCheck<0 || rollbackMutation<0 || rollbackTargetCheck>=rollbackMutation) {
    findings.push('manual rollback target identity must be verified before mutation');
  }

  for (const marker of [
    '"/health"',
    '"/health/*"',
  ]) requireContains(findings,'Worker-first health routing',wranglerText,marker);

  return findings;
}

export function auditDeploymentWorkflowFiles({
  deployPath='.github/workflows/deploy-production.yml',
  rollbackPath='.github/workflows/rollback-production.yml',
  qualityPath='.github/workflows/quality.yml',
  wranglerPath='wrangler.jsonc',
}={}) {
  return auditDeploymentWorkflowSources({
    deploy:fs.readFileSync(deployPath,'utf8'),
    rollback:fs.readFileSync(rollbackPath,'utf8'),
    quality:fs.readFileSync(qualityPath,'utf8'),
    wrangler:fs.readFileSync(wranglerPath,'utf8'),
  });
}

function runCli() {
  const findings=auditDeploymentWorkflowFiles();
  if (!findings.length) {
    console.log('Deployment workflow audit: production deploy and rollback policy are aligned.');
    return;
  }
  console.error('Deployment workflow audit failed:');
  for (const finding of findings) console.error('- '+finding);
  process.exitCode=1;
}

const invokedPath=process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath=fileURLToPath(import.meta.url);
if (invokedPath && modulePath===invokedPath) runCli();
