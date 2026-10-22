import {createMatchQuestionRuntime} from '../src/match-question-runtime.js';
import {issueMatchQuestionAccess} from '../src/match-question-access.js';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';


let realHandlerCalls=0;
const modelFailures=[];
const trust={confidenceBearing:true,stale:false,provenanceState:'verified',fetchedAt:new Date().toISOString()};
const runtime=createMatchQuestionRuntime({
 json:(body,status=200)=>Response.json(body,{status}),
 recordOpsEvent:async(_cfg,event)=>modelFailures.push(event.message),
 getCache:async()=>({match:{fixtureId:123,home:{name:'Chelsea'},away:{name:'Everton'}},probabilities:{home:54,draw:25,away:21}}),getStaleCache:async()=>null,setCache:async()=>true,
 getHistory:async()=>[{fixture_id:123}],userHasAnalyzedFixture:async()=>true,hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async()=>({allowed:true,count:1}),
 loadMatchContext:async()=>({mode:'live',match:{fixtureId:123,home:{name:'Chelsea'},away:{name:'Everton'},referee:'Michael Oliver',score:{home:1,away:0},elapsed:65},dataFreshness:{match:trust}}),
 loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),memory:{},
});
const receipt=await issueMatchQuestionAccess('browser-fixture-secret',1,123);
const scenario=`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/premium-ui.css"></head><body class="miniapp-public-shell">
<section class="mr-hq-hero" style="width:320px"><div class="center-hero-actions"><button>Обновить</button><button>Поделиться</button><button class="center-pass-btn">Pass на матч</button></div></section>
<section id="questions"></section><script type="module">
import {mountMatchQuestions} from '/modules/match-questions.js';
import {createApiClient} from '/modules/client-core.js';
try {
 const root=document.getElementById('questions');let requests=[],reply,event,signal;
 const api=async(url,options)=>{if(url!=='/api/match-question')throw Error('wrong endpoint');requests.push(JSON.parse(options.body));event=options.onEvent;signal=options.signal;return await new Promise((resolve,reject)=>{reply=resolve;signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError')),{once:true});});};
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');
 const mount=(id,userId=1)=>mountMatchQuestions({root,fixtureId:id,userId,accessReceipt:id===123 ? '${receipt}' : null,api,escapeHtml:esc,isCurrent:()=>true});
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 const paragraph=text=>({kind:'answer',text,factIds:['match'],evidence:[]});
 const complete=(text,context='signed-fixture-context')=>{event({type:'paragraph',data:paragraph(text)});event({type:'done',data:{available:true,answer:'conversation',context}});reply({available:true,answer:'conversation',context});};
 const submit=question=>{root.querySelector('input').value=question;root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
 mount(123);
 if(requests.length || root.querySelector('[data-question-preset]') || root.querySelector('[data-question-start]'))throw Error('questions must start empty');
 submit('Кто лучше играет дома?');
 if(requests.length!==1 || requests[0].mode!=='conversation' || !root.textContent.includes('Сверяюсь'))throw Error('custom question did not ask');
 submit('Другой вопрос');if(requests.length!==1)throw Error('busy question submitted twice');
 event({type:'paragraph',data:paragraph('Первый абзац уже виден')});
 if(!root.textContent.includes('Первый абзац') || !root.querySelector('button').disabled)throw Error('progressive paragraph not visible during inference');
 mount(123);event({type:'done',data:{available:true,context:'signed-fixture-context'}});reply({available:true});await flush();
 submit('А почему?');
 if(requests[1].context!=='signed-fixture-context' || requests[1].accessReceipt!=='${receipt}')throw Error('follow-up lost context or receipt');
 const long=Array.from({length:22},(_,i)=>'Player '+(i+1)+' Verylong Familyname Surname One Two Three Four').join(', ');if(long.length<=1000)throw Error('long fixture too short');complete(long);await flush();
 if(!root.textContent.includes('Player 22'))throw Error('long XI clipped');
 submit('Как играли раньше?');const oldSignal=signal;
 mount(124);await flush();if(!oldSignal.aborted)throw Error('old request not cancelled');
 if(root.textContent.includes('Player 22'))throw Error('old match leaked');
 submit('Как играют дома?');if(requests.at(-1).fixtureId!==124 || requests.at(-1).context)throw Error('cross-match context leaked');
 complete('Новый матч');await flush();if(!root.textContent.includes('Новый матч'))throw Error('new answer missing');
 mount(124,2);if(root.textContent.includes('Новый матч'))throw Error('account dialogue leaked');
 const grid=document.querySelector('.center-hero-actions').getBoundingClientRect(),pass=document.querySelector('.center-pass-btn').getBoundingClientRect();
 if(Math.abs(pass.width-grid.width)>1 || Math.abs(pass.left-grid.left)>1)throw Error('Pass alignment');
 const integrated=document.createElement('section');document.body.append(integrated);
 const clientState={clientPerf:{requests:0,completed:0,failed:0,totalMs:0,rateLimited:0,retries:0,timeouts:0,deduped:0}};
 const realApi=createApiClient({state:clientState,tg:{initData:'local-browser-test'},inflightGetRequests:new Map(),observeServerVersion:()=>{},showBootRecovery:()=>{},applyRuntimeUi:()=>{},normalizeApiError:e=>e,noteRequestSuccess:()=>{},noteRequestFailure:()=>{}});
 mountMatchQuestions({root:integrated,fixtureId:123,userId:3,api:realApi,accessReceipt:'${receipt}',escapeHtml:esc});
 const askReal=async(question,expected)=>{
  integrated.querySelector('input').value=question;integrated.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<100 && !integrated.textContent.includes(expected);i++)await new Promise(resolve=>setTimeout(resolve,20));
  if(!integrated.textContent.includes(expected))throw Error('actual handler answer missing: '+expected+'; fixture UI: '+integrated.textContent.slice(-1200));
  for(let i=0;i<100 && integrated.querySelector('button').disabled;i++)await new Promise(resolve=>setTimeout(resolve,20));
 };
 await askReal('Кто главный судья?','Главный судья — Michael Oliver.');
 await askReal('Какие вероятности исходов?','ничья — 25%');
 await askReal('Что важно в этом матче?','Если хозяева сохранят преимущество');
 if(clientState.clientPerf.completed!==3)throw Error('stream requests not recorded as complete');
 document.body.dataset.testStatus='passed';
} catch(error){document.body.dataset.testStatus='failed';document.body.dataset.testError=error.message;}
</script></body></html>`;
const root=path.resolve('public');
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/match-question' && req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const response=await runtime.apiMatchQuestion(new Request('https://fixture.invalid/api/match-question',{method:'POST',body}),{
    botToken:'browser-fixture-secret',matchQuestionsEnabled:true,matchQuestionsDailyLimit:500,matchQuestionsUserHourlyLimit:10,workersAi:{run:async(_model,input)=>{
     if(input.stream!==false)throw Error('supported JSON transport required');
     if(input.messages.at(-1).content.includes('важно')){
      if(input.response_format?.type!=='json_schema')throw Error('structured reply schema required');
      return {response:{factIds:['score'],interpretation:'Если хозяева сохранят преимущество, гостям может потребоваться больше риска в атаке.',missingTopic:''}};
     }
     const ids=input.messages.at(-1).content.includes('судья') ? ['referee'] : ['pre_outcome_probabilities'];
     const text=JSON.stringify({kind:'answer',text:'',factIds:ids})+'\n';
     return new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({response:text})+'\n\ndata: [DONE]\n\n'));controller.close();}});
    }},
   },{id:1});realHandlerCalls++;
   res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type'));for await(const chunk of response.body)res.write(chunk);res.end();return;
  }
  if(pathname==='/test'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(scenario);return;}
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('path');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/plain');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());
let cdp;
try{
 const endpoint='http://127.0.0.1:'+launched.debugPort;
 const tab=await (await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json();
 cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');
 await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/test`});
 let result;
 for(let attempt=0;attempt<100;attempt++){
  const response=await cdp.call('Runtime.evaluate',{expression:'({status:document.body?.dataset.testStatus,error:document.body?.dataset.testError,ready:document.readyState})',returnByValue:true});
  result=response.result?.value;
  if(result?.status)break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(realHandlerCalls!==3)throw Error('actual handler was not exercised exactly three times');
 if(result?.status!=='passed')throw Error('Rendered question flow failed: '+JSON.stringify(result)+'; fixture model failures: '+JSON.stringify(modelFailures));
 console.log('Rendered conversations passed: custom-only form without automatic requests, duplicate submit guard, same-analysis remount, typed question, actual referee/probabilities handler round trips, stale reply isolation, Pass alignment.');
}finally{cdp?.socket.close();await stopChrome(launched.chrome);server.close();await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
