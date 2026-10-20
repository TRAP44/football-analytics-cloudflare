import {withRequestDeadline} from './request-deadline.js';
const JOB_KEY_RE=/^[A-Za-z0-9._:@/-]{1,180}$/;
const GROUP_KEY_RE=/^[A-Za-z0-9._:@/-]{1,120}$/;
const LEASE_TOKEN_RE=/^[A-Za-z0-9._:-]{16,80}$/;
const MAX_TIMESTAMP_MS=8.64e15;

function transientLeaseError(error) {
  return ['UPSTREAM_TIMEOUT','HTTP_408','HTTP_502','HTTP_503','HTTP_504','PGRST000','PGRST001','PGRST002','PGRST003','ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(error?.code || error?.cause?.code)
    || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function boundedInteger(value,fallback,min,max) {
  const number=integerCandidate(value);
  return number !== null && number >= min && number <= max ? number : fallback;
}

function boundedLeaseSeconds(value=720) {
  return boundedInteger(value,720,30,1800);
}

function boundedRetentionSeconds(value=172800) {
  return boundedInteger(value,172800,300,604800);
}

function cleanLeasePart(value,kind='job') {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  const pattern=kind === 'group' ? GROUP_KEY_RE : JOB_KEY_RE;
  return pattern.test(raw) ? raw : '';
}

function cleanLeaseToken(value) {
  if (typeof value !== 'string') return '';
  const raw=value.trim();
  return LEASE_TOKEN_RE.test(raw) ? raw : '';
}

function cleanReason(value,fallback) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim().toLowerCase();
  if (!raw || raw.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,'_');
}

function scheduledIso(value) {
  let timestamp=null;
  if (value instanceof Date) timestamp=value.getTime();
  else if (typeof value === 'number' && Number.isSafeInteger(value)) timestamp=value;
  if (
    timestamp === null
    || !Number.isFinite(timestamp)
    || timestamp < 0
    || timestamp > MAX_TIMESTAMP_MS
  ) return '';
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '';
  }
}

function rpcTimestamp(value,fallback=null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!raw) return null;
  const timestamp=Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function supabaseAvailability(hasSupabase,cfg) {
  try {
    const value=hasSupabase(cfg);
    if (value === true) return 'configured';
    if (value === false) return 'memory_only';
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

function safeRedact(redactOpsString,value,limit=240) {
  try {
    const redacted=redactOpsString(value,limit);
    return typeof redacted === 'string'
      ? redacted.slice(0,limit)
      : 'scheduled lease error';
  } catch {
    return 'scheduled lease error';
  }
}

function validPersistentClaim(claim) {
  const source=plainObject(claim);
  return Boolean(
    source
    && source.claimed === true
    && source.persistent === true
    && cleanLeasePart(source.jobKey,'job')
    && cleanLeasePart(source.groupKey,'group')
    && cleanLeaseToken(source.leaseToken)
  );
}

function normalizeClaim(raw={},fallback={}) {
  const source=plainObject(raw);
  const fallbackJobKey=cleanLeasePart(fallback.jobKey,'job');
  const fallbackGroupKey=cleanLeasePart(fallback.groupKey,'group');
  const fallbackScheduledAt=rpcTimestamp(fallback.scheduledAt,null);
  const fallbackLeaseSeconds=boundedLeaseSeconds(fallback.leaseSeconds);

  if (!source || typeof source.claimed !== 'boolean') {
    return {
      claimed:false,
      persistent:true,
      reason:'malformed_response',
      jobKey:fallbackJobKey,
      groupKey:fallbackGroupKey,
      leaseToken:'',
      lockedUntil:null,
      scheduledAt:fallbackScheduledAt,
      leaseSeconds:fallbackLeaseSeconds,
    };
  }

  const jobKey=source.jobKey === undefined && source.job_key === undefined
    ? fallbackJobKey
    : cleanLeasePart(source.jobKey ?? source.job_key,'job');
  const groupKey=source.groupKey === undefined && source.group_key === undefined
    ? fallbackGroupKey
    : cleanLeasePart(source.groupKey ?? source.group_key,'group');
  const leaseToken=cleanLeaseToken(source.leaseToken ?? source.lease_token);
  const lockedUntil=rpcTimestamp(source.lockedUntil ?? source.locked_until,null);
  const rawScheduledAt=source.scheduledAt ?? source.scheduled_at;
  const scheduledAt=rpcTimestamp(rawScheduledAt,fallbackScheduledAt);
  const scheduledAtMatches=(
    rawScheduledAt === undefined
    || rawScheduledAt === null
    || rawScheduledAt === ''
    || !fallbackScheduledAt
    || scheduledAt === fallbackScheduledAt
  );
  const leaseSeconds=boundedLeaseSeconds(
    source.leaseSeconds ?? source.lease_seconds ?? fallbackLeaseSeconds,
  );

  const identityValid=Boolean(
    jobKey
    && groupKey
    && (!fallbackJobKey || jobKey === fallbackJobKey)
    && (!fallbackGroupKey || groupKey === fallbackGroupKey)
  );
  const claimedValid=source.claimed === false || Boolean(
    leaseToken
    && lockedUntil
    && scheduledAt
  );

  if (!identityValid || !scheduledAtMatches || !claimedValid) {
    return {
      claimed:false,
      persistent:true,
      reason:'malformed_response',
      jobKey:fallbackJobKey,
      groupKey:fallbackGroupKey,
      leaseToken:'',
      lockedUntil:null,
      scheduledAt:fallbackScheduledAt,
      leaseSeconds:fallbackLeaseSeconds,
    };
  }

  return {
    claimed:source.claimed === true,
    persistent:true,
    reason:cleanReason(source.reason,source.claimed ? 'claimed' : 'not_claimed'),
    jobKey,
    groupKey,
    leaseToken:source.claimed ? leaseToken : '',
    lockedUntil,
    scheduledAt,
    leaseSeconds,
  };
}

function normalizeRenewal(raw={},fallback={}) {
  const source=plainObject(raw);
  const fallbackJobKey=cleanLeasePart(fallback.jobKey,'job');
  const fallbackGroupKey=cleanLeasePart(fallback.groupKey,'group');

  if (!source || typeof source.renewed !== 'boolean') {
    return {
      renewed:false,
      persistent:true,
      reason:'malformed_response',
      jobKey:fallbackJobKey,
      groupKey:fallbackGroupKey,
      lockedUntil:null,
    };
  }

  const jobKey=source.jobKey === undefined && source.job_key === undefined
    ? fallbackJobKey
    : cleanLeasePart(source.jobKey ?? source.job_key,'job');
  const groupKey=source.groupKey === undefined && source.group_key === undefined
    ? fallbackGroupKey
    : cleanLeasePart(source.groupKey ?? source.group_key,'group');
  const lockedUntil=rpcTimestamp(source.lockedUntil ?? source.locked_until,null);
  const identityValid=Boolean(
    jobKey
    && (!fallbackJobKey || jobKey === fallbackJobKey)
    && (!groupKey || !fallbackGroupKey || groupKey === fallbackGroupKey)
  );

  if (!identityValid || (source.renewed === true && !lockedUntil)) {
    return {
      renewed:false,
      persistent:true,
      reason:'malformed_response',
      jobKey:fallbackJobKey,
      groupKey:fallbackGroupKey,
      lockedUntil:null,
    };
  }

  return {
    renewed:source.renewed === true,
    persistent:true,
    reason:cleanReason(source.reason,source.renewed ? 'renewed' : 'not_renewed'),
    jobKey,
    groupKey:groupKey || fallbackGroupKey,
    lockedUntil,
  };
}

export function createScheduledLeaseRuntime({
  hasSupabase,
  supaRpc,
  readScheduledJob,
  recordOpsEvent=async()=>{},
  redactOpsString=value=>typeof value === 'string' ? value : '',
  now=()=>Date.now(),
  sleepMs=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
} = {}) {
  if (typeof hasSupabase!=='function') throw new TypeError('hasSupabase is required');
  if (typeof supaRpc!=='function') throw new TypeError('supaRpc is required');

  async function safeRecord(cfg,event) {
    if (typeof recordOpsEvent !== 'function') return false;
    try {
      await recordOpsEvent(cfg,event);
      return true;
    } catch {
      return false;
    }
  }

  async function renewScheduledJob(cfg,claim={},leaseSeconds=claim?.leaseSeconds ?? 720) {
    const source=plainObject(claim);
    if (!source || source.claimed !== true) {
      return {
        renewed:false,
        persistent:source?.persistent === true,
        reason:'not_claimed',
        jobKey:cleanLeasePart(source?.jobKey,'job'),
        groupKey:cleanLeasePart(source?.groupKey,'group'),
        lockedUntil:null,
      };
    }
    if (source.persistent === false) {
      const jobKey=cleanLeasePart(source.jobKey,'job');
      const groupKey=cleanLeasePart(source.groupKey,'group');
      return jobKey && groupKey
        ? {
            renewed:true,
            persistent:false,
            reason:'memory_only',
            jobKey,
            groupKey,
            lockedUntil:null,
          }
        : {
            renewed:false,
            persistent:false,
            reason:'invalid_claim',
            jobKey:'',
            groupKey:'',
            lockedUntil:null,
          };
    }
    if (!validPersistentClaim(source)) {
      return {
        renewed:false,
        persistent:true,
        reason:'invalid_claim',
        jobKey:cleanLeasePart(source.jobKey,'job'),
        groupKey:cleanLeasePart(source.groupKey,'group'),
        lockedUntil:null,
      };
    }

    const jobKey=cleanLeasePart(source.jobKey,'job');
    const groupKey=cleanLeasePart(source.groupKey,'group');
    const token=cleanLeaseToken(source.leaseToken);
    const ttl=boundedLeaseSeconds(leaseSeconds);

    let attempts=0;
    const retryHasTime=()=>{
      const until=typeof source.lockedUntil==='string' ? Date.parse(source.lockedUntil) : NaN;
      return Number.isFinite(until) && until-now()>5000;
    };
    try {
      let raw;
      try {
        attempts++;
        raw=await supaRpc(cfg,'renew_scheduled_job',{
          p_job_key:jobKey,p_lease_token:token,p_lease_seconds:ttl,
        },1800);
      } catch(error) {
        // Renew is owner-token scoped and monotonic in SQL. Claim/settlement
        // writes have different unknown-outcome semantics and are never blindly replayed.
        if(!transientLeaseError(error) || !retryHasTime())throw error;
        await sleepMs(150);
        if(!retryHasTime())throw error;
        attempts++;
        raw=await supaRpc(cfg,'renew_scheduled_job',{
          p_job_key:jobKey,p_lease_token:token,p_lease_seconds:ttl,
        },1800);
      }
      const result=normalizeRenewal(raw,{jobKey,groupKey});
      if(attempts>1 && result.renewed===true){
        await safeRecord(cfg,{
          severity:'info',source:'cron',eventType:'scheduled_lease',code:'SCHEDULED_LEASE_RENEW_RECOVERED',
          message:'Scheduled execution lease renewal recovered after a transient RPC failure.',
          meta:{jobKey,groupKey,attempts},
        });
      }
      return result;
    } catch (error) {
      // A lost response does not establish ownership loss. Confirm the exact
      // owner in the durable row; never extend a lease from local memory alone.
      // Reserve more than the maximum heartbeat interval (TTL/2) plus I/O slack.
      if (transientLeaseError(error) && typeof readScheduledJob==='function') {
        try {
          const row=plainObject(await withRequestDeadline(
            ({signal,remaining})=>readScheduledJob(cfg,jobKey,{signal,timeoutMs:remaining()}),
            {budgetMs:1800,source:'Scheduled renewal reconciliation'},
          ));
          const until=rpcTimestamp(row?.locked_until,null);
          if (row?.status==='running' && row.lease_token===token && row.group_key===groupKey
              && until && Date.parse(until)-now()>ttl*500+5000) {
            await safeRecord(cfg,{
              severity:'info',source:'cron',eventType:'scheduled_lease',
              code:'SCHEDULED_LEASE_RENEW_CONFIRMED',
              message:'Scheduled ownership confirmed in the database after a transient renewal failure.',
              meta:{jobKey,groupKey,attempts},
            });
            // The read proves current ownership, not that the timed-out RPC
            // committed. Keep the observed deadline and the normal heartbeat.
            if (Date.parse(until)-now()>ttl*500+5000) {
              return {renewed:true,persistent:true,reason:'ownership_confirmed',jobKey,groupKey,lockedUntil:until};
            }
          }
        } catch { /* Unknown ownership remains a hard stop. */ }
      }
      await safeRecord(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_lease',
        code:'SCHEDULED_LEASE_RENEW_FAILED',
        message:safeRedact(redactOpsString,typeof error?.message === 'string' ? error.message : 'scheduled lease error',240),
        endpoint:'cron',
        transitionKey:`scheduled-lease-renew-failed:${groupKey || 'scheduled'}:${new Date().toISOString().slice(0,13)}`,
        meta:{jobKey,groupKey,attempts},
      });
      return {
        renewed:false,
        persistent:true,
        degraded:true,
        reason:'lease_unavailable',
        jobKey,
        groupKey,
        lockedUntil:null,
      };
    }
  }

  async function claimScheduledJob(cfg,{
    jobKey,
    groupKey='scheduled',
    scheduledAt=new Date(),
    leaseSeconds=720,
    retentionSeconds=172800,
  }={}) {
    const safeJobKey=cleanLeasePart(jobKey,'job');
    const safeGroupKey=cleanLeasePart(groupKey,'group');
    const scheduledAtIso=scheduledIso(scheduledAt);
    const safeLeaseSeconds=boundedLeaseSeconds(leaseSeconds);
    const safeRetentionSeconds=Math.max(
      boundedRetentionSeconds(retentionSeconds),
      safeLeaseSeconds,
    );

    if (!safeJobKey || !safeGroupKey || !scheduledAtIso) {
      return {
        claimed:false,
        persistent:false,
        reason:'invalid_input',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledAtIso || null,
        lockedUntil:null,
        leaseSeconds:safeLeaseSeconds,
      };
    }

    const availability=supabaseAvailability(hasSupabase,cfg);
    if (availability === 'memory_only') {
      return {
        claimed:true,
        persistent:false,
        reason:'memory_only',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledAtIso,
        lockedUntil:null,
        leaseSeconds:safeLeaseSeconds,
      };
    }
    if (availability !== 'configured') {
      return {
        claimed:false,
        persistent:true,
        degraded:true,
        reason:'lease_unavailable',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledAtIso,
        lockedUntil:null,
        leaseSeconds:safeLeaseSeconds,
      };
    }

    try {
      const raw=await supaRpc(cfg,'claim_scheduled_job',{
        p_job_key:safeJobKey,
        p_group_key:safeGroupKey,
        p_scheduled_at:scheduledAtIso,
        p_lease_seconds:safeLeaseSeconds,
        p_retention_seconds:safeRetentionSeconds,
      },2500);
      const normalized=normalizeClaim(raw,{
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        scheduledAt:scheduledAtIso,
        leaseSeconds:safeLeaseSeconds,
      });
      if (normalized.claimed === true && normalized.persistent === true) {
        const claim={...normalized};
        claim.renew=()=>renewScheduledJob(cfg,claim,safeLeaseSeconds);
        return claim;
      }
      return normalized;
    } catch (error) {
      await safeRecord(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_lease',
        code:'SCHEDULED_LEASE_UNAVAILABLE',
        message:safeRedact(redactOpsString,typeof error?.message === 'string' ? error.message : 'scheduled lease error',240),
        endpoint:'cron',
        transitionKey:`scheduled-lease-unavailable:${safeGroupKey}:${new Date().toISOString().slice(0,13)}`,
        meta:{jobKey:safeJobKey,groupKey:safeGroupKey},
      });
      return {
        claimed:false,
        persistent:true,
        degraded:true,
        reason:'lease_unavailable',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledAtIso,
        lockedUntil:null,
        leaseSeconds:safeLeaseSeconds,
      };
    }
  }

  async function reconcileCompletion(cfg,source) {
    if (typeof readScheduledJob!=='function') return null;
    const row=plainObject(await withRequestDeadline(
      ({signal,remaining})=>readScheduledJob(cfg,source.jobKey,{signal,timeoutMs:remaining()}),
      {budgetMs:1800,source:'Scheduled completion reconciliation'},
    ));
    if (!row || row.lease_token!==source.leaseToken || row.group_key!==source.groupKey) return null;
    if (row.status==='done') return 'done';
    const until=typeof row.locked_until==='string' ? Date.parse(row.locked_until) : NaN;
    return row.status==='running' && Number.isFinite(until) && until-now()>3000 ? 'running' : null;
  }

  async function settleScheduledJob(cfg,claim,rpcName,eventCode,severity) {
    const source=plainObject(claim);
    if (!source || source.claimed !== true) return false;
    if (source.persistent === false) {
      return Boolean(
        cleanLeasePart(source.jobKey,'job')
        && cleanLeasePart(source.groupKey,'group')
      );
    }
    if (!validPersistentClaim(source)) return false;

    const jobKey=cleanLeasePart(source.jobKey,'job');
    const groupKey=cleanLeasePart(source.groupKey,'group');
    const token=cleanLeaseToken(source.leaseToken);
    try {
      const complete=()=>supaRpc(cfg,rpcName,{p_job_key:jobKey,p_lease_token:token},1800);
      try { return await complete() === true; }
      catch (error) {
        if (rpcName!=='complete_scheduled_job' || !transientLeaseError(error)) throw error;
        // A timeout may mean the write committed. Read the exact owner before
        // considering one retry; never release/reclaim or rerun completed work.
        let state=await reconcileCompletion(cfg,source);
        if (state==='running') {
          try { if (await complete() === true) state='done'; }
          catch (retryError) { if (!transientLeaseError(retryError)) throw retryError; }
          if (state!=='done') state=await reconcileCompletion(cfg,source);
        }
        if (state!=='done') throw error;
        await safeRecord(cfg,{
          severity:'info',source:'cron',eventType:'scheduled_lease',
          code:'SCHEDULED_LEASE_COMPLETE_RECOVERED',
          message:'Scheduled completion confirmed after a transient transport failure.',
          meta:{jobKey,groupKey},
        });
        return true;
      }
    } catch (error) {
      await safeRecord(cfg,{
        severity,
        source:'cron',
        eventType:'scheduled_lease',
        code:eventCode,
        message:safeRedact(redactOpsString,typeof error?.message === 'string' ? error.message : 'scheduled lease error',240),
        endpoint:'cron',
        meta:{jobKey,groupKey},
      });
      return false;
    }
  }

  async function completeScheduledJob(cfg,claim={}) {
    return await settleScheduledJob(
      cfg,
      claim,
      'complete_scheduled_job',
      'SCHEDULED_LEASE_COMPLETE_FAILED',
      'error',
    );
  }

  async function releaseScheduledJob(cfg,claim={}) {
    return await settleScheduledJob(
      cfg,
      claim,
      'release_scheduled_job',
      'SCHEDULED_LEASE_RELEASE_FAILED',
      'warning',
    );
  }

  return Object.freeze({
    claimScheduledJob,
    renewScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
  });
}
