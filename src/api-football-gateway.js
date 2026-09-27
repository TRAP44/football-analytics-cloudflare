// Phase 2 API-Football gateway boundary.
// Owns API-Football transport, provider cooldown/quota protection and bounded retry semantics.
// Provider state, telemetry, persistence and network primitives remain injected by the composition root.
export function createApiFootballGateway({
  memory,
  providerPlanLimits,
  providerBudgetFloors,
  hasSupabase,
  supaRpc,
  bumpTelemetry,
  recordOpsEvent,
  loadSharedProviderState,
  phase5ProviderUsage,
  persistSharedProviderCooldown,
  fetchWithTimeout,
  updateProviderFromHeaders,
  persistSharedProviderQuota,
  providerQuotaEvidence,
  providerSnapshot,
  withSingleFlight,
  sleepMs,
}) {
  function footballError(message, code = 'FOOTBALL_API', retryAfter = 0) {
    const error = new Error(message);
    error.code = code;
    error.retryAfter = Math.max(0, Number(retryAfter || 0));
    return error;
  }

  function isFootballRateLimitError(error) {
    return ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN'].includes(String(error?.code || ''))
      || /too many requests|rate.?limit|requests per minute|лимит запросов/i.test(String(error?.message || ''));
  }

  function footballCooldownRemaining() {
    const until = Date.parse(memory.provider?.cooldownUntil || '');
    return Number.isFinite(until) ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0;
  }

  function freeQuotaHealthy(minDaily = 25, minMinute = 5) {
    const p = memory.provider || {};
    if (['PRO','ULTRA','MEGA'].includes(p.plan)) return true;
    if (Number.isFinite(Number(p.dailyRemaining)) && Number(p.dailyRemaining) < minDaily) return false;
    if (Number.isFinite(Number(p.minuteRemaining)) && Number(p.minuteRemaining) < minMinute) return false;
    return !providerSnapshot().cooldownActive;
  }

  function distributedProviderMinuteLimit() {
    const plan=String(memory.provider?.plan || 'UNKNOWN').toUpperCase();
    const expected=providerPlanLimits[plan]?.minute || Number(memory.provider?.minuteLimit) || providerPlanLimits.FREE.minute;
    const floors=providerBudgetFloors[plan] || providerBudgetFloors.FREE;
    const rawBudget=Math.max(1, Math.floor(Number(expected) - Number(floors.minuteReserve || 1)));
    // The Supabase guard uses aligned fixed-minute buckets. On FREE/UNKNOWN,
    // halve the usable budget so a burst straddling a minute boundary still
    // remains below the provider's 10/min ceiling.
    if (plan === 'FREE' || plan === 'UNKNOWN') return Math.max(1, Math.floor(rawBudget / 2));
    return rawBudget;
  }

  async function claimDistributedProviderBudget(cfg) {
    if (!hasSupabase(cfg)) return {allowed:true,degraded:true,reason:'supabase_not_configured'};
    const limit=distributedProviderMinuteLimit();
    try {
      const result=await supaRpc(cfg,'claim_provider_request',{
        p_bucket_key:'api-football:minute',
        p_limit:limit,
        p_window_seconds:60,
      },2500);
      if (!result?.allowed) bumpTelemetry('providerDistributedBlocks');
      return {allowed:Boolean(result?.allowed),limit,retryAfter:Number(result?.retryAfter || 0),count:Number(result?.count || 0),degraded:false};
    } catch (error) {
      bumpTelemetry('providerDistributedFallbacks');
      await recordOpsEvent(cfg,{
        severity:'warning',source:'provider',eventType:'distributed_rate_guard',code:'PROVIDER_RATE_GUARD_DEGRADED',
        message:error?.message || error,endpoint:'api-football',
      }).catch(()=>null);
      return {allowed:true,limit,degraded:true,reason:'guard_unavailable'};
    }
  }

  async function apiFootballNetwork(path, params, cfg, options = {}) {
    if (!cfg.apiFootballKey) {
      await recordOpsEvent(cfg, { severity: 'critical', source: 'provider', eventType: 'configuration', code: 'FOOTBALL_CONFIG', message: 'Ключ API-Football отсутствует.' });
      throw footballError('Ключ API-Football не настроен в Cloudflare.', 'FOOTBALL_CONFIG');
    }

    await loadSharedProviderState(cfg);
    const cooldown = footballCooldownRemaining();
    if (cooldown > 0) {
      bumpTelemetry('quotaBlocks');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      throw footballError(`API-Football на паузе после ограничения. Повторите примерно через ${cooldown} сек.`, 'FOOTBALL_COOLDOWN', cooldown);
    }
    if (Number(memory.provider?.minuteRemaining) === 0 && memory.provider?.updatedAt) {
      const ageSec = Math.max(0, Math.floor((Date.now() - Date.parse(memory.provider.updatedAt)) / 1000));
      const waitSec = Math.max(1, 60 - ageSec);
      if (waitSec > 0 && ageSec < 60) {
        await persistSharedProviderCooldown(cfg, waitSec, 'minute_remaining_zero').catch(() => null);
        bumpTelemetry('quotaBlocks');
        phase5ProviderUsage(cfg,'quotaBlocks',1);
        throw footballError(`Минутная квота API-Football исчерпана. Повторите примерно через ${waitSec} сек.`, 'FOOTBALL_COOLDOWN', waitSec);
      }
    }

    const distributedBudget=await claimDistributedProviderBudget(cfg);
    if (!distributedBudget.allowed) {
      const retryAfter=Math.max(1,Number(distributedBudget.retryAfter || 60));
      await persistSharedProviderCooldown(cfg, retryAfter, 'distributed_rate_guard').catch(() => null);
      bumpTelemetry('quotaBlocks');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      throw footballError(`Глобальная минутная квота API-Football защищена. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_COOLDOWN', retryAfter);
    }

    const url = new URL(`https://v3.football.api-sports.io${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    const startedAt = Date.now();
    bumpTelemetry('apiRequests');
    phase5ProviderUsage(cfg,'networkRequests',1);
    memory.provider.lastRequestAt = new Date(startedAt).toISOString();
    let r;
    try {
      r = await fetchWithTimeout(url, {
        headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
      }, Number(options.timeoutMs || 10000), 'API-Football');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      bumpTelemetry('apiErrors');
      memory.provider.lastStatus = null;
      memory.provider.lastLatencyMs = durationMs;
      memory.provider.lastError = 'network_error';
      await recordOpsEvent(cfg, {
        severity: 'error', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_NETWORK',
        message: error?.message || 'Network error', endpoint: path, durationMs,
      });
      throw footballError('Не удалось подключиться к API-Football.', 'FOOTBALL_NETWORK');
    }

    const durationMs = Date.now() - startedAt;
    updateProviderFromHeaders(r);
    await persistSharedProviderQuota(cfg).catch(() => null);
    providerQuotaEvidence(cfg);
    memory.provider.lastStatus = r.status;
    memory.provider.lastLatencyMs = durationMs;
    const body = await r.json().catch(() => ({}));

    if (r.status === 429) {
      const retryHeader = Number(r.headers.get('retry-after') || 0);
      const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 65;
      await persistSharedProviderCooldown(cfg, retryAfter, 'rate_limit').catch(() => null);
      memory.provider.lastError = 'rate_limit';
      bumpTelemetry('apiErrors');
      bumpTelemetry('rateLimits');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      await recordOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT',
        message: `API-Football HTTP 429; retry ${retryAfter}s`, endpoint: path, status: r.status, durationMs,
        meta: { retryAfter, plan: memory.provider?.plan || 'UNKNOWN', minuteRemaining: memory.provider?.minuteRemaining, dailyRemaining: memory.provider?.dailyRemaining },
      });
      throw footballError(`API-Football достиг минутного лимита. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_RATE_LIMIT', retryAfter);
    }
    if (!r.ok) {
      memory.provider.lastError = `http_${r.status}`;
      bumpTelemetry('apiErrors');
      await recordOpsEvent(cfg, {
        severity: r.status >= 500 ? 'error' : 'warning', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_HTTP',
        message: `API-Football HTTP ${r.status}`, endpoint: path, status: r.status, durationMs,
      });
      throw footballError(`API-Football временно недоступен (HTTP ${r.status}).`, 'FOOTBALL_HTTP');
    }

    const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
    if (errors.length) {
      const message = errors.join('; ');
      memory.provider.lastError = message.slice(0, 160);
      bumpTelemetry('apiErrors');
      if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
        await persistSharedProviderCooldown(cfg, 65, 'rate_limit_body').catch(() => null);
        bumpTelemetry('rateLimits');
        phase5ProviderUsage(cfg,'quotaBlocks',1);
        await recordOpsEvent(cfg, {
          severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT_BODY',
          message, endpoint: path, status: r.status, durationMs,
          meta:{
            retryAfter:65,
            plan:memory.provider?.plan || 'UNKNOWN',
            dailyLimit:memory.provider?.dailyLimit,
            dailyRemaining:memory.provider?.dailyRemaining,
            minuteLimit:memory.provider?.minuteLimit,
            minuteRemaining:memory.provider?.minuteRemaining,
          },
        });
        throw footballError('API-Football достиг лимита запросов. Покажем сохранённые данные, если они есть.', 'FOOTBALL_RATE_LIMIT', 65);
      }
      await recordOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'api_response', code: 'FOOTBALL_RESPONSE',
        message, endpoint: path, status: r.status, durationMs,
      });
      throw footballError(`API-Football: ${message}`, 'FOOTBALL_RESPONSE');
    }

    memory.provider.lastError = '';
    memory.provider.lastSuccessAt = new Date().toISOString();
    bumpTelemetry('apiSuccess');
    if (options.responseType === 'envelope') {
      return {
        response: Array.isArray(body.response) ? body.response : [],
        paging: {
          current: Math.max(1, Number(body?.paging?.current || 1) || 1),
          total: Math.max(1, Number(body?.paging?.total || 1) || 1),
        },
      };
    }
    if (options.responseType === 'any') return body.response ?? null;
    return Array.isArray(body.response) ? body.response : [];
  }

  function providerRequestKey(path, params, options = {}) {
    const pairs = Object.entries(params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    return `football:${path}?${pairs}:type=${options.responseType || 'array'}`;
  }

  function isRetryableFootballTransportError(error) {
    return String(error?.code || '') === 'FOOTBALL_NETWORK';
  }

  async function apiFootball(path, params, cfg, options = {}) {
    return await withSingleFlight(
      providerRequestKey(path, params, options),
      async () => {
        const retries = Math.max(0, Math.min(1, Number(options.transportRetries ?? 1)));
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          try {
            return await apiFootballNetwork(path, params, cfg, options);
          } catch (error) {
            lastError = error;
            if (attempt >= retries || !isRetryableFootballTransportError(error)) throw error;
            await sleepMs(180 * (attempt + 1));
          }
        }
        throw lastError;
      },
    );
  }

  return {
    footballError,
    isFootballRateLimitError,
    footballCooldownRemaining,
    freeQuotaHealthy,
    distributedProviderMinuteLimit,
    claimDistributedProviderBudget,
    apiFootballNetwork,
    providerRequestKey,
    isRetryableFootballTransportError,
    apiFootball,
  };
}
