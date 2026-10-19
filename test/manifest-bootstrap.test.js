import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const bootstrap=fs.readFileSync('public/modules/manifest-bootstrap.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const loader=app.slice(app.indexOf('async function loadAppManifest()'),app.indexOf('function runtimeAllows('));
function setup(fetch){
  const state={startup:{},clientPerf:{manifestFailures:0}};
  const context={fetch,state,AbortController,DOMException,setTimeout,clearTimeout,evaluateCompatibility:()=>{},applyRuntimeUi:()=>{}};
  vm.createContext(context);vm.runInContext(loader+';globalThis.load=loadAppManifest;',context);
  return {context,state,start:()=>vm.runInContext(bootstrap,context),load:context.load};
}
test('early manifest starts without main module or Telegram and is consumed once by actual app loader',async()=>{
  let requests=0,finish;
  const h=setup(async(url,options)=>{
    requests++;assert.equal(url,'/api/app-manifest');assert.equal(options.cache,'no-store');
    return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({version:'6.120.0',runtime:{analysisEnabled:false}})});});
  });
  h.start();assert.equal(requests,1);assert.equal(h.state.appManifest,undefined);
  const loading=h.load();assert.equal(requests,1);finish();
  assert.equal((await loading).runtime.analysisEnabled,false);assert.equal(h.state.startup.manifestOk,true);
  assert.equal(h.context.matchradarManifestBootstrap,undefined);
  const retry=h.load();assert.equal(requests,2);finish();await retry;
});
test('early failed manifest is settled without duplicate request; a deliberate startup retry fetches fresh',async()=>{
  let requests=0;
  const h=setup(async()=>{requests++;throw Error('unavailable');});h.start();
  await h.context.matchradarManifestBootstrap.result;
  assert.equal(await h.load(),null);assert.equal(requests,1);assert.equal(h.state.startup.degraded,true);
  assert.equal(await h.load(),null);assert.equal(requests,2);
});
test('loader keeps the normal path when early script is missing and validates manifest',async()=>{
  for(const response of [{ok:false,json:async()=>({version:'6'})},{ok:true,json:async()=>({})}]){
    const h=setup(async()=>response);assert.equal(await h.load(),null);assert.equal(h.state.appManifest,undefined);
  }
});
