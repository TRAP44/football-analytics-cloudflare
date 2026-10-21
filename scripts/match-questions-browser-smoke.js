import {createMatchQuestionRuntime} from '../src/match-question-runtime.js';
import {issueMatchQuestionAccess} from '../src/match-question-access.js';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';


let realHandlerCalls=0;
const runtime=createMatchQuestionRuntime({
 json:(body,status=200)=>Response.json(body,{status}),
 getCache:async()=>({match:{fixtureId:123,referee:'Michael Oliver',home:{name:'Chelsea'},away:{name:'Everton'}},probabilities:{home:54,draw:25,away:21}}),getStaleCache:async()=>null,setCache:async()=>true,
 getHistory:async()=>[{fixture_id:123}],hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async()=>{throw Error('direct question must not consume budget');},
 loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),memory:{},
});
const receipt=await issueMatchQuestionAccess('browser-fixture-secret',1,123);

const scenario=`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles/premium-ui.css"></head><body class="miniapp-public-shell">
<section class="mr-hq-hero" style="width:320px"><div class="center-hero-actions"><button>Обновить</button><button>Поделиться</button><button class="center-pass-btn">Pass на матч</button></div></section>
<section id="questions"></section><script type="module">
import {mountMatchQuestions} from '/modules/match-questions.js';
try {
 const root=document.getElementById('questions');let requests=[],reply;
 const api=async(url,options)=>{if(url!=='/api/match-question')throw Error('wrong endpoint');requests.push(JSON.parse(options.body));return await new Promise(resolve=>{reply=resolve;});};
 const mount=id=>mountMatchQuestions({root,fixtureId:id,accessReceipt:id===123 ? '${receipt}' : null,api,escapeHtml:value=>String(value).replaceAll('<','&lt;'),isCurrent:()=>true});
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 const facts=text=>({available:true,answer:'facts',items:[{role:'lead',connector:'Вывод:',text}]});
 const submit=question=>{root.querySelector('input').value=question;root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));};
 mount(123);
 if(requests.length || root.querySelector('[data-question-preset]') || root.querySelector('[data-question-start]'))throw Error('questions must start empty without preset actions');
 submit('Кто лучше играет дома?');
 if(requests.length!==1 || requests[0].question!=='Кто лучше играет дома?' || !root.textContent.includes('Ищу в данных'))throw Error('custom question did not ask');
 submit('Другой вопрос');if(requests.length!==1)throw Error('busy question was submitted twice');
 mount(123);reply(facts('Chelsea: подтверждённый факт'));await flush();
 if(!root.querySelector('[data-question-answer]').textContent.includes('Chelsea'))throw Error('same-analysis redraw lost answer');
 root.querySelector('input').value='Кто в форме?';root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 if(requests[1].question!=='Кто в форме?')throw Error('typed question did not submit');
 if(requests[1].accessReceipt!=='${receipt}')throw Error('text question lost its delivered-analysis receipt');
 reply(facts('Форма команды'));await flush();
 if(!root.querySelector('[data-question-answer]').textContent.includes('Форма команды'))throw Error('typed answer invisible');
 submit('Как играли раньше?');const oldReply=reply;
 mount(124);oldReply(facts('OLD MATCH ANSWER'));await flush();
 if(root.textContent.includes('OLD MATCH ANSWER'))throw Error('old match answer leaked');
 submit('Как играют дома?');if(requests.at(-1).fixtureId!==124)throw Error('wrong fixture');
 reply(facts('Новый матч'));await flush();
 if(!root.textContent.includes('Новый матч'))throw Error('new match answer missing');
 const grid=document.querySelector('.center-hero-actions').getBoundingClientRect(),pass=document.querySelector('.center-pass-btn').getBoundingClientRect();
 if(Math.abs(pass.width-grid.width)>1 || Math.abs(pass.left-grid.left)>1)throw Error('Pass is not centered/full width');
 const integrated=document.createElement('section');document.body.append(integrated);
 mountMatchQuestions({root:integrated,fixtureId:123,api:async(url,options)=>{const response=await fetch(url,options);if(!response.ok)throw Error('handler HTTP '+response.status);return response.json();},escapeHtml:value=>String(value).replaceAll('<','&lt;')});
 integrated.querySelector('input').value='Кто главный судья ?';
 integrated.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 for(let attempt=0;attempt<100 && !integrated.textContent.includes('Главный судья — Michael Oliver.');attempt++)await new Promise(resolve=>setTimeout(resolve,20));
 if(!integrated.querySelector('[data-question-answer]').textContent.includes('Главный судья — Michael Oliver.'))throw Error('screenshot question failed through actual handler');
 if(integrated.querySelector('[data-question-answer]').textContent.includes('Это подкрепляет'))throw Error('robotic connector remains');
 integrated.querySelector('input').value='Какая вероятность ничьей?';
 integrated.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 for(let attempt=0;attempt<100 && !integrated.querySelector('[data-question-answer]').textContent.includes('ничья — 25%');attempt++)await new Promise(resolve=>setTimeout(resolve,20));
 const distribution=integrated.querySelector('[data-question-answer]').textContent;
 if(!distribution.includes('Chelsea — 54%') || !distribution.includes('ничья — 25%') || !distribution.includes('Everton — 21%'))throw Error('complete distribution missing through actual handler');

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
    matchQuestionsEnabled:true,workersAi:{run:async()=>{throw Error('direct question must not call AI');}},
   },{id:1});realHandlerCalls++;
   res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());return;
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
 if(realHandlerCalls!==2)throw Error('actual handler was not exercised exactly twice');
 if(result?.status!=='passed')throw Error('Rendered question flow failed: '+JSON.stringify(result));
 console.log('Rendered questions passed: custom-only form without automatic requests, duplicate submit guard, same-analysis remount, typed question, actual referee/probabilities handler round trips, stale reply isolation, Pass alignment.');
}finally{cdp?.socket.close();await stopChrome(launched.chrome);server.close();await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
