import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcAdmissionQueue} from '../src/rpc-admission-queue.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('throwing cancellation cannot strand active or pending expirations or block a new caller',async t=>{
  let clock=0,release,abortCalls=0;const events=[];
  const abort=AbortController.prototype.abort;
  t.mock.method(AbortController.prototype,'abort',function(reason){
    if(reason?.code==='UPSTREAM_TIMEOUT'){abortCalls++;throw new Error('foreign request context');}
    return abort.call(this,reason);
  });
  const queue=createRpcAdmissionQueue({maxActive:1,now:()=>clock,onEvent:name=>events.push(name)});
  const old=queue('project',()=>new Promise(resolve=>release=resolve),1800,'old');
  const waiting=queue('project',()=>assert.fail('expired pending claim must not execute'),1800,'old');
  // Observe rejections immediately without waiting for a timer in an abandoned context.
  const oldResult=old.then(()=>assert.fail('old success'),error=>error);
  const waitingResult=waiting.then(()=>assert.fail('waiting success'),error=>error);
  await turn();clock=2100;
  let fresh;
  assert.doesNotThrow(()=>{fresh=queue('project',async()=>42,1800,'fresh');});
  assert.equal(await fresh,42);
  assert.equal((await oldResult).code,'UPSTREAM_TIMEOUT');
  assert.equal((await waitingResult).code,'UPSTREAM_TIMEOUT');
  assert.equal(abortCalls,2);assert.deepEqual(events,['rateClaimLeaseReaped']);
  release();await turn();
  assert.equal(await queue('project',async()=>43,1800,'fresh'),43);
});

test('a timer expiry rejects once despite abort throwing and late completion cannot succeed',async t=>{
  let release,aborts=0;
  const abort=AbortController.prototype.abort;
  t.mock.method(AbortController.prototype,'abort',function(reason){
    if(reason?.code==='UPSTREAM_TIMEOUT'){aborts++;throw new Error('cancel failed');}
    return abort.call(this,reason);
  });
  const queue=createRpcAdmissionQueue({maxActive:1});
  const old=queue('project',()=>new Promise(resolve=>release=resolve),1000);
  await assert.rejects(old,{code:'UPSTREAM_TIMEOUT'});
  assert.equal(aborts,1);
  release('late success');await turn();
  assert.equal(await queue('project',async()=>77,1800),77);
  assert.equal(aborts,1);
});
