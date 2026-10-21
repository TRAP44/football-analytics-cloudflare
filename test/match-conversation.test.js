import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMatchChatContext,issueChatContext,readChatContext} from '../src/match-chat-context.js';
import {createMatchQuestionRuntime} from '../src/match-question-runtime.js';
import {validateChatParagraph,consumeChatModel} from '../src/match-chat-runtime.js';
import {readMatchChatEvents} from '../public/modules/client-core.js';
import {conversationHtml} from '../public/modules/match-questions.js';

const trust={confidenceBearing:true,stale:false,provenanceState:'verified',fetchedAt:'2026-10-21T12:00:00Z'};
const center=()=>({mode:'live',generatedAt:'2026-10-21T12:00:00Z',match:{fixtureId:77,home:{name:'Home FC'},away:{name:'Away FC'},score:{home:1,away:0},elapsed:65,statusLabel:'Второй тайм',referee:'Official'},dataFreshness:{match:trust,statistics:trust,events:trust,lineups:trust},availability:{statistics:true,events:true,lineupsTrusted:true},statistics:{items:[{key:'Shots on Goal',label:'Удары в створ',home:6,away:2}]},events:[{side:'home',minute:64,player:'Home Player',label:'Гол'}],lineups:{home:{startXI:[{name:'Home Player'}]}},lineupQuality:{bothConfirmed:false}});
const paragraph={kind:'answer',text:'Home FC ведёт 1:0.',factIds:['score']};
const sse=text=>new ReadableStream({start(controller){
  const encoder=new TextEncoder();
  // One-byte chunks exercise UTF-8 and SSE boundary handling.
  for(const byte of encoder.encode('data: '+JSON.stringify({response:text})+'\n\ndata: [DONE]\n\n'))controller.enqueue(Uint8Array.of(byte));
  controller.close();
}});
function fixture(overrides={},config={}){
  const calls={model:[],rpc:[],cache:0,center:0};
  let snapshot=center();
  const deps={json:(data,status=200)=>Response.json(data,{status}),getCache:async()=>{calls.cache++;return {match:{fixtureId:77},probabilities:{home:54,draw:25,away:21}};},getStaleCache:async()=>null,setCache:async()=>true,getHistory:async()=>[],userHasAnalyzedFixture:async()=>false,hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async(_cfg,name,args)=>{calls.rpc.push(args.p_bucket_key);return {allowed:true,count:1};},loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),loadMatchContext:async()=>{calls.center++;return structuredClone(snapshot);},...overrides};
  const cfg={botToken:'local-test-secret',matchQuestionsEnabled:true,matchQuestionsDailyLimit:500,matchQuestionsUserHourlyLimit:10,workersAi:{run:async(model,input)=>{calls.model.push(input);return sse(JSON.stringify(paragraph)+'\n');}},...config};
  const rt=createMatchQuestionRuntime(deps);
  return {calls,cfg,setCenter:value=>{snapshot=value;},ask:(body={},user={id:1})=>rt.apiMatchQuestion(new Request('https://test.invalid/api/match-question',{method:'POST',body:JSON.stringify({fixtureId:77,mode:'conversation',question:'Как сейчас идёт игра?',...body})}),cfg,user)};
}
async function collect(response){const events=[];const data=await readMatchChatEvents(response,event=>events.push(event));return {events,data};}

test('LIVE catalogue gates each feature, carries real score/events, and never includes odds',()=>{
  const payload=center();payload.liveOdds={secretOdds:'must not reach model'};
  let context=buildMatchChatContext(payload);
  assert.match(context.facts.find(f=>f.id==='score').text,/1:0/);
  assert.match(context.facts.find(f=>f.id==='event_0').text,/64′.*Home Player/);
  assert.ok(context.facts.some(f=>f.id==='stat_0'));
  assert.ok(context.facts.some(f=>f.id==='starters_home'));
  assert.doesNotMatch(JSON.stringify(context),/secretOdds/);
  for(const key of ['match','statistics','events','lineups'])payload.dataFreshness[key]={...trust,stale:true};
  context=buildMatchChatContext(payload);
  assert.equal(context.currentVerified,false);
  assert.ok(!context.facts.some(f=>/score|minute|stat_|event_|starters_/.test(f.id)));
});

test('dialogue proof is UTF-8 safe, expires, and is bound to account and fixture',async()=>{
  const turns=[{role:'user',content:'А почему?'},{role:'assistant',content:'По данным матча.'}];
  const now=Date.now(),token=await issueChatContext('secret',1,77,turns,now);
  assert.deepEqual(await readChatContext(token,'secret',1,77,now),turns);
  for(const [secret,user,fixture,time] of [['other',1,77,now],['secret',2,77,now],['secret',1,78,now],['secret',1,77,now+1800001]])assert.equal(await readChatContext(token,secret,user,fixture,time),null);
  assert.equal(await readChatContext(token.replace('mc1.','mc1.x'),'secret',1,77,now),null);
});

test('grounding rejects invented numbers, unknown citations, unlabeled historic forecasts, unsafe prose and false missing answers',()=>{
  const context=buildMatchChatContext(center(),{match:center().match,probabilities:{home:54,draw:25,away:21}});
  assert.match(validateChatParagraph(paragraph,context).text,/Home FC 1:0 Away FC/);
  const invalid=[{kind:'analysis',text:'Если Home FC забьёт 7 голов, исход изменится.',factIds:['score']},{...paragraph,factIds:['unknown']},{kind:'scenario',text:'Home FC обязательно победит.',factIds:['match']},{kind:'analysis',text:'Это может означать вероятность победы хозяев — 54%.',factIds:['pre_outcome_probabilities']}];
  for(const value of invalid)assert.equal(validateChatParagraph(value,context),null);
  assert.ok(validateChatParagraph({kind:'analysis',text:'Если опираться на оценку до матча, модель давала Home FC 54%.',factIds:['pre_outcome_probabilities']},context));
});

test('actual handler answers in LIVE without full-analysis ownership and refreshes snapshot on follow-up',async()=>{
  const f=fixture();
  const first=await collect(await f.ask());
  assert.equal(first.data.answer,'conversation');assert.ok(first.data.context);
  assert.deepEqual(first.events.map(event=>event.type),['meta','paragraph','done']);
  assert.equal(f.calls.cache,0,'no shared premium cache exposure to non-owner');
  assert.ok(f.calls.rpc.includes('ai-ask:user:1'));
  const updated=center();updated.match.score={home:2,away:0};updated.match.elapsed=70;f.setCenter(updated);
  f.cfg.workersAi.run=async(_model,input)=>{f.calls.model.push(input);return sse(JSON.stringify({...paragraph,text:'Теперь Home FC ведёт 2:0.'})+'\n');};
  const second=await collect(await f.ask({question:'А теперь?',context:first.data.context}));
  assert.match(second.events.find(e=>e.type==='paragraph').data.text,/2:0/);
  assert.equal(f.calls.center,2);
  const messages=f.calls.model[1].messages;
  assert.ok(messages.some(m=>m.role==='assistant' && m.content==='Счёт: Home FC 1:0 Away FC.'));
  assert.ok(messages.some(m=>m.content.includes('Home FC 2:0 Away FC')));
});

test('cross-account or fixture dialogue is rejected before data, quotas and inference',async()=>{
  const f=fixture();const token=await issueChatContext(f.cfg.botToken,2,77,[],Date.now());
  const response=await f.ask({context:token});assert.equal((await response.json()).reason,'context_expired');
  assert.equal(f.calls.model.length,0);assert.equal(f.calls.rpc.length,0);assert.equal(f.calls.center,0);
});

test('full-analysis enrichment requires strict ownership and current roster supersedes historic roster',async()=>{
  const f=fixture({userHasAnalyzedFixture:async()=>true});
  await collect(await f.ask());assert.equal(f.calls.cache,1);
  assert.ok(f.calls.model[0].messages.some(m=>m.content.includes('До матча: Оценка модели')));
});

test('AI switches, unauthenticated requests and betting are rejected before model and budgets',async()=>{
  for(const [deps,cfg,user,expected] of [[{}, {},{},'AUTH_REQUIRED'],[{}, {matchQuestionsEnabled:false},{id:1},'disabled'],[{loadRuntimeControls:async()=>({value:{aiEnabled:false}})}, {},{id:1},'ai_disabled'],[{loadRuntimeControls:async()=>({value:{maintenanceMode:true}})}, {},{id:1},'analysis_disabled']]){
    const f=fixture(deps,cfg),result=await (await f.ask({},user)).json();assert.equal(result.code || result.reason,expected);assert.equal(f.calls.model.length,0);assert.equal(f.calls.rpc.length,0);
  }
  const f=fixture();assert.equal((await (await f.ask({question:'На кого ставить деньги?'})).json()).answer,'refused');assert.equal(f.calls.center,0);
});

test('shared atomic quota prevents conversational inference just as it does legacy questions',async()=>{
  const f=fixture({supaRpc:async()=>({allowed:false,count:10})});
  assert.equal((await (await f.ask()).json()).reason,'user_limit');assert.equal(f.calls.model.length,0);
});

test('unsupported model text never leaves server as a paragraph and gets an explicit terminal failure',async()=>{
  const f=fixture({}, {workersAi:{run:async()=>sse(JSON.stringify({...paragraph,kind:'analysis',text:'Если будет счёт 9:0, исход изменится.'})+'\n')}});
  const result=await collect(await f.ask());assert.equal(result.data.reason,'ai_unavailable');
  assert.deepEqual(result.events.map(e=>e.type),['meta','error']);
});

test('partial validated prose is streamed before completion; a broken next paragraph is not called a successful conversation',async()=>{
  let continueModel;
  const f=fixture({}, {workersAi:{run:async()=>new ReadableStream({start(controller){const encoder=new TextEncoder();controller.enqueue(encoder.encode('data: '+JSON.stringify({response:JSON.stringify(paragraph)+'\n'})+'\n\n'));continueModel=()=>{controller.enqueue(encoder.encode('data: '+JSON.stringify({response:'bad JSON\n'})+'\n\n'));controller.close();};}})}});
  const response=await f.ask();let firstResolve;
  const firstParagraph=new Promise(resolve=>{firstResolve=resolve;});
  const events=[];const completed=readMatchChatEvents(response,event=>{events.push(event);if(event.type==='paragraph')firstResolve();});
  await firstParagraph;assert.equal(events.at(-1).type,'paragraph');continueModel();
  const result=await completed;assert.equal(result.partial,true);assert.equal(result.context,undefined);assert.equal(events.at(-1).type,'error');
});

test('model reader cancels a pending read on abort and ignores malformed SSE frames',async()=>{
  let cancelled=false;const abort=new AbortController();
  const reading=consumeChatModel(new ReadableStream({cancel(){cancelled=true;}}),()=>{},abort.signal);
  abort.abort();await assert.rejects(reading);assert.equal(cancelled,true);
});

test('client refuses silently truncated streams, escapes chat and evidence and bounds transcript',async()=>{
  await assert.rejects(readMatchChatEvents(new Response('event: meta\ndata: {}\n\n'),()=>{}),/прервался/);
  const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html=conversationHtml({messages:[{question:'<script>',paragraphs:[{kind:'analysis',text:'<img>',evidence:[{id:'x',text:'<iframe>'}]}]}]},esc);
  assert.doesNotMatch(html,/<script>|<img>|<iframe>/i);assert.match(html,/&lt;img&gt;/);
});

test('a model stream truncated at a paragraph boundary does not silently finish the answer',async()=>{
  const bytes=new TextEncoder().encode('data: '+JSON.stringify({response:JSON.stringify(paragraph)+'\n'})+'\n\n');
  const f=fixture({}, {workersAi:{run:async()=>new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})}});
  const result=await collect(await f.ask());assert.equal(result.data.partial,true);assert.equal(result.data.answer,undefined);
});


test('unsupported factual prose is replaced with canonical evidence, including a smuggled missing-data claim',()=>{
 const context=buildMatchChatContext(center());
 for(const text of ['Мбаппе получил красную карточку.','Away FC ведёт 8:0.']){
  const result=validateChatParagraph({kind:'answer',text,factIds:['score']},context);
  assert.equal(result.text,'Счёт: Home FC 1:0 Away FC.');
 }
 const missing=validateChatParagraph({kind:'missing',text:'Мбаппе получил красную карточку, но нет данных.',factIds:[]},context);
 assert.doesNotMatch(missing.text,/Мбаппе|карточ/);
 assert.equal(validateChatParagraph({kind:'analysis',text:'Это может означать, что Мбаппе получил красную карточку.',factIds:['match']},context),null);
 const stale=center();stale.dataFreshness.match={...trust,stale:true};
 assert.doesNotMatch(buildMatchChatContext(stale).facts.find(f=>f.id==='phase').text,/Матч идёт/);
});

test('request cancelled during match load never reserves quota or starts inference',async()=>{
 let release,loaded;const loading=new Promise(resolve=>{loaded=resolve;});
 const f=fixture({loadMatchContext:async()=>{loaded();return new Promise(resolve=>{release=resolve;});}});
 const controller=new AbortController();
 const rt=createMatchQuestionRuntime({json:(v,s=200)=>Response.json(v,{status:s}),getCache:async()=>null,getStaleCache:async()=>null,setCache:async()=>true,getHistory:async()=>[],hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async()=>{throw Error('must not reserve');},loadRuntimeControls:async()=>({value:{}}),loadMatchContext:async()=>{loaded();return new Promise(resolve=>{release=resolve;});}});
 const result=rt.apiMatchQuestion(new Request('https://test.invalid/api/match-question',{method:'POST',signal:controller.signal,body:JSON.stringify({mode:'conversation',fixtureId:77,question:'Как идёт игра?'})}),f.cfg,{id:1});
 await loading;controller.abort();release(center());
 assert.equal((await (await result).json()).reason,'cancelled');assert.equal(f.calls.model.length,0);
});


test('both long starting XIs survive canonical streaming and transcript rendering in full',async()=>{
 const payload=center();
 payload.lineups={};
 for(const side of ['home','away'])payload.lineups[side]={startXI:Array.from({length:11},(_,i)=>({name:`${side} Player ${i+1} Verylong Familyname Surname One Two Three Four`}))};
 payload.lineupQuality={bothConfirmed:true};
 const f=fixture({}, {workersAi:{run:async()=>sse(JSON.stringify({kind:'answer',text:'',factIds:['starters_home','starters_away']})+'\n')}});f.setCenter(payload);
 const result=await collect(await f.ask({question:'Покажи оба стартовых состава'}));
 assert.equal(result.data.answer,'conversation');
 const paragraphs=result.events.filter(event=>event.type==='paragraph').map(event=>event.data);
 const html=conversationHtml({messages:[{question:'Составы',paragraphs}]},String);
 assert.match(html,/home Player 11/);assert.match(html,/away Player 11/);
 assert.ok(paragraphs[0].text.length>900);
});

test('plain referee, published starting XI and missing model lookups preserve zero-inference path and follow-up context',async()=>{
 const f=fixture();
 for(const question of ['Кто главный судья?','Кто в старте?','Какие вероятности исходов?','Сколько голов будет?']){
  const result=await collect(await f.ask({question}));
  assert.equal(result.data.answer,'conversation');assert.equal(result.data.source,'data');assert.ok(result.data.context);
 }
 assert.equal(f.calls.model.length,0);assert.equal(f.calls.rpc.length,0);
});
