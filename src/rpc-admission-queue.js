// Each caller waits for a permit, then runs its own I/O in its original request
// context. The caller's deadline includes both waiting and transport time.
export function createRpcAdmissionQueue({ maxActive = 128, maxQueued = 2048, now = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(maxActive) || maxActive < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 1 || typeof now !== 'function') {
    throw new TypeError('Invalid RPC admission queue configuration.');
  }
  const groups = new Map();
  const unavailable = () => Object.assign(new Error('Rate claim admission deadline or capacity exceeded.'), { code: 'UPSTREAM_TIMEOUT' });

  return function enqueue(key, run, timeoutMs) {
    let group = groups.get(key);
    if (!group) {
      group = { active: 0, pending: [] };
      groups.set(key, group);
    }
    if (group.active >= maxActive && group.pending.length >= maxQueued) return Promise.reject(unavailable());
    const deadline = now() + timeoutMs;
    const job = { expired: false, started: false, timer: null };
    let grant, rejectPermit;
    const permit = new Promise((resolve, reject) => { grant = resolve; rejectPermit = reject; });
    const cleanup = () => {
      if (!group.active && !group.pending.length && groups.get(key) === group) groups.delete(key);
    };
    const pump = () => {
      while (group.active < maxActive && group.pending.length) group.pending.shift().start();
      cleanup();
    };
    job.start = () => {
      if (job.expired) return;
      // Existing transport clamps timeouts to 500ms. Do not dispatch a write
      // that cannot fit within the caller's remaining total deadline.
      if (Math.floor(deadline - now()) < 500) { rejectPermit(unavailable()); return; }
      job.started = true;
      group.active++;
      grant();
    };
    const timeout = new Promise((_, reject) => {
      job.timer = setTimeout(() => {
        job.expired = true;
        if (!job.started) {
          const index = group.pending.indexOf(job);
          if (index >= 0) group.pending.splice(index, 1);
          cleanup();
        }
        const error = unavailable();
        rejectPermit(error);
        reject(error);
      }, timeoutMs);
    });
    const operation = (async () => {
      try {
        await permit;
        const budget = Math.floor(deadline - now());
        if (job.expired || budget < 500) throw unavailable();
        const value = await run(budget);
        if (job.expired || now() >= deadline) throw unavailable();
        return value;
      } finally {
        clearTimeout(job.timer);
        // Expiring the caller must not free a still-running transport slot.
        if (job.started) group.active--;
        pump();
      }
    })();
    group.pending.push(job);
    pump();
    return Promise.race([operation, timeout]);
  };
}
