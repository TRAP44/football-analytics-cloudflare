export function createCommonInfrastructureRuntime(deps = {}) {
  const {
    API_CONTRACT_VERSION,
    APP_VERSION,
    BILLING_PLANS,
    MIN_CLIENT_VERSION,
    RC_NAME,
    RELEASE_CHANNEL,
    bumpTelemetry,
    createAppCapabilitiesRuntime,
    isSecurityLockdownControls,
    memory,
    paidQuotaHealthy,
    providerPublicBudgetMode,
    publicRuntimeControls,
    runtimeControlsSnapshot,
    runtimeReleaseIdentity,
    telegramIdList
  } = deps;

  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }
  
  function boolEnv(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return String(value).toLowerCase() === 'true';
  }
  
  function boolEnvState(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return 'missing';
    if (raw === 'true' || raw === 'false') return raw;
    return 'invalid';
  }
  
  function intEnv(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : fallback;
  }
  
  function config(env) {
    return {
      devMode: boolEnv(env.DEV_MODE, false),
      apiFootballKey: env.API_FOOTBALL_KEY || '',
      footballDataToken: env.FOOTBALL_DATA_TOKEN || '',
      theOddsApiKey: env.THE_ODDS_API_KEY || '',
      tavilyKey: env.TAVILY_KEY || '',
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      publisherBotToken: env.TELEGRAM_PUBLISHER_BOT_TOKEN || '',
      telegramChannelId: env.TELEGRAM_CHANNEL_ID || '',
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
      adminTelegramIds: telegramIdList(env.ADMIN_TELEGRAM_IDS),
      betaTelegramIds: telegramIdList(env.BETA_TELEGRAM_IDS),
      // Public normal-user access is the default. Strict closed beta is an
      // explicit temporary mode enabled only by BETA_ACCESS_ENABLED=true.
      betaAccessConfigured: boolEnvState(env.BETA_ACCESS_ENABLED),
      betaAccessEnabled: boolEnv(env.BETA_ACCESS_ENABLED, false),
      supabaseUrl: String(env.SUPABASE_URL || '').replace(/\/$/, ''),
      supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
      cfVersionMetadata: env.CF_VERSION_METADATA || null,
      cacheMinutes: intEnv(env.CACHE_MINUTES, 20),
      liveOddsEnabled: boolEnv(env.ENABLE_LIVE_ODDS, true),
      // Монетизацию сознательно держим выключенной до финального этапа проекта.
      // Старый webhook может оставаться настроенным: pre-checkout будет отклонён,
      // а UI оплаты не показывается, пока флаг не включён явно.
      monetizationEnabled: boolEnv(env.MONETIZATION_ENABLED, false),
      opsRetentionDays: intEnv(env.OPS_RETENTION_DAYS, 14),
      growthRetentionDays: intEnv(env.GROWTH_RETENTION_DAYS, 90),
      limits: {
        FREE: intEnv(env.FREE_DAILY_LIMIT, 3),
        PRO: intEnv(env.PRO_DAILY_LIMIT, 20),
        PREMIUM: intEnv(env.PREMIUM_DAILY_LIMIT, 100),
      },
      starsPrices: {
        PRO: intEnv(env.PRO_STARS_PRICE, BILLING_PLANS.PRO.stars),
        PREMIUM: intEnv(env.PREMIUM_STARS_PRICE, BILLING_PLANS.PREMIUM.stars),
      },
      passPrices: {
        MATCH_PASS: intEnv(env.MATCH_PASS_STARS_PRICE, 39),
        DAY_PASS: intEnv(env.DAY_PASS_STARS_PRICE, 89),
        WEEKEND_PASS: intEnv(env.WEEKEND_PASS_STARS_PRICE, 149),
      },
      passDurations: {
        MATCH_PASS: intEnv(env.MATCH_PASS_DURATION_HOURS, 72),
        DAY_PASS: intEnv(env.DAY_PASS_DURATION_HOURS, 24),
        WEEKEND_PASS: intEnv(env.WEEKEND_PASS_DURATION_HOURS, 168),
      },
      passUsageLimits: {
        WEEKEND_PASS: intEnv(env.WEEKEND_PASS_USAGE_LIMIT, 0) || null,
      },
    };
  }
  
  function currentReleaseIdentity(cfg = {}) {
    return runtimeReleaseIdentity(cfg?.cfVersionMetadata,{
      appVersion:APP_VERSION,
      releaseCandidate:RC_NAME,
    });
  }
  
  let appCapabilitiesRuntime=null;
  
  function getAppCapabilitiesRuntime() {
    if (!appCapabilitiesRuntime) {
      appCapabilitiesRuntime=createAppCapabilitiesRuntime({
        memory,
        appVersion:APP_VERSION,
        minClientVersion:MIN_CLIENT_VERSION,
        apiContractVersion:API_CONTRACT_VERSION,
        releaseChannel:RELEASE_CHANNEL,
        releaseCandidate:RC_NAME,
        paidQuotaHealthy,
        providerPublicBudgetMode,
        runtimeControlsSnapshot,
        isSecurityLockdownControls,
        publicRuntimeControls,
        currentReleaseIdentity,
      });
    }
    return appCapabilitiesRuntime;
  }
  
  function publicDataCapabilities() {
    return getAppCapabilitiesRuntime().publicDataCapabilities();
  }
  
  function appManifest(cfg) {
    return getAppCapabilitiesRuntime().appManifest(cfg);
  }
  
  function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }
  
  async function fetchWithTimeout(input, init = {}, timeoutMs = 8000, source = 'upstream') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), Math.max(500, Number(timeoutMs || 8000)));
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') {
        bumpTelemetry('upstreamTimeouts');
        const timeoutError = new Error(`${source} timeout после ${Math.max(500, Number(timeoutMs || 8000))} мс`);
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        timeoutError.source = source;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  
  async function withSingleFlight(key, factory, options = {}) {
    const normalized = String(key || '');
    if (!normalized) return await factory();
    const existing = memory.inflight.get(normalized);
    if (existing) {
      if (options.countTelemetry !== false) bumpTelemetry('singleflightJoins');
      return await existing;
    }
    const task = Promise.resolve().then(factory);
    memory.inflight.set(normalized, task);
    try {
      return await task;
    } finally {
      if (memory.inflight.get(normalized) === task) memory.inflight.delete(normalized);
    }
  }
  
  function pruneMemoryState() {
    let pruned = 0;
    const now = Date.now();
  
    if (memory.cache.size > 600) {
      for (const [key, value] of memory.cache) {
        if (Number(value?.expiresAt || 0) <= now && memory.cache.size > 450) {
          memory.cache.delete(key);
          pruned++;
        }
      }
      while (memory.cache.size > 500) {
        const first = memory.cache.keys().next().value;
        if (first === undefined) break;
        memory.cache.delete(first);
        pruned++;
      }
    }
  
    if (memory.userSyncAt.size > 1500) {
      for (const [key, at] of memory.userSyncAt) {
        if (now - Number(at || 0) > 60 * 60 * 1000) {
          memory.userSyncAt.delete(key);
          pruned++;
        }
      }
    }
  
    if (memory.routeBurst.size > 2500) {
      for (const [key, bucket] of memory.routeBurst) {
        if (now - Number(bucket?.startedAt || 0) > 5 * 60 * 1000) {
          memory.routeBurst.delete(key);
          pruned++;
        }
      }
    }
  
    if (memory.telegramBurst.size > 2500) {
      for (const [key, bucket] of memory.telegramBurst) {
        if (now - Number(bucket?.startedAt || 0) > 5 * 60 * 1000) {
          memory.telegramBurst.delete(key);
          pruned++;
        }
      }
    }
  
    if (memory.telegramUpdateDedupe.size > 4000) {
      for (const [key, value] of memory.telegramUpdateDedupe) {
        if (now - Number(value?.at || 0) > 10 * 60 * 1000) {
          memory.telegramUpdateDedupe.delete(key);
          pruned++;
        }
      }
    }
  
    if (memory.clientTelemetryDedupe.size > 1500) {
      for (const [key, at] of memory.clientTelemetryDedupe) {
        if (now - Number(at || 0) > 30 * 60 * 1000) {
          memory.clientTelemetryDedupe.delete(key);
          pruned++;
        }
      }
    }
  
    if (pruned) bumpTelemetry('memoryPrunes', pruned);
    return pruned;
  }

  return {
    todayUtc,
    boolEnv,
    boolEnvState,
    intEnv,
    config,
    currentReleaseIdentity,
    getAppCapabilitiesRuntime,
    publicDataCapabilities,
    appManifest,
    sleepMs,
    fetchWithTimeout,
    withSingleFlight,
    pruneMemoryState
  };
}
