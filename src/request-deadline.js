// One monotonic budget for an operation, including fetch, body and retries.
// The race also covers injected transports that ignore AbortSignal. Callers
// check after awaited work before accepting late data or starting more I/O.
export async function withRequestDeadline(operation,{budgetMs=7000,source='upstream',error=null,now=()=>performance.now()}={}){
  const budget=Number.isFinite(Number(budgetMs)) ? Math.max(1,Math.min(120000,Number(budgetMs))) : 7000;
  const expires=now()+budget;
  const controller=new AbortController();
  const timeoutError=error || Object.assign(new Error(`${source}: response deadline exceeded.`),{code:'UPSTREAM_TIMEOUT',source});
  const remaining=()=>Math.max(0,Math.ceil(expires-now()));
  const check=()=>{if(controller.signal.aborted || remaining()<=0)throw timeoutError;};
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort(timeoutError);reject(timeoutError);},budget);});
  const run=Promise.resolve().then(()=>{check();return operation({signal:controller.signal,remaining,check});});
  try{return await Promise.race([run,timeout]);}finally{clearTimeout(timer);}
}
