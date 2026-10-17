import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';
import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';

const scenario=`<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/styles/premium-ui.css"></head><body class="miniapp-public-shell">
<section class="mr-hq-hero" style="width:320px"><div class="center-hero-actions"><button>Обновить</button><button>Поделиться</button><button class="center-pass-btn">Pass на матч</button></div></section>
<section id="questions"></section><script type="module">
import {mountMatchQuestions} from '/modules/match-questions.js';
try {
 const root=document.getElementById('questions');let requests=[],reply;
 const api=async(url,options)=>{if(url!=='/api/match-question')throw Error('wrong endpoint');requests.push(JSON.parse(options.body));return await new Promise(resolve=>{reply=resolve;});};
 const mount=id=>mountMatchQuestions({root,fixtureId:id,api,escapeHtml:value=>String(value).replaceAll('<','&lt;'),isCurrent:()=>true});
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 const facts=text=>({available:true,answer:'facts',items:[{role:'lead',connector:'Вывод:',text}]});
 mount(123);root.querySelector('[data-question-start]').click();
 if(requests.length!==1 || requests[0].preset!=='why' || !root.textContent.includes('Ищу в данных'))throw Error('start button did not ask');
 mount(123);reply(facts('Chelsea: подтверждённый факт'));await flush();
 if(!root.querySelector('[data-question-answer]').textContent.includes('Chelsea'))throw Error('same-analysis redraw lost answer');
 root.querySelector('input').value='Кто в форме?';root.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 if(requests[1].question!=='Кто в форме?')throw Error('typed question did not submit');
 reply(facts('Форма команды'));await flush();
 if(!root.querySelector('[data-question-answer]').textContent.includes('Форма команды'))throw Error('typed answer invisible');
 root.querySelector('[data-question-start]').click();const oldReply=reply;
 mount(124);oldReply(facts('OLD MATCH ANSWER'));await flush();
 if(root.textContent.includes('OLD MATCH ANSWER'))throw Error('old match answer leaked');
 root.querySelector('[data-question-start]').click();if(requests.at(-1).fixtureId!==124)throw Error('wrong fixture');
 reply(facts('Новый матч'));await flush();
 if(!root.textContent.includes('Новый матч'))throw Error('new match answer missing');
 const grid=document.querySelector('.center-hero-actions').getBoundingClientRect(),pass=document.querySelector('.center-pass-btn').getBoundingClientRect();
 if(Math.abs(pass.width-grid.width)>1 || Math.abs(pass.left-grid.left)>1)throw Error('Pass is not centered/full width');
 document.body.dataset.testStatus='passed';
} catch(error){document.body.dataset.testStatus='failed';document.body.dataset.testError=error.message;}
</script></body></html>`;
const root=path.resolve('public');
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
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
 if(result?.status!=='passed')throw Error('Rendered question flow failed: '+JSON.stringify(result));
 console.log('Rendered questions passed: start action, same-analysis remount, typed question, stale reply isolation, Pass alignment.');
}finally{cdp?.socket.close();await stopChrome(launched.chrome);server.close();await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
