import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const digest=(algorithm,value)=>createHash(algorithm).update(value).digest('hex');
const reviewed=JSON.parse(fs.readFileSync(new URL('../test-support/runtime-controls-v20-contract.json',import.meta.url)));
const release=JSON.parse(fs.readFileSync(new URL('../release-contract.json',import.meta.url)));
const sql=fs.readFileSync(new URL('../'+reviewed.sqlPath,import.meta.url),'utf8');

test('runtime rollout freezes SQL, function body and actual PostgreSQL metadata',()=>{
  assert.equal(digest('sha256',sql),reviewed.sqlSha256);
  const body=sql.match(/set search_path = public, pg_catalog, pg_temp\nas \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.ok(body);
  assert.equal(digest('md5',body),reviewed.sourceMd5);
  assert.ok(reviewed.parts.includes('RT|commit_runtime_controls_v2|source='+reviewed.sourceMd5+'|config=search_path=public, pg_catalog, pg_temp|defaults=NULL::integer'));
  assert.equal(digest('md5',[...reviewed.parts].sort().join('\n')),reviewed.fingerprint);
});

test('current release accepts only the exact reviewed future production and fresh schemas',()=>{
  const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  for(const [base,expected] of [[reviewed.baseFingerprint,reviewed.productionFingerprint],[reviewed.freshBaseFingerprint,reviewed.freshFingerprint]]){
    assert.equal(digest('md5',[base,reviewed.recoveryFingerprint,reviewed.fingerprint].join('\n')),expected);
    assert.ok(release.databaseContract.compatibleFingerprints.includes(expected));
    assert.ok(worker.includes("'"+expected+"'"));
  }
  // Promotion must match the exact SQL accepted by the previously deployed bridge.
  assert.equal(release.latestMigration,'supabase/migrations/supabase_migration_v6_29_20.sql');
  assert.equal(release.databaseContract.fingerprint,reviewed.productionFingerprint);
  assert.equal(sql,fs.readFileSync(new URL('../docs/rollouts/runtime-controls-v20.sql',import.meta.url),'utf8'));
});
