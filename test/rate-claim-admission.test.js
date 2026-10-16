import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseClient} from '../src/supabase-client.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const cfg={supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_secret_local'};
test('rate claims cap live transport at 128 without sharing decisions or replaying failures',async()=>{
 const calls=[],gates=[];let active=0,peak=0;
 const client=createSupabaseClient({fetchWithTimeout:async(url,init,timeout)=>{
  const body=JSON.parse(init.body);calls.push({url:String(url),body,timeout,headers:init.headers});peak=Math.max(peak,++active);
  await new Promise(resolve=>gates.push(resolve));active--;
  return {ok:true,json:async()=>({allowed:!body.p_bucket_key.endsWith(':1'),count:Number(body.p_bucket_key.split(':').at(-1))})};
 }});
 const requests=Array.from({length:300},(_,id)=>client.supaRpc(cfg,'claim_provider_request',{p_bucket_key:`preauth:analysis:${id}`,p_limit:5,p_window_seconds:60},1800));
 await turn();assert.equal(calls.length,128);
 while(gates.length){gates.splice(0).forEach(resolve=>resolve());await turn();}
 const results=await Promise.all(requests);assert.equal(calls.length,300);assert.equal(peak,128);assert.equal(results[1].allowed,false);
 assert.deepEqual(results.map(row=>row.count),Array.from({length:300},(_,id)=>id));
 assert.ok(calls.every(call=>call.timeout>=500 && call.timeout<=1800 && call.body.p_limit===5 && call.body.p_window_seconds===60));
});
test('queued claims keep connection/payload/header snapshots; unrelated RPCs are not queued',async()=>{
 const gates=[],calls=[];
 const client=createSupabaseClient({fetchWithTimeout:async(url,init)=>{
  calls.push({url:String(url),body:JSON.parse(init.body),headers:init.headers});
  if(JSON.parse(init.body).p_bucket_key?.startsWith('preauth:'))await new Promise(resolve=>gates.push(resolve));
  return{ok:true,json:async()=>({allowed:true})};
 }});
 const connection={...cfg};const jobs=Array.from({length:128},(_,id)=>client.supaRpc(connection,'claim_provider_request',{p_bucket_key:`preauth:${id}`},1800));
 const payload={p_bucket_key:'route:129:analyze',p_limit:10};const headers={'x-analysis-operation-id':'initial'};
 const queued=client.supaRpc(connection,'claim_provider_request',payload,1800,headers);
 connection.supabaseUrl='https://other.test';payload.p_limit=999;headers['x-analysis-operation-id']='changed';
 await client.supaRpc(cfg,'some_other_rpc',{},1800);
 assert.equal(calls.length,129);assert.ok(calls.some(call=>new URL(call.url).pathname.endsWith('/some_other_rpc')));
 await turn();gates.splice(0).forEach(resolve=>resolve());await Promise.all([...jobs,queued]);
 const last=calls.find(call=>call.body.p_bucket_key==='route:129:analyze');assert.equal(last.body.p_limit,10);assert.ok(last.url.startsWith(cfg.supabaseUrl));assert.equal(last.headers['x-analysis-operation-id'],'initial');
});

test('identical bucket keys still consume independent atomic claims',async()=>{
 let writes=0;
 const client=createSupabaseClient({fetchWithTimeout:async()=>{const count=++writes;return{ok:true,json:async()=>({allowed:count===1,count})};}});
 const payload={p_bucket_key:'preauth:analysis:same-network',p_limit:1,p_window_seconds:60};
 const results=await Promise.all([client.supaRpc(cfg,'claim_provider_request',payload,1800),client.supaRpc(cfg,'claim_provider_request',payload,1800)]);
 assert.equal(writes,2);assert.deepEqual(results,[{allowed:true,count:1},{allowed:false,count:2}]);
});

test('queued transports resume in the originating async context',async()=>{
 const {AsyncLocalStorage}=await import('node:async_hooks');const context=new AsyncLocalStorage();
 const gates=[],seen=[];
 const client=createSupabaseClient({fetchWithTimeout:async(_url,init)=>{
  const body=JSON.parse(init.body);seen.push([body.p_bucket_key,context.getStore()]);
  await new Promise(resolve=>gates.push(resolve));return{ok:true,json:async()=>({allowed:true})};
 }});
 const jobs=Array.from({length:140},(_,id)=>context.run(id,()=>client.supaRpc(cfg,'claim_provider_request',{p_bucket_key:`preauth:${id}`},1800)));
 await turn();while(gates.length){gates.splice(0).forEach(resolve=>resolve());await turn();}
 await Promise.all(jobs);assert.ok(seen.every(([bucket,id])=>bucket===`preauth:${id}`));
});
