import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApiClient } from '../public/modules/client-core.js';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

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

test('public feed remains behind access control and admin reminders stay off the boot path',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const blocked=startup.indexOf('if (state.closedBetaBlocked) return false');
  const publicBatch=startup.indexOf('const startupTasks = [loadFavorites(), loadMatches()]');
  assert.ok(blocked>=0 && publicBatch>blocked);
  const batch=startup.slice(publicBatch,startup.indexOf('await Promise.allSettled(startupTasks)',publicBatch));
  assert.doesNotMatch(batch,/loadReminders/);
  assert.match(startup,/if \(!state\.remindersLoaded\) tasks\.push\(loadReminders\(\)\)/);
});

test('full AI avoids reloading already-known favorites and reminders',()=>{
  const analyze=block('async function analyzeMatch','function historyItemFromAnalysis');
  assert.match(analyze,/const secondaryTasks = \[loadHistory\(false\)\]/);
  assert.match(analyze,/if \(!state\.remindersLoaded\) secondaryTasks\.push\(loadReminders\(\)\)/);
  assert.match(analyze,/if \(!state\.favoritesLoaded\) secondaryTasks\.push\(loadFavorites\(\)\)/);
  assert.doesNotMatch(analyze,/Promise\.allSettled\(\[loadHistory\(false\), loadReminders\(\), loadFavorites\(\)\]\)/);
});

test('reopening the same Match Center renders warm data before refresh completes',()=>{
  const center=block('async function openMatchCenter','function syncAnalysisBusyUi');
  const warm=center.indexOf('const reusableCenter =');
  const render=center.indexOf('renderMatchCenter(reusableCenter)');
  const request=center.indexOf('await requestMatchCenter(fixtureId)');
  assert.ok(warm>=0 && render>warm && request>render);
  assert.match(center,/Number\(state\.currentCenter\?\.match\?\.fixtureId \|\| 0\) === Number\(fixtureId\)/);
});

test('performance pass cache-busts app.js without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-launch2"/);
  assert.match(html,/app\.js\?v=6\.120\.0-launch2/);
  assert.match(app,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
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
