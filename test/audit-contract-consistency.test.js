import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTelemetryOpsRuntime } from '../src/telemetry-ops-runtime.js';

const repoRoot=fileURLToPath(new URL('../',import.meta.url));

function repoPath(relativePath) {
  return path.join(repoRoot,...String(relativePath).split('/'));
}

function read(relativePath) {
  return readFileSync(repoPath(relativePath),'utf8');
}

function exists(relativePath) {
  return existsSync(repoPath(relativePath));
}

function walk(relativeDir) {
  const absolute=repoPath(relativeDir);
  return readdirSync(absolute,{withFileTypes:true}).flatMap(entry=>{
    const child=path.join(absolute,entry.name);
    const relative=path.relative(repoRoot,child).split(path.sep).join('/');
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

function migrationParts(name) {
  const match=/^supabase_migration_v(\d+)_(\d+)(?:_(\d+))?\.sql$/.exec(name);
  return match ? match.slice(1).map(value=>Number(value || 0)) : null;
}

function latestMigrationName() {
  const migrations=readdirSync(repoPath('supabase/migrations'))
    .filter(name=>migrationParts(name));
  return [...migrations].sort((left,right)=>{
    const a=migrationParts(left);
    const b=migrationParts(right);
    for(let index=0;index<3;index+=1) {
      if(a[index]!==b[index]) return a[index]-b[index];
    }
    return 0;
  }).at(-1);
}

function assetHeaderBlock(asset) {
  const headers=read('public/_headers');
  return headers.split(asset+'\n')[1]?.split('\n\n')[0] || '';
}

function createTelemetryRuntime(overrides={}) {
  const memory={
    telemetry:{},
    opsEvents:[],
  };
  return {
    memory,
    runtime:createTelemetryOpsRuntime({
      MAX_MEMORY_OPS_EVENTS:50,
      currentReleaseIdentity:()=>({deploySha:'a'.repeat(40)}),
      fetchWithTimeout:async()=>new Response(null,{status:204}),
      hasSupabase:()=>false,
      memory,
      observeProviderRequestLocal:()=>{},
      supaHeaders:()=>({}),
      supaRpc:async()=>({ok:true}),
      ...overrides,
    }),
  };
}

const sourceFiles=walk('src').filter(file=>file.endsWith('.js'));
const sourceText=sourceFiles.map(read).join('\n');
const app=read('public/app.js');
const envExample=read('.env.example');
const packageMeta=JSON.parse(read('package.json'));
const releaseContract=JSON.parse(read('release-contract.json'));
const indexHtml=read('public/index.html');
const statusHtml=read('public/status.html');
const wranglerConfig=JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
const telemetrySource=read('src/telemetry-ops-runtime.js');
const infrastructureSource=read('src/common-infrastructure-runtime.js');
const bootstrapSource=read('src/worker-bootstrap-runtime.js');
const growthReferral=read('src/growth-referral.js');

test('audit: release contract tracks the numerically newest production migration',()=>{
  const latest=latestMigrationName();
  assert.ok(latest,'at least one numbered migration must exist');

  assert.equal(
    releaseContract.latestMigration,
    path.posix.join('supabase','migrations',latest),
  );
  assert.equal(exists(releaseContract.latestMigration),true);

  const [major,minor]=migrationParts(latest);
  assert.equal(releaseContract.productionSchema,`${major}.${minor}`);
  assert.equal(exists(releaseContract.freshInstallBaseline),true);
});

test('audit: frontend literal API routes are represented in the backend source graph',()=>{
  const routes=[...app.matchAll(/[\x22\x27\x60](\/api\/[A-Za-z0-9_?=&/.\-:]*)/g)]
    .map(match=>match[1].split('?')[0].replace(/\/$/,''));

  assert.ok(routes.length>0,'frontend must expose at least one literal API route');
  for(const route of new Set(routes)) {
    assert.ok(sourceText.includes(route),`Backend route missing: ${route}`);
  }
});

test('audit: every operator-managed Worker env variable is declared by docs or platform config',()=>{
  const used=new Set(
    [...sourceText.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map(match=>match[1]),
  );
  const documented=new Set(
    [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match=>match[1]),
  );
  const platformBindings=new Set([
    wranglerConfig?.version_metadata?.binding,
    ...((wranglerConfig?.ratelimits || []).map(item=>item?.name)),
  ].filter(Boolean));
  const configuredVars=new Set(Object.keys(wranglerConfig?.vars || {}));

  assert.deepEqual(
    [...used].filter(name=>!documented.has(name) && !platformBindings.has(name)).sort(),
    [],
  );
  assert.deepEqual(
    [...configuredVars].filter(name=>!documented.has(name)).sort(),
    [],
  );
  assert.ok(platformBindings.has('CF_VERSION_METADATA'));
  assert.ok(platformBindings.has('EDGE_ANALYZE_RATE_LIMIT'));
  assert.ok(platformBindings.has('EDGE_SENSITIVE_RATE_LIMIT'));
  assert.ok(platformBindings.has('EDGE_WEBHOOK_RATE_LIMIT'));
});

test('audit: shipped source does not reference removed migration files',()=>{
  const files=[
    ...walk('src').filter(file=>file.endsWith('.js')),
    ...walk('public').filter(file=>/\.(?:js|html)$/.test(file)),
    ...walk('supabase/migrations').filter(file=>file.endsWith('.sql')),
    ...readdirSync(repoRoot).filter(file=>file.endsWith('.md')),
  ];

  const missing=[];
  for(const file of files) {
    const text=read(file);
    for(const match of text.matchAll(/supabase_migration_(v\d+(?:_\d+)*)\.sql/g)) {
      const expected=`supabase/migrations/supabase_migration_${match[1]}.sql`;
      if(!exists(expected)) missing.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(missing,[]);
});

test('audit: operational metadata recursively removes identifiers and redacts embedded secrets',()=>{
  const {runtime}=createTelemetryRuntime();

  const clean=runtime.safeOpsMetadata({
    telegramId:123,
    username:'private-user',
    safe:'Bearer abc.def',
    nested:{
      user_id:456,
      keep:'bot12345:secret_token',
      deeper:{
        apiKey:'private-key',
        value:'x-apisports-key: provider-secret',
      },
    },
    list:[
      {chatId:789,ok:'sb_secret_private'},
      {label:'visible'},
    ],
  });

  assert.equal('telegramId' in clean,false);
  assert.equal('username' in clean,false);
  assert.equal(clean.safe,'Bearer [redacted]');
  assert.deepEqual(clean.nested,{
    keep:'bot[redacted]',
    deeper:{value:'api-key=[redacted]'},
  });
  assert.deepEqual(clean.list,[
    {ok:'sb_secret_[redacted]'},
    {label:'visible'},
  ]);

  assert.match(telemetrySource,/function sensitiveOpsMetadataKey/);
  assert.doesNotMatch(
    telemetrySource,
    /JSON\.parse\(redactOpsString\(JSON\.stringify\(value\)/,
  );
});

test('audit: operational telemetry remains fail-soft when helper hooks fail',async()=>{
  const {runtime,memory}=createTelemetryRuntime({
    currentReleaseIdentity:()=>{ throw new Error('identity unavailable'); },
    hasSupabase:()=>{ throw new Error('supabase probe unavailable'); },
    observeProviderRequestLocal:()=>{ throw new Error('local observer unavailable'); },
  });

  const row=await runtime.recordOpsEvent({
    waitUntil:()=>{ throw new Error('bad waitUntil'); },
  },{
    severity:'warning',
    source:'audit',
    eventType:'boundary',
    meta:{
      telegramId:123,
      safe:'Bearer secret',
    },
  });

  assert.equal(row._persistenceStatus,'memory_only');
  assert.equal(row.metadata.telegramId,undefined);
  assert.equal(row.metadata.safe,'Bearer [redacted]');
  assert.equal(memory.telemetry.opsWaitUntilErrors,1);

  const provider=await runtime.observeProviderRequest({provider:'api-football',outcome:'success'},{});
  assert.deepEqual(provider,{
    ok:true,
    persistent:false,
    reason:'supabase_not_configured',
  });
  assert.equal(memory.telemetry.providerObservabilityErrors,1);
});

test('audit: native external fetch ownership stays inside the shared timeout transport',()=>{
  const owners=new Set();
  for(const file of sourceFiles) {
    if(/\bawait\s+fetch\s*\(/.test(read(file))) owners.add(file);
  }

  assert.deepEqual([...owners].sort(),['src/common-infrastructure-runtime.js','src/sensitive-mutation-replay.js']);
  const replayTransport=read('src/sensitive-mutation-replay.js');
  assert.match(replayTransport,/const controller=new AbortController\(\)/);
  assert.match(replayTransport,/setTimeout\(\(\)=>controller\.abort\(\),boundedTimeout\(timeoutMs\)\)/);
  assert.match(replayTransport,/signal:controller\.signal/);
  assert.match(replayTransport,/finally \{\s*clearTimeout\(timer\)/);
  assert.match(
    infrastructureSource,
    /async function fetchWithTimeout\([\s\S]*?return await fetch\(input, \{ \.\.\.init, signal: controller\.signal \}\)/,
  );
  assert.match(telemetrySource,/fetchWithTimeout\(url,/);
});

test('audit: versioned public entrypoint assets are immutable while mutable shells revalidate',()=>{
  const version=packageMeta.version;
  const frontendRevision=/<meta name="frontend-asset-revision" content="([^"]+)" \/>/
    .exec(indexHtml)?.[1] || '';

  assert.ok(frontendRevision.startsWith(version+'-'));
  for(const asset of [
    '/app.js',
    '/styles.css',
    '/styles/public-shell.css',
    '/styles/premium-ui.css',
  ]) {
    assert.ok(
      indexHtml.includes(`${asset}?v=${frontendRevision}"`)
        || indexHtml.includes(`${asset}?v=${frontendRevision}'`),
      `${asset} must use the frontend revision`,
    );
    assert.match(assetHeaderBlock(asset),/immutable/i);
  }

  assert.ok(
    statusHtml.includes(`/status.js?v=${frontendRevision}"`)
      || statusHtml.includes(`/status.js?v=${frontendRevision}'`),
  );
  assert.match(assetHeaderBlock('/status.js'),/must-revalidate/i);
  assert.match(assetHeaderBlock('/modules/*'),/must-revalidate/i);
  for(const shell of ['/index.html','/admin.html','/status.html']) {
    assert.match(assetHeaderBlock(shell),/must-revalidate/i);
    assert.doesNotMatch(assetHeaderBlock(shell),/immutable/i);
  }
});

test('audit: fire-and-forget observability is anchored to the Cloudflare lifecycle',()=>{
  assert.match(
    bootstrapSource,
    /function buildConfig\(env,ctx\)[\s\S]*?cfg\.waitUntil=promise=>ctx\.waitUntil\(Promise\.resolve\(promise\)\)/,
  );
  assert.match(
    bootstrapSource,
    /async fetch\(request, env, ctx\)[\s\S]*?cfg=buildConfig\(env,ctx\)/,
  );
  assert.match(
    bootstrapSource,
    /async scheduled\(controller, env, ctx\)[\s\S]*?cfg=buildConfig\(env,ctx\)/,
  );
  assert.match(
    growthReferral,
    /async function recordGrowthEvent\(cfg,eventInput=\{\}\)[\s\S]*?safeRead\(cfg,'waitUntil'\)[\s\S]*?waitUntil\.call\(cfg,task\)[\s\S]*?return await task/,
  );
  assert.match(
    telemetrySource,
    /async function recordOpsEvent\(cfg, event = \{\}\)[\s\S]*?waitUntil\.call\(cfg,task\)[\s\S]*?return await task/,
  );
});

test('audit: top-level route errors are redacted before console logging',()=>{
  assert.match(
    bootstrapSource,
    /console\.error\(\s*'api route',\s*safeRedact\(safeRead\(error,'message'\) \|\| error,240\)/,
  );
  assert.match(
    bootstrapSource,
    /console\.error\('telegram webhook',safeRedact\(safeRead\(error,'message'\) \|\| error,240\)\)/,
  );
  assert.doesNotMatch(bootstrapSource,/console\.error\(error\)/);
  assert.doesNotMatch(bootstrapSource,/console\.error\('telegram webhook',\s*error\)/);
});

test('audit: release/package/frontend revisions stay mutually consistent',()=>{
  const version=packageMeta.version;
  const frontendRevision=/<meta name="frontend-asset-revision" content="([^"]+)" \/>/
    .exec(indexHtml)?.[1] || '';

  assert.equal(releaseContract.applicationVersion,version);
  assert.ok(String(releaseContract.runtimeVersion || '').startsWith(version+'-'));
  assert.ok(frontendRevision.startsWith(version+'-'));
  assert.ok(statusHtml.includes(`/status.js?v=${frontendRevision}"`));
});

test('audit: Worker bootstrap owns both fetch and scheduled entrypoints',()=>{
  assert.match(bootstrapSource,/return Object\.freeze\(\{/);
  assert.match(bootstrapSource,/async fetch\(request, env, ctx\)/);
  assert.match(bootstrapSource,/async scheduled\(controller, env, ctx\)/);
  assert.match(
    read('src/worker.js'),
    /export default createWorkerBootstrapRuntime\(\{/,
  );
});
