import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {auditInfrastructure,auditSummary} from '../scripts/audit-infrastructure-capacity.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';

const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'dummy-cf-credential',
  SUPABASE_PROJECT_REF:'b'.repeat(20),SUPABASE_ACCESS_TOKEN:'dummy-sb-credential'};
function responseFor(url) {
  if(url.endsWith('/workers/account-settings'))return {success:true,result:{default_usage_model:'standard'}};
  if(url.endsWith('/subscriptions'))return {success:true,result:[
    {rate_plan:{id:'workers_paid',public_name:'Workers Paid'},state:'paid',price:99,currency:'USD'},
    {rate_plan:{id:'other',public_name:'Unrelated subscription'},price:999}]};
  if(url.endsWith('/billing/addons'))return {selected_addons:[{type:'compute_instance',variant:{id:'ci_micro',name:'Micro',price:{amount:10},meta:{sensitive:'exclude'}}}],available_addons:[{private:'exclude'}]};
  return {ref:env.SUPABASE_PROJECT_REF,status:'ACTIVE_HEALTHY',region:'eu-west-1',name:'private-project-name',organization_id:'private-org',database:{version:'17.6',host:'private-db-host'}};
}

test('management audit performs only four fixed GETs and emits whitelisted metadata',async()=>{
  const calls=[];
  const report=await auditInfrastructure({env,fetchImpl:async(url,options)=>{
    calls.push({url,options});return Response.json(responseFor(url));
  }});
  assert.equal(calls.length,4);
  for(const {url,options} of calls){
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.ok(['api.cloudflare.com','api.supabase.com'].includes(new URL(url).hostname));
    assert.equal(options.headers.Authorization,`Bearer ${new URL(url).hostname==='api.cloudflare.com'?env.CLOUDFLARE_API_TOKEN:env.SUPABASE_ACCESS_TOKEN}`);
  }
  assert.equal(report.completeManagementObservations,true);
  assert.equal(report.productionChanged,false);
  assert.equal(report.productionCapacityConfirmed,false);
  assert.deepEqual(report.supabase.compute.selectedComputeVariants,['ci_micro']);
  assert.equal(report.supabase.organizationPlan.status,'unknown');
  assert.equal(report.cloudflare.workersSubscriptions.plans.length,1);
  const output=JSON.stringify(report)+auditSummary(report);
  for(const hidden of [...Object.values(env),'private-project-name','private-org','private-db-host','price','amount','Unrelated subscription'])assert.ok(!output.includes(hidden),hidden);
});

test('missing or malformed target identifiers never send credentials or guess a production project',async()=>{
  for(const values of [{},{...env,CLOUDFLARE_ACCOUNT_ID:'../bad',SUPABASE_PROJECT_REF:'https://evil.test'},{CLOUDFLARE_API_TOKEN:env.CLOUDFLARE_API_TOKEN,SUPABASE_ACCESS_TOKEN:env.SUPABASE_ACCESS_TOKEN}]){
    let requests=0;
    const report=await auditInfrastructure({env:values,fetchImpl:async()=>{requests++;throw Error('must not call');}});
    assert.equal(requests,0);assert.equal(report.completeManagementObservations,false);
    assert.equal(report.productionCapacityConfirmed,false);
  }
});

test('forbidden, failed, redirected or malformed management responses remain unknown without leaking error bodies',async()=>{
  for(const status of [401,403,429,500,302]) {
    const report=await auditInfrastructure({env,fetchImpl:async()=>new Response(JSON.stringify(env),{status})});
    assert.equal(report.completeManagementObservations,false);
    assert.equal(report.cloudflare.settings.httpStatus,status);
    const output=JSON.stringify(report)+auditSummary(report);
    for(const secret of [env.CLOUDFLARE_API_TOKEN,env.SUPABASE_ACCESS_TOKEN])assert.ok(!output.includes(secret));
  }
  for(const fetchImpl of [async()=>{throw Error(env.SUPABASE_ACCESS_TOKEN);},async()=>Response.json({success:true,result:{},ref:'wrong',selected_addons:'invalid'})]) {
    const report=await auditInfrastructure({env,fetchImpl});
    assert.equal(report.completeManagementObservations,false);
    assert.equal(report.productionCapacityConfirmed,false);
    assert.ok(!JSON.stringify(report).includes(env.SUPABASE_ACCESS_TOKEN));
  }
});

test('empty subscription or compute lists never become an inferred Free plan',async()=>{
  const report=await auditInfrastructure({env,fetchImpl:async url=>Response.json(url.endsWith('/subscriptions')?{success:true,result:[]}:url.endsWith('/billing/addons')?{selected_addons:[]}:responseFor(url))});
  assert.match(report.cloudflare.workersSubscriptions.planConclusion,/unknown/);
  assert.match(report.supabase.compute.conclusion,/unknown/);
  assert.equal(report.supabase.organizationPlan.status,'unknown');
  assert.equal(report.productionCapacityConfirmed,false);
});

test('audit workflow uses only main and existing production secret bindings; never deploys or runs SQL',()=>{
  const file='.github/workflows/audit-infrastructure-capacity.yml',source=fs.readFileSync(file,'utf8');
  assert.deepEqual(auditWorkflow(file,source),[]);
  assert.match(source,/if: github.ref == 'refs\/heads\/main'/);
  assert.match(source,/ref: main/);
  assert.match(source,/workflow_dispatch:/);
  assert.doesNotMatch(source,/pull_request:|workflow_run:|schedule:|wrangler deploy|psql|migration up|npm ci/);
  assert.match(source,/environment: production/);
  assert.match(source,/SUPABASE_PROJECT_REF: \$\{\{ vars.SUPABASE_PROJECT_REF \}\}/);
  assert.ok(auditWorkflow(file,source.replace('    environment: production\n','')).length>0);
});
