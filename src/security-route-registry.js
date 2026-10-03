const MUTATION_METHODS = new Set(['POST','PUT','PATCH','DELETE']);

const DEFAULT_RATE = Object.freeze({
  localLimit: 6,
  localWindowMs: 30_000,
  distributedLimit: 12,
  distributedWindowSeconds: 60,
});

const ADMIN_DIAGNOSTIC_RATE = Object.freeze({
  ...DEFAULT_RATE,
  label: 'admin-diagnostics',
});

const EXACT_RULES = Object.freeze([
  Object.freeze({ path:'/api/beta-dashboard', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'beta-dashboard'} }),
  Object.freeze({ path:'/api/calibration-control', adminAuthorization:true }),
  Object.freeze({ path:'/api/data-integrity', adminAuthorization:true }),
  Object.freeze({ path:'/api/diagnostics', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/launch-funnel', adminAuthorization:true }),
  Object.freeze({ path:'/api/media-publisher-link', adminAuthorization:false }),
  Object.freeze({ path:'/api/model-quality', adminAuthorization:true }),
  Object.freeze({ path:'/api/model-remediation', adminAuthorization:true, rate:{localLimit:4,localWindowMs:60_000,distributedLimit:4,distributedWindowSeconds:60,label:'model-remediation'} }),
  Object.freeze({ path:'/api/phase5-dashboard', adminAuthorization:true }),
  Object.freeze({ path:'/api/post-deploy-regression-response', adminAuthorization:true }),
  Object.freeze({ path:'/api/production-monitor', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/production-readiness', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/provider', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'provider'} }),
  Object.freeze({ path:'/api/rc-regression', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/recovery-incident-ack', adminAuthorization:true }),
  Object.freeze({ path:'/api/release-monitor', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/release-readiness', adminAuthorization:true, rate:ADMIN_DIAGNOSTIC_RATE }),
  Object.freeze({ path:'/api/reminder-health', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'reminder-health'} }),
  Object.freeze({ path:'/api/runtime-controls', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'runtime-controls'} }),
  Object.freeze({ path:'/api/runtime-controls/rollback', adminAuthorization:true, rate:{localLimit:3,localWindowMs:30_000,distributedLimit:6,distributedWindowSeconds:60,label:'runtime-rollback'} }),
  Object.freeze({ path:'/api/provider/e2e-validation', adminAuthorization:true, rate:{localLimit:1,localWindowMs:30_000,distributedLimit:2,distributedWindowSeconds:60,label:'provider-e2e'} }),
  Object.freeze({ path:'/api/provider/coverage-audit', adminAuthorization:true, rate:{localLimit:2,localWindowMs:30_000,distributedLimit:4,distributedWindowSeconds:60,label:'coverage-audit'} }),
  Object.freeze({ path:'/api/provider/probe', adminAuthorization:true, rate:{localLimit:3,localWindowMs:30_000,distributedLimit:6,distributedWindowSeconds:60,label:'provider-probe'} }),
]);

const PREFIX_RULES = Object.freeze([
  Object.freeze({ prefix:'/api/admin/', adminAuthorization:true, rate:{localLimit:6,localWindowMs:30_000,distributedLimit:10,distributedWindowSeconds:60,label:'admin-write'} }),
  Object.freeze({ prefix:'/api/provider/', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'provider-admin'} }),
  Object.freeze({ prefix:'/api/runtime-controls/', adminAuthorization:true, rate:{...DEFAULT_RATE,label:'runtime-controls'} }),
]);

function normalizePath(pathname='') {
  const value=String(pathname || '');
  if (!value.startsWith('/')) return '/' + value;
  return value;
}

function routeLabel(pathname='') {
  return 'admin-' + normalizePath(pathname)
    .replace(/^\/api\//,'')
    .replace(/[^a-z0-9]+/gi,'-')
    .replace(/^-+|-+$/g,'')
    .toLowerCase()
    .slice(0,80);
}

export function adminSensitiveRouteRule(pathname='') {
  const path=normalizePath(pathname);
  const exact=EXACT_RULES.find(rule=>rule.path===path);
  if (exact) return exact;
  return PREFIX_RULES.find(rule=>path.startsWith(rule.prefix)) || null;
}

export function isAdminSensitivePath(pathname='') {
  return Boolean(adminSensitiveRouteRule(pathname));
}

export function requiresAdminAuthorizationPath(pathname='') {
  return Boolean(adminSensitiveRouteRule(pathname)?.adminAuthorization);
}

export function usesStrictTelegramFreshness(pathname='') {
  return isAdminSensitivePath(pathname);
}

function rateForRule(rule, pathname) {
  const configured=rule?.rate || DEFAULT_RATE;
  return {
    label:String(configured.label || routeLabel(pathname)),
    localLimit:Number(configured.localLimit || DEFAULT_RATE.localLimit),
    localWindowMs:Number(configured.localWindowMs || DEFAULT_RATE.localWindowMs),
    distributedLimit:Number(configured.distributedLimit || DEFAULT_RATE.distributedLimit),
    distributedWindowSeconds:Number(configured.distributedWindowSeconds || DEFAULT_RATE.distributedWindowSeconds),
  };
}

export function privilegedLocalRatePolicy(pathname='') {
  const rule=adminSensitiveRouteRule(pathname);
  if (!rule) return null;
  const rate=rateForRule(rule,pathname);
  return {label:rate.label,limit:rate.localLimit,windowMs:rate.localWindowMs};
}

export function privilegedDistributedRatePolicy(pathname='', method='GET') {
  const rule=adminSensitiveRouteRule(pathname);
  if (!rule) return null;
  const normalizedMethod=String(method || 'GET').toUpperCase();
  const rate=rateForRule(rule,pathname);
  return {
    label:rate.label,
    limit:rate.distributedLimit,
    windowSeconds:rate.distributedWindowSeconds,
    mutation:MUTATION_METHODS.has(normalizedMethod),
  };
}

export function adminSensitivePathInventory() {
  return EXACT_RULES.map(rule=>({
    path:rule.path,
    adminAuthorization:Boolean(rule.adminAuthorization),
  }));
}

export function privilegedRatePolicyInventory() {
  return EXACT_RULES.map(rule=>{
    const rate=rateForRule(rule,rule.path);
    return {
      path:rule.path,
      label:rate.label,
      localLimit:rate.localLimit,
      localWindowMs:rate.localWindowMs,
      distributedLimit:rate.distributedLimit,
      distributedWindowSeconds:rate.distributedWindowSeconds,
    };
  });
}
