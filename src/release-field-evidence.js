function required(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

const MAX_TIMESTAMP_MS=8.64e15;
const EVIDENCE_LOCK_TTL_MS=7*24*60*60_000;
const MAX_RETRY_AFTER_SECONDS=604800;

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveSafeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number > 0 ? number : 0;
}

function nonNegativeInteger(value) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 ? number : null;
}

function clockValue(now) {
  try {
    const value=now();
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= MAX_TIMESTAMP_MS
      ? value
      : null;
  } catch {
    return null;
  }
}

function cleanText(value,fallback='',maxLength=120) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function configuredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validKind(value) {
  const kind=cleanText(value,'',40).toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(kind) ? kind : '';
}

function validClaimId(value) {
  const id=cleanText(value,'',80);
  return /^[A-Za-z0-9._:-]{1,80}$/.test(id) ? id : '';
}

function canonicalAppVersion(value) {
  const version=cleanText(value,'',80);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version) ? version : '';
}

function safeSupabaseUrl(cfg) {
  if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl.trim()) return '';
  try {
    const url=new URL(cfg.supabaseUrl.trim());
    return ['http:','https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function strictSupabaseAvailable(hasSupabase,cfg) {
  try {
    return hasSupabase(cfg) === true;
  } catch {
    return false;
  }
}

function idSet(value) {
  const result=new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const id=positiveSafeInteger(item);
    if (id) result.add(id);
  }
  return result;
}

function rowUserId(row) {
  return row && typeof row === 'object' && !Array.isArray(row)
    ? positiveSafeInteger(row.telegram_id)
    : 0;
}

function safeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function quotaValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number=nonNegativeInteger(value);
  return number === null ? null : number;
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

  const releaseVersion=canonicalAppVersion(appVersion);

  async function claimReleaseEvidenceLease(cfg,kindValue) {
    if (!releaseVersion || !strictSupabaseAvailable(hasSupabase,cfg)) return null;
    const origin=safeSupabaseUrl(cfg);
    const kind=validKind(kindValue);
    const current=clockValue(now);
    let claimId='';
    try {
      claimId=validClaimId(randomUUID());
    } catch {
      claimId='';
    }
    if (!origin || !kind || current === null || !claimId) return null;

    const key=`release-evidence:${releaseVersion}:${kind}`;
    const expiresAt=new Date(current+EVIDENCE_LOCK_TTL_MS).toISOString();
    try {
      const url=new URL(`${origin}/rest/v1/analysis_cache`);
      url.searchParams.set('on_conflict','cache_key');
      const response=await fetchWithTimeout(url,{
        method:'POST',
        headers:supaHeaders(cfg,{Prefer:'resolution=ignore-duplicates,return=representation'}),
        body:JSON.stringify([{
          cache_key:key,
          fixture_id:0,
          payload:{
            state:'claimed',
            claimId,
            kind,
            release:releaseVersion,
            claimedAt:new Date(current).toISOString(),
          },
          expires_at:expiresAt,
          provider:'internal',
          freshness_status:'fresh',
        }]),
      },7000,'Supabase release evidence lock');
      if (response?.ok !== true) return null;
      const rows=await response.json().catch(()=>[]);
      const confirmed=Array.isArray(rows)
        && rows.length===1
        && rows[0]
        && typeof rows[0] === 'object'
        && !Array.isArray(rows[0])
        && rows[0]?.payload?.claimId === claimId;
      return confirmed ? {key,claimId} : null;
    } catch {
      return null;
    }
  }

  async function releaseEvidenceLease(cfg,lease) {
    if (!lease?.key || !lease?.claimId) return false;
    const origin=safeSupabaseUrl(cfg);
    if (!origin) return false;
    try {
      const url=new URL(`${origin}/rest/v1/analysis_cache`);
      url.searchParams.set('cache_key',`eq.${lease.key}`);
      url.searchParams.set('payload->>claimId',`eq.${lease.claimId}`);
      const response=await fetchWithTimeout(url,{
        method:'DELETE',
        headers:supaHeaders(cfg,{Prefer:'return=minimal'}),
      },7000,'Supabase release evidence unlock');
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  async function claimReleaseEvidenceLock(cfg,kind) {
    return Boolean(await claimReleaseEvidenceLease(cfg,kind));
  }

  async function recordClosedBetaConfigurationEvidence(cfg) {
    const lease=await claimReleaseEvidenceLease(cfg,'beta-access');
    if (!lease) return false;

    try {
      const selected=await supaSelectMany(
        cfg,
        'users',
        {},
        {limit:50,order:'created_at.desc'},
      );
      if (!Array.isArray(selected)) throw new Error('release_evidence_users_unavailable');

      const rows=selected
        .filter(row=>row&&typeof row === 'object'&&!Array.isArray(row))
        .slice(0,50);
      const adminIds=idSet(cfg?.adminTelegramIds);
      const betaIds=idSet(cfg?.betaTelegramIds);
      const overlap=[...betaIds].filter(id=>adminIds.has(id)).length;
      const newest=rows[0] || null;
      const newestId=rowUserId(newest);
      const newestAdmin=Boolean(newestId && adminIds.has(newestId));
      const newestBeta=Boolean(newestId && !newestAdmin && betaIds.has(newestId));
      const nonAdmin=rows.filter(row=>{
        const id=rowUserId(row);
        return !id || !adminIds.has(id);
      });
      const outside=nonAdmin.filter(row=>{
        const id=rowUserId(row);
        return !id || !betaIds.has(id);
      });
      const configuredState=cfg?.betaAccessConfigured === 'true'
        ? 'true'
        : cfg?.betaAccessConfigured === 'false'
          ? 'false'
          : cfg?.betaAccessConfigured === undefined
            || cfg?.betaAccessConfigured === null
            || cfg?.betaAccessConfigured === ''
            ? 'missing'
            : 'invalid';

      await recordOpsEvent(cfg,{
        severity:configuredState === 'true' ? 'info' : 'warning',
        source:'access',
        eventType:'closed_beta_configuration',
        code:'BETA_ACCESS_CONFIG_CONFIRMED',
        message:'Closed beta production configuration captured without exposing Telegram identifiers.',
        endpoint:'production-config',
        meta:{
          betaAccessConfigured:configuredState,
          strictEffective:cfg?.betaAccessEnabled === true,
          betaAllowlistCount:betaIds.size,
          adminAllowlistCount:adminIds.size,
          allowlistOverlapCount:overlap,
          observedUsers:rows.length,
          observedNonAdminUsers:nonAdmin.length,
          observedNonAdminOutsideBeta:outside.length,
          newestUserCreatedAt:safeTimestamp(newest?.created_at),
          newestUserAdmin:newestAdmin,
          newestUserBetaAllowlisted:newestBeta,
        },
      });
      return true;
    } catch {
      await releaseEvidenceLease(cfg,lease);
      return false;
    }
  }

  async function probeReleaseProviderQuotaEvidence(cfg) {
    if (!configuredSecret(cfg?.apiFootballKey)) return false;
    const lease=await claimReleaseEvidenceLease(cfg,'provider-quota');
    if (!lease) return false;

    try {
      await loadSharedProviderState(cfg).catch(()=>null);
      let outcome='success';
      let errorCode='';
      let retryAfter=0;
      try {
        await apiFootball('/status',{},cfg,{
          responseType:'any',
          transportRetries:0,
          timeoutMs:8000,
        });
      } catch (error) {
        let rateLimited=false;
        try {
          rateLimited=isFootballRateLimitError(error) === true;
        } catch {
          rateLimited=false;
        }
        outcome=rateLimited ? 'rate_limited' : 'failed';
        errorCode=cleanText(error?.code,'PROVIDER_PROBE_FAILED',80);
        const retry=positiveSafeInteger(error?.retryAfter);
        retryAfter=Math.min(MAX_RETRY_AFTER_SECONDS,retry);
      }

      const rawSnapshot=providerSnapshot();
      const snapshot=rawSnapshot&&typeof rawSnapshot === 'object'&&!Array.isArray(rawSnapshot)
        ? rawSnapshot
        : {};
      await recordOpsEvent(cfg,{
        severity:outcome === 'failed' ? 'warning' : 'info',
        source:'provider',
        eventType:'release_quota_probe',
        code:'PROVIDER_RELEASE_QUOTA_PROBE',
        message:'One controlled production provider request captured shared quota evidence for the release.',
        endpoint:'/status',
        meta:{
          outcome,
          errorCode,
          retryAfter,
          plan:cleanText(snapshot.plan,'UNKNOWN',40),
          dailyLimit:quotaValue(snapshot.dailyLimit),
          dailyRemaining:quotaValue(snapshot.dailyRemaining),
          minuteLimit:quotaValue(snapshot.minuteLimit),
          minuteRemaining:quotaValue(snapshot.minuteRemaining),
          cooldownActive:snapshot.cooldownActive === true,
          evidenceSource:'controlled_release_probe',
        },
      });
      return true;
    } catch {
      await releaseEvidenceLease(cfg,lease);
      return false;
    }
  }

  async function captureReleaseFieldEvidence(cfg) {
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return;
    await Promise.allSettled([
      recordClosedBetaConfigurationEvidence(cfg),
      probeReleaseProviderQuotaEvidence(cfg),
    ]);
  }

  function scheduleReleaseFieldEvidence(cfg) {
    if (!strictSupabaseAvailable(hasSupabase,cfg)) return null;
    const task=captureReleaseFieldEvidence(cfg);
    if (typeof cfg?.waitUntil === 'function') {
      try {
        cfg.waitUntil(task);
      } catch {
        // Registration is best-effort; the returned task still runs and may
        // be awaited by the caller.
      }
    } else {
      void task;
    }
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
