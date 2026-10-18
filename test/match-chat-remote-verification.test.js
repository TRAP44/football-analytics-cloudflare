import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../scripts/fixtures/match-chat-remote-worker.js';
import {summarizeChatProbe,safeProbeReport} from '../scripts/verify-match-chat-remote.js';
import {EXPLANATION_MODEL} from '../src/match-explanation-runtime.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';

test('remote harness calls the actual handler, checks grounded facts and isolates the previous model',async()=>{
  const calls=[];const env={PROBE_NONCE:'local-fixture-only',AI:{run:async(model,input)=>{
    calls.push({model,input});if(model.endsWith('fp8-fast'))throw Error('model not found');
    return {response:'{"factIds":["form_home","form_away"]}'};
  }}};
  for(const variant of ['previous','current']){
    const result=await worker.fetch(new Request('https://local.test/probe',{method:'POST',headers:{'x-probe-key':env.PROBE_NONCE},body:JSON.stringify({variant})}),env);
    const report=await result.json();
    assert.equal(report.modelCalls,1);assert.equal(summarizeChatProbe(report),variant==='current');
    if(variant==='previous')assert.equal(report.modelFailure,'model_unavailable');
    else{assert.equal(report.model,EXPLANATION_MODEL);assert.ok(report.items[0].text.includes('4 победы'));}
  }
  assert.ok(calls[1].input.messages.some(message=>message.content.includes('результаты последних матчей')));
});

test('remote harness denies unauthenticated probes before any inference',async()=>{
  let calls=0;const result=await worker.fetch(new Request('https://local.test/probe',{method:'POST',body:'{}'}),{PROBE_NONCE:'local-only',AI:{run:async()=>{calls++;}}});
  assert.equal(result.status,404);assert.equal(calls,0);
  assert.equal(summarizeChatProbe({available:true,source:'preset',items:[{text:'Home FC'}]}),false);
});

test('real-model verification is main-only, manual, production-protected and scoped to existing Cloudflare credentials',()=>{
  const file='.github/workflows/verify-match-chat.yml';const text=fs.readFileSync(file,'utf8');
  assert.deepEqual(auditWorkflow(file,text),[]);
  assert.match(text,/workflow_dispatch:/);assert.match(text,/if: github.ref == 'refs\/heads\/main'/);
  assert.match(text,/environment: production/);assert.match(text,/persist-credentials: false/);
  assert.doesNotMatch(text,/TELEGRAM_BOT_TOKEN|SUPABASE_SECRET_KEY|wrangler deploy|pull_request_target/);
});

test('persisted probe report excludes arbitrary remote text and fields',()=>{
  const report=safeProbeReport({model:'untrusted',modelFailure:'secret',items:[{id:'form_home',text:'untrusted'}],extra:'secret'});
  assert.equal(report.model,'unexpected');assert.equal(report.modelFailure,'none');
  assert.equal(report.passed,false);assert.doesNotMatch(JSON.stringify(report),/untrusted|secret/);
});

test('verification permits remote bindings while serving the fixture only on loopback',()=>{
  const script=fs.readFileSync('scripts/verify-match-chat-remote.js','utf8');
  const invocation=script.match(/child=spawn\([^;]+/s)?.[0];
  assert.ok(invocation);assert.doesNotMatch(invocation,/['"]--local['"]|['"]--remote['"]/);
  assert.match(invocation,/['"]--ip['"],['"]127\.0\.0\.1['"]/);
  assert.match(script,/ai:\{binding:'AI',remote:true\}/);
});
