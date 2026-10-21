// Background Node runner only. Keep one slot available for durable lease I/O.
// Caller deadlines include queue time; cancelled queued writes never start.
import {performance} from 'node:perf_hooks';
const LEASE_PATHS=new Set(['/rest/v1/scheduled_job_leases','/rest/v1/rpc/claim_scheduled_job_owned',...['claim','renew','complete','release'].map(name=>`/rest/v1/rpc/${name}_scheduled_job`)]);
export function createSupabaseAdmissionFetch(original,{origin,maxActive=4,maxRegular=3,maxQueued=128,now=()=>performance.now()}={}){
  if(typeof original!=='function'||!Number.isSafeInteger(maxActive)||maxActive<2||!Number.isSafeInteger(maxRegular)||maxRegular<1||maxRegular>=maxActive||!Number.isSafeInteger(maxQueued)||maxQueued<1)throw Error('Invalid background admission configuration');
  const base=new URL(origin);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Invalid background admission origin');
  const pending=[];
  let active=0,regular=0;
  const stats={started:0,completed:0,failed:0,cancelledQueued:0,rejectedFull:0,peakActive:0,peakRegular:0,peakQueued:0,maxQueueWaitMs:0};
  const aborted=signal=>signal?.reason||new DOMException('Aborted','AbortError');
  function pump(){
    while(active<maxActive){
      // Ordinary traffic cannot consume the reserved lease slot.
      let index=pending.findIndex(job=>job.priority);
      if(index<0&&regular<maxRegular)index=0;
      if(index<0||!pending.length)return;
      const job=pending.splice(index,1)[0];
      job.signal?.removeEventListener('abort',job.onAbort);
      if(job.signal?.aborted){stats.cancelledQueued++;job.reject(aborted(job.signal));continue;}
      active++;if(!job.priority)regular++;
      stats.peakActive=Math.max(stats.peakActive,active);stats.peakRegular=Math.max(stats.peakRegular,regular);
      stats.maxQueueWaitMs=Math.max(stats.maxQueueWaitMs,Math.max(0,Math.round(now()-job.queuedAt)));
      Promise.resolve().then(()=>{
        if(job.signal?.aborted){stats.cancelledQueued++;throw aborted(job.signal);}
        stats.started++;return original(job.input,job.init);
      }).then(value=>{stats.completed++;job.resolve(value);},error=>{stats.failed++;job.reject(error);}).finally(()=>{
        // Release at response headers, after the REST database operation has replied.
        active--;if(!job.priority)regular--;pump();
      });
    }
  }
  function fetch(input,init={}){
    let url;
    try{url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input?.url);}catch{return original(input,init);}
    if(url.origin!==base.origin||!url.pathname.startsWith('/rest/v1/'))return original(input,init);
    const signal=init.signal||input?.signal;
    if(signal?.aborted){stats.cancelledQueued++;return Promise.reject(aborted(signal));}
    const priority=LEASE_PATHS.has(url.pathname);
    if(pending.length>=maxQueued&&!(priority&&active<maxActive)){stats.rejectedFull++;return Promise.reject(Object.assign(Error('Background database queue is full.'),{code:'BACKGROUND_DB_ADMISSION_FULL'}));}
    return new Promise((resolve,reject)=>{
      const job={input,init,signal,resolve,reject,queuedAt:now(),priority};
      job.onAbort=()=>{
        const index=pending.indexOf(job);
        if(index>=0){pending.splice(index,1);stats.cancelledQueued++;reject(aborted(signal));pump();}
      };
      signal?.addEventListener('abort',job.onAbort,{once:true});
      pending.push(job);stats.peakQueued=Math.max(stats.peakQueued,pending.length);pump();
    });
  }
  return {fetch,stats};
}
