function providerLabel(value) {
  return String(value || 'provider').trim() || 'provider';
}

export function retryAfterSeconds(headers, fallbackSeconds = 60, nowMs = Date.now()) {
  const raw = String(headers?.get?.('retry-after') || '').trim();
  const fallback = Math.max(1, Number(fallbackSeconds || 60));
  if (!raw) return fallback;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.max(1, Math.ceil(numeric));

  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) return Math.max(1, Math.ceil((retryAt - Number(nowMs || Date.now())) / 1000));
  return fallback;
}

export function providerRequestError(message, code, {
  provider = 'provider',
  operation = '',
  status = null,
  retryAfter = 0,
  cause = null,
} = {}) {
  const error = new Error(String(message || 'Provider request failed'));
  error.code = String(code || 'PROVIDER_HTTP_ERROR');
  error.provider = providerLabel(provider);
  error.operation = String(operation || '');
  if (Number.isFinite(Number(status)) && Number(status) > 0) error.status = Number(status);
  error.retryAfter = Math.max(0, Number(retryAfter || 0));
  if (cause) error.cause = cause;
  return error;
}

function retryableStatus(status) {
  return [502, 503, 504].includes(Number(status));
}

function safeRequestKey(url, provider, operation) {
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|authorization|auth/i.test(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return `secondary:${providerLabel(provider)}:${String(operation || '')}:${parsed.toString()}`;
  } catch {
    return `secondary:${providerLabel(provider)}:${String(operation || '')}`;
  }
}

export function createProviderRequestBoundary({
  fetchWithTimeout,
  withSingleFlight,
  sleepMs,
  recordOpsEvent,
  bumpTelemetry = () => {},
  observeProviderRequest = () => {},
  now = () => Date.now(),
} = {}) {
  if (typeof fetchWithTimeout !== 'function') throw new Error('fetchWithTimeout is required');
  if (typeof withSingleFlight !== 'function') throw new Error('withSingleFlight is required');
  if (typeof sleepMs !== 'function') throw new Error('sleepMs is required');

  async function observe(cfg, event) {
    return await Promise.resolve(observeProviderRequest(event, cfg));
  }

  async function emitFailure(cfg, {
    provider,
    operation,
    error,
    attempt,
    finalResult,
    latencyMs,
  }) {
    if (typeof recordOpsEvent !== 'function') return;
    await recordOpsEvent(cfg, {
      severity: finalResult === 'retrying' ? 'warning' : 'error',
      source: 'provider',
      eventType: 'provider_request',
      code: String(error?.code || 'PROVIDER_HTTP_ERROR'),
      message: error?.message || 'Provider request failed',
      endpoint: String(operation || ''),
      status: Number(error?.status || 0) || undefined,
      durationMs: Number(latencyMs || 0),
      meta: {
        provider: providerLabel(provider),
        operation: String(operation || ''),
        attempt: Number(attempt || 1),
        finalResult,
        retryAfter: Number(error?.retryAfter || 0),
      },
    }).catch(() => null);
  }

  async function providerRequestJson(url, cfg, {
    provider = 'provider',
    operation = '',
    headers = {},
    timeoutMs = 7000,
    retries = 1,
  } = {}) {
    const normalizedProvider = providerLabel(provider);
    const attemptsAllowed = Math.max(0, Math.min(2, Number(retries ?? 1)));

    return await withSingleFlight(safeRequestKey(url, normalizedProvider, operation), async () => {
      let lastError = null;

      for (let attempt = 0; attempt <= attemptsAllowed; attempt += 1) {
        const attemptNumber = attempt + 1;
        const startedAt = now();
        bumpTelemetry('providerRequests');

        let response;
        try {
          response = await fetchWithTimeout(url, {
            method: 'GET',
            headers: { accept: 'application/json', ...headers },
          }, timeoutMs, normalizedProvider);
        } catch (cause) {
          const latencyMs = Math.max(0, now() - startedAt);
          bumpTelemetry('providerErrors');
          bumpTelemetry('providerLatencyMs', latencyMs);
          bumpTelemetry('providerLatencySamples');

          const timedOut = String(cause?.code || '') === 'UPSTREAM_TIMEOUT' || cause?.name === 'AbortError';
          if (timedOut) bumpTelemetry('providerTimeouts');
          const error = providerRequestError(
            timedOut ? `${normalizedProvider}: timeout` : `${normalizedProvider}: network error`,
            timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
            { provider: normalizedProvider, operation, cause },
          );
          lastError = error;
          const canRetry = attempt < attemptsAllowed;
          await observe(cfg,{
            provider: normalizedProvider,
            operation,
            outcome: canRetry ? 'retrying' : 'failed',
            errorType: error.code,
            latencyMs,
            attempt: attemptNumber,
          });
          if (!canRetry) {
            await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'failed', latencyMs });
            throw error;
          }

          bumpTelemetry('providerRetries');
          await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'retrying', latencyMs });
          await sleepMs(180 * (attemptNumber));
          continue;
        }

        const latencyMs = Math.max(0, now() - startedAt);
        bumpTelemetry('providerLatencyMs', latencyMs);
        bumpTelemetry('providerLatencySamples');

        if (response.status === 429) {
          bumpTelemetry('providerErrors');
          bumpTelemetry('providerRateLimits');
          const retryAfter = retryAfterSeconds(response.headers, 60, now());
          const error = providerRequestError(
            `${normalizedProvider}: HTTP 429`,
            'PROVIDER_RATE_LIMITED',
            { provider: normalizedProvider, operation, status: 429, retryAfter },
          );
          await observe(cfg,{
            provider: normalizedProvider,
            operation,
            outcome: 'rate_limited',
            errorType: error.code,
            status: response.status,
            latencyMs,
            attempt: attemptNumber,
          });
          await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'rate_limited', latencyMs });
          throw error;
        }

        if (!response.ok) {
          bumpTelemetry('providerErrors');
          const error = providerRequestError(
            `${normalizedProvider}: HTTP ${response.status}`,
            'PROVIDER_HTTP_ERROR',
            { provider: normalizedProvider, operation, status: response.status },
          );
          lastError = error;
          const canRetry = attempt < attemptsAllowed && retryableStatus(response.status);
          await observe(cfg,{
            provider: normalizedProvider,
            operation,
            outcome: canRetry ? 'retrying' : 'failed',
            errorType: error.code,
            status: response.status,
            latencyMs,
            attempt: attemptNumber,
          });
          if (!canRetry) {
            await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'failed', latencyMs });
            throw error;
          }

          bumpTelemetry('providerRetries');
          await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'retrying', latencyMs });
          await sleepMs(180 * (attemptNumber));
          continue;
        }

        let payload;
        try {
          payload = await response.json();
        } catch (cause) {
          bumpTelemetry('providerErrors');
          const error = providerRequestError(
            `${normalizedProvider}: invalid JSON`,
            'PROVIDER_INVALID_RESPONSE',
            { provider: normalizedProvider, operation, status: response.status, cause },
          );
          await observe(cfg,{
            provider: normalizedProvider,
            operation,
            outcome: 'failed',
            errorType: error.code,
            status: response.status,
            latencyMs,
            attempt: attemptNumber,
          });
          await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'failed', latencyMs });
          throw error;
        }

        if (payload === null || (typeof payload !== 'object' && !Array.isArray(payload))) {
          bumpTelemetry('providerErrors');
          const error = providerRequestError(
            `${normalizedProvider}: invalid response shape`,
            'PROVIDER_INVALID_RESPONSE',
            { provider: normalizedProvider, operation, status: response.status },
          );
          await observe(cfg,{
            provider: normalizedProvider,
            operation,
            outcome: 'failed',
            errorType: error.code,
            status: response.status,
            latencyMs,
            attempt: attemptNumber,
          });
          await emitFailure(cfg, { provider: normalizedProvider, operation, error, attempt: attemptNumber, finalResult: 'failed', latencyMs });
          throw error;
        }

        await observe(cfg,{
          provider: normalizedProvider,
          operation,
          outcome: 'success',
          status: response.status,
          latencyMs,
          attempt: attemptNumber,
        });
        return payload;
      }

      throw lastError || providerRequestError(
        `${normalizedProvider}: request failed`,
        'PROVIDER_HTTP_ERROR',
        { provider: normalizedProvider, operation },
      );
    });
  }

  return Object.freeze({ providerRequestJson });
}
