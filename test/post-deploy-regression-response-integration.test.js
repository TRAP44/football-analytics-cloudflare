import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReleaseMonitorApiRuntime } from '../src/release-monitor-api-runtime.js';

const releaseApi=fs.readFileSync('src/release-monitor-api-runtime.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

test('regression response endpoint is admin-only at the router boundary',()=>{
  assert.match(router,/pathname === '\/api\/post-deploy-regression-response'/);
  const start=router.indexOf("if (pathname === '/api/post-deploy-regression-response')");
  const block=router.slice(start,start+260);
  assert.match(block,/adminAllowed\(\)/);
  assert.match(block,/adminForbidden\(\)/);
  assert.match(block,/apiPostDeployRegressionResponse/);
});

test('response writes require persistent ops history and exact active deployment identity',()=>{
  const start=releaseApi.indexOf('async function apiPostDeployRegressionResponse');
  const end=releaseApi.indexOf('async function apiReleaseMonitor',start);
  assert.ok(start>=0 && end>start);
  const block=releaseApi.slice(start,end);
  assert.match(block,/currentReleaseIdentity\(cfg\)/);
  assert.match(block,/body\?\.deploySha/);
  assert.match(block,/readOpsEventsRange/);
  assert.match(block,/!source\.persistent/);
  assert.match(block,/source\.truncated/);
  assert.match(block,/planPostDeployRegressionResponseTransition/);
  assert.match(block,/recordOpsEvent\(cfg,plan\)/);
  assert.match(block,/_persistenceStatus/);
});

test('release monitor exposes deployment-scoped lifecycle alert and response audit timeline',()=>{
  const start=releaseApi.indexOf('async function apiReleaseMonitor');
  const end=releaseApi.indexOf('  return Object.freeze({',start);
  const block=releaseApi.slice(start,end);
  assert.match(block,/summarizePostDeployRegressionResponse/);
  assert.match(block,/release_regression_response/);
  assert.match(block,/postDeployRegressionTimeline/);
  assert.match(block,/postDeployRegression:\{/);
});

test('admin UI exposes only sequential manual incident response actions',()=>{
  assert.match(releaseMonitor,/NEW → ACKNOWLEDGED → INVESTIGATING → RESOLVED/);
  assert.match(releaseMonitor,/RESOLVED разрешён только после RECOVERED/);
  assert.match(releaseMonitor,/\/api\/post-deploy-regression-response/);
  assert.match(releaseMonitor,/data-response-state/);
  assert.match(releaseMonitor,/releaseRegressionResponsePending/);
  assert.doesNotMatch(releaseMonitor.slice(
    releaseMonitor.indexOf('async function transitionPostDeployRegressionResponse'),
    releaseMonitor.indexOf('async function loadReleaseMonitor'),
  ),/runtime-controls|rollbackTo|switchProvider|disableFeature/);
});



function regressionResponseRuntime({activeSha='a'.repeat(40)}={}){
  const calls={reads:0,writes:0};
  const memory={opsEvents:[],releaseMonitor:{stale:true}};
  const runtime=createReleaseMonitorApiRuntime({
    memory,
    currentReleaseIdentity:()=>({deploySha:activeSha}),
    hasSupabase:()=>true,
    json:(body,status=200)=>({status,body}),
    fetchWithTimeout:async()=>{calls.reads++;return {ok:true,json:async()=>[]};},
    supaHeaders:()=>({}),
    planPostDeployRegressionResponseTransition:()=>({action:'record',code:'ACK'}),
    recordOpsEvent:async()=>{calls.writes++;return {_persistenceStatus:'persistent'};},
    summarizePostDeployRegressionResponse:()=>({incidentId:'incident-a',state:'acknowledged',lifecycleState:'incident'}),
  });
  const request=(deploySha)=>({
    method:'POST',
    json:async()=>({state:'acknowledged',...(deploySha===undefined?{}:{deploySha})}),
  });
  return {runtime,request,calls,memory};
}

test('admin response rejects a missing release SHA without reading or writing ops events',async()=>{
  const h=regressionResponseRuntime();
  const result=await h.runtime.apiPostDeployRegressionResponse(h.request(),{supabaseUrl:'https://db.test'},{id:123});
  assert.equal(result.status,409);
  assert.equal(h.calls.reads,0);
  assert.equal(h.calls.writes,0);
  assert.equal(h.memory.releaseMonitor.stale,true);
});

test('admin response rejects stale, malformed or non-string deployment identities',async()=>{
  const h=regressionResponseRuntime();
  for(const value of ['b'.repeat(40),'bad-sha',123,null,{}]){
    const result=await h.runtime.apiPostDeployRegressionResponse(h.request(value),{supabaseUrl:'https://db.test'},{id:123});
    assert.equal(result.status,409);
  }
  assert.equal(h.calls.reads,0);
  assert.equal(h.calls.writes,0);
});

test('admin response fails closed when the active deployment identity is unverified',async()=>{
  const h=regressionResponseRuntime({activeSha:'bad-active-sha'});
  const result=await h.runtime.apiPostDeployRegressionResponse(h.request('a'.repeat(40)),{supabaseUrl:'https://db.test'},{id:123});
  assert.equal(result.status,503);
  assert.equal(h.calls.reads,0);
  assert.equal(h.calls.writes,0);
});

test('admin response writes only when the exact active SHA is confirmed',async()=>{
  const h=regressionResponseRuntime();
  const result=await h.runtime.apiPostDeployRegressionResponse(h.request('A'.repeat(40)),{supabaseUrl:'https://db.test'},{id:123});
  assert.equal(result.status,200);
  assert.equal(result.body.ok,true);
  assert.equal(h.calls.reads,1);
  assert.equal(h.calls.writes,1);
  assert.equal(h.memory.releaseMonitor,null);
});

test('admin UI rejects response transitions when release identity is missing',()=>{
  const start=releaseMonitor.indexOf('async function transitionPostDeployRegressionResponse');
  const end=releaseMonitor.indexOf('async function loadReleaseMonitor',start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  const gate=block.indexOf('if (!/^[0-9a-f]{40}$/i.test(deploySha))');
  const pending=block.indexOf('state.releaseRegressionResponsePending=true');
  assert.ok(gate>=0 && pending>gate);
  assert.match(block,/toast\('Идентификатор выпуска недоступен\. Обновите мониторинг\.'\)/);
});
