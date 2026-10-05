function required(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

export function createPublicStatusRuntime({
  loadRuntimeControls,
  publicRuntimeControls,
  providerCooldownUntil,
  currentReleaseIdentity,
  readCompositeReadiness,
  scheduleReleaseFieldEvidence = () => {},
  version = '',
  releaseCandidate = '',
  expectedSchemaContractVersion = 0,
  expectedSchemaFingerprint = '',
  now = Date.now,
} = {}) {
  required('loadRuntimeControls', loadRuntimeControls);
  required('publicRuntimeControls', publicRuntimeControls);
  required('providerCooldownUntil', providerCooldownUntil);
  required('currentReleaseIdentity', currentReleaseIdentity);
  required('readCompositeReadiness', readCompositeReadiness);
  required('scheduleReleaseFieldEvidence', scheduleReleaseFieldEvidence);
  required('now', now);

  async function serviceStatus(cfg) {
    const runtimeState = await loadRuntimeControls(cfg);
    const runtime = publicRuntimeControls(runtimeState.value);
    const current = Number(now());
    const providerCooldown = Number(providerCooldownUntil() || 0) > current;
    const maintenance = Boolean(runtime.maintenanceMode);
    const coreLimited = maintenance || !runtime.analysisEnabled || !runtime.searchEnabled;
    const status = maintenance ? 'maintenance' : providerCooldown || coreLimited ? 'degraded' : 'operational';

    return {
      ok: status !== 'maintenance',
      status,
      label: status === 'operational'
        ? 'Все основные системы работают'
        : status === 'maintenance'
          ? 'Техническое обслуживание'
          : 'Часть функций работает с ограничениями',
      version: String(version || ''),
      releaseCandidate: String(releaseCandidate || ''),
      deployment: currentReleaseIdentity(cfg),
      generatedAt: new Date(current).toISOString(),
      services: {
        telegram: cfg?.botToken && cfg?.webhookSecret ? 'operational' : 'configuration_required',
        miniApp: 'operational',
        aiAnalysis: runtime.analysisEnabled ? (cfg?.apiFootballKey ? 'operational' : 'configuration_required') : 'paused',
        search: runtime.searchEnabled ? (cfg?.apiFootballKey ? 'operational' : 'configuration_required') : 'paused',
        live: runtime.liveEnabled ? (cfg?.apiFootballKey ? 'operational' : 'configuration_required') : 'paused',
        news: cfg?.tavilyKey ? 'operational' : 'limited',
      },
      notice: runtime.message || '',
    };
  }

  async function measureReadiness(task) {
    const startedAt = Number(now());
    const value = await task();
    return { value, latencyMs: Number(now()) - startedAt };
  }

  async function computeReadinessSnapshot(cfg) {
    scheduleReleaseFieldEvidence(cfg);
    const startedAt = Number(now());
    const compositeCheck = await measureReadiness(() => readCompositeReadiness(cfg, 5));
    const composite = compositeCheck.value || {};
    const supabase = composite.connectivity || {};
    const schema = composite.schema || {};
    const security = composite.backendSecurity || {};
    const authFailures = composite.authFailures || {};
    const telegramConfigured = Boolean(cfg?.botToken && cfg?.webhookSecret);
    const ok = Boolean(composite.valid && composite.ok && telegramConfigured);

    return {
      ok,
      status: ok ? 'ready' : 'not_ready',
      version: String(version || ''),
      releaseCandidate: String(releaseCandidate || ''),
      deployment: currentReleaseIdentity(cfg),
      latencyMs: Number(now()) - startedAt,
      checks: {
        supabase: {
          ok: Boolean(supabase.ok),
          status: supabase.status || 'unknown',
          attempts: Number(supabase.attempts || 1),
          latencyMs: compositeCheck.latencyMs,
        },
        schema: {
          ok: Boolean(schema.ok),
          status: schema.status || 'unknown',
          contractVersion: Number(schema.contractVersion || composite.schemaContractVersion || 0),
          expectedContractVersion: Number(expectedSchemaContractVersion || 0),
          fingerprint: schema?.fingerprint?.fingerprint || '',
          expectedFingerprint: schema?.fingerprint?.expected || String(expectedSchemaFingerprint || ''),
          primaryExpectedFingerprint: String(expectedSchemaFingerprint || ''),
          latencyMs: compositeCheck.latencyMs,
        },
        backendSecurity: {
          ok: Boolean(security.ok),
          status: security.status || 'unknown',
          latencyMs: compositeCheck.latencyMs,
        },
        telegramConfigured,
        recentSupabaseAuthFailures: authFailures.available ? Number(authFailures.count || 0) : null,
        recentSupabaseAuthFailuresLatencyMs: compositeCheck.latencyMs,
      },
    };
  }

  return Object.freeze({
    serviceStatus,
    computeReadinessSnapshot,
  });
}

export function createPublicStatusRouter({
  publicStatusRuntime,
  publicHealthRuntime,
  appManifest,
  loadRuntimeControls,
  publicRuntimeControls,
  runtimeControlsCacheMs,
  json,
} = {}) {
  if (!publicStatusRuntime || typeof publicStatusRuntime.serviceStatus !== 'function') {
    throw new TypeError('publicStatusRuntime is required');
  }
  if (!publicHealthRuntime || typeof publicHealthRuntime.publicHealthSnapshot !== 'function' || typeof publicHealthRuntime.detailedHealthSnapshot !== 'function') {
    throw new TypeError('publicHealthRuntime is required');
  }
  required('appManifest', appManifest);
  required('loadRuntimeControls', loadRuntimeControls);
  required('publicRuntimeControls', publicRuntimeControls);
  required('json', json);

  async function handle(request, url, cfg) {
    const pathname = String(url?.pathname || '');
    const method = String(request?.method || 'GET').toUpperCase();

    if (method === 'GET' && pathname === '/api/public-status') {
      return json(await publicStatusRuntime.serviceStatus(cfg), 200, { 'cache-control': 'no-store' });
    }

    if (pathname === '/health/live') {
      return json(publicHealthRuntime.liveSnapshot(), 200, { 'cache-control': 'no-store' });
    }

    if (pathname === '/health/ready') {
      const readiness = await publicHealthRuntime.readinessSnapshot(cfg);
      return json(readiness, readiness.ok ? 200 : 503, { 'cache-control': 'no-store' });
    }

    if (pathname === '/health' || pathname === '/api/health') {
      const authorized=publicHealthRuntime.isProbeAuthorized(request,cfg);
      const health=authorized
        ? await publicHealthRuntime.detailedHealthSnapshot(cfg)
        : await publicHealthRuntime.publicHealthSnapshot(cfg);
      return json(health, health.ok ? 200 : 503, { 'cache-control': 'no-store' });
    }

    if (method === 'GET' && pathname === '/api/app-manifest') {
      await loadRuntimeControls(cfg);
      return json(appManifest(cfg));
    }

    if (method === 'GET' && pathname === '/api/runtime-status') {
      const runtimeState = await loadRuntimeControls(cfg);
      return json({
        ok: true,
        available: Boolean(runtimeState.schemaReady),
        runtime: publicRuntimeControls(runtimeState.value),
        source: runtimeState.source,
        cacheSeconds: Math.round(Number(runtimeControlsCacheMs || 0) / 1000),
      });
    }

    if (pathname === '/health/supabase') {
      return json({
        ok: false,
        error: 'Техническая проверка Supabase перенесена в защищённую диагностику администратора мини-приложения.',
        code: 'ADMIN_DIAGNOSTICS_ONLY',
      }, 404);
    }

    return null;
  }

  return Object.freeze({ handle });
}
