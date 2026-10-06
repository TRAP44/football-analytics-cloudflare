import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isReplaySensitiveMutation,
  runSensitiveMutationWithReplay,
  sensitiveMutationReplayIdentity,
  sensitiveMutationReplayPaths,
  sensitiveMutationRetryPolicy,
} from '../src/sensitive-mutation-replay.js';

function request(path='/api/runtime-controls', {
  method='POST',
  body='{"enabled":false}',
  idempotencyKey='',
} = {}) {
  const headers={'content-type':'application/json'};
  if (idempotencyKey) headers['x-idempotency-key']=idempotencyKey;
  return new Request('https://example.com'+path,{method,headers,body:method==='GET'?undefined:body});
}

function coordinator(store=new Map()) {
  let sequence=0;
  const sameIdentity=(a,b)=>
    a.actorId===b.actorId
    && a.method===b.method
    && a.path===b.path
    && a.requestDigest===b.requestDigest
    && a.idempotencyKeyHash===b.idempotencyKeyHash;

  return {
    store,
    async claim(identity) {
      const existing=store.get(identity.operationKey);
      if (!existing) {
        const leaseToken='lease-token-'+String(++sequence).padStart(8,'0');
        store.set(identity.operationKey,{...identity,state:'inflight',retryable:false,leaseToken});
        return {claimed:true,state:'inflight',reason:'claimed',leaseToken};
      }
      if (!sameIdentity(existing,identity)) {
        return {claimed:false,state:existing.state,reason:'request_conflict'};
      }
      if (existing.state==='completed') {
        return {claimed:false,state:'completed',reason:'duplicate_completed'};
      }
      if (existing.state==='inflight') {
        return {claimed:false,state:'inflight',reason:'duplicate_inflight'};
      }
      if (existing.state==='failed' && !existing.retryable) {
        return {claimed:false,state:'failed',reason:'duplicate_failed'};
      }
      const leaseToken='lease-token-'+String(++sequence).padStart(8,'0');
      store.set(identity.operationKey,{...identity,state:'inflight',retryable:false,leaseToken});
      return {claimed:true,state:'inflight',reason:'retry_failed',leaseToken};
    },
    async complete(identity,claim) {
      const row=store.get(identity.operationKey);
      if (!row || row.leaseToken!==claim.leaseToken) return {ok:false,updated:false};
      store.set(identity.operationKey,{...row,state:'completed',retryable:false});
      return {ok:true,updated:true};
    },
    async fail(identity,claim,retryable) {
      const row=store.get(identity.operationKey);
      if (!row || row.leaseToken!==claim.leaseToken) return {ok:false,updated:false};
      store.set(identity.operationKey,{...row,state:'failed',retryable:Boolean(retryable)});
      return {ok:true,updated:true,retryable:Boolean(retryable)};
    },
  };
}

test('sensitive mutation classification rejects method and path coercion',()=>{
  assert.equal(isReplaySensitiveMutation(
    {method:{toString:()=> 'POST'},url:'https://example.com/api/runtime-controls'},
    new URL('https://example.com/api/runtime-controls'),
  ),false);
  assert.equal(isReplaySensitiveMutation(
    {method:'POST',url:'https://example.com/api/runtime-controls'},
    {pathname:{toString:()=> '/api/runtime-controls'}},
  ),false);
  assert.equal(isReplaySensitiveMutation(
    request('/api/runtime-controls',{method:'POST'}),
    {pathname:' /api/runtime-controls'},
  ),false);
});

test('sensitive mutation inventory snapshot is immutable',()=>{
  const paths=sensitiveMutationReplayPaths();
  assert.equal(Object.isFrozen(paths),true);
  assert.throws(()=>paths.push('/api/evil'),TypeError);
});

test('sensitive mutation inventory excludes reads and includes every guarded high-risk route', () => {
  assert.equal(isReplaySensitiveMutation(request('/api/runtime-controls'),new URL('https://example.com/api/runtime-controls')),true);
  assert.equal(isReplaySensitiveMutation(request('/api/runtime-controls',{method:'GET'}),new URL('https://example.com/api/runtime-controls')),false);
  assert.equal(isReplaySensitiveMutation(request('/api/preferences',{method:'PUT'}),new URL('https://example.com/api/preferences')),false);
  for (const path of [
    '/api/admin/billing/refund',
    '/api/admin/channel-publisher/test',
    '/api/runtime-controls',
    '/api/runtime-controls/rollback',
    '/api/recovery-incident-ack',
    '/api/post-deploy-regression-response',
    '/api/calibration-control',
    '/api/model-remediation',
    '/api/billing/invoice',
    '/api/billing/sync',
    '/api/billing/subscription',
  ]) assert.ok(sensitiveMutationReplayPaths().includes(path),path);
});

test('two independent Worker isolates cannot both own the same sensitive mutation', async () => {
  const shared=coordinator();
  const req=request('/api/model-remediation',{body:'{"action":"recover","candidateToken":"abc"}'});
  const url=new URL(req.url);
  let calls=0;
  let release;
  let started;
  const gate=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});

  const first=runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;started();await gate;return {status:200};},
  });
  await entered;

  const duplicate=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:200};},
  });

  assert.equal(duplicate.blocked,true);
  assert.equal(duplicate.reason,'duplicate_inflight');
  release();
  await first;
  assert.equal(calls,1);
});

test('completed sensitive mutation remains blocked across isolates', async () => {
  const shared=coordinator();
  const req=request('/api/runtime-controls',{body:'{"maintenanceMode":true}'});
  const url=new URL(req.url);
  let calls=0;

  const first=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:42},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:200};},
  });
  const second=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:42},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:200};},
  });

  assert.equal(first.blocked,false);
  assert.equal(second.blocked,true);
  assert.equal(second.reason,'duplicate_completed');
  assert.equal(calls,1);
});

test('retry-safe internal mutation can reclaim a failed distributed claim', async () => {
  const shared=coordinator();
  const req=request('/api/runtime-controls/rollback',{body:'{"revision":12}'});
  const url=new URL(req.url);
  let calls=0;

  const failed=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:9},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:503};},
  });
  assert.equal(failed.blocked,false);
  assert.equal(sensitiveMutationRetryPolicy('/api/runtime-controls/rollback',503),true);

  const retried=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:9},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:200};},
  });
  assert.equal(retried.blocked,false);
  assert.equal(calls,2);
});

test('external side-effect endpoint does not automatically retry a failed operation', async () => {
  const shared=coordinator();
  const req=request('/api/admin/channel-publisher/test',{body:'{"mode":"dry-run-disabled"}'});
  const url=new URL(req.url);
  let calls=0;

  await runSensitiveMutationWithReplay({
    request:req,url,user:{id:11},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:503};},
  });
  const duplicate=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:11},memory:{},coordinator:shared,
    handler:async()=>{calls+=1;return {status:200};},
  });

  assert.equal(sensitiveMutationRetryPolicy('/api/admin/channel-publisher/test',503),false);
  assert.equal(duplicate.blocked,true);
  assert.equal(duplicate.reason,'duplicate_failed');
  assert.equal(calls,1);
});

test('replay identity rejects coercible actors, malformed bodies and oversized idempotency keys',async()=>{
  const req=request('/api/runtime-controls');
  assert.equal(
    await sensitiveMutationReplayIdentity(req,new URL(req.url),{id:true}),
    null,
  );
  assert.equal(
    await sensitiveMutationReplayIdentity(req,new URL(req.url),{id:[7]}),
    null,
  );

  const malformed={
    method:'POST',
    url:'https://example.com/api/runtime-controls',
    headers:{get:()=>({toString:()=> 'key'})},
    clone:()=>({text:async()=>({toString:()=> '{}'})}),
  };
  assert.equal(
    await sensitiveMutationReplayIdentity(malformed,{pathname:'/api/runtime-controls'},{id:7}),
    null,
  );

  const longKey='x'.repeat(129);
  const withLongKey=request('/api/runtime-controls',{idempotencyKey:longKey});
  const identity=await sensitiveMutationReplayIdentity(withLongKey,new URL(withLongKey.url),{id:7});
  assert.equal(identity,null);
});

test('different actors, bodies and explicit keys receive independent distributed identities', async () => {
  const a=await sensitiveMutationReplayIdentity(
    request('/api/runtime-controls',{body:'{"enabled":false}'}),
    new URL('https://example.com/api/runtime-controls'),
    {id:1},
  );
  const b=await sensitiveMutationReplayIdentity(
    request('/api/runtime-controls',{body:'{"enabled":true}'}),
    new URL('https://example.com/api/runtime-controls'),
    {id:1},
  );
  const c=await sensitiveMutationReplayIdentity(
    request('/api/runtime-controls',{body:'{"enabled":false}'}),
    new URL('https://example.com/api/runtime-controls'),
    {id:2},
  );
  const d=await sensitiveMutationReplayIdentity(
    request('/api/runtime-controls',{body:'{"enabled":false}',idempotencyKey:'client-op-1'}),
    new URL('https://example.com/api/runtime-controls'),
    {id:1},
  );
  assert.notEqual(a.operationKey,b.operationKey);
  assert.notEqual(a.operationKey,c.operationKey);
  assert.notEqual(a.operationKey,d.operationKey);
  for (const identity of [a,b,c,d]) {
    assert.match(identity.operationKey,/^[a-f0-9]{64}$/);
    assert.match(identity.requestDigest,/^[a-f0-9]{64}$/);
  }
  assert.match(d.idempotencyKeyHash,/^[a-f0-9]{64}$/);
});

test('reusing one explicit idempotency key with a different body is rejected as a conflict', async () => {
  const shared=coordinator();
  const first=request('/api/admin/billing/refund',{
    body:'{"chargeId":"charge-1"}',
    idempotencyKey:'client-operation-123',
  });
  const second=request('/api/admin/billing/refund',{
    body:'{"chargeId":"charge-2"}',
    idempotencyKey:'client-operation-123',
  });

  await runSensitiveMutationWithReplay({
    request:first,url:new URL(first.url),user:{id:10},memory:{},coordinator:shared,
    handler:async()=>({status:200}),
  });
  const conflict=await runSensitiveMutationWithReplay({
    request:second,url:new URL(second.url),user:{id:10},memory:{},coordinator:shared,
    handler:async()=>({status:200}),
  });
  assert.equal(conflict.blocked,true);
  assert.equal(conflict.reason,'request_conflict');

  const persisted=JSON.stringify([...shared.store.values()]);
  assert.ok(!persisted.includes('client-operation-123'));
  assert.ok(!persisted.includes('charge-1'));
  assert.ok(!persisted.includes('charge-2'));
});

test('persistent claim requires strict boolean, state, reason and lease token',async()=>{
  const req=request('/api/runtime-controls');
  const url=new URL(req.url);
  for(const claim of [
    {claimed:'true',state:'inflight',reason:'claimed',leaseToken:'lease-token-00000001'},
    {claimed:true,state:'completed',reason:'claimed',leaseToken:'lease-token-00000001'},
    {claimed:true,state:'inflight',reason:'claimed',leaseToken:'short'},
    {claimed:false,state:'failed',reason:'unknown'},
  ]){
    let calls=0;
    const result=await runSensitiveMutationWithReplay({
      request:req,url,user:{id:7},memory:{},
      coordinator:{
        claim:async()=>claim,
        complete:async()=>({ok:true,updated:true,state:'completed'}),
        fail:async()=>({ok:true,updated:true,state:'failed',retryable:false}),
      },
      handler:async()=>{calls+=1;return {status:200};},
    });
    assert.equal(result.blocked,true);
    assert.equal(result.reason,'guard_unavailable');
    assert.equal(calls,0);
  }
});

test('retryable failure is released locally only after strict persistent fail confirmation',async()=>{
  const req=request('/api/runtime-controls/rollback');
  const url=new URL(req.url);
  const memory={};
  let claims=0;
  const coordinator={
    claim:async()=>({
      claimed:true,
      state:'inflight',
      reason:'claimed',
      leaseToken:'lease-token-00000001',
    }),
    complete:async()=>({ok:true,updated:true,state:'completed'}),
    fail:async()=>{
      claims+=1;
      return {ok:'true',updated:'true',state:'failed',retryable:true};
    },
  };
  const first=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory,coordinator,
    handler:async()=>({status:503}),
  });
  assert.equal(first.replayPersistenceConfirmed,false);
  assert.equal(claims,1);

  const second=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory,coordinator,
    handler:async()=>({status:200}),
  });
  assert.equal(second.blocked,true);
  assert.equal(second.reason,'duplicate_failed');
});

test('successful handler falls back to non-retryable fail when completion is unconfirmed',async()=>{
  const req=request('/api/admin/channel-publisher/test');
  const url=new URL(req.url);
  const settlements=[];
  const result=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory:{},
    coordinator:{
      claim:async()=>({
        claimed:true,
        state:'inflight',
        reason:'claimed',
        leaseToken:'lease-token-00000001',
      }),
      complete:async()=>{
        settlements.push('complete');
        return {ok:'true',updated:'true',state:'completed'};
      },
      fail:async(_identity,_claim,retryable)=>{
        settlements.push(`fail:${retryable}`);
        return {ok:true,updated:true,state:'failed',retryable};
      },
    },
    handler:async()=>({status:200}),
  });
  assert.deepEqual(settlements,['complete','fail:false']);
  assert.equal(result.replayPersistenceConfirmed,true);
  assert.equal(result.replayPersistenceDegraded,undefined);
});

test('successful handler reports degraded replay persistence when both terminal settlements fail',async()=>{
  const req=request('/api/admin/channel-publisher/test');
  const url=new URL(req.url);
  const result=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory:{},
    coordinator:{
      claim:async()=>({
        claimed:true,
        state:'inflight',
        reason:'claimed',
        leaseToken:'lease-token-00000001',
      }),
      complete:async()=>{throw new Error('complete unavailable');},
      fail:async()=>({ok:false,updated:false,state:'failed',retryable:false}),
    },
    handler:async()=>({status:200}),
  });
  assert.equal(result.blocked,false);
  assert.equal(result.replayPersistenceConfirmed,false);
  assert.equal(result.replayPersistenceDegraded,true);
});

test('persistent ledger outage fails closed before a sensitive handler runs', async () => {
  let calls=0;
  const req=request('/api/admin/billing/refund',{body:'{"chargeId":"charge-outage"}'});
  const result=await runSensitiveMutationWithReplay({
    request:req,
    url:new URL(req.url),
    user:{id:15},
    memory:{},
    coordinator:{
      claim:async()=>{throw new Error('database unavailable');},
      complete:async()=>{throw new Error('must not complete');},
      fail:async()=>{throw new Error('must not fail');},
    },
    handler:async()=>{calls+=1;return {status:200};},
  });
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'guard_unavailable');
  assert.equal(result.retryAfter,3);
  assert.equal(calls,0);
});

test('malformed clock or local ledger entry cannot bypass distributed replay ownership',async()=>{
  const req=request('/api/runtime-controls');
  const url=new URL(req.url);
  const identity=await sensitiveMutationReplayIdentity(req,url,{id:7});
  const memory={sensitiveMutationReplay:new Map([[
    identity.operationKey,
    {state:'completed',createdAt:true,expiresAt:'999999999999'},
  ]])};
  let claimCalls=0;
  const result=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory,now:()=>true,
    coordinator:{
      claim:async()=>{
        claimCalls+=1;
        return {claimed:false,state:'completed',reason:'duplicate_completed'};
      },
      complete:async()=>({ok:true,updated:true,state:'completed'}),
      fail:async()=>({ok:true,updated:true,state:'failed',retryable:false}),
    },
    handler:async()=>({status:200}),
  });
  assert.equal(claimCalls,1);
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'duplicate_completed');
});

test('malformed memory object fails closed before sensitive execution',async()=>{
  const req=request('/api/runtime-controls');
  let calls=0;
  const result=await runSensitiveMutationWithReplay({
    request:req,url:new URL(req.url),user:{id:7},memory:[],
    coordinator:coordinator(),
    handler:async()=>{calls+=1;return {status:200};},
  });
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'guard_unavailable');
  assert.equal(calls,0);
});

test('v6.27 migration provides backend-only atomic distributed mutation idempotency', () => {
  const sql=fs.readFileSync('supabase/migrations/supabase_migration_v6_27.sql','utf8').toLowerCase();
  for (const marker of [
    'create table if not exists public.sensitive_mutation_idempotency',
    'alter table public.sensitive_mutation_idempotency enable row level security',
    'grant select, insert, update, delete on table public.sensitive_mutation_idempotency',
    'create or replace function public.claim_sensitive_mutation',
    'create or replace function public.complete_sensitive_mutation',
    'create or replace function public.fail_sensitive_mutation',
    'create or replace function public.cleanup_sensitive_mutation_idempotency',
    "reason', 'duplicate_inflight'",
    "reason', 'duplicate_completed'",
    "reason', 'duplicate_failed'",
    "reason', 'request_conflict'",
    "state='inflight'",
    "state='completed'",
    "state='failed'",
    'lease_token=p_lease_token',
    'security invoker',
  ]) assert.ok(sql.includes(marker),marker);

  assert.doesNotMatch(sql,/request_body|raw_body|init_data|telegram_init|authorization\s+text|bot_token\s+text|api_token\s+text/);
});
