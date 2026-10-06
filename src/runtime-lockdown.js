import { isProviderFanoutPath } from './provider-route-registry.js';

const ADMIN_RECOVERY_METHODS = Object.freeze({
  '/api/runtime-controls': new Set(['GET','POST','PATCH']),
  '/api/runtime-controls/rollback': new Set(['POST']),
});
const CONTROL_BOOLEAN_FIELDS = Object.freeze([
  'maintenanceMode',
  'analysisEnabled',
  'searchEnabled',
  'liveEnabled',
  'remindersEnabled',
  'expandedDataEnabled',
  'autoSettlementRecoveryEnabled',
]);
const MAX_REVISION = 2147483647;

const CONTROL_PLANE_FAIL_CLOSED_MESSAGE =
  'Аварийный режим безопасности: состояние панели управления временно недоступно.';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveRevision(value) {
  const revision=integerCandidate(value);
  return revision !== null && revision >= 1 && revision <= MAX_REVISION ? revision : 1;
}

function cleanReason(value,fallback='control_plane_unavailable') {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,80);
}

function cleanTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  if (!Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

function runtimeShapeValid(runtime) {
  const source=plainObject(runtime);
  return Boolean(
    source
    && CONTROL_BOOLEAN_FIELDS.every(key=>typeof source[key] === 'boolean')
  );
}

function normalizedLockdownRuntime(runtime) {
  return runtimeShapeValid(runtime)
    ? runtime
    : failClosedRuntimeControls(runtime,'runtime_state_invalid');
}

function requestMethod(request) {
  if (typeof request?.method !== 'string') return '';
  const method=request.method.trim().toUpperCase();
  return /^[A-Z]+$/.test(method) ? method : '';
}

function requestPath(request) {
  if (typeof request?.url !== 'string' || !request.url.trim()) return '';
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

function adminRecoveryAllowed(path,method,isAdmin) {
  if (isAdmin !== true) return false;
  const methods=ADMIN_RECOVERY_METHODS[path];
  return Boolean(methods && methods.has(method));
}

function nonEmptyString(value,maxLength=512) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function positiveTelegramId(value) {
  const id=integerCandidate(value);
  return id !== null && id > 0 ? id : 0;
}

function paymentReconciliationUpdate(update) {
  const source=plainObject(update);
  if (!source) return false;

  const message=plainObject(source.message);
  const successful=plainObject(message?.successful_payment);
  if (successful && nonEmptyString(successful.telegram_payment_charge_id,256)) return true;

  const refunded=plainObject(message?.refunded_payment);
  if (refunded && nonEmptyString(refunded.telegram_payment_charge_id,256)) return true;

  const subscription=plainObject(source.subscription);
  const subscriptionUser=plainObject(subscription?.user);
  if (
    subscription
    && nonEmptyString(subscription.invoice_payload,512)
    && positiveTelegramId(subscriptionUser?.id)
    && (subscription.state === 'active' || subscription.state === 'canceled')
  ) return true;

  return false;
}

export function failClosedRuntimeControls(previous = {}, reason = 'control_plane_unavailable') {
  const source=plainObject(previous) || {};
  return {
    maintenanceMode:true,
    analysisEnabled:false,
    searchEnabled:false,
    liveEnabled:false,
    remindersEnabled:false,
    expandedDataEnabled:false,
    autoSettlementRecoveryEnabled:false,
    message:CONTROL_PLANE_FAIL_CLOSED_MESSAGE,
    revision:positiveRevision(source.revision),
    updatedAt:cleanTimestamp(source.updatedAt),
    controlPlaneFailClosed:true,
    controlPlaneReason:cleanReason(reason),
  };
}

export function isSecurityLockdownControls(runtime = {}) {
  const source=plainObject(runtime);
  return Boolean(
    source
    && source.maintenanceMode === true
    && source.analysisEnabled === false
    && source.searchEnabled === false
    && source.liveEnabled === false
    && source.remindersEnabled === false
    && source.expandedDataEnabled === false
    && source.autoSettlementRecoveryEnabled === false
  );
}

export function runtimeLockdownDecision(request, { runtime = {}, isAdmin = false } = {}) {
  const effectiveRuntime=normalizedLockdownRuntime(runtime);
  if (!isSecurityLockdownControls(effectiveRuntime)) {
    return {blocked:false,active:false};
  }

  const path=requestPath(request);
  const method=requestMethod(request);
  const controlPlaneFailClosed=effectiveRuntime.controlPlaneFailClosed === true;

  if (path && method && adminRecoveryAllowed(path,method,isAdmin)) {
    return {
      blocked:false,
      active:true,
      recovery:true,
      controlPlaneFailClosed,
    };
  }

  const providerFanout=Boolean(path && isProviderFanoutPath(path));
  const safeRead=Boolean(path && (method === 'GET' || method === 'HEAD'));
  if (safeRead && !providerFanout) {
    return {
      blocked:false,
      active:true,
      readOnly:true,
      controlPlaneFailClosed,
    };
  }

  return {
    blocked:true,
    active:true,
    providerFanout,
    status:503,
    code:controlPlaneFailClosed
      ? 'SECURITY_LOCKDOWN_CONTROL_PLANE_UNAVAILABLE'
      : providerFanout
        ? 'SECURITY_LOCKDOWN_PROVIDER_PAUSED'
        : 'SECURITY_LOCKDOWN_WRITE_BLOCKED',
    category:'security_lockdown',
    controlPlaneFailClosed,
    ...(path ? {} : {invalidRequest:true}),
    message:controlPlaneFailClosed
      ? CONTROL_PLANE_FAIL_CLOSED_MESSAGE
      : providerFanout
        ? 'Аварийный режим безопасности временно приостановил обращения к внешнему футбольному источнику.'
        : 'Аварийный режим безопасности временно перевёл приложение в режим только для чтения.',
  };
}

export function telegramLockdownDecision(update = {}, { runtime = {} } = {}) {
  const effectiveRuntime=normalizedLockdownRuntime(runtime);
  if (!isSecurityLockdownControls(effectiveRuntime)) {
    return {blocked:false,active:false};
  }

  if (paymentReconciliationUpdate(update)) {
    return {
      blocked:false,
      active:true,
      paymentReconciliation:true,
      controlPlaneFailClosed:effectiveRuntime.controlPlaneFailClosed === true,
    };
  }

  const source=plainObject(update);
  const preCheckout=plainObject(source?.pre_checkout_query);
  if (preCheckout && nonEmptyString(preCheckout.id,256)) {
    return {
      blocked:true,
      active:true,
      rejectCheckout:true,
      controlPlaneFailClosed:effectiveRuntime.controlPlaneFailClosed === true,
    };
  }

  return {
    blocked:true,
    active:true,
    controlPlaneFailClosed:effectiveRuntime.controlPlaneFailClosed === true,
  };
}
