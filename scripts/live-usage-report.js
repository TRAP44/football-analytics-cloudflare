// Only bounded GET projections of ops_events. Never select messages, user IDs or raw metadata.
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const PAGE=250,MAX_PAGES=4;
const OPERATIONS=['ai','match','live','search'];
const COUNTERS=['sent','edited','closed','failed','unknown','unknownPending','deferred','staleSkipped','oldestWaitSec','telegramCalls'];
const STOPS=new Set(['rate_limited','checkpoint_failed','favorites_lookup_failed','execution_budget']);
const integer=value=>typeof value==='number' && Number.isSafeInteger(value) && value>=0 && value<=2_000_000_000 ? value
  : typeof value==='string' && /^\d{1,12}$/.test(value) && Number(value)<=2_000_000_000 ? Number(value) : null;
const percentile=(values,p)=>values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1] : null;

export function summarizeTimings(rows){
  const groups=Object.fromEntries(OPERATIONS.map(key=>[key,[]]));let invalid=0;
  for(const row of rows){
    const ms=integer(row?.duration_ms);
    if(!OPERATIONS.includes(row?.reason)||ms===null||ms>120000){invalid++;continue;}
    groups[row.reason].push(ms);
  }
  return {invalid,operations:Object.fromEntries(OPERATIONS.map(key=>{
    const values=groups[key];
    return [key,{samples:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):null,
      evidence:values.length>=20?'observed_sample':'insufficient_samples'}];
  }))};
}

export function summarizeScoreboards(rows){
  const totals=Object.fromEntries(COUNTERS.filter(x=>x!=='oldestWaitSec').map(key=>[key,0]));
  const stops={};let maxOldestWaitSec=null,invalidCounters=0,partialRuns=0,cappedRuns=0;
  for(const row of rows){
    if(row?.code==='FAVORITE_SCOREBOARD_PARTIAL')partialRuns++;
    if(row?.capped===true || row?.capped==='true')cappedRuns++;
    for(const key of COUNTERS){
      const value=integer(row?.[key]);
      if(value===null){invalidCounters++;continue;}
      if(key==='oldestWaitSec')maxOldestWaitSec=Math.max(maxOldestWaitSec??0,value);else totals[key]+=value;
    }
    if(STOPS.has(row?.stopped))stops[row.stopped]=(stops[row.stopped]||0)+1;
    else if(row?.stopped)stops.other=(stops.other||0)+1;
  }
  return {runEvents:rows.length,partialRuns,cappedRuns,totals,maxOldestWaitSec,invalidCounters,stops,
    evidence:rows.length?'observed_activity':'no_activity_evidence',
    note:'Counters count attempts across runs; deferred is not a unique backlog. Successful Telegram API calls do not prove reading or timely delivery.'};
}

function summarizeErrors(rows){
  const counts={};let uncategorized=0;
  for(const row of rows){
    if(typeof row?.code!=='string'||! /^[A-Z][A-Z0-9_]{0,99}$/.test(row.code)){uncategorized++;continue;}
    if(row.code.startsWith('DAILY_DIGEST_'))continue;
    counts[row.code]=(counts[row.code]||0)+1;
  }
  return {sampleRows:rows.length,uncategorized,byCode:counts};
}

export async function collectLiveUsage({env={},fetchImpl=fetch,now=new Date()}={}){
  const key=env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  let base;
  try{base=new URL(env.SUPABASE_URL);}catch{throw new Error('Existing Supabase configuration is required.');}
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/' || !base.hostname.endsWith('.supabase.co') || typeof key!=='string' || !key.trim())throw new Error('Existing Supabase configuration is required.');
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid observation time.');
  const end=now.toISOString(),start=new Date(now.getTime()-6*3600000).toISOString();
  async function read(select,filters){
    const rows=[];let pages=0;
    for(let page=0;page<MAX_PAGES;page++){
      const url=new URL('/rest/v1/ops_events',base);
      for(const [name,value] of Object.entries({select,...filters,order:'created_at.desc',limit:String(PAGE),offset:String(page*PAGE)}))url.searchParams.set(name,value);
      url.searchParams.set('and',`(created_at.gte.${start},created_at.lte.${end})`);
      let result;
      try{
        const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
        if(response.status!==200)throw new Error('read_failed');
        result=await response.json();
      }catch{throw new Error('Usage observation unavailable; upstream details suppressed.');}
      if(!Array.isArray(result)||result.length>PAGE||result.some(x=>!x || typeof x!=='object' || Array.isArray(x)))throw new Error('Invalid usage observation response.');
      pages++;rows.push(...result);
      if(result.length<PAGE)return {rows,pages,truncated:false};
    }
    return {rows,pages,truncated:true};
  }
  // Sequential reads keep pressure bounded; at most 12 requests / 3000 rows total.
  const timings=await read('duration_ms,reason:metadata->>reason',{source:'eq.client',event_type:'eq.client_telemetry',code:'eq.OPERATION_TIMING'});
  const boards=await read(['code',...COUNTERS.map(x=>`${x}:metadata->>${x}`),'stopped:metadata->>stopped','capped:metadata->>capped'].join(','),{source:'eq.favorite_scoreboard',event_type:'eq.favorite_scoreboard_run',code:'in.(FAVORITE_SCOREBOARD_RUN,FAVORITE_SCOREBOARD_PARTIAL)'});
  const errors=await read('code',{severity:'in.(warning,error,critical)'});
  return {scope:'Read-only production observations, not a load test or capacity proof',window:{start,end,hours:6},
    coverage:{timings:{pages:timings.pages,truncated:timings.truncated},scoreboards:{pages:boards.pages,truncated:boards.truncated},errors:{pages:errors.pages,truncated:errors.truncated}},
    timings:summarizeTimings(timings.rows),scoreboards:summarizeScoreboards(boards.rows),errors:summarizeErrors(errors.rows),
    complete:![timings,boards,errors].some(x=>x.truncated),productionCapacityConfirmed:false,
    limitations:['Client timing is observational, may include failed operations, can be missing, and does not distinguish cache from fresh AI.',
      'Offset pagination is bounded and best effort, not a transactional snapshot; concurrent inserts can shift page boundaries.',
      'No user identifiers are queried: sample counts are events, not unique people.',
      'Warning/error counts are persisted rows, not occurrences; ops events may be deduplicated.',
      'Missing, sparse or truncated evidence must not be treated as healthy delivery or sufficient capacity.']};
}

export function usageMarkdown(report){
  return ['# Наблюдение AI / LIVE за 6 часов','',`Период UTC: ${report.window.start} — ${report.window.end}`,
    `Полнота выборки: ${report.complete?'лимит страниц не достигнут':'ограниченная выборка — достигнут лимит страниц'}`,'',
    '| Операция | Замеры | p50, мс | p95, мс | Данные |','|---|---:|---:|---:|---|',
    ...OPERATIONS.map(key=>{const x=report.timings.operations[key];return `| ${key} | ${x.samples} | ${x.p50Ms??'—'} | ${x.p95Ms??'—'} | ${x.evidence} |`;}),'',
    `LIVE: событий запусков ${report.scoreboards.runEvents}; частичных ${report.scoreboards.partialRuns}; ограниченных бюджетом ${report.scoreboards.cappedRuns}; ${JSON.stringify(report.scoreboards.totals)}.`,
    `Максимум oldestWaitSec: ${report.scoreboards.maxOldestWaitSec??'нет данных'}. Отложенные сообщения — сумма попыток, не число уникальных людей.`,
    `Ошибки/предупреждения по коду: ${JSON.stringify(report.errors.byCode)}.`,
    '',...report.limitations.map(x=>'- '+x),'','Полная production-вместимость и своевременная доставка этим отчётом не подтверждаются.',''].join('\n');
}

export async function main(){
  const report=await collectLiveUsage({env:process.env});
  mkdirSync('load-results',{recursive:true});
  writeFileSync('load-results/live-usage.json',JSON.stringify(report,null,2)+'\n');
  writeFileSync('load-results/live-usage.md',usageMarkdown(report));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,usageMarkdown(report));
  process.stdout.write(usageMarkdown(report));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await main();}catch{process.stderr.write('Usage report unavailable; no upstream details or credentials logged.\n');process.exitCode=1;}
}
