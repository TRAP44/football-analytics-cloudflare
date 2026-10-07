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
  try {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
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
  const raw=value.trim();
  const calendar=/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  if (!calendar) return null;
  const year=Number(calendar[1]);
  const month=Number(calendar[2]);
  const day=Number(calendar[3]);
  if (!Number.isSafeInteger(year) || month<1 || month>12 || day<1) return null;
  const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
  if (day>maxDay) return null;
  if (
    raw.length>10
    && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
  ) return null;
  const timestamp=Date.parse(raw);
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
    && CONTROL_BOOLEAN_FIELDS.every(key=>typeof safeRead(source,key) === 'boolean')
  );
}

function normalizedLockdownRuntime(runtime) {
  return runtimeShapeValid(runtime)
    ? runtime
    : failClosedRuntimeControls(runtime,'runtime_state_invalid');
}

function requestMethod(request) {
  const raw=safeRead(request,'method');
  if (typeof raw !== 'string') return '';
  const method=raw.trim().toUpperCase();
  return /^[A-Z]+$/.test(method) ? method : '';
}

function requestPath(request) {
  const raw=safeRead(request,'url');
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    return new URL(raw).pathname;
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

  const message=plainObject(safeRead(source,'message'));
  const successful=plainObject(safeRead(message,'successful_payment'));
  if (
    successful
    && nonEmptyString(safeRead(successful,'telegram_payment_charge_id'),256)
  ) return true;

  const refunded=plainObject(safeRead(message,'refunded_payment'));
  if (
    refunded
    && nonEmptyString(safeRead(refunded,'telegram_payment_charge_id'),256)
  ) return true;

  const subscription=plainObject(safeRead(source,'subscription'));
  const subscriptionUser=plainObject(safeRead(subscription,'user'));
  const subscriptionState=safeRead(subscription,'state');
  if (
    subscription
    && nonEmptyString(safeRead(subscription,'invoice_payload'),512)
    && positiveTelegramId(safeRead(subscriptionUser,'id'))
    && (subscriptionState === 'active' || subscriptionState === 'canceled')
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
    revision:positiveRevision(safeRead(source,'revision')),
    updatedAt:cleanTimestamp(safeRead(source,'updatedAt')),
    controlPlaneFailClosed:true,
    controlPlaneReason:cleanReason(reason),
  };
}

export function isSecurityLockdownControls(runtime = {}) {
  const source=plainObject(runtime);
  return Boolean(
    source
    && safeRead(source,'maintenanceMode') === true
    && safeRead(source,'analysisEnabled') === false
    && safeRead(source,'searchEnabled') === false
    && safeRead(source,'liveEnabled') === false
    && safeRead(source,'remindersEnabled') === false
    && safeRead(source,'expandedDataEnabled') === false
    && safeRead(source,'autoSettlementRecoveryEnabled') === false
  );
}

export function runtimeLockdownDecision(request, { runtime = {}, isAdmin = false } = {}) {
  const effectiveRuntime=normalizedLockdownRuntime(runtime);
  if (!isSecurityLockdownControls(effectiveRuntime)) {
    return {blocked:false,active:false};
  }

  const path=requestPath(request);
  const method=requestMethod(request);
  const controlPlaneFailClosed=safeRead(effectiveRuntime,'controlPlaneFailClosed') === true;

  if (path && method && adminRecoveryAllowed(path,method,isAdmin)) {
    return {
      blocked:false,
      active:true,
      recovery:true,
      controlPlaneFailClosed,
    };
  }

  const providerFanout=Boolean(path && isProviderFanoutPath(path));
  const readOnlyAllowed=Boolean(path && (method === 'GET' || method === 'HEAD'));
  if (readOnlyAllowed && !providerFanout) {
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
      controlPlaneFailClosed:safeRead(effectiveRuntime,'controlPlaneFailClosed') === true,
    };
  }

  const source=plainObject(update);
  const preCheckout=plainObject(safeRead(source,'pre_checkout_query'));
  if (preCheckout && nonEmptyString(preCheckout.id,256)) {
    return {
      blocked:true,
      active:true,
      rejectCheckout:true,
      controlPlaneFailClosed:safeRead(effectiveRuntime,'controlPlaneFailClosed') === true,
    };
  }

  return {
    blocked:true,
    active:true,
    controlPlaneFailClosed:safeRead(effectiveRuntime,'controlPlaneFailClosed') === true,
  };
}
