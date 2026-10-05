const PROVIDER_LOCKDOWN_POLICY = 'provider_fanout';

const PROVIDER_BACKED_ROUTES = Object.freeze([
  Object.freeze({ method:'GET', path:'/api/search', handler:'apiSearch', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/matches', handler:'apiMatches', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/tournament', handler:'apiTournament', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/team', handler:'apiTeam', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/team/intelligence', handler:'apiTeamIntelligence', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/team/squad', handler:'apiTeamSquad', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/match-center', handler:'apiMatchCenter', lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'POST', path:'/api/analyze', handler:'apiAnalyze', userScoped:true, lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/provider/e2e-validation', handler:'apiProviderE2EValidation', adminOnly:true, lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/provider/probe', handler:'apiProviderProbe', adminOnly:true, lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
  Object.freeze({ method:'GET', path:'/api/provider/coverage-audit', handler:'apiProviderCoverageAudit', adminOnly:true, lockdownPolicy:PROVIDER_LOCKDOWN_POLICY }),
]);

function normalizeMethod(method='GET') {
  if (typeof method !== 'string') return '';
  const value=method.trim();
  return value ? value.toUpperCase() : 'GET';
}

function normalizePath(pathname='') {
  if (typeof pathname !== 'string') return '';
  const path=pathname.trim();
  if (!path) return '/';
  return path.startsWith('/') ? path : '/' + path;
}

function isCanonicalProviderPath(path) {
  return /^\/api(?:\/[A-Za-z0-9._~-]+)+$/.test(path)
    && !path.split('/').some(segment=>segment==='.' || segment==='..');
}

function optionalBooleanIsValid(route,key) {
  return route?.[key] === undefined || typeof route[key] === 'boolean';
}

export function validateProviderBackedRouteDefinitions(definitions = PROVIDER_BACKED_ROUTES) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error('Provider-backed route registry must not be empty.');
  }

  const seen=new Set();
  for (const route of definitions) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error('Provider-backed route definition must be an object.');
    }

    const method=normalizeMethod(route.method);
    const path=normalizePath(route.path);
    const handler=typeof route.handler === 'string' ? route.handler.trim() : '';
    const key=`${method || 'INVALID'} ${path || 'INVALID'}`;

    if (!['GET','POST'].includes(method)) {
      throw new Error(`Provider-backed route ${key} uses unsupported method.`);
    }
    if (route.method !== method) {
      throw new Error(`Provider-backed route ${key} must use a canonical uppercase method.`);
    }
    if (!isCanonicalProviderPath(path) || route.path !== path) {
      throw new Error(`Provider-backed route ${key} must use a canonical API pathname.`);
    }
    if (!/^api[A-Z][A-Za-z0-9]*$/.test(handler) || route.handler !== handler) {
      throw new Error(`Provider-backed route ${key} is missing a valid canonical handler.`);
    }
    if (!optionalBooleanIsValid(route,'adminOnly') || !optionalBooleanIsValid(route,'userScoped')) {
      throw new Error(`Provider-backed route ${key} has invalid authorization flags.`);
    }
    if (route.adminOnly === true && route.userScoped === true) {
      throw new Error(`Provider-backed route ${key} cannot be both admin-only and user-scoped.`);
    }
    if (route?.lockdownPolicy !== PROVIDER_LOCKDOWN_POLICY) {
      throw new Error(`Provider-backed route ${key} is missing explicit runtime lockdown policy.`);
    }
    if (seen.has(key)) {
      throw new Error(`Provider-backed route ${key} is duplicated.`);
    }
    seen.add(key);
  }
  return true;
}

validateProviderBackedRouteDefinitions(PROVIDER_BACKED_ROUTES);

const PROVIDER_FANOUT_PATHS = new Set(PROVIDER_BACKED_ROUTES.map(route=>route.path));
const PROVIDER_ROUTE_BY_KEY = new Map(
  PROVIDER_BACKED_ROUTES.map(route=>[`${route.method} ${route.path}`,route]),
);

export function providerBackedRouteDefinition(pathname='', method='GET') {
  const normalizedMethod=normalizeMethod(method);
  const normalizedPath=normalizePath(pathname);
  if (!normalizedMethod || !normalizedPath) return null;
  return PROVIDER_ROUTE_BY_KEY.get(`${normalizedMethod} ${normalizedPath}`) || null;
}

export function isProviderFanoutPath(pathname='') {
  const normalizedPath=normalizePath(pathname);
  return Boolean(normalizedPath && PROVIDER_FANOUT_PATHS.has(normalizedPath));
}

export function providerBackedRouteInventory() {
  return PROVIDER_BACKED_ROUTES.map(route=>Object.freeze({ ...route }));
}
