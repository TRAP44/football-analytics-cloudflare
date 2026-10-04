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
  return String(method || 'GET').toUpperCase();
}

function normalizePath(pathname='') {
  const path=String(pathname || '').trim();
  return path.startsWith('/') ? path : '/' + path;
}

export function validateProviderBackedRouteDefinitions(definitions = PROVIDER_BACKED_ROUTES) {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    throw new Error('Provider-backed route registry must not be empty.');
  }

  const seen=new Set();
  for (const route of definitions) {
    const method=normalizeMethod(route?.method);
    const path=normalizePath(route?.path);
    const handler=String(route?.handler || '').trim();
    const key=`${method} ${path}`;

    if (!['GET','POST'].includes(method)) {
      throw new Error(`Provider-backed route ${key} uses unsupported method.`);
    }
    if (!path.startsWith('/api/')) {
      throw new Error(`Provider-backed route ${key} must be an API path.`);
    }
    if (!/^api[A-Z][A-Za-z0-9]*$/.test(handler)) {
      throw new Error(`Provider-backed route ${key} is missing a valid handler.`);
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
  return PROVIDER_ROUTE_BY_KEY.get(`${normalizeMethod(method)} ${normalizePath(pathname)}`) || null;
}

export function isProviderFanoutPath(pathname='') {
  return PROVIDER_FANOUT_PATHS.has(normalizePath(pathname));
}

export function providerBackedRouteInventory() {
  return PROVIDER_BACKED_ROUTES.map(route=>({ ...route }));
}
