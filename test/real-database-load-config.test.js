import test from 'node:test';
import assert from 'node:assert/strict';
import {localLoadDatabaseConfig} from '../scripts/real-database-load-config.js';

const valid={ISOLATED_REAL_DB_ACK:'disposable',LOCAL_LOAD_SUPABASE_URL:'http://127.0.0.1:54321',LOCAL_LOAD_SUPABASE_SERVICE_ROLE_KEY:'dummy-local-only'};
test('real database load accepts only explicitly acknowledged disposable loopback target',()=>{
  assert.deepEqual(localLoadDatabaseConfig(valid),{url:'http://127.0.0.1:54321',key:'dummy-local-only'});
  for(const url of ['https://nlmvhkjkpgzzlfavaohk.supabase.co','https://example.com','http://127.0.0.1.evil.test:54321','http://127.0.0.1:54321@evil.test','http://127.0.0.1:54321/?target=production','http://127.0.0.1:54321/path','http://localhost:54321','http://127.0.0.1:54322'])assert.throws(()=>localLoadDatabaseConfig({...valid,LOCAL_LOAD_SUPABASE_URL:url}));
  assert.throws(()=>localLoadDatabaseConfig({...valid,ISOLATED_REAL_DB_ACK:undefined}));
  assert.throws(()=>localLoadDatabaseConfig({...valid,LOCAL_LOAD_SUPABASE_SERVICE_ROLE_KEY:''}));
  assert.throws(()=>localLoadDatabaseConfig({}));
});

test('real database CI creates disposable services without cloud or production secrets',async()=>{
  const fs=await import('node:fs');
  const workflow=fs.readFileSync('.github/workflows/isolated-load-resilience.yml','utf8');
  const job=workflow.slice(workflow.indexOf('\n  real-database-http:'));
  assert.match(job,/node scripts\/start-real-database-http-load\.js/);
  assert.doesNotMatch(job,/secrets\.|environment: production|wrangler deploy/);
  const stand=fs.readFileSync('scripts/start-real-database-http-load.js','utf8');
  assert.match(stand,/127\.0\.0\.1:54320:3000/);
  assert.match(stand,/freshInstallFingerprint/);
  assert.match(stand,/database_persistence_verified/);
});
