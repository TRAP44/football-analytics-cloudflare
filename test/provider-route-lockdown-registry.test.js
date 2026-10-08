import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProviderFanoutPath,
  providerBackedRouteDefinition,
  providerBackedRouteInventory,
  validateProviderBackedRouteDefinitions,
} from '../src/provider-route-registry.js';
import { runtimeLockdownDecision } from '../src/runtime-lockdown.js';
import { dispatchApiRoute } from '../src/router.js';

const locked=Object.freeze({
  maintenanceMode:true,
  analysisEnabled:false,
  searchEnabled:false,
  liveEnabled:false,
  remindersEnabled:false,
  expandedDataEnabled:false,
  autoSettlementRecoveryEnabled:false,
});

const EXPECTED_PROVIDER_ROUTES=[
  'GET /api/search',
  'GET /api/matches',
  'GET /api/tournament',
  'GET /api/team',
  'GET /api/team/intelligence',
  'GET /api/team/squad',
  'GET /api/match-center',
  'POST /api/analyze',
  'GET /api/provider/e2e-validation',
  'GET /api/provider/probe',
  'GET /api/provider/coverage-audit',
].sort();

function req(path,method='GET') {
  return new Request('https://example.com'+path,{method});
}

test('Issue #411 provider-backed route inventory is complete and lockdown-covered',()=>{
  const inventory=providerBackedRouteInventory();
  const actual=inventory.map(route=>route.method+' '+route.path).sort();
  assert.deepEqual(actual,EXPECTED_PROVIDER_ROUTES);

  for(const route of inventory){
    const label=route.method+' '+route.path;
    assert.equal(route.lockdownPolicy,'provider_fanout',label);
    assert.equal(isProviderFanoutPath(route.path),true,route.path);
    assert.deepEqual(providerBackedRouteDefinition(route.path,route.method),route,label);

    const userDecision=runtimeLockdownDecision(req(route.path,route.method),{
      runtime:locked,
      isAdmin:false,
    });
    assert.equal(userDecision.blocked,true,label);
    assert.equal(userDecision.providerFanout,true,label);
    assert.equal(userDecision.code,'SECURITY_LOCKDOWN_PROVIDER_PAUSED');

    const adminDecision=runtimeLockdownDecision(req(route.path,route.method),{
      runtime:locked,
      isAdmin:true,
    });
    assert.equal(adminDecision.blocked,true,'admin '+label);
  }
});

test('provider route registry rejects non-canonical definitions that would diverge from dispatch keys',()=>{
  const base=providerBackedRouteInventory().slice(1);

  for(const route of [
    {method:'get',path:'/api/search',handler:'apiSearch',lockdownPolicy:'provider_fanout'},
    {method:'GET',path:'api/search',handler:'apiSearch',lockdownPolicy:'provider_fanout'},
    {method:'GET',path:'/api/search?scope=all',handler:'apiSearch',lockdownPolicy:'provider_fanout'},
    {method:'GET',path:'/api/../search',handler:'apiSearch',lockdownPolicy:'provider_fanout'},
    {method:'GET',path:'/api/search',handler:' apiSearch ',lockdownPolicy:'provider_fanout'},
  ]){
    assert.throws(
      ()=>validateProviderBackedRouteDefinitions([route,...base]),
      /canonical|API pathname/,
    );
  }
});

test('provider route registry requires strict authorization flags and rejects ambiguous scope',()=>{
  const base=providerBackedRouteInventory().slice(1);

  assert.throws(
    ()=>validateProviderBackedRouteDefinitions([
      {method:'GET',path:'/api/search',handler:'apiSearch',userScoped:'false',lockdownPolicy:'provider_fanout'},
      ...base,
    ]),
    /invalid authorization flags/,
  );

  assert.throws(
    ()=>validateProviderBackedRouteDefinitions([
      {method:'GET',path:'/api/search',handler:'apiSearch',adminOnly:true,userScoped:true,lockdownPolicy:'provider_fanout'},
      ...base,
    ]),
    /cannot be both admin-only and user-scoped/,
  );
});

test('provider route lookups reject non-string coercion and inventory snapshots are immutable',()=>{
  assert.equal(providerBackedRouteDefinition('/api/search',true),null);
  assert.equal(providerBackedRouteDefinition({path:'/api/search'},'GET'),null);
  assert.equal(isProviderFanoutPath({path:'/api/search'}),false);

  const inventory=providerBackedRouteInventory();
  assert.equal(Object.isFrozen(inventory[0]),true);
  assert.throws(()=>{ inventory[0].handler='apiOther'; },TypeError);
  assert.equal(providerBackedRouteDefinition('/api/search','GET')?.handler,'apiSearch');
});

test('Issue #411 synthetic provider route without explicit lockdown policy fails registry validation',()=>{
  const synthetic=[
    ...providerBackedRouteInventory(),
    {
      method:'GET',
      path:'/api/provider/new-provider-feed',
      handler:'apiNewProviderFeed',
    },
  ];
  assert.throws(
    ()=>validateProviderBackedRouteDefinitions(synthetic),
    /missing explicit runtime lockdown policy/,
  );
});

test('Issue #411 admin recovery and safe local reads stay exempt from provider fanout lockdown',()=>{
  for(const [path,method,isAdmin] of [
    ['/api/runtime-controls','GET',true],
    ['/api/runtime-controls','PATCH',true],
    ['/api/runtime-controls/rollback','POST',true],
    ['/api/me','GET',false],
    ['/api/history','GET',false],
    ['/api/provider','GET',true],
  ]){
    assert.equal(isProviderFanoutPath(path),false,path);
    const decision=runtimeLockdownDecision(req(path,method),{runtime:locked,isAdmin});
    assert.equal(decision.blocked,false,method+' '+path);
  }
});

test('Issue #411 router dispatches provider-backed routes from the shared registry',async()=>{
  const calls=[];
  const deps={
    json:(body,status=200)=>({body,status}),
    isAdminUser:()=>false,
    adminForbidden:()=>({status:403,body:{error:'forbidden'}}),
    memory:{providerAudit:{last:null}},
    apiSearch:async (...args)=>{ calls.push(['search',args]); return {ok:'search'}; },
    apiAnalyze:async (...args)=>{ calls.push(['analyze',args]); return {ok:'analyze'}; },
    apiProviderProbe:async (...args)=>{ calls.push(['probe',args]); return {ok:'probe'}; },
  };
  const cfg={marker:'cfg'};
  const user={id:42};

  const searchRequest={method:'GET'};
  const search=await dispatchApiRoute(searchRequest,{pathname:'/api/search'},cfg,user,deps);
  assert.deepEqual(search,{ok:'search'});
  assert.deepEqual(calls[0],['search',[searchRequest,cfg]]);

  const analyzeRequest={method:'POST'};
  const analyze=await dispatchApiRoute(analyzeRequest,{pathname:'/api/analyze'},cfg,user,deps);
  assert.deepEqual(analyze,{ok:'analyze'});
  assert.deepEqual(calls[1],['analyze',[analyzeRequest,cfg,user]]);

  const probe=await dispatchApiRoute({method:'GET'},{pathname:'/api/provider/probe'},cfg,user,deps);
  assert.equal(probe.status,403);
  assert.equal(calls.length,2);
});

test('Issue #411 router has no duplicated direct provider-backed route dispatch blocks',()=>{
  const source=fs.readFileSync('src/router.js','utf8');
  assert.match(source,/providerBackedRouteDefinition\(pathname,method\)/);
  assert.match(source,/deps\[providerRoute\.handler\]/);

  for(const route of providerBackedRouteInventory()){
    const escaped=route.path.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
    const direct=new RegExp("pathname\\s*===\\s*['\\\"]"+escaped+"['\\\"]");
    assert.doesNotMatch(source,direct,route.method+' '+route.path+' must remain registry-dispatched');
  }
});

test('provider registry rejects duplicate routes and missing lockdown policies',()=>{
  const routes=providerBackedRouteInventory();
  assert.throws(
    ()=>validateProviderBackedRouteDefinitions([...routes,routes[0]]),
    /duplicated/,
  );
  assert.throws(
    ()=>validateProviderBackedRouteDefinitions([
      {...routes[0],lockdownPolicy:'none'},...routes.slice(1),
    ]),
    /missing explicit runtime lockdown policy/,
  );
});
test('provider fanout route resolution keeps methods and path boundaries distinct',()=>{
  assert.equal(providerBackedRouteDefinition('/api/search','POST'),null);
  assert.equal(providerBackedRouteDefinition('/api/analyze','GET'),null);
  assert.equal(providerBackedRouteDefinition('/api/search?name=team','GET'),null);
  assert.equal(isProviderFanoutPath('/api/search-more'),false);
  assert.equal(isProviderFanoutPath('/api/search?name=team'),false);
  assert.equal(providerBackedRouteDefinition('/api/search','get')?.handler,'apiSearch');
});
