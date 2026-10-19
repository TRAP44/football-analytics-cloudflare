// Only bounded GET projections of operational events and public fixture kickoff dates. Never select messages, user IDs or raw metadata.
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const PAGE=250,MAX_PAGES=4;
const OPERATIONS=['ai','match','live','search'];
const COUNTERS=['sent','edited','closed','failed','unknown','unknownPending','deferred','staleSkipped','oldestWaitSec','telegramCalls'];
const STOPS=new Set(['rate_limited','checkpoint_failed','favorites_lookup_failed']);
const STAGES=['cacheMs','accessMs','fixtureMs','providersMs','enrichmentMs','persistenceMs','settlementMs'];
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
    return [key,{samples:values.length,p50Ms:values.length>=3?percentile(values,.5):null,p95Ms:values.length>=20?percentile(values,.95):null,maxMs:values.length?Math.max(...values):null,
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

export function summarizeAlerts(rows){
  const counters=['sent','duplicate','failed','unknown','fixturesChecked','checked'];
  const totals=Object.fromEntries(counters.map(key=>[key,0]));let invalidCounters=0;
  for(const row of rows)for(const key of counters){const value=integer(row?.[key]);if(value===null)invalidCounters++;else totals[key]+=value;}
  return {runEvents:rows.length,totals,invalidCounters,evidence:rows.length?'observed_activity':'no_activity_evidence',note:'Persisted aggregate run events, not unique deliveries or proof that a user read the message.'};
}

function summarizeErrors(rows){
  const counts={};let uncategorized=0;
  for(const row of rows){
    if(typeof row?.code!=='string'||! /^[A-Z][A-Z0-9_]{0,99}$/.test(row.code)){uncategorized++;continue;}
    if(row.code.startsWith('DAILY_DIGEST_') || row.code==='ANALYSIS_SLOW_REQUEST')continue;
    counts[row.code]=(counts[row.code]||0)+1;
  }
  return {sampleRows:rows.filter(row=>row.code!=='ANALYSIS_SLOW_REQUEST').length,uncategorized,byCode:counts};
}

const DISPATCH_REASONS=new Set(['token_missing','token_invalid','repository_invalid','fetch_unavailable','token_rejected','workflow_or_repository_not_found','dispatch_rejected','github_unavailable','timeout','network_error','rate_limited']);
export function summarizeDispatchFailures(rows){
  const byReason={},byHttpStatus={};let samples=0,lastFailureAt=null;
  for(const row of rows){
    if(row.code!=='BACKGROUND_JOBS_DISPATCH_FAILED')continue;
    samples++;
    const reason=DISPATCH_REASONS.has(row.dispatchReason)?row.dispatchReason:'unknown';
    byReason[reason]=(byReason[reason]||0)+1;
    const status=integer(row.status),key=status>=100 && status<=599?String(status):'unknown';
    byHttpStatus[key]=(byHttpStatus[key]||0)+1;
    const timestamp=typeof row.created_at==='string' && /^\d{4}-\d{2}-\d{2}T/.test(row.created_at)?Date.parse(row.created_at):NaN;
    if(Number.isFinite(timestamp) && (lastFailureAt===null || timestamp>Date.parse(lastFailureAt)))lastFailureAt=new Date(timestamp).toISOString();
  }
  return {samples,byReason,byHttpStatus,lastFailureAt,note:'Deduplicated failure rows only; absence does not establish successful dispatch. No token, raw response or error text is returned.'};
}

export function summarizeAnalysisDiagnostics(rows){
  const timings=[],stages=Object.fromEntries(STAGES.map(key=>[key,[]]));
  const failures={samples:0,byKind:{},byHttpStatus:{}};let invalidTimings=0;
  for(const row of rows){
    if(row.code==='CACHE_DB_WRITE'){
      failures.samples++;
      const kind=['http','timeout','transport_or_configuration','unknown'].includes(row.failureKind)?row.failureKind:'unknown';
      failures.byKind[kind]=(failures.byKind[kind]||0)+1;
      const status=integer(row.httpStatus),key=status>=400 && status<=599?String(status):'unknown';
      failures.byHttpStatus[key]=(failures.byHttpStatus[key]||0)+1;
    }
    if(row.code!=='ANALYSIS_SLOW_REQUEST')continue;
    const total=integer(row.duration_ms),values=STAGES.map(key=>integer(row[key]));
    if(total===null || total<2000 || total>600000 || values.some(value=>value===null || value>600000) || Math.abs(values.reduce((sum,value)=>sum+value,0)-total)>7){invalidTimings++;continue;}
    timings.push(total);
    STAGES.forEach((key,index)=>{if(values[index]>0)stages[key].push(values[index]);});
  }
  const summary=values=>({samples:values.length,p50Ms:values.length>=3?percentile(values,.5):null,p95Ms:values.length>=20?percentile(values,.95):null,maxMs:values.length?Math.max(...values):null});
  return {slowRequests:summary(timings),stages:Object.fromEntries(STAGES.map(key=>[key,summary(stages[key])])),invalidTimings,cacheWriteFailures:failures,
    note:'Only slow server requests (>=2s), including failures; sampled/deduplicated ops rows, not all requests. Nonzero phase cohorts differ; percentiles cannot be summed. Missing historical failure metadata is unknown.'};
}

export async function collectLiveUsage({env={},fetchImpl=fetch,now=new Date()}={}){
  const key=env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  let base;
  try{base=new URL(env.SUPABASE_URL);}catch{throw new Error('Existing Supabase configuration is required.');}
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/' || !base.hostname.endsWith('.supabase.co') || typeof key!=='string' || !key.trim())throw new Error('Existing Supabase configuration is required.');
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid observation time.');
  const end=now.toISOString(),start=new Date(now.getTime()-6*3600000).toISOString();
  async function read(select,filters,table='ops_events'){
    const rows=[];let pages=0;
    for(let page=0;page<MAX_PAGES;page++){
      if(!['ops_events','model_predictions','runtime_controls','settlement_watchdog_state'].includes(table))throw new Error('Invalid observation table.');
      const url=new URL(`/rest/v1/${table}`,base);
      for(const [name,value] of Object.entries({select,...filters,order:table==='model_predictions'?'kickoff_at.asc':table==='ops_events'?'created_at.desc':'id.asc',limit:String(PAGE),offset:String(page*PAGE)}))url.searchParams.set(name,value);
      if(table==='ops_events')url.searchParams.set('and',`(created_at.gte.${start},created_at.lte.${end})`);
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
  // Sequential reads keep pressure bounded; at most28requests /7000rows total.
  const timings=await read('duration_ms,reason:metadata->>reason',{source:'eq.client',event_type:'eq.client_telemetry',code:'eq.OPERATION_TIMING'});
  const boards=await read(['code',...COUNTERS.map(x=>`${x}:metadata->>${x}`),'stopped:metadata->>stopped','capped:metadata->>capped'].join(','),{source:'eq.favorite_scoreboard',event_type:'eq.favorite_scoreboard_run',code:'in.(FAVORITE_SCOREBOARD_RUN,FAVORITE_SCOREBOARD_PARTIAL)'});
  const errors=await read(['code','status','created_at','dispatchReason:metadata->>reason','duration_ms','httpStatus:metadata->>httpStatus','failureKind:metadata->>failureKind',...STAGES.map(key=>`${key}:metadata->>${key}`)].join(','),{or:'(severity.in.(warning,error,critical),code.eq.ANALYSIS_SLOW_REQUEST)'});
  const alerts=await read('code,sent:metadata->>sent,duplicate:metadata->>duplicate,failed:metadata->>failed,unknown:metadata->>unknown,fixturesChecked:metadata->>fixturesChecked,checked:metadata->>checked',{source:'eq.smart_notifications',event_type:'eq.smart_notification_scheduler',code:'in.(SMART_NOTIFICATION_RUN_OK,SMART_NOTIFICATION_RUN_DEGRADED)'});
  const pending=await read('kickoff_at',{status:'eq.pending',kickoff_at:`lt.${new Date(now.getTime()-86400000).toISOString()}`},'model_predictions');
  const controls=await read('auto_settlement_recovery_enabled',{id:'eq.global'},'runtime_controls');
  const watchdog=await read('consecutive_failures,circuit_open_until,last_run_at,last_status',{id:'eq.global'},'settlement_watchdog_state');
  const control=controls.rows.length===1?controls.rows[0]:null;
  const reliability=watchdog.rows.length===1?watchdog.rows[0]:null;
  const circuit=typeof reliability?.circuit_open_until==='string'?Date.parse(reliability.circuit_open_until):NaN;
  const lastRun=typeof reliability?.last_run_at==='string'?Date.parse(reliability.last_run_at):NaN;
  const settlementRecovery={
    automaticEnabled:typeof control?.auto_settlement_recovery_enabled==='boolean'?control.auto_settlement_recovery_enabled:null,
    consecutiveFailures:integer(reliability?.consecutive_failures),
    circuitOpen:reliability && reliability.circuit_open_until===null?false:Number.isFinite(circuit)?circuit>now.getTime():null,
    lastRunDay:Number.isFinite(lastRun)?new Date(lastRun).toISOString().slice(0,10):null,
    lastStatus:['ok','failed','partial','completed','running','never','blocked','idle'].includes(reliability?.last_status)?reliability.last_status:'unknown',
    note:'Read-only state; disabled recovery is not enabled automatically and pending results are never inferred.',
  };
  const dates=pending.rows.map(row=>typeof row.kickoff_at==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(row.kickoff_at)?Date.parse(row.kickoff_at):NaN);
  const validDates=dates.filter(Number.isFinite);
  const pendingResults={olderThan24hAtLeast:pending.rows.length,oldestKickoffDay:validDates.length?new Date(Math.min(...validDates)).toISOString().slice(0,10):null,invalidRows:dates.length-validDates.length,truncated:pending.truncated,note:'Old pending includes postponed matches; no result is inferred or written.'};
  return {scope:'Read-only production observations, not a load test or capacity proof',window:{start,end,hours:6},
    coverage:{timings:{pages:timings.pages,truncated:timings.truncated},scoreboards:{pages:boards.pages,truncated:boards.truncated},errors:{pages:errors.pages,truncated:errors.truncated},pending:{pages:pending.pages,truncated:pending.truncated},alerts:{pages:alerts.pages,truncated:alerts.truncated},controls:{pages:controls.pages,truncated:controls.truncated},watchdog:{pages:watchdog.pages,truncated:watchdog.truncated}},
    timings:summarizeTimings(timings.rows),scoreboards:summarizeScoreboards(boards.rows),errors:summarizeErrors(errors.rows),analysisDiagnostics:summarizeAnalysisDiagnostics(errors.rows),dispatchFailures:summarizeDispatchFailures(errors.rows),pendingResults,settlementRecovery,alerts:summarizeAlerts(alerts.rows),
    complete:![timings,boards,errors,pending,alerts,controls,watchdog].some(x=>x.truncated),productionCapacityConfirmed:false,
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
    `Старые pending (старше24ч, нижняя граница при ограничении): ${report.pendingResults?.olderThan24hAtLeast??'не проверено'}; самая ранняя дата: ${report.pendingResults?.oldestKickoffDay??'нет данных'}. Результаты не изменялись.`,
    `Короткие уведомления: ${JSON.stringify(report.alerts)}.`,
    `LIVE: событий запусков ${report.scoreboards.runEvents}; частичных ${report.scoreboards.partialRuns}; ограниченных бюджетом ${report.scoreboards.cappedRuns}; ${JSON.stringify(report.scoreboards.totals)}.`,
    `Максимум oldestWaitSec: ${report.scoreboards.maxOldestWaitSec??'нет данных'}. Отложенные сообщения — сумма попыток, не число уникальных людей.`,
    `Ошибки/предупреждения по коду: ${JSON.stringify(report.errors.byCode)}.`,
    `Запуск фоновых задач: ${JSON.stringify(report.dispatchFailures)}.`,
    `Контроль старых результатов: ${JSON.stringify(report.settlementRecovery)}.`,
    `Диагностика медленных AI (не вся выборка запросов): ${JSON.stringify(report.analysisDiagnostics)}.`,
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
