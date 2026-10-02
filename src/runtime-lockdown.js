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
  if (safeRead && !providerFanout) {
    return { blocked: false, active: true, readOnly: true };
  }

  return {
    blocked: true,
    active: true,
    providerFanout,
    status: 503,
    code: providerFanout ? 'SECURITY_LOCKDOWN_PROVIDER_PAUSED' : 'SECURITY_LOCKDOWN_WRITE_BLOCKED',
    category: 'security_lockdown',
    message: providerFanout
      ? 'Аварийный режим безопасности временно приостановил обращения к внешнему футбольному источнику.'
      : 'Аварийный режим безопасности временно перевёл приложение в режим только для чтения.',
  };
}
