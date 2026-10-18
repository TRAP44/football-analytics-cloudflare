import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync('public/app.js','utf8');
const code=app.slice(app.indexOf('async function runStartupSequence()'),app.indexOf('const api = createApiClient'));
function setup({runtime={},blocked=false,compatibilityBlocked=false}={}){
  const calls=[];
  const state={startup:{timings:{}},profile:{id:1},closedBetaBlocked:blocked,compatibilityBlocked};
  const noop=()=>{};
  const context={state,performance,navigator:{onLine:true},Promise,
    $:()=>null,setBootStatus:noop,showBootRecovery:noop,renderProfile:noop,applyRuntimeUi:noop,isAdmin:()=>false,
    loadAppManifest:async()=>({runtime}),loadRuntimeStatus:async()=>{calls.push('runtime');},loadProfile:async()=>{calls.push('profile');},
    loadFavorites:()=>{calls.push('favorites');return new Promise(()=>{});},
    loadMatches:async()=>{calls.push('feed');},loadFavoritePlayers:noop,
    applyLaunchIntent:noop,hasDirectLaunchIntent:()=>false,showView:noop,sendProductAction:noop,
    setTimeout:resolve=>resolve(),hideBootGate:()=>calls.push('visible'),scheduleIdle:noop};
  vm.createContext(context);vm.runInContext(code+';globalThis.run=runStartupSequence;',context);
  return {calls,run:context.run};
}
test('actual startup reveals ready matches while favorites are pending and reuses manifest runtime',{timeout:1000},async()=>{
  const {calls,run}=setup();assert.equal(await run(),true);
  assert.deepEqual(calls,['profile','favorites','feed','visible']);
});
test('actual startup still enforces compatibility/beta gates and loads runtime when manifest has none',async()=>{
  for(const options of [{blocked:true},{compatibilityBlocked:true}]){
    const {calls,run}=setup(options);assert.equal(await run(),false);assert.ok(!calls.includes('feed'));assert.ok(!calls.includes('favorites'));
  }
  const {calls,run}=setup({runtime:null});await run();assert.ok(calls.includes('runtime'));
});
