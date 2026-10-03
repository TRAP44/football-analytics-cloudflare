import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SENSITIVE_REPLAY_ENTRIES,
  SENSITIVE_REPLAY_WINDOW_MS,
  isReplaySensitiveMutation,
  runSensitiveMutationWithReplay,
  sensitiveMutationReplayPaths,
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

test('sensitive mutation inventory excludes ordinary reads and personal upserts', () => {
  assert.equal(isReplaySensitiveMutation(request('/api/runtime-controls'),new URL('https://example.com/api/runtime-controls')),true);
  assert.equal(isReplaySensitiveMutation(request('/api/runtime-controls',{method:'GET'}),new URL('https://example.com/api/runtime-controls')),false);
  assert.equal(isReplaySensitiveMutation(request('/api/preferences',{method:'PUT'}),new URL('https://example.com/api/preferences')),false);
  assert.ok(sensitiveMutationReplayPaths().includes('/api/admin/billing/refund'));
  assert.ok(sensitiveMutationReplayPaths().includes('/api/model-remediation'));
});

test('exact replay after successful sensitive mutation is blocked', async () => {
  const memory={};
  let calls=0;
  const req=request();
  const url=new URL(req.url);
  const first=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:42},memory,
    handler:async()=>{calls+=1; return {status:200,ok:true};},
  });
  const second=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:42},memory,
    handler:async()=>{calls+=1; return {status:200,ok:true};},
  });
  assert.equal(first.blocked,false);
  assert.equal(second.blocked,true);
  assert.equal(second.reason,'duplicate_completed');
  assert.equal(calls,1);
});

test('concurrent identical sensitive mutation is blocked while first is inflight', async () => {
  const memory={};
  let release;
  let calls=0;
  const gate=new Promise(resolve=>{ release=resolve; });
  const req=request('/api/model-remediation',{body:'{"action":"recover","candidateToken":"abc"}'});
  const url=new URL(req.url);
  const first=runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory,
    handler:async()=>{ calls+=1; await gate; return {status:200}; },
  });
  await new Promise(resolve=>setTimeout(resolve,0));
  const duplicate=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:7},memory,
    handler:async()=>{ calls+=1; return {status:200}; },
  });
  assert.equal(duplicate.blocked,true);
  assert.equal(duplicate.reason,'duplicate_inflight');
  release();
  await first;
  assert.equal(calls,1);
});

test('different body, route or user receives a different replay identity', async () => {
  const memory={};
  let calls=0;
  const run=async(req,user)=>await runSensitiveMutationWithReplay({
    request:req,url:new URL(req.url),user,memory,
    handler:async()=>{calls+=1; return {status:200};},
  });
  assert.equal((await run(request('/api/runtime-controls',{body:'{"enabled":false}'}),{id:1})).blocked,false);
  assert.equal((await run(request('/api/runtime-controls',{body:'{"enabled":true}'}),{id:1})).blocked,false);
  assert.equal((await run(request('/api/runtime-controls',{body:'{"enabled":false}'}),{id:2})).blocked,false);
  assert.equal((await run(request('/api/runtime-controls/rollback',{body:'{"revision":1}'}),{id:1})).blocked,false);
  assert.equal(calls,4);
});

test('failed or throwing operation releases reservation for safe retry', async () => {
  const memory={};
  const req=request('/api/calibration-control',{body:'{"action":"freeze"}'});
  const url=new URL(req.url);
  let calls=0;
  const failed=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:9},memory,
    handler:async()=>{calls+=1; return {status:503};},
  });
  assert.equal(failed.blocked,false);
  const retried=await runSensitiveMutationWithReplay({
    request:req,url,user:{id:9},memory,
    handler:async()=>{calls+=1; return {status:200};},
  });
  assert.equal(retried.blocked,false);
  assert.equal(calls,2);

  const req2=request('/api/runtime-controls/rollback',{body:'{"revision":2}'});
  await assert.rejects(
    runSensitiveMutationWithReplay({
      request:req2,url:new URL(req2.url),user:{id:9},memory,
      handler:async()=>{throw new Error('db down');},
    }),
    /db down/,
  );
  const afterThrow=await runSensitiveMutationWithReplay({
    request:req2,url:new URL(req2.url),user:{id:9},memory,
    handler:async()=>({status:200}),
  });
  assert.equal(afterThrow.blocked,false);
});

test('idempotency key participates in replay identity without being stored raw', async () => {
  const memory={};
  const firstReq=request('/api/admin/billing/refund',{
    body:'{"chargeId":"charge-1"}',
    idempotencyKey:'client-operation-123',
  });
  const secondReq=request('/api/admin/billing/refund',{
    body:'{"chargeId":"charge-1"}',
    idempotencyKey:'client-operation-123',
  });
  await runSensitiveMutationWithReplay({
    request:firstReq,url:new URL(firstReq.url),user:{id:10},memory,
    handler:async()=>({status:200}),
  });
  const duplicate=await runSensitiveMutationWithReplay({
    request:secondReq,url:new URL(secondReq.url),user:{id:10},memory,
    handler:async()=>({status:200}),
  });
  assert.equal(duplicate.blocked,true);
  assert.ok([...memory.sensitiveMutationReplay.keys()].every(key=>/^[a-f0-9]{64}$/.test(key)));
  assert.ok(!JSON.stringify([...memory.sensitiveMutationReplay.entries()]).includes('client-operation-123'));
});

test('replay ledger is time-bounded and cardinality-bounded', async () => {
  const memory={};
  let now=1_000_000;
  for (let i=0;i<MAX_SENSITIVE_REPLAY_ENTRIES+30;i+=1) {
    const req=request('/api/runtime-controls',{body:JSON.stringify({revision:i})});
    await runSensitiveMutationWithReplay({
      request:req,url:new URL(req.url),user:{id:20},memory,now:()=>now++,
      handler:async()=>({status:200}),
    });
  }
  assert.ok(memory.sensitiveMutationReplay.size<=MAX_SENSITIVE_REPLAY_ENTRIES);

  now+=SENSITIVE_REPLAY_WINDOW_MS+1;
  const fresh=request('/api/runtime-controls',{body:'{"after":"ttl"}'});
  await runSensitiveMutationWithReplay({
    request:fresh,url:new URL(fresh.url),user:{id:20},memory,now:()=>now,
    handler:async()=>({status:200}),
  });
  assert.equal(memory.sensitiveMutationReplay.size,1);
});
