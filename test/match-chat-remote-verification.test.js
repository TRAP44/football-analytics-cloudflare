import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../scripts/fixtures/match-chat-remote-worker.js';
import {summarizeChatProbe,safeProbeReport,safeCompatibilityReport} from '../scripts/verify-match-chat-remote.js';
import {EXPLANATION_MODEL} from '../src/match-explanation-runtime.js';
import {auditWorkflow} from '../scripts/privileged-access-audit.js';

test('remote harness calls the actual handler, checks grounded facts and isolates the previous model',async()=>{
  const calls=[];const env={PROBE_NONCE:'local-fixture-only',AI:{run:async(model,input)=>{
    calls.push({model,input});if(model!==EXPLANATION_MODEL)throw Error('model not found');
    if(input.messages.some(message=>message.content.includes('Question: Как команды играли друг с другом раньше')))return {response:'{"factIds":["h2h"]}'};
    if(input.messages.some(message=>message.content.includes('Question: Сколько в среднем забивает Home FC')))return {response:'{"factIds":["attack_home"]}'};
    return {response:input.messages.some(message=>message.content.includes('Question: Что модель говорит о результативности')) ? '{"factIds":["goals_high"]}' : '{"factIds":["form_home","form_away"]}'};
  }}};
  for(const variant of ['previous','current']){
    const result=await worker.fetch(new Request('https://local.test/probe',{method:'POST',headers:{'x-probe-key':env.PROBE_NONCE},body:JSON.stringify({variant})}),env);
    const report=await result.json();
    assert.equal(report.modelCalls,variant==='current' ? 3 : 1);assert.equal(summarizeChatProbe(report),variant==='current');
    if(variant==='previous')assert.equal(report.modelFailure,'model_unavailable');
    else{assert.equal(report.model,EXPLANATION_MODEL);assert.ok(report.items[0].text.includes('побед — 4'));}
  }
  assert.ok(calls[1].input.messages.some(message=>message.content.includes('результаты последних матчей')));
});

test('remote harness denies unauthenticated probes before any inference',async()=>{
  let calls=0;const result=await worker.fetch(new Request('https://local.test/probe',{method:'POST',body:'{}'}),{PROBE_NONCE:'local-only',AI:{run:async()=>{calls++;}}});
  assert.equal(result.status,404);assert.equal(calls,0);
  assert.equal(summarizeChatProbe({available:true,source:'preset',items:[{text:'Home FC'}]}),false);
});

test('conversational remote fixture exercises live answers, changed score, context, missing roster and generated explanation',async(t)=>{
  // The isolated admission fixture must not depend on the runner's hour edge.
  t.mock.method(Date,'now',()=>Date.parse('2026-10-24T21:59:59Z'));
  const env={PROBE_NONCE:'local-conversation-fixture',AI:{run:async(_model,input)=>{
    const question=input.messages.at(-1).content;
    let paragraphs;
    if(question.includes('стартовом'))paragraphs=[{kind:'missing',text:'lineups',factIds:[]}];
    else if(question.includes('предматчевая'))paragraphs=[{kind:'answer',text:'',factIds:['pre_form_home','pre_form_away']},{kind:'analysis',text:'Если опираться на форму до матча, Home FC может иметь преимущество. Это не гарантия результата.',factIds:['pre_form_home','pre_form_away']}];
    else paragraphs=[{kind:'answer',text:'',factIds:[question.includes('створ') ? 'stat_0' : 'score']}];
    return new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({response:paragraphs.map(item=>JSON.stringify(item)).join('\n')+'\n'})+'\n\ndata: [DONE]\n\n'));controller.close();}});
  }}};
  const response=await worker.fetch(new Request('https://local.test/probe',{method:'POST',headers:{'x-probe-key':env.PROBE_NONCE},body:JSON.stringify({variant:'conversation'})}),env);
  const report=await response.json();
  assert.equal(report.success,true);assert.equal(report.modelCalls,4);assert.equal(report.timings.length,5);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.doesNotMatch(JSON.stringify(report),/Home FC|Away FC|local-conversation-fixture/,'only bounded verdicts and timing leave the probe');
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

test('compatibility controls are nonce protected, fixed and never expose raw errors or model text',async()=>{
 let calls=0;const models=[];
 const env={PROBE_NONCE:'control-fixture',AI:{run:async(model,input)=>{
  calls++;models.push(model);assert.equal(input.max_tokens,64);assert.equal(input.stream,false);
  if(model.includes('3.1') && input.response_format)throw Error('JSON Mode unsupported private details');
  return {response:{ok:true,private:'private details'}};
 }}};
 const request=key=>new Request('https://local.test/probe',{method:'POST',headers:{'x-probe-key':key},body:JSON.stringify({variant:'compatibility',model:'caller-model',prompt:'private details'})});
 assert.equal((await worker.fetch(request('wrong'),env)).status,404);assert.equal(calls,0);
 const report=safeCompatibilityReport(await (await worker.fetch(request(env.PROBE_NONCE),env)).json());
 assert.equal(calls,4);assert.equal(new Set(models).size,2);
 assert.deepEqual(report.map(item=>item.passed),[true,false,true,true]);
 assert.deepEqual(report.slice(0,2).map(item=>item.failure),['none','CHAT_SCHEMA_UNSUPPORTED']);
 assert.doesNotMatch(JSON.stringify(report),/private|caller-model|control-fixture/);
 assert.equal(safeCompatibilityReport({results:[{candidate:'existing_plain',failure:'secret',durationMs:-1}]} )[0].failure,'none');
});
