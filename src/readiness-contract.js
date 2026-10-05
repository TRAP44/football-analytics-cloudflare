const FINGERPRINT_RE=/^[0-9a-f]{32}$/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function integerCandidate(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function positiveInteger(value,fallback=1,max=Number.MAX_SAFE_INTEGER) {
  const number=integerCandidate(value);
  return number !== null && number > 0 && number <= max ? number : fallback;
}

function nonNegativeInteger(value,fallback=0,max=Number.MAX_SAFE_INTEGER) {
  const number=integerCandidate(value);
  return number !== null && number >= 0 && number <= max ? number : fallback;
}

function strictFingerprint(value='') {
  if (typeof value !== 'string') return '';
  const fingerprint=value.trim().toLowerCase();
  return FINGERPRINT_RE.test(fingerprint) ? fingerprint : '';
}

function cleanStatus(value,fallback='unknown') {
  if (typeof value !== 'string') return fallback;
  const raw=value.trim();
  if (!raw || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return fallback;
  return raw.replace(/\s+/gu,' ').slice(0,80);
}

function normalizeFailureReasons(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter(item=>typeof item === 'string')
      .map(item=>item.trim())
      .filter(Boolean),
  )].slice(0,32);
}

function normalizedConnectivity(connectivity = {}, {
  defaultOk=true,
  defaultStatus='ok',
  defaultAttempts=1,
} = {}) {
  const source=isObject(connectivity) ? connectivity : {};
  return {
    ok:typeof source.ok === 'boolean' ? source.ok : defaultOk,
    status:cleanStatus(source.status,defaultStatus),
    attempts:positiveInteger(source.attempts,defaultAttempts,20),
  };
}

function failedCompositeShape(
  status,
  connectivity = { ok: true, status: 'ok', attempts: 1 },
  expectedContractVersion = 2,
) {
  const expectedVersion=positiveInteger(expectedContractVersion,2,1000);
  return {
    valid:false,
    ok:false,
    status:'not_ready',
    rpcStatus:cleanStatus(status,'rpc_error'),
    schemaContractVersion:0,
    connectivity:normalizedConnectivity(connectivity),
    schema:{
      ok:false,
      status:status === 'malformed_response' ? 'malformed_response' : 'composite_unavailable',
      contractVersion:0,
      expectedContractVersion:expectedVersion,
      fingerprint:{ok:false,status:'unavailable',fingerprint:'',expected:''},
    },
    backendSecurity:{
      ok:false,
      status:status === 'malformed_response' ? 'malformed_response' : 'composite_unavailable',
    },
    authFailures:{available:false,count:0},
    failureReasons:[cleanStatus(status,'rpc_error')],
  };
}

export function normalizeCompositeReadinessResponse(
  raw,
  expectedFingerprint = '',
  expectedContractVersion = 2,
) {
  const expected=strictFingerprint(expectedFingerprint);
  const expectedVersion=positiveInteger(expectedContractVersion,2,1000);

  if (
    !expected
    || !isObject(raw)
    || typeof raw.ok !== 'boolean'
    || !isObject(raw.connectivity)
    || !isObject(raw.schema)
    || !isObject(raw.schema.fingerprint)
    || !isObject(raw.backendSecurity)
    || !isObject(raw.recentSupabaseAuthFailures)
  ) {
    return failedCompositeShape('malformed_response',undefined,expectedVersion);
  }

  const fingerprint=strictFingerprint(raw.schema.fingerprint.fingerprint);
  const actualContractVersion=integerCandidate(
    raw.schemaContractVersion ?? raw.schema.contractVersion,
  );
  const schemaContractVersion=integerCandidate(raw.schema.contractVersion);
  const contractVersionOk=actualContractVersion !== null
    && actualContractVersion > 0
    && actualContractVersion === expectedVersion
    && schemaContractVersion === expectedVersion;

  const fingerprintOk=raw.schema.fingerprint.ok === true
    && contractVersionOk
    && Boolean(fingerprint)
    && fingerprint === expected;
  const connectivityOk=raw.connectivity.ok === true;
  const schemaOk=raw.schema.ok === true && fingerprintOk;
  const securityOk=raw.backendSecurity.ok === true;
  const authCount=integerCandidate(raw.recentSupabaseAuthFailures.count);
  const authAvailable=raw.recentSupabaseAuthFailures.available === true
    && authCount !== null
    && authCount >= 0;
  const authWindowMinutes=positiveInteger(
    raw.recentSupabaseAuthFailures.windowMinutes,
    0,
    60,
  );

  const valid=
    typeof raw.connectivity.ok === 'boolean'
    && typeof raw.schema.ok === 'boolean'
    && typeof raw.schema.fingerprint.ok === 'boolean'
    && typeof raw.backendSecurity.ok === 'boolean'
    && typeof raw.recentSupabaseAuthFailures.available === 'boolean'
    && typeof raw.schema.status === 'string'
    && typeof raw.backendSecurity.status === 'string'
    && typeof raw.connectivity.status === 'string'
    && actualContractVersion !== null
    && actualContractVersion > 0
    && schemaContractVersion !== null
    && schemaContractVersion > 0
    && authAvailable;

  if (!valid) {
    return failedCompositeShape('malformed_response',undefined,expectedVersion);
  }

  const ok=raw.ok === true
    && connectivityOk
    && schemaOk
    && securityOk
    && authCount === 0;

  return {
    valid:true,
    ok,
    status:ok ? 'ready' : 'not_ready',
    rpcStatus:'ok',
    schemaContractVersion:actualContractVersion,
    connectivity:{
      ok:connectivityOk,
      status:cleanStatus(raw.connectivity.status,connectivityOk ? 'ok' : 'unknown'),
      attempts:positiveInteger(raw.connectivity.attempts,1,20),
    },
    schema:{
      ...raw.schema,
      ok:schemaOk,
      status:schemaOk ? 'ok' : cleanStatus(raw.schema.status,'drift'),
      contractVersion:actualContractVersion,
      expectedContractVersion:expectedVersion,
      fingerprint:{
        ...raw.schema.fingerprint,
        ok:fingerprintOk,
        fingerprint,
        expected,
      },
    },
    backendSecurity:{
      ...raw.backendSecurity,
      ok:securityOk,
      status:securityOk ? 'ok' : cleanStatus(raw.backendSecurity.status,'violations'),
    },
    authFailures:{
      available:true,
      count:authCount,
      windowMinutes:authWindowMinutes,
    },
    failureReasons:normalizeFailureReasons(raw.failureReasons),
  };
}

function normalizeExpectedFingerprints(expectedFingerprint,expectedFingerprints) {
  const values=[
    expectedFingerprint,
    ...(Array.isArray(expectedFingerprints) ? expectedFingerprints : []),
  ]
    .map(strictFingerprint)
    .filter(Boolean);
  return [...new Set(values)];
}

function safeRpcName(value) {
  if (typeof value !== 'string') return '';
  const name=value.trim();
  return /^[a-z][a-z0-9_]{0,95}$/.test(name) ? name : '';
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
  if (
    typeof hasSupabase !== 'function'
    || typeof supaRpc !== 'function'
    || typeof probeConnectivity !== 'function'
  ) {
    throw new TypeError('createCompositeReadinessRuntime requires Supabase dependencies');
  }

  const supportedFingerprints=normalizeExpectedFingerprints(
    expectedFingerprint,
    expectedFingerprints,
  );
  const primaryExpectedFingerprint=supportedFingerprints[0] || '';
  const contractVersion=positiveInteger(expectedContractVersion,0,1000);
  const rpcName=safeRpcName(readinessRpc);

  function classifyRpcError(error) {
    const code=typeof error?.code === 'string' ? error.code : '';
    const message=typeof error?.message === 'string' ? error.message : '';
    const raw=`${code} ${message}`.toLowerCase();
    if (/timeout|abort/.test(raw)) return 'timeout';
    if (/pgrst202|42883|http_404|http 404|not found/.test(raw)) return 'rpc_unavailable';
    return 'rpc_error';
  }

  async function safeProbeConnectivity(cfg) {
    try {
      const result=await probeConnectivity(cfg);
      return normalizedConnectivity(result,{
        defaultOk:false,
        defaultStatus:'probe_unavailable',
        defaultAttempts:1,
      });
    } catch {
      return {ok:false,status:'probe_unavailable',attempts:1};
    }
  }

  async function readCompositeReadiness(cfg,minutes=5) {
    if (!primaryExpectedFingerprint || !contractVersion || !rpcName) {
      return {
        ...failedCompositeShape('configuration_invalid',undefined,contractVersion || 2),
        primaryExpectedFingerprint,
        acceptedFingerprint:'',
      };
    }

    let configured=false;
    try {
      configured=hasSupabase(cfg) === true;
    } catch {
      configured=false;
    }

    if (!configured) {
      return {
        ...failedCompositeShape(
          'not_configured',
          {ok:false,status:'not_configured',attempts:1},
          contractVersion,
        ),
        connectivity:{ok:false,status:'not_configured',attempts:1},
        primaryExpectedFingerprint,
        acceptedFingerprint:'',
      };
    }

    const authWindowMinutes=positiveInteger(minutes,5,60);
    try {
      const readForFingerprint=async fingerprint=>{
        const raw=await supaRpc(cfg,rpcName,{
          p_expected_fingerprint:fingerprint,
          p_auth_window_minutes:authWindowMinutes,
        },7000);
        return normalizeCompositeReadinessResponse(
          raw,
          fingerprint,
          contractVersion,
        );
      };

      const primary=await readForFingerprint(primaryExpectedFingerprint);
      if (primary.ok) {
        return {
          ...primary,
          primaryExpectedFingerprint,
          acceptedFingerprint:primaryExpectedFingerprint,
        };
      }

      const actualFingerprint=strictFingerprint(primary?.schema?.fingerprint?.fingerprint);
      const alternateExpectedFingerprint=primary.valid
        && primary.connectivity.ok
        && primary.backendSecurity.ok
        && primary.authFailures.available
        && primary.authFailures.count === 0
        ? supportedFingerprints.find(
          fingerprint=>fingerprint !== primaryExpectedFingerprint
            && fingerprint === actualFingerprint,
        ) || ''
        : '';

      if (!alternateExpectedFingerprint) {
        return {
          ...primary,
          primaryExpectedFingerprint,
          acceptedFingerprint:'',
        };
      }

      const alternate=await readForFingerprint(alternateExpectedFingerprint);
      return {
        ...alternate,
        primaryExpectedFingerprint,
        acceptedFingerprint:alternate.ok ? alternateExpectedFingerprint : '',
      };
    } catch (error) {
      const rpcStatus=classifyRpcError(error);
      const connectivity=await safeProbeConnectivity(cfg);
      return {
        ...failedCompositeShape(rpcStatus,connectivity,contractVersion),
        connectivity,
        primaryExpectedFingerprint,
        acceptedFingerprint:'',
        failureReasons:[rpcStatus],
      };
    }
  }

  return Object.freeze({readCompositeReadiness});
}
