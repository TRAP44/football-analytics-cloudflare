import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {localLoadDatabaseConfig} from './real-database-load-config.js';

const file=process.argv[2];
if(!file)throw new Error('Path to disposable Supabase status JSON required.');
const status=JSON.parse(readFileSync(file,'utf8'));
const env={...process.env,ISOLATED_REAL_DB_ACK:'disposable',
  LOCAL_LOAD_SUPABASE_URL:status.API_URL || status.api_url,
  LOCAL_LOAD_SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY || status.service_role_key};
localLoadDatabaseConfig(env);
const reports=[];
mkdirSync('load-results',{recursive:true});
for(const peak of [10,50,100,1000])rmSync(`load-results/real-database-http-${peak}.json`,{force:true});
rmSync('load-results/real-database-http-summary.json',{force:true});
for(const peak of [10,50,100,1000]) {
  try {
    execFileSync(process.execPath,['scripts/isolated-launch-capacity-check.js','--real-database',`--peak=${peak}`,`--users=${peak===1000?10000:peak}`],
      {env,stdio:['ignore','pipe','pipe'],timeout:300000,maxBuffer:2*1024*1024});
  } catch {
    process.exitCode=1;
  }
  let report;
  try {report=JSON.parse(readFileSync(`load-results/real-database-http-${peak}.json`,'utf8'));}
  catch {throw new Error('Load did not produce a valid sanitized report; connection details suppressed.');}
  reports.push(report);
  console.log(JSON.stringify({peak,passed:report.loadPassed,rows:report.rows,dbHttpStatus:report.stats.dbHttpStatus,dbErrorsByOperation:report.stats.dbErrorsByOperation}));
  if(process.exitCode || !report.loadPassed)break;
}
const output={scope:'Disposable real Supabase/PostgreSQL/PostgREST, local HTTP/full Worker composition; not deployed Cloudflare or hosted Nano capacity',
  productionChanged:false,productionCapacityConfirmed:false,tariffs:{workers:'Free (owner confirmed)',supabase:'Free / Nano (owner screenshot)',apiFootball:'PRO (owner confirmed)'},reports};
writeFileSync('load-results/real-database-http-summary.json',JSON.stringify(output,null,2)+'\n');

if(!process.exitCode){
  const report=execFileSync(process.execPath,['scripts/scheduled-lease-load-check.js',file],{env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  output.scheduledLeaseLoad=JSON.parse(report.trim());
  writeFileSync('load-results/real-database-http-summary.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({phase:'scheduled_lease_load_verified',...output.scheduledLeaseLoad}));
}
