const SHA_RE=/^[0-9a-f]{40}$/i;
const DEFAULT_WINDOW_MS=60*60_000;
const MIN_WINDOW_MS=60_000;
const MAX_WINDOW_MS=7*24*60*60_000;
const MAX_TIMESTAMP_MS=8.64e15;

function numericCandidate(value){
  if(typeof value==='number') return Number.isFinite(value)?value:null;
  if(typeof value!=='string') return null;
  const raw=value.trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number)?number:null;
}

function timestampOption(value,fallback){
  const number=numericCandidate(value);
  return number!==null&&number>=0&&number<=MAX_TIMESTAMP_MS?number:fallback;
}

function normalizedWindowMs(value){
  const number=numericCandidate(value);
  if(!Number.isSafeInteger(number)||number<MIN_WINDOW_MS) return DEFAULT_WINDOW_MS;
  return Math.min(MAX_WINDOW_MS,number);
}

function eventTime(row){
  if(!row||typeof row!=='object'||Array.isArray(row)) return null;
  const raw=row.created_at??row.createdAt;
  if(typeof raw!=='string'||!raw.trim()) return null;
  const value=Date.parse(raw.trim());
  return Number.isFinite(value)?value:null;
}

function eventDeploySha(row){
  const metadata=row?.metadata;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)) return null;
  if(typeof metadata.deploySha!=='string') return null;
  const value=metadata.deploySha.trim().toLowerCase();
  return SHA_RE.test(value)?value:null;
}

function identityDeploySha(identity){
  if(!identity||typeof identity!=='object'||Array.isArray(identity)) return '';
  if(typeof identity.deploySha!=='string') return '';
  const sha=identity.deploySha.trim().toLowerCase();
  return SHA_RE.test(sha)?sha:'';
}

function deploymentTimestamp(identity,nowMs,fallbackStartMs){
  if(!identity||typeof identity!=='object'||Array.isArray(identity)) return fallbackStartMs;
  const raw=identity.cloudflareVersionTimestamp;
  if(typeof raw!=='string'||!raw.trim()) return fallbackStartMs;
  const timestamp=Date.parse(raw.trim());
  if(!Number.isFinite(timestamp)||timestamp<0||timestamp>nowMs) return fallbackStartMs;
  return Math.max(timestamp,fallbackStartMs);
}

export function scopeOpsEventsToDeployment(items = [], identity = {}, options = {}) {
  const optionSource=options&&typeof options==='object'&&!Array.isArray(options)?options:{};
  const nowMs=timestampOption(optionSource.nowMs,Date.now());
  const windowMs=normalizedWindowMs(optionSource.windowMs);
  const fallbackStartMs=Math.max(0,nowMs-windowMs);
  const deploymentStartMs=deploymentTimestamp(identity,nowMs,fallbackStartMs);
  const deploySha=identityDeploySha(identity);
  const hasDeploySha=Boolean(deploySha);

  const exact=[];
  const unattributed=[];
  const priorDeployment=[];
  const invalidTime=[];
  const actionableEntries=[];

  for(const [index,item] of (Array.isArray(items)?items:[]).entries()){
    const created=eventTime(item);
    if(created===null){
      invalidTime.push(item);
      continue;
    }
    if(created<deploymentStartMs||created>nowMs) continue;

    const itemSha=eventDeploySha(item);
    if(!hasDeploySha){
      // Without a trusted active deployment identity we cannot safely classify
      // a stamped event as belonging to a prior deployment. Keep every
      // in-window event actionable and explicitly unattributed instead.
      unattributed.push(item);
      actionableEntries.push({item,created,index});
      continue;
    }
    if(itemSha===deploySha){
      exact.push(item);
      actionableEntries.push({item,created,index});
      continue;
    }
    if(itemSha){
      priorDeployment.push(item);
      continue;
    }
    unattributed.push(item);
    actionableEntries.push({item,created,index});
  }

  actionableEntries.sort((a,b)=>a.created-b.created||a.index-b.index);

  return {
    deploySha:hasDeploySha?deploySha:null,
    deploymentStartedAt:new Date(deploymentStartMs).toISOString(),
    exact,
    unattributed,
    priorDeployment,
    invalidTime,
    actionable:actionableEntries.map(entry=>entry.item),
    counts:{
      exact:exact.length,
      unattributed:unattributed.length,
      priorDeployment:priorDeployment.length,
      invalidTime:invalidTime.length,
    },
    attributionComplete:hasDeploySha&&unattributed.length===0,
  };
}
