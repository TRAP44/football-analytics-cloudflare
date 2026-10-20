import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSupabaseDiagnostics,parseServerMetrics} from '../scripts/supabase-server-diagnostics.js';
import {auditInfrastructure,auditSummary} from '../scripts/audit-infrastructure-capacity.js';
const env={SUPABASE_PROJECT_REF:'a'.repeat(20),SUPABASE_ACCESS_TOKEN:'diagnostic-test-credential'};
const now=new Date('2026-10-20T15:20:00Z');
function resultFor(url,options){
  const target=new URL(url),query=options.body?JSON.parse(options.body).query:target.searchParams.get('sql');
  if(target.pathname.endsWith('/logs')){
    if(query.includes('edge_logs'))return {result:[{status_code:200,events:'12',user:'private-user'}]};
    return {result:[{category:'pool_timeout',events:'2',event_message:'private-log'}]};
  }
  if(query.includes('pg_catalog.pg_class c'))return [{schema_name:'extensions',can_read_all_stats:true,private:'hidden'}];
  if(query.includes('pg_stat_activity'))return [{max_connections:60,connections:12,active:3,idle_in_transaction:1,waiting_lock:1,restricted_activity_rows:0,oldest_transaction_seconds:2.5,client_addr:'private-ip'}];
  if(query.includes('pg_stat_user_tables'))return [{table_name:'analysis_cache',n_live_tup:'10',n_dead_tup:1,seq_scan:5,seq_tup_read:50,idx_scan:30,table_bytes:4096,index_bytes:8192,user:'private-user'}];
  return [{table_name:'analysis_cache',calls:10,mean_exec_ms:1.2,max_exec_ms:6.7,shared_blks_read:20,temp_blks_written:0,query:'private-query'}];
}
let metricCounter=0;
function metricText(){
 const n=metricCounter++;
 return `node_cpu_seconds_total{cpu="0",mode="idle"} ${100+n*8}\nnode_cpu_seconds_total{cpu="0",mode="user"} ${10+n*2}\nnode_cpu_seconds_total{cpu="0",mode="iowait"} 0\nnode_cpu_seconds_total{cpu="0",mode="system"} 0\nnode_memory_MemTotal_bytes 1000\nnode_memory_MemAvailable_bytes 400\nignored{private="private-user"} 8\n`;
}
const success=async(url,options)=>new URL(url).pathname.endsWith('/metrics')?new Response(metricText()):Response.json(resultFor(url,options),{status:options.method==='POST'?201:200});

test('fixed read-only queries and aggregate logs use nine bounded requests without emitting sensitive data',async()=>{
  const calls=[];let active=0,peak=0;
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async(url,options)=>{
    active++;peak=Math.max(peak,active);calls.push({url,options});
    await new Promise(resolve=>setImmediate(resolve));active--;return success(url,options);
  }});
  assert.equal(report.complete,true);assert.equal(report.productionChanged,false);assert.equal(calls.length,9);assert.equal(peak,2);
  for(const {url,options}of calls){
    const target=new URL(url);assert.equal(target.origin,'https://api.supabase.com');assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,`Bearer ${env.SUPABASE_ACCESS_TOKEN}`);assert.ok(options.signal);
    if(options.method==='POST'){
      assert.ok(target.pathname.endsWith('/database/query/read-only'));const query=JSON.parse(options.body).query;
      assert.match(query,/^select /);assert.doesNotMatch(query,/\b(?:insert|update|delete|drop|alter|create|grant|revoke)\b/i);
    }else if(target.pathname.endsWith('/metrics')){
      assert.equal(options.method,'GET');assert.equal(target.search,'');
    }else{
      assert.equal(options.method,'GET');assert.ok(target.pathname.endsWith('/analytics/endpoints/logs'));
      assert.equal(target.searchParams.get('iso_timestamp_start'),'2026-10-20T09:20:00.000Z');
      assert.equal(target.searchParams.get('iso_timestamp_end'),now.toISOString());
    }
  }
  const out=JSON.stringify(report);
  for(const forbidden of [...Object.values(env),'private-ip','private-query','private-user','private-log','hidden'])assert.ok(!out.includes(forbidden),forbidden);
  assert.deepEqual(report.postgresLogs.rows,[{category:'pool_timeout',events:2}]);
  assert.equal(report.statements.rows[0].mean_exec_ms,1.2);
});

test('missing configuration never guesses a target or transmits credentials',async()=>{
  for(const values of [{},{...env,SUPABASE_PROJECT_REF:'https://untrusted.test'},{...env,SUPABASE_ACCESS_TOKEN:''}]){
    let calls=0;const report=await collectSupabaseDiagnostics({env:values,now,fetchImpl:async()=>{calls++;}});
    assert.equal(calls,0);assert.equal(report.complete,false);
  }
});

test('denial and provider error bodies stay unavailable, never healthy or leaked',async()=>{
  for(const code of [401,403,429,500,302]){
    const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async()=>new Response('private-error '+env.SUPABASE_ACCESS_TOKEN,{status:code})});
    assert.equal(report.complete,false);assert.equal(report.connections.httpStatus,code);
    assert.ok(!JSON.stringify(report).includes(env.SUPABASE_ACCESS_TOKEN));assert.ok(!JSON.stringify(report).includes('private-error'));
  }
});

test('malformed metadata, unsafe namespace and log error envelopes do not become observations',async()=>{
  for(const payload of [{error:'private-error',result:[]},[{schema_name:'untrusted; drop table foo'}],[{table_name:'private-user',events:0}],[{category:'pool_timeout',events:0.5}]]){
    const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async()=>Response.json(payload)});
    assert.equal(report.complete,false);assert.ok(!JSON.stringify(report).includes('private-'));assert.ok(!JSON.stringify(report).includes('drop table'));
  }
});

test('oversized response bodies are cancelled and never recorded',async()=>{
  let cancelled=0;
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(1048577));},cancel(){cancelled++;},
  }))});
  assert.equal(report.complete,false);assert.equal(report.connections.status,'response_too_large');assert.ok(cancelled>0);
});

test('global deadline bounds ignored fetch signals and prevents starting more reads',async()=>{
  let calls=0;const started=performance.now();
  const report=await collectSupabaseDiagnostics({env,now,budgetMs:25,fetchImpl:async()=>{calls++;return new Promise(()=>{});}});
  assert.equal(calls,1);assert.equal(report.complete,false);assert.ok(performance.now()-started<1000);
  assert.equal(report.connections.reason,'budget_exhausted');
});

test('global deadline also bounds response bodies which ignore transport cancellation',async()=>{
  let calls=0;
  const report=await collectSupabaseDiagnostics({env,now,budgetMs:25,fetchImpl:async()=>{
    calls++;return new Response(new ReadableStream({start(){}}));
  }});
  assert.equal(calls,1);assert.equal(report.complete,false);assert.equal(report.connections.reason,'budget_exhausted');
});

test('explicit diagnostics mode skips billing and preserves distinct completion semantics',async()=>{
  const calls=[];
  const report=await auditInfrastructure({env:{...env,SUPABASE_DIAGNOSTICS_ENABLED:'true'},fetchImpl:async(url,options)=>{
    calls.push(url);
    if(new URL(url).pathname===`/v1/projects/${env.SUPABASE_PROJECT_REF}`)return Response.json({ref:env.SUPABASE_PROJECT_REF,status:'ACTIVE_HEALTHY',region:'eu-west-1'});
    return success(url,options);
  }});
  assert.equal(report.completeDiagnosticsObservations,true);assert.equal(report.completeManagementObservations,false);
  assert.equal(report.supabase.compute.status,'not_requested');assert.equal(calls.some(url=>url.includes('/billing/')),false);
  assert.equal(report.productionCapacityConfirmed,false);assert.ok(!auditSummary(report).includes(env.SUPABASE_ACCESS_TOKEN));
});

test('restricted SQL visibility never presents hidden activity as zero or empty table attribution',async()=>{
  let sawGlobal=false;
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async(url,options)=>{
    if(new URL(url).pathname.endsWith('/metrics'))return success(url,options);
    const data=resultFor(url,options),query=options.body?JSON.parse(options.body).query:'';
    if(query.includes('pg_catalog.pg_class c'))data[0].can_read_all_stats=false;
    if(query.includes('pg_stat_activity'))data[0].restricted_activity_rows=8;
    if(query.includes('extensions.pg_stat_statements')){sawGlobal=true;assert.doesNotMatch(query,/query ilike|query not ilike/);}
    return Response.json(data,{status:options.method==='POST'?201:200});
  }});
  assert.equal(report.complete,true);assert.equal(report.connections.visibility,'partial');
  assert.equal(report.connections.rows[0].active,null);assert.equal(report.connections.rows[0].waiting_lock,null);
  assert.equal(report.statements.attribution,'global_only_no_query_text_visibility');assert.equal(sawGlobal,true);
  assert.equal(report.statements.rows[0].table_name,undefined);
});

test('metrics project only counters and bounded percentages; counter reset leaves CPU unknown',async()=>{
  assert.equal(parseServerMetrics('private-content'),null);
  assert.equal(parseServerMetrics('node_cpu_seconds_total{cpu="0",mode="idle"} 1e2\nnode_memory_MemTotal_bytes 1000\nnode_memory_MemAvailable_bytes 400'),null);
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async(url,options)=>new URL(url).pathname.endsWith('/metrics')?new Response('node_cpu_seconds_total{cpu="0",mode="idle"} 100\nnode_cpu_seconds_total{cpu="0",mode="user"} 10\nnode_cpu_seconds_total{cpu="0",mode="iowait"} 0\nnode_cpu_seconds_total{cpu="0",mode="system"} 0\nnode_memory_MemTotal_bytes 1000\nnode_memory_MemAvailable_bytes 400'):success(url,options)});
  assert.equal(report.resources.memoryUsedPct,60);assert.equal(report.resources.cpuBusyPct,null);
});

test('logs use current unified ClickHouse schema and retain rare server errors across status codes',async()=>{
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async(url,options)=>{
    const target=new URL(url);
    if(target.pathname.endsWith('/logs')){
      const query=target.searchParams.get('sql');assert.match(query,/from logs where source=/);assert.match(query,/count\(\)/);
      assert.doesNotMatch(query,/unnest|count\(\*\)/i);
      if(query.includes('edge_logs')){
        assert.match(query,/log_attributes\['response.status_code'\]/);assert.match(query,/limit 501/);
        return Response.json({result:[...Array.from({length:32},(_,i)=>({status_code:200+i,events:99})),{status_code:504,events:1}]});
      }
    }
    if(options.method==='POST'){
      const query=JSON.parse(options.body).query;
      assert.doesNotMatch(query,/\b(?:from|join) (?:pg_stat|pg_class|pg_namespace|pg_database)\b/);
    }
    return success(url,options);
  }});
  assert.equal(report.restStatuses.rows.at(-1).status_code,504);assert.equal(report.complete,true);
});


test('incomplete or duplicate metric series never fabricate CPU or memory readings',async()=>{
  const valid=metricText();
  assert.ok(parseServerMetrics(valid));
  for(const mode of ['idle','iowait','user','system']){
    assert.equal(parseServerMetrics(valid.split('\n').filter(line=>!line.includes(`mode="${mode}"`)).join('\n')),null);
  }
  assert.equal(parseServerMetrics(valid+'node_memory_MemTotal_bytes 1000\n'),null);
  assert.equal(parseServerMetrics(valid+'node_memory_MemAvailable_bytes 400\n'),null);
  let snapshots=0;
  const report=await collectSupabaseDiagnostics({env,now,sampleIntervalMs:1,fetchImpl:async(url,options)=>{
    if(!new URL(url).pathname.endsWith('/metrics'))return success(url,options);
    const text=metricText();return new Response(snapshots++?text.replaceAll('cpu="0"','cpu="1"'):text);
  }});
  assert.equal(report.resources.status,'observed');assert.equal(report.resources.cpuBusyPct,null);
  assert.equal(report.resources.cpuIoWaitPct,null);assert.equal(report.resources.memoryUsedPct,60);
});
