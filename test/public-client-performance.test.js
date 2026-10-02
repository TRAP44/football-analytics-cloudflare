import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApiClient } from '../public/modules/client-core.js';

const app=fs.readFileSync('public/app.js','utf8');
const runtime=fs.readFileSync('public/modules/app-runtime.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');

function block(start,end){
  const a=app.indexOf(start);
  const b=app.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return app.slice(a,b);
}

test('startup parallelizes runtime and identity before the access gate',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const identityBatch=startup.indexOf('await Promise.allSettled([');
  const blocked=startup.indexOf('if (state.closedBetaBlocked) return false');
  const publicBatch=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches()]');
  assert.ok(identityBatch>=0 && blocked>identityBatch && publicBatch>blocked);
  const identitySlice=startup.slice(identityBatch,blocked);
  assert.match(identitySlice,/loadRuntimeStatus\(false\)/);
  assert.match(identitySlice,/loadProfile\(\)\.catch\(\(\)=>null\)/);
  assert.doesNotMatch(identitySlice,/loadFavorites|loadMatches/);
  assert.doesNotMatch(startup,/await loadRuntimeStatus\(false\);[\s\S]*?await loadProfile/);
});

test('startup profiling separates browser/navigation and server-backed boot phases',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const boot=block('function hideBootGate','function showBootRecovery');
  for (const phase of ['manifestMs','identityMs','feedMs','revealDelayMs']) {
    assert.match(startup,new RegExp(`state\\.startup\\.timings\\.${phase}`));
    assert.match(boot,new RegExp(`${phase}: state\\.startup\\.timings\\.${phase}`));
  }
  assert.match(boot,/getEntriesByType\?\.\('navigation'\)/);
  assert.match(boot,/first-contentful-paint/);
  assert.match(boot,/moduleReadyMs/);
  assert.match(boot,/navigationReadyMs/);
  assert.match(boot,/viewportWidth/);

  const telemetryStart=worker.indexOf('function clientTelemetryMetadata');
  const telemetryEnd=worker.indexOf('async function apiClientTelemetry',telemetryStart);
  const telemetry=worker.slice(telemetryStart,telemetryEnd);
  for (const field of ['moduleReadyMs','navigationReadyMs','responseEndMs','domContentLoadedMs','firstContentfulPaintMs','manifestMs','identityMs','feedMs','revealDelayMs','viewportWidth']) {
    assert.match(telemetry,new RegExp(field));
  }
  assert.match(telemetry,/event === 'boot_ok'/);
});

test('public feed remains behind access control and admin reminders stay off the boot path',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const blocked=startup.indexOf('if (state.closedBetaBlocked) return false');
  const publicBatch=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches()]');
  assert.ok(blocked>=0 && publicBatch>blocked);
  const batch=startup.slice(publicBatch,startup.indexOf('await Promise.allSettled(startupTasks)',publicBatch));
  assert.doesNotMatch(batch,/loadReminders/);
  assert.match(startup,/if \(!state\.remindersLoaded\) tasks\.push\(loadReminders\(\)\)/);
});

test('startup graph defers profile-only and Match Center-only modules until their route boundary',()=>{
  const deferred = [
    'billing.js',
    'digest-settings.js',
    'smart-notifications.js',
    'match-pulse.js',
    'ai-timeline.js',
  ];
  for (const moduleName of deferred) {
    assert.doesNotMatch(app,new RegExp(`from ['"]\\.\\/modules\\/${moduleName.replace('.', '\\\\.')}['"]`));
    assert.match(app,new RegExp(`import\\(['"]\\.\\/modules\\/${moduleName.replace('.', '\\\\.')}['"]\\)`));
  }
  assert.match(app,/async function ensureBillingModule\(/);
  assert.match(app,/async function ensureDigestSettingsModule\(/);
  assert.match(app,/async function ensureSmartNotificationsModule\(/);
  assert.match(app,/async function ensureMatchCenterExtras\(/);

  const staticImports=[...app.matchAll(/from ['"]\.\/modules\/([^'"]+)['"]/g)].map(match=>`public/modules/${match[1]}`);
  const startupJsRawBytes=Buffer.byteLength(app)+staticImports.reduce((total,path)=>total+fs.statSync(path).size,0);
  assert.ok(startupJsRawBytes < 440_000, `startup JS graph regressed to ${startupJsRawBytes} bytes`);
});

test('full AI avoids reloading already-known favorites and reminders',()=>{
  const analyze=block('async function analyzeMatch','function historyItemFromAnalysis');
  assert.match(analyze,/const secondaryTasks = \[loadHistory\(false\)\]/);
  assert.match(analyze,/if \(!state\.remindersLoaded\) secondaryTasks\.push\(loadReminders\(\)\)/);
  assert.match(analyze,/if \(!state\.favoritesLoaded\) secondaryTasks\.push\(loadFavorites\(\)\)/);
  assert.doesNotMatch(analyze,/Promise\.allSettled\(\[loadHistory\(false\), loadReminders\(\), loadFavorites\(\)\]\)/);
});

test('reopening the same Match Center renders warm data while the refresh and deferred UI chunk load in parallel',()=>{
  const center=block('async function openMatchCenter','function syncAnalysisBusyUi');
  const warm=center.indexOf('const reusableCenter =');
  const extras=center.indexOf('const extrasPromise = ensureMatchCenterExtras()');
  const request=center.indexOf('requestMatchCenter(fixtureId)');
  const render=center.indexOf('renderMatchCenter(reusableCenter)');
  const refreshed=center.indexOf('const data = await centerLoad');
  assert.ok(warm>=0 && extras>warm && request>extras && render>request && refreshed>render);
  assert.match(center,/Promise\.all\(\[\s*requestMatchCenter\(fixtureId\),\s*extrasPromise,/);
  assert.match(center,/Number\(state\.currentCenter\?\.match\?\.fixtureId \|\| 0\) === Number\(fixtureId\)/);
});

test('performance pass cache-busts shared app.js without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch\d+"/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch\d+/);
  assert.match(runtime,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
});


test('identical initial GET requests are coalesced into one network round-trip', async()=>{
  const originalFetch=globalThis.fetch;
  let calls=0;
  let releaseFetch;
  globalThis.fetch=async()=>{
    calls+=1;
    await new Promise(resolve=>{ releaseFetch=resolve; });
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  };
  const state={
    compatibilityBlocked:false,
    runtimeStatus:null,
    clientPerf:{requests:0,deduped:0,retries:0,rateLimited:0,completed:0,lastMs:0,totalMs:0,failed:0,timeouts:0},
  };
  const inflightGetRequests=new Map();
  try {
    const api=createApiClient({
      state,tg:null,inflightGetRequests,
      observeServerVersion(){},showBootRecovery(){},applyRuntimeUi(){},
      normalizeApiError:error=>error,noteRequestSuccess(){},noteRequestFailure(){},
    });
    const first=api('/api/matches?date=2026-09-29',{retry:false});
    const second=api('/api/matches?date=2026-09-29',{retry:false});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,1);
    assert.equal(state.clientPerf.deduped,1);
    releaseFetch();
    assert.deepEqual(await first,{ok:true});
    assert.deepEqual(await second,{ok:true});
    assert.equal(inflightGetRequests.size,0);
  } finally {
    globalThis.fetch=originalFetch;
  }
});
