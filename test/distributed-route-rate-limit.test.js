import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  accountRateLimitBucketKey,
  accountRatePolicyForRequest,
  enforceDistributedAccountRateLimit,
} from '../src/account-rate-limit.js';
import { isAdminSensitivePath } from '../src/security-route-registry.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const scheduled=fs.readFileSync('src/scheduled-jobs.js','utf8');

function block(start,end){
  const a=worker.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=worker.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return worker.slice(a,b);
}

function request(path,{method='GET',ip='198.51.100.70'}={}){
  return new Request('https://example.com'+path,{
    method,
    headers:ip ? {'cf-connecting-ip':ip,'content-type':'application/json'} : {'content-type':'application/json'},
    body:['POST','PUT','PATCH'].includes(method) ? '{}' : undefined,
  });
}

function json(body,status=200,headers={}){
  return {body,status,headers};
}

function sharedRpcBackend(){
  const buckets=new Map();
  const calls=[];
  const rpc=async(_cfg,name,payload)=>{
    assert.equal(name,'claim_provider_request');
    calls.push({...payload});
    const count=(buckets.get(payload.p_bucket_key) || 0)+1;
    buckets.set(payload.p_bucket_key,count);
    return {
      allowed:count<=payload.p_limit,
      retryAfter:payload.p_window_seconds,
    };
  };
  return {rpc,buckets,calls};
}

async function enforce({req,user,backend,memory={}}){
  return await enforceDistributedAccountRateLimit({
    request:req,
    user,
    cfg:{supabaseUrl:'https://db.example',supabaseKey:'server-key'},
    hasSupabase:()=>true,
    supaRpc:backend.rpc,
    bumpTelemetry:()=>{},
    recordOpsEvent:async()=>{},
    json,
    memory,
  });
}

test('distributed account guard covers user writes and all admin-sensitive routes',()=>{
  for (const [path,method] of [
    ['/api/preferences','PUT'],
    ['/api/favorites','POST'],
    ['/api/reminders','DELETE'],
    ['/api/billing/invoice','POST'],
    ['/api/post-deploy-regression-response','POST'],
    ['/api/recovery-incident-ack','POST'],
    ['/api/calibration-control','POST'],
    ['/api/runtime-controls/rollback','POST'],
    ['/api/admin/billing/refund','POST'],
  ]) {
    assert.ok(accountRatePolicyForRequest(request(path,{method})),path);
  }
  assert.equal(isAdminSensitivePath('/api/post-deploy-regression-response'),true);
});

test('two Telegram accounts behind one IP do not share the account-level bucket',async()=>{
  const backend=sharedRpcBackend();
  const ip='198.51.100.55';
  const req=request('/api/preferences',{method:'PUT',ip});
  const policy=accountRatePolicyForRequest(req);
  assert.ok(policy);

  const keyA=accountRateLimitBucketKey({id:101},policy);
  const keyB=accountRateLimitBucketKey({id:202},policy);
  assert.notEqual(keyA,keyB);
  assert.equal(keyA.includes(ip),false);
  assert.equal(keyB.includes(ip),false);

  for(let i=0;i<policy.limit;i+=1) {
    assert.equal(await enforce({req,user:{id:101},backend,memory:{}}),null);
  }
  const blockedA=await enforce({req,user:{id:101},backend,memory:{}});
  assert.equal(blockedA.status,429);
  assert.equal(blockedA.body.code,'DISTRIBUTED_BURST_GUARD');

  const firstB=await enforce({req,user:{id:202},backend,memory:{}});
  assert.equal(firstB,null);
});

test('shared Supabase RPC enforces one account window across independent Worker-isolate state',async()=>{
  const backend=sharedRpcBackend();
  const req=request('/api/analyze',{method:'POST',ip:'203.0.113.40'});
  const policy=accountRatePolicyForRequest(req);
  assert.equal(policy.limit,6);

  const isolateA={};
  const isolateB={};
  for(let i=0;i<3;i+=1) assert.equal(await enforce({req,user:{id:77},backend,memory:isolateA}),null);
  for(let i=0;i<3;i+=1) assert.equal(await enforce({req,user:{id:77},backend,memory:isolateB}),null);

  const crossIsolateBlock=await enforce({req,user:{id:77},backend,memory:isolateB});
  assert.equal(crossIsolateBlock.status,429);
  assert.equal(backend.buckets.get('route:77:analysis'),7);
});

test('worker applies local account burst before distributed account RPC and before routing',()=>{
  const routing=block('const burstResponse = enforceRouteBurst','try {\n        return await dispatchApiRoute');
  const localAt=routing.indexOf('enforceRouteBurst');
  const distributedAt=routing.indexOf('enforceDistributedAccountRateLimit');
  assert.ok(localAt>=0 && distributedAt>localAt);
  assert.match(routing,/if \(burstResponse\) return burstResponse/);
  assert.match(routing,/if \(distributedBurstResponse\) return distributedBurstResponse/);
  assert.doesNotMatch(worker,/enforceDistributedRouteBurst/);
});

test('distributed guard reuses the existing server-only atomic fixed-window RPC contract',()=>{
  const source=fs.readFileSync('src/account-rate-limit.js','utf8');
  assert.match(source,/supaRpc\(cfg,'claim_provider_request'/);
  assert.match(source,/p_bucket_key:bucketKey/);
  assert.match(source,/accountRateLimitBucketKey\(user,policy\)/);
  assert.match(source,/DISTRIBUTED_BURST_GUARD/);
});

test('stale shared rate windows are cleaned without touching active buckets',()=>{
  assert.match(worker,/async function cleanupRateWindows/);
  assert.match(worker,/Date\.now\(\) - 2 \* 86400_000/);
  assert.match(worker,/supaDelete\(cfg, 'provider_rate_windows', \{ updated_at: `lt\.\$\{cutoff\}` \}\)/);
  assert.match(scheduled,/runDailyTaskOnce\('rate_window_cleanup', \(\) => cleanupRateWindows\(cfg\), cfg, scheduledAt, ownershipState\)/);
});
