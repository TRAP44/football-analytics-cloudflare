import test from 'node:test';
import assert from 'node:assert/strict';
import {createDurableRpcOperation,createIdempotentRpcRecovery} from '../src/idempotent-rpc-recovery.js';
import {createSupabaseClient} from '../src/supabase-client.js';
const cfg={supabaseUrl:'https://example.supabase.co',supabaseKey:'local-only',cronRunner:'github-actions'};
const name='write_analysis_cache_versioned';
const valid=value=>{assert.equal(typeof value?.stored,'boolean');};
const turn=async()=>{for(let n=0;n<5;n++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const timeout=()=>Object.assign(new Error('timeout'),{code:'UPSTREAM_TIMEOUT'});
const error=code=>Object.assign(new Error('redacted'),{code});
function harness(t,raw){
  t.mock.timers.enable({apis:['setTimeout']});let now=0;const calls=[];
  const operation=createDurableRpcOperation((...args)=>{calls.push(args);return raw(calls.length,...args);},{now:()=>now});
  return {calls,operation,tick:async ms=>{now+=ms;t.mock.timers.tick(ms);await turn();}};
}

test('cold-schema success needs one request and snapshots mutable payload and configuration',async t=>{
  const pending=deferred(),config={...cfg},payload={nested:{n:1}},h=harness(t,()=>pending.promise);
  const result=h.operation(config,name,payload,7000,{}, {validate:valid});
  config.supabaseKey='changed';payload.nested.n=9;await turn();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0][0].supabaseKey,'local-only');assert.equal(h.calls[0][2].nested.n,1);
  pending.resolve({stored:true,reason:'stored'});assert.equal((await result).stored,true);
});

test('schema downgrade is permitted only after one definite failure, in the original budget',async t=>{
  let legacy=0,left;
  const pending=deferred(),h=harness(t,()=>pending.promise);
  const result=h.operation(cfg,name,{},7000,{}, {validate:valid,legacy:async(_c,_p,remaining)=>{legacy++;left=remaining;return {stored:true,reason:'legacy'};}});
  await turn();await h.tick(1500);pending.reject(error('PGRST202'));await turn();
  assert.equal((await result).reason,'legacy');assert.equal(legacy,1);assert.equal(h.calls.length,1);assert.equal(left,5500);
});

test('an ambiguous failed request then missing function never downgrades to a legacy mutation',async t=>{
  let legacy=0;
  const h=harness(t,n=>{throw n===1?timeout():error('PGRST202');});
  await assert.rejects(h.operation(cfg,name,{},7000,{}, {validate:valid,legacy:async()=>{legacy++;}}),{code:'PGRST202'});
  assert.equal(h.calls.length,2);assert.equal(legacy,0);
});

test('known-schema stalled write gets one backup, same body, and cancels the loser',async t=>{
  const pending=deferred();const h=harness(t,n=>n===2?pending.promise:Promise.resolve({stored:true,reason:'stored'}));
  await h.operation(cfg,name,{},7000,{}, {validate:valid});
  const result=h.operation(cfg,name,{payload:{key:'value'}},7000,{}, {validate:valid});
  await turn();await h.tick(2000);assert.equal(h.calls.length,3);
  assert.equal((await result).stored,true);assert.deepEqual(h.calls[1][2],h.calls[2][2]);
  assert.equal(h.calls[1][5].aborted,true);assert.equal(h.calls[2][3],2000);
});

test('both unknown responses fall back to read-only confirmation within seven seconds',async t=>{
  let confirmed=0,left;const h=harness(t,()=>new Promise(()=>{}));
  const result=h.operation(cfg,name,{},7000,{}, {validate:valid,confirm:async(_c,_p,remaining)=>{confirmed++;left=remaining;return {stored:true,reason:'same'};}});
  await turn();await h.tick(4000);
  assert.equal((await result).reason,'same');assert.equal(confirmed,1);assert.equal(left,3000);
  assert.equal(h.calls.length,1,'unknown schema does not launch an ambiguous delayed request');
  assert.equal(h.calls[0][5].aborted,true);
});

test('stalled confirmation cannot extend the original operation deadline',async t=>{
  let signal;const h=harness(t,()=>new Promise(()=>{}));
  const result=h.operation(cfg,name,{},7000,{}, {validate:valid,confirm:async(_c,_p,_ms,s)=>{signal=s;return new Promise(()=>{});}});
  const rejected=assert.rejects(result,{code:'UPSTREAM_TIMEOUT'});await turn();await h.tick(4000);await h.tick(3000);await rejected;
  assert.equal(signal.aborted,true);await h.tick(10000);assert.equal(h.calls.length,1);
});

test('ordinary auth and rate limits never retry or trigger a confirmation read',async t=>{
  for(const code of ['HTTP_401','HTTP_403','HTTP_429']){
    let calls=0,reads=0;
    const op=createDurableRpcOperation(async()=>{calls++;throw error(code);});
    await assert.rejects(op(cfg,name,{},7000,{}, {validate:valid,confirm:async()=>{reads++;}}),{code});
    assert.equal(calls,1);assert.equal(reads,0);
  }
});

test('only one delayed idempotent fallback is active per client; unrelated mutations are not replayed',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0;const pending=deferred(),calls=[];
  const recover=createIdempotentRpcRecovery(async(_c,n,p,_b,_h,signal)=>{calls.push({n,p,signal});return pending.promise;},{now:()=>now});
  const a=recover(cfg,name,{key:'a'},7000,{}),b=recover(cfg,'claim_scheduled_job_owned',{key:'b'},7000,{});
  await turn();now=2000;t.mock.timers.tick(2000);await turn();assert.equal(calls.length,3);
  pending.resolve({stored:true,claimed:true});await Promise.all([a,b]);
  let raw=0;const unsafe=createIdempotentRpcRecovery(async()=>{raw++;throw timeout();});
  await assert.rejects(unsafe(cfg,'complete_scheduled_job',{},7000,{}));assert.equal(raw,1);
});

test('ownership confirmation requires exact job, group, time, token, state and active horizon',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const at=new Date().toISOString(),future=new Date(Date.now()+720000).toISOString();
  for(const change of [null,{job_key:'other'},{group_key:'other'},{scheduled_at:'2000-01-01T00:00:00Z'},{lease_token:'other'},{status:'done'},{locked_until:new Date(0).toISOString()}]){
    let now=0,owner,posts=0,reads=0;
    const client=createSupabaseClient({now:()=>now,fetchWithTimeout:async(url,init)=>{
      if(init.method==='POST'){posts++;owner=JSON.parse(init.body).p_owner_token;throw timeout();}
      reads++;return Response.json([{job_key:'cron:test',group_key:'cron-global',scheduled_at:at,lease_token:owner,status:'running',locked_until:future,...change}]);
    }});
    const result=client.supaRpc(cfg,'claim_scheduled_job',{p_job_key:'cron:test',p_group_key:'cron-global',p_scheduled_at:at});
    if(change)await assert.rejects(result,{code:'UPSTREAM_TIMEOUT'});
    else assert.equal((await result).leaseToken,owner);
    assert.equal(posts,2);assert.equal(reads,1);
  }
});

test('cache confirmation compares full JSON and metadata; newer different content is not durable',async()=>{
  const row={cache_key:'test:1',fixture_id:1,payload:{a:1,b:{c:2}},expires_at:new Date(Date.now()+60000).toISOString(),provider:'test',source_updated_at:null,freshness_status:'unknown',updated_at:new Date().toISOString()};
  for(const newer of [false,true]){
    let posts=0;
    const client=createSupabaseClient({fetchWithTimeout:async(_u,init)=>{
      if(init.method==='POST'){posts++;throw timeout();}
      return Response.json([{...row,payload:newer?{a:9}:{b:{c:2},a:1},updated_at:newer?new Date(Date.parse(row.updated_at)+1000).toISOString():row.updated_at}]);
    }});
    assert.equal(await client.supaUpsert(cfg,'analysis_cache',row,'cache_key'),!newer);assert.equal(posts,2);
  }
});

test('opaque-key confirmed PGRST303 retries, ordinary401 remains terminal',async()=>{
  const row={cache_key:'x',fixture_id:1,payload:{ok:true},expires_at:new Date(Date.now()+60000).toISOString(),provider:'test',source_updated_at:null,freshness_status:'unknown',updated_at:new Date().toISOString()};
  for(const trusted of [true,false]){
    let calls=0;
    const client=createSupabaseClient({fetchWithTimeout:async()=>{
      calls++;return calls===1?Response.json({code:'PGRST303'},{status:401,headers:trusted?{'proxy-status':'PostgREST; error=PGRST303'}:{}}):Response.json({stored:true,reason:'stored'});
    }});
    const result=client.supaUpsert({...cfg,supabaseKey:'sb_secret_local_only'},'analysis_cache',row,'cache_key');
    if(trusted){assert.equal(await result,true);assert.equal(calls,2);}else{await assert.rejects(result);assert.equal(calls,1);}
  }
});


test('legacy cache rollout requires returned persistence evidence and rejects a silently guarded stale write',async()=>{
  const row={cache_key:'rollout:1',fixture_id:1,payload:{version:1},expires_at:new Date(Date.now()+60000).toISOString(),provider:'test',source_updated_at:null,freshness_status:'unknown',updated_at:new Date().toISOString()};
  for(const kind of ['stored','guarded','different','minimal']){
    let calls=0;
    const client=createSupabaseClient({fetchWithTimeout:async(url,init)=>{
      calls++;
      if(String(url).includes('/rpc/'))return Response.json({code:'PGRST202'},{status:404});
      assert.match(new Headers(init.headers).get('Prefer'),/return=representation/);
      if(kind==='minimal')return new Response(null,{status:204});
      return Response.json(kind==='guarded'?[]:[kind==='different'?{...row,payload:{version:2}}:row]);
    }});
    const result=client.supaUpsert(cfg,'analysis_cache',row,'cache_key');
    if(['different','minimal'].includes(kind))await assert.rejects(result);
    else assert.equal(await result,kind==='stored');
    assert.equal(calls,2,'one definite schema miss and one legacy write only');
  }
});
