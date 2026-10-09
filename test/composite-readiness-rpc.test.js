import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { POST_BASELINE_MIGRATIONS } from '../scripts/prepare-supabase-ci-migrations.js';
import {
  createCompositeReadinessRuntime,
  normalizeCompositeReadinessResponse,
} from '../src/readiness-contract.js';

const legacySql = fs.readFileSync('supabase/migrations/supabase_migration_v6_21.sql', 'utf8');
const contractV2Sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_27_2.sql', 'utf8');
const compatibilitySql = fs.readFileSync('supabase/migrations/supabase_migration_v6_27_3.sql', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const readinessWiring = fs.readFileSync('src/provider-readiness-wiring-runtime.js', 'utf8');
const releaseContract = JSON.parse(fs.readFileSync('release-contract.json', 'utf8'));

const PRIMARY_FP=releaseContract.databaseContract.fingerprint;
const FRESH_FP=releaseContract.databaseContract.freshInstallFingerprint;
const CONTRACT_VERSION=releaseContract.databaseContract.version;

function healthyRaw({
  actualFingerprint=PRIMARY_FP,
  expectedFingerprint=PRIMARY_FP,
  authWindowMinutes=5,
  authFailures=0,
}={}) {
  const fingerprintOk=actualFingerprint===expectedFingerprint;
  const ok=fingerprintOk && authFailures===0;
  return {
    ok,
    status:ok ? 'ok' : 'not_ready',
    schemaContractVersion:CONTRACT_VERSION,
    connectivity:{ok:true,status:'ok'},
    schema:{
      ok:fingerprintOk,
      status:fingerprintOk ? 'ok' : 'drift',
      contractVersion:CONTRACT_VERSION,
      fingerprint:{
        ok:fingerprintOk,
        status:fingerprintOk ? 'ok' : 'fingerprint_mismatch',
        fingerprint:actualFingerprint,
        expected:expectedFingerprint,
        parts:100,
      },
    },
    backendSecurity:{ok:true,status:'ok'},
    recentSupabaseAuthFailures:{
      available:true,
      count:authFailures,
      windowMinutes:authWindowMinutes,
    },
    failureReasons:[
      ...(!fingerprintOk ? ['schema_contract_v2'] : []),
      ...(authFailures ? ['recent_supabase_auth_failures'] : []),
    ],
  };
}

test('legacy composite RPC remains additive, bounded and service-role-only', () => {
  assert.match(legacySql,/create or replace function public\.backend_readiness_contract\(/);
  assert.match(legacySql,/v_auth_window integer := greatest\(1, least\(coalesce\(p_auth_window_minutes, 5\), 60\)\)/);
  assert.match(legacySql,/select public\.backend_security_contract\(\) into v_security/);
  assert.match(legacySql,/select public\.backend_default_acl_contract\(\) into v_default_acl/);
  assert.match(legacySql,/select public\.personal_write_guard_contract\(\) into v_personal_write_guards/);
  assert.match(legacySql,/select public\.provider_incident_alert_delivery_contract\(\) into v_incident_alert_delivery/);
  assert.match(legacySql,/order by e\.created_at desc[\s\S]*limit 100/);
  assert.match(legacySql,/'recentSupabaseAuthFailures'[\s\S]*'windowMinutes', v_auth_window/);
  assert.match(legacySql,/security invoker/);
  assert.match(legacySql,/revoke execute on function public\.backend_readiness_contract\(text,integer\) from public, anon, authenticated/);
  assert.match(legacySql,/grant execute on function public\.backend_readiness_contract\(text,integer\) to service_role/);
  assert.doesNotMatch(legacySql,/\bdrop\s+(table|function|column|schema|policy)\b/i);
});

test('legacy RPC keeps the minimum schema and operational auth-failure contracts', () => {
  for (const id of [
    'users_acquisition',
    'analysis_history_ai',
    'calibration_transitions',
    'digest_subscriptions',
    'referee_history',
    'growth_events',
    'telegram_update_claims',
    'provider_rate_windows',
    'cache_provenance',
    'odds_provenance',
    'model_provenance',
    'provider_incident_alert_delivery',
  ]) {
    assert.match(legacySql,new RegExp(id));
  }
  assert.match(legacySql,/HTTP 401\|PGRST303\|invalid\.\*jwt\|invalid\.\*api\.\?key/);
  assert.match(legacySql,/'failureReasons', v_failure_reasons/);
  assert.match(legacySql,/'connectivity'/);
  assert.match(legacySql,/'backendSecurity'/);
  assert.match(legacySql,/'defaultAcl'/);
  assert.match(legacySql,/'fingerprint'/);
});

test('database contract v2 composes legacy checks with the complete schema fingerprint', () => {
  const v2Only=contractV2Sql.split('-- Freeze the historical v1 fingerprint')[0];

  assert.match(v2Only,/create or replace function public\.backend_schema_contract_v2\(\)/);
  assert.match(v2Only,/create or replace function public\.backend_readiness_contract_v2\(/);
  assert.match(v2Only,/select public\.backend_readiness_contract\([\s\S]*v_auth_window[\s\S]*\)\s*into v_legacy/);
  assert.match(v2Only,/select public\.backend_schema_contract_v2\(\) into v_contract/);
  assert.match(v2Only,/coalesce\(\(v_legacy->>'ok'\)::boolean, false\) and v_contract_ok/);
  assert.match(v2Only,/'schemaContractVersion', 2/);
  assert.match(v2Only,/revoke all on function public\.backend_readiness_contract_v2\(text,integer\)[\s\S]*from public, anon, authenticated/);
  assert.match(v2Only,/grant execute on function public\.backend_readiness_contract_v2\(text,integer\)[\s\S]*to service_role/);

  for (const structuralSource of [
    /from information_schema\.columns c/,
    /from pg_constraint pc/,
    /from pg_indexes/,
    /from pg_proc p/,
    /from pg_policies p/,
    /from pg_trigger t/,
    /has_table_privilege/,
    /has_sequence_privilege/,
    /has_function_privilege/,
  ]) {
    assert.match(v2Only,structuralSource);
  }
});

test('historical v1 compatibility freeze stays SQL-equivalent across its repair migration', () => {
  const freezeStart=contractV2Sql.indexOf(
    'create or replace function public.backend_schema_fingerprint()',
  );
  const compatibilityStart=compatibilitySql.indexOf(
    'create or replace function public.backend_schema_fingerprint()',
  );
  assert.ok(freezeStart>=0);
  assert.ok(compatibilityStart>=0);

  const normalizeSql=value=>value
    .replace(/--.*$/gm,'')
    .replace(/\s+/g,' ')
    .trim();

  assert.equal(
    normalizeSql(contractV2Sql.slice(freezeStart)),
    normalizeSql(compatibilitySql.slice(compatibilityStart)),
  );
});

test('release contract, migration chain and runtime wiring agree on database contract v2', () => {
  assert.equal(releaseContract.productionSchema,'6.29');
  assert.equal(
    releaseContract.latestMigration,
    POST_BASELINE_MIGRATIONS.at(-1),
  );
  assert.equal(CONTRACT_VERSION,2);
  assert.equal(releaseContract.databaseContract.rpc,'backend_readiness_contract_v2');
  const compatible=releaseContract.databaseContract.compatibleFingerprints;
  assert.ok(compatible.includes(PRIMARY_FP));
  assert.ok(compatible.includes(FRESH_FP));
  assert.equal(new Set(compatible).size,compatible.length);
  assert.ok(compatible.every(value=>/^[a-f0-9]{32}$/.test(value)));

  assert.match(worker,/EXPECTED_SCHEMA_CONTRACT_VERSION = 2/);
  assert.ok(worker.includes(`EXPECTED_SCHEMA_FINGERPRINT = '${PRIMARY_FP}'`));
  assert.ok(worker.includes(`FRESH_INSTALL_SCHEMA_FINGERPRINT = '${FRESH_FP}'`));
  assert.match(worker,/миграции до v6\.29/);

  assert.match(readinessWiring,/expectedFingerprint: EXPECTED_SCHEMA_FINGERPRINT/);
  assert.match(readinessWiring,/expectedFingerprints: COMPATIBLE_SCHEMA_FINGERPRINTS/);
  assert.match(readinessWiring,/expectedContractVersion: EXPECTED_SCHEMA_CONTRACT_VERSION/);
  assert.match(readinessWiring,/readinessRpc: 'backend_readiness_contract_v2'/);
});

test('healthy composite readiness is one atomic RPC round-trip with the requested auth window', async () => {
  const rpcCalls=[];
  let connectivityCalls=0;
  const runtime=createCompositeReadinessRuntime({
    hasSupabase:()=>true,
    supaRpc:async (...args)=>{
      rpcCalls.push(args);
      return healthyRaw({authWindowMinutes:17});
    },
    probeConnectivity:async ()=>{
      connectivityCalls+=1;
      return {ok:true,status:'ok',attempts:1};
    },
    expectedFingerprint:PRIMARY_FP,
    expectedFingerprints:[PRIMARY_FP,FRESH_FP],
    expectedContractVersion:CONTRACT_VERSION,
    readinessRpc:releaseContract.databaseContract.rpc,
  });

  const result=await runtime.readCompositeReadiness({},17);

  assert.equal(result.valid,true);
  assert.equal(result.ok,true);
  assert.equal(result.authFailures.windowMinutes,17);
  assert.equal(result.acceptedFingerprint,PRIMARY_FP);
  assert.equal(rpcCalls.length,1);
  assert.equal(connectivityCalls,0);
  assert.deepEqual(rpcCalls[0].slice(1),[
    'backend_readiness_contract_v2',
    {
      p_expected_fingerprint:PRIMARY_FP,
      p_auth_window_minutes:17,
    },
    7000,
  ]);
});

test('auth-failure evidence is fail-closed unless the RPC confirms the exact requested window', async () => {
  for (const returnedWindow of [undefined,null,0,true,4,6,61]) {
    let rpcCalls=0;
    const runtime=createCompositeReadinessRuntime({
      hasSupabase:()=>true,
      supaRpc:async ()=>{
        rpcCalls+=1;
        const raw=healthyRaw({authWindowMinutes:5});
        raw.recentSupabaseAuthFailures.windowMinutes=returnedWindow;
        return raw;
      },
      probeConnectivity:async ()=>({ok:true,status:'ok',attempts:1}),
      expectedFingerprint:PRIMARY_FP,
      expectedContractVersion:CONTRACT_VERSION,
    });

    const result=await runtime.readCompositeReadiness({},5);
    assert.equal(rpcCalls,1,String(returnedWindow));
    assert.equal(result.valid,false,String(returnedWindow));
    assert.equal(result.ok,false,String(returnedWindow));
    assert.equal(result.rpcStatus,'malformed_response',String(returnedWindow));
    assert.equal(result.authFailures.available,false,String(returnedWindow));
  }

  const direct=normalizeCompositeReadinessResponse(
    healthyRaw({authWindowMinutes:10}),
    PRIMARY_FP,
    CONTRACT_VERSION,
    5,
  );
  assert.equal(direct.valid,false);
  assert.equal(direct.ok,false);
});

test('alternate compatible fingerprint must be reconfirmed with the same auth window', async () => {
  const calls=[];
  const runtime=createCompositeReadinessRuntime({
    hasSupabase:()=>true,
    supaRpc:async (_cfg,_rpc,args)=>{
      calls.push({...args});
      if (args.p_expected_fingerprint===PRIMARY_FP) {
        return healthyRaw({
          actualFingerprint:FRESH_FP,
          expectedFingerprint:PRIMARY_FP,
          authWindowMinutes:9,
        });
      }
      return healthyRaw({
        actualFingerprint:FRESH_FP,
        expectedFingerprint:FRESH_FP,
        authWindowMinutes:9,
      });
    },
    probeConnectivity:async ()=>({ok:true,status:'ok',attempts:1}),
    expectedFingerprint:PRIMARY_FP,
    expectedFingerprints:[PRIMARY_FP,FRESH_FP],
    expectedContractVersion:CONTRACT_VERSION,
  });

  const result=await runtime.readCompositeReadiness({},9);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>call.p_auth_window_minutes===9));
  assert.deepEqual(calls.map(call=>call.p_expected_fingerprint),[PRIMARY_FP,FRESH_FP]);
  assert.equal(result.ok,true);
  assert.equal(result.acceptedFingerprint,FRESH_FP);
});

test('alternate fingerprint cannot become ready if its confirmation changes the auth window', async () => {
  const calls=[];
  const runtime=createCompositeReadinessRuntime({
    hasSupabase:()=>true,
    supaRpc:async (_cfg,_rpc,args)=>{
      calls.push({...args});
      if (args.p_expected_fingerprint===PRIMARY_FP) {
        return healthyRaw({
          actualFingerprint:FRESH_FP,
          expectedFingerprint:PRIMARY_FP,
          authWindowMinutes:5,
        });
      }
      return healthyRaw({
        actualFingerprint:FRESH_FP,
        expectedFingerprint:FRESH_FP,
        authWindowMinutes:1,
      });
    },
    probeConnectivity:async ()=>({ok:true,status:'ok',attempts:1}),
    expectedFingerprint:PRIMARY_FP,
    expectedFingerprints:[PRIMARY_FP,FRESH_FP],
    expectedContractVersion:CONTRACT_VERSION,
  });

  const result=await runtime.readCompositeReadiness({},5);
  assert.equal(calls.length,2);
  assert.equal(result.valid,false);
  assert.equal(result.ok,false);
  assert.equal(result.acceptedFingerprint,'');
});
