import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';

// Only a new owned Docker container, no published ports or outside network.
// Real PostgreSQL and unchanged function bodies from repository migrations.
// This checks RPC atomicity, not the complete Supabase schema/REST pool.
const execute=promisify(execFile),name=`mr-isolated-pg-${randomUUID()}`;
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
const image='postgres:16.11-bookworm@sha256:a2420e9555e2224583fe84d0bb3f0b967e69354ae3a0be55a9c14e251388c4eb';
async function docker(args){return (await execute('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,timeout:60000,maxBuffer:2*1024*1024})).stdout.trim();}
async function query(sql){return docker(['exec','-u','postgres',name,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d','isolated','-c',sql]);}
function definition(file,fn){const source=readFileSync(file,'utf8');const start=source.indexOf(`create or replace function public.${fn}(`);assert.ok(start>=0);const end=source.indexOf('\n$$;',start);assert.ok(end>start);return source.slice(start,end+4);}
let created=false;
try {
  await docker(['run','-d','--name',name,'--network','none','-e','POSTGRES_PASSWORD=isolated-only','-e','POSTGRES_DB=isolated',image]);created=true;
  let ready=false;
  for(let i=0;i<60;i++){try{await query('select 1;');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.ok(ready,'isolated PostgreSQL did not start');
  const tableSource=readFileSync('supabase/migrations/supabase_migration_v6_16.sql','utf8');
  const tableStart=tableSource.indexOf('create table if not exists public.telegram_update_claims');
  const tableEnd=tableSource.indexOf('\n);',tableStart)+3;
  await query(`create role service_role bypassrls;create role anon;create role authenticated;
    create table public.provider_rate_windows(bucket_key text primary key,window_started_at timestamptz not null,request_count integer not null default 0 check(request_count>=0),updated_at timestamptz not null default now());
    ${tableSource.slice(tableStart,tableEnd)}
    alter table public.telegram_update_claims add column duplicate_count integer not null default 0,add column last_duplicate_at timestamptz;
    ${definition('supabase/migrations/supabase_migration_v6_18.sql','claim_provider_request')}
    ${definition('supabase/migrations/supabase_migration_v6_17.sql','claim_telegram_update')}
    revoke all on public.provider_rate_windows,public.telegram_update_claims from public,anon,authenticated;
    grant select,insert,update,delete on public.provider_rate_windows,public.telegram_update_claims to service_role;`);
  async function batch(count,sql){let cursor=0;const values=[],times=[];await Promise.all(Array.from({length:20},async()=>{while(cursor<count){cursor++;const at=performance.now();values.push(await query(`set role service_role;${sql}`));times.push(performance.now()-at);}}));times.sort((a,b)=>a-b);return {values,p95Ms:+times[Math.ceil(count*.95)-1].toFixed(2)};}
  const count=1000;
  const provider=await batch(count,"select public.claim_provider_request('mass-launch-provider',282,3600)::text;");
  const claims=provider.values.map(value=>JSON.parse(value.split('\n').at(-1)));
  assert.equal(claims.filter(x=>x.allowed).length,282);
  assert.equal(Number(await query("select request_count from public.provider_rate_windows where bucket_key='mass-launch-provider';")),282);
  const telegram=await batch(count,"select public.claim_telegram_update('mass-launch-telegram',300);");
  assert.equal(telegram.values.filter(value=>value.split('\n').at(-1)==='t').length,1);
  assert.equal(Number(await query("select duplicate_count from public.telegram_update_claims where update_key='mass-launch-telegram';")),999);
  const result={scope:'Disposable PostgreSQL 16, exact production RPC function bodies, queue of 1000 calls with max 20 psql sessions; timings include Docker/psql startup, not production DB latency or full Supabase',
    requestsPerScenario:count,sqlConcurrency:20,providerAllowed:282,providerDenied:718,providerP95Ms:provider.p95Ms,
    telegramOwners:1,telegramDuplicates:999,telegramP95Ms:telegram.p95Ms};
  mkdirSync('load-results',{recursive:true});writeFileSync('load-results/postgres-burst.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {if(created)await docker(['rm','-f','-v',name]);}
