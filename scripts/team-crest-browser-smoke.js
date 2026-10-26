import {createServer} from 'node:http';
import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {launchChromeWithRetry,stopChrome,Cdp,browserExecutable} from './bottom-nav-render-smoke.js';

// Real decoded provider PNGs. Synthetic image URLs exercise HTTP200 placeholders
// without querying a provider or claiming these fixture IDs belong to a club.
const missing=await readFile('test-support/fixtures/api-sports-unavailable-25763.png');
const genuine=await readFile('test-support/fixtures/api-sports-team-33.png');
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(`<!doctype html><html lang="ru" data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/public-shell.css"><link rel="stylesheet" href="/styles/premium-ui.css"><body class="miniapp-public-shell" style="background:#090e14;color:white"><section id="homeFeatured"><div id="homeFeaturedCard"></div></section><main style="display:flex;gap:16px;padding:20px">
        <div id="camera" style="width:60px;height:60px"><img data-team-crest="Camera FC" crossorigin="anonymous" src="https://media.api-sports.io/football/teams/900001.png" style="width:60px;height:60px"></div>
        <div id="genuine" style="width:32px;height:32px"><img data-team-crest="Genuine FC" crossorigin="anonymous" src="https://media.api-sports.io/football/teams/33.png" style="width:32px;height:32px"></div>
        <div id="failed"><img data-team-crest="Missing FC" crossorigin="anonymous" src="https://media.api-sports.io/football/teams/900002.png" style="width:32px;height:32px"></div>
        </main><script type="module">import {installCrestFallback} from '/modules/team-crest.js';import {createHomeSignalRenderer} from '/modules/home-signal.js';
        const fixture={fixtureId:999,date:new Date().toISOString(),live:true,status:'1H',elapsed:45,league:'Pro League A',round:'24',score:{home:0,away:0},home:{id:900003,name:'Lochin',logo:'https://media.api-sports.io/football/teams/900003.png'},away:{id:25763,name:'FARDU',logo:'https://media.api-sports.io/football/teams/25763.png'}};
        createHomeSignalRenderer({$:id=>document.getElementById(id),state:{matches:[fixture],offset:0},safeUrl:value=>new URL(value,location.origin).href,escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),openMatchCenter:()=>{},openTeam:()=>{}}).render();
        document.querySelectorAll('[data-team-crest]').forEach(image=>installCrestFallback(image));window.crestReady=true;</script></html>`);return;
    }
    const root=path.resolve('public'),file=path.resolve(root,'.'+url.pathname);
    if(!file.startsWith(root+path.sep))throw Error('path');
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.webp')?'image/webp':'text/css');res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const launched=await launchChromeWithRetry(browserExecutable());let cdp;const counts=new Map(),errors=[];
try{
  const tab=await(await fetch(`http://127.0.0.1:${launched.debugPort}/json/new?about:blank`,{method:'PUT'})).json();
  cdp=new Cdp(tab.webSocketDebuggerUrl);await cdp.open();await cdp.call('Page.enable');
  cdp.socket.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data));if(message.method!=='Fetch.requestPaused')return;
    const {requestId,request}=message.params;counts.set(request.url,(counts.get(request.url)||0)+1);
    const absent=request.url.endsWith('/900002.png'),body=request.url.endsWith('/33.png')?genuine:missing;
    void cdp.call('Fetch.fulfillRequest',{requestId,responseCode:absent?404:200,responseHeaders:[{name:'Content-Type',value:'image/png'},{name:'Access-Control-Allow-Origin',value:'*'}],body:absent?'':body.toString('base64')}).catch(error=>errors.push(error.message));
  });
  await cdp.call('Fetch.enable',{patterns:[{urlPattern:'https://media.api-sports.io/football/teams/*'}]});
  await cdp.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  const evaluate=async expression=>{const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('Crest browser evaluation failed');return result.result?.value;};
  let ready=false;
  for(let i=0;i<100;i++){
    ready=await evaluate("window.crestReady && document.querySelector('#camera .team-crest-initials')?.textContent==='CF' && document.querySelector('#failed .team-crest-initials')?.textContent==='MF' && document.querySelector('#genuine img')?.naturalWidth===150 && Array.from(document.querySelectorAll('#homeFeaturedCard img')).length===2 && Array.from(document.querySelectorAll('#homeFeaturedCard img')).every(image=>image.naturalWidth===192)");
    if(ready)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!ready||errors.length)throw Error('HTTP200 camera PNG was not replaced or a real crest disappeared');
  if(await evaluate("Boolean(document.querySelector('#camera img')) || document.querySelector('#genuine .team-crest-initials')!==null"))throw Error('Incorrect crest classification');
  const dimensions=await evaluate("({width:document.querySelector('#camera span').getBoundingClientRect().width,height:document.querySelector('#camera span').getBoundingClientRect().height})");
  if(dimensions.width!==60||dimensions.height!==60)throw Error('Crest fallback changed card dimensions');
  if(counts.size!==3||[...counts.values()].some(count=>count!==1))throw Error('Crest inspection made additional image requests');
  console.log('Rendered crests passed: official FarDU/Lochin badges rendered in actual featured card; exact provider camera pixels removed, genuine badge retained, 404 fallback, original dimensions, one request per image.');
}finally{cdp?.close();await stopChrome(launched.chrome);await rm(launched.profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
