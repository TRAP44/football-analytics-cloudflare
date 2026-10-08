import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FINGERPRINT_RE=/^[0-9a-f]{32}$/i;

function normalizedBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Production URL is required.');
  const url=new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('Production URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Production URL must not contain credentials.');
  url.pathname='/';
  url.search='';
  url.hash='';
  return url;
}

export function expectedSchemaFingerprintFromWorker(source) {
  const text=typeof source === 'string' ? source : '';
  const matches=[...text.matchAll(/const\s+EXPECTED_SCHEMA_FINGERPRINT\s*=\s*['"]([0-9a-f]{32})['"]/gi)];
  if (matches.length !== 1) {
    throw new Error('Unable to resolve one canonical EXPECTED_SCHEMA_FINGERPRINT from worker source.');
  }
  return matches[0][1].toLowerCase();
}

export function verifySchemaDriftRecoverySnapshot(statusCode, body, expectedFingerprint) {
  const expected=typeof expectedFingerprint === 'string' ? expectedFingerprint.trim().toLowerCase() : '';
  if (!FINGERPRINT_RE.test(expected)) throw new Error('Recovery expected fingerprint is invalid.');
  if (statusCode !== 503) throw new Error('Recovery mode requires current production readiness HTTP 503.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Recovery readiness payload is invalid.');
  if (body.ok !== false || body.status !== 'not_ready') throw new Error('Recovery mode requires a fail-closed not_ready payload.');

  const checks=body.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) throw new Error('Recovery readiness checks are missing.');
  if (checks.supabase?.ok !== true || checks.supabase?.status !== 'ok') {
    throw new Error('Recovery mode rejected: Supabase connectivity is not healthy.');
  }
  if (checks.backendSecurity?.ok !== true || checks.backendSecurity?.status !== 'ok') {
    throw new Error('Recovery mode rejected: backend security is not healthy.');
  }
  if (checks.telegramConfigured !== true) {
    throw new Error('Recovery mode rejected: Telegram is not configured.');
  }
  if (checks.recentSupabaseAuthFailures !== 0) {
    throw new Error('Recovery mode rejected: recent Supabase auth failures are present.');
  }

  const schema=checks.schema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Recovery mode rejected: schema readiness details are missing.');
  }
  const actual=typeof schema.fingerprint === 'string' ? schema.fingerprint.trim().toLowerCase() : '';
  const staleExpected=typeof schema.expectedFingerprint === 'string' ? schema.expectedFingerprint.trim().toLowerCase() : '';
  if (schema.primaryExpectedFingerprint != null && typeof schema.primaryExpectedFingerprint !== 'string') {
    throw new Error('Recovery mode rejected: active Worker schema expectations are ambiguous.');
  }
  const primaryExpected=typeof schema.primaryExpectedFingerprint === 'string' ? schema.primaryExpectedFingerprint.trim().toLowerCase() : '';
  if (schema.ok !== false || schema.status !== 'drift') {
    throw new Error('Recovery mode rejected: current production failure is not schema drift.');
  }
  if (!FINGERPRINT_RE.test(actual) || actual !== expected) {
    throw new Error('Recovery mode rejected: live database fingerprint does not match the candidate release.');
  }
  if (!FINGERPRINT_RE.test(staleExpected) || staleExpected === actual) {
    throw new Error('Recovery mode rejected: active Worker does not expose a distinct stale schema fingerprint.');
  }
  if (primaryExpected && (!FINGERPRINT_RE.test(primaryExpected) || primaryExpected !== staleExpected)) {
    throw new Error('Recovery mode rejected: active Worker schema expectations are ambiguous.');
  }

  return Object.freeze({
    ok:true,
    actualFingerprint:actual,
    staleExpectedFingerprint:staleExpected,
  });
}


// The public /health/ready boundary intentionally strips schema fingerprints and
// recent authorization counters. Read the exact proof through the authenticated
// Management API instead of weakening that public boundary or the recovery gate.
export async function readRecoveryDatabaseEvidence({
  token='',projectRef='',expectedFingerprint='',fetchImpl=fetch,
}={}) {
  const expected=typeof expectedFingerprint==='string' ? expectedFingerprint.trim().toLowerCase() : '';
  if (!FINGERPRINT_RE.test(expected)) throw new Error('Recovery expected fingerprint is invalid.');
  if (typeof token!=='string' || !token.trim()
    || typeof projectRef!=='string' || !/^[a-z0-9]{20}$/.test(projectRef)
    || typeof fetchImpl!=='function') {
    throw new Error('Authenticated database recovery evidence is required.');
  }
  const url='https://api.supabase.com/v1/projects/'+projectRef+'/database/query';
  const response=await fetchImpl(url,{
    method:'POST',
    redirect:'error',
    headers:{
      Authorization:'Bearer '+token,
      Accept:'application/json',
      'Content-Type':'application/json',
    },
    body:JSON.stringify({
      query:"select public.backend_readiness_contract_v2('"+expected+"', 5) as readiness",
      read_only:true,
    }),
    signal:AbortSignal.timeout(15000),
  });
  if (!response || ![200,201].includes(response.status) || response.ok!==true) {
    throw new Error('Authenticated database recovery verification failed.');
  }
  let rows;
  try { rows=await response.json(); }
  catch { throw new Error('Authenticated database recovery evidence is malformed.'); }
  if (!Array.isArray(rows) || rows.length!==1 || !rows[0] || typeof rows[0]!=='object') {
    throw new Error('Authenticated database recovery evidence is malformed.');
  }
  const raw=rows[0].readiness;
  const schema=raw?.schema;
  const fingerprint=typeof schema?.fingerprint?.fingerprint==='string'
    ? schema.fingerprint.fingerprint.trim().toLowerCase() : '';
  const auth=raw?.recentSupabaseAuthFailures;
  if (
    raw?.ok!==true || raw?.connectivity?.ok!==true
    || raw?.backendSecurity?.ok!==true
    || schema?.ok!==true || schema?.status!=='ok'
    || schema?.fingerprint?.ok!==true || fingerprint!==expected
    || schema?.fingerprint?.expected!==expected
    || raw?.schemaContractVersion!==2 || schema?.contractVersion!==2
    || auth?.available!==true || auth?.count!==0 || auth?.windowMinutes!==5
  ) throw new Error('Authenticated database recovery checks are not healthy.');
  return Object.freeze({fingerprint,authFailures:0});
}

export function verifySanitizedSchemaDriftRecovery(statusCode,body,expectedFingerprint,previousWorkerSource,evidence) {
  const previousExpected=expectedSchemaFingerprintFromWorker(previousWorkerSource);
  if (!evidence || typeof evidence!=='object' || evidence.authFailures!==0
    || evidence.fingerprint!==expectedFingerprint) {
    throw new Error('Authenticated recovery evidence is absent or mismatched.');
  }
  // No sensitive values are added to the public response; this object exists
  // solely in the protected GitHub runner to reuse the strict rollback proof.
  const privateBody={
    ...body,
    checks:{
      ...body?.checks,
      schema:{
        ...body?.checks?.schema,
        fingerprint:evidence.fingerprint,
        expectedFingerprint:previousExpected,
        primaryExpectedFingerprint:previousExpected,
      },
      recentSupabaseAuthFailures:evidence.authFailures,
    },
  };
  return verifySchemaDriftRecoverySnapshot(statusCode,privateBody,expectedFingerprint);
}

function previousWorkerSourceAtSha(sha) {
  if (typeof sha!=='string' || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Verified previous production SHA is required for recovery.');
  }
  return execFileSync('git',['show',sha+':src/worker.js'],{
    encoding:'utf8',timeout:5000,maxBuffer:8*1024*1024,
  });
}

export async function verifySchemaDriftRecovery(rawBaseUrl, expectedFingerprint, options={}) {
  const baseUrl=normalizedBaseUrl(rawBaseUrl);
  const fetchImpl=options.fetchImpl || fetch;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await fetchImpl(new URL('/health/ready',baseUrl),{
      method:'GET',
      redirect:'manual',
      headers:{
        accept:'application/json',
        'cache-control':'no-cache',
        'user-agent':'MatchRadar-Schema-Drift-Recovery/1.0',
      },
      signal:controller.signal,
    });
    let body=null;
    try {
      body=await response.json();
    } catch {
      throw new Error('Recovery readiness endpoint returned invalid JSON.');
    }
    if (typeof body?.checks?.schema?.fingerprint==='string') {
      return verifySchemaDriftRecoverySnapshot(response.status,body,expectedFingerprint);
    }
    // Sanitized public readiness cannot prove private auth counters or schema
    // fingerprints. The deploy runner obtains them over an authenticated query.
    if (response.status!==503 || body?.ok!==false || body?.status!=='not_ready') {
      throw new Error('Recovery requires fail-closed public readiness HTTP 503.');
    }
    const source=options.previousWorkerSource ?? previousWorkerSourceAtSha(
      options.previousSha ?? process.env.PREVIOUS_SHA,
    );
    const evidence=await readRecoveryDatabaseEvidence({
      token:options.token ?? process.env.SUPABASE_ACCESS_TOKEN,
      projectRef:options.projectRef ?? process.env.SUPABASE_PROJECT_REF,
      expectedFingerprint,
      fetchImpl:options.databaseFetchImpl || fetch,
    });
    return verifySanitizedSchemaDriftRecovery(response.status,body,expectedFingerprint,source,evidence);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const [, , baseUrl] = process.argv;
  if (!baseUrl) throw new Error('Usage: node scripts/verify-schema-drift-recovery.js <production-url>');
  const workerSource=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  const expected=expectedSchemaFingerprintFromWorker(workerSource);
  const result=await verifySchemaDriftRecovery(baseUrl,expected);
  console.log(`Schema-drift recovery approved: database fingerprint ${result.actualFingerprint}; stale production expected ${result.staleExpectedFingerprint}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{
    console.error(error?.message || String(error));
    process.exitCode=1;
  });
}
