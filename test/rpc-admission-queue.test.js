import test from 'node:test';
import assert from 'node:assert/strict';
import {createRpcAdmissionQueue} from '../src/rpc-admission-queue.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('transport is bounded, each claim is independent and waits for its own result',async()=>{
 const queue=createRpcAdmissionQueue({maxActive:2});const gates=[];let active=0,peak=0;
 const jobs=Array.from({length:20},(_,id)=>queue('project',async()=>{peak=Math.max(peak,++active);await new Promise(resolve=>gates.push(resolve));active--;return id;},5000));
 await turn();assert.equal(gates.length,2);
 while(gates.length){gates.splice(0).forEach(resolve=>resolve());await turn();}
 assert.deepEqual(await Promise.all(jobs),Array.from({length:20},(_,id)=>id));assert.equal(peak,2);
});
test('waiting consumes the original deadline, with no expired claim dispatched',async()=>{
 let clock=0,release;const queue=createRpcAdmissionQueue({maxActive:1,now:()=>clock});const remaining=[];
 const first=queue('project',async ms=>{remaining.push(ms);await new Promise(resolve=>release=resolve);},1800);
 const second=queue('project',async ms=>{remaining.push(ms);clock=1400;},1800);
 const third=queue('project',async()=>assert.fail('expired request must not write'),1800);
 const thirdResult=assert.rejects(third,{code:'UPSTREAM_TIMEOUT'});
 await turn();clock=700;release();await first;await second;
 await thirdResult;
 assert.equal(remaining[0],1800);assert.equal(remaining[1],1100);
});
test('queue expiry removes a waiting claim so a later release cannot execute it',async()=>{
 let release,called=false;const queue=createRpcAdmissionQueue({maxActive:1});
 const first=queue('p',()=>new Promise(resolve=>release=resolve),5000);
 const second=queue('p',async()=>{called=true;},20);
 await assert.rejects(second,{code:'UPSTREAM_TIMEOUT'});release();await first;await turn();assert.equal(called,false);
});
test('insufficient remaining transport deadline rejects before dispatch',async()=>{
 let clock=0,release;const queue=createRpcAdmissionQueue({maxActive:1,now:()=>clock});
 const first=queue('p',()=>new Promise(resolve=>release=resolve),1800);
 const second=queue('p',async()=>assert.fail('no write after budget exhaustion'),1800);const failed=assert.rejects(second,{code:'UPSTREAM_TIMEOUT'});
 await turn();clock=1400;release();await first;await failed;
});
test('capacity rejects without replay and distinct connections have independent slots',async()=>{
 let release;const queue=createRpcAdmissionQueue({maxActive:1,maxQueued:1});
 const first=queue('p',()=>new Promise(resolve=>release=resolve),5000);
 const second=queue('p',async()=>{throw new Error('claim failed');},5000);const failed=assert.rejects(second,/claim failed/);
 await assert.rejects(queue('p',async()=>assert.fail('overflow'),5000),{code:'UPSTREAM_TIMEOUT'});
 assert.equal(await queue('other',async()=>77,5000),77);release();await first;await failed;
 assert.equal(await queue('p',async()=>88,5000),88);
});

test('a late successful transport cannot allow a request after its total deadline',async()=>{
 let clock=0;const queue=createRpcAdmissionQueue({now:()=>clock});
 await assert.rejects(queue('p',async()=>{clock=1801;return{allowed:true};},1800),{code:'UPSTREAM_TIMEOUT'});
});
