// Profile fields only: callers must await persistence before dependent FK writes.
export function createUserProfileWriteBatcher(write) {
  const groups=new Map();
  function flush(key,group) {
    if(groups.get(key)!==group)return;
    groups.delete(key);
    clearTimeout(group.timer);
    const rows=[...group.jobs].sort((a,b)=>a.row.telegram_id-b.row.telegram_id).map(job=>job.row);
    Promise.resolve().then(()=>write(group.cfg,rows.length===1?rows[0]:rows)).then(
      ()=>{for(const job of group.jobs)job.resolve();},
      error=>{
        // One invalid profile must not prevent other users from being persisted.
        for(const job of group.jobs){
          if(rows.length===1){job.reject(error);continue;}
          Promise.resolve().then(()=>write(group.cfg,job.row)).then(job.resolve,job.reject);
        }
      },
    );
  }
  return function enqueue(cfg,row) {
    if(typeof cfg?.supabaseUrl!=='string' || !cfg.supabaseUrl || typeof cfg?.supabaseKey!=='string' || !cfg.supabaseKey){
      return Promise.resolve().then(()=>write(cfg,row));
    }
    const key=JSON.stringify([cfg.supabaseUrl,cfg.supabaseKey]);
    let group=groups.get(key);
    // Duplicate identities use a separate write rather than an ambiguous upsert.
    if(group?.jobs.some(job=>job.row.telegram_id===row.telegram_id)){
      return Promise.resolve().then(()=>write({...cfg},row));
    }
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
