import { providerBackedRouteDefinition } from './provider-route-registry.js';
import { runSensitiveMutationWithReplay } from './sensitive-mutation-replay.js';

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

  async function sensitiveMutation(handler) {
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
      return json({
        error:unavailable
          ? 'Защита чувствительных операций временно недоступна. Повторите позже.'
          : 'Повтор чувствительной операции отклонён.',
        code:unavailable
          ? 'SENSITIVE_MUTATION_GUARD_UNAVAILABLE'
          : 'SENSITIVE_MUTATION_REPLAY_BLOCKED',
        reason:guarded.reason,
        ...(unavailable ? {retryAfter:Number(guarded.retryAfter || 3)} : {}),
      },unavailable?503:409,unavailable?{'retry-after':String(Number(guarded.retryAfter || 3))}:{});
    }
    return guarded.response;
  }

  if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/data-capabilities') return json({ dataCapabilities: publicDataCapabilities() });
  if (request.method === 'POST' && url.pathname === '/api/client-telemetry') return await apiClientTelemetry(request, cfg, user);
  if (request.method === 'POST' && url.pathname === '/api/beta-feedback') return await apiBetaFeedback(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/beta-dashboard') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiBetaDashboard(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/billing/refundable') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiBillingRefundLookup(request, cfg, user);
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/billing/refund') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await sensitiveMutation(()=>apiBillingRefund(request, cfg, user));
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/channel-publisher/test') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await sensitiveMutation(()=>apiChannelPublisherTest(request, cfg, user));
  }
  if (request.method === 'GET' && url.pathname === '/api/phase5-dashboard') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiPhase5Dashboard(request, cfg);
  }
  if (url.pathname === '/api/runtime-controls') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return request.method === 'GET'
      ? await apiRuntimeControls(request, cfg, user)
      : await sensitiveMutation(()=>apiRuntimeControls(request, cfg, user));
  }
  if (url.pathname === '/api/runtime-controls/rollback') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await sensitiveMutation(()=>apiRuntimeRollback(request, cfg, user));
  }

  const providerRoute=providerBackedRouteDefinition(url.pathname,request.method);
  if (providerRoute) {
    if (providerRoute.adminOnly && !isAdminUser(user,cfg)) return adminForbidden();
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
  if (request.method === 'GET' && url.pathname === '/api/provider') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return json({
      provider: providerSnapshot(),
      transition: providerTransitionProfile(),
      budget: providerBudgetProfile(),
      providerObservability: await providerSloReport(cfg, 24),
      lastAudit: memory.providerAudit.last,
      lastE2E: await loadLastProviderE2E(cfg),
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/provider/budget') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProviderBudget(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/diagnostics') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiDiagnostics(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/release-readiness') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiReleaseReadiness(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/production-readiness') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProductionReadiness(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/rc-regression') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiRcRegression(request, cfg, user);
  }
  if (request.method === 'GET' && url.pathname === '/api/release-monitor') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiReleaseMonitor(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/production-monitor') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProductionMonitor(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/launch-funnel') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiLaunchFunnel(request, cfg);
  }
  if (url.pathname === '/api/recovery-incident-ack') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return request.method === 'GET'
      ? await apiNewsImpactRecoveryIncidentAck(request, cfg, user)
      : await sensitiveMutation(()=>apiNewsImpactRecoveryIncidentAck(request, cfg, user));
  }
  if (url.pathname === '/api/post-deploy-regression-response') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return request.method === 'GET'
      ? await apiPostDeployRegressionResponse(request, cfg, user)
      : await sensitiveMutation(()=>apiPostDeployRegressionResponse(request, cfg, user));
  }
  if (url.pathname === '/api/reminder-health') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiReminderHealth(request, cfg, user);
  }
  if (request.method === 'GET' && url.pathname === '/api/data-integrity') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiDataIntegrity(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/model-quality') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiModelQuality(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/ai-track-record') return await apiAiTrackRecord(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/share-link') return await apiFixtureShareLink(request,cfg,user);
  if (request.method === 'POST' && url.pathname === '/api/media-publisher-link') return await apiMediaPublisherLink(request,cfg,user);
  if (url.pathname === '/api/calibration-control') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return request.method === 'GET'
      ? await apiCalibrationControl(request, cfg, user)
      : await sensitiveMutation(()=>apiCalibrationControl(request, cfg, user));
  }
  if (url.pathname === '/api/model-remediation') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return request.method === 'GET'
      ? await apiModelRemediation(request, cfg, user)
      : await sensitiveMutation(()=>apiModelRemediation(request, cfg, user));
  }
  if (request.method === 'GET' && url.pathname === '/api/entitlements') return await apiEntitlements(request, cfg, user);
  if (url.pathname.startsWith('/api/billing/')) {
    if (!cfg.monetizationEnabled) return json({ error: 'Монетизация отложена до финального этапа проекта.' }, 404);
    if (request.method === 'GET' && url.pathname === '/api/billing/plans') return await apiBillingPlans(request, cfg, user);
    if (request.method === 'POST' && url.pathname === '/api/billing/invoice') return await sensitiveMutation(()=>apiBillingInvoice(request, cfg, user));
    if (request.method === 'POST' && url.pathname === '/api/billing/sync') return await sensitiveMutation(()=>apiBillingSync(request, cfg, user));
    if (request.method === 'POST' && url.pathname === '/api/billing/subscription') return await sensitiveMutation(()=>apiBillingSubscription(request, cfg, user));
  }
  if (request.method === 'GET' && url.pathname === '/api/history') return await apiHistory(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/history-analysis') return await apiHistoryAnalysis(request, cfg, user);
  if (url.pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
  if (url.pathname === '/api/favorite-players') return await apiFavoritePlayers(request, cfg, user);
  if (url.pathname === '/api/digest-settings') return await apiDigestSettings(request, cfg, user);
  if (url.pathname === '/api/reminders') return await apiReminders(request, cfg, user);
  if (url.pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
  return json({ error: 'Маршрут не найден.' }, 404);
}
