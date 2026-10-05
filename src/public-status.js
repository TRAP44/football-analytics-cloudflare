function required(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function cleanText(value, fallback='', maxLength=280) {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,maxLength);
}

function numericCandidate(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value, fallback=0) {
  const number=numericCandidate(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function positiveInteger(value, fallback=1) {
  const number=numericCandidate(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function clockValue(now) {
  try {
    const value=typeof now === 'function' ? now() : Date.now();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15
      ? value
      : Date.now();
  } catch {
    return Date.now();
  }
}

function isConfiguredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function runtimeSource(value) {
  const source=typeof value === 'string' ? value.trim().toLowerCase() : '';
  return new Set(['supabase','memory','fail_closed','default']).has(source) ? source : 'unknown';
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

  const publicVersion=cleanText(version,'',80);
  const publicReleaseCandidate=cleanText(releaseCandidate,'',80);
  const expectedContractVersion=nonNegativeInteger(expectedSchemaContractVersion,0);
  const primaryExpectedFingerprint=cleanText(expectedSchemaFingerprint,'',256);

  function cooldownState(current) {
    try {
      const raw=providerCooldownUntil();
      if (raw === undefined || raw === null || raw === '') return {active:false,valid:true};
      const until=numericCandidate(raw);
      if (until === null || until < 0 || until > 8.64e15) return {active:false,valid:false};
      return {active:until > current,valid:true};
    } catch {
      return {active:false,valid:false};
    }
  }

  function releaseIdentity(cfg) {
    try {
      const value=currentReleaseIdentity(cfg);
      return plainObject(value);
    } catch {
      return {};
    }
  }

  async function serviceStatus(cfg) {
    const runtimeState = await loadRuntimeControls(cfg);
    const runtime = plainObject(publicRuntimeControls(runtimeState?.value));
    const current = clockValue(now);
    const providerCooldown = cooldownState(current);
    const maintenance = runtime.maintenanceMode === true;
    const analysisEnabled = runtime.analysisEnabled === true;
    const searchEnabled = runtime.searchEnabled === true;
    const liveEnabled = runtime.liveEnabled === true;
    const coreLimited = maintenance || !analysisEnabled || !searchEnabled;
    const status = maintenance
      ? 'maintenance'
      : providerCooldown.active || !providerCooldown.valid || coreLimited
        ? 'degraded'
        : 'operational';
    const apiFootballConfigured=isConfiguredSecret(cfg?.apiFootballKey);

    return {
      ok: status !== 'maintenance',
      status,
      label: status === 'operational'
        ? 'Все основные системы работают'
        : status === 'maintenance'
          ? 'Техническое обслуживание'
          : 'Часть функций работает с ограничениями',
      version: publicVersion,
      releaseCandidate: publicReleaseCandidate,
      generatedAt: new Date(current).toISOString(),
      services: {
        telegram: isConfiguredSecret(cfg?.botToken) && isConfiguredSecret(cfg?.webhookSecret)
          ? 'operational'
          : 'configuration_required',
        miniApp: 'operational',
        aiAnalysis: analysisEnabled ? (apiFootballConfigured ? 'operational' : 'configuration_required') : 'paused',
        search: searchEnabled ? (apiFootballConfigured ? 'operational' : 'configuration_required') : 'paused',
        live: liveEnabled ? (apiFootballConfigured ? 'operational' : 'configuration_required') : 'paused',
        news: isConfiguredSecret(cfg?.tavilyKey) ? 'operational' : 'limited',
      },
      notice: cleanText(runtime.message,'',280),
    };
  }

  async function measureReadiness(task) {
    const startedAt = clockValue(now);
    const value = await task();
    const endedAt = clockValue(now);
    return { value, latencyMs:Math.max(0,endedAt-startedAt) };
  }

  async function computeReadinessSnapshot(cfg) {
    try {
      const scheduled=scheduleReleaseFieldEvidence(cfg);
      if (scheduled && typeof scheduled.catch === 'function') void scheduled.catch(()=>{});
    } catch {}

    const startedAt = clockValue(now);
    const compositeCheck = await measureReadiness(() => readCompositeReadiness(cfg, 5));
    const composite = plainObject(compositeCheck.value);
    const supabase = plainObject(composite.connectivity);
    const schema = plainObject(composite.schema);
    const security = plainObject(composite.backendSecurity);
    const authFailures = plainObject(composite.authFailures);
    const telegramConfigured = isConfiguredSecret(cfg?.botToken) && isConfiguredSecret(cfg?.webhookSecret);
    const ok = composite.valid === true && composite.ok === true && telegramConfigured;
    const endedAt=clockValue(now);

    return {
      ok,
      status: ok ? 'ready' : 'not_ready',
      version: publicVersion,
      releaseCandidate: publicReleaseCandidate,
      deployment: releaseIdentity(cfg),
      latencyMs: Math.max(0,endedAt-startedAt),
      checks: {
        supabase: {
          ok: supabase.ok === true,
          status: cleanText(supabase.status,'unknown',80),
          attempts: positiveInteger(supabase.attempts,1),
          latencyMs: compositeCheck.latencyMs,
        },
        schema: {
          ok: schema.ok === true,
          status: cleanText(schema.status,'unknown',80),
          contractVersion: nonNegativeInteger(schema.contractVersion ?? composite.schemaContractVersion,0),
          expectedContractVersion,
          fingerprint: cleanText(schema?.fingerprint?.fingerprint,'',256),
          expectedFingerprint: cleanText(schema?.fingerprint?.expected,'',256) || primaryExpectedFingerprint,
          primaryExpectedFingerprint,
          latencyMs: compositeCheck.latencyMs,
        },
        backendSecurity: {
          ok: security.ok === true,
          status: cleanText(security.status,'unknown',80),
          latencyMs: compositeCheck.latencyMs,
        },
        telegramConfigured,
        recentSupabaseAuthFailures: authFailures.available === true
          ? nonNegativeInteger(authFailures.count,0)
          : null,
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
  if (
    !publicHealthRuntime
    || typeof publicHealthRuntime.healthSnapshot !== 'function'
    || typeof publicHealthRuntime.liveSnapshot !== 'function'
    || typeof publicHealthRuntime.readinessSnapshot !== 'function'
  ) {
    throw new TypeError('publicHealthRuntime is required');
  }
  required('appManifest', appManifest);
  required('loadRuntimeControls', loadRuntimeControls);
  required('publicRuntimeControls', publicRuntimeControls);
  required('json', json);

  async function handle(request, url, cfg) {
    const pathname = typeof url?.pathname === 'string' ? url.pathname : '';
    const method = typeof request?.method === 'string' ? request.method.trim().toUpperCase() : '';
    const readMethod=method === 'GET' || method === 'HEAD';

    if (readMethod && pathname === '/api/public-status') {
      return json(await publicStatusRuntime.serviceStatus(cfg), 200, { 'cache-control': 'no-store' });
    }

    if (readMethod && pathname === '/health/live') {
      return json(publicHealthRuntime.liveSnapshot(), 200, { 'cache-control': 'no-store' });
    }

    if (readMethod && pathname === '/health/ready') {
      const readiness = await publicHealthRuntime.readinessSnapshot(cfg);
      return json(readiness, readiness?.ok === true ? 200 : 503, { 'cache-control': 'no-store' });
    }

    if (readMethod && (pathname === '/health' || pathname === '/api/health')) {
      const health = await publicHealthRuntime.healthSnapshot(cfg);
      return json(health, health?.ok === true ? 200 : 503, { 'cache-control': 'no-store' });
    }

    if (readMethod && pathname === '/api/app-manifest') {
      await loadRuntimeControls(cfg);
      return json(appManifest(cfg));
    }

    if (readMethod && pathname === '/api/runtime-status') {
      const runtimeState = plainObject(await loadRuntimeControls(cfg));
      const runtime=plainObject(publicRuntimeControls(runtimeState.value));
      const cacheMs=nonNegativeInteger(runtimeControlsCacheMs,0);
      return json({
        ok: true,
        available: runtimeState.schemaReady === true,
        runtime,
        source: runtimeSource(runtimeState.source),
        cacheSeconds: Math.round(cacheMs / 1000),
      });
    }

    if (readMethod && pathname === '/health/supabase') {
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
