import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configureSettlementRecovery} from '../scripts/settlement-recovery-control.js';
const env={GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_synthetic_key'};
function store({maintenance=false,conflict=false,historyUnavailable=false}={}){
  let row={id:'global',maintenance_mode:maintenance,analysis_enabled:true,search_enabled:true,live_enabled:true,reminders_enabled:true,expanded_data_enabled:true,auto_settlement_recovery_enabled:false,ai_enabled:false,message:'existing notice',revision:4};
  const calls=[],history=[];
  return {get row(){return row;},calls,history,fetchImpl:async(raw,init={})=>{
    const url=new URL(raw),method=init.method || 'GET';calls.push({url,method,init});
    assert.equal(url.origin,'https://example.supabase.co');assert.equal(init.redirect,'error');
    assert.equal(init.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(init.headers.Authorization,undefined);
    if(url.pathname==='/rest/v1/runtime_control_history'){
      if(historyUnavailable)return new Response('{}',{status:503});
      if(method==='POST'){history.push(JSON.parse(init.body));return new Response(null,{status:201});}
      return Response.json(history);
    }
    assert.equal(url.pathname,'/rest/v1/runtime_controls');
    if(method==='GET')return Response.json([row]);
    assert.equal(method,'PATCH');assert.equal(url.searchParams.get('revision'),'eq.4');
    assert.equal(init.headers['X-Runtime-Action'],'update');assert.match(init.headers['X-Runtime-Reason-Hex'],/^[a-f0-9]+$/);
    if(conflict)return Response.json([]);
    row={...row,...JSON.parse(init.body)};
    // Existing database rule atomically records this update.
    history.push({revision:row.revision,action:'update'});
    return Response.json([row]);
  }};
}
test('protected activation reuses revision CAS/history and changes only the recovery flag',async()=>{
  const h=store(),before={...h.row};const result=await configureSettlementRecovery({mode:'enable',env,fetchImpl:h.fetchImpl});
  assert.deepEqual(result,{ok:true,enabled:true,changed:true,revision:5});
  for(const key of Object.keys(before).filter(key=>!['auto_settlement_recovery_enabled','revision'].includes(key)))assert.equal(h.row[key],before[key]);
  assert.equal(h.history.length,2);assert.equal(h.history[0].action,'baseline');assert.equal(h.row.auto_settlement_recovery_enabled,true);
  const calls=h.calls.length;assert.equal((await configureSettlementRecovery({mode:'enable',env,fetchImpl:h.fetchImpl})).changed,false);
  assert.equal(h.calls.slice(calls).every(call=>call.method==='GET'),true);
});
test('unprotected invocation, malformed mode, maintenance, CAS conflict and missing history cannot activate',async()=>{
  for(const badEnv of [{...env,GITHUB_REF:'refs/heads/pr'},{...env,GITHUB_EVENT_NAME:'schedule'},{...env,GITHUB_ACTIONS:''}]){
    const h=store();await assert.rejects(configureSettlementRecovery({mode:'enable',env:badEnv,fetchImpl:h.fetchImpl}),/PROTECTED_RUNNER/);assert.equal(h.calls.length,0);
  }
  for(const [options,code] of [[{maintenance:true},'PAUSED'],[{conflict:true},'CONFLICT'],[{historyUnavailable:true},'HISTORY_REQUIRED']]){
    const h=store(options);await assert.rejects(configureSettlementRecovery({mode:'enable',env,fetchImpl:h.fetchImpl}),new RegExp(code));assert.equal(h.row.auto_settlement_recovery_enabled,false);
  }
  await assert.rejects(configureSettlementRecovery({mode:'invalid',env}),/CONTROL_MODE/);
});
test('activation workflow uses protected main environment, no expression interpolation in commands and no ordinary sends',()=>{
  const source=fs.readFileSync(new URL('../.github/workflows/cron-runner.yml',import.meta.url),'utf8');
  assert.match(source,/if: github.ref == 'refs\/heads\/main'/);assert.match(source,/environment: background-jobs/);
  assert.match(source,/SETTLEMENT_AUTOMATION: \$\{\{ inputs.settlement_automation/);
  assert.match(source,/if: inputs.settlement_automation != 'enable' && inputs.settlement_automation != 'disable'\n\s+run: node scripts\/cron-runner.js/);
  assert.doesNotMatch(source,/run:.*\$\{\{/);
});
