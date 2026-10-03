const PROVIDER_FANOUT_PATHS = new Set([
  '/api/matches',
  '/api/search',
  '/api/tournament',
  '/api/team',
  '/api/team/intelligence',
  '/api/team/squad',
  '/api/match-center',
  '/api/analyze',
  '/api/provider/e2e-validation',
  '/api/provider/probe',
  '/api/provider/coverage-audit',
]);

const ADMIN_RECOVERY_PATHS = new Set([
  '/api/runtime-controls',
  '/api/runtime-controls/rollback',
]);

const CONTROL_PLANE_FAIL_CLOSED_MESSAGE =
  'Аварийный режим безопасности: состояние панели управления временно недоступно.';

export function failClosedRuntimeControls(previous = {}, reason = 'control_plane_unavailable') {
  return {
    ...previous,
    maintenanceMode: true,
    analysisEnabled: false,
    searchEnabled: false,
    liveEnabled: false,
    remindersEnabled: false,
    expandedDataEnabled: false,
    autoSettlementRecoveryEnabled: false,
    message: CONTROL_PLANE_FAIL_CLOSED_MESSAGE,
    revision: Math.max(1, Number(previous?.revision || 1)),
    updatedAt: previous?.updatedAt || null,
    controlPlaneFailClosed: true,
    controlPlaneReason: String(reason || 'control_plane_unavailable').slice(0, 80),
  };
}

export function isSecurityLockdownControls(runtime = {}) {
  return Boolean(runtime.maintenanceMode)
    && runtime.analysisEnabled === false
    && runtime.searchEnabled === false
    && runtime.liveEnabled === false
    && runtime.remindersEnabled === false
    && runtime.expandedDataEnabled === false
    && !Boolean(runtime.autoSettlementRecoveryEnabled);
}

export function runtimeLockdownDecision(request, { runtime = {}, isAdmin = false } = {}) {
  if (!isSecurityLockdownControls(runtime)) {
    return { blocked: false, active: false };
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();

  if (isAdmin && ADMIN_RECOVERY_PATHS.has(path)) {
    return { blocked: false, active: true, recovery: true };
  }

  const providerFanout = PROVIDER_FANOUT_PATHS.has(path);
  const safeRead = method === 'GET' || method === 'HEAD';
  const controlPlaneFailClosed = Boolean(runtime.controlPlaneFailClosed);
  if (safeRead && !providerFanout) {
    return { blocked: false, active: true, readOnly: true };
  }

  return {
    blocked: true,
    active: true,
    providerFanout,
    status: 503,
    code: controlPlaneFailClosed
      ? 'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE'
      : providerFanout ? 'SECURITY_LOCKDOWN_PROVIDER_PAUSED' : 'SECURITY_LOCKDOWN_WRITE_BLOCKED',
    category: 'security_lockdown',
    controlPlaneFailClosed,
    message: controlPlaneFailClosed
      ? CONTROL_PLANE_FAIL_CLOSED_MESSAGE
      : providerFanout
        ? 'Аварийный режим безопасности временно приостановил обращения к внешнему футбольному источнику.'
        : 'Аварийный режим безопасности временно перевёл приложение в режим только для чтения.',
  };
}


export function telegramLockdownDecision(update = {}, { runtime = {} } = {}) {
  if (!isSecurityLockdownControls(runtime)) {
    return { blocked: false, active: false };
  }

  if (update?.message?.successful_payment || update?.message?.refunded_payment || update?.subscription) {
    return { blocked: false, active: true, paymentReconciliation: true };
  }

  if (update?.pre_checkout_query) {
    return { blocked: true, active: true, rejectCheckout: true };
  }

  return { blocked: true, active: true };
}
