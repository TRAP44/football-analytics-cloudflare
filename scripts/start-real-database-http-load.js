// Owned disposable PostgreSQL + PostgREST. No cloud credentials or production targets.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {buildMigrationPlan} from './prepare-supabase-ci-migrations.js';

const suffix=randomUUID(),network=`mr-load-${suffix}`,database=`mr-db-${suffix}`,rest=`mr-rest-${suffix}`;
const directory=mkdtempSync(join(tmpdir(),'mr-load-'));
const password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex');
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
function safe(value){return String(value).replaceAll(password,'[redacted]').replaceAll(secret,'[redacted]').slice(0,1200);}
function execute(command,args,{input='',env=process.env,quiet=false}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});let output='',errors='';
    child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
    child.on('error',()=>reject(new Error('Cannot start isolated load command.')));
    child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(quiet?'Load profile did not pass; see sanitized load-results.':safe(errors || 'Isolated command failed.'))));
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
const docker=(args,options={})=>execute('docker',['--host=unix:///var/run/docker.sock',...args],{...options,env:dockerEnv});
const query=sql=>docker(['exec','-i','-u','postgres',database,'psql','-h','127.0.0.1','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d','isolated'],{input:sql});
const created=[];let gateway;
try {
  await docker(['network','create',network]);created.push(['network','rm',network]);
  await docker(['run','-d','--name',database,'--network',network,'--memory','512m','--cpus','1',
    '-e',`POSTGRES_PASSWORD=${password}`,'-e','POSTGRES_DB=isolated',
    'postgres:16.11-bookworm@sha256:a2420e9555e2224583fe84d0bb3f0b967e69354ae3a0be55a9c14e251388c4eb',
    'postgres','-c','max_connections=60','-c','shared_buffers=128MB']);created.push(['rm','-f','-v',database]);
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){try{await query('select 1;');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,250));}}
  assert.ok(ready,'Disposable PostgreSQL did not start.');
  await query(`create role anon;create role authenticated;create role service_role bypassrls;
    create role authenticator login noinherit password '${password}';grant anon,authenticated,service_role to authenticator;`);
  const plan=buildMigrationPlan('fresh');
  for(const migration of plan)await query(readFileSync(migration.source,'utf8'));
  const contract=JSON.parse(readFileSync('release-contract.json','utf8'));
  const fingerprint=await query("select public.backend_schema_contract_v2()->>'fingerprint';");
  assert.equal(fingerprint,contract.databaseContract.freshInstallFingerprint,'Disposable DB schema contract must match release.');
  console.log(JSON.stringify({phase:'database_ready',migrations:plan.length,schemaFingerprint:fingerprint,postgres:'16.11',memoryMiB:512,maxConnections:60,restPool:20}));
  await docker(['run','-d','--name',rest,'--network',network,'-p','127.0.0.1:54320:3000',
    '-e',`PGRST_DB_URI=postgres://authenticator:${password}@${database}:5432/isolated`,
    '-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_POOL=20',
    '-e',`PGRST_JWT_SECRET=${secret}`,
    'ghcr.io/supabase/postgrest@sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df']);created.push(['rm','-f','-v',rest]);
  const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encoded({alg:'HS256',typ:'JWT'})}.${encoded({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})}`;
  const token=`${unsigned}.${createHmac('sha256',secret).update(unsigned).digest('base64url')}`;
  // Prefix adapter only: all actual REST responses come from PostgREST/PostgreSQL.
  gateway=createServer((req,res)=>{
    if(!req.url.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
    // The hosted Supabase gateway exchanges apikey for the service JWT.
    // Here only the generated disposable key is accepted for that exchange.
    const headers={...req.headers};
    if(req.headers.apikey===token)headers.authorization=`Bearer ${token}`;
    const upstream=httpRequest({host:'127.0.0.1',port:54320,path:req.url.slice('/rest/v1'.length),method:req.method,headers},response=>{
      res.writeHead(response.statusCode,response.headers);response.pipe(res);
    });upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{gateway.once('error',reject);gateway.listen(54321,'127.0.0.1',resolve);});
  ready=false;let lastHealth={};
  for(let attempt=0;attempt<60;attempt++){
    try{const response=await fetch('http://127.0.0.1:54321/rest/v1/runtime_controls?id=eq.global',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(2000)});lastHealth={status:response.status};const body=await response.json();lastHealth={status:response.status,code:typeof body?.code==='string'?body.code:null};if(response.ok && body[0]?.id==='global'){ready=true;break;}}
    catch(error){lastHealth={...lastHealth,failure:safe(error?.cause?.code || error?.name || 'network')};}await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)console.log(JSON.stringify({phase:'rest_health_failed',...lastHealth}));
  assert.ok(ready,'Disposable PostgREST did not become healthy.');
  const file=join(directory,'status.json');
  writeFileSync(file,JSON.stringify({API_URL:'http://127.0.0.1:54321',SERVICE_ROLE_KEY:token}),{mode:0o600});
  // Synthetic paid user: profile upserts must never overwrite billing fields.
  await query("insert into public.users(telegram_id,first_name,plan,subscription_until) values (700000,'Before load','PRO','2099-01-01T00:00:00Z');");
  await execute(process.execPath,['scripts/run-real-database-http-load.js',file],{quiet:true}).then(output=>console.log(output));
  const evidence=JSON.parse(await query("select json_build_object('users', (select count(*) from public.users where telegram_id between 700000 and 709999),'history',(select count(*) from public.analysis_history where telegram_id between 700000 and 709999),'fullAiEvents',(select count(*) from public.growth_events where telegram_id between 700000 and 709999 and event_name='full_ai'))::text;"));
  assert.equal(Number(evidence.users),10000,'HTTP load must persist all synthetic users in real PostgreSQL.');
  assert.ok(Number(evidence.history)>=1000,'Cached analyses must persist real history rows.');
  assert.equal(Number(evidence.fullAiEvents),1160,'Deferred analytics must persist all events from the four ramp steps.');
  const paidProfilePreserved=await query("select plan='PRO' and subscription_until='2099-01-01T00:00:00Z'::timestamptz and first_name='Load' from public.users where telegram_id=700000;");
  assert.equal(paidProfilePreserved,'t','Profile synchronization must preserve paid subscription fields and update profile data.');
  evidence.paidProfilePreserved=true;
  const summaryFile='load-results/real-database-http-summary.json';
  const summary=JSON.parse(readFileSync(summaryFile,'utf8'));
  summary.databaseEvidence={...evidence,migrations:plan.length,schemaFingerprint:fingerprint,postgres:'16.11',rest:'16.4',memoryMiB:512,cpuLimit:1,maxConnections:60,restPool:20};
  writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify({phase:'database_persistence_verified',...evidence}));
} catch(error) {console.error(safe(error.message));process.exitCode=1;}
finally {
  if(gateway)await new Promise(resolve=>gateway.close(resolve));
  for(const args of created.reverse())try{await docker(args);}catch{console.error('Owned disposable resource cleanup failed.');process.exitCode=1;}
  rmSync(directory,{recursive:true,force:true});
}
