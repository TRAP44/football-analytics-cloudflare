import {ensureProviderSnapshot} from './provider-status-probe.js';
import {claimDailyBudget} from './daily-budget-claim.js';
import {prematchProviderBudget,PREMATCH_PROVIDER_BUDGET_PREFIX} from './prematch-provider-budget.js';

// Extra LIVE probes share the existing 25% prematch allowance, never the user's.
export async function fastLiveNotificationConfig(cfg,deps){
  const {loadSharedProviderState,providerSnapshot,probeProviderStatus,supaRpc,supaSelectMany}=deps;
  await ensureProviderSnapshot({cfg,loadSharedProviderState,providerSnapshot,probeProviderStatus,requireDailyQuota:true});
  if(!prematchProviderBudget(providerSnapshot()).allowed)return null;
  return {...cfg,prematchProviderClaim:async()=>{
    const budget=prematchProviderBudget(providerSnapshot());
    if(!budget.allowed)throw Object.assign(new Error('Live background reserve protected.'),{code:'FOOTBALL_BACKGROUND_LIMIT',status:429});
    const claim=await claimDailyBudget({cfg,supaRpc,supaSelectMany,prefix:PREMATCH_PROVIDER_BUDGET_PREFIX,limit:budget.limit});
    if(!claim.allowed)throw Object.assign(new Error('Live background allowance unavailable.'),{code:'FOOTBALL_BACKGROUND_LIMIT',status:429});
  }};
}
