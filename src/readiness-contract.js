function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function failedCompositeShape(
  status,
  connectivity = { ok: true, status: 'ok', attempts: 1 },
  expectedContractVersion = 2,
) {
  return {
    valid: false,
    ok: false,
    status: 'not_ready',
    rpcStatus: status,
    schemaContractVersion: 0,
    connectivity: {
      ok: Boolean(connectivity?.ok),
      status: String(connectivity?.status || 'unknown'),
      attempts: Number(connectivity?.attempts || 1),
    },
    schema: {
      ok: false,
      status: status === 'malformed_response' ? 'malformed_response' : 'composite_unavailable',
      contractVersion: 0,
      expectedContractVersion: Number(expectedContractVersion || 0),
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

export function normalizeCompositeReadinessResponse(
  raw,
  expectedFingerprint = '',
  expectedContractVersion = 2,
) {
  if (!isObject(raw)
      || typeof raw.ok !== 'boolean'
      || !isObject(raw.connectivity)
      || !isObject(raw.schema)
      || !isObject(raw.schema.fingerprint)
      || !isObject(raw.backendSecurity)
      || !isObject(raw.recentSupabaseAuthFailures)) {
    return failedCompositeShape('malformed_response', undefined, expectedContractVersion);
  }

  const fingerprint = String(raw.schema.fingerprint.fingerprint || '');
  const expected = String(expectedFingerprint || '');
  const actualContractVersion = Number(
    raw.schemaContractVersion ?? raw.schema.contractVersion ?? 0,
  );
  const expectedVersion = Number(expectedContractVersion || 0);
  const contractVersionOk = Number.isInteger(actualContractVersion)
    && actualContractVersion > 0
    && actualContractVersion === expectedVersion
    && Number(raw.schema.contractVersion || 0) === expectedVersion;

  const fingerprintOk = raw.schema.fingerprint.ok === true
    && contractVersionOk
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
    && Number.isInteger(actualContractVersion)
    && authAvailable;

  if (!valid) {
    return failedCompositeShape('malformed_response', undefined, expectedContractVersion);
  }

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
    schemaContractVersion: actualContractVersion,
    connectivity: {
      ok: connectivityOk,
      status: String(raw.connectivity.status || (connectivityOk ? 'ok' : 'unknown')),
      attempts: 1,
    },
    schema: {
      ...raw.schema,
      ok: schemaOk,
      status: schemaOk ? 'ok' : String(raw.schema.status || 'drift'),
      contractVersion: actualContractVersion,
      expectedContractVersion: expectedVersion,
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

function normalizeExpectedFingerprints(expectedFingerprint, expectedFingerprints) {
  const values = [
    expectedFingerprint,
    ...(Array.isArray(expectedFingerprints) ? expectedFingerprints : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(values)];
}

export function createCompositeReadinessRuntime({
  hasSupabase,
  supaRpc,
  probeConnectivity,
  expectedFingerprint,
  expectedFingerprints,
  expectedContractVersion = 2,
  readinessRpc = 'backend_readiness_contract_v2',
} = {}) {
  if (typeof hasSupabase !== 'function'
      || typeof supaRpc !== 'function'
      || typeof probeConnectivity !== 'function') {
    throw new TypeError('createCompositeReadinessRuntime requires Supabase dependencies');
  }

  const supportedFingerprints = normalizeExpectedFingerprints(
    expectedFingerprint,
    expectedFingerprints,
  );
  const primaryExpectedFingerprint = supportedFingerprints[0] || '';

  function classifyRpcError(error) {
    const raw = `${String(error?.code || '')} ${String(error?.message || '')}`.toLowerCase();
    if (/timeout|abort/.test(raw)) return 'timeout';
    if (/pgrst202|42883|http_404|http 404|not found/.test(raw)) return 'rpc_unavailable';
    return 'rpc_error';
  }

  async function readCompositeReadiness(cfg, minutes = 5) {
    if (!hasSupabase(cfg)) {
      return {
        ...failedCompositeShape(
          'not_configured',
          { ok: false, status: 'not_configured', attempts: 1 },
          expectedContractVersion,
        ),
        connectivity: { ok: false, status: 'not_configured', attempts: 1 },
        primaryExpectedFingerprint,
        acceptedFingerprint: '',
      };
    }

    const authWindowMinutes = Math.max(1, Math.min(60, Number(minutes || 5)));
    try {
      const readForFingerprint = async (fingerprint) => {
        const raw = await supaRpc(cfg, readinessRpc, {
          p_expected_fingerprint: String(fingerprint || ''),
          p_auth_window_minutes: authWindowMinutes,
        }, 7000);
        return normalizeCompositeReadinessResponse(
          raw,
          fingerprint,
          expectedContractVersion,
        );
      };

      const primary = await readForFingerprint(primaryExpectedFingerprint);
      if (primary.ok) {
        return {
          ...primary,
          primaryExpectedFingerprint,
          acceptedFingerprint: primaryExpectedFingerprint,
        };
      }

      // Retry only for one of the explicitly registered complete v2 schemas.
      // Unknown hashes and transport/security/auth failures stay fail-closed.
      const actualFingerprint = String(primary?.schema?.fingerprint?.fingerprint || '');
      const alternateExpectedFingerprint = primary.valid
        && primary.connectivity.ok
        && primary.backendSecurity.ok
        && primary.authFailures.available
        && primary.authFailures.count === 0
        ? supportedFingerprints.find(
          (fingerprint) => fingerprint !== primaryExpectedFingerprint
            && fingerprint === actualFingerprint,
        ) || ''
        : '';

      if (!alternateExpectedFingerprint) {
        return {
          ...primary,
          primaryExpectedFingerprint,
          acceptedFingerprint: '',
        };
      }

      const alternate = await readForFingerprint(alternateExpectedFingerprint);
      return {
        ...alternate,
        primaryExpectedFingerprint,
        acceptedFingerprint: alternate.ok ? alternateExpectedFingerprint : '',
      };
    } catch (error) {
      const rpcStatus = classifyRpcError(error);
      const connectivity = await probeConnectivity(cfg);
      return {
        ...failedCompositeShape(rpcStatus, connectivity, expectedContractVersion),
        connectivity: {
          ok: Boolean(connectivity?.ok),
          status: String(connectivity?.status || 'unknown'),
          attempts: Number(connectivity?.attempts || 1),
        },
        primaryExpectedFingerprint,
        acceptedFingerprint: '',
        failureReasons: [rpcStatus],
      };
    }
  }

  return { readCompositeReadiness };
}
