function cleanLeasePart(value='', max=180) {
  return String(value || '').trim().replace(/[^A-Za-z0-9._:@/-]/g,'-').slice(0,max);
}

function normalizeClaim(raw={}, fallback={}) {
  return {
    claimed:Boolean(raw?.claimed),
    persistent:true,
    reason:String(raw?.reason || (raw?.claimed ? 'claimed' : 'not_claimed')).slice(0,80),
    jobKey:String(raw?.jobKey || raw?.job_key || fallback.jobKey || '').slice(0,180),
    groupKey:String(raw?.groupKey || raw?.group_key || fallback.groupKey || '').slice(0,120),
    leaseToken:String(raw?.leaseToken || raw?.lease_token || '').slice(0,80),
    lockedUntil:raw?.lockedUntil || raw?.locked_until || null,
    scheduledAt:raw?.scheduledAt || raw?.scheduled_at || fallback.scheduledAt || null,
  };
}

export function createScheduledLeaseRuntime({
  hasSupabase,
  supaRpc,
  recordOpsEvent=async()=>{},
  redactOpsString=value=>String(value || ''),
} = {}) {
  if (typeof hasSupabase!=='function') throw new TypeError('hasSupabase is required');
  if (typeof supaRpc!=='function') throw new TypeError('supaRpc is required');

  async function claimScheduledJob(cfg,{
    jobKey,
    groupKey='scheduled',
    scheduledAt=new Date(),
    leaseSeconds=720,
    retentionSeconds=172800,
  }={}) {
    const safeJobKey=cleanLeasePart(jobKey,180);
    const safeGroupKey=cleanLeasePart(groupKey,120);
    const scheduledIso=new Date(scheduledAt).toISOString();
    if (!safeJobKey || !safeGroupKey) {
      return {claimed:false,persistent:false,reason:'invalid_key',jobKey:safeJobKey,groupKey:safeGroupKey,leaseToken:'',scheduledAt:scheduledIso};
    }

    if (!hasSupabase(cfg)) {
      return {
        claimed:true,
        persistent:false,
        reason:'memory_only',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledIso,
        lockedUntil:null,
      };
    }

    try {
      const raw=await supaRpc(cfg,'claim_scheduled_job',{
        p_job_key:safeJobKey,
        p_group_key:safeGroupKey,
        p_scheduled_at:scheduledIso,
        p_lease_seconds:Math.max(30,Math.min(1800,Number(leaseSeconds || 720))),
        p_retention_seconds:Math.max(300,Math.min(604800,Number(retentionSeconds || 172800))),
      },2500);
      return normalizeClaim(raw,{jobKey:safeJobKey,groupKey:safeGroupKey,scheduledAt:scheduledIso});
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_lease',
        code:'SCHEDULED_LEASE_UNAVAILABLE',
        message:redactOpsString(error?.message || error,240),
        endpoint:'cron',
        transitionKey:`scheduled-lease-unavailable:${safeGroupKey}:${new Date().toISOString().slice(0,13)}`,
        meta:{jobKey:safeJobKey,groupKey:safeGroupKey},
      }).catch(()=>{});
      return {
        claimed:false,
        persistent:true,
        degraded:true,
        reason:'lease_unavailable',
        jobKey:safeJobKey,
        groupKey:safeGroupKey,
        leaseToken:'',
        scheduledAt:scheduledIso,
        lockedUntil:null,
      };
    }
  }

  async function completeScheduledJob(cfg,claim={}) {
    if (!claim?.claimed) return false;
    if (!claim?.persistent) return true;
    if (!claim?.jobKey || !claim?.leaseToken) return false;
    try {
      return Boolean(await supaRpc(cfg,'complete_scheduled_job',{
        p_job_key:String(claim.jobKey),
        p_lease_token:String(claim.leaseToken),
      },1800));
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'error',
        source:'cron',
        eventType:'scheduled_lease',
        code:'SCHEDULED_LEASE_COMPLETE_FAILED',
        message:redactOpsString(error?.message || error,240),
        endpoint:'cron',
        meta:{jobKey:String(claim.jobKey || '').slice(0,180),groupKey:String(claim.groupKey || '').slice(0,120)},
      }).catch(()=>{});
      return false;
    }
  }

  async function releaseScheduledJob(cfg,claim={}) {
    if (!claim?.claimed) return false;
    if (!claim?.persistent) return true;
    if (!claim?.jobKey || !claim?.leaseToken) return false;
    try {
      return Boolean(await supaRpc(cfg,'release_scheduled_job',{
        p_job_key:String(claim.jobKey),
        p_lease_token:String(claim.leaseToken),
      },1800));
    } catch (error) {
      await recordOpsEvent(cfg,{
        severity:'warning',
        source:'cron',
        eventType:'scheduled_lease',
        code:'SCHEDULED_LEASE_RELEASE_FAILED',
        message:redactOpsString(error?.message || error,240),
        endpoint:'cron',
        meta:{jobKey:String(claim.jobKey || '').slice(0,180),groupKey:String(claim.groupKey || '').slice(0,120)},
      }).catch(()=>{});
      return false;
    }
  }

  return Object.freeze({
    claimScheduledJob,
    completeScheduledJob,
    releaseScheduledJob,
  });
}
