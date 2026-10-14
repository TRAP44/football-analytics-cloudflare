// Only the prematch background job uses this budget. Interactive requests
// never receive its internal admission capability.
export const PREMATCH_PROVIDER_BUDGET_PREFIX='prematch-provider-requests';
export const PREMATCH_PRO_DAILY_LIMIT=7500;
const MAX_SNAPSHOT_AGE_MS=30*60_000;

function count(value) {
  return typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value : null;
}

export function prematchProviderBudget(snapshot={},nowMs=Date.now()) {
  const limit=count(snapshot?.dailyLimit), remaining=count(snapshot?.dailyRemaining);
  const updated=Date.parse(snapshot?.updatedAt || '');
  const age=nowMs-updated;
  if (limit===null || limit===0 || remaining===null || remaining>limit
      || !Number.isFinite(age) || age<0 || age>MAX_SNAPSHOT_AGE_MS
      || Math.floor(updated/86400000)!==Math.floor(nowMs/86400000)) {
    return {allowed:false,reason:'provider_quota_unconfirmed',limit:0};
  }
  const backgroundLimit=Math.floor(Math.min(limit,PREMATCH_PRO_DAILY_LIMIT)*0.25);
  // Conservative: all observed usage counts towards the stop threshold,
  // including background consumption, to protect half of the reported quota.
  if (remaining<=limit*0.5) return {allowed:false,reason:'provider_user_reserve',limit:backgroundLimit};
  return {allowed:backgroundLimit>0,reason:backgroundLimit>0?'':'provider_daily_reserve',limit:backgroundLimit};
}
