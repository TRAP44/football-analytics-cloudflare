// Provider quota state, shared cooldowns, plan detection and budget policy extracted from worker.js.
// Cache, telemetry and runtime-control primitives are injected by the composition root.
export function createProviderBudgetRuntime(deps) {
  if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
    throw new TypeError('Provider budget runtime dependencies are required.');
  }
  const {
    clamp,
    freeQuotaHealthy,
    getCache,
    hasSupabase,
    memory,
    phase5ProviderUsage,
    recordOpsEvent,
    runtimeControlsSnapshot,
    setCache,
  } = deps;

  function inferFootballPlan(dailyLimit) {
    const n = Number(dailyLimit || 0);
    if (n >= 150000) return 'MEGA';
    if (n >= 75000) return 'ULTRA';
    if (n >= 7500) return 'PRO';
    if (n > 0) return 'FREE';
    return 'UNKNOWN';
  }
  
  function updateProviderFromHeaders(response) {
    const readNum = name => {
      const v = response.headers.get(name);
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const dailyLimit = readNum('x-ratelimit-requests-limit');
    const dailyRemaining = readNum('x-ratelimit-requests-remaining');
    const minuteLimit = readNum('x-ratelimit-limit');
    const minuteRemaining = readNum('x-ratelimit-remaining');
    memory.provider = {
      ...memory.provider,
      name: 'API-Football',
      plan: dailyLimit !== null ? inferFootballPlan(dailyLimit) : (memory.provider?.plan || 'UNKNOWN'),
      dailyLimit: dailyLimit ?? memory.provider?.dailyLimit ?? null,
      dailyRemaining: dailyRemaining ?? memory.provider?.dailyRemaining ?? null,
      minuteLimit: minuteLimit ?? memory.provider?.minuteLimit ?? null,
      minuteRemaining: minuteRemaining ?? memory.provider?.minuteRemaining ?? null,
      updatedAt: new Date().toISOString(),
    };
  }
  
  const PROVIDER_QUOTA_SHARED_CACHE_KEY = 'provider-state:api-football:quota:v1';
  const PROVIDER_COOLDOWN_SHARED_CACHE_KEY = 'provider-state:api-football:cooldown:v1';
  
  function completeProviderQuotaSnapshot(value = {}) {
    return String(value?.plan || 'UNKNOWN') !== 'UNKNOWN'
      && [value?.dailyLimit, value?.dailyRemaining, value?.minuteLimit, value?.minuteRemaining]
        .every(item => Number.isFinite(Number(item)));
  }
  
  async function loadSharedProviderState(cfg) {
    if (!hasSupabase(cfg)) return;
    const [quota, cooldown] = await Promise.all([
      getCache(PROVIDER_QUOTA_SHARED_CACHE_KEY, cfg).catch(() => null),
      getCache(PROVIDER_COOLDOWN_SHARED_CACHE_KEY, cfg).catch(() => null),
    ]);
  
    if (quota && completeProviderQuotaSnapshot(quota)) {
      const sharedAt = Date.parse(quota.updatedAt || '');
      const localAt = Date.parse(memory.provider?.updatedAt || '');
      if (!Number.isFinite(localAt) || (Number.isFinite(sharedAt) && sharedAt >= localAt)) {
        memory.provider = {
          ...memory.provider,
          name: 'API-Football',
          plan: String(quota.plan),
          dailyLimit: Number(quota.dailyLimit),
          dailyRemaining: Number(quota.dailyRemaining),
          minuteLimit: Number(quota.minuteLimit),
          minuteRemaining: Number(quota.minuteRemaining),
          updatedAt: quota.updatedAt || new Date().toISOString(),
        };
      }
    }
  
    const sharedUntil = Date.parse(cooldown?.cooldownUntil || '');
    const localUntil = Date.parse(memory.provider?.cooldownUntil || '');
    if (Number.isFinite(sharedUntil) && sharedUntil > Date.now() && (!Number.isFinite(localUntil) || sharedUntil > localUntil)) {
      memory.provider.cooldownUntil = cooldown.cooldownUntil;
      memory.provider.lastError = cooldown.reason || memory.provider.lastError || 'rate_limit';
    }
  }
  
  async function persistSharedProviderQuota(cfg) {
    const p = memory.provider || {};
    if (!completeProviderQuotaSnapshot(p)) return;
    await setCache(PROVIDER_QUOTA_SHARED_CACHE_KEY, 0, {
      provider: 'api-football',
      plan: String(p.plan),
      dailyLimit: Number(p.dailyLimit),
      dailyRemaining: Number(p.dailyRemaining),
      minuteLimit: Number(p.minuteLimit),
      minuteRemaining: Number(p.minuteRemaining),
      updatedAt: p.updatedAt || new Date().toISOString(),
    }, cfg, 30);
  }
  
  async function persistSharedProviderCooldown(cfg, retryAfter, reason = 'rate_limit') {
    phase5ProviderUsage(cfg,'sharedCooldowns',1);
    const seconds = Math.max(1, Number(retryAfter || 60));
    const cooldownUntil = new Date(Date.now() + seconds * 1000).toISOString();
    memory.provider.cooldownUntil = cooldownUntil;
    memory.provider.lastError = reason || 'rate_limit';
    await setCache(PROVIDER_COOLDOWN_SHARED_CACHE_KEY, 0, {
      provider: 'api-football',
      cooldownUntil,
      reason: String(reason || 'rate_limit').slice(0, 80),
      updatedAt: new Date().toISOString(),
    }, cfg, Math.max(1 / 6, seconds / 60));
  }
  
  function providerQuotaEvidence(cfg) {
    const p=memory.provider || {};
    const raw=[p.dailyLimit,p.dailyRemaining,p.minuteLimit,p.minuteRemaining];
    if (raw.some(value=>value===null || value===undefined || value==='')) return;
    const values=raw.map(Number);
    if (String(p.plan || 'UNKNOWN')==='UNKNOWN' || !values.every(Number.isFinite)) return;
    const now=Date.now();
    if (now-Number(memory.providerQuotaEvidenceAt || 0)<10*60_000) return;
    memory.providerQuotaEvidenceAt=now;
    void recordOpsEvent(cfg,{
      severity:'info',
      source:'provider',
      eventType:'quota_probe',
      code:'PROVIDER_QUOTA_CONFIRMED',
      message:'API-Football quota confirmed from real provider response headers.',
      endpoint:'api-football',
      meta:{
        plan:String(p.plan),
        dailyLimit:Number(p.dailyLimit),
        dailyRemaining:Number(p.dailyRemaining),
        minuteLimit:Number(p.minuteLimit),
        minuteRemaining:Number(p.minuteRemaining),
        evidenceSource:'response_headers',
      },
    }).catch(()=>{ memory.providerQuotaEvidenceAt=0; });
  }
  
  function quotaUsed(limit, remaining) {
    if (limit === null || limit === undefined || remaining === null || remaining === undefined || limit === '' || remaining === '') return null;
    const l = Number(limit), r = Number(remaining);
    return Number.isFinite(l) && Number.isFinite(r) ? Math.max(0, l - r) : null;
  }
  
  function quotaUsedPct(limit, remaining) {
    const l = Number(limit), used = quotaUsed(limit, remaining);
    return Number.isFinite(l) && l > 0 && Number.isFinite(used) ? Math.round((used / l) * 1000) / 10 : null;
  }
  
  function providerSnapshot() {
    const paid = ['PRO','ULTRA','MEGA'].includes(memory.provider?.plan || '');
    const cooldownUntil = memory.provider?.cooldownUntil || null;
    const cooldownActive = Boolean(cooldownUntil && Date.parse(cooldownUntil) > Date.now());
    const dailyUsed = quotaUsed(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
    const minuteUsed = quotaUsed(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
    const dailyUsedPct = quotaUsedPct(memory.provider?.dailyLimit, memory.provider?.dailyRemaining);
    const minuteUsedPct = quotaUsedPct(memory.provider?.minuteLimit, memory.provider?.minuteRemaining);
    let health = 'ok';
    if ((memory.provider?.plan || 'UNKNOWN') === 'UNKNOWN' && !memory.provider?.updatedAt) health = 'waiting';
    else if (cooldownActive || memory.provider?.lastError === 'rate_limit') health = 'critical';
    else if (memory.provider?.lastError || (Number.isFinite(Number(memory.provider?.minuteRemaining)) && Number(memory.provider.minuteRemaining) <= 2) || (Number.isFinite(dailyUsedPct) && dailyUsedPct >= 90)) health = 'warning';
    return {
      visibility: 'admin',
      ...(memory.provider || {}),
      dailyUsed,
      minuteUsed,
      dailyUsedPct,
      minuteUsedPct,
      health,
      liveOddsReady: paid,
      playerStatsReady: paid,
      oddsMovementReady: paid,
      endpointAccessModel: 'all_endpoints_quota_limited',
      cooldownActive,
      cooldownUntil: cooldownActive ? cooldownUntil : null,
    };
  }
  
  function liveRefreshSeconds() {
    const plan = memory.provider?.plan || 'UNKNOWN';
    if (plan === 'MEGA' || plan === 'ULTRA') return 15;
    if (plan === 'PRO') return 30;
    // FREE/UNKNOWN stays intentionally slower so one LIVE user cannot consume
    // most of the provider minute allowance by polling fixture + core features.
    return 90;
  }
  
  function paidQuotaHealthy() {
    const p = memory.provider || {};
    if (!['PRO','ULTRA','MEGA'].includes(p.plan)) return false;
    if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < 50) return false;
    if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < 5) return false;
    return true;
  }
  
  
  const PROVIDER_PLAN_LIMITS = Object.freeze({
    FREE: { daily: 100, minute: 10, second: null, mode: 'economy' },
    PRO: { daily: 7500, minute: 300, second: 5, mode: 'expanded' },
    ULTRA: { daily: 75000, minute: 450, second: 7.5, mode: 'expanded-fast' },
    MEGA: { daily: 150000, minute: 900, second: 15, mode: 'expanded-fast' },
  });
  
  function providerTransitionProfile() {
    const snapshot = providerSnapshot();
    const plan = String(snapshot.plan || 'UNKNOWN').toUpperCase();
    const expected = PROVIDER_PLAN_LIMITS[plan] || null;
    const paid = ['PRO','ULTRA','MEGA'].includes(plan);
    const detected = plan !== 'UNKNOWN';
    const dailyMatchesExpected = expected && Number.isFinite(Number(snapshot.dailyLimit))
      ? Number(snapshot.dailyLimit) === Number(expected.daily)
      : null;
    const minuteMatchesExpected = expected && Number.isFinite(Number(snapshot.minuteLimit))
      ? Number(snapshot.minuteLimit) === Number(expected.minute)
      : null;
    return {
      visibility: 'admin',
      detected,
      plan,
      paid,
      mode: paid ? 'expanded' : plan === 'FREE' ? 'economy' : 'waiting',
      label: paid ? 'Расширенный режим' : plan === 'FREE' ? 'Экономный режим' : 'Ожидаем определение тарифа',
      expected,
      liveRefreshSeconds: liveRefreshSeconds(),
      quotaHealthy: paid ? paidQuotaHealthy() : freeQuotaHealthy(20, 3),
      headersMatchPlan: {
        daily: dailyMatchesExpected,
        minute: minuteMatchesExpected,
      },
      safety: {
        fullCoverageAuditAllowed: Boolean(paid && paidQuotaHealthy()),
        freeAuditGuard: !paid,
        auditMaxCalls: 9,
      },
      note: paid
        ? 'Повышенная квота обнаружена по заголовкам лимитов. Расширенные запросы разрешены защитными правилами приложения.'
        : 'Полная проверка методов API заблокирована на бесплатном тарифе, чтобы не тратить заметную часть дневного лимита.',
    };
  }
  
  
  const PROVIDER_BUDGET_FLOORS = Object.freeze({
    FREE:  { dailyReserve: 20,  minuteReserve: 3,  conserveDailyPct: 25, conserveMinutePct: 35 },
    PRO:   { dailyReserve: 400, minuteReserve: 18, conserveDailyPct: 10, conserveMinutePct: 12 },
    ULTRA: { dailyReserve: 2500, minuteReserve: 30, conserveDailyPct: 8, conserveMinutePct: 10 },
    MEGA:  { dailyReserve: 4000, minuteReserve: 45, conserveDailyPct: 7, conserveMinutePct: 9 },
  });
  
  const PROVIDER_FEATURE_TTLS = Object.freeze({
    events:      { live: 30,  finished: 21600, upcoming: 300 },
    statistics:  { live: 45,  finished: 21600, upcoming: 300 },
    players:     { live: 120, finished: 21600, upcoming: 600 },
    lineups:     { live: 300, finished: 21600, upcoming: 300 },
    injuries:    { live: 1800, finished: 21600, upcoming: 1800 },
    liveOdds:    { live: 30,  finished: 300, upcoming: 120 },
  });
  
  function providerFeatureCounter(feature, type) {
    const root = memory.providerFeatureFetch;
    root[type] = Number(root[type] || 0) + 1;
    root.byFeature ||= {};
    root.byFeature[feature] ||= { api: 0, cache: 0, stale: 0, skipped: 0 };
    root.byFeature[feature][type] = Number(root.byFeature[feature][type] || 0) + 1;
    root.lastUpdatedAt = new Date().toISOString();
  }
  
  function quotaPercentRemaining(remaining, limit) {
    const r = Number(remaining), l = Number(limit);
    if (!Number.isFinite(r) || !Number.isFinite(l) || l <= 0) return null;
    return clamp(r / l * 100, 0, 100);
  }
  
  function providerBudgetProfile() {
    const p = memory.provider || {};
    const plan = String(p.plan || 'UNKNOWN').toUpperCase();
    const floors = PROVIDER_BUDGET_FLOORS[plan] || PROVIDER_BUDGET_FLOORS.FREE;
    const dailyPct = quotaPercentRemaining(p.dailyRemaining, p.dailyLimit);
    const minutePct = quotaPercentRemaining(p.minuteRemaining, p.minuteLimit);
    const dailyRemaining = Number.isFinite(Number(p.dailyRemaining)) ? Number(p.dailyRemaining) : null;
    const minuteRemaining = Number.isFinite(Number(p.minuteRemaining)) ? Number(p.minuteRemaining) : null;
    const cooldown = providerSnapshot().cooldownActive;
    const paid = ['PRO','ULTRA','MEGA'].includes(plan);
    const observedDailyLimit = Number.isFinite(Number(p.dailyLimit)) ? Number(p.dailyLimit) : null;
    const observedMinuteLimit = Number.isFinite(Number(p.minuteLimit)) ? Number(p.minuteLimit) : null;
  
    let mode = paid ? 'expanded' : 'economy';
    if (plan === 'UNKNOWN') mode = 'waiting';
    if (cooldown) mode = 'emergency';
    else if (
      (dailyRemaining !== null && dailyRemaining <= floors.dailyReserve) ||
      (minuteRemaining !== null && minuteRemaining <= floors.minuteReserve)
    ) mode = 'emergency';
    else if (
      (dailyPct !== null && dailyPct <= floors.conserveDailyPct) ||
      (minutePct !== null && minutePct <= floors.conserveMinutePct)
    ) mode = 'conserve';
  
    const proBaseline = PROVIDER_PLAN_LIMITS.PRO;
    const broadTrafficReady = Boolean(
      paid
      && observedDailyLimit !== null
      && observedMinuteLimit !== null
      && observedDailyLimit >= Number(proBaseline.daily || 0)
      && observedMinuteLimit >= Number(proBaseline.minute || 0)
      && mode !== 'emergency'
    );
    const launchCapacity = {
      broadTrafficReady,
      recommendedMode: broadTrafficReady ? 'public' : 'limited_beta',
      blocker: broadTrafficReady
        ? ''
        : plan === 'FREE'
          ? 'provider_free_plan'
          : plan === 'UNKNOWN'
            ? 'provider_quota_unconfirmed'
            : 'provider_capacity_guard',
      observedDailyLimit,
      observedMinuteLimit,
      protectedDailyReserve: Number(floors.dailyReserve || 0),
      usableDailyRemaining: dailyRemaining === null ? null : Math.max(0, dailyRemaining - Number(floors.dailyReserve || 0)),
    };
  
    const label = ({
      waiting: 'Ожидаем квоту',
      economy: 'Экономный режим',
      expanded: 'Расширенный режим',
      conserve: 'Режим экономии',
      emergency: 'Защитный резерв',
    })[mode] || mode;
  
    return {
      visibility: 'admin',
      plan,
      paid,
      mode,
      label,
      daily: {
        limit: Number.isFinite(Number(p.dailyLimit)) ? Number(p.dailyLimit) : null,
        remaining: dailyRemaining,
        remainingPct: dailyPct === null ? null : Math.round(dailyPct * 10) / 10,
        reserve: floors.dailyReserve,
      },
      minute: {
        limit: Number.isFinite(Number(p.minuteLimit)) ? Number(p.minuteLimit) : null,
        remaining: minuteRemaining,
        remainingPct: minutePct === null ? null : Math.round(minutePct * 10) / 10,
        reserve: floors.minuteReserve,
      },
      dailyRemainingPct: dailyPct === null ? null : Math.round(dailyPct * 10) / 10,
      liveRefreshSeconds: mode === 'conserve' ? Math.max(60, liveRefreshSeconds()) : mode === 'emergency' ? 90 : liveRefreshSeconds(),
      launchCapacity,
      counters: {
        api: Number(memory.providerFeatureFetch?.api || 0),
        cache: Number(memory.providerFeatureFetch?.cache || 0),
        stale: Number(memory.providerFeatureFetch?.stale || 0),
        skipped: Number(memory.providerFeatureFetch?.skipped || 0),
        fixtureDateReuses: Number(memory.telemetry?.providerFixtureDateReuses || 0),
        teamFixtureReuses: Number(memory.telemetry?.providerTeamFixtureReuses || 0),
        byFeature: memory.providerFeatureFetch?.byFeature || {},
        lastUpdatedAt: memory.providerFeatureFetch?.lastUpdatedAt || null,
      },
      note: mode === 'emergency'
        ? 'Защитный резерв активен: новые запросы ограничиваются, а приложение переходит на сохранённые данные.'
        : mode === 'conserve'
          ? 'Часть дополнительных запросов замедлена или пропускается, чтобы сохранить резерв.'
          : broadTrafficReady
            ? 'Квота подходит для публичного трафика по текущему техническому порогу; кэш и защитные лимиты остаются активны.'
            : plan === 'FREE'
              ? 'FREE-квота подходит только для ограниченной beta. Широкое продвижение не запускайте до повышения лимита.'
              : 'Ёмкость источника ещё не подтверждена для широкого публичного трафика.',
    };
  }
  
  function providerPublicBudgetMode() {
    const budget = providerBudgetProfile();
    return {
      mode: budget.mode,
      label: budget.mode === 'expanded'
        ? 'Расширенное покрытие'
        : budget.mode === 'conserve'
          ? 'Сберегающий режим'
          : budget.mode === 'emergency'
            ? 'Ограниченное обновление'
            : 'Стандартное покрытие',
      liveRefreshSeconds: budget.liveRefreshSeconds,
    };
  }
  
  function providerFeaturePolicy(feature, context = {}) {
    const budget = providerBudgetProfile();
    const runtime = runtimeControlsSnapshot();
    const mode = context.mode || 'live';
    const paid = budget.paid;
    const limitedCoverage = Boolean(context.limitedCoverage);
    const featureTtl = PROVIDER_FEATURE_TTLS[feature] || { live: 60, finished: 3600, upcoming: 300 };
    let ttlSeconds = Number(featureTtl[mode] || featureTtl.live || 60);
    let allowed = true;
    let reason = '';
  
    if (limitedCoverage && ['events','statistics','players','lineups','injuries','liveOdds'].includes(feature)) {
      allowed = false;
      reason = 'limited_coverage';
    }
  
    if (runtime.expandedDataEnabled === false && ['players','lineups','injuries','liveOdds'].includes(feature)) {
      allowed = false;
      reason = 'runtime_disabled';
    }
  
    if (runtime.liveEnabled === false && feature === 'liveOdds') {
      allowed = false;
      reason = 'live_disabled';
    }
  
    if (['players','lineups','injuries','liveOdds'].includes(feature) && !paid) {
      allowed = false;
      reason = 'economy_plan';
    }
  
    // Core LIVE data remains available on FREE, but its shared cache outlives
    // one UI poll so multiple beta users reuse the same events/statistics snapshot.
    if (!paid && mode === 'live' && ['events','statistics'].includes(feature)) {
      ttlSeconds = Math.max(ttlSeconds, 180);
    }
  
    // On the 10 req/min FREE plan, the interactive Match Center must not consume
    // the request that AI Analysis needs for predictions/odds. Events can fall back
    // to OpenLigaDB; API-Football statistics remain the primary LIVE enrichment.
    if (!paid && context.preserveAiBudget === true && feature === 'events') {
      allowed = false;
      reason = 'interactive_ai_reserve';
    }
  
    if (budget.mode === 'emergency' && !['events','statistics'].includes(feature)) {
      allowed = false;
      reason = 'quota_reserve';
    }
  
    if (budget.mode === 'conserve') {
      ttlSeconds = Math.max(ttlSeconds, feature === 'events' ? 45 : feature === 'statistics' ? 75 : 300);
      if (['players','injuries','liveOdds'].includes(feature)) {
        allowed = false;
        reason = 'conserve_mode';
      }
    }
  
    if (mode === 'finished') ttlSeconds = Math.max(ttlSeconds, 21600);
    if (mode === 'upcoming' && feature === 'liveOdds') {
      allowed = false;
      reason = 'not_live';
    }
  
    return {
      feature,
      allowed,
      reason,
      ttlSeconds,
      budgetMode: budget.mode,
      priority: ['events','statistics'].includes(feature) ? 'core' : ['lineups','players'].includes(feature) ? 'enhanced' : 'optional',
    };
  }
  
  function featureCacheAgeSeconds(payload) {
    const t = Date.parse(payload?.fetchedAt || '');
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 1000)) : null;
  }

  return {
    PROVIDER_PLAN_LIMITS,
    PROVIDER_BUDGET_FLOORS,
    PROVIDER_FEATURE_TTLS,
    inferFootballPlan,
    updateProviderFromHeaders,
    completeProviderQuotaSnapshot,
    loadSharedProviderState,
    persistSharedProviderQuota,
    persistSharedProviderCooldown,
    providerQuotaEvidence,
    quotaUsed,
    quotaUsedPct,
    providerSnapshot,
    liveRefreshSeconds,
    paidQuotaHealthy,
    providerTransitionProfile,
    providerFeatureCounter,
    quotaPercentRemaining,
    providerBudgetProfile,
    providerPublicBudgetMode,
    providerFeaturePolicy,
    featureCacheAgeSeconds,
  };
}
