import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPublicFiles,
  auditWorkflow,
  auditWranglerVars,
  workflowActionRefs,
  workflowSecretRefs,
} from '../scripts/privileged-access-audit.js';
import {
  applyReviewedSyntheticFixtureAllowlist,
  parseHistoricalAddedPaths,
  parseHistoricalPatchForSecrets,
} from '../scripts/security-history-scan.js';

test('workflow audit allows only expected production secret references and pinned actions', () => {
  const source=`name: Deploy
permissions:
  contents: read
jobs:
  deploy:
    environment: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
      - env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: echo deploy
`;
  const findings=auditWorkflow('.github/workflows/deploy-production.yml',source);
  assert.deepEqual(findings,[]);
  assert.deepEqual(workflowSecretRefs(source),['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']);
  assert.deepEqual(workflowActionRefs(source),['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1']);
});

test('workflow audit rejects unexpected secrets, unpinned actions and missing production environment', () => {
  const source=`name: Deploy
permissions:
  contents: read
jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
      - env:
          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
        run: echo deploy
`;
  const findings=auditWorkflow('.github/workflows/deploy-production.yml',source);
  assert.ok(findings.some(item=>item.type==='unexpected_secret_reference' && item.name==='TELEGRAM_BOT_TOKEN'));
  assert.ok(findings.some(item=>item.type==='unpinned_action'));
  assert.ok(findings.some(item=>item.type==='production_environment_missing'));
});

test('workflow audit rejects write-all permissions', () => {
  const findings=auditWorkflow('.github/workflows/quality.yml',`name: q
permissions: write-all
`);
  assert.ok(findings.some(item=>item.type==='write_all_permissions'));
});

test('wrangler vars audit blocks secret-like names from plaintext vars', () => {
  const findings=auditWranglerVars(`{
  "vars": {
    "DEV_MODE": "false",
    "TELEGRAM_BOT_TOKEN": "placeholder"
  }
}`);
  assert.ok(findings.some(item=>item.type==='secret_like_worker_var' && item.name==='TELEGRAM_BOT_TOKEN'));
});

test('public asset audit detects server-only secret names without exposing values', () => {
  const findings=auditPublicFiles(['public/app.js'],()=>`const key = "SUPABASE_SECRET_KEY";`);
  assert.deepEqual(findings,[{
    path:'public/app.js',
    type:'server_secret_name_in_public_asset',
    name:'SUPABASE_SECRET_KEY',
  }]);
});

test('history path parser detects forbidden secret files with commit evidence', () => {
  const parsed=parseHistoricalAddedPaths([
    '@@0123456789abcdef0123456789abcdef01234567',
    '.env',
    'src/worker.js',
    '@@89abcdef0123456789abcdef0123456789abcdef',
    '.env.example',
  ].join('\n'));
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].path,'.env');
  assert.equal(parsed[0].commit,'0123456789abcdef0123456789abcdef01234567');
});

test('historical patch parser reports secret location but not the matched value', () => {
  const secret=['123456789',':','A'.repeat(32)].join('');
  const patch=[
    '@@COMMIT:0123456789abcdef0123456789abcdef01234567',
    'diff --git a/src/file.js b/src/file.js',
    '--- a/src/file.js',
    '+++ b/src/file.js',
    '@@ -13,0 +14 @@',
    '+'+secret,
  ].join('\n');
  const parsed=parseHistoricalPatchForSecrets(patch);
  assert.deepEqual(parsed,[{
    commit:'0123456789abcdef0123456789abcdef01234567',
    path:'src/file.js',
    line:14,
    type:'telegram_bot_token',
  }]);
  assert.equal(JSON.stringify(parsed).includes(secret),false);
});


test('reviewed synthetic fixture allowlist suppresses only the exact reviewed count', () => {
  const key='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|test/example.test.js|telegram_bot_token';
  const finding={
    commit:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    path:'test/example.test.js',
    line:10,
    type:'telegram_bot_token',
  };
  const one=applyReviewedSyntheticFixtureAllowlist([finding],{[key]:1});
  assert.equal(one.reviewed.length,1);
  assert.equal(one.actionable.length,0);

  const extra=applyReviewedSyntheticFixtureAllowlist([
    finding,
    {...finding,line:11},
  ],{[key]:1});
  assert.equal(extra.reviewed.length,1);
  assert.equal(extra.actionable.length,1);
  assert.equal(extra.actionable[0].line,11);
});

test('reviewed synthetic fixture allowlist never suppresses another commit or path', () => {
  const key='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa|test/example.test.js|telegram_bot_token';
  const review=applyReviewedSyntheticFixtureAllowlist([
    {
      commit:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      path:'test/example.test.js',
      line:10,
      type:'telegram_bot_token',
    },
    {
      commit:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      path:'src/example.js',
      line:10,
      type:'telegram_bot_token',
    },
  ],{[key]:2});
  assert.equal(review.reviewed.length,0);
  assert.equal(review.actionable.length,2);
});
