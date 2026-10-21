import {withRequestDeadline} from './request-deadline.js';

// These SQL contracts alone accept the exact same operation twice safely.
const NAMES=new Set(['claim_scheduled_job_owned','write_analysis_cache_versioned']);
const TRANSIENT=new Set(['UPSTREAM_TIMEOUT','HTTP_408','HTTP_502','HTTP_503','HTTP_504','PGRST000','PGRST001','PGRST002','PGRST003','ECONNRESET','ETIMEDOUT','EAI_AGAIN']);
export const transientRpcError=error=>error?.transientSecretAuth===true||TRANSIENT.has(error?.code||error?.cause?.code)
  || (error instanceof TypeError&&/fetch|network/i.test(error.message));
const stats={operations:0,calls:0,legacyFallbacks:0,readbackWins:0,fastRetries:0,fallbacks:0,fallbackWins:0,originalWins:0,failed:0,busySkips:0};
export const idempotentRpcRecoverySnapshot=()=>({...stats});
const note=key=>{stats[key]=Math.min(Number.MAX_SAFE_INTEGER,stats[key]+1);};

export function createIdempotentRpcRecovery(rawRpc,{now=()=>performance.now()}={}){
  let activeFallbacks=0;
  return function recover(cfg,name,payload,budget,headers,callerSignal,policy={}){
    if(!NAMES.has(name))return rawRpc(cfg,name,payload,budget,headers);
    // Snapshot before either attempt; callers cannot change the request between
    // sends. The claim's owner token / cache version is created by the caller.
    note('calls');
    const body=JSON.parse(JSON.stringify(payload));
    const extra={...headers};
    return withRequestDeadline(({signal:deadlineSignal,remaining,check})=>new Promise((resolve,reject)=>{
      const signal=callerSignal?AbortSignal.any([deadlineSignal,callerSignal]):deadlineSignal;
      const controllers=[];
      let started=0,pending=0,settled=false,timer,fallback=false;
      const failures=[];
      function finish(value,error,index){
        if(settled)return;
        try{check();}catch(deadline){error=deadline;}
        settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
        for(const controller of controllers)controller.abort(Object.assign(new Error('Idempotent RPC superseded.'),{code:'SUPABASE_WRITE_SUPERSEDED'}));
        if(fallback){activeFallbacks--;note(error?'failed':index===1?'fallbackWins':'originalWins');}
        if(error)reject(error);else resolve(value);
      }
      const abort=()=>finish(null,signal.reason);
      function launch(){
        if(settled||started>=2)return;
        try{check();}catch(error){finish(null,error);return;}
        const index=started++,controller=new AbortController();controllers.push(controller);pending++;
        policy.onAttempt?.();
        Promise.resolve().then(()=>{
          check();controller.signal.throwIfAborted();
          return rawRpc(cfg,name,body,remaining(),extra,AbortSignal.any([signal,controller.signal]));
        }).then(value=>{
          pending--;
          if(value===null||typeof value!=='object'||Array.isArray(value)
            || typeof value[name==='claim_scheduled_job_owned'?'claimed':'stored']!=='boolean'){
            finish(null,Object.assign(new Error('Invalid idempotent RPC response.'),{code:'SUPABASE_RPC_INVALID'}),index);return;
          }
          finish(value,null,index);
        },error=>{
          pending--;if(settled)return;
          if(!transientRpcError(error)){finish(null,error,index);return;}
          failures[index]=error;
          if(started===1){clearTimeout(timer);note('fastRetries');launch();}
          else if(pending===0)finish(null,failures[1]||error,index);
        });
      }
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});
      launch();
      if(policy.delayed!==false)timer=setTimeout(()=>{
        if(settled||started!==1||pending!==1)return;
        if(activeFallbacks){note('busySkips');return;}
        fallback=true;activeFallbacks++;note('fallbacks');launch();
      },2000);
    }),{source:`Supabase durable RPC ${name}`,budgetMs:budget,now});
  };
}

export function createDurableRpcOperation(rawRpc,{now=()=>performance.now()}={}){
  const recover=createIdempotentRpcRecovery(rawRpc,{now}),capabilities=new Map();
  return function operate(cfg,name,payload,budget,headers={},options={}){
    if(!NAMES.has(name))throw new TypeError('Unsupported durable operation.');
    const connection={...cfg},body=JSON.parse(JSON.stringify(payload)),extra={...headers};
    const key=JSON.stringify([connection.supabaseUrl,connection.supabaseKey]);
    const ready=capabilities.get(key)===true;
    note('operations');
    const confirmed=()=>{
      capabilities.delete(key);capabilities.set(key,true);
      if(capabilities.size>16)capabilities.delete(capabilities.keys().next().value);
    };
    return withRequestDeadline(async({signal,remaining,check})=>{
      // Reserve time for proof by SELECT, without extending the original7s.
      const phaseBudget=remaining()>4500?remaining()-3000:remaining();
      let result,sent=0;
      try{
        // Before schema availability is confirmed, send just one request. A
        // definite missing-function response then safely permits legacy I/O.
        result=await recover(connection,name,body,phaseBudget,extra,signal,{delayed:ready,onAttempt:()=>{sent++;}});
        check();options.validate(result,body);confirmed();return result;
      }catch(error){
        check();
        if(!ready&&sent===1&&['PGRST202','42883'].includes(error?.code)&&typeof options.legacy==='function'){
          note('legacyFallbacks');
          const legacy=await options.legacy(connection,body,remaining(),signal);
          check();return legacy;
        }
        if(transientRpcError(error)&&typeof options.confirm==='function'){
          try{
            result=await options.confirm(connection,body,remaining(),signal);
            check();
            if(result!==null&&result!==undefined){
              options.validate(result,body);confirmed();note('readbackWins');return result;
            }
          }catch{check();}
        }
        throw error;
      }
    },{budgetMs:budget,source:`Supabase durable operation ${name}`,now});
  };
}
