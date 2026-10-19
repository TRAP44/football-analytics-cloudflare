import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync('public/app.js','utf8');
const code=app.slice(app.indexOf('async function runStartupSequence()'),app.indexOf('const api = createApiClient'));
function setup({runtime={},blocked=false,compatibilityBlocked=false,manifestPromise=null,profilePromise=null}={}){
  const calls=[];
  const state={startup:{timings:{}},profile:{id:1},closedBetaBlocked:blocked,compatibilityBlocked};
  const noop=()=>{};
  const context={state,performance,navigator:{onLine:true},Promise,
    $:()=>null,setBootStatus:noop,showBootRecovery:noop,renderProfile:noop,applyRuntimeUi:noop,isAdmin:()=>false,
    loadAppManifest:async()=>{calls.push('manifest');return manifestPromise || {runtime};},loadRuntimeStatus:async()=>{calls.push('runtime');},loadProfile:async()=>{calls.push('profile');return profilePromise;},
    loadFavorites:()=>{calls.push('favorites');return new Promise(()=>{});},
    loadMatches:async()=>{calls.push('feed');},loadFavoritePlayers:noop,
    applyLaunchIntent:noop,hasDirectLaunchIntent:()=>false,showView:noop,sendProductAction:noop,
    setTimeout:resolve=>resolve(),hideBootGate:()=>calls.push('visible'),scheduleIdle:noop};
  vm.createContext(context);vm.runInContext(code+';globalThis.run=runStartupSequence;',context);
  return {calls,run:context.run};
}
test('actual startup reveals ready matches while favorites are pending and reuses manifest runtime',{timeout:1000},async()=>{
  const {calls,run}=setup();assert.equal(await run(),true);
  assert.deepEqual(calls,['profile','manifest','favorites','feed','visible']);
});
test('actual startup still enforces compatibility/beta gates and loads runtime when manifest has none',async()=>{
  for(const options of [{blocked:true},{compatibilityBlocked:true}]){
    const {calls,run}=setup(options);assert.equal(await run(),false);assert.ok(!calls.includes('feed'));assert.ok(!calls.includes('favorites'));
  }
  const {calls,run}=setup({runtime:null});await run();assert.ok(calls.includes('runtime'));
});


test('profile and manifest start together while feed waits for both gates',async()=>{
  for(const order of ['manifest','profile']){
    let finishManifest,finishProfile;
    const manifestPromise=new Promise(resolve=>{finishManifest=resolve;});
    const profilePromise=new Promise(resolve=>{finishProfile=resolve;});
    const h=setup({manifestPromise,profilePromise});const running=h.run();
    assert.deepEqual(h.calls,['profile','manifest']);
    if(order==='manifest')finishManifest({runtime:{}});else finishProfile();
    await new Promise(resolve=>setImmediate(resolve));assert.ok(!h.calls.includes('feed'));
    if(order==='manifest')finishProfile();else finishManifest({runtime:{}});
    assert.equal(await running,true);assert.ok(h.calls.includes('feed'));assert.ok(h.calls.includes('visible'));
  }
});
