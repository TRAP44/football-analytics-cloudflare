// Node-only observation of existing Undici requests, not another network client.
// Never retain or log headers, bodies, query values, origins, IPs or socket fields.
import {channel} from 'node:diagnostics_channel';
import {performance} from 'node:perf_hooks';
const CODES=new Set(['UPSTREAM_TIMEOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND']);
const PATH=/^\/rest\/v1\/(?:rpc\/)?[a-z][a-z0-9_]{0,100}$/;
const elapsed=(now,start)=>Math.max(0,Math.min(120000,Math.round(now-start)));

export function installSupabaseTransportTrace({subscribe=(name,handler)=>{const target=channel(name);target.subscribe(handler);return()=>target.unsubscribe(handler);},now=()=>performance.now(),limit=40}={}){
  const requests=new WeakMap(),sockets=new WeakMap(),entries=[],failures=[],slow=[];
  const stats={requests:0,completed:0,errors:0,maxSentMs:0,maxHeadersMs:0};
  let next=0;
  function append(state,event,extra=''){
    entries.push(`${state.id} ${state.method} ${state.path} ${event} ${elapsed(now(),state.start)}ms${extra}`);
    if(entries.length>limit)entries.splice(0,entries.length-limit);
  }
  const handlers={
    'undici:request:create':({request})=>{
      const origin=new URL(String(request?.origin));
      const path=new URL(String(request?.path),origin).pathname;
      if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||!PATH.test(path)||!['GET','POST','PATCH','DELETE','HEAD'].includes(request?.method))return;
      const state={id:++next,method:request.method,path,start:now()};
      requests.set(request,state);stats.requests++;append(state,'created');
    },
    'undici:client:sendHeaders':({request,socket})=>{
      const state=requests.get(request);if(!state)return;
      const previous=sockets.get(socket);
      state.socket=socket;
      state.sentMs=elapsed(now(),state.start);state.connection=previous?'reused':'first_seen';
      state.idleMs=previous?elapsed(now(),previous.lastUsed):0;
      stats.maxSentMs=Math.max(stats.maxSentMs,state.sentMs);
      sockets.set(socket,{lastUsed:now()});
      append(state,'sent',` connection=${previous?'reused':'first_seen'} idle=${previous?elapsed(now(),previous.lastUsed):0}ms`);
    },
    'undici:request:headers':({request,response})=>{
      const state=requests.get(request);if(!state)return;
      const status=Number.isSafeInteger(response?.statusCode)&&response.statusCode>=100&&response.statusCode<=599?response.statusCode:0;
      state.headersMs=elapsed(now(),state.start);
      stats.maxHeadersMs=Math.max(stats.maxHeadersMs,state.headersMs);
      append(state,'headers',` status=${status}`);
    },
    'undici:request:trailers':({request})=>{
      const state=requests.get(request);if(!state)return;
      stats.completed++;append(state,'complete');
      if(elapsed(now(),state.start)>=1000){
        slow.push(`${state.method} ${state.path} complete=${elapsed(now(),state.start)}ms sent=${state.sentMs??'none'}ms headers=${state.headersMs??'none'}ms connection=${state.connection||'not_sent'}`);
        if(slow.length>5)slow.shift();
      }
      if(state.socket)sockets.set(state.socket,{lastUsed:now()});
      requests.delete(request);
    },
    'undici:request:error':({request,error})=>{
      const state=requests.get(request);if(!state)return;
      const code=error?.code||error?.cause?.code;
      const kind=CODES.has(code)?code:['AbortError','TimeoutError'].includes(error?.name)?'aborted':'unknown';
      stats.errors++;
      const detail=` code=${kind} sent=${state.sentMs??'none'}ms headers=${state.headersMs??'none'}ms connection=${state.connection||'not_sent'} idle=${state.idleMs??0}ms`;
      append(state,'error',detail);
      failures.push(`${state.id} ${state.method} ${state.path} error ${elapsed(now(),state.start)}ms${detail}`);
      if(failures.length>10)failures.shift();
      requests.delete(request);
    },
  };
  // Observability must never throw into Undici or prevent a scheduled task.
  const remove=Object.entries(handlers).map(([name,handler])=>subscribe(name,message=>{try{handler(message);}catch{}}));
  return {entries,failures,slow,stats,restore(){for(const unsubscribe of remove)unsubscribe();}};
}
