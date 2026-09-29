function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function failedCompositeShape(status, connectivity = { ok: true, status: 'ok', attempts: 1 }) {
  return {
    valid: false,
    ok: false,
    status: 'not_ready',
    rpcStatus: status,
    connectivity: {
      ok: Boolean(connectivity?.ok),
      status: String(connectivity?.status || 'unknown'),
      attempts: Number(connectivity?.attempts || 1),
    },
    schema: {
      ok: false,
      status: status === 'malformed_response' ? 'malformed_response' : 'composite_unavailable',
      fingerprint: { ok: false, status: 'unavailable', fingerprint: '', expected: '' },
    },
    backendSecurity: {
      ok: false,
      status: status === 'malformed_response' ? 'malformed_response' : 'composite_unavailable',
    },
    authFailures: { available: false, count: 0 },
    failureReasons: [status],
  };
}

export function normalizeCompositeReadinessResponse(raw, expectedFingerprint = '') {
  if (!isObject(raw)
      || typeof raw.ok !== 'boolean'
      || !isObject(raw.connectivity)
      || !isObject(raw.schema)
      || !isObject(raw.schema.fingerprint)
      || !isObject(raw.backendSecurity)
      || !isObject(raw.recentSupabaseAuthFailures)) {
    return failedCompositeShape('malformed_response');
  }

  const fingerprint = String(raw.schema.fingerprint.fingerprint || '');
  const expected = String(expectedFingerprint || '');
  const fingerprintOk = raw.schema.fingerprint.ok === true
    && fingerprint.length > 0
    && fingerprint === expected;
  const connectivityOk = raw.connectivity.ok === true;
  const schemaOk = raw.schema.ok === true && fingerprintOk;
  const securityOk = raw.backendSecurity.ok === true;
  const authCount = Number(raw.recentSupabaseAuthFailures.count);
  const authAvailable = raw.recentSupabaseAuthFailures.available === true
    && Number.isFinite(authCount)
    && authCount >= 0;

  const valid = typeof raw.schema.status === 'string'
    && typeof raw.backendSecurity.status === 'string'
    && typeof raw.connectivity.status === 'string'
    && authAvailable;

  if (!valid) return failedCompositeShape('malformed_response');

  const ok = Boolean(
    raw.ok === true
    && connectivityOk
    && schemaOk
    && securityOk
    && authCount === 0
  );

  return {
    valid: true,
    ok,
    status: ok ? 'ready' : 'not_ready',
    rpcStatus: 'ok',
    connectivity: {
      ok: connectivityOk,
      status: String(raw.connectivity.status || (connectivityOk ? 'ok' : 'unknown')),
      attempts: 1,
    },
    schema: {
      ...raw.schema,
      ok: schemaOk,
      status: schemaOk ? 'ok' : String(raw.schema.status || 'drift'),
      fingerprint: {
        ...raw.schema.fingerprint,
        ok: fingerprintOk,
        fingerprint,
        expected,
      },
    },
    backendSecurity: {
      ...raw.backendSecurity,
      ok: securityOk,
      status: securityOk ? 'ok' : String(raw.backendSecurity.status || 'violations'),
    },
    authFailures: {
      available: true,
      count: authCount,
      windowMinutes: Number(raw.recentSupabaseAuthFailures.windowMinutes || 0),
    },
    failureReasons: Array.isArray(raw.failureReasons)
      ? raw.failureReasons.map(String)
      : [],
  };
}

export function createCompositeReadinessRuntime({
  hasSupabase,
  supaRpc,
  probeConnectivity,
  expectedFingerprint,
} = {}) {
  if (typeof hasSupabase !== 'function'
      || typeof supaRpc !== 'function'
      || typeof probeConnectivity !== 'function') {
    throw new TypeError('createCompositeReadinessRuntime requires Supabase dependencies');
  }

  function classifyRpcError(error) {
    const raw = `${String(error?.code || '')} ${String(error?.message || '')}`.toLowerCase();
    if (/timeout|abort/.test(raw)) return 'timeout';
    if (/pgrst202|42883|http_404|http 404|not found/.test(raw)) return 'rpc_unavailable';
    return 'rpc_error';
  }

  async function readCompositeReadiness(cfg, minutes = 5) {
    if (!hasSupabase(cfg)) {
      return {
        ...failedCompositeShape('not_configured', { ok: false, status: 'not_configured', attempts: 1 }),
        connectivity: { ok: false, status: 'not_configured', attempts: 1 },
      };
    }

    const authWindowMinutes = Math.max(1, Math.min(60, Number(minutes || 5)));
    try {
      const raw = await supaRpc(cfg, 'backend_readiness_contract', {
        p_expected_fingerprint: String(expectedFingerprint || ''),
        p_auth_window_minutes: authWindowMinutes,
      }, 7000);
      return normalizeCompositeReadinessResponse(raw, expectedFingerprint);
    } catch (error) {
      const rpcStatus = classifyRpcError(error);
      const connectivity = await probeConnectivity(cfg);
      return {
        ...failedCompositeShape(rpcStatus, connectivity),
        connectivity: {
          ok: Boolean(connectivity?.ok),
          status: String(connectivity?.status || 'unknown'),
          attempts: Number(connectivity?.attempts || 1),
        },
        failureReasons: [rpcStatus],
      };
    }
  }

  return { readCompositeReadiness };
}
