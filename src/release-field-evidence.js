function required(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

export function createReleaseFieldEvidenceRuntime({
  hasSupabase,
  appVersion = '',
  fetchWithTimeout,
  supaHeaders,
  supaSelectMany,
  recordOpsEvent,
  loadSharedProviderState,
  apiFootball,
  isFootballRateLimitError,
  providerSnapshot,
  randomUUID = () => crypto.randomUUID(),
  now = Date.now,
} = {}) {
  required('hasSupabase', hasSupabase);
  required('fetchWithTimeout', fetchWithTimeout);
  required('supaHeaders', supaHeaders);
  required('supaSelectMany', supaSelectMany);
  required('recordOpsEvent', recordOpsEvent);
  required('loadSharedProviderState', loadSharedProviderState);
  required('apiFootball', apiFootball);
  required('isFootballRateLimitError', isFootballRateLimitError);
  required('providerSnapshot', providerSnapshot);
  required('randomUUID', randomUUID);
  required('now', now);

  async function claimReleaseEvidenceLock(cfg, kind) {
    if (!hasSupabase(cfg)) return false;
    const key=`release-evidence:${String(appVersion || '')}:${String(kind || 'unknown').slice(0,40)}`;
    const claimId=String(randomUUID());
    const current=Number(now());
    const expiresAt=new Date(current+7*24*60*60_000).toISOString();
    try {
      const url=new URL(`${cfg.supabaseUrl}/rest/v1/analysis_cache`);
      url.searchParams.set('on_conflict','cache_key');
      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
        body:JSON.stringify([{
          cache_key:key,
          fixture_id:0,
          payload:{state:'claimed',claimId,kind,release:String(appVersion || ''),claimedAt:new Date(current).toISOString()},
          expires_at:expiresAt,
          provider:'internal',
          freshness_status:'fresh',
        }]),
      },7000,'Supabase release evidence lock');
      if (!response.ok) return false;
      const rows=await response.json().catch(()=>[]);
      return Array.isArray(rows) && rows.length===1 && String(rows[0]?.payload?.claimId || '')===claimId;
    } catch {
      return false;
    }
  }

  async function recordClosedBetaConfigurationEvidence(cfg) {
    if (!await claimReleaseEvidenceLock(cfg,'beta-access')) return false;
    const rows=await supaSelectMany(cfg,'users',{}, {limit:50,order:'created_at.desc'}).catch(()=>[]);
    const adminIds=new Set((cfg.adminTelegramIds || []).map(Number));
    const betaIds=new Set((cfg.betaTelegramIds || []).map(Number));
    const overlap=[...betaIds].filter(id=>adminIds.has(id)).length;
    const newest=rows[0] || null;
    const newestId=Number(newest?.telegram_id || 0);
    const newestAdmin=Number.isSafeInteger(newestId) && adminIds.has(newestId);
    const newestBeta=Number.isSafeInteger(newestId) && !newestAdmin && betaIds.has(newestId);
    const nonAdmin=rows.filter(row=>!adminIds.has(Number(row?.telegram_id || 0)));
    const outside=nonAdmin.filter(row=>!betaIds.has(Number(row?.telegram_id || 0)));

    await recordOpsEvent(cfg,{
      severity: cfg.betaAccessConfigured === 'true' ? 'info' : 'warning',
      source:'access',
      eventType:'closed_beta_configuration',
      code:'BETA_ACCESS_CONFIG_CONFIRMED',
      message:'Closed beta production configuration captured without exposing Telegram identifiers.',
      endpoint:'production-config',
      meta:{
        betaAccessConfigured:String(cfg.betaAccessConfigured || 'missing'),
        strictEffective:Boolean(cfg.betaAccessEnabled),
        betaAllowlistCount:betaIds.size,
        adminAllowlistCount:adminIds.size,
        allowlistOverlapCount:overlap,
        observedUsers:rows.length,
        observedNonAdminUsers:nonAdmin.length,
        observedNonAdminOutsideBeta:outside.length,
        newestUserCreatedAt:newest?.created_at || null,
        newestUserAdmin:Boolean(newestAdmin),
        newestUserBetaAllowlisted:Boolean(newestBeta),
      },
    });
    return true;
  }

  async function probeReleaseProviderQuotaEvidence(cfg) {
    if (!cfg?.apiFootballKey || !await claimReleaseEvidenceLock(cfg,'provider-quota')) return false;
    await loadSharedProviderState(cfg).catch(()=>null);
    let outcome='success';
    let errorCode='';
    let retryAfter=0;
    try {
      await apiFootball('/status',{},cfg,{responseType:'any',transportRetries:0,timeoutMs:8000});
    } catch (error) {
      outcome=isFootballRateLimitError(error) ? 'rate_limited' : 'failed';
      errorCode=String(error?.code || 'PROVIDER_PROBE_FAILED');
      retryAfter=Number(error?.retryAfter || 0);
    }
    const snapshot=providerSnapshot();
    await recordOpsEvent(cfg,{
      severity: outcome === 'failed' ? 'warning' : 'info',
      source:'provider',
      eventType:'release_quota_probe',
      code:'PROVIDER_RELEASE_QUOTA_PROBE',
      message:'One controlled production provider request captured shared quota evidence for the release.',
      endpoint:'/status',
      meta:{
        outcome,
        errorCode,
        retryAfter,
        plan:String(snapshot.plan || 'UNKNOWN'),
        dailyLimit:Number.isFinite(Number(snapshot.dailyLimit)) ? Number(snapshot.dailyLimit) : null,
        dailyRemaining:Number.isFinite(Number(snapshot.dailyRemaining)) ? Number(snapshot.dailyRemaining) : null,
        minuteLimit:Number.isFinite(Number(snapshot.minuteLimit)) ? Number(snapshot.minuteLimit) : null,
        minuteRemaining:Number.isFinite(Number(snapshot.minuteRemaining)) ? Number(snapshot.minuteRemaining) : null,
        cooldownActive:Boolean(snapshot.cooldownActive),
        evidenceSource:'controlled_release_probe',
      },
    });
    return true;
  }

  async function captureReleaseFieldEvidence(cfg) {
    if (!hasSupabase(cfg)) return;
    await Promise.allSettled([
      recordClosedBetaConfigurationEvidence(cfg),
      probeReleaseProviderQuotaEvidence(cfg),
    ]);
  }

  function scheduleReleaseFieldEvidence(cfg) {
    if (!hasSupabase(cfg)) return null;
    const task=captureReleaseFieldEvidence(cfg);
    if (typeof cfg?.waitUntil === 'function') cfg.waitUntil(task);
    else void task;
    return task;
  }

  return Object.freeze({
    claimReleaseEvidenceLock,
    recordClosedBetaConfigurationEvidence,
    probeReleaseProviderQuotaEvidence,
    captureReleaseFieldEvidence,
    scheduleReleaseFieldEvidence,
  });
}
