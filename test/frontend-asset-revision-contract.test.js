import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';
import {
  IMMUTABLE_FRONTEND_ASSETS,
  auditFrontendAssetContract,
  localAssetReferences,
  surfaceRevisionValues,
} from '../scripts/frontend-asset-audit.js';

const pkg=JSON.parse(
  readFileSync(new URL('../package.json',import.meta.url),'utf8'),
);
const publicHtml=readFileSync(
  new URL('../public/index.html',import.meta.url),
  'utf8',
);
const adminHtml=readFileSync(
  new URL('../public/admin.html',import.meta.url),
  'utf8',
);
const statusHtml=readFileSync(
  new URL('../public/status.html',import.meta.url),
  'utf8',
);
const headers=readFileSync(
  new URL('../public/_headers',import.meta.url),
  'utf8',
);
const verifier=readFileSync(
  new URL('../scripts/verify-release.js',import.meta.url),
  'utf8',
);

function audit(overrides={}) {
  return auditFrontendAssetContract({
    packageVersion:overrides.packageVersion ?? pkg.version,
    runtimeRevision:overrides.runtimeRevision ?? FRONTEND_ASSET_REVISION,
    surfaces:{
      public:overrides.public ?? publicHtml,
      admin:overrides.admin ?? adminHtml,
      status:overrides.status ?? statusHtml,
    },
    headers:overrides.headers ?? headers,
  });
}

test('frontend asset revision production contract passes semantic audit',()=>{
  assert.deepEqual(audit(),[]);
  assert.match(
    FRONTEND_ASSET_REVISION,
    new RegExp(
      '^'+pkg.version.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&')
      +'-launch\\d+$',
    ),
  );
  assert.deepEqual(
    surfaceRevisionValues(publicHtml),
    [FRONTEND_ASSET_REVISION],
  );
  assert.deepEqual(
    surfaceRevisionValues(adminHtml),
    [FRONTEND_ASSET_REVISION],
  );
});

test('public and admin immutable entrypoints use one exact current revision token',()=>{
  const expected={
    public:[
      '/app.js',
      '/styles.css',
      '/styles/public-shell.css',
      '/styles/premium-ui.css',
    ],
    admin:[
      '/app.js',
      '/styles.css',
      '/styles/public-shell.css',
    ],
  };

  for (const [name,html] of [
    ['public',publicHtml],
    ['admin',adminHtml],
  ]) {
    const refs=localAssetReferences(html);
    for (const assetPath of expected[name]) {
      const matching=refs.filter(ref=>ref.path===assetPath);
      assert.equal(matching.length,1,assetPath);
      assert.equal(matching[0].revision,FRONTEND_ASSET_REVISION);
      assert.deepEqual(matching[0].queryKeys,['v']);
      assert.equal(matching[0].revisionCount,1);
      assert.equal(matching[0].hash,'');
    }
  }

  assert.deepEqual(
    IMMUTABLE_FRONTEND_ASSETS,
    [
      '/app.js',
      '/styles.css',
      '/styles/public-shell.css',
      '/styles/premium-ui.css',
    ],
  );
});

test('status surface shares the release revision even though status.js is revalidated',()=>{
  const refs=localAssetReferences(statusHtml)
    .filter(ref=>ref.path==='/status.js');
  assert.equal(refs.length,1);
  assert.equal(refs[0].revision,FRONTEND_ASSET_REVISION);
  assert.equal(refs[0].attrs.type,'module');
});

test('duplicate or stale revision metadata fails closed',()=>{
  const duplicated=publicHtml.replace(
    '</head>',
    '<meta name="frontend-asset-revision" content="'
      +FRONTEND_ASSET_REVISION+'" />\n</head>',
  );
  assert.ok(
    audit({public:duplicated})
      .some(item=>item.includes('exactly one frontend asset revision meta')),
  );

  const stale=adminHtml.replaceAll(
    FRONTEND_ASSET_REVISION,
    pkg.version+'-launch1',
  );
  const findings=audit({admin:stale});
  assert.ok(
    findings.some(item=>item.includes('admin surface revision must match')),
  );
  assert.ok(
    findings.some(item=>item.includes('admin /app.js must use only')),
  );
});

test('immutable asset references reject missing, duplicate and mixed query tokens',()=>{
  const noRevision=publicHtml.replace(
    '/app.js?v='+FRONTEND_ASSET_REVISION,
    '/app.js',
  );
  assert.ok(
    audit({public:noRevision})
      .some(item=>item.includes('/app.js must use only')),
  );

  const duplicateRevision=publicHtml.replace(
    '/styles.css?v='+FRONTEND_ASSET_REVISION,
    '/styles.css?v='+FRONTEND_ASSET_REVISION
      +'&v='+FRONTEND_ASSET_REVISION,
  );
  assert.ok(
    audit({public:duplicateRevision})
      .some(item=>item.includes('/styles.css must use only')),
  );

  const mixedQuery=publicHtml.replace(
    '/styles/public-shell.css?v='+FRONTEND_ASSET_REVISION,
    '/styles/public-shell.css?v='+FRONTEND_ASSET_REVISION+'&debug=1',
  );
  assert.ok(
    audit({public:mixedQuery})
      .some(item=>item.includes('/styles/public-shell.css must use only')),
  );
});

test('entrypoint scripts must remain modules and each required asset appears once',()=>{
  const classic=adminHtml.replace(
    '<script type="module" src="/app.js?v='+FRONTEND_ASSET_REVISION+'">',
    '<script src="/app.js?v='+FRONTEND_ASSET_REVISION+'">',
  );
  assert.ok(
    audit({admin:classic})
      .some(item=>item.includes('/app.js must load as a module script')),
  );

  const duplicate=publicHtml.replace(
    '</head>',
    '<link rel="stylesheet" href="/styles.css?v='
      +FRONTEND_ASSET_REVISION+'" />\n</head>',
  );
  assert.ok(
    audit({public:duplicate})
      .some(item=>item.includes('/styles.css exactly once')),
  );
});

test('status revision drift is caught independently of immutable cache policy',()=>{
  const stale=statusHtml.replace(
    '/status.js?v='+FRONTEND_ASSET_REVISION,
    '/status.js?v='+pkg.version+'-launch1',
  );
  assert.ok(
    audit({status:stale})
      .some(item=>item.includes('status /status.js must use only')),
  );
});

test('cache policy mutations fail closed for immutable, module and HTML paths',()=>{
  const mutableApp=headers.replace(
    '/app.js\n  Cache-Control: public, max-age=31536000, immutable',
    '/app.js\n  Cache-Control: public, max-age=0, must-revalidate',
  );
  assert.ok(
    audit({headers:mutableApp})
      .some(item=>item.includes('/app.js must use public max-age=31536000 immutable')),
  );

  const immutableModules=headers.replace(
    '/modules/*\n  Cache-Control: public, max-age=0, must-revalidate',
    '/modules/*\n  Cache-Control: public, max-age=31536000, immutable',
  );
  assert.ok(
    audit({headers:immutableModules})
      .some(item=>item.includes('/modules/* must use public max-age=0 must-revalidate')),
  );

  const immutableHtml=headers.replace(
    '/admin.html\n  Cache-Control: no-cache, max-age=0, must-revalidate',
    '/admin.html\n  Cache-Control: public, max-age=31536000, immutable',
  );
  assert.ok(
    audit({headers:immutableHtml})
      .some(item=>item.includes('/admin.html must use no-cache')),
  );
});

test('duplicate Cache-Control sections cannot hide a conflicting policy',()=>{
  const duplicate=headers
    +'\n/app.js\n  Cache-Control: public, max-age=0, must-revalidate\n';
  assert.ok(
    audit({headers:duplicate})
      .some(item=>item.includes('/app.js must define exactly one Cache-Control')),
  );
});

test('release verification consumes the semantic frontend asset audit',()=>{
  assert.match(
    verifier,
    /auditFrontendAssetContract/,
  );
  assert.match(
    verifier,
    /Frontend asset contract:/,
  );
  assert.doesNotMatch(
    verifier,
    /runtimeFrontendAssetRevision/,
  );
});
