// Optional web enrichment must not hold football analysis behind a slow service.
export async function withAnalysisWebBudget(operation,{timeoutMs=1500,now=()=>performance.now()}={}) {
  const budget=Number.isFinite(timeoutMs)?Math.max(1,Math.min(1500,timeoutMs)):1500;
  const controller=new AbortController();
  const deadline=now()+budget;
  const expired=()=>Object.assign(new Error('Optional web context exceeded its response budget.'),{code:'AI_WEB_TIME_BUDGET'});
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const error=expired();reject(error);
      try{controller.abort(error);}catch{}
    },budget);
  });
  const work=Promise.resolve().then(async()=>{
    const result=await operation(controller.signal,budget);
    if(controller.signal.aborted || now()>=deadline){
      const error=expired();try{controller.abort(error);}catch{}
      throw error;
    }
    return result;
  });
  try{return await Promise.race([work,timeout]);}
  finally{clearTimeout(timer);}
}
