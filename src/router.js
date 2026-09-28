// Phase 2 router boundary: route selection only. Authentication, beta access,
// runtime controls, burst protection and route error compatibility stay in the composition root.
export async function dispatchApiRoute(request, url, cfg, user, deps) {
  const {
    adminForbidden,
    apiAiTrackRecord,
    apiAnalyze,
    apiBetaDashboard,
    apiBetaFeedback,
    apiChannelPublisherTest,
    apiPhase5Dashboard,
    apiBillingInvoice,
    apiBillingPlans,
    apiBillingSubscription,
    apiBillingSync,
    apiCalibrationControl,
    apiClientTelemetry,
    apiDataIntegrity,
    apiDiagnostics,
    apiFavorites,
    apiFixtureShareLink,
    apiHistory,
    apiHistoryAnalysis,
    apiLaunchFunnel,
    apiMatchCenter,
    apiMatches,
    apiMe,
    apiMediaPublisherLink,
    apiModelQuality,
    apiModelRemediation,
    apiNewsImpactRecoveryIncidentAck,
    apiPreferences,
    apiProductionMonitor,
    apiProductionReadiness,
    apiProviderBudget,
    apiProviderCoverageAudit,
    apiProviderE2EValidation,
    apiProviderProbe,
    apiRcRegression,
    apiReleaseMonitor,
    apiReleaseReadiness,
    apiReminderHealth,
    apiReminders,
    apiRuntimeControls,
    apiRuntimeRollback,
    apiSearch,
    apiTeam,
    apiTeamIntelligence,
    apiTeamSquad,
    apiTournament,
    isAdminUser,
    json,
    loadLastProviderE2E,
    memory,
    providerBudgetProfile,
    providerSnapshot,
    providerSloReport,
    providerTransitionProfile,
    publicDataCapabilities,
  } = deps;

  if (request.method === 'GET' && url.pathname === '/api/me') return await apiMe(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/data-capabilities') return json({ dataCapabilities: publicDataCapabilities() });
  if (request.method === 'POST' && url.pathname === '/api/client-telemetry') return await apiClientTelemetry(request, cfg, user);
  if (request.method === 'POST' && url.pathname === '/api/beta-feedback') return await apiBetaFeedback(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/beta-dashboard') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiBetaDashboard(request, cfg);
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/channel-publisher/test') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiChannelPublisherTest(request, cfg, user);
  }
  if (request.method === 'GET' && url.pathname === '/api/phase5-dashboard') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiPhase5Dashboard(request, cfg);
  }
  if (url.pathname === '/api/runtime-controls') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiRuntimeControls(request, cfg, user);
  }
  if (url.pathname === '/api/runtime-controls/rollback') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiRuntimeRollback(request, cfg, user);
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
  if (request.method === 'GET' && url.pathname === '/api/provider/e2e-validation') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProviderE2EValidation(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/provider/probe') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProviderProbe(request, cfg);
  }
  if (request.method === 'GET' && url.pathname === '/api/provider/coverage-audit') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiProviderCoverageAudit(request, cfg);
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
    return await apiNewsImpactRecoveryIncidentAck(request, cfg, user);
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
    return await apiCalibrationControl(request, cfg, user);
  }
  if (url.pathname === '/api/model-remediation') {
    if (!isAdminUser(user, cfg)) return adminForbidden();
    return await apiModelRemediation(request, cfg, user);
  }
  if (url.pathname.startsWith('/api/billing/')) {
    if (!cfg.monetizationEnabled) return json({ error: 'Монетизация отложена до финального этапа проекта.' }, 404);
    if (request.method === 'GET' && url.pathname === '/api/billing/plans') return await apiBillingPlans(request, cfg, user);
    if (request.method === 'POST' && url.pathname === '/api/billing/invoice') return await apiBillingInvoice(request, cfg, user);
    if (request.method === 'POST' && url.pathname === '/api/billing/sync') return await apiBillingSync(request, cfg, user);
    if (request.method === 'POST' && url.pathname === '/api/billing/subscription') return await apiBillingSubscription(request, cfg, user);
  }
  if (request.method === 'GET' && url.pathname === '/api/search') return await apiSearch(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/matches') return await apiMatches(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/tournament') return await apiTournament(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/team') return await apiTeam(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/team/intelligence') return await apiTeamIntelligence(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/team/squad') return await apiTeamSquad(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/match-center') return await apiMatchCenter(request, cfg);
  if (request.method === 'GET' && url.pathname === '/api/history') return await apiHistory(request, cfg, user);
  if (request.method === 'GET' && url.pathname === '/api/history-analysis') return await apiHistoryAnalysis(request, cfg, user);
  if (url.pathname === '/api/favorites') return await apiFavorites(request, cfg, user);
  if (url.pathname === '/api/reminders') return await apiReminders(request, cfg, user);
  if (url.pathname === '/api/preferences') return await apiPreferences(request, cfg, user);
  if (request.method === 'POST' && url.pathname === '/api/analyze') return await apiAnalyze(request, cfg, user);
  return json({ error: 'Маршрут не найден.' }, 404);
}
