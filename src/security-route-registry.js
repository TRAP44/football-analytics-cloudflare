const READ_METHODS = new Set(['GET','HEAD']);
const MAX_PATH_LENGTH = 512;

function positiveInteger(value,fallback,min,max) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return fallback;
  return value >= min && value <= max ? value : fallback;
}

function normalizePath(pathname='') {
  if (typeof pathname !== 'string') return '';
  if (!pathname || pathname.length > MAX_PATH_LENGTH) return '';
  if (pathname !== pathname.trim()) return '';
  if (!pathname.startsWith('/api/')) return '';
  if (/[\\?#\u0000-\u001f\u007f-\u009f]/u.test(pathname)) return '';
  return pathname;
}

function normalizedMethod(method) {
  if (typeof method !== 'string') return '';
  const value=method.trim().toUpperCase();
  return /^[A-Z]+$/.test(value) ? value : '';
}

function routeLabel(pathname='') {
  const path=normalizePath(pathname);
  if (!path) return 'admin-route';
  const label=path
    .replace(/^\/api\//,'')
    .replace(/[^a-z0-9]+/gi,'-')
    .replace(/^-+|-+$/g,'')
    .toLowerCase()
    .slice(0,74);
  return label ? `admin-${label}` : 'admin-route';
}

function freezeRate(rate={}) {
  const source=rate && typeof rate === 'object' && !Array.isArray(rate) ? rate : {};
  const label=typeof source.label === 'string'
    && /^[a-z0-9][a-z0-9-]{0,79}$/.test(source.label)
    ? source.label
    : '';
  return Object.freeze({
    localLimit:positiveInteger(source.localLimit,6,1,1000),
    localWindowMs:positiveInteger(source.localWindowMs,30_000,1000,3_600_000),
    distributedLimit:positiveInteger(source.distributedLimit,12,1,1000),
    distributedWindowSeconds:positiveInteger(source.distributedWindowSeconds,60,1,3600),
    ...(label ? {label} : {}),
  });
}

const DEFAULT_RATE = freezeRate({
  localLimit:6,
  localWindowMs:30_000,
  distributedLimit:12,
  distributedWindowSeconds:60,
});

const ADMIN_DIAGNOSTIC_RATE = freezeRate({
  ...DEFAULT_RATE,
  label:'admin-diagnostics',
});

function exactRule(path,adminAuthorization,rate=null) {
  const normalized=normalizePath(path);
  if (!normalized) throw new TypeError(`Invalid security route path: ${path}`);
  return Object.freeze({
    path:normalized,
    adminAuthorization:adminAuthorization === true,
    ...(rate ? {rate:freezeRate(rate)} : {}),
  });
}

function prefixRule(prefix,adminAuthorization,rate=null) {
  const normalized=normalizePath(prefix);
  if (!normalized || !normalized.endsWith('/')) {
    throw new TypeError(`Invalid security route prefix: ${prefix}`);
  }
  return Object.freeze({
    prefix:normalized,
    adminAuthorization:adminAuthorization === true,
    ...(rate ? {rate:freezeRate(rate)} : {}),
  });
}

const EXACT_RULES = Object.freeze([
  exactRule('/api/beta-dashboard',true,{...DEFAULT_RATE,label:'beta-dashboard'}),
  exactRule('/api/calibration-control',true),
  exactRule('/api/data-integrity',true),
  exactRule('/api/diagnostics',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/launch-funnel',true),
  exactRule('/api/media-publisher-link',false),
  exactRule('/api/model-quality',true),
  exactRule('/api/model-remediation',true,{localLimit:4,localWindowMs:60_000,distributedLimit:4,distributedWindowSeconds:60,label:'model-remediation'}),
  exactRule('/api/phase5-dashboard',true),
  exactRule('/api/post-deploy-regression-response',true),
  exactRule('/api/production-monitor',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/production-readiness',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/provider',true,{...DEFAULT_RATE,label:'provider'}),
  exactRule('/api/rc-regression',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/recovery-incident-ack',true),
  exactRule('/api/release-monitor',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/release-readiness',true,ADMIN_DIAGNOSTIC_RATE),
  exactRule('/api/reminder-health',true,{...DEFAULT_RATE,label:'reminder-health'}),
  exactRule('/api/runtime-controls',true,{...DEFAULT_RATE,label:'runtime-controls'}),
  exactRule('/api/runtime-controls/rollback',true,{localLimit:3,localWindowMs:30_000,distributedLimit:6,distributedWindowSeconds:60,label:'runtime-rollback'}),
  exactRule('/api/provider/e2e-validation',true,{localLimit:1,localWindowMs:30_000,distributedLimit:2,distributedWindowSeconds:60,label:'provider-e2e'}),
  exactRule('/api/provider/coverage-audit',true,{localLimit:2,localWindowMs:30_000,distributedLimit:4,distributedWindowSeconds:60,label:'coverage-audit'}),
  exactRule('/api/provider/probe',true,{localLimit:3,localWindowMs:30_000,distributedLimit:6,distributedWindowSeconds:60,label:'provider-probe'}),
]);

const PREFIX_RULES = Object.freeze([
  prefixRule('/api/admin/',true,{localLimit:6,localWindowMs:30_000,distributedLimit:10,distributedWindowSeconds:60,label:'admin-write'}),
  prefixRule('/api/provider/',true,{...DEFAULT_RATE,label:'provider-admin'}),
  prefixRule('/api/runtime-controls/',true,{...DEFAULT_RATE,label:'runtime-controls'}),
]);

function assertRegistryIntegrity() {
  const exactPaths=new Set();
  for (const rule of EXACT_RULES) {
    if (exactPaths.has(rule.path)) throw new Error(`Duplicate security route: ${rule.path}`);
    exactPaths.add(rule.path);
  }

  const prefixes=new Set();
  for (const rule of PREFIX_RULES) {
    if (prefixes.has(rule.prefix)) throw new Error(`Duplicate security route prefix: ${rule.prefix}`);
    prefixes.add(rule.prefix);
  }
}
assertRegistryIntegrity();

export function adminSensitiveRouteRule(pathname='') {
  const path=normalizePath(pathname);
  if (!path) return null;
  const exact=EXACT_RULES.find(rule=>rule.path===path);
  if (exact) return exact;
  return PREFIX_RULES.find(rule=>path.startsWith(rule.prefix)) || null;
}

export function isAdminSensitivePath(pathname='') {
  return adminSensitiveRouteRule(pathname) !== null;
}

export function requiresAdminAuthorizationPath(pathname='') {
  return adminSensitiveRouteRule(pathname)?.adminAuthorization === true;
}

export function usesStrictTelegramFreshness(pathname='') {
  return isAdminSensitivePath(pathname);
}

function rateForRule(rule, pathname) {
  const configured=rule?.rate || DEFAULT_RATE;
  const configuredLabel=typeof configured.label === 'string'
    && /^[a-z0-9][a-z0-9-]{0,79}$/.test(configured.label)
    ? configured.label
    : routeLabel(pathname);
  return Object.freeze({
    label:configuredLabel,
    localLimit:positiveInteger(configured.localLimit,DEFAULT_RATE.localLimit,1,1000),
    localWindowMs:positiveInteger(configured.localWindowMs,DEFAULT_RATE.localWindowMs,1000,3_600_000),
    distributedLimit:positiveInteger(configured.distributedLimit,DEFAULT_RATE.distributedLimit,1,1000),
    distributedWindowSeconds:positiveInteger(
      configured.distributedWindowSeconds,
      DEFAULT_RATE.distributedWindowSeconds,
      1,
      3600,
    ),
  });
}

export function privilegedLocalRatePolicy(pathname='') {
  const rule=adminSensitiveRouteRule(pathname);
  if (!rule) return null;
  const rate=rateForRule(rule,pathname);
  return Object.freeze({
    label:rate.label,
    limit:rate.localLimit,
    windowMs:rate.localWindowMs,
  });
}

export function privilegedDistributedRatePolicy(pathname='', method='GET') {
  const rule=adminSensitiveRouteRule(pathname);
  if (!rule) return null;
  const methodValue=normalizedMethod(method);
  const rate=rateForRule(rule,pathname);
  return Object.freeze({
    label:rate.label,
    limit:rate.distributedLimit,
    windowSeconds:rate.distributedWindowSeconds,
    mutation:methodValue ? !READ_METHODS.has(methodValue) : true,
  });
}

export function adminSensitivePathInventory() {
  return Object.freeze(EXACT_RULES.map(rule=>Object.freeze({
    path:rule.path,
    adminAuthorization:rule.adminAuthorization === true,
  })));
}

export function privilegedRatePolicyInventory() {
  return Object.freeze(EXACT_RULES.map(rule=>{
    const rate=rateForRule(rule,rule.path);
    return Object.freeze({
      path:rule.path,
      label:rate.label,
      localLimit:rate.localLimit,
      localWindowMs:rate.localWindowMs,
      distributedLimit:rate.distributedLimit,
      distributedWindowSeconds:rate.distributedWindowSeconds,
    });
  }));
}
