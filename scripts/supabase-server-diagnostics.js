// Fixed, bounded metadata SELECTs via the dedicated read-only Management API.
// Never emit query text, identifiers, credentials, URLs, raw errors or log lines.
import {createHash} from 'node:crypto';
const TABLES=['runtime_controls','scheduled_job_leases','match_reminders','model_predictions','analysis_cache','ops_events'];
const TABLE_SQL=TABLES.map(name=>`'${name}'`).join(',');
export const CONNECTION_SQL=`select pg_catalog.current_setting('max_connections')::int as max_connections,
  pg_catalog.count(*)::int as connections,
  pg_catalog.count(*) filter(where state='active' and pid<>pg_catalog.pg_backend_pid())::int as active,
  pg_catalog.count(*) filter(where state='idle in transaction')::int as idle_in_transaction,
  pg_catalog.count(*) filter(where wait_event_type='Lock')::int as waiting_lock,
  pg_catalog.count(*) filter(where state is null and pid<>pg_catalog.pg_backend_pid())::int as restricted_activity_rows,
  coalesce(pg_catalog.max(extract(epoch from pg_catalog.clock_timestamp()-xact_start)) filter(where pid<>pg_catalog.pg_backend_pid()),0) as oldest_transaction_seconds
  from pg_catalog.pg_stat_activity where datname=pg_catalog.current_database()`;
export const TABLE_SQL_QUERY=`select relname as table_name,n_live_tup,n_dead_tup,seq_scan,seq_tup_read,idx_scan,
  pg_catalog.pg_table_size(relid) as table_bytes,pg_catalog.pg_indexes_size(relid) as index_bytes
  from pg_catalog.pg_stat_user_tables where schemaname='public' and relname in (${TABLE_SQL}) order by relname limit 6`;
const SCHEMA_SQL="select n.nspname as schema_name,pg_catalog.pg_has_role(current_user,'pg_read_all_stats','USAGE') as can_read_all_stats from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where c.relname='pg_stat_statements' and n.nspname in ('public','extensions') limit 1";
function statementsSql(schema,perTable=true){
  const terms=TABLES.map(name=>[name,name==='scheduled_job_leases'?[name,...['claim','renew','complete','release'].map(verb=>`${verb}_scheduled_job`)]:name==='ops_events'?[name,'record_ops_event_occurrence']:[name]]);
  const matches=words=>words.map(word=>`query ilike '%${word}%'`).join(' or ');
  const category=terms.map(([name,words])=>`when ${matches(words)} then '${name}'`).join(' ');
  return `select ${perTable?`case ${category} end as table_name,`:''}pg_catalog.sum(calls) as calls,
    pg_catalog.sum(total_exec_time)/nullif(pg_catalog.sum(calls),0) as mean_exec_ms,pg_catalog.max(max_exec_time) as max_exec_ms,
    pg_catalog.sum(shared_blks_read) as shared_blks_read,pg_catalog.sum(temp_blks_written) as temp_blks_written
    from ${schema}.pg_stat_statements where dbid=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())
    ${perTable?`and query not ilike '%pg_stat_statements%' and (${terms.map(([,words])=>matches(words)).join(' or ')}) group by 1 limit 6`:'limit 1'}`;
}
const CATEGORIES=['statement_timeout','lock_timeout','connections_exhausted','memory_exhausted','connection_error','pool_timeout'];
const CATEGORY_SQL=`case when lower(event_message) like '%statement timeout%' then 'statement_timeout'
 when lower(event_message) like '%lock timeout%' then 'lock_timeout'
 when lower(event_message) like '%too many connections%' or lower(event_message) like '%remaining connection slots%' then 'connections_exhausted'
 when lower(event_message) like '%out of memory%' then 'memory_exhausted'
 when lower(event_message) like '%pgrst003%' or lower(event_message) like '%acquiring connection%' then 'pool_timeout'
 when lower(event_message) like '%connection reset%' or lower(event_message) like '%terminating connection%' then 'connection_error' end`;
const logSql=source=>`select ${CATEGORY_SQL} as category,count() as events from logs where source='${source}' group by category limit 7`;
const EDGE_SQL="select toInt32OrZero(log_attributes['response.status_code']) as status_code,count() as events from logs where source='edge_logs' and log_attributes['request.path'] like '/rest/v1/%' and toInt32OrZero(log_attributes['response.status_code']) between 100 and 599 group by status_code order by status_code limit 501";
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e16?value:
  typeof value==='string'&&/^\d{1,16}(?:\.\d{1,16})?$/.test(value)&&Number(value)<=1e16?Number(value):null;
function numericRow(row,keys){
  const out=Object.fromEntries(keys.map(key=>[key,number(row?.[key])]));
  return Object.entries(out).every(([key,value])=>value!==null&&(['mean_exec_ms','max_exec_ms','oldest_transaction_seconds'].includes(key)||Number.isSafeInteger(value)))?out:null;
}
function rowsOf(result){return Array.isArray(result)?result:Array.isArray(result?.result)&&!result.error?result.result:null;}
export function parseServerMetrics(text){
  const cpu={idle:0,iowait:0,other:0},cores=new Map(),shapes=[];let totalMemory=null,availableMemory=null,totalSeries=0,availableSeries=0;
  for(const line of text.split('\n')){
    const match=line.match(/^(node_cpu_seconds_total|node_memory_MemTotal_bytes|node_memory_MemAvailable_bytes)(\{[^\n]*\})?\s+([0-9.eE+-]+)(?:\s|$)/);
    if(!match)continue;const value=number(Number(match[3]));if(value===null)continue;
    if(match[1]==='node_memory_MemTotal_bytes'){totalMemory=value;totalSeries++;}
    else if(match[1]==='node_memory_MemAvailable_bytes'){availableMemory=value;availableSeries++;}
    else{
      const mode=match[2]?.match(/\bmode="(idle|iowait|user|system|nice|irq|softirq|steal)"/);if(!mode)continue;
      const id=match[2]?.match(/\bcpu="([0-9]{1,4})"/)?.[1];if(id===undefined)return null;
      const modes=cores.get(id)||new Set();if(modes.has(mode[1]))return null;modes.add(mode[1]);cores.set(id,modes);
      shapes.push(match[2]);cpu[mode[1]==='idle'?'idle':mode[1]==='iowait'?'iowait':'other']+=value;
    }
  }
  if(!cores.size||totalSeries!==1||availableSeries!==1||!(totalMemory>0)||availableMemory===null||availableMemory>totalMemory)return null;
  if([...cores.values()].some(modes=>['idle','iowait','user','system'].some(mode=>!modes.has(mode))))return null;
  return {cpu,totalMemory,availableMemory,shape:createHash('sha256').update(shapes.sort().join('\n')).digest('hex')};
}

export async function collectSupabaseDiagnostics({env={},fetchImpl=fetch,now=new Date(),budgetMs=90000,sampleIntervalMs=10000}={}){
  const project=typeof env.SUPABASE_PROJECT_REF==='string'?env.SUPABASE_PROJECT_REF.trim():'';
  const token=typeof env.SUPABASE_ACCESS_TOKEN==='string'?env.SUPABASE_ACCESS_TOKEN.trim():'';
  const report={scope:'read_only_server_metadata',productionChanged:false,complete:false,
    window:{start:null,end:null},connections:{status:'not_configured'},tables:{status:'not_configured'},
    statements:{status:'not_configured'},postgresLogs:{status:'not_configured'},postgrestLogs:{status:'not_configured'},restStatuses:{status:'not_configured'},resources:{status:'not_configured'},
    limitations:['SQL and table counters are cumulative, not the six-hour log window. Statement maxima can be historical.',
      'Counts are server events, not affected people. Missing or denied evidence is not a healthy result.',
      'Restricted connection activity is null, not zero. Statement attribution can be global only.',
      'Empty logs can reflect visibility, capture or retention gaps. CPU is one short sample, not a six-hour peak.',
      'No raw SQL, query parameters, usernames, IPs, log messages or user data are returned.']};
  if(!/^[a-z0-9]{20}$/.test(project)||!token||!(now instanceof Date)||!Number.isFinite(now.getTime()))return report;
  const sections=['connections','tables','statements','postgresLogs','postgrestLogs','restStatuses','resources'];
  for(const key of sections)report[key]={status:'not_requested'};
  report.window={start:new Date(now.getTime()-6*3600000).toISOString(),end:now.toISOString()};
  const stop=AbortSignal.timeout(Math.max(1,Math.min(90000,Number(budgetMs)||90000)));
  async function read(path,{sql,logs=false,metrics=false}={}){
    const url=new URL(`https://api.supabase.com/v1/projects/${project}/${path}`);
    if(logs){url.searchParams.set('sql',sql);url.searchParams.set('iso_timestamp_start',report.window.start);url.searchParams.set('iso_timestamp_end',report.window.end);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const signal=AbortSignal.any([stop,controller.signal]);
    let onAbort,bodyReader;
    const cancelled=new Promise((_,reject)=>{
      onAbort=()=>{try{Promise.resolve(bodyReader?.cancel()).catch(()=>{});}catch{}reject(new Error('diagnostic_deadline'));};
      signal.addEventListener('abort',onAbort,{once:true});
    });
    try{
      const work=async()=>{
      signal.throwIfAborted();
      const response=await fetchImpl(url.href,{method:logs||metrics?'GET':'POST',redirect:'error',signal,
        headers:{Authorization:`Bearer ${token}`,Accept:metrics?'text/plain':'application/json',...(!logs&&!metrics?{'Content-Type':'application/json'}:{})},
        ...(!logs&&!metrics?{body:JSON.stringify({query:sql})}:{})});
      if(!response.ok||![200,201].includes(response.status))return {status:'unavailable',httpStatus:Number.isSafeInteger(response.status)?response.status:0};
      signal.throwIfAborted();const reader=response.body?.getReader();bodyReader=reader;if(!reader)return {status:'invalid_response'};
      const chunks=[];let bytes=0;
      while(true){
        signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;
        bytes+=value.byteLength;if(bytes>(metrics?1048576:262144)){await reader.cancel().catch(()=>{});return {status:'response_too_large'};}chunks.push(value);
      }
      const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
      const decoded=new TextDecoder().decode(data);
      if(metrics){const snapshot=parseServerMetrics(decoded);return snapshot?{status:'observed',snapshot}:{status:'invalid_response'};}
      const rows=rowsOf(JSON.parse(decoded));
      return rows?{status:'observed',rows}:{status:'invalid_response'};
      };
      return await Promise.race([work(),cancelled]);
    }catch{return {status:'unavailable',reason:stop.aborted?'budget_exhausted':controller.signal.aborted?'timeout':'request_failed'};}
    finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  }
  async function sql(query){return read('database/query/read-only',{sql:query});}
  async function projectRows(query,keys,{table=false,one=false,max=6}={}){
    const result=await sql(query);if(result.status!=='observed')return result;
    if(result.rows.length>max||(one&&result.rows.length!==1))return {status:'invalid_response'};
    const rows=result.rows.map(row=>{
      if(table&&!TABLES.includes(row?.table_name))return null;
      const values=numericRow(row,keys);return values?{...(table?{table_name:row.table_name}:{}),...values}:null;
    });
    if(table&&new Set(rows.map(row=>row?.table_name)).size!==rows.length)return {status:'invalid_response'};
    return rows.some(row=>!row)?{status:'invalid_response'}:{status:'observed',rows};
  }
  async function logs(query,type){
    const result=await read('analytics/endpoints/logs',{sql:query,logs:true});if(result.status!=='observed')return result;
    if(result.rows.length>(type==='status'?500:7))return {status:'invalid_response'};
    const rows=[];
    for(const row of result.rows){
      if(type!=='status'&&row?.category===null)continue;
      const events=number(row?.events);if(!Number.isSafeInteger(events))return {status:'invalid_response'};
      if(type==='status'){
        const code=number(row?.status_code);if(!Number.isInteger(code)||code<100||code>599)return {status:'invalid_response'};
        rows.push({status_code:code,events});
      }else{
        if(!CATEGORIES.includes(row?.category))return {status:'invalid_response'};
        rows.push({category:row.category,events});
      }
    }
    const unique=new Set(rows.map(row=>type==='status'?row.status_code:row.category));
    return unique.size===rows.length?{status:'observed',rows}:{status:'invalid_response'};
  }
  // Nine fixed reads total, at most two concurrent; no retries.
  const jobs=[
    async()=>{
      report.connections=await projectRows(CONNECTION_SQL,['max_connections','connections','active','idle_in_transaction','waiting_lock','restricted_activity_rows','oldest_transaction_seconds'],{one:true,max:1});
      if(report.connections.status==='observed'){
        const restricted=report.connections.rows[0].restricted_activity_rows>0;
        report.connections.visibility=restricted?'partial':'complete';
        if(restricted)for(const field of ['active','idle_in_transaction','waiting_lock','oldest_transaction_seconds'])report.connections.rows[0][field]=null;
      }
    },
    async()=>{report.tables=await projectRows(TABLE_SQL_QUERY,['n_live_tup','n_dead_tup','seq_scan','seq_tup_read','idx_scan','table_bytes','index_bytes'],{table:true});},
    async()=>{
      const schema=await sql(SCHEMA_SQL);
      if(schema.status!=='observed'){report.statements=schema;return;}
      const name=schema.rows.length===1?schema.rows[0]?.schema_name:null;
      if(!['public','extensions'].includes(name)){report.statements={status:'unavailable',reason:'statement_statistics_not_available'};return;}
      const perTable=schema.rows[0].can_read_all_stats;
      if(typeof perTable!=='boolean'){report.statements={status:'invalid_response'};return;}
      report.statements=await projectRows(statementsSql(name,perTable),['calls','mean_exec_ms','max_exec_ms','shared_blks_read','temp_blks_written'],{table:perTable,max:perTable?6:1,one:!perTable});
      if(report.statements.status==='observed')report.statements.attribution=perTable?'table_categories':'global_only_no_query_text_visibility';
    },
    async()=>{report.postgresLogs=await logs(logSql('postgres_logs'),'category');},
    async()=>{report.postgrestLogs=await logs(logSql('postgrest_logs'),'category');},
    async()=>{report.restStatuses=await logs(EDGE_SQL,'status');},
  ];
  const first=await read('analytics/endpoints/metrics',{metrics:true});
  const firstAt=performance.now();
  let cursor=0;
  await Promise.all([0,1].map(async()=>{while(cursor<jobs.length&&!stop.aborted){const job=jobs[cursor++];await job();}}));
  if(first.status==='observed'&&!stop.aborted){
    const delay=Math.max(0,Math.min(10000,Math.max(1,Number(sampleIntervalMs)||10000))-(performance.now()-firstAt));
    if(delay>0)await new Promise(resolve=>{
      let timer;
      const finish=()=>{clearTimeout(timer);stop.removeEventListener('abort',finish);resolve();};
      timer=setTimeout(finish,delay);stop.addEventListener('abort',finish,{once:true});
    });
    if(!stop.aborted){
      const last=await read('analytics/endpoints/metrics',{metrics:true});
      if(last.status==='observed'){
        const a=first.snapshot,b=last.snapshot,delta={idle:b.cpu.idle-a.cpu.idle,iowait:b.cpu.iowait-a.cpu.iowait,other:b.cpu.other-a.cpu.other};
        const total=delta.idle+delta.iowait+delta.other,valid=a.shape===b.shape&&total>0&&Object.values(delta).every(value=>value>=0);
        report.resources={status:'observed',memoryUsedPct:100*(1-b.availableMemory/b.totalMemory),cpuBusyPct:valid?100*(delta.iowait+delta.other)/total:null,cpuIoWaitPct:valid?100*delta.iowait/total:null,sampleGapMs:Math.round(performance.now()-firstAt)};
      }else report.resources=last;
    }else report.resources={status:'unavailable',reason:'budget_exhausted'};
  }else report.resources=first;
  for(const key of sections)if(report[key].status==='not_requested')report[key]={status:'unavailable',reason:stop.aborted?'budget_exhausted':'not_observed'};
  report.complete=sections.every(key=>report[key].status==='observed');
  return report;
}
