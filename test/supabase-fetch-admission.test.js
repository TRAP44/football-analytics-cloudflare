import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseAdmissionFetch} from '../scripts/supabase-fetch-admission.js';
const origin='https://example.supabase.co';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
  const calls=[];
  const gate=createSupabaseAdmissionFetch((input,init)=>new Promise((resolve,reject)=>{
    const call={input,init,resolve,reject};calls.push(call);
    init?.signal?.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }),{origin,...options});
  return {calls,...gate};
}

test('ordinary bursts are capped at three while lease I/O has a reserved fourth slot',async()=>{
  const h=harness();
  const ordinary=Array.from({length:8},(_,i)=>h.fetch(`${origin}/rest/v1/analysis_cache?key=${i}`));
  await turn();assert.equal(h.calls.length,3);
  const lease=h.fetch(`${origin}/rest/v1/rpc/renew_scheduled_job`,{method:'POST',body:'unchanged'});
  await turn();assert.equal(h.calls.length,4);assert.equal(h.calls[3].init.body,'unchanged');
  h.calls[3].resolve('lease');assert.equal(await lease,'lease');await turn();assert.equal(h.calls.length,4,'ordinary calls cannot take the reserve');
  let drained=0;
  while(drained<8){
    for(const call of h.calls){if(call.input.includes('analysis_cache')&&!call.done){call.done=true;call.resolve('ok');drained++;}}
    await turn();
  }
  assert.deepEqual(await Promise.all(ordinary),Array(8).fill('ok'));
  assert.equal(h.stats.peakRegular,3);assert.equal(h.stats.peakActive,4);assert.equal(h.stats.started,9);
});

test('cancelled queued POST never reaches transport and does not run after capacity returns',async()=>{
  const h=harness({maxActive:2,maxRegular:1});
  const first=h.fetch(`${origin}/rest/v1/analysis_cache`);await turn();
  const controller=new AbortController();
  const write=h.fetch(`${origin}/rest/v1/rpc/claim_provider_request`,{method:'POST',signal:controller.signal});
  const rejected=assert.rejects(write,error=>error.name==='AbortError');controller.abort();await rejected;
  h.calls[0].resolve('ok');await first;await turn();
  assert.equal(h.calls.length,1);assert.equal(h.stats.cancelledQueued,1);
});

test('active cancellation releases a slot only when transport settles; no hidden retries',async()=>{
  const h=harness({maxActive:2,maxRegular:1}),controller=new AbortController();
  const first=h.fetch(`${origin}/rest/v1/analysis_cache`,{signal:controller.signal});await turn();
  const next=h.fetch(`${origin}/rest/v1/favorites`);
  const rejected=assert.rejects(first);controller.abort();await rejected;await turn();
  assert.equal(h.calls.length,2);h.calls[1].resolve('next');assert.equal(await next,'next');assert.equal(h.stats.started,2);
});

test('unrelated origins and the football relay bypass database admission',async()=>{
  const h=harness({maxActive:2,maxRegular:1});
  const urls=[`${origin}/rest/v1/analysis_cache`,'https://api.telegram.org/bot-private/sendMessage',`${origin}/functions/v1/football-relay/status`,'https://other.supabase.co/rest/v1/analysis_cache'];
  const work=urls.map(url=>h.fetch(url));await turn();assert.equal(h.calls.length,4);
  for(const call of h.calls)call.resolve('ok');await Promise.all(work);
  assert.equal(h.stats.started,1);assert.doesNotMatch(JSON.stringify(h.stats),/private|telegram|example|other/);
});

test('queue is bounded, already aborted work is not sent, and rejections drain capacity',async()=>{
  const h=harness({maxActive:2,maxRegular:1,maxQueued:1});
  const first=h.fetch(`${origin}/rest/v1/analysis_cache`);await turn();
  const second=h.fetch(`${origin}/rest/v1/favorites`);
  await assert.rejects(h.fetch(`${origin}/rest/v1/users`),error=>error.code==='BACKGROUND_DB_ADMISSION_FULL');
  const controller=new AbortController();controller.abort();await assert.rejects(h.fetch(`${origin}/rest/v1/users`,{signal:controller.signal}));
  const rejected=assert.rejects(first);h.calls[0].reject(Error('failure'));await rejected;await turn();
  h.calls[1].resolve('ok');await second;assert.equal(h.stats.rejectedFull,1);assert.equal(h.stats.cancelledQueued,1);
});

test('a full ordinary queue cannot reject lease work while the reserved slot is free',async()=>{
  const h=harness({maxActive:2,maxRegular:1,maxQueued:1});
  const first=h.fetch(`${origin}/rest/v1/analysis_cache`);await turn();
  const queued=h.fetch(`${origin}/rest/v1/favorites`);
  const lease=h.fetch(`${origin}/rest/v1/scheduled_job_leases`);await turn();
  assert.equal(h.calls.length,2);assert.ok(h.calls[1].input.endsWith('scheduled_job_leases'));
  h.calls[1].resolve('lease');assert.equal(await lease,'lease');
  h.calls[0].resolve('first');await first;await turn();h.calls[2].resolve('queued');await queued;
});
