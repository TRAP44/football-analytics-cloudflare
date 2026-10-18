import test from 'node:test';
import assert from 'node:assert/strict';
import {withRequestDeadline} from '../src/request-deadline.js';
import {createReminderDeliveryRuntime} from '../src/reminder-delivery-runtime.js';
import {createProviderRequestBoundary} from '../src/providers/provider-request.js';

test('reminder stuck body returns unknown without a second send',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0,finish;
 const runtime=createReminderDeliveryRuntime({hasSupabase:()=>false,supaHeaders:()=>({}),redactOpsString:String,
  fetchWithTimeout:async()=>{calls++;return {ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})};},
 });
 const result=runtime.sendTelegramMessage(7,'fixture',{botToken:'fixture-token'});
 await new Promise(setImmediate);t.mock.timers.tick(7000);
 assert.equal((await result).outcome,'unknown');assert.equal(calls,1);finish({ok:true});
});
test('secondary provider cannot hang in a body read after headers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const api=createProviderRequestBoundary({withSingleFlight:async(_key,fn)=>fn(),sleepMs:async()=>{},
  fetchWithTimeout:async()=>{calls++;return {ok:true,status:200,json:()=>new Promise(()=>{})};},
 });
 const pending=api.providerRequestJson('https://fixture.invalid',{},{});await new Promise(setImmediate);t.mock.timers.tick(7000);
 await assert.rejects(pending,error=>error.code==='PROVIDER_TIMEOUT');assert.equal(calls,1);
});
test('a completed operation clears its timer and exhausted budget cannot start more work',async()=>{
 let clock=0;let calls=0;
 await assert.rejects(withRequestDeadline(async({check})=>{calls++;clock=100;check();calls++;},{budgetMs:100,now:()=>clock}),error=>error.code==='UPSTREAM_TIMEOUT');
 assert.equal(calls,1);assert.equal(await withRequestDeadline(async()=>42,{budgetMs:100}),42);
});
