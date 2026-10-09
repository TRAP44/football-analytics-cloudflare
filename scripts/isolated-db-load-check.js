import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { requireDbUrl } from './supabase-concurrency-gate.js';
const execute=promisify(execFile);
const url=requireDbUrl();
const user=900000000436;
async function query(sql,service=false) {
  try {
    const {stdout}=await execute('psql',[url,'-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',(service?'set role service_role; ':'')+sql],{timeout:30000,maxBuffer:1024*1024});
    return stdout.trim().split('\n').at(-1);
  } catch {throw new Error('Disposable database load query failed; connection details suppressed.');}
}
async function batch(count,task) {
  let cursor=0;
  const output=new Array(count),times=[];
  await Promise.all(Array.from({length:Math.min(count,20)},async()=>{
    while (cursor<count) {
      const i=cursor++,at=performance.now();
      output[i]=await task();times.push(performance.now()-at);
    }
  }));
  times.sort((a,b)=>a-b);
  return {output,p95Ms:+times[Math.ceil(count*.95)-1].toFixed(2)};
}
const rows=[];
try {
  for (const requests of [10,50,100]) {
    const key='isolated-load-'+requests;
    await query(`delete from public.usage_daily where telegram_id=${user}; delete from public.users where telegram_id=${user}; delete from public.provider_rate_windows where bucket_key='${key}'; delete from public.telegram_update_claims where update_key='${key}';`);
    const quota=await batch(requests,()=>query(`select public.consume_analysis_quota(${user},date '2099-10-09',5)::text;`,true));
    assert.equal(quota.output.map(JSON.parse).filter(r=>r.allowed===true).length,5);
    assert.equal(Number(await query(`select analyses from public.usage_daily where telegram_id=${user} and usage_date=date '2099-10-09';`)),5);
    const provider=await batch(requests,()=>query(`select public.claim_provider_request('${key}',4,60)::text;`,true));
    assert.equal(provider.output.map(JSON.parse).filter(r=>r.allowed===true).length,4);
    const dedupe=await batch(requests,()=>query(`select public.claim_telegram_update('${key}',90);`,true));
    assert.equal(dedupe.output.filter(r=>r==='t').length,1);
    assert.equal(Number(await query(`select duplicate_count from public.telegram_update_claims where update_key='${key}';`)),requests-1);
    rows.push({requests,sqlConcurrency:Math.min(requests,20),quotaAdmitted:5,providerAdmitted:4,telegramOwners:1,quotaP95Ms:quota.p95Ms,providerP95Ms:provider.p95Ms,dedupeP95Ms:dedupe.p95Ms});
  }
  mkdirSync('load-results',{recursive:true});
  writeFileSync('load-results/database-load.json',JSON.stringify({scope:'disposable Supabase; queue bursts with at most 20 psql sessions; timings include process startup, not production HTTP latency',rows},null,2));
  console.log('Disposable database load: 10/50/100 requests with 20-session cap passed quota, provider budget and Telegram dedupe checks.');
} finally {
  await query(`delete from public.usage_daily where telegram_id=${user}; delete from public.users where telegram_id=${user}; delete from public.provider_rate_windows where bucket_key in ('isolated-load-10','isolated-load-50','isolated-load-100'); delete from public.telegram_update_claims where update_key in ('isolated-load-10','isolated-load-50','isolated-load-100');`);
}
