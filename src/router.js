import { providerBackedRouteDefinition } from './provider-route-registry.js';
import { runSensitiveMutationWithReplay } from './sensitive-mutation-replay.js';

const MUTATION_METHODS=new Set(['POST','PUT','PATCH','DELETE']);

function requestMethod(request) {
  if (typeof request?.method !== 'string') return '';
  const method=request.method.trim().toUpperCase();
  return /^[A-Z]+$/.test(method) ? method : '';
}

function requestPath(url) {
  return typeof url?.pathname === 'string' ? url.pathname : '';
}

function boundedRetryAfter(value,fallback=3) {
  const number=typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : NaN;
  return Number.isSafeInteger(number) && number >= 1 && number <= 3600
    ? number
    : fallback;
}

// Phase 2 router boundary: route selection only. Authentication, beta access,
// runtime controls, burst protection and route error compatibility stay in the composition root.
export async function dispatchApiRoute(request, url, cfg, user, deps) {
  const {
    adminForbidden,
    apiAiTrackRecord,
    apiBetaDashboard,
    apiBetaFeedback,
    apiChannelPublisherTest,
    apiPhase5Dashboard,
    apiBillingInvoice,
    apiBillingPlans,
    apiBillingRefund,
    apiBillingRefundLookup,
    apiBillingSubscription,
    apiBillingSync,
    apiCalibrationControl,
    apiClientTelemetry,
    apiDataIntegrity,
    apiDiagnostics,
    apiDigestSettings,
    apiEntitlements,
    apiFavoritePlayers,
    apiFavorites,
    apiFixtureShareLink,
    apiHistory,
    apiHistoryAnalysis,
    apiLaunchFunnel,
    apiMe,
    apiMediaPublisherLink,
    apiModelQuality,
    apiModelRemediation,
    apiNewsImpactRecoveryIncidentAck,
    apiPostDeployRegressionResponse,
    apiPreferences,
    apiProductionMonitor,
    apiProductionReadiness,
    apiProviderBudget,
    apiRcRegression,
    apiReleaseMonitor,
    apiReleaseReadiness,
    apiReminderHealth,
    apiReminders,
    apiRuntimeControls,
    apiRuntimeRollback,
    isAdminUser,
    json,
    loadLastProviderE2E,
    memory,
    providerBudgetProfile,
    providerSnapshot,
    providerSloReport,
    providerTransitionProfile,
    publicDataCapabilities,
    sensitiveMutationCoordinator,
  } = deps;

  const method=requestMethod(request);
  const pathname=requestPath(url);

  function adminAllowed() {
    try {
      return isAdminUser(user,cfg) === true;
    } catch {
      return false;
    }
  }

  function methodNotAllowed(allow) {
    const methods=Array.isArray(allow) ? allow : [];
    return json({
      error:'Метод не поддерживается.',
      code:'METHOD_NOT_ALLOWED',
    },405,methods.length ? {allow:methods.join(', ')} : {});
  }

  async function sensitiveMutation(handler) {
    if (!MUTATION_METHODS.has(method)) return methodNotAllowed(['POST']);
    const guarded=await runSensitiveMutationWithReplay({
      request,
      url,
      user,
      memory,
      cfg,
      handler,
      coordinator:sensitiveMutationCoordinator || null,
    });
    if (guarded.blocked) {
      const unavailable=guarded.reason==='guard_unavailable';
      const retryAfter=boundedRetryAfter(guarded.retryAfter,3);
      return json({
        error:unavailable
          ? 'Защита чувствительных операций временно недоступна. Повторите позже.'
          : 'Повтор чувствительной операции отклонён.',
        code:unavailable
          ? 'SENSITIVE_MUTATION_GUARD_UNAVAILABLE'
          : 'SENSITIVE_MUTATION_REPLAY_BLOCKED',
        reason:typeof guarded.reason === 'string' ? guarded.reason : 'unknown',
        ...(unavailable ? {retryAfter} : {}),
      },unavailable?503:409,unavailable?{'retry-after':String(retryAfter)}:{});
    }
    return guarded.response;
  }

  if (method === 'GET' && pathname === '/api/me') return await apiMe(request, cfg, user);
  if (method === 'GET' && pathname === '/api/data-capabilities') return json({ dataCapabilities: publicDataCapabilities() });
  if (method === 'POST' && pathname === '/api/client-telemetry') return await apiClientTelemetry(request, cfg, user);
  if (method === 'POST' && pathname === '/api/beta-feedback') return await apiBetaFeedback(request, cfg, user);
  if (method === 'GET' && pathname === '/api/beta-dashboard') {
    if (!adminAllowed()) return adminForbidden();
    return await apiBetaDashboard(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/admin/billing/refundable') {
    if (!adminAllowed()) return adminForbidden();
    return await apiBillingRefundLookup(request, cfg, user);
  }
  if (method === 'POST' && pathname === '/api/admin/billing/refund') {
    if (!adminAllowed()) return adminForbidden();
    return await sensitiveMutation(()=>apiBillingRefund(request, cfg, user));
  }
  if (method === 'POST' && pathname === '/api/admin/channel-publisher/test') {
    if (!adminAllowed()) return adminForbidden();
    return await sensitiveMutation(()=>apiChannelPublisherTest(request, cfg, user));
  }
  if (method === 'GET' && pathname === '/api/phase5-dashboard') {
    if (!adminAllowed()) return adminForbidden();
    return await apiPhase5Dashboard(request, cfg);
  }
  if (pathname === '/api/runtime-controls') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiRuntimeControls(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiRuntimeControls(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (pathname === '/api/runtime-controls/rollback') {
    if (!adminAllowed()) return adminForbidden();
    if (method !== 'POST') return methodNotAllowed(['POST']);
    return await sensitiveMutation(()=>apiRuntimeRollback(request,cfg,user));
  }

  const providerRoute=providerBackedRouteDefinition(pathname,method);
  if (providerRoute) {
    if (providerRoute.adminOnly && !adminAllowed()) return adminForbidden();
    const handler=deps[providerRoute.handler];
    if (typeof handler !== 'function') {
      throw new Error(`Provider-backed route handler ${providerRoute.handler} is unavailable.`);
    }
    return providerRoute.userScoped
      ? await handler(request,cfg,user)
      : await handler(request,cfg);
  }

  // v4.3 Admin Security: technical endpoints are protected server-side.
  // Hiding cards in the UI is not considered authorization.
  if (method === 'GET' && pathname === '/api/provider') {
    if (!adminAllowed()) return adminForbidden();
    return json({
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
      budget: providerBudgetProfile(),
      providerObservability: await providerSloReport(cfg, 24),
      lastAudit: memory?.providerAudit?.last ?? null,
      lastE2E: await loadLastProviderE2E(cfg),
    });
  }
  if (method === 'GET' && pathname === '/api/provider/budget') {
    if (!adminAllowed()) return adminForbidden();
    return await apiProviderBudget(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/diagnostics') {
    if (!adminAllowed()) return adminForbidden();
    return await apiDiagnostics(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/release-readiness') {
    if (!adminAllowed()) return adminForbidden();
    return await apiReleaseReadiness(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/production-readiness') {
    if (!adminAllowed()) return adminForbidden();
    return await apiProductionReadiness(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/rc-regression') {
    if (!adminAllowed()) return adminForbidden();
    return await apiRcRegression(request, cfg, user);
  }
  if (method === 'GET' && pathname === '/api/release-monitor') {
    if (!adminAllowed()) return adminForbidden();
    return await apiReleaseMonitor(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/production-monitor') {
    if (!adminAllowed()) return adminForbidden();
    return await apiProductionMonitor(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/launch-funnel') {
    if (!adminAllowed()) return adminForbidden();
    return await apiLaunchFunnel(request, cfg);
  }
  if (pathname === '/api/recovery-incident-ack') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiNewsImpactRecoveryIncidentAck(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiNewsImpactRecoveryIncidentAck(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (pathname === '/api/post-deploy-regression-response') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiPostDeployRegressionResponse(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiPostDeployRegressionResponse(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (pathname === '/api/reminder-health') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiReminderHealth(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiReminderHealth(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (method === 'GET' && pathname === '/api/data-integrity') {
    if (!adminAllowed()) return adminForbidden();
    return await apiDataIntegrity(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/model-quality') {
    if (!adminAllowed()) return adminForbidden();
    return await apiModelQuality(request, cfg);
  }
  if (method === 'GET' && pathname === '/api/ai-track-record') return await apiAiTrackRecord(request, cfg);
  if (method === 'GET' && pathname === '/api/share-link') return await apiFixtureShareLink(request,cfg,user);
  if (method === 'POST' && pathname === '/api/media-publisher-link') return await apiMediaPublisherLink(request,cfg,user);
  if (pathname === '/api/calibration-control') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiCalibrationControl(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiCalibrationControl(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (pathname === '/api/model-remediation') {
    if (!adminAllowed()) return adminForbidden();
    if (method === 'GET') return await apiModelRemediation(request,cfg,user);
    if (method === 'POST') return await sensitiveMutation(()=>apiModelRemediation(request,cfg,user));
    return methodNotAllowed(['GET','POST']);
  }
  if (method === 'GET' && pathname === '/api/entitlements') return await apiEntitlements(request, cfg, user);
  if (pathname.startsWith('/api/billing/')) {
    if (cfg?.monetizationEnabled !== true) return json({ error: 'Монетизация отложена до финального этапа проекта.' }, 404);
    if (method === 'GET' && pathname === '/api/billing/plans') return await apiBillingPlans(request, cfg, user);
    if (method === 'POST' && pathname === '/api/billing/invoice') return await sensitiveMutation(()=>apiBillingInvoice(request, cfg, user));
    if (method === 'POST' && pathname === '/api/billing/sync') return await sensitiveMutation(()=>apiBillingSync(request, cfg, user));
    if (method === 'POST' && pathname === '/api/billing/subscription') return await sensitiveMutation(()=>apiBillingSubscription(request, cfg, user));
  }
  if (method === 'GET' && pathname === '/api/history') return await apiHistory(request, cfg, user);
  if (method === 'GET' && pathname === '/api/history-analysis') return await apiHistoryAnalysis(request, cfg, user);
  if (pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
  if (pathname === '/api/favorite-players') return await apiFavoritePlayers(request, cfg, user);
  if (pathname === '/api/digest-settings') return await apiDigestSettings(request, cfg, user);
  if (pathname === '/api/reminders') return await apiReminders(request, cfg, user);
  if (pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
  return json({ error: 'Маршрут не найден.' }, 404);
}
