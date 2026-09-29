const SHA_RE=/^[0-9a-f]{40}$/i;

function eventTime(row){
  const value=Date.parse(String(row?.created_at || ''));
  return Number.isFinite(value) ? value : null;
}

function eventDeploySha(row){
  const value=String(row?.metadata?.deploySha || '').trim().toLowerCase();
  return SHA_RE.test(value) ? value : null;
}

export function scopeOpsEventsToDeployment(items = [], identity = {}, options = {}) {
  const nowMs=Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const windowMs=Math.max(60_000,Number(options.windowMs || 60*60_000));
  const fallbackStartMs=nowMs-windowMs;
  const timestampMs=Date.parse(String(identity?.cloudflareVersionTimestamp || ''));
  const deploymentStartMs=Number.isFinite(timestampMs) ? Math.max(timestampMs,fallbackStartMs) : fallbackStartMs;
  const deploySha=String(identity?.deploySha || '').trim().toLowerCase();
  const hasDeploySha=SHA_RE.test(deploySha);

  const exact=[];
  const unattributed=[];
  const priorDeployment=[];
  const invalidTime=[];

  for(const item of Array.isArray(items) ? items : []){
    const created=eventTime(item);
    if(created === null){
      invalidTime.push(item);
      continue;
    }
    if(created < deploymentStartMs || created > nowMs) continue;

    const itemSha=eventDeploySha(item);
    if(hasDeploySha && itemSha === deploySha){
      exact.push(item);
      continue;
    }
    if(itemSha){
      priorDeployment.push(item);
      continue;
    }
    unattributed.push(item);
  }

  return {
    deploySha:hasDeploySha ? deploySha : null,
    deploymentStartedAt:new Date(deploymentStartMs).toISOString(),
    exact,
    unattributed,
    priorDeployment,
    invalidTime,
    actionable:[...exact,...unattributed].sort((a,b)=>(eventTime(a)||0)-(eventTime(b)||0)),
    counts:{
      exact:exact.length,
      unattributed:unattributed.length,
      priorDeployment:priorDeployment.length,
      invalidTime:invalidTime.length,
    },
    attributionComplete:hasDeploySha && unattributed.length===0,
  };
}
