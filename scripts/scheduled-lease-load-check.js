import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {localLoadDatabaseConfig} from './real-database-load-config.js';
import {createSupabaseClient} from '../src/supabase-client.js';
import {createCommonInfrastructureRuntime} from '../src/common-infrastructure-runtime.js';
import {createScheduledLeaseRuntime} from '../src/scheduled-lease.js';

async function main(){
 const status=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const target=localLoadDatabaseConfig({...process.env,LOCAL_LOAD_SUPABASE_URL:status.API_URL || status.api_url,LOCAL_LOAD_SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY || status.service_role_key});
 const cfg={supabaseUrl:target.url,supabaseKey:target.key};
 const client=createSupabaseClient({fetchWithTimeout:createCommonInfrastructureRuntime({bumpTelemetry:()=>{}}).fetchWithTimeout,redactMessage:()=> 'suppressed'});
 const prefix=`lease-load-${randomUUID()}`;
 const claims=[],attempts=new Map(),payloads=new Map(),events=[];
 const stats={claims:0,renewTransport:0,renewAttempts:0,lostResponses:0};
 const unavailable=()=>Object.assign(new Error('isolated injected timeout'),{code:'UPSTREAM_TIMEOUT'});
 const base=createScheduledLeaseRuntime({hasSupabase:()=>true,supaRpc:async(...args)=>{stats.claims++;return client.supaRpc(...args);}});
 async function batch(count,task){
  let cursor=0;const output=new Array(count);
  await Promise.all(Array.from({length:Math.min(count,20)},async()=>{while(cursor<count){const id=cursor++;output[id]=await task(id);}}));return output;
 }
 const started=performance.now();
 await batch(1000,async id=>{
  const claim=await base.claimScheduledJob(cfg,{jobKey:`${prefix}:${id}`,groupKey:`${prefix}:${id}`,scheduledAt:new Date(),leaseSeconds:120});
  assert.equal(claim.claimed,true);assert.equal(claim.persistent,true);claims[id]=claim;
 });
 const raceKey=`${prefix}-race`,raceAt=new Date();
 const race=await batch(40,()=>base.claimScheduledJob(cfg,{jobKey:raceKey,groupKey:raceKey,scheduledAt:raceAt,leaseSeconds:120}));
 assert.equal(race.filter(row=>row.claimed).length,1,'Concurrent claim created multiple owners');
 const runtime=createScheduledLeaseRuntime({hasSupabase:()=>true,recordOpsEvent:async(_cfg,event)=>events.push(event),supaRpc:async(config,name,payload,timeout)=>{
  assert.equal(name,'renew_scheduled_job');assert.equal(timeout,1800);
  const id=Number(payload.p_job_key.split(':').at(-1)),scenario=id%5;
  const attempt=(attempts.get(id) || 0)+1;attempts.set(id,attempt);stats.renewAttempts++;
  assert.ok(attempt<=2,'Renew retry exceeded its hard ceiling');
  const encoded=JSON.stringify(payload);
  if(payloads.has(id))assert.ok(payloads.get(id)===encoded,'Retry changed ownership payload');else payloads.set(id,encoded);
  if(scenario===1 || scenario===3)throw unavailable();
  stats.renewTransport++;
  const result=await client.supaRpc(config,name,payload,timeout);
  if(scenario===0 && attempt===1){assert.equal(result.renewed,true);stats.lostResponses++;throw unavailable();}
  return result;
 }});
 const durations=[];
 const results=await batch(1000,async id=>{
  const claim={...claims[id]};
  if(id%5===2)claim.leaseToken='isolated-wrong-owner-token';
  if(id%5===3)claim.lockedUntil=new Date(Date.now()+4000).toISOString();
  const at=performance.now();const result=await runtime.renewScheduledJob(cfg,claim);durations.push(performance.now()-at);
  const expected=id%5===0 || id%5===4;
  assert.equal(result.renewed,expected);assert.equal(attempts.get(id),id%5===0 || id%5===1 ? 2 : 1);
  return result;
 });
 const rows=await client.supaSelectMany(cfg,'scheduled_job_leases',{job_key:`like.${prefix}:*`},{limit:1000,select:'job_key,lease_token,status,locked_until'});
 assert.equal(rows.length,1000);
 for(const row of rows){const id=Number(row.job_key.split(':').at(-1));assert.ok(row.lease_token===claims[id].leaseToken,'Database owner token changed');assert.equal(row.status,'running');assert.ok(Date.parse(row.locked_until)>=Date.parse(claims[id].lockedUntil),'Renewal shortened an existing lease');}
 assert.equal(stats.claims,1040);assert.equal(stats.renewAttempts,1400);assert.equal(stats.renewTransport,800);assert.equal(stats.lostResponses,200);
 assert.equal(events.filter(event=>event.code==='SCHEDULED_LEASE_RENEW_RECOVERED').length,200);
 assert.equal(events.filter(event=>event.code==='SCHEDULED_LEASE_RENEW_FAILED').length,400);
 durations.sort((a,b)=>a-b);
 const report={scope:'Disposable real PostgreSQL/PostgREST; 20 parallel lease operations; injected response loss/transport failure, no actual cron tasks or Telegram sends',passed:true,leases:1000,claimRaceContenders:40,claimRaceOwners:1,sqlConcurrencyCap:20,renewed:results.filter(row=>row.renewed).length,expectedDeclines:results.filter(row=>!row.renewed).length,...stats,ownerTokensPreserved:true,leaseNeverShortened:true,durationMs:Math.round(performance.now()-started),renewP95Ms:+durations[Math.ceil(durations.length*.95)-1].toFixed(2),productionCapacityConfirmed:false};
 mkdirSync('load-results',{recursive:true});writeFileSync('load-results/scheduled-lease-load.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Disposable scheduled lease load failed; connection and owner details suppressed.');process.exitCode=1;});
