import fs from 'node:fs';
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


// Public readiness intentionally omits fingerprints and authentication counts.
// This is only permission to verify an immutable candidate in its isolated
// Cloudflare Version URL, NEVER permission to send any production traffic.
// The deploy workflow must require post-deploy-smoke and mobile-render smoke
// to pass on that candidate before the version is promoted.
export function verifyPublicSchemaDriftEligibility(statusCode,body,expectedFingerprint) {
  const expected=typeof expectedFingerprint==='string' ? expectedFingerprint.trim().toLowerCase() : '';
  if (!FINGERPRINT_RE.test(expected)) throw new Error('Recovery expected fingerprint is invalid.');
  if (statusCode!==503 || !body || typeof body!=='object' || Array.isArray(body)
    || body.ok!==false || body.status!=='not_ready') {
    throw new Error('Recovery requires fail-closed public readiness HTTP 503.');
  }
  const checks=body.checks;
  if (!checks || typeof checks!=='object' || Array.isArray(checks)
    || checks.supabase?.ok!==true || checks.supabase?.status!=='ok'
    || checks.backendSecurity?.ok!==true || checks.backendSecurity?.status!=='ok'
    || checks.telegramConfigured!==true) {
    throw new Error('Recovery blocked: public connectivity, security or Telegram check is unhealthy.');
  }
  const schema=checks.schema;
  if (!schema || typeof schema!=='object' || Array.isArray(schema)
    || schema.ok!==false || schema.status!=='drift') {
    throw new Error('Recovery blocked: the public failure is not confirmed schema drift.');
  }
  // A public endpoint must not surface private fingerprints or auth counters.
  if (
    'fingerprint' in schema || 'expectedFingerprint' in schema
    || 'primaryExpectedFingerprint' in schema
    || 'recentSupabaseAuthFailures' in checks
  ) throw new Error('Recovery public-readiness boundary exposed private details.');

  return Object.freeze({ok:true,phase:'preview_only',expectedFingerprint:expected});
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
    return verifyPublicSchemaDriftEligibility(response.status,body,expectedFingerprint);
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
