import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configureSettlementRecovery,settlementControlSql} from '../scripts/settlement-recovery-control.js';
const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'TRAP44/football-analytics-cloudflare',SUPABASE_DB_URL:'synthetic'};
test('fixed protected control writes once then independently confirms only the flag/revision',async()=>{
  const calls=[];const result=await configureSettlementRecovery({mode:'enable',env,runPostgres:async options=>{calls.push(options);return options.write?'':JSON.stringify({enabled:true,revision:5,securityOk:true,audited:true,maintenanceMode:false});}});
  assert.deepEqual(result,{ok:true,enabled:true,revision:5});assert.equal(calls.length,2);assert.equal(calls[0].write,true);assert.equal(calls[1].write,false);assert.match(calls[1].query,/begin read only/);
  const sql=calls[0].query;assert.match(sql,/for update/);assert.match(sql,/revision=previous.revision/);assert.match(sql,/Settlement audit unconfirmed/);assert.match(sql,/backend_security_contract/);
  assert.doesNotMatch(sql,/with\s+\w+\s+as\s*\(\s*update/i);
  const update=sql.slice(sql.indexOf('update public.runtime_controls'),sql.indexOf('if not found'));
  assert.doesNotMatch(update,/maintenance_mode\s*=|analysis_enabled\s*=|search_enabled\s*=|live_enabled\s*=|ai_enabled\s*=|message\s*=/);
});
test('unknown write is never replayed and cannot succeed without a confirming read',async()=>{
  for(const confirmed of [true,false]){
    let writes=0;const action=configureSettlementRecovery({mode:'enable',env,runPostgres:async options=>{if(options.write){writes++;throw Error('unknown');}return JSON.stringify({enabled:confirmed,revision:6,securityOk:true,audited:true,maintenanceMode:false});}});
    if(confirmed)assert.equal((await action).confirmedAfterUnknownWrite,true);else await assert.rejects(action,/WRITE_UNCONFIRMED/);assert.equal(writes,1);
  }
});
test('foreign runner/mode never reaches the database; disable is the same fixed transaction',async()=>{
  for(const bad of [{...env,GITHUB_REF:'refs/heads/pr'},{...env,GITHUB_EVENT_NAME:'schedule'},{...env,GITHUB_ACTIONS:''},{...env,GITHUB_REPOSITORY:'other/repo'}])await assert.rejects(configureSettlementRecovery({mode:'enable',env:bad,runPostgres:()=>assert.fail('unprotected call')}),/PROTECTED_RUNNER/);
  await assert.rejects(configureSettlementRecovery({mode:'bad',env}),/CONTROL_MODE/);assert.throws(()=>settlementControlSql('true'),/CONTROL_MODE/);
  assert.match(settlementControlSql(false),/auto_settlement_recovery_enabled=false/);
});
test('configuration workflow is main-only, production-scoped, fixed-project TLS adapter and has no messaging keys',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/configure-settlement-recovery.yml',import.meta.url),'utf8');
  assert.match(workflow,/if: github.ref == 'refs\/heads\/main'/);assert.match(workflow,/environment: production/);assert.match(workflow,/SUPABASE_DB_URL/);assert.doesNotMatch(workflow,/TELEGRAM|API_FOOTBALL|run:.*\$\{\{/);
  const adapter=fs.readFileSync(new URL('../scripts/apply-durable-recovery.js',import.meta.url),'utf8');assert.match(adapter,/PGSSLMODE:'verify-full'/);assert.match(adapter,/decodeURIComponent\(url.username\)!==`postgres.\$\{PROJECT\}`/);
});

test('matching enabled flag alone never overrides missing security or audit proof after an unknown write',async()=>{
  for(const patch of [{securityOk:false},{audited:false},{securityOk:undefined},{audited:undefined},{maintenanceMode:true},{maintenanceMode:undefined}]){
    await assert.rejects(configureSettlementRecovery({mode:'enable',env,runPostgres:async options=>{if(options.write)throw Error('write rejected');return JSON.stringify({enabled:true,revision:6,securityOk:true,audited:true,maintenanceMode:false,...patch});}}),/WRITE_UNCONFIRMED/);
  }
});
