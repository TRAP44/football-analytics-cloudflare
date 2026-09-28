import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

function block(start,end){
  const a=app.indexOf(start);
  const b=app.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return app.slice(a,b);
}

test('startup collapses independent public reads into one network batch',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const batch=startup.indexOf('const startupTasks = [');
  const awaitBatch=startup.indexOf('await Promise.allSettled(startupTasks)');
  assert.ok(batch>=0 && awaitBatch>batch);
  for(const call of ['loadRuntimeStatus(false)','loadProfile().catch(()=>null)','loadFavorites()','loadMatches()']) {
    const i=startup.indexOf(call,batch);
    assert.ok(i>batch && i<awaitBatch,call);
  }
  assert.doesNotMatch(startup,/await loadRuntimeStatus\(false\);[\s\S]*?await loadProfile/);
});

test('admin reminders no longer block first public paint or reload twice at startup',()=>{
  const startup=block('async function runStartupSequence','const api = createApiClient');
  const batch=startup.slice(startup.indexOf('const startupTasks = ['),startup.indexOf('await Promise.allSettled(startupTasks)'));
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
  const center=block('async function openMatchCenter','function bindMatchCenterTabs');
  const warm=center.indexOf('const reusableCenter =');
  const render=center.indexOf('renderMatchCenter(reusableCenter)');
  const request=center.indexOf('await requestMatchCenter(fixtureId)');
  assert.ok(warm>=0 && render>warm && request>render);
  assert.match(center,/Number\(state\.currentCenter\?\.match\?\.fixtureId \|\| 0\) === Number\(fixtureId\)/);
});

test('performance pass cache-busts app.js without changing release identity',()=>{
  assert.match(html,/frontend-asset-revision" content="6\.120\.0-perf1"/);
  assert.match(html,/app\.js\?v=6\.120\.0-perf1/);
  assert.match(app,/const CLIENT_VERSION = '6\.120\.0-rc144'/);
});
