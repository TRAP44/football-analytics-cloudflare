// Permits never execute another request's I/O. Expired active leases are also
// reclaimed by later callers, independently of timers/finally in a dead context.
export function createRpcAdmissionQueue({ maxActive = 128, maxQueued = 2048, maxQueuedPerBucket = 16, leaseGraceMs = 250, now = () => performance.now(), onEvent = () => {} } = {}) {
  if (![maxActive,maxQueued,maxQueuedPerBucket].every(value=>Number.isSafeInteger(value) && value>0) || !Number.isSafeInteger(leaseGraceMs) || leaseGraceMs<0 || typeof now !== 'function') throw new TypeError('Invalid RPC admission queue configuration.');
  const groups = new Map();
  const unavailable = () => Object.assign(new Error('Rate claim admission deadline exceeded.'), { code: 'UPSTREAM_TIMEOUT' });
  const event = name => { try { onEvent(name); } catch {} };
  const full = bucket => {
    event(bucket ? 'rateClaimBucketFull' : 'rateClaimAdmissionFull');
    return Object.assign(new Error(bucket ? 'Rate claim bucket queue full.' : 'Rate claim admission queue full.'), {code:bucket ? 'RATE_CLAIM_BUCKET_FULL' : 'RATE_CLAIM_ADMISSION_FULL'});
  };
  const reap = group => {
    if (now() < group.nextExpiry) return;
    group.nextExpiry=Infinity;
    for (const job of group.active) {
      if (now() >= job.leaseUntil) {
        group.active.delete(job);
        job.expire();
        event('rateClaimLeaseReaped');
      } else group.nextExpiry=Math.min(group.nextExpiry,job.leaseUntil);
    }
    for (const job of [...group.pending]) {
      if (now() >= job.deadline) job.expire();
      else group.nextExpiry=Math.min(group.nextExpiry,job.deadline);
    }
  };
  return function enqueue(key, run, timeoutMs, bucket = '') {
    let group = groups.get(key);
    if (!group) { group = {active:new Set(),pending:[],bucketPending:new Map(),nextExpiry:Infinity}; groups.set(key,group); }
    reap(group);
    if (group.active.size >= maxActive && group.pending.length >= maxQueued) return Promise.reject(full(false));
    if (bucket && (group.bucketPending.get(bucket) || 0) >= maxQueuedPerBucket) return Promise.reject(full(true));
    const deadline=now()+timeoutMs;
    const job = {bucket,deadline,leaseUntil:deadline+leaseGraceMs,expired:false,started:false,timer:null,wakeTimer:null,controller:new AbortController()};
    let grant, rejectPermit, rejectTimeout;
    const permit = new Promise((resolve,reject)=>{grant=resolve;rejectPermit=reject;});
    const timeout = new Promise((_,reject)=>{rejectTimeout=reject;});
    const cleanup = () => { if (!group.active.size && !group.pending.length && groups.get(key)===group) groups.delete(key); };
    const uncount = item => {
      if (!item.bucket) return;
      const remaining=(group.bucketPending.get(item.bucket) || 1)-1;
      if(remaining)group.bucketPending.set(item.bucket,remaining);else group.bucketPending.delete(item.bucket);
    };
    const pump = () => {
      reap(group);
      while (group.active.size<maxActive && group.pending.length) { const next=group.pending.shift();uncount(next);next.start(); }
      cleanup();
    };
    job.expire = () => {
      if (job.expired) return;
      job.expired=true;
      clearTimeout(job.timer);
      clearTimeout(job.wakeTimer);
      if (!job.started) { const index=group.pending.indexOf(job); if(index>=0){group.pending.splice(index,1);uncount(job);} }
      const error=unavailable();
      job.controller.abort(error);
      rejectPermit(error);rejectTimeout(error);
    };
    job.start = () => {
      if (job.expired) return;
      if (Math.floor(job.deadline-now())<500) { job.expire(); return; }
      clearTimeout(job.wakeTimer);
      job.started=true;group.active.add(job);grant();
    };
    job.timer=setTimeout(()=>{job.expire();cleanup();},timeoutMs);
    const operation=(async()=>{
      try {
        await permit;
        const budget=Math.floor(job.deadline-now());
        if(job.expired || budget<500)throw unavailable();
        const value=await run(budget,job.controller.signal);
        if(job.expired || now()>=job.deadline)throw unavailable();
        return value;
      } finally {
        clearTimeout(job.timer);
        clearTimeout(job.wakeTimer);
        // Set deletion is idempotent if another request already reaped this lease.
        group.active.delete(job);
        pump();
      }
    })();
    group.pending.push(job);
    if(bucket)group.bucketPending.set(bucket,(group.bucketPending.get(bucket) || 0)+1);
    group.nextExpiry=Math.min(group.nextExpiry,deadline);
    pump();
    // A live waiter can outlast a dead caller's lease without further arrivals.
    // Its own context schedules the wake; no I/O runs in this callback.
    const scheduleWake=()=>{
      if(job.started || job.expired)return;
      const next=group.nextExpiry;
      if(Number.isFinite(next) && next<deadline-500){
        job.wakeTimer=setTimeout(()=>{pump();scheduleWake();},Math.max(1,Math.ceil(next-now())));
      }
    };
    scheduleWake();
    return Promise.race([operation,timeout]);
  };
}
