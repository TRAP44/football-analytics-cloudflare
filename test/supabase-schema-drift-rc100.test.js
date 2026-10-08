import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSupabaseSchemaRuntime } from '../src/supabase-schema-runtime.js';

const schemaSource=fs.readFileSync('src/supabase-schema-runtime.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8');
const release=fs.readFileSync('src/admin-operational-api.js','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');

function runtime({configured=true,fetch=async()=>({ok:true,status:200})}={}){
  return createSupabaseSchemaRuntime({
    EXPECTED_SCHEMA_FINGERPRINT:'a'.repeat(32),
    PERSONAL_WRITE_LIMITS:{},
    bumpTelemetry:()=>{},
    fetchWithTimeout:fetch,
    hasSupabase:()=>configured,
    readProviderIncidentAlertDeliveryContract:async()=>({ok:true}),
    redactOpsString:()=> '[redacted]',
    sleepMs:async()=>{},
    supaHeaders:()=>({apikey:'opaque'}),
    supaRpc:async()=>({ok:true}),
  });
}

test('RC100 probes required table columns using read-only REST requests',async()=>{
  const urls=[];
  const api=runtime({fetch:async url=>{urls.push(new URL(String(url)));return {ok:true,status:200};}});
  const result=await api.probeTableColumns({supabaseUrl:'https://example.supabase.co'},'users',['telegram_id','acquisition_source']);
  assert.equal(result.ok,true);
  assert.equal(urls.length,1);
  assert.equal(urls[0].pathname,'/rest/v1/users');
  assert.equal(urls[0].searchParams.get('select'),'telegram_id,acquisition_source');
  assert.equal(urls[0].searchParams.get('limit'),'1');
});
test('RC100 a missing mandatory table slice blocks the schema guard',()=>{
  const api=runtime();
  const checks=[
    {id:'users_acquisition',table:'users',ok:true,columns:['telegram_id']},
    {id:'growth_events',table:'growth_events',ok:false,status:'http_404',columns:['event_name']},
  ];
  const summary=api.summarizeSupabaseSchemaChecks(checks);
  assert.equal(summary.ok,false);
  assert.equal(summary.status,'drift');
  assert.deepEqual(summary.missing,['growth_events']);
  assert.equal(summary.checked,2);
});
test('RC100 a configured schema probe HTTP failure never pretends success',async()=>{
  const api=runtime({fetch:async()=>({ok:false,status:404})});
  const result=await api.probeTableColumns({supabaseUrl:'https://example.supabase.co'},'growth_events',['event_name']);
  assert.equal(result.ok,false);
  assert.equal(result.status,'http_404');
});
test('RC100 an unconfigured schema probe performs no network requests',async()=>{
  let count=0;
  const api=runtime({configured:false,fetch:async()=>{count++;return {ok:true};}});
  const result=await api.probeTableColumns({},'users',['telegram_id']);
  assert.equal(result.ok,false);
  assert.equal(result.status,'not_configured');
  assert.equal(count,0);
});
test('RC100 current schema guard self-test and release gates are mandatory',()=>{
  const api=runtime();
  assert.equal(api.supabaseSchemaDriftSelfTest().pass,true);
  assert.match(worker,/createSupabaseSchemaRuntime/);
  assert.match(schemaSource,/async function probeSupabaseSchemaDrift/);
  assert.match(release,/releaseCheck\('supabase_schema_drift'/);
  assert.match(smoke,/'supabaseSchemaDriftGuard'/);
  assert.match(smoke,/'supabaseSchemaDriftSelfTest'/);
});
