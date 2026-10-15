import assert from 'node:assert/strict';
import {createServer,request as httpRequest,Agent} from 'node:http';
import {createHmac} from 'node:crypto';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {localLoadDatabaseConfig} from './real-database-load-config.js';
import {workerRuntime as worker} from '../test-support/worker-root.js';

// Full Worker fetch composition, real signed initData, local HTTP only.
// Supabase is simulated (20 ms); API-Football/Telegram are forbidden.
const full=process.argv.includes('--full');
const realDatabase=process.argv.includes('--real-database');
const localDatabase=realDatabase?localLoadDatabaseConfig(process.env):null;
const peakArg=process.argv.find(value=>value.startsWith('--peak='));
const usersArg=process.argv.find(value=>value.startsWith('--users='));
const concurrency=peakArg?Number(peakArg.split('=')[1]):full?1000:100;
const users=usersArg?Number(usersArg.split('=')[1]):full?10000:1000;
assert.ok(Number.isInteger(concurrency) && concurrency>=1 && concurrency<=1000);
assert.ok(Number.isInteger(users) && users>=concurrency && users<=10000);
const transportMs=20;
const token='123456:isolated-capacity-key';
const env={DEV_MODE:'false',BETA_ACCESS_ENABLED:'false',API_FOOTBALL_KEY:'isolated-key',
  TELEGRAM_BOT_TOKEN:token,SUPABASE_URL:localDatabase?.url || 'https://isolated.supabase.test',SUPABASE_SERVICE_ROLE_KEY:localDatabase?.key || 'isolated-key'};
const control={id:'global',maintenance_mode:false,analysis_enabled:true,search_enabled:true,
  live_enabled:true,reminders_enabled:true,expanded_data_enabled:true,auto_settlement_recovery_enabled:false,revision:1};
const date=new Date().toISOString().slice(0,10),fixtureId=771;
const match={fixtureId,status:'NS',date:new Date(Date.now()+3600000).toISOString(),home:{id:40,name:'Liverpool'},away:{id:50,name:'Chelsea'}};
await worker.getSharedCacheRuntime().setCache(`matches:${date}:v6-integrity`,0,{date,matches:Array.from({length:120},(_,i)=>({...match,fixtureId:fixtureId+i}))},{},20);
await worker.getSharedCacheRuntime().setCache(`fixture:${fixtureId}:v17-starting-xi-rc146`,fixtureId,
  {match,generatedAt:new Date().toISOString(),probabilities:{home:50,draw:30,away:20}},{},20);
const originalFetch=globalThis.fetch,stats={dbRequests:0,dbActive:0,dbPeak:0,modelLookups:0,dbByOperation:{},dbHttpStatus:{},dbErrorsByOperation:{},externalBlocked:0};
const pending=new Set(),rows=[],dbTimings=new Map();
let active=0,httpPeak=0,currentBarrier=null;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url || String(input));
  if(realDatabase?url.origin!==localDatabase.url:url.hostname!=='isolated.supabase.test'){stats.externalBlocked++;throw new Error('External transport forbidden by isolated load harness');}
  const operation=`${init.method || 'GET'} ${url.pathname}`;stats.dbByOperation[operation]=(stats.dbByOperation[operation] || 0)+1;
  stats.dbRequests++;stats.dbActive++;stats.dbPeak=Math.max(stats.dbPeak,stats.dbActive);
  const dbStarted=performance.now();
  try {
    if(realDatabase){
      if(url.pathname.endsWith('/model_predictions'))stats.modelLookups++;
      const response=await originalFetch(input,init);
      stats.dbHttpStatus[response.status]=(stats.dbHttpStatus[response.status] || 0)+1;
      if(!response.ok){const failure=`${operation} HTTP ${response.status}`;stats.dbErrorsByOperation[failure]=(stats.dbErrorsByOperation[failure] || 0)+1;}
      return response;
    }
    await new Promise(resolve=>setTimeout(resolve,transportMs));
    if(url.pathname.endsWith('/runtime_controls'))return Response.json([control]);
    if(url.pathname.endsWith('/model_predictions')){stats.modelLookups++;return Response.json([]);}
    if(url.pathname.includes('/rpc/'))return Response.json({allowed:true,count:1,retryAfter:0});
    return Response.json([]);
  } finally {
    stats.dbActive--;
    if(realDatabase){const values=dbTimings.get(operation) || [];values.push(performance.now()-dbStarted);dbTimings.set(operation,values);}
  }
};
const contexts={waitUntil(p){pending.add(p);p.finally(()=>pending.delete(p)).catch(()=>{});}};
const server=createServer(async(req,res)=>{
  active++;httpPeak=Math.max(httpPeak,active);
  try {
    const barrier=currentBarrier;
    if(barrier){barrier.arrived++;if(barrier.arrived===barrier.expected)barrier.release();await barrier.promise;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    const request=new Request(`https://isolated-app.test${req.url}`,{method:req.method,headers:req.headers,
      ...(body.length?{body}:{} )});
    const response=await worker.default.fetch(request,env,contexts);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('{"error":"isolated_handler_failure"}');}
  finally {active--;}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',10000,resolve));
const port=server.address().port;
const agent=new Agent({keepAlive:true,maxSockets:concurrency});
const lag=monitorEventLoopDelay({resolution:10});lag.enable();
function signed(index){const data=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:700000+index,first_name:'Load'})});
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  data.set('hash',createHmac('sha256',secret).update([...data.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  return data.toString();}
const identities=Array.from({length:users},(_,i)=>signed(i));
function send(index,path,body){return new Promise((resolve,reject)=>{
  const started=performance.now();
  const headers={'x-telegram-init-data':identities[index],'cf-connecting-ip':`10.${Math.floor(index/65536)%256}.${Math.floor(index/256)%256}.${index%256}`};
  if(body)headers['content-type']='application/json';
  const req=httpRequest({host:'127.0.0.1',port,path,method:body?'POST':'GET',headers,agent,timeout:30000},res=>{
    let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode,ms:performance.now()-started,body:((value)=>({cached:value.cached,fixtureId:value.matches?.[0]?.fixtureId}))(JSON.parse(raw))});}catch{reject(new Error('Malformed local HTTP response'));}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('local HTTP timeout')));req.end(body?JSON.stringify(body):undefined);
});}
async function run(name,count,path,body){
  const before={...stats};const started=performance.now();const responses=[];
  for(let offset=0;offset<count;offset+=concurrency){
    const expected=Math.min(concurrency,count-offset);
    currentBarrier={expected,arrived:0};currentBarrier.promise=new Promise(resolve=>currentBarrier.release=resolve);
    const wave=await Promise.all(Array.from({length:Math.min(concurrency,count-offset)},(_,i)=>send(offset+i,path,body)));
    currentBarrier=null;responses.push(...wave);
  }
  await Promise.allSettled([...pending]);
  const codes={};for(const r of responses)codes[r.status]=(codes[r.status] || 0)+1;
  if(!realDatabase)assert.equal(codes[200],count,`${name}: unexpected HTTP status ${JSON.stringify(codes)}`);
  if(body)assert.ok(responses.filter(r=>r.status===200).every(r=>r.body.cached===true),'all seeded analyses must remain cached');
  else assert.ok(responses.filter(r=>r.status===200).every(r=>r.body.fixtureId===fixtureId),'fixture identity preserved');
  const times=responses.map(r=>r.ms).sort((a,b)=>a-b);
  rows.push({name,requests:count,parallelClientCap:concurrency,httpStatus:codes,durationMs:Math.round(performance.now()-started),
    p50Ms:+times[Math.ceil(count*.5)-1].toFixed(2),p95Ms:+times[Math.ceil(count*.95)-1].toFixed(2),
    dbRequests:stats.dbRequests-before.dbRequests,modelLookups:stats.modelLookups-before.modelLookups});
}
try {
  await run('signed_feed_sessions',users,'/api/matches');
  await run('shared_cached_analysis',concurrency,'/api/analyze',{fixtureId});
  if(!realDatabase)assert.equal(stats.modelLookups,1,'one cold feed key must share one probability lookup per isolate');
  if(!realDatabase)assert.equal(stats.dbByOperation['GET /rest/v1/runtime_controls'],1,'one cold control-plane read per isolate; no forced admin refresh in this harness');
  assert.equal(httpPeak,concurrency,'the HTTP barrier must exercise the requested concurrent count');
  assert.equal(stats.externalBlocked,0,'no external service may be called even once');
  mkdirSync('load-results',{recursive:true});
  const dbOperationLatency=Object.fromEntries([...dbTimings].map(([operation,values])=>{values.sort((a,b)=>a-b);return [operation,{count:values.length,p50Ms:+values[Math.ceil(values.length*.5)-1].toFixed(2),p95Ms:+values[Math.ceil(values.length*.95)-1].toFixed(2)}];}));
  const result={dbOperationLatency,scope:realDatabase?'Local HTTP, full Worker fetch and real PostgreSQL/PostgREST over loopback; synthetic users/cached fixtures, one process. Not deployed Cloudflare/Supabase Nano throughput.':'Local HTTP, full Worker fetch and signed auth, one process/isolate, simulated Supabase 20ms; not Cloudflare capacity, real DB throughput, Telegram clients, or 1000 physical DB connections',
    target:{dailyUsers:users,peakClients:concurrency},latencyTargetMs:2000,latencyTargetMet:rows.every(row=>row.p95Ms<=2000),databaseTransport:realDatabase?'real':'simulated',productionCapacityConfirmed:false,loadPassed:rows.every(row=>row.httpStatus[200]===row.requests) && !Object.keys(stats.dbHttpStatus).some(status=>Number(status)>=400),rows,stats,httpPeak,eventLoopP95Ms:+(lag.percentile(95)/1e6).toFixed(2),rssMiB:+(process.memoryUsage().rss/1048576).toFixed(2)};
  writeFileSync(realDatabase?`load-results/real-database-http-${concurrency}.json`:full?'load-results/launch-capacity.json':'load-results/launch-capacity-smoke.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(realDatabase && !result.loadPassed)process.exitCode=1;
} finally {lag.disable();agent.destroy();await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;}
