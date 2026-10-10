// Phase 2 API-Football gateway boundary.
// Owns API-Football transport, provider cooldown/quota protection and bounded retry semantics.
// Provider state, telemetry, persistence and network primitives remain injected by the composition root.
const RETRYABLE_FOOTBALL_HTTP_STATUSES = new Set([500, 502, 503, 504]);
export function createApiFootballGateway({
  memory,
  providerPlanLimits,
  providerBudgetFloors,
  hasSupabase,
  supaRpc,
  bumpTelemetry,
  observeProviderRequest = () => {},
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
  async function observe(cfg, event) {
    try {
      await Promise.resolve(observeProviderRequest(event, cfg));
    } catch {
      // Provider observability is best-effort and must never break data delivery.
    }
  }

  async function emitOpsEvent(cfg, event) {
    if (typeof recordOpsEvent !== 'function') return;
    try {
      await Promise.resolve(recordOpsEvent(cfg, event));
    } catch {
      // Operational logging is best-effort and must not mask provider behavior.
    }
  }

  function footballError(message, code = 'FOOTBALL_API', retryAfter = 0, status = null) {
    const error = new Error(message);
    error.code = code;
    const retrySeconds = Number(retryAfter);
    error.retryAfter = Number.isFinite(retrySeconds) ? Math.max(0, retrySeconds) : 0;
    if (Number.isFinite(Number(status)) && Number(status) > 0) error.status = Number(status);
    return error;
  }

  function retryAfterSeconds(headers, fallbackSeconds = 65) {
    const raw = String(headers?.get?.('retry-after') || '').trim();
    const parsedFallback = Number(fallbackSeconds);
    const fallback = Number.isFinite(parsedFallback) ? Math.max(1, Math.ceil(parsedFallback)) : 65;
    if (!raw) return fallback;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.max(1, Math.ceil(numeric));
    const retryAt = Date.parse(raw);
    if (Number.isFinite(retryAt)) return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    return fallback;
  }

  function positivePagingInteger(value, fallback = 1) {
    const number=Number(value);
    return Number.isSafeInteger(number) && number>0 && number<=10000
      ? number
      : fallback;
  }

  function isFootballRateLimitError(error) {
    return ['FOOTBALL_RATE_LIMIT', 'FOOTBALL_COOLDOWN', 'FOOTBALL_DAILY_RESERVE'].includes(String(error?.code || ''))
      || /too many requests|rate.?limit|requests per minute|лимит запросов|дневной резерв/i.test(String(error?.message || ''));
  }

  function isRetryableFootballHttpStatus(status) {
    return RETRYABLE_FOOTBALL_HTTP_STATUSES.has(Number(status));
  }

  function secondsUntilUtcDayReset(nowMs = Date.now()) {
    const now = new Date(nowMs);
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1, 0);
    return Math.max(60, Math.ceil((next - nowMs) / 1000));
  }

  function dailyReserveDecision(options = {}) {
    const p = memory.provider || {};
    const plan = String(p.plan || 'UNKNOWN').toUpperCase();
    if (options.allowDailyReserve === true || plan !== 'FREE') {
      return { blocked:false, plan, remaining:null, reserve:null, retryAfter:0 };
    }
    const remaining = Number(p.dailyRemaining);
    const updatedAtMs = Date.parse(p.updatedAt || '');
    const updatedToday = Number.isFinite(updatedAtMs)
      && new Date(updatedAtMs).toISOString().slice(0,10) === new Date().toISOString().slice(0,10);
    const reserve = Math.max(1, Number(providerBudgetFloors.FREE?.dailyReserve || 20));
    // The FREE reserve guard may only act on recent evidence. A stale FREE snapshot
    // (for example from before a plan upgrade) must not block the very request that
    // would refresh the plan from the provider response headers.
    const evidenceFresh = Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= 30 * 60_000;
    const blocked = updatedToday && evidenceFresh && (!Number.isFinite(remaining) || remaining <= reserve);
    return {
      blocked,
      plan,
      remaining:Number.isFinite(remaining) ? remaining : null,
      reserve,
      retryAfter:blocked ? secondsUntilUtcDayReset() : 0,
    };
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

  function emergencyProviderMinuteLimit() {
    const plan=String(memory.provider?.plan || 'UNKNOWN').toUpperCase();
    return ['PRO','ULTRA','MEGA'].includes(plan) ? 8 : 2;
  }

  function claimEmergencyLocalProviderBudget(reason = 'guard_unavailable') {
    const now=Date.now();
    const windowMs=60_000;
    const limit=emergencyProviderMinuteLimit();
    let state=memory.providerEmergencyBudget;
    if (!state || !Number.isFinite(Number(state.windowStartedAt)) || now-Number(state.windowStartedAt)>=windowMs) {
      state={windowStartedAt:now,count:0};
    }

    if (Number(state.count || 0)>=limit) {
      memory.providerEmergencyBudget=state;
      bumpTelemetry('providerDistributedBlocks');
      return {
        allowed:false,
        degraded:true,
        local:true,
        reason,
        count:Number(state.count || 0),
        limit,
        retryAfter:Math.max(1,Math.ceil((Number(state.windowStartedAt)+windowMs-now)/1000)),
      };
    }

    state.count=Number(state.count || 0)+1;
    memory.providerEmergencyBudget=state;
    return {
      allowed:true,
      degraded:true,
      local:true,
      reason,
      count:state.count,
      limit,
      retryAfter:0,
    };
  }

  async function claimDistributedProviderBudget(cfg) {
    let persistentGuardAvailable=false;
    try {
      persistentGuardAvailable=hasSupabase(cfg) === true;
    } catch (error) {
      bumpTelemetry('providerDistributedFallbacks');
      bumpTelemetry('providerDistributedBlocks');
      await emitOpsEvent(cfg,{
        severity:'warning',source:'provider',eventType:'distributed_rate_guard',code:'PROVIDER_RATE_GUARD_DEGRADED',
        message:error?.message || error,endpoint:'api-football',
        meta:{disposition:'fail_closed',providerCallAllowed:false,reason:'supabase_probe_failed'},
      });
      return {
        allowed:false,
        degraded:true,
        local:false,
        reason:'guard_unavailable',
        count:0,
        limit:distributedProviderMinuteLimit(),
        retryAfter:15,
      };
    }
    if (!persistentGuardAvailable) {
      bumpTelemetry('providerDistributedFallbacks');
      return claimEmergencyLocalProviderBudget('supabase_not_configured');
    }
    const limit=distributedProviderMinuteLimit();
    try {
      const result=await supaRpc(cfg,'claim_provider_request',{
        p_bucket_key:'api-football:minute',
        p_limit:limit,
        p_window_seconds:60,
      },2500);
      if (result?.allowed !== true && result?.allowed !== false) {
        throw new Error('Distributed provider guard returned an invalid allowed flag.');
      }
      const rawRetryAfter=Number(result?.retryAfter);
      const rawCount=Number(result?.count);
      const retryAfter=Number.isFinite(rawRetryAfter)
        ? Math.max(0,Math.min(60,Math.ceil(rawRetryAfter)))
        : 0;
      const count=Number.isSafeInteger(rawCount) && rawCount>=0 ? rawCount : 0;
      if (result.allowed === false) bumpTelemetry('providerDistributedBlocks');
      return {allowed:result.allowed,limit,retryAfter,count,degraded:false};
    } catch (error) {
      bumpTelemetry('providerDistributedFallbacks');
      bumpTelemetry('providerDistributedBlocks');
      await emitOpsEvent(cfg,{
        severity:'warning',source:'provider',eventType:'distributed_rate_guard',code:'PROVIDER_RATE_GUARD_DEGRADED',
        message:error?.message || error,endpoint:'api-football',
        meta:{disposition:'fail_closed',providerCallAllowed:false},
      });
      return {
        allowed:false,
        degraded:true,
        local:false,
        reason:'guard_unavailable',
        count:0,
        limit,
        retryAfter:15,
      };
    }
  }

  // API-Football also enforces a per-second rate (PRO: 5/s) on top of the per-minute quota,
  // and rejects the excess of a burst with "Too many requests" even when the minute quota is nearly full.
  // Requests are therefore paced per isolate, and burst rejections are retried briefly instead of
  // triggering a minute-long cooldown.
  const PROVIDER_PACE_GAP_MS = { FREE: 0, UNKNOWN: 300, PRO: 240, ULTRA: 160, MEGA: 75 };
  const PROVIDER_PACE_MAX_WAIT_MS = 6000;
  const BURST_RETRY_DELAY_MS = 1500;

  function providerPaceGapMs() {
    const plan = String(memory.provider?.plan || 'UNKNOWN').toUpperCase();
    const gap = PROVIDER_PACE_GAP_MS[plan];
    return Number.isFinite(gap) ? gap : PROVIDER_PACE_GAP_MS.UNKNOWN;
  }

  async function paceProviderRequest() {
    const now = Date.now();
    const start = Math.max(now, Number(memory.providerPaceNextAt) || 0);
    const wait = start - now;
    if (wait > PROVIDER_PACE_MAX_WAIT_MS) {
      bumpTelemetry('quotaBlocks');
      throw footballError(
        `Очередь запросов к API-Football переполнена. Повторите примерно через ${Math.ceil(wait / 1000)} сек.`,
        'FOOTBALL_COOLDOWN',
        Math.max(1, Math.ceil(wait / 1000)),
      );
    }
    const gap = providerPaceGapMs();
    if (gap <= 0) return; // FREE is already limited by the distributed per-minute guard.
    memory.providerPaceNextAt = start + gap;
    if (wait > 0) await sleepMs(wait);
  }

  function noteProviderSend() {
    const now = Date.now();
    const log = Array.isArray(memory.providerSendLog) ? memory.providerSendLog : [];
    log.push(now);
    memory.providerSendLog = log.filter(at => now - at <= 60_000);
  }

  function recentProviderSends() {
    const now = Date.now();
    return Array.isArray(memory.providerSendLog) ? memory.providerSendLog.filter(at => now - at <= 60_000).length : 0;
  }

  // A rejection is a per-second burst (not an exhausted minute quota) when the minute quota is evidently not used up.
  function looksLikeBurstRejection() {
    const plan = String(memory.provider?.plan || 'UNKNOWN').toUpperCase();
    if (plan === 'FREE') return false;
    if (['PRO', 'ULTRA', 'MEGA'].includes(plan)) {
      const left = Number(memory.provider?.minuteRemaining);
      return !Number.isFinite(left) || left > 5;
    }
    return recentProviderSends() <= 6;
  }

  function burstRejection(message, status) {
    // Slow every following request of this isolate down for a moment instead of a shared minute cooldown.
    memory.providerPaceNextAt = Math.max(Number(memory.providerPaceNextAt) || 0, Date.now() + BURST_RETRY_DELAY_MS);
    const error = footballError(message, 'FOOTBALL_RATE_LIMIT', 2, status);
    error.burst = true;
    return error;
  }

  async function apiFootballNetwork(path, params, cfg, options = {}) {
    if (!cfg.apiFootballKey) {
      await emitOpsEvent(cfg, { severity: 'critical', source: 'provider', eventType: 'configuration', code: 'FOOTBALL_CONFIG', message: 'Ключ API-Football отсутствует.' });
      throw footballError('Ключ API-Football не настроен в Cloudflare.', 'FOOTBALL_CONFIG');
    }

    await loadSharedProviderState(cfg);

    const dailyReserve = dailyReserveDecision(options);
    if (dailyReserve.blocked) {
      const retryAfter = Math.max(60, Number(dailyReserve.retryAfter || 3600));
      bumpTelemetry('quotaBlocks');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      const now = Date.now();
      if (now - Number(memory.providerDailyReserveEvidenceAt || 0) >= 5 * 60_000) {
        memory.providerDailyReserveEvidenceAt = now;
        await emitOpsEvent(cfg, {
          severity:'warning',
          source:'provider',
          eventType:'quota_guard',
          code:'PROVIDER_DAILY_RESERVE',
          message:'API-Football FREE daily reserve is protecting remaining requests.',
          endpoint:path,
          meta:{
            plan:dailyReserve.plan,
            dailyRemaining:dailyReserve.remaining,
            dailyReserve:dailyReserve.reserve,
            retryAfter,
            disposition:'serve_cache_or_fail_soft',
          },
        });
      }
      throw footballError(
        'Дневной резерв API-Football включён. До обновления квоты используем сохранённые данные.',
        'FOOTBALL_DAILY_RESERVE',
        retryAfter,
      );
    }

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
      bumpTelemetry('quotaBlocks');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      if (distributedBudget.degraded) {
        memory.provider.lastError='distributed_guard_degraded';
        throw footballError(
          `Защитный лимит API-Football временно работает в аварийном режиме. Повторите примерно через ${retryAfter} сек.`,
          'FOOTBALL_GUARD_DEGRADED',
          retryAfter,
        );
      }
      await persistSharedProviderCooldown(cfg, retryAfter, 'distributed_rate_guard').catch(() => null);
      throw footballError(`Глобальная минутная квота API-Football защищена. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_COOLDOWN', retryAfter);
    }

    const url = new URL(`https://v3.football.api-sports.io${path}`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }

    await paceProviderRequest();
    noteProviderSend();
    const startedAt = Date.now();
    const attempt = Math.max(1, Number(options.attempt || 1));
    const maxAttempts = Math.max(attempt, Number(options.maxAttempts || attempt));
    bumpTelemetry('apiRequests');
    bumpTelemetry('providerRequests');
    phase5ProviderUsage(cfg,'networkRequests',1);
    memory.provider.lastRequestAt = new Date(startedAt).toISOString();
    let r;
    try {
      r = await fetchWithTimeout(url, {
        headers: { 'x-apisports-key': cfg.apiFootballKey, Accept: 'application/json' },
      }, Number(options.timeoutMs || 10000), 'API-Football');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut = String(error?.code || '') === 'UPSTREAM_TIMEOUT';
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      bumpTelemetry('providerLatencyMs', durationMs);
      bumpTelemetry('providerLatencySamples');
      if (timedOut) bumpTelemetry('providerTimeouts');
      memory.provider.lastStatus = null;
      memory.provider.lastLatencyMs = durationMs;
      memory.provider.lastError = timedOut ? 'timeout' : 'network_error';
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:attempt < maxAttempts ? 'retrying' : 'failed',
        errorType:timedOut ? 'UPSTREAM_TIMEOUT' : 'FOOTBALL_NETWORK',
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity: 'error', source: 'provider', eventType: 'api_request', code: timedOut ? 'UPSTREAM_TIMEOUT' : 'FOOTBALL_NETWORK',
        message: error?.message || (timedOut ? 'Upstream timeout' : 'Network error'), endpoint: path, durationMs,
        meta: { provider:'api-football', operation:path, attempt, finalResult: attempt < maxAttempts ? 'retrying' : 'failed' },
      });
      if (timedOut) throw error;
      throw footballError('Не удалось подключиться к API-Football.', 'FOOTBALL_NETWORK');
    }

    const durationMs = Date.now() - startedAt;
    bumpTelemetry('providerLatencyMs', durationMs);
    bumpTelemetry('providerLatencySamples');
    updateProviderFromHeaders(r);
    await persistSharedProviderQuota(cfg).catch(() => null);
    providerQuotaEvidence(cfg);
    memory.provider.lastStatus = r.status;
    memory.provider.lastLatencyMs = durationMs;

    if (r.status === 429) {
      const explicitRetryAfter = String(r.headers?.get?.('retry-after') || '').trim() !== '';
      if (!explicitRetryAfter && attempt < 2 && looksLikeBurstRejection()) {
        memory.provider.lastError = 'rate_limit_burst';
        bumpTelemetry('rateLimits');
        bumpTelemetry('providerRateLimits');
        throw burstRejection('API-Football ограничил частоту запросов в секунду. Повторяем запрос.', r.status);
      }
      const retryAfter = retryAfterSeconds(r.headers, 65);
      await persistSharedProviderCooldown(cfg, retryAfter, 'rate_limit').catch(() => null);
      memory.provider.lastError = 'rate_limit';
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      bumpTelemetry('rateLimits');
      bumpTelemetry('providerRateLimits');
      phase5ProviderUsage(cfg,'quotaBlocks',1);
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:'rate_limited',
        errorType:'FOOTBALL_RATE_LIMIT',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT',
        message: `API-Football HTTP 429; retry ${retryAfter}s`, endpoint: path, status: r.status, durationMs,
        meta: {
          retryAfter,
          plan: memory.provider?.plan || 'UNKNOWN',
          minuteRemaining: memory.provider?.minuteRemaining,
          dailyRemaining: memory.provider?.dailyRemaining,
          provider:'api-football',
          operation:path,
          attempt,
          finalResult:'rate_limited',
        },
      });
      throw footballError(`API-Football достиг минутного лимита. Повторите примерно через ${retryAfter} сек.`, 'FOOTBALL_RATE_LIMIT', retryAfter, r.status);
    }
    if (!r.ok) {
      memory.provider.lastError = `http_${r.status}`;
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:isRetryableFootballHttpStatus(r.status) && attempt < maxAttempts ? 'retrying' : 'failed',
        errorType:'FOOTBALL_HTTP',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity: r.status >= 500 ? 'error' : 'warning', source: 'provider', eventType: 'api_request', code: 'FOOTBALL_HTTP',
        message: `API-Football HTTP ${r.status}`, endpoint: path, status: r.status, durationMs,
        meta: {
          provider:'api-football',
          operation:path,
          attempt,
          finalResult: isRetryableFootballHttpStatus(r.status) && attempt < maxAttempts ? 'retrying' : 'failed',
        },
      });
      throw footballError(`API-Football временно недоступен (HTTP ${r.status}).`, 'FOOTBALL_HTTP', 0, r.status);
    }

    let body;
    try {
      body = await r.json();
    } catch (error) {
      memory.provider.lastError = 'invalid_json';
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:'failed',
        errorType:'FOOTBALL_INVALID_RESPONSE',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity:'error', source:'provider', eventType:'api_response', code:'FOOTBALL_INVALID_RESPONSE',
        message:'API-Football вернул некорректный JSON.', endpoint:path, status:r.status, durationMs,
        meta:{ provider:'api-football', operation:path, attempt, finalResult:'failed', reason:'invalid_json' },
      });
      throw footballError('API-Football вернул некорректный ответ.', 'FOOTBALL_INVALID_RESPONSE', 0, r.status);
    }

    if (!body || typeof body !== 'object') {
      memory.provider.lastError = 'invalid_response_shape';
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:'failed',
        errorType:'FOOTBALL_INVALID_RESPONSE',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity:'error', source:'provider', eventType:'api_response', code:'FOOTBALL_INVALID_RESPONSE',
        message:'API-Football вернул неожиданный формат ответа.', endpoint:path, status:r.status, durationMs,
        meta:{ provider:'api-football', operation:path, attempt, finalResult:'failed', reason:'non_object_response' },
      });
      throw footballError('API-Football вернул неожиданный формат ответа.', 'FOOTBALL_INVALID_RESPONSE', 0, r.status);
    }

    const errors = body?.errors && typeof body.errors === 'object' ? Object.values(body.errors).filter(Boolean) : [];
    if (errors.length) {
      const message = errors.join('; ');
      memory.provider.lastError = message.slice(0, 160);
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      if (/too many requests|rate.?limit|requests per minute/i.test(message)) {
        if (attempt < 2 && looksLikeBurstRejection()) {
          bumpTelemetry('rateLimits');
          bumpTelemetry('providerRateLimits');
          throw burstRejection('API-Football ограничил частоту запросов в секунду. Повторяем запрос.', r.status);
        }
        await persistSharedProviderCooldown(cfg, 65, 'rate_limit_body').catch(() => null);
        bumpTelemetry('rateLimits');
        bumpTelemetry('providerRateLimits');
        phase5ProviderUsage(cfg,'quotaBlocks',1);
        await observe(cfg,{
          provider:'api-football',
          operation:path,
          outcome:'rate_limited',
          errorType:'FOOTBALL_RATE_LIMIT_BODY',
          status:r.status,
          latencyMs:durationMs,
          attempt,
        });
        await emitOpsEvent(cfg, {
          severity: 'warning', source: 'provider', eventType: 'rate_limit', code: 'FOOTBALL_RATE_LIMIT_BODY',
          message, endpoint: path, status: r.status, durationMs,
          meta:{
            retryAfter:65,
            plan:memory.provider?.plan || 'UNKNOWN',
            dailyLimit:memory.provider?.dailyLimit,
            dailyRemaining:memory.provider?.dailyRemaining,
            minuteLimit:memory.provider?.minuteLimit,
            minuteRemaining:memory.provider?.minuteRemaining,
            provider:'api-football',
            operation:path,
            attempt,
            finalResult:'rate_limited',
          },
        });
        throw footballError('API-Football достиг лимита запросов. Покажем сохранённые данные, если они есть.', 'FOOTBALL_RATE_LIMIT', 65, r.status);
      }
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:'failed',
        errorType:'FOOTBALL_RESPONSE',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity: 'warning', source: 'provider', eventType: 'api_response', code: 'FOOTBALL_RESPONSE',
        message, endpoint: path, status: r.status, durationMs,
        meta:{ provider:'api-football', operation:path, attempt, finalResult:'failed' },
      });
      throw footballError(`API-Football: ${message}`, 'FOOTBALL_RESPONSE', 0, r.status);
    }

    const hasResponse = Object.prototype.hasOwnProperty.call(body, 'response');
    const responseShapeValid = options.responseType === 'any'
      ? hasResponse
      : hasResponse && Array.isArray(body.response);
    if (!responseShapeValid) {
      memory.provider.lastError = 'invalid_response_shape';
      bumpTelemetry('apiErrors');
      bumpTelemetry('providerErrors');
      await observe(cfg,{
        provider:'api-football',
        operation:path,
        outcome:'failed',
        errorType:'FOOTBALL_INVALID_RESPONSE',
        status:r.status,
        latencyMs:durationMs,
        attempt,
      });
      await emitOpsEvent(cfg, {
        severity:'error', source:'provider', eventType:'api_response', code:'FOOTBALL_INVALID_RESPONSE',
        message:'API-Football вернул неожиданный формат ответа.', endpoint:path, status:r.status, durationMs,
        meta:{
          provider:'api-football',
          operation:path,
          attempt,
          finalResult:'failed',
          reason:hasResponse ? 'unexpected_response_type' : 'missing_response',
        },
      });
      throw footballError('API-Football вернул неожиданный формат ответа.', 'FOOTBALL_INVALID_RESPONSE', 0, r.status);
    }

    await observe(cfg,{
      provider:'api-football',
      operation:path,
      outcome:'success',
      status:r.status,
      latencyMs:durationMs,
      attempt,
    });
    memory.provider.lastError = '';
    memory.provider.lastSuccessAt = new Date().toISOString();
    bumpTelemetry('apiSuccess');
    if (options.responseType === 'envelope') {
      const current=positivePagingInteger(body?.paging?.current,1);
      const total=Math.max(
        current,
        positivePagingInteger(body?.paging?.total,current),
      );
      return {
        response: body.response,
        paging:{current,total},
      };
    }
    if (options.responseType === 'any') return body.response ?? null;
    return body.response;
  }

  function providerTransportPolicy(options = {}) {
    const responseType = ['array','any','envelope'].includes(String(options.responseType || 'array'))
      ? String(options.responseType || 'array')
      : 'array';
    const requestedRetries = Number(options.transportRetries ?? 1);
    const transportRetries = Number.isFinite(requestedRetries)
      ? Math.max(0, Math.min(1, Math.trunc(requestedRetries)))
      : 1;
    const requestedTimeoutMs = Number(options.timeoutMs || 10000);
    const timeoutMs = Number.isFinite(requestedTimeoutMs)
      ? Math.max(500, Math.trunc(requestedTimeoutMs))
      : 10000;
    const allowDailyReserve = options.allowDailyReserve === true;
    return Object.freeze({
      responseType,
      transportRetries,
      timeoutMs,
      allowDailyReserve,
    });
  }

  function providerRequestKey(path, params, options = {}) {
    const pairs = Object.entries(params || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(String(key))}=${encodeURIComponent(String(value))}`)
      .join('&');
    const policy=providerTransportPolicy(options);
    return [
      `football:${path}?${pairs}`,
      `type=${policy.responseType}`,
      `retries=${policy.transportRetries}`,
      `timeout=${policy.timeoutMs}`,
      `dailyReserve=${policy.allowDailyReserve ? 'allow' : 'protect'}`,
    ].join(':');
  }

  function isRetryableFootballTransportError(error) {
    return ['FOOTBALL_NETWORK', 'UPSTREAM_TIMEOUT'].includes(String(error?.code || ''))
      || (String(error?.code || '') === 'FOOTBALL_HTTP' && isRetryableFootballHttpStatus(error?.status));
  }

  async function apiFootball(path, params, cfg, options = {}) {
    const policy=providerTransportPolicy(options);
    return await withSingleFlight(
      providerRequestKey(path, params, policy),
      async () => {
        const retries = policy.transportRetries;
        const runTransportAttempts = async (attemptOffset) => {
          const maxAttempts = retries + 1 + attemptOffset;
          let lastError = null;
          for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
              return await apiFootballNetwork(path, params, cfg, {
                ...options,
                responseType:policy.responseType,
                transportRetries:policy.transportRetries,
                timeoutMs:policy.timeoutMs,
                allowDailyReserve:policy.allowDailyReserve,
                attempt: attempt + 1 + attemptOffset,
                maxAttempts,
              });
            } catch (error) {
              lastError = error;
              if (attempt >= retries || !isRetryableFootballTransportError(error)) throw error;
              bumpTelemetry('providerRetries');
              await sleepMs(180 * (attempt + 1));
            }
          }
          throw lastError;
        };
        try {
          return await runTransportAttempts(0);
        } catch (error) {
          // A per-second burst rejection is retried once after a short pause (no shared cooldown is set).
          if (error?.burst !== true) throw error;
          bumpTelemetry('providerRetries');
          await sleepMs(BURST_RETRY_DELAY_MS);
          return await runTransportAttempts(1);
        }
      },
    );
  }

  return {
    footballError,
    isFootballRateLimitError,
    isRetryableFootballHttpStatus,
    footballCooldownRemaining,
    freeQuotaHealthy,
    secondsUntilUtcDayReset,
    dailyReserveDecision,
    distributedProviderMinuteLimit,
    emergencyProviderMinuteLimit,
    claimEmergencyLocalProviderBudget,
    claimDistributedProviderBudget,
    apiFootballNetwork,
    providerTransportPolicy,
    providerRequestKey,
    isRetryableFootballTransportError,
    apiFootball,
  };
}
