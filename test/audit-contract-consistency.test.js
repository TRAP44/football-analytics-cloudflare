import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
const sourceFiles=walk('src').filter(file=>file.endsWith('.js'));
const sourceText=sourceFiles.map(file=>fs.readFileSync(file,'utf8')).join('\n');
const app=fs.readFileSync('public/app.js','utf8');
const envExample=fs.readFileSync('.env.example','utf8');
const assetHeaders=fs.readFileSync('public/_headers','utf8');
const packageMeta=JSON.parse(fs.readFileSync('package.json','utf8'));
const releaseContract=JSON.parse(fs.readFileSync('release-contract.json','utf8'));
const indexHtml=fs.readFileSync('public/index.html','utf8');
const statusHtml=fs.readFileSync('public/status.html','utf8');
const wranglerConfig=fs.readFileSync('wrangler.jsonc','utf8');

function walk(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    return entry.isDirectory()?walk(full):[full];
  });
}

test('audit: release contract tracks the newest production migration',()=>{
  const migrationDir=path.join('supabase','migrations');
  const migrations=fs.readdirSync(migrationDir).filter(name=>/^supabase_migration_v\d+_\d+(?:_\d+)?\.sql$/.test(name));
  const parts=name=>/^supabase_migration_v(\d+)_(\d+)(?:_(\d+))?\.sql$/.exec(name).slice(1).map(value=>Number(value||0));
  const latest=[...migrations].sort((a,b)=>{
    const av=parts(a), bv=parts(b);
    for(let i=0;i<3;i++){ if(av[i]!==bv[i]) return av[i]-bv[i]; }
    return 0;
  }).at(-1);
  assert.equal(releaseContract.latestMigration,path.posix.join('supabase','migrations',latest));
  const [major,minor]=parts(latest);
  assert.equal(releaseContract.productionSchema,`${major}.${minor}`);
  assert.equal(fs.existsSync(releaseContract.freshInstallBaseline),true);
});

test('audit: frontend literal API routes are implemented by the Worker',()=>{
  const routes=[...app.matchAll(/[\x22\x27\x60](\/api\/[A-Za-z0-9_?=&/.\-:]*)/g)]
    .map(match=>match[1].split('?')[0].replace(/\/$/,''));
  for(const route of new Set(routes)){
    assert.ok(worker.includes(route), `Worker route missing: ${route}`);
  }
});

test('audit: every operator-managed Worker env variable is documented in .env.example',()=>{
  const used=new Set([...sourceText.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map(match=>match[1]));
  const documented=new Set([...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match=>match[1]));
  const platformBindings=new Set([...wranglerConfig.matchAll(/"binding"\s*:\s*"([A-Z][A-Z0-9_]*)"/g)].map(match=>match[1]));
  assert.deepEqual([...used].filter(name=>!documented.has(name) && !platformBindings.has(name)).sort(),[]);
  assert.ok(platformBindings.has('CF_VERSION_METADATA'),'Cloudflare version metadata must remain a declared platform binding');
});

test('audit: shipped source does not instruct operators to run removed migration files',()=>{
  const files=[
    ...walk('src').filter(file=>file.endsWith('.js')),
    ...walk('public').filter(file=>/\.(?:js|html)$/.test(file)),
    ...walk('supabase/migrations').filter(file=>file.endsWith('.sql')),
    ...fs.readdirSync('.').filter(file=>file.endsWith('.md')),
  ];
  const missing=[];
  for(const file of files){
    const text=fs.readFileSync(file,'utf8');
    for(const match of text.matchAll(/supabase_migration_(v\d+(?:_\d+)*)\.sql/g)){
      const expected=path.join('supabase','migrations',`supabase_migration_${match[1]}.sql`);
      if(!fs.existsSync(expected)) missing.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(missing,[]);
});

test('audit: operational metadata recursively removes secrets and direct user identifiers',()=>{
  assert.match(worker,/function sensitiveOpsMetadataKey/);
  assert.match(worker,/telegram\.\?id\|user\.\?id\|chat\.\?id\|username/);
  assert.match(worker,/function sanitizeOpsMetadataValue/);
  assert.doesNotMatch(worker,/JSON\.parse\(redactOpsString\(JSON\.stringify\(value\)/);
  assert.doesNotMatch(worker,/meta:\s*\{\s*telegramId:\s*Number\(user\.id\)/);
});


test('audit: Worker external requests use the shared timeout transport',()=>{
  assert.match(worker,/async function fetchWithTimeout/);
  const directAwaitFetches=[...worker.matchAll(/await\s+fetch\s*\(/g)];
  assert.equal(directAwaitFetches.length,1,'External Worker fetch must go through fetchWithTimeout');
  assert.match(worker,/fetchWithTimeout\(\`https:\/\/api\.telegram\.org/);
  assert.match(worker,/fetchWithTimeout\('https:\/\/api\.tavily\.com\/search'/);
});


test('audit: mutable entrypoint assets are never cached as immutable',()=>{
  const appBlock=assetHeaders.match(/\/app\.js\n([\s\S]*?)(?:\n\n|$)/)?.[1] || '';
  const cssBlock=assetHeaders.match(/\/styles\.css\n([\s\S]*?)(?:\n\n|$)/)?.[1] || '';
  assert.doesNotMatch(appBlock,/immutable/i);
  assert.doesNotMatch(cssBlock,/immutable/i);
  assert.match(appBlock,/must-revalidate/i);
  assert.match(cssBlock,/must-revalidate/i);
});


test('audit: fire-and-forget observability is anchored to Cloudflare waitUntil',()=>{
  assert.match(worker,/async fetch\(request, env, ctx\)/);
  assert.match(worker,/cfg\.waitUntil = promise => ctx\.waitUntil\(Promise\.resolve\(promise\)\)/);
  assert.match(worker,/async function recordGrowthEvent\(cfg, event = \{\}\)[\s\S]{0,240}cfg\?\.waitUntil/);
  assert.match(worker,/async function recordOpsEvent\(cfg, event = \{\}\)[\s\S]{0,240}cfg\?\.waitUntil/);
});

test('audit: top-level route errors are redacted before console logging',()=>{
  assert.doesNotMatch(worker,/console\.error\(error\)/);
  assert.doesNotMatch(worker,/console\.error\('telegram webhook', error\)/);
  assert.match(worker,/console\.error\('api route', redactOpsString/);
});


test('audit: public entrypoint asset revisions track the package release',()=>{
  const version=packageMeta.version;
  const frontendRevision=/<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(indexHtml)?.[1] || '';
  assert.ok(frontendRevision.startsWith(version+'-'));
  assert.ok(indexHtml.includes('/app.js?v='+frontendRevision+'"') || indexHtml.includes("/app.js?v="+frontendRevision+"'"));
  assert.ok(indexHtml.includes('/styles.css?v='+frontendRevision+'"') || indexHtml.includes("/styles.css?v="+frontendRevision+"'"));
  assert.ok(indexHtml.includes('/styles/public-shell.css?v='+frontendRevision+'"') || indexHtml.includes("/styles/public-shell.css?v="+frontendRevision+"'"));
  assert.ok(statusHtml.includes('/status.js?v='+version+'"') || statusHtml.includes("/status.js?v="+version+"'"));
});


test('audit: scheduled telemetry is anchored to the cron lifecycle',()=>{
  assert.match(worker,/async scheduled\(controller, env, ctx\)[\s\S]{0,180}cfg\.waitUntil = promise => ctx\.waitUntil\(Promise\.resolve\(promise\)\)/);
});
