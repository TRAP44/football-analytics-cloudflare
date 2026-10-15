// Batch only compatible, already validated history rows. Every caller still
// waits for its database write; failed callers retain their existing retries.
export function createHistoryWriteBatcher(write) {
  const groups=new Map();
  function flush(key,group) {
    if(groups.get(key)!==group)return;
    groups.delete(key);
    clearTimeout(group.timer);
    const rows=new Map();
    for(const job of group.jobs){
      const rowKey=`${job.row.telegram_id}:${job.row.fixture_id}`;
      const previous=rows.get(rowKey);
      if(!previous || job.row.viewed_at>=previous.viewed_at)rows.set(rowKey,job.row);
    }
    // Stable conflict-key order avoids opposite row-lock orders across batches.
    const payload=[...rows.values()].sort((a,b)=>a.telegram_id-b.telegram_id || a.fixture_id-b.fixture_id);
    Promise.resolve().then(()=>write(group.cfg,payload.length===1?payload[0]:payload)).then(
      ()=>{for(const job of group.jobs)job.resolve();},
      error=>{for(const job of group.jobs)job.reject(error);},
    );
  }
  return function enqueue(cfg,row) {
    // Unknown connection identities cannot safely share a batch.
    if(typeof cfg?.supabaseUrl!=='string' || !cfg.supabaseUrl || typeof cfg?.supabaseKey!=='string' || !cfg.supabaseKey){
      return Promise.resolve().then(()=>write(cfg,row));
    }
    const key=JSON.stringify([cfg.supabaseUrl,cfg.supabaseKey]);
    let group=groups.get(key);
    if(!group){
      group={cfg:{...cfg},jobs:[],timer:null};groups.set(key,group);
      group.timer=setTimeout(()=>flush(key,group),2);
    }
    return new Promise((resolve,reject)=>{
      group.jobs.push({row,resolve,reject});
      if(group.jobs.length>=100)flush(key,group);
    });
  };
}
