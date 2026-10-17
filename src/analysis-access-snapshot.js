// Display-only access metadata from the checks/reservation already performed by
// the analysis endpoint. Never expose raw entitlement rows or reservation tokens.
export function analysisAccessSnapshot(entitlement={},reservation=null,{passAccess=false,freeRecheck=false}={}) {
  const positive=value=>Number.isSafeInteger(value) && value>0?value:null;
  const count=value=>Number.isSafeInteger(value) && value>=0?value:null;
  const tier=value=>['FREE','PRO','PREMIUM'].includes(value)?value:'FREE';
  let source=['free','subscription','pass'].includes(entitlement?.source)?entitlement.source:'free';
  if(source==='pass' && !passAccess && !freeRecheck)source='free';
  const active=Array.isArray(entitlement?.passes?.active)?entitlement.passes.active:[];
  const passes=source==='pass' && passAccess?active.filter(row=>row?.id===reservation?.entitlementId && positive(row?.id) && ['MATCH_PASS','DAY_PASS','WEEKEND_PASS'].includes(row?.type)).map(row=>({
    id:row.id,type:row.type,fixtureId:count(row.fixtureId)??0,
    usageLimit:row.usageLimit==null?null:positive(row.usageLimit),usageCount:count(row.usageCount)??0,
  })):[];
  const before={entitlement:{source,plan:tier(entitlement?.plan),effectiveTier:tier(entitlement?.effectiveTier),passes:{active:passes}}};
  const decisions=passAccess && positive(reservation?.entitlementId) && count(reservation?.usageCount)!==null
    ? [{id:reservation.entitlementId,usageCount:reservation.usageCount,usageLimit:passes.find(row=>row.id===reservation.entitlementId)?.usageLimit??null}]:[];
  return {before,after:{entitlement:{...before.entitlement,decisions}}};
}
